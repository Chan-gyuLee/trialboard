"""Stored source policy tests use synthetic content and temporary databases only."""

import json
import sqlite3
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_project_acl import headers
from test_team_auth import ORIGIN, login, make_team_app

from trialboard.api.team_auth import AccessScope, TeamDataPath, _current_scope
from trialboard.research.models import Collection, ResearchRequest, Source
from trialboard.research.source_policy import (
    SourcePolicyUpdate,
    metadata,
    policy_history,
    require_content,
    update_policy,
)
from trialboard.research.store import ResearchStore


def synthetic_run():
    return Collection(
        id=str(uuid4()), project_id="synthetic-project", created_at="2026-10-01T00:00:00Z",
        request=ResearchRequest(search_id=str(uuid4()), nct_id="NCT00000001",
                                asset="MOC drug", indication="MOC condition",
                                public_consent=True),
        status="COMPLETE", sources=[
            Source(id=f"source-{i}", kind="PAPER", title=f"Synthetic {i}",
                   url="https://example.org", text=f"secretneedle content {i}",
                   content_level="ABSTRACT", link_basis=[], identifiers={},
                   fetched_at="2026-10-01T00:00:00Z", digest=str(i + 1) * 64)
            for i in range(2)
        ], coverage=[], events=[],
    )


def assertion(digest, revision=0, storage="ALLOW", search="ALLOW"):
    return SourcePolicyUpdate(
        source_digest=digest, expected_policy_revision=revision,
        original_storage=storage, internal_search=search, external_ai="UNKNOWN",
        training="DENY", evidence_reference="Synthetic permission fixture",
        reason="Test assertion; not a legal assessment.",
    )


@pytest.fixture
def scoped(tmp_path):
    scope = AccessScope(str(uuid4()), "admin", str(uuid4()), "Synthetic", "admin",
                        1, "session", 9999999999, 9999999999)
    token = _current_scope.set(scope)
    path = TeamDataPath(tmp_path)
    try:
        yield path, scope
    finally:
        _current_scope.reset(token)


def test_metadata_missing_database_does_not_create_team_directory(scoped):
    path, scope = scoped
    with pytest.raises(HTTPException) as error:
        metadata(path, "missing")
    assert error.value.status_code == 404
    assert not (path.root / scope.team_id).exists()


def test_policy_binding_history_cas_read_and_filtered_search(scoped):
    path, scope = scoped
    run = synthetic_run()
    store = ResearchStore(path)
    store.save_run(run)  # Legacy creator remains unknown even under authenticated scope.
    before = path.lookup().read_bytes()
    info = metadata(path, run.id)
    assert info["can_manage"]
    assert "secretneedle" not in json.dumps(info)
    assert info["sources"][0]["usage_policy"]["policy_revision"] == 0
    assert policy_history(path, run.id, run.sources[0].id)["history"] == []
    assert store.list_runs()[0]["id"] == run.id
    assert path.lookup().read_bytes() == before
    with pytest.raises(HTTPException, match="403"):
        require_content(path, run.id)
    assert store.search_sources(run.id, "secretneedle") == []

    first = run.sources[0]
    saved = update_policy(path, run.id, first.id, assertion(first.digest))
    assert saved["current"]["asserted_by"] == scope.subject_id
    assert saved["current"]["verification"] == "USER_ATTESTED_UNVERIFIED"
    assert [r["source_id"] for r in store.search_sources(run.id, "secretneedle")] == [first.id]
    for bad in (assertion(first.digest), assertion("f" * 64, 1)):
        with pytest.raises(HTTPException) as error:
            update_policy(path, run.id, first.id, bad)
        assert error.value.status_code == 409
    update_policy(path, run.id, run.sources[1].id, assertion(run.sources[1].digest))
    require_content(path, run.id)
    update_policy(path, run.id, first.id, assertion(first.digest, 1, search="DENY"))
    assert [r["source_id"] for r in store.search_sources(run.id, "secretneedle")] == ["source-1"]
    assert len(policy_history(path, run.id, first.id)["history"]) == 2
    update_policy(path, run.id, first.id, assertion(first.digest, 2, storage="DENY"))
    with pytest.raises(HTTPException) as error:
        require_content(path, run.id)
    assert error.value.status_code == 403
    with sqlite3.connect(path.lookup()) as con:
        with pytest.raises(sqlite3.IntegrityError, match="IMMUTABLE"):
            con.execute("DELETE FROM research_source_policies")
    other_run = run.model_copy(update={"id": str(uuid4())})
    store.save_run(other_run)
    assert store.search_sources(other_run.id, "secretneedle") == []
    token = _current_scope.set(replace(scope, team_id=str(uuid4())))
    try:
        with pytest.raises(HTTPException) as error:
            metadata(path, run.id)
        assert error.value.status_code == 404
    finally:
        _current_scope.reset(token)


