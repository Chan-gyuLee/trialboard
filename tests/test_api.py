import asyncio
import importlib
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock

import pytest
from fastapi.testclient import TestClient

from trialboard.api.app import create_app
from trialboard.api.boundary import LocalBoundary
from trialboard.api.models import MAX_BODY_BYTES, ExecutionInput
from trialboard.review.engine import run_review
from trialboard.review.example import example_designs, example_scenarios, make_example
from trialboard.review.models import ReviewReport
from trialboard.review.report import to_markdown
from trialboard.serialization import sha256_json

api_module = importlib.import_module("trialboard.api.app")


@pytest.fixture
def client():
    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        yield client


def test_health_defaults_and_openapi(client):
    assert client.get("/health").json()["evidence_mode"] == "SYNTHETIC_ONLY"
    response = client.get("/api/reviews/defaults")
    assert response.headers["cache-control"] == "no-store"
    packet = response.json()
    payload = ExecutionInput.model_validate(packet["input"])
    assert payload.work_units == 120_000
    assert packet["limits"]["work_units"] == 1_000_000
    schema = client.get("/openapi.json").json()
    assert "/api/reviews" in schema["paths"]
    assert client.get("/docs").status_code == 200


@pytest.mark.parametrize(
    ("mode", "status", "issues"),
    [
        ("normal", "DRAFT_FOR_REVIEW", set()),
        ("denominator-error", "PARTIAL_ABSTENTION", {"RECORD_VALUE_MISMATCH", "EVIDENCE_GAP"}),
        ("missing-evidence", "PARTIAL_ABSTENTION", {"EVIDENCE_GAP"}),
    ],
)
def test_modes_match_engine_exactly_and_export_replayable_inputs(client, mode, status, issues):
    response = client.post("/api/reviews", json={"mode": mode, "repetitions": 300})
    assert response.status_code == 200, response.text
    body = response.json()
    report = body["report"]
    expected = run_review(
        make_example(mode), example_scenarios(), example_designs(), repetitions=300
    )
    assert report == expected.model_dump(mode="json")
    assert report["status"] == status
    assert {i["code"] for i in report["issues"]} == issues
    assert body["execution_mode"] == "LIVE_COMPUTE_SYNTHETIC"
    assert body["persisted"] is False
    assert body["elapsed_ms"] >= 0
    assert body["markdown"] == to_markdown(ReviewReport.model_validate(report))
    assert len(report["simulations"]) == 6  # Error/missing modes cannot erase issues.
    canonical = {
        "request": body["evidence_input"],
        "scenarios": [
            s.to_scenario().model_dump(mode="json")
            for s in ExecutionInput.model_validate(body["input"]).scenarios
        ],
        "designs": [
            d.model_dump(mode="json")
            for d in ExecutionInput.model_validate(body["input"]).to_designs()
        ],
        "seed": body["input"]["seed"],
        "repetitions": body["input"]["repetitions"],
    }
    assert report["input_digest"] == sha256_json(canonical)


def test_new_execution_ids_but_same_report_for_same_input(client):
    a = client.post("/api/reviews", json={"repetitions": 100}).json()
    b = client.post("/api/reviews", json=a["input"]).json()
    assert a["execution_id"] != b["execution_id"]
    assert a["report"] == b["report"]
    assert a["markdown"] == b["markdown"]


def test_changed_parameters_recompute_not_choose_saved_results(client):
    payload = client.get("/api/reviews/defaults").json()["input"]
    payload.update(repetitions=100, per_arm=[12, 48])
    scenario = payload["scenarios"][0]
    scenario.update(response=[1, 0], adverse_event=[0, 0])
    payload["scenarios"] = [scenario]
    a = client.post("/api/reviews", json=payload).json()
    scenario["response"] = [0, 1]
    b = client.post("/api/reviews", json=payload).json()
    assert a["report"]["input_digest"] != b["report"]["input_digest"]
    for packet, winner in ((a, "dose_a"), (b, "dose_b")):
        simulations = packet["report"]["simulations"]
        assert [s["total_sample_size"] for s in simulations] == [24, 96]
        assert all(s["selection_probability"][winner] == 1 for s in simulations)


