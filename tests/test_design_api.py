"""Opt-in loopback transport around the existing deterministic design pipeline."""

import base64
import json

import pytest
from fastapi.testclient import TestClient
from test_design_compare import brief_for
from test_field_revalidation import encode, revise, sample

from trialboard.api.app import create_app
from trialboard.api.designs import DESIGN_BODY_BYTES, execute_design
from trialboard.api.models import MAX_BODY_BYTES


def payload(imported=False):
    f = sample(imported=imported)
    return f, {
        "brief": brief_for(f),
        "review_json": encode(f["review"]).decode(),
        "source_json": encode(f["source"]).decode(),
        "pdf_base64": base64.b64encode(f["pdf"]).decode(),
        "agent_json": f["agent"].decode() if f["agent"] else None,
        "ai_json": None,
        "context": f["context"],
    }


def client(enabled=True):
    return TestClient(create_app(enable_designs=enabled), base_url="http://127.0.0.1")


def test_disabled_by_default_and_requires_explicit_startup_flag():
    c = client(False)
    assert c.get("/api/design-comparisons/capabilities").json()["enabled"] is False
    assert c.post("/api/design-comparisons", json={}).status_code == 404
    assert c.get("/health").json()["evidence_mode"] == "SYNTHETIC_ONLY"


@pytest.mark.parametrize("imported", [False, True])
def test_local_execution_matches_bound_inputs_without_models_or_persistence(
    imported, tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    _, p = payload(imported)
    c = client()
    response = c.post("/api/design-comparisons", json=p)
    assert response.status_code == 200
    r = response.json()
    assert r["brief"]["question"] == p["brief"]["question"]
    assert r["clinical_approval"] is False and r["model_calls"] == 0
    assert len(r["simulations"]) == 4
    assert response.headers["cache-control"] == "no-store"
    assert list(tmp_path.iterdir()) == []
    assert c.get("/health").json()["evidence_mode"] == "LOCAL_PDF_OPT_IN"


def test_user_hold_still_blocks_through_transport():
    f, p = payload()
    revise(f["review"]["rows"][0]["fields"]["reported_rate"], decision="held")
    p["review_json"] = encode(f["review"]).decode()
    p["brief"] = brief_for(f)
    r = client().post("/api/design-comparisons", json=p).json()
    assert r["status"] == "BLOCKED_EVIDENCE_LINK" and not r["simulations"]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda p: p.update(pdf_base64="NOT A PDF ENCODING"),
        lambda p: p.update(pdf_base64=base64.b64encode(b"%PDF-DIFFERENT").decode()),
        lambda p: p.update(context=None),
        lambda p: p.update(api_key="MUST_NOT_BE_ECHOED"),
        lambda p: p["brief"].update(repetitions=1000000),
        lambda p: p["brief"].update(review_content_digest="0" * 64),
        lambda p: p.update(ai_json='{"secret":"MUST_NOT_BE_ECHOED"}'),
    ],
)
def test_invalid_requests_are_sanitized_and_do_not_poison_next_run(mutation):
    _, p = payload()
    mutation(p)
    c = client()
    response = c.post("/api/design-comparisons", json=p)
    assert response.status_code == 422
    assert response.json() == {"error": {"code": "DESIGN_INPUT_MISMATCH"}}
    assert c.post("/api/design-comparisons", json=payload()[1]).status_code == 200


def test_host_origin_and_transport_bounds_remain_local():
    c = client()
    assert (
        c.post(
            "/api/design-comparisons", json={}, headers={"origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert (
        c.post("/api/design-comparisons", json={}, headers={"host": "evil.example"}).status_code
        == 400
    )
    assert (
        c.post(
            "/api/design-comparisons", content="{}", headers={"content-type": "text/plain"}
        ).status_code
        == 415
    )
    assert (
        c.post(
            "/api/design-comparisons",
            content="{}",
            headers={
                "content-type": "application/json",
                "content-length": str(DESIGN_BODY_BYTES + 1),
            },
        ).status_code
        == 413
    )
    assert (
        c.post(
            "/api/reviews",
            content="{}",
            headers={"content-type": "application/json", "content-length": str(MAX_BODY_BYTES + 1)},
        ).status_code
        == 413
    )


@pytest.mark.parametrize(
    "raw", [b'{"brief":{},"brief":{}}', b'{"__proto__":{}}', b'{"x":NaN}', b'{"x":"\\ud800"}']
)
def test_strict_transport_parser(raw):
    c = client()
    assert (
        c.post(
            "/api/design-comparisons", content=raw, headers={"content-type": "application/json"}
        ).status_code
        == 422
    )


def test_larger_outer_payload_does_not_raise_nested_json_file_limits():
    _, p = payload()
    p["agent_json"] = " " * (8 * 1024 * 1024 + 1)
    with pytest.raises(ValueError):
        execute_design(json.dumps(p).encode())
