import json

import pytest
from fastapi.testclient import TestClient

from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.api.agent_demo import demo_router
from trialboard.api.app import create_app

ORIGIN = {"origin": "http://127.0.0.1:5173"}


def payload():
    data = demo_input().model_dump(mode="json")
    data["provenance"] = "user_pdf_export_unverified"
    for s in data["spans"]:
        s["page"] = 1
        s["source_digest"] = "a" * 64
        s["locator"] = None
    return {"input": data, "consent": True}


def client(factory=lambda: ScriptedProvider("repair")):
    app = create_app()
    app.include_router(demo_router(factory, enable_pdf=True))
    return TestClient(app, base_url="http://127.0.0.1")


def test_separate_opt_in_and_fixed_cases_not_silently_enabled():
    for app in [create_app(), create_app(enable_agent_demo=True)]:
        c = TestClient(app, base_url="http://127.0.0.1")
        assert c.get("/api/agent-demo/capabilities").json()["pdf_enabled"] is False
        assert c.post("/api/pdf-agent/run", json=payload(), headers=ORIGIN).status_code == 404
    c = TestClient(create_app(enable_pdf_agent=True), base_url="http://127.0.0.1")
    assert c.get("/api/agent-demo/capabilities").json()["pdf_enabled"] is True
    assert c.post("/api/agent-demo/run", json={}, headers=ORIGIN).status_code == 404


@pytest.mark.parametrize(
    "case", ["consent", "provenance", "digest", "page", "locator", "duplicate", "extra"]
)
def test_rejected_before_provider_creation(case):
    def forbidden():
        pytest.fail("must not create a provider")

    p = payload()
    if case == "consent":
        p["consent"] = 1
    elif case == "provenance":
        p["input"]["provenance"] = "synthetic_fixture"
    elif case == "digest":
        p["input"]["spans"][0]["source_digest"] = "b" * 64
    elif case == "page":
        p["input"]["spans"][0]["page"] = None
    elif case == "locator":
        p["input"]["spans"][0]["locator"] = "https://untrusted.invalid"
    elif case == "duplicate":
        p["input"]["spans"].append(p["input"]["spans"][0])
    else:
        p["api_key"] = "DO_NOT_ECHO"
    r = client(forbidden).post("/api/pdf-agent/run", json=p, headers=ORIGIN)
    assert r.status_code == 422
    assert "DO_NOT_ECHO" not in r.text


def test_pdf_stream_contains_explicit_artifacts_not_provider_reasoning(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    r = client().post("/api/pdf-agent/run", json=payload(), headers=ORIGIN)
    assert r.status_code == 200
    es = [json.loads(s[6:]) for s in r.text.splitlines() if s.startswith("data: ")]
    assert es[0]["case"] == "pdf"
    assert es[-1]["report"]["input"] == payload()["input"]
    items = [i for e in es for i in e.get("items", [])]
    assert {i["kind"] for i in items} >= {"source", "observation", "finding"}
    assert all(set(i) == {"kind", "id", "text", "span_ids"} for i in items)
    assert all(len(i["text"]) <= 1000 for i in items)
    assert list(tmp_path.iterdir()) == []


def test_pdf_origin_and_duplicate_key_body_are_rejected():
    c = client()
    assert c.post("/api/pdf-agent/run", json=payload()).status_code == 403
    assert (
        c.post(
            "/api/pdf-agent/run",
            content='{"consent":true,"consent":false}',
            headers={**ORIGIN, "content-type": "application/json"},
        ).status_code
        == 422
    )
