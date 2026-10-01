"""Observed usage metadata only: no provider call, no real quota or billing calculation."""

import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi import HTTPException
from test_project_acl import headers
from test_research_source_policy import assertion, synthetic_run
from test_research_source_policy import scoped as scoped_fixture
from test_saved_research_review import scenario as route_scenario

from trialboard.research import review_usage as usage_module
from trialboard.research.saved_review import persist
from trialboard.research.store import ResearchStore


@pytest.fixture
def scenario(tmp_path):
    generator = scoped_fixture.__wrapped__(tmp_path)
    path, access = next(generator)
    run = synthetic_run()
    ResearchStore(path).save_run(run)  # Source policies remain UNKNOWN; metadata remains readable.
    yield path, access, run
    try:
        next(generator)
    except StopIteration:
        pass


def pair(scenario, *, status="COMPLETED", mode="DACON_RESPONSES", calls=1,
         inputs=2, outputs=3):
    path, access, run = scenario
    start = {"schema": "research-saved-review/1", "mode": "SAVED_REVIEW_ONLY",
             "run_id": run.id, "attempt_id": str(uuid4()), "created_at": "2026-10-01T00:00:00Z",
             "completed_at": None, "asserted_by": access.subject_id,
             "context": {"asset": "sensitive query"}, "source_bindings": [{"id": "sensitive"}],
             "status": "RUNNING", "execution_mode": "COLLECTORS_ONLY", "model_calls": 0,
             "input_tokens": None, "output_tokens": None, "review": "sensitive quote"}
    terminal = {**start, "status": status, "execution_mode": mode, "model_calls": calls,
                "completed_at": "2026-10-01T00:00:01Z", "input_tokens": inputs,
                "output_tokens": outputs}
    return start, terminal


def add(scenario, **kwargs):
    start, terminal = pair(scenario, **kwargs)
    persist(scenario[0].lookup(), start, 0)
    persist(scenario[0].lookup(), terminal, 1)
    return start, terminal


def test_terminal_dedup_separates_modes_unfinished_and_missing_observations(scenario):
    path, _, run = scenario
    add(scenario)
    add(scenario, status="FAILED", inputs=None, outputs=7)
    add(scenario, status="CANCELLED", inputs=5, outputs=None)
    add(scenario, mode="SCRIPTED_TEST_DOUBLE", inputs=100, outputs=200)
    add(scenario, status="FAILED", mode="COLLECTORS_ONLY", calls=0, inputs=None, outputs=None)
    start, _ = pair(scenario)
    persist(path.lookup(), start, 0)
    before = path.lookup().read_bytes()
    result = usage_module.review_usage(path, run.id)
    assert path.lookup().read_bytes() == before
    assert result["attempts_total"] == 6
    assert (result["completed_attempts"], result["failed_attempts"],
            result["cancelled_attempts"], result["unfinished_attempts"]) == (2, 2, 1, 1)
    assert result["usage_by_mode"]["DACON_RESPONSES"] == {
        "observed_model_calls": 3, "observed_input_tokens": 7, "observed_output_tokens": 10,
        "input_unknown_attempts": 1, "output_unknown_attempts": 1,
    }
    assert result["usage_by_mode"]["SCRIPTED_TEST_DOUBLE"]["observed_input_tokens"] == 100
    assert all(v == 0 for v in result["usage_by_mode"]["COLLECTORS_ONLY"].values())
    assert "sensitive" not in json.dumps(result)


def test_empty_history_does_not_initialize_record_table(scenario):
    path, _, run = scenario
    before = path.lookup().read_bytes()
    assert usage_module.review_usage(path, run.id)["attempts_total"] == 0
    assert path.lookup().read_bytes() == before


@pytest.mark.parametrize("change", ["mode", "bool", "negative", "missing-token", "phase",
                                    "id", "run", "binding", "startless", "zero-tokens", "schema"])
