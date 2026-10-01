"""Synthetic-only research transfer boundary and snapshot regressions."""

import asyncio
import inspect
import sqlite3
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_project_acl import headers
from test_research_source_policy import assertion, synthetic_run
from test_research_source_policy import scoped as scoped_fixture
from test_team_auth import ORIGIN, login, make_team_app

from trialboard.agent.provider import ModelError, Reply
from trialboard.api.model_policy import ModelPolicyDenied
from trialboard.api.team_auth import (
    SESSION_COOKIE,
    TeamDataPath,
    TeamIdentity,
    _current_scope,
    _iter_routes,
)
from trialboard.research.model_policy import LazyResearchProvider, ResearchModelGate
from trialboard.research.source_policy import update_policy
from trialboard.research.store import ResearchStore
from trialboard.research.validation import plan_payload


@pytest.fixture
def scoped(tmp_path):
    yield from scoped_fixture.__wrapped__(tmp_path)


class Identity:
    def __init__(self, scope):
        self.scope, self.valid = scope, True

    def revalidate(self, _access):
        return self.scope if self.valid else None


class FakeProvider:
    mode, model = "SCRIPTED_TEST_DOUBLE", "synthetic"

    def __init__(self):
        self.calls, self.after = 0, lambda: None

    async def complete(self, **_kwargs):
        self.calls += 1
        self.after()
        return Reply(value={}, response_id="synthetic", input_tokens=1, output_tokens=1)


def setup_gate(path, access):
    run, provider, counts = synthetic_run(), FakeProvider(), {"factory": 0}
    run.request.model_consent = True
    ResearchStore(path).save_run(run)
    identity = Identity(access)
    gate = ResearchModelGate(path, identity, access, run)

    def factory():
        counts["factory"] += 1
        return provider

    return run, identity, gate, LazyResearchProvider(factory, gate), provider, counts


def allow(path, run):
    for source in run.sources:
        body = assertion(source.digest).model_copy(update={"external_ai": "ALLOW"})
        update_policy(path, run.id, source.id, body)


def call(provider, run):
    return asyncio.run(provider.complete(
        instructions="Synthetic only", payload=plan_payload(run), schema={}, max_output_tokens=10,
    ))


def test_unknown_and_deny_block_factory_then_exact_allow_positive(scoped):
    path, access = scoped
    run, _, _, lazy, provider, counts = setup_gate(path, access)
    with pytest.raises(ModelError, match="NOT_ALLOWED"):
        call(lazy, run)
    assert counts["factory"] == provider.calls == 0
    for source in run.sources:
        update_policy(path, run.id, source.id, assertion(source.digest))
    with pytest.raises(ModelError, match="NOT_ALLOWED"):
        call(lazy, run)
    assert counts["factory"] == provider.calls == 0
    for source in run.sources:
        body = assertion(source.digest, 1).model_copy(update={"external_ai": "ALLOW"})
        update_policy(path, run.id, source.id, body)
    call(lazy, run)
    assert counts["factory"] == provider.calls == 1


@pytest.mark.parametrize("change", ["expired", "viewer", "team", "digest", "policy", "payload"])
def test_each_call_rechecks_identity_rights_exact_version_and_payload(scoped, change):
    path, access = scoped
    run, identity, gate, lazy, provider, counts = setup_gate(path, access)
    allow(path, run)
    call(lazy, run)
    if change == "expired":
        identity.valid = False
    elif change == "viewer":
        identity.scope = replace(access, role="viewer")
    elif change == "team":
        identity.scope = replace(access, team_id=str(uuid4()))
    elif change == "digest":
        run.sources[0].digest = "f" * 64
    elif change == "policy":
        source = run.sources[0]
        update_policy(path, run.id, source.id, assertion(source.digest, 1, storage="DENY"))
    else:
        payload = plan_payload(run)
        payload["sources"][0]["excerpt"] = "unauthorized injected body"
        with pytest.raises(ModelPolicyDenied, match="PAYLOAD_MISMATCH"):
            gate.check(payload)
        assert provider.calls == 1
        return
    with pytest.raises(ModelError):
        call(lazy, run)
    assert counts["factory"] == provider.calls == 1


def test_policy_revoked_during_response_blocks_publication(scoped):
    path, access = scoped
    run, identity, _, lazy, provider, counts = setup_gate(path, access)
    allow(path, run)
    provider.after = lambda: setattr(identity, "valid", False)
    with pytest.raises(ModelError, match="IDENTITY_INVALIDATED"):
        call(lazy, run)
    assert counts["factory"] == provider.calls == 1


def test_fts_policy_and_results_use_one_snapshot(scoped, monkeypatch):
    from trialboard.research import source_policy

    path, access = scoped
    run, _, _, _, _, _ = setup_gate(path, access)
    allow(path, run)
    with sqlite3.connect(path.lookup()) as con:
        con.execute("PRAGMA journal_mode=WAL")
    original = source_policy.searchable_sources

    def revoke_after_read(con, run_id):
        allowed = original(con, run_id)
        assert con.in_transaction
        source = run.sources[0]
        update_policy(path, run.id, source.id, assertion(source.digest, 1, storage="DENY"))
        return allowed

    monkeypatch.setattr(source_policy, "searchable_sources", revoke_after_read)
    assert len(ResearchStore(path).search_sources(run.id, "secretneedle")) == 2
    monkeypatch.setattr(source_policy, "searchable_sources", original)
    assert len(ResearchStore(path).search_sources(run.id, "secretneedle")) == 1


