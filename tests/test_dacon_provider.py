"""In-memory competition transport tests; no real credentials or paid requests."""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from trialboard.agent.dacon_provider import DACON_MODELS, DaconResponses
from trialboard.agent.engine import Limits, run_agent
from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.provider import ModelError
from trialboard.agent.runtime import runtime_metadata, runtime_provider
from trialboard.api.app import create_app


def response(value=None):
    return {
        "id": "test-response",
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": json.dumps(value or {"ok": True})}],
            }
        ],
        "usage": {"input_tokens": 10, "output_tokens": 4},
    }


def complete(provider):
    return asyncio.run(
        provider.complete(
            instructions="Synthetic test only",
            payload={"example": True},
            schema={"type": "object", "properties": {"ok": {"type": "boolean"}}},
            max_output_tokens=256,
        )
    )


@pytest.mark.parametrize("model", DACON_MODELS)
def test_exact_competition_endpoint_header_schema_and_usage(model):
    requests = []

    def handle(request):
        requests.append(request)
        assert str(request.url) == DaconResponses.endpoint
        assert request.headers["api-key"] == "test-only-placeholder"
        assert "authorization" not in request.headers
        body = json.loads(request.content)
        assert body["model"] == model and body["store"] is False
        assert body["max_output_tokens"] == 256
        assert body["text"]["format"]["schema"]["required"] == ["ok"]
        assert body["text"]["format"]["schema"]["additionalProperties"] is False
        assert "service_tier" not in body and "tools" not in body
        return httpx.Response(
            200,
            json=response(),
            headers={
                "x-team-remaining-quota-tokens": "29999986",
                "x-team-tokens-consumed": "14",
                "x-team-remaining-tokens": "untrusted-private-text",
                "x-team-remaining-requests": "9",
            },
        )

    provider = DaconResponses(
        SecretStr("test-only-placeholder"), model, httpx.MockTransport(handle)
    )
    reply = complete(provider)
    assert reply.value == {"ok": True} and reply.input_tokens == 10
    assert len(requests) == 1 and len(reply.notices) == 3
    assert "untrusted" not in str(reply)
    assert "test-only-placeholder" not in repr(provider) + str(provider.runtime)


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "DACON_AUTH_FAILED"),
        (403, "DACON_QUOTA_EXHAUSTED"),
        (429, "DACON_RATE_LIMITED"),
        (400, "DACON_REQUEST_REJECTED"),
        (404, "DACON_MODEL_OR_ENDPOINT_UNAVAILABLE"),
        (500, "DACON_HTTP_ERROR"),
        (302, "DACON_HTTP_ERROR"),
    ],
)
def test_errors_are_redacted_without_retry_redirect_or_fallback(status, code):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(
            status,
            text="PRIVATE_KEY_AND_SERVER_BODY",
            headers={"location": "https://other.invalid"},
        )

    provider = DaconResponses(SecretStr("placeholder"), transport=httpx.MockTransport(handle))
    with pytest.raises(ModelError, match=f"^{code}$"):
        complete(provider)
    assert len(requests) == 1


def test_missing_key_and_unknown_models_fail_without_codex(monkeypatch):
    monkeypatch.delenv("TRIALBOARD_DACON_API_KEY", raising=False)
    monkeypatch.delenv("TRIALBOARD_DACON_MODEL", raising=False)
    monkeypatch.setattr(
        "trialboard.agent.runtime.CodexChatGPT",
        lambda *a: pytest.fail("must not use personal Codex"),
    )
    assert runtime_metadata("dacon")["configured"] is False
    with pytest.raises(ValueError, match="DACON_API_KEY_REQUIRED"):
        runtime_provider("dacon")
    with pytest.raises(ValueError, match="DACON_MODEL_NOT_ALLOWED"):
        DaconResponses(SecretStr("placeholder"), "unapproved-model")
    with pytest.raises(ValueError, match="RUNTIME_PROVIDER_NOT_ALLOWED"):
        runtime_provider("automatic")


def test_capabilities_reveal_runtime_not_key_and_missing_key_does_not_call_codex(monkeypatch):
    monkeypatch.delenv("TRIALBOARD_DACON_API_KEY", raising=False)
    monkeypatch.setattr(
        "trialboard.agent.runtime.CodexChatGPT",
        lambda *a: pytest.fail("must not use personal Codex"),
    )
    client = TestClient(
        create_app(enable_agent_demo=True, agent_provider="dacon"), base_url="http://127.0.0.1"
    )
    caps = client.get("/api/agent-demo/capabilities").json()
    assert caps["provider"] == "DACON_RESPONSES" and caps["configured"] is False
    result = client.post(
        "/api/agent-demo/run",
        json={"case": "public", "consent": True},
        headers={"origin": "http://127.0.0.1:5173"},
    )
    assert '"type": "error"' in result.text
    assert '"type": "result"' not in result.text


def test_competition_report_engine_contract_with_synthetic_test_double():
    # Mode is deliberately relabelled only inside this isolated contract test.
    provider = ScriptedProvider("normal")
    provider.mode = "DACON_RESPONSES"
    provider.model = "gpt-5.6-terra"
    report = asyncio.run(run_agent(demo_input(), provider, Limits(max_calls=2, max_repairs=0)))
    assert report.execution_mode == "DACON_RESPONSES"
    assert report.status == "DRAFT_FOR_EXPERT_REVIEW"
    assert len(report.calls) == 2


@pytest.mark.parametrize("kind", ["incomplete", "refusal", "malformed", "too_large"])
def test_invalid_output_never_becomes_success(kind):
    def handle(request):
        data = response()
        if kind == "incomplete":
            data["status"] = "incomplete"
        elif kind == "refusal":
            data["output"][0]["content"] = [{"type": "refusal"}]
        elif kind == "malformed":
            data["output"][0]["content"][0]["text"] = "{"
        else:
            return httpx.Response(200, content=b"x" * 256001)
        return httpx.Response(200, json=data)

    with pytest.raises(ModelError):
        complete(DaconResponses(SecretStr("placeholder"), transport=httpx.MockTransport(handle)))
