"""MOC inputs, real bounded simulator and durable/API contracts."""

import copy
import json
from threading import BoundedSemaphore

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_automation import ORIGIN, RUN
from test_automation import setup as automation_setup
from test_registry_results import bind, tables

from trialboard.api.exploration import exploration_router
from trialboard.research.exploration import ExplorationStore, build_exploration


@pytest.fixture
def setup(tmp_path):
    automation_setup.__wrapped__(tmp_path)
    store = ExplorationStore(tmp_path / "automation.sqlite")
    app, slots = FastAPI(), BoundedSemaphore(1)
    app.include_router(exploration_router(store.path, slots))
    return store, TestClient(app), slots


def test_read_is_nonexecuting_and_post_is_persisted_idempotent(setup):
    store, client, _ = setup
    path = f"/api/research/runs/{RUN}/exploration"
    assert client.get(path).json() is None
    original = store.get_run(RUN).model_dump()
    r = client.post(path, json={"consent": True}, headers=ORIGIN)
    assert r.status_code == 200
    value = r.json()
    assert len(value["simulations"]) == 9 and value["modelCalls"] == 0
    assert value["snapshotDigest"] is None and value["evidenceStatus"] == "NO_REGISTRY_RESULTS"
    assert value["provenance"] == "RULE_LIBRARY_HYPOTHETICAL"
    assert value["clinicalApproved"] is value["userApproved"] is False
    assert value["evidenceUsedAsParameters"] is False
    assert value["armMapping"] == "UNMAPPED_GENERIC_A_B"
    assert client.post(path, json={"consent": True}, headers=ORIGIN).json() == value
    assert ExplorationStore(store.path).get(RUN) == value
    assert store.get_run(RUN).model_dump() == original


def test_reported_values_never_become_synthetic_parameters(setup):
    store, _, _ = setup
    raw = tables()
    bind(store, raw)
    first = store.create(RUN)
    run = store.get_run(RUN)
    altered = {
        "snapshotDigest": "f" * 64,
        "readiness": {"status": "NEEDS_EVIDENCE", "questions": ["MOC gap"]},
        "outcomes": [{"value": "99.99"}],
    }
    second = build_exploration(run, altered)
    assert first["snapshotDigest"] != second["snapshotDigest"]
    assert first["simulations"] == second["simulations"]
    assert first["recommendedPlanId"] is None
    for result in first["simulations"]:
        assert result["total_sample_size"] == result["design"]["per_arm"] * 2
        assert sum(result["selection_probability"].values()) + result[
            "no_selection_probability"
        ] == pytest.approx(1)
        if result["scenario"]["id"] == "unsafe":
            assert result["true_utility_best_arms"] == []
            assert (
                result["selects_true_utility_best_probability"]
                == result["no_selection_probability"]
            )


@pytest.mark.parametrize(
    "body", [{}, {"consent": False}, {"consent": 1}, {"consent": True, "probability": 1}, None]
)
def test_consent_and_no_client_parameter_injection(setup, body):
    store, client, _ = setup
    assert (
        client.post(f"/api/research/runs/{RUN}/exploration", json=body, headers=ORIGIN).status_code
        == 422
    )
    assert store.get(RUN) is None


def test_origin_capacity_unknown_and_running_are_rejected(setup):
    store, client, slots = setup
    path = f"/api/research/runs/{RUN}/exploration"
    assert client.post(path, json={"consent": True}).status_code == 403
    assert (
        client.post(
            path, json={"consent": True}, headers={"Origin": "https://external.test"}
        ).status_code
        == 403
    )
    slots.acquire()
    assert client.post(path, json={"consent": True}, headers=ORIGIN).status_code == 429
    slots.release()
    run = store.get_run(RUN)
    store.save_run(run.model_copy(update={"status": "RUNNING"}))
    assert client.post(path, json={"consent": True}, headers=ORIGIN).status_code == 409
    assert client.get("/api/research/runs/absent/exploration").status_code == 404


def test_tampered_saved_record_is_not_returned_or_replaced(setup):
    store, client, _ = setup
    original = store.create(RUN)
    changed = copy.deepcopy(original)
    changed["clinicalApproved"] = True
    con = store.connect()
    with con:
        con.execute(
            "UPDATE research_exploration SET data=? WHERE run_id=?", (json.dumps(changed), RUN)
        )
    con.close()
    path = f"/api/research/runs/{RUN}/exploration"
    assert client.get(path).status_code == 409
    assert client.post(path, json={"consent": True}, headers=ORIGIN).status_code == 409