def test_team_pdf_automation_does_not_reuse_source_text_allow(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr("trialboard.agent.runtime.runtime_provider",
                        lambda *_: calls.append("provider-created"))
    app, _, storage = make_team_app(
        tmp_path, enable_evidence_scout=True, enable_pdf_agent=True,
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        team = client.get("/api/teams/current").json()["id"]
        directory = storage / team
        directory.mkdir(mode=0o700, exist_ok=True)
        run = synthetic_run()
        ResearchStore(directory / "evidence.sqlite3").save_run(run)
        for source in run.sources:
            body = assertion(source.digest).model_copy(update={"external_ai": "ALLOW"})
            response = client.post(
                f"/api/research/runs/{run.id}/sources/{source.id}/usage-policy",
                json=body.model_dump(), headers=headers(client),
            )
            assert response.status_code == 200
        response = client.post(f"/api/research/runs/{run.id}/automation/run",
                               json={"consent": True}, headers=headers(client))
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "AUTOMATION_PDF_USAGE_POLICY_REQUIRED"
        assert calls == []


@pytest.mark.parametrize("change", ["absolute", "idle", "role", "logout"])
def test_real_session_is_rechecked_between_requests(tmp_path, change):
    app, identity_db, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        identity = TeamIdentity(identity_db)
        access = identity.authenticate(client.cookies.get(SESSION_COOKIE))
        token = _current_scope.set(access)
        try:
            path = TeamDataPath(storage)
            run, _, gate, lazy, provider, counts = setup_gate(path, access)
            gate.identity = identity
            allow(path, run)
            call(lazy, run)
            with sqlite3.connect(identity_db) as con:
                statement = {
                    "absolute": "UPDATE sessions SET absolute_expires_at=0",
                    "idle": "UPDATE sessions SET last_seen_at=0",
                    "role": "UPDATE memberships SET role='viewer',permission_epoch=2",
                    "logout": "UPDATE sessions SET revoked_at=1",
                }[change]
                con.execute(statement)
            with pytest.raises(ModelError, match="IDENTITY_INVALIDATED"):
                call(lazy, run)
            assert counts["factory"] == provider.calls == 1
        finally:
            _current_scope.reset(token)


def test_new_team_collection_unknown_policy_streams_metadata_only_and_calls_zero(
    tmp_path, monkeypatch,
):
    from trialboard.api.scout import EvidenceStore
    from trialboard.research.models import Coverage

    factories = []

    def factory(*_args):
        factories.append("created")
        return FakeProvider()

    monkeypatch.setattr("trialboard.agent.runtime.runtime_provider", factory)
    source = synthetic_run().sources[0]

    async def registry(run, store):
        run.sources.append(source)
        run.coverage.append(Coverage(channel="ClinicalTrials.gov", query=run.request.nct_id,
                                    status="OK", total=1, fetched=1, limited=False))
        return {}

    async def empty(run, *_args, **_kwargs):
        run.coverage.append(Coverage(channel="Synthetic", query="synthetic", status="EMPTY",
                                    total=0, fetched=0, limited=False))

    monkeypatch.setattr("trialboard.research.collect.registry", registry)
    monkeypatch.setattr("trialboard.research.collect.literature", empty)
    monkeypatch.setattr("trialboard.research.collect.regulatory", empty)
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    endpoint = next(route.endpoint for route in _iter_routes(app.routes)
                    if getattr(route, "path", None) == "/api/research/run")
    captured_factory = inspect.getclosurevars(endpoint).nonlocals["provider_factory"]
    assert inspect.getclosurevars(captured_factory).nonlocals["runtime_provider"] is factory
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        team = client.get("/api/teams/current").json()["id"]
        directory = storage / team
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / "evidence.sqlite3"
        request = synthetic_run().request
        receipt = EvidenceStore(path).save("Synthetic", {}, [{
            "nct_id": request.nct_id, "conditions": [request.indication],
        }])
        request.search_id, request.model_consent = receipt["id"], True
        response = client.post("/api/research/run", json=request.model_dump(),
                               headers=headers(client))
        assert response.status_code == 200
        assert source.text not in response.text
        assert "REVIEW_READY" not in response.text and "AI_PLAN_READY" not in response.text
        assert "MODEL_RESEARCH_EXTERNAL_AI_NOT_ALLOWED" in response.text
        assert "전달했습니다" not in response.text
        assert factories == []
        run_id = client.get("/api/research/runs").json()[0]["id"]
        saved = ResearchStore(path).get_run(run_id)
        assert saved.status == "PARTIAL" and saved.execution_mode == "COLLECTORS_ONLY"
        assert saved.calls[0]["status"] == "BLOCKED_POLICY"
        assert client.get(f"/api/research/runs/{run_id}/source-metadata").status_code == 200
