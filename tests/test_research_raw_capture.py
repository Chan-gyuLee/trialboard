"""R2 uses real TEAM routes with fake public collectors; no external or model calls."""

import asyncio
import copy
import json
import sqlite3
from types import SimpleNamespace

import httpx
import pytest
from test_project_acl import headers
from test_registry_results import tables
from test_saved_research_review import scenario as base_scenario

from trialboard.api.scout import EvidenceStore
from trialboard.research import collect
from trialboard.research.store import ResearchStore


@pytest.mark.parametrize("payload", [b'{"a":1,"a":2}', b'{"a":NaN}', b"[]"])
@pytest.mark.parametrize("collector", ["research", "registry"])
def test_network_decoders_reject_duplicate_nonfinite_and_nonobject(monkeypatch, payload, collector):
    from trialboard.api.scout import fetch_registry

    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=payload))
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs)
    )
    with pytest.raises(ValueError):
        asyncio.run(
            collect.get_json(collect.EPMC, {})
            if collector == "research"
            else fetch_registry("NCT00000001")
        )


PERMISSIONS = [
    {
        "collector": name,
        "original_storage": "ALLOW",
        "evidence_reference": "Synthetic explicit license",
        "reason": "Public synthetic fixture only",
    }
    for name in ("REGISTRY", "LITERATURE", "REGULATORY")
]


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    generator = base_scenario.__wrapped__(tmp_path, monkeypatch)
    value = next(generator)
    client, run, database, *_ = value
    request = run.request.model_dump()
    receipt = EvidenceStore(database).save(
        "Synthetic", {}, [{"nct_id": request["nct_id"], "conditions": [request["indication"]]}]
    )
    request["search_id"] = receipt["id"]
    calls = []
    control = {"after": lambda: None, "invalid": False}

    async def registry(_nct):
        calls.append("REGISTRY")
        data = tables()
        data["studies"][0]["protocolSection"]["identificationModule"].update(
            briefTitle="Synthetic trial", nctId="NCT00000002" if control["invalid"] else _nct
        )
        control["after"]()
        return data

    async def get_json(url, params):
        calls.append("LITERATURE" if url == collect.EPMC else "REGULATORY")
        control["after"]()
        if url == collect.FDA:
            return {"results": []}
        return {
            "hitCount": 1,
            "query": params["query"],
            "resultList": {
                "result": [
                    {
                        "source": "MED",
                        "pmid": "1234",
                        "title": "Synthetic paper",
                        "abstractText": "Private synthetic abstract NCT00000001",
                    }
                ]
            },
        }

    monkeypatch.setattr(collect, "fetch_registry", registry)
    monkeypatch.setattr(collect, "get_json", get_json)
    yield value, request, calls, control
    try:
        next(generator)
    except StopIteration:
        pass


def execute(scenario, permissions=None):
    value, request, calls, _ = scenario
    body = {**request, "raw_storage_permissions": permissions or []}
    response = value[0].post("/api/research/run", json=body, headers=headers(value[0]))
    assert response.status_code == 200, response.text
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    run_id = events[0]["run_id"]
    return response, ResearchStore(value[2]).get_run(run_id), calls


def test_no_permission_is_explicit_skip_network_zero(scenario):
    response, run, calls = execute(scenario)
    assert calls == [] and run.sources == []
    assert run.coverage and all(c.status == "SKIPPED" for c in run.coverage)
    assert "네트워크 요청을 생략" in response.text
    assert scenario[0][6]["factories"] == 0