@pytest.mark.parametrize(
    "change",
    [
        {"seed": True},
        {"seed": "42"},
        {"seed": -1},
        {"seed": 2**32},
        {"repetitions": 100.0},
        {"repetitions": "100"},
        {"repetitions": 99},
        {"repetitions": 100_001},
        {"repetitions": 100_000},  # three defaults exceed budget
        {"mode": "real-patient"},
        {"mode": None},
        {"scenarios": []},
        {"per_arm": [20, 20]},
        {"per_arm": [50, 20]},
        {"per_arm": [1, 20]},
        {"per_arm": [20, 501]},
        {"per_arm": [20, 30, 40]},
        {"per_arm": [True, 20]},
        {"per_arm": ["20", 40]},
        {"patient_data": "not accepted"},
    ],
)
def test_invalid_inputs(client, change):
    response = client.post("/api/reviews", json=change)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_INPUT"


@pytest.mark.parametrize(
    "change",
    [
        {"response": [-0.1, 0.5]},
        {"response": [0.5, 1.1]},
        {"response": [0.1]},
        {"response": [True, 0.5]},
        {"response": ["0.2", 0.5]},
        {"adverse_event": [0.2, 0.3, 0.4]},
        {"adverse_event_penalty": 11},
        {"adverse_event_penalty": False},
        {"maximum_adverse_event_rate": -1},
        {"id": "bad id"},
        {"id": "a" * 65},
        {"label": "x" * 121},
        {"rationale": "x" * 501},
        {"arms": ["dose_a", "dose_c"]},
        {"provenance": "clinical"},
    ],
)
def test_invalid_scenarios(client, change):
    scenario = ExecutionInput().scenarios[0].model_dump(mode="json")
    scenario.update(change)
    response = client.post("/api/reviews", json={"scenarios": [scenario]})
    assert response.status_code == 422


def test_duplicate_ids_and_too_many_scenarios(client):
    scenario = ExecutionInput().scenarios[0].model_dump(mode="json")
    for scenarios in ([scenario, scenario], [{**scenario, "id": f"s{i}"} for i in range(6)]):
        assert client.post("/api/reviews", json={"scenarios": scenarios}).status_code == 422


def test_exact_work_budget_and_actionable_budget_error(client):
    scenario = ExecutionInput().scenarios[0].model_dump(mode="json")
    payload = {
        "scenarios": [{**scenario, "id": f"s{i}"} for i in range(5)],
        "repetitions": 50_000,
        "per_arm": [499, 500],
    }
    assert ExecutionInput.model_validate(payload).work_units == 1_000_000
    assert client.post("/api/reviews", json=payload).status_code == 200
    payload["repetitions"] += 1
    response = client.post("/api/reviews", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["type"] == "work_budget_exceeded"


def test_high_repetition_single_scenario_is_allowed(client):
    scenario = ExecutionInput().scenarios[0].model_dump(mode="json")
    assert (
        client.post(
            "/api/reviews", json={"scenarios": [scenario], "repetitions": 100_000}
        ).status_code
        == 200
    )


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
def test_nonfinite_json_safely_rejected_without_error_serialization_failure(client, token):
    scenario = ExecutionInput().scenarios[0].model_dump_json()
    # Insert nonstandard JSON numbers, which Python's default JSON decoder accepts.
    raw = (
        '{"scenarios":['
        + scenario.replace('"response":[0.3,0.32]', '"response":[' + token + ",0.32]")
        + "]}"
    )
    assert token in raw
    response = client.post(
        "/api/reviews", content=raw, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert token not in response.text


def test_malformed_json_and_values_are_not_echoed(client):
    response = client.post("/api/reviews", json={"seed": "DO_NOT_ECHO_PRIVATE_CONTENT"})
    assert "DO_NOT_ECHO_PRIVATE_CONTENT" not in response.text
    assert (
        client.post(
            "/api/reviews", content="{", headers={"Content-Type": "application/json"}
        ).status_code
        == 422
    )
    assert client.post("/api/reviews", json=None).status_code in (415, 422)


def test_body_and_media_limits(client):
    assert client.post("/api/reviews", content="{}").status_code == 415
    assert (
        client.post(
            "/api/reviews",
            content="x" * (MAX_BODY_BYTES + 1),
            headers={"Content-Type": "application/json"},
        ).status_code
        == 413
    )
    assert (
        client.post(
            "/api/reviews",
            content="{}",
            headers={"Content-Type": "application/json", "Content-Length": "nope"},
        ).status_code
        == 400
    )


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "http://localhost.evil:5173"])
def test_foreign_origins_cannot_compute(client, origin):
    response = client.post("/api/reviews", json={}, headers={"Origin": origin})
    assert response.status_code == 403