def test_bad_records_fail_closed(scenario, change):
    path, _, run = scenario
    start, terminal = pair(scenario)
    if change == "mode":
        terminal["execution_mode"] = "UNKNOWN_PROVIDER"
    elif change == "bool":
        terminal["input_tokens"] = True
    elif change == "negative":
        terminal["output_tokens"] = -1
    elif change == "missing-token":
        del terminal["input_tokens"]
    elif change == "phase":
        terminal["status"] = "RUNNING"
    elif change == "id":
        terminal["attempt_id"] = str(uuid4())
    elif change == "run":
        terminal["run_id"] = str(uuid4())
    elif change == "binding":
        terminal["source_bindings"] = [{"id": "changed"}]
    elif change == "zero-tokens":
        terminal.update(status="FAILED", model_calls=0)
    elif change == "schema":
        terminal["schema"] = "foreign"
    persist(path.lookup(), start, 0)
    # Synthetic bad store state is deliberately inserted, never a user database.
    with sqlite3.connect(path.lookup()) as con:
        if change == "startless":
            terminal["attempt_id"] = str(uuid4())
            sql_id = terminal["attempt_id"]
        else:
            sql_id = start["attempt_id"]
        con.execute("INSERT INTO research_saved_review_records VALUES (?,?,?,?,?)",
                    (sql_id, 1, run.id, start["created_at"], json.dumps(terminal)))
    with pytest.raises(HTTPException) as error:
        usage_module.review_usage(path, run.id)
    assert error.value.status_code == 422 and error.value.detail == "REVIEW_USAGE_RECORD_INVALID"


def test_row_limit_rejects_instead_of_returning_partial_total(scenario, monkeypatch):
    path, _, run = scenario
    add(scenario)
    monkeypatch.setattr(usage_module, "MAX_RECORDS", 1)
    with pytest.raises(HTTPException) as error:
        usage_module.review_usage(path, run.id)
    assert error.value.detail == "REVIEW_USAGE_LOOKUP_LIMIT"


def test_summed_safe_integer_overflow_is_rejected(scenario):
    path, _, run = scenario
    add(scenario, inputs=usage_module.SAFE_INTEGER)
    add(scenario, inputs=1)
    with pytest.raises(HTTPException) as error:
        usage_module.review_usage(path, run.id)
    assert error.value.detail == "REVIEW_USAGE_RECORD_INVALID"


def test_duplicate_phase_is_not_double_counted(scenario):
    path, _, run = scenario
    start, _ = pair(scenario)
    with sqlite3.connect(path.lookup()) as con:
        con.execute("CREATE TABLE research_saved_review_records "
                    "(attempt_id TEXT,phase INTEGER,run_id TEXT,created_at TEXT,data TEXT)")
        for _ in range(2):
            con.execute("INSERT INTO research_saved_review_records VALUES (?,?,?,?,?)",
                        (start["attempt_id"], 0, run.id, start["created_at"], json.dumps(start)))
    with pytest.raises(HTTPException) as error:
        usage_module.review_usage(path, run.id)
    assert error.value.detail == "REVIEW_USAGE_RECORD_INVALID"


def test_actual_team_route_is_metadata_only_after_content_revocation(tmp_path, monkeypatch):
    generator = route_scenario.__wrapped__(tmp_path, monkeypatch)
    client, run, _, _, base, request, state, allow = next(generator)
    try:
        allow()
        response = client.post(base + "/review-saved", json=request, headers=headers(client))
        assert response.status_code == 200
        denied = assertion(run.sources[0].digest, 1, storage="DENY")
        assert client.post(base + f"/sources/{run.sources[0].id}/usage-policy",
                           json=denied.model_dump(), headers=headers(client)).status_code == 200
        result = client.get(base + "/review-usage")
        assert result.status_code == 200, result.text
        value = result.json()
        assert value["completed_attempts"] == 1
        assert value["usage_by_mode"]["SCRIPTED_TEST_DOUBLE"]["observed_model_calls"] == 1
        assert value["usage_by_mode"]["DACON_RESPONSES"]["observed_model_calls"] == 0
        assert "secretneedle" not in result.text and "source_bindings" not in result.text
        assert state["calls"] == state["factories"] == 1
    finally:
        try:
            next(generator)
        except StopIteration:
            pass