@pytest.mark.parametrize("revoked", [False, True])
def test_stream_cancellation_preserves_fresh_write_authority(scenario, monkeypatch, revoked):
    from trialboard.api.team_auth import (
        SESSION_COOKIE,
        TeamIdentity,
        _current_scope,
        _iter_routes,
    )
    from trialboard.research.models import ResearchRequest

    client = scenario[0][0]
    identity = TeamIdentity(scenario[0][3])
    scope = identity.authenticate(client.cookies.get(SESSION_COOKIE))
    endpoint = next(
        route.endpoint
        for route in _iter_routes(client.app.routes)
        if getattr(route, "path", None) == "/api/research/run"
    )

    async def exercise():
        entered = asyncio.Event()

        async def blocked(_nct):
            entered.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(collect, "fetch_registry", blocked)
        request = ResearchRequest.model_validate(
            {**scenario[1], "raw_storage_permissions": PERMISSIONS[:1]}
        )
        response = await endpoint(
            request,
            SimpleNamespace(headers={key.lower(): value for key, value in headers(client).items()}),
        )
        iterator = response.body_iterator
        first = await anext(iterator)
        run_id = json.loads(first[6:])["run_id"]
        await asyncio.wait_for(entered.wait(), timeout=2)
        if revoked:
            with sqlite3.connect(scenario[0][3]) as con:
                con.execute("UPDATE sessions SET revoked_at=1")
        await iterator.aclose()
        return run_id

    token = _current_scope.set(scope)
    try:
        run_id = asyncio.run(exercise())
    finally:
        _current_scope.reset(token)
    saved = ResearchStore(scenario[0][2]).get_run(run_id)
    assert saved.status == ("RUNNING" if revoked else "CANCELLED")
    assert saved.sources == [] and scenario[0][6]["factories"] == 0


def test_allow_capture_multiquery_repeat_run_and_posted_results_preserved(scenario):
    client, _, database, _, _, _, state, _ = scenario[0]
    previous = None
    for _ in range(2):
        response, run, calls = execute(scenario, PERMISSIONS)
        assert run.status == "COMPLETE", response.text
        assert "Private synthetic abstract" not in response.text
        assert any(s.id.startswith("registry_results_") for s in run.sources)
        paper = next(s for s in run.sources if s.id == "paper_1234")
        assert len(paper.raw_snapshots) >= 2 and len(paper.link_basis) >= 2
        if previous:
            assert paper.digest == previous.digest and paper.fetched_at != previous.fetched_at
        previous = paper
        base = f"/api/research/runs/{run.id}"
        packet = client.get(base + "/raw-metadata")
        assert packet.status_code == 200, packet.text
        for source in packet.json()["sources"]:
            for version in source["snapshots"]:
                policy = version["usage_policy"]
                assert policy["original_storage"] == "ALLOW" and policy["policy_revision"] == 1
                assert all(
                    policy[p] == "UNKNOWN" for p in ("external_ai", "training", "internal_search")
                )
        assert client.get(base).status_code == 403  # SOURCE_TEXT is still UNKNOWN.
        with sqlite3.connect(database) as con:
            count = con.execute(
                "SELECT count(*) FROM research_raw_captures WHERE run_id=?", (run.id,)
            ).fetchone()[0]
            assert count == len(calls) // (_ + 1)
            with pytest.raises(sqlite3.IntegrityError, match="IMMUTABLE"):
                con.execute("DELETE FROM research_raw_captures")
    assert state["factories"] == state["calls"] == 0


@pytest.mark.parametrize("change", ["add", "delete", "basis", "time"])
def test_current_run_provenance_tampering_cannot_rebind_capture(scenario, change):
    _, run, _ = execute(scenario, PERMISSIONS)
    source = next(s for s in run.sources if s.id == "paper_1234")
    with sqlite3.connect(scenario[0][2]) as con:
        if change == "add":
            source.raw_snapshots.append("f" * 64)
            con.execute(
                "INSERT INTO research_links VALUES (?,?,?,?)",
                (run.id, source.id, "RAW_SNAPSHOT", "f" * 64),
            )
        elif change == "delete":
            removed = source.raw_snapshots.pop()
            con.execute(
                "DELETE FROM research_links WHERE run_id=? AND source_id=? AND target=?",
                (run.id, source.id, removed),
            )
        elif change == "basis":
            source.link_basis.append("FORGED")
            con.execute(
                "INSERT INTO research_links VALUES (?,?,?,?)",
                (run.id, source.id, "LINK_BASIS", "FORGED"),
            )
        else:
            source.fetched_at = "not-a-time"
        con.execute("UPDATE research_runs SET data=? WHERE id=?", (run.model_dump_json(), run.id))
    result = scenario[0][0].get(f"/api/research/runs/{run.id}/raw-metadata")
    assert result.status_code == 409, result.text


