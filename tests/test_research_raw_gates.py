"""RAW-dependent publication and outgoing intersections: fake providers, real local gates."""

import asyncio
import hashlib
import json
import sqlite3

import pytest
from fastapi import HTTPException
from test_project_acl import headers
from test_registry_results import tables
from test_research_model_policy import FakeProvider
from test_research_raw_policy import scenario as raw_scenario
from test_research_source_policy import assertion as source_assertion

from trialboard.agent.provider import ModelError
from trialboard.api.team_auth import SESSION_COOKIE, TeamDataPath, TeamIdentity, _current_scope
from trialboard.research import raw_policy, source_policy
from trialboard.research.automation import AutomationStore
from trialboard.research.exploration import ExplorationStore
from trialboard.research.model_policy import LazyResearchProvider, ResearchModelGate
from trialboard.research.raw_policy import RawPolicyUpdate
from trialboard.research.store import ResearchStore
from trialboard.research.validation import plan_payload
from trialboard.serialization import sha256_json


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    generator = raw_scenario.__wrapped__(tmp_path, monkeypatch)
    fixture = next(generator)
    value, _, _ = fixture
    client, run, database, _, base, request, *_ = value
    registry = run.sources[0].model_copy(deep=True, update={
        "id": "registry_NCT00000001", "kind": "REGISTRY", "digest": "c" * 64,
        "raw_snapshots": [ResearchStore(database).snapshot(tables())]})
    run.sources.append(registry)
    ResearchStore(database).save_run(run)
    for source in run.sources:
        body = source_assertion(source.digest).model_dump()
        body["external_ai"] = "ALLOW"
        assert client.post(base + f"/sources/{source.id}/usage-policy", json=body,
                           headers=headers(client)).status_code == 200
    request["source_bindings"][0]["source_digest"] = run.sources[0].digest
    yield fixture
    try:
        next(generator)
    except StopIteration:
        pass


def raw_assertion(scenario, index, revision=0, *, storage="ALLOW", search="UNKNOWN", ai="UNKNOWN"):
    value, _, body = scenario
    source = value[1].sources[index]
    return {**body, "source_digest": source.digest, "snapshot_digest": source.raw_snapshots[0],
            "expected_policy_revision": revision, "original_storage": storage,
            "internal_search": search, "external_ai": ai}


def allow(scenario, index, revision=0, **permissions):
    value, _, _ = scenario
    body = raw_assertion(scenario, index, revision, **permissions)
    response = value[0].post(value[4] + f"/sources/{value[1].sources[index].id}/raw-usage-policy",
                             json=body, headers=headers(value[0]))
    assert response.status_code == 200, response.text


def review(scenario):
    value = scenario[0]
    return value[0].post(value[4] + "/review-saved", json=value[5], headers=headers(value[0]))


def test_fullread_fts_and_registry_tables_require_actual_raw_rights(scenario):
    value = scenario[0]
    client, _, database, _, base, *_, state, _ = value
    assert client.get(base).status_code == 403
    assert client.get(base + "/result-tables").status_code == 403
    assert client.get(base + "/search?q=secretneedle").json() == []
    for index in range(3):
        allow(scenario, index)
    assert client.get(base).status_code == 200
    tables_response = client.get(base + "/result-tables")
    assert tables_response.status_code == 200 and len(tables_response.json()["outcomes"]) == 1
    assert client.get(base + "/search?q=secretneedle").json() == []
    allow(scenario, 0, 1, search="ALLOW")
    searched = client.get(base + "/search?q=secretneedle").json()
    assert len(searched) == 1 and searched[0]["source_id"] == value[1].sources[0].id
    allow(scenario, 0, 2, storage="DENY", search="ALLOW")
    assert client.get(base).status_code == 403
    assert client.get(base + "/result-tables").status_code == 403
    assert client.get(base + "/search?q=secretneedle").json() == []
    assert state["calls"] == state["factories"] == 0
    assert database.exists()


def test_selected_saved_review_intersects_raw_external_and_result_read(scenario):
    value = scenario[0]
    assert review(scenario).status_code == 403
    assert value[6]["factories"] == value[6]["calls"] == 0
    allow(scenario, 0)
    assert review(scenario).status_code == 403
    allow(scenario, 0, 1, ai="ALLOW")
    response = review(scenario)
    assert response.status_code == 200 and '"type": "COMPLETE"' in response.text
    with sqlite3.connect(value[2]) as con:
        artifact = json.loads(con.execute(
            "SELECT data FROM research_saved_review_records WHERE phase=1").fetchone()[0])
    target = value[4] + "/review-attempts/" + artifact["attempt_id"]
    assert value[0].get(target).status_code == 200
    # Unselected raw remains UNKNOWN; selected-only review does not escalate it.
    assert value[0].get(value[4]).status_code == 403
    allow(scenario, 0, 2, storage="DENY", ai="ALLOW")
    assert value[0].get(target).status_code == 403
    assert value[0].get(value[4] + "/review-attempts").status_code == 200
    assert value[6]["factories"] == value[6]["calls"] == 1