@pytest.mark.parametrize("role", ["reviewer", "viewer"])
def test_unknown_creator_cannot_be_claimed_by_reader(scoped, role):
    path, scope = scoped
    run = synthetic_run()
    ResearchStore(path).save_run(run)
    token = _current_scope.set(replace(scope, role=role))
    try:
        assert not metadata(path, run.id)["can_manage"]
        with pytest.raises(HTTPException) as error:
            update_policy(path, run.id, run.sources[0].id, assertion(run.sources[0].digest))
        assert error.value.status_code == 403
    finally:
        _current_scope.reset(token)


def test_team_routes_block_content_keep_metadata_and_allow_explicit_policy(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        team = client.get("/api/teams/current").json()["id"]
        directory = storage / team
        directory.mkdir(mode=0o700, exist_ok=True)
        run = synthetic_run()
        ResearchStore(directory / "evidence.sqlite3").save_run(run)
        base = f"/api/research/runs/{run.id}"
        for suffix in ("", "/curation", "/result-tables", "/automation", "/exploration"):
            assert client.get(base + suffix).status_code == 403
        assert client.get(base + "/source-metadata").status_code == 200
        assert client.get(base + "/search?q=secretneedle").json() == []
        assert client.get("/api/research/runs").status_code == 200
        for source in run.sources:
            url = base + f"/sources/{source.id}/usage-policy"
            assert client.get(url).json()["current"]["policy_revision"] == 0
            response = client.post(url, json=assertion(source.digest).model_dump(),
                                   headers=headers(client))
            assert response.status_code == 200, response.text
        assert client.get(base).status_code == 200
        assert len(client.get(base + "/search?q=secretneedle").json()) == 2


def test_new_run_owner_is_server_derived_and_viewer_still_cannot_write(scoped, monkeypatch):
    path, scope = scoped
    token = _current_scope.set(replace(scope, role="reviewer"))
    try:
        store = ResearchStore(path)
        request = synthetic_run().request
        monkeypatch.setattr(store, "read", lambda _: {
            "studies": [{"nct_id": request.nct_id, "conditions": [request.indication]}],
        })
        run = store.start(request)
        run.sources = synthetic_run().sources
        store.save_run(run)
        assert metadata(path, run.id)["can_manage"]
        source = run.sources[0]
        update_policy(path, run.id, source.id, assertion(source.digest))
        viewer_token = _current_scope.set(replace(scope, role="viewer"))
        try:
            assert not metadata(path, run.id)["can_manage"]
            with pytest.raises(HTTPException) as error:
                update_policy(path, run.id, source.id, assertion(source.digest, 1))
            assert error.value.status_code == 403
        finally:
            _current_scope.reset(viewer_token)
        outsider_token = _current_scope.set(
            replace(scope, role="reviewer", subject_id=str(uuid4()))
        )
        try:
            assert not metadata(path, run.id)["can_manage"]
        finally:
            _current_scope.reset(outsider_token)
    finally:
        _current_scope.reset(token)


def test_changed_source_digest_requires_new_assertion(scoped):
    path, _ = scoped
    store, run = ResearchStore(path), synthetic_run()
    store.save_run(run)
    source = run.sources[0]
    update_policy(path, run.id, source.id, assertion(source.digest))
    run.sources[0] = source.model_copy(update={"digest": "a" * 64, "text": "changed body"})
    store.save_run(run)
    current = policy_history(path, run.id, source.id)
    assert current["current"]["policy_revision"] == 0
    assert current["history"] == []
    assert store.search_sources(run.id, "changed") == []
