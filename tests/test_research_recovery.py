"""Interrupted collection recovery; synthetic database only, no model or external calls."""

import asyncio
from datetime import UTC, datetime, timedelta
from threading import BoundedSemaphore

import pytest
import test_research as research_fixtures
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trialboard.api.research import research_router
from trialboard.research.store import ResearchStore

ORIGIN = research_fixtures.ORIGIN


@pytest.fixture
def setup(tmp_path, monkeypatch):
    return research_fixtures.setup.__wrapped__(tmp_path, monkeypatch)


def expired(setup):
    path, request, *_ = setup
    store = ResearchStore(path)
    run = store.start(request)
    run.created_at = (datetime.now(UTC) - timedelta(seconds=700)).isoformat()
    run.events = [{"sequence": 1, "stage": "STARTED", "elapsed_ms": 0, "message": "MOC"}]
    store.save_run(run)
    return store, run


def test_expired_run_recovery_is_idempotent_and_fences_late_writer(setup):
    store, original = expired(setup)
    recovered = store.recover_run(original.id)
    assert recovered.status == "CANCELLED"
    assert recovered.events[:-1] == original.events
    assert recovered.sources == original.sources
    assert recovered.calls == original.calls
    assert recovered.events[-1]["stage"] == "RECOVERED"
    assert store.recover_run(original.id) == recovered
    with pytest.raises(ValueError, match="RECOVERED_RUN_IS_CLOSED"):
        store.save_run(original)
    original.status = "COMPLETE"
    with pytest.raises(ValueError, match="RECOVERED_RUN_IS_CLOSED"):
        store.save_run(original)
    assert store.get_run(original.id) == recovered


def test_new_or_recently_updated_run_is_never_closed(setup):
    path, request, *_ = setup
    store = ResearchStore(path)
    run = store.start(request)
    with pytest.raises(ValueError, match="RUN_MAY_BE_ACTIVE"):
        store.recover_run(run.id)
    run.created_at = (datetime.now(UTC) - timedelta(seconds=700)).isoformat()
    run.events = [{"elapsed_ms": 600_000}]
    store.save_run(run)
    with pytest.raises(ValueError, match="RUN_MAY_BE_ACTIVE"):
        store.recover_run(run.id)
    assert store.get_run(run.id).status == "RUNNING"


def test_recovery_preserves_collected_sources_and_model_review(setup):
    path, request, *_ = setup
    request.model_consent = True
    run = asyncio.run(research_fixtures.execute(path, request, research_fixtures.FakeModel()))
    assert run.sources and run.review and run.calls
    run.status = "RUNNING"
    run.created_at = (datetime.now(UTC) - timedelta(seconds=700)).isoformat()
    store = ResearchStore(path)
    store.save_run(run)
    sources_before = store.search_sources(run.id, "MOC")
    recovered = store.recover_run(run.id)
    assert recovered.sources == run.sources
    assert recovered.review == run.review
    assert recovered.calls == run.calls
    assert sources_before
    assert store.search_sources(recovered.id, "MOC") == sources_before


def test_completed_run_and_missing_run_not_relabelled(setup):
    store, run = expired(setup)
    run.status = "COMPLETE"
    store.save_run(run)
    with pytest.raises(ValueError, match="RUN_NOT_RECOVERABLE"):
        store.recover_run(run.id)
    with pytest.raises(ValueError, match="RESEARCH_NOT_FOUND"):
        store.recover_run("missing")


def test_explicit_local_recovery_endpoint_requires_consent(setup):
    store, run = expired(setup)
    app = FastAPI()
    app.include_router(research_router(store.path, BoundedSemaphore(1)))
    client = TestClient(app)
    url = f"/api/research/runs/{run.id}/recover"
    assert client.post(url, json={"consent": True}).status_code == 403
    for body in ({}, {"consent": False}, {"consent": 1}, {"consent": True, "extra": 1}):
        assert client.post(url, json=body, headers=ORIGIN).status_code == 422
    response = client.post(url, json={"consent": True}, headers=ORIGIN)
    assert response.status_code == 200
    assert response.json()["collection"]["status"] == "CANCELLED"
    assert client.get(f"/api/research/runs/{run.id}").json() == response.json()