@pytest.mark.parametrize("change", ["deny", "revision", "bytes"])
def test_raw_revoked_or_changed_during_model_response_is_never_published(scenario, change):
    value = scenario[0]
    allow(scenario, 0, ai="ALLOW")

    def revoke():
        if change == "bytes":
            with sqlite3.connect(value[2]) as con:
                con.execute("UPDATE snapshots SET raw='{}'")
        else:
            body = raw_assertion(scenario, 0, 1, ai="DENY" if change == "deny" else "ALLOW")
            raw_policy.update(TeamDataPath(value[2].parent.parent), TeamIdentity(value[3]),
                              value[1].id, value[1].sources[0].id, RawPolicyUpdate(**body))

    value[6]["after"] = revoke
    response = review(scenario)
    assert response.status_code == 200 and '"type": "FAILED"' in response.text
    assert "secretneedle" not in response.text
    with sqlite3.connect(value[2]) as con:
        artifact = json.loads(con.execute(
            "SELECT data FROM research_saved_review_records WHERE phase=1").fetchone()[0])
    assert artifact["error_code"] == "MODEL_POLICY_DENIED" and artifact["review"] is None
    assert value[6]["calls"] == 1


def test_cached_exploration_rights_and_artifact_share_read_snapshot(scenario, monkeypatch):
    value = scenario[0]
    for index in range(3):
        allow(scenario, index)
    artifact = {"runId": value[1].id, "synthetic": "private derived raw detail"}
    with sqlite3.connect(value[2]) as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("CREATE TABLE research_exploration(run_id TEXT,digest TEXT,data TEXT)")
        con.execute("INSERT INTO research_exploration VALUES (?,?,?)",
                    (value[1].id, sha256_json(artifact), json.dumps(artifact)))
    identity = TeamIdentity(value[3])
    scope = identity.authenticate(value[0].cookies.get(SESSION_COOKIE))
    token = _current_scope.set(scope)
    path = TeamDataPath(value[2].parent.parent)
    original = source_policy.require_content_con
    import trialboard.research.exploration as exploration

    def revoke_after_gate(con, run_id):
        context = original(con, run_id)
        assert con.in_transaction
        body = raw_assertion(scenario, 0, 1, storage="DENY")
        raw_policy.update(path, identity, run_id, value[1].sources[0].id, RawPolicyUpdate(**body))
        return context

    monkeypatch.setattr(exploration, "require_content_con", revoke_after_gate)
    try:
        assert ExplorationStore(path).get(value[1].id) == artifact
        monkeypatch.setattr(exploration, "require_content_con", original)
        with pytest.raises(HTTPException) as error:
            ExplorationStore(path).get(value[1].id)
        assert error.value.status_code == 403
    finally:
        _current_scope.reset(token)


def test_existing_collection_plan_gate_intersects_raw_and_pins_revision(scenario):
    value = scenario[0]
    identity = TeamIdentity(value[3])
    scope = identity.authenticate(value[0].cookies.get(SESSION_COOKIE))
    token = _current_scope.set(scope)
    path = TeamDataPath(value[2].parent.parent)
    fake, factories = FakeProvider(), []

    def factory():
        factories.append("called")
        return fake

    try:
        gate = ResearchModelGate(path, identity, scope, value[1])
        provider = LazyResearchProvider(factory, gate)

        def call():
            return asyncio.run(provider.complete(instructions="Synthetic only",
                payload=plan_payload(value[1]), schema={}, max_output_tokens=10))

        with pytest.raises(ModelError):
            call()
        assert factories == [] and fake.calls == 0
        for index in range(3):
            allow(scenario, index, ai="ALLOW")
        call()
        assert factories == ["called"] and fake.calls == 1
        allow(scenario, 0, 1, ai="ALLOW")  # Same permission, different audited revision.
        with pytest.raises(ModelError):
            call()
        assert fake.calls == 1
    finally:
        _current_scope.reset(token)


def test_cached_automation_requires_raw_and_pdf_in_same_snapshot(scenario):
    value = scenario[0]
    for index in range(3):
        allow(scenario, index)
    source = value[1].sources[0]
    raw_pdf = b"%PDF-synthetic policy fixture"
    pdf_sha = hashlib.sha256(raw_pdf).hexdigest()
    artifact = {"document": {"sourceId": source.id, "source": {"sha256": pdf_sha}},
                "synthetic": "raw-derived automation detail"}
    with sqlite3.connect(value[2]) as con:
        con.execute("CREATE TABLE public_pdf_blobs(digest TEXT PRIMARY KEY,content BLOB)")
        con.execute("CREATE TABLE public_pdf_receipts(run_id TEXT,source_id TEXT,digest TEXT)")
        con.execute("INSERT INTO public_pdf_blobs VALUES (?,?)", (pdf_sha, raw_pdf))
        con.execute("INSERT INTO public_pdf_receipts VALUES (?,?,?)",
                    (value[1].id, source.id, pdf_sha))
        con.execute("CREATE TABLE research_automation "
                    "(run_id TEXT,digest TEXT,status TEXT,data TEXT)")
        con.execute("INSERT INTO research_automation VALUES (?,?,?,?)",
                    (value[1].id, "synthetic", "PREPARED", json.dumps(artifact)))
    body = {k: scenario[2][k] for k in (*raw_policy.PURPOSES, "evidence_reference", "reason")}
    body.update(source_digest=source.digest, pdf_sha256=pdf_sha, expected_policy_revision=0)
    result = value[0].post(value[4] + f"/documents/{source.id}/usage-policy",
                           json=body, headers=headers(value[0]))
    assert result.status_code == 200, result.text
    identity = TeamIdentity(value[3])
    token = _current_scope.set(identity.authenticate(value[0].cookies.get(SESSION_COOKIE)))
    try:
        store = AutomationStore(TeamDataPath(value[2].parent.parent))
        before = value[2].read_bytes()
        assert store.get(value[1].id) == artifact
        assert value[2].read_bytes() == before
        allow(scenario, 0, 1, storage="DENY")
        with pytest.raises(HTTPException) as denied:
            store.get(value[1].id)
        assert denied.value.status_code == 403
    finally:
        _current_scope.reset(token)
