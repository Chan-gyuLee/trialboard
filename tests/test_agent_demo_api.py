import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from trialboard.agent.engine import Limits, run_agent
from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.models import AgentReport
from trialboard.api.agent_demo import demo_router
from trialboard.api.app import create_app

ORIGIN = {"origin": "http://127.0.0.1:5173"}


def client(factory=lambda: ScriptedProvider("repair")):
    app = create_app()
    app.include_router(demo_router(factory))
    return TestClient(app, base_url="http://127.0.0.1")


def events(response):
    return [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]


def test_live_route_requires_separate_startup_opt_in():
    c = TestClient(create_app(), base_url="http://127.0.0.1")
    assert c.get("/api/agent-demo/capabilities").json()["enabled"] is False
    assert (
        c.post(
            "/api/agent-demo/run", json={"case": "public", "consent": True}, headers=ORIGIN
        ).status_code
        == 404
    )
    c = TestClient(create_app(enable_agent_demo=True), base_url="http://127.0.0.1")
    capabilities = c.get("/api/agent-demo/capabilities").json()
    assert capabilities["enabled"] is True
    assert capabilities["max_calls"] == 4
    assert capabilities["persisted"] is False
    assert capabilities["case_limits"] == {
        "public": {"max_calls": 2, "max_repairs": 0},
        "synthetic": {"max_calls": 4, "max_repairs": 1},
    }


def test_streams_real_engine_stage_metadata_and_one_final_result_without_persistence(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    response = client().post(
        "/api/agent-demo/run", json={"case": "synthetic", "consent": True}, headers=ORIGIN
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    es = events(response)
    assert es[0]["type"] == "started" and es[-1]["type"] == "result"
    assert [e["sequence"] for e in es] == list(range(1, len(es) + 1))
    assert len({e["run_id"] for e in es}) == 1
    assert es[-1]["report"]["status"] == "DRAFT_FOR_EXPERT_REVIEW"
    assert any(e.get("stage") == "REVISE" and e["state"] == "COMPLETED" for e in es)
    assert list(tmp_path.iterdir()) == []
    assert "reasoning" not in [k for e in es if e["type"] == "progress" for k in e]


@pytest.mark.parametrize(
    "patch",
    [
        {"consent": False},
        {"consent": 1},
        {"consent": "true"},
        {"case": "https://private.invalid"},
        {"prompt": "arbitrary"},
        {"api_key": "MUST_NOT_BE_ECHOED"},
    ],
)
def test_rejects_unconsented_or_arbitrary_input_before_provider_creation(patch):
    def forbidden():
        pytest.fail("provider must not be created")

    response = client(forbidden).post(
        "/api/agent-demo/run", json={"case": "synthetic", "consent": True, **patch}, headers=ORIGIN
    )
    assert response.status_code == 422
    assert "MUST_NOT_BE_ECHOED" not in response.text


@pytest.mark.parametrize("headers", [{}, {"origin": "https://attacker.invalid"}])
def test_missing_or_external_origin_cannot_start_model(headers):
    response = client().post(
        "/api/agent-demo/run", json={"case": "public", "consent": True}, headers=headers
    )
    assert response.status_code == 403


def test_provider_failure_is_sanitized_and_releases_slot_without_fallback():
    def broken():
        raise ValueError("DO_NOT_LEAK_DIAGNOSTICS")

    c = client(broken)
    for _ in range(2):
        response = c.post(
            "/api/agent-demo/run", json={"case": "public", "consent": True}, headers=ORIGIN
        )
        es = events(response)
        assert es[-1]["type"] == "error"
        assert "DO_NOT_LEAK_DIAGNOSTICS" not in response.text
        assert not any(e["type"] == "result" for e in es)


def test_progress_counts_match_engine_artifacts():
    progress = []
    report = asyncio.run(
        run_agent(
            demo_input(),
            ScriptedProvider("repair"),
            Limits(max_calls=4, max_repairs=1),
            on_progress=progress.append,
        )
    )
    assert [e["state"] for e in progress if e["stage"] == "REVISE"] == ["STARTED", "COMPLETED"]
    assert [e["observations"] for e in progress if "observations" in e] == [4, 4]
    assert len(report.calls) == 4
    assert progress[-1]["stage"] == "CRITIQUE" and progress[-1]["state"] == "COMPLETED"


def test_public_excerpt_stops_after_one_extraction_and_critique(monkeypatch):
    import trialboard.api.agent_demo as module

    observed = []
    record = AgentReport.model_validate_json(
        (Path(__file__).parents[1] / "web/public/data/agent/public-record.json").read_text()
    )

    async def capture(data, provider, limits, **kwargs):
        observed.append((data.provenance, limits.max_calls, limits.max_repairs))
        return record

    monkeypatch.setattr(module, "run_agent", capture)
    response = client().post(
        "/api/agent-demo/run", json={"case": "public", "consent": True}, headers=ORIGIN
    )
    assert events(response)[-1]["type"] == "result"
    assert observed == [("curated_public_excerpt", 2, 0)]


def test_concurrent_request_rejected_and_disconnect_cancels_worker_then_releases_slot():
    async def scenario():
        entered, cancelled = asyncio.Event(), asyncio.Event()

        class SlowProvider(ScriptedProvider):
            async def complete(self, **kwargs):
                entered.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()

        app = create_app()
        app.include_router(demo_router(SlowProvider))

        async def request(disconnect, messages):
            sent = False

            async def receive():
                nonlocal sent
                if not sent:
                    sent = True
                    return {
                        "type": "http.request",
                        "body": b'{"case":"synthetic","consent":true}',
                        "more_body": False,
                    }
                await disconnect.wait()
                return {"type": "http.disconnect"}

            async def send(message):
                messages.append(message)

            await app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0", "spec_version": "2.3"},
                    "http_version": "1.1",
                    "method": "POST",
                    "scheme": "http",
                    "path": "/api/agent-demo/run",
                    "raw_path": b"/api/agent-demo/run",
                    "query_string": b"",
                    "root_path": "",
                    "headers": [
                        (b"host", b"127.0.0.1"),
                        (b"content-type", b"application/json"),
                        (b"origin", b"http://127.0.0.1:5173"),
                    ],
                    "client": ("127.0.0.1", 1234),
                    "server": ("127.0.0.1", 8000),
                },
                receive,
                send,
            )

        disconnect = asyncio.Event()
        first = asyncio.create_task(request(disconnect, []))
        await asyncio.wait_for(entered.wait(), 2)
        rejected = []
        await asyncio.wait_for(request(asyncio.Event(), rejected), 2)
        assert rejected[0]["status"] == 429
        disconnect.set()
        await asyncio.wait_for(first, 2)
        assert cancelled.is_set()
        entered.clear()
        next_disconnect = asyncio.Event()
        messages = []
        following = asyncio.create_task(request(next_disconnect, messages))
        await asyncio.wait_for(entered.wait(), 2)
        assert messages[0]["status"] == 200
        next_disconnect.set()
        await asyncio.wait_for(following, 2)

    asyncio.run(scenario())