def test_host_protection_and_local_cors(client):
    assert client.get("/health", headers={"Host": "evil.example"}).status_code == 400
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    response = client.options("/api/reviews", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    response = client.post(
        "/api/reviews", json={"repetitions": 100}, headers={"Origin": "http://127.0.0.1"}
    )
    assert response.status_code == 200


def test_failure_is_safe_and_capacity_released(client, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("DO_NOT_ECHO_PRIVATE_CONTENT")

    with monkeypatch.context() as patch:
        patch.setattr(api_module, "run_review", fail)
        for _ in range(3):
            response = client.post("/api/reviews", json={"repetitions": 100})
            assert response.status_code == 500
            assert response.json()["error"]["code"] == "EXECUTION_FAILED"
            assert "DO_NOT_ECHO_PRIVATE_CONTENT" not in response.text
    assert client.post("/api/reviews", json={"repetitions": 100}).status_code == 200


def test_concurrency_cap_health_responsive_and_recovery(client, monkeypatch):
    both_started, release, lock = Event(), Event(), Lock()
    count = 0

    def blocked(*args, **kwargs):
        nonlocal count
        with lock:
            count += 1
            if count == 2:
                both_started.set()
        assert release.wait(timeout=10)
        return run_review(*args, **kwargs)

    monkeypatch.setattr(api_module, "run_review", blocked)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(client.post, "/api/reviews", json={"repetitions": 100}) for _ in range(2)
        ]
        try:
            assert both_started.wait(timeout=5)
            assert client.get("/health").status_code == 200
            busy = client.post("/api/reviews", json={"repetitions": 100})
            assert busy.status_code == 429
            assert busy.headers["retry-after"] == "1"
        finally:
            release.set()
        assert all(f.result(timeout=5).status_code == 200 for f in futures)
    assert client.post("/api/reviews", json={"repetitions": 100}).status_code == 200


@pytest.mark.parametrize("declared", [None, "2"])
def test_streamed_body_cannot_bypass_limit(declared):
    async def check():
        sent = []
        headers = [(b"content-type", b"application/json")]
        if declared:
            headers.append((b"content-length", declared.encode()))
        chunks = iter(
            [
                {"type": "http.request", "body": b"x" * MAX_BODY_BYTES, "more_body": True},
                {"type": "http.request", "body": b"x", "more_body": False},
            ]
        )

        async def receive():
            return next(chunks)

        async def send(message):
            sent.append(message)

        async def unreachable(*args):
            pytest.fail("oversized stream must not reach the JSON parser")

        await LocalBoundary(unreachable)(
            {"type": "http", "method": "POST", "scheme": "http", "headers": headers},
            receive,
            send,
        )
        assert sent[0]["status"] == 413

    asyncio.run(check())