def test_capture_then_explicit_source_and_raw_transfer_permission_saved_review(scenario):
    from test_research_source_policy import assertion

    _, run, _ = execute(scenario, PERMISSIONS)
    client = scenario[0][0]
    source = next(s for s in run.sources if s.id == "paper_1234")
    base = f"/api/research/runs/{run.id}"
    request = {
        "model_consent": True,
        "source_bindings": [
            {"source_id": source.id, "source_digest": source.digest, "policy_revision": 1}
        ],
    }
    allowed = assertion(source.digest).model_copy(update={"external_ai": "ALLOW"})
    assert (
        client.post(
            base + f"/sources/{source.id}/usage-policy",
            json=allowed.model_dump(),
            headers=headers(client),
        ).status_code
        == 200
    )
    assert (
        client.post(base + "/review-saved", json=request, headers=headers(client)).status_code
        == 403
    )
    for digest in source.raw_snapshots:
        body = {**allowed.model_dump(), "snapshot_digest": digest, "expected_policy_revision": 1}
        response = client.post(
            base + f"/sources/{source.id}/raw-usage-policy", json=body, headers=headers(client)
        )
        assert response.status_code == 200, response.text
    response = client.post(base + "/review-saved", json=request, headers=headers(client))
    assert response.status_code == 200 and '"type": "COMPLETE"' in response.text
    assert scenario[0][6]["factories"] == scenario[0][6]["calls"] == 1
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    artifact = client.get(base + "/review-attempts/" + events[0]["attempt_id"])
    assert artifact.status_code == 200
    assert artifact.json()["review"]["findings"][0]["quote"] == source.text


def test_wrong_registry_response_not_persisted(scenario):
    scenario[3]["invalid"] = True
    _, run, calls = execute(scenario, PERMISSIONS[:1])
    assert calls == ["REGISTRY"] and run.sources == []
    with sqlite3.connect(scenario[0][2]) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_raw_captures'"
        ).fetchone()


@pytest.mark.parametrize("change", ["session", "role", "request"])
def test_session_revoked_after_fetch_no_capture_no_hanging_stream(scenario, change):
    def revoke():
        if change == "request":
            with sqlite3.connect(scenario[0][2]) as con:
                row = con.execute(
                    "SELECT id,data FROM research_runs ORDER BY rowid DESC LIMIT 1"
                ).fetchone()
                data = json.loads(row[1])
                data["request"]["asset"] = "Other drug"
                con.execute(
                    "UPDATE research_runs SET data=? WHERE id=?", (json.dumps(data), row[0])
                )
        else:
            with sqlite3.connect(scenario[0][3]) as con:
                con.execute(
                    "UPDATE sessions SET revoked_at=1"
                    if change == "session"
                    else "UPDATE memberships SET role='viewer',permission_epoch=2"
                )

    scenario[3]["after"] = revoke
    response, run, calls = execute(scenario, PERMISSIONS[:1])
    assert calls == ["REGISTRY"] and run.sources == []
    assert '"stage": "ERROR"' in response.text
    with sqlite3.connect(scenario[0][2]) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_raw_captures'"
        ).fetchone()


@pytest.mark.parametrize("change", ["duplicate", "blank", "deny", "extra"])
def test_permission_contract_rejected_before_network(scenario, change):
    values = copy.deepcopy(PERMISSIONS[:1])
    if change == "duplicate":
        values *= 2
    elif change == "blank":
        values[0]["reason"] = " "
    elif change == "deny":
        values[0]["original_storage"] = "DENY"
    else:
        values[0]["body"] = "arbitrary"
    response = scenario[0][0].post(
        "/api/research/run",
        headers=headers(scenario[0][0]),
        json={**scenario[1], "raw_storage_permissions": values},
    )
    assert response.status_code == 422 and scenario[2] == []
