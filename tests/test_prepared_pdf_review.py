"""No model network: real TEAM identity, temporary PDFs and explicit parser/provider doubles."""

import asyncio
import copy
import json
import sqlite3
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from test_pdf_preparation import post
from test_pdf_preparation import scenario as scenario
from test_project_acl import headers
from test_research_pdf_policy import assertion

from trialboard.agent.provider import ModelError, Reply
from trialboard.api.team_auth import SESSION_COOKIE, TeamDataPath, TeamIdentity, _current_scope
from trialboard.research.model_policy import LazyResearchProvider
from trialboard.research.prepared_pdf_review import (
    PreparedPdfGate,
    PreparedReviewRequest,
    anchor_context,
    resolve_review,
)
from trialboard.research.store import ResearchStore


@pytest.fixture
def prepared(scenario):
    fixture, _, _ = scenario
    value, url, permission = fixture
    artifact = post(scenario).json()
    client, run, database, identity_db, _, _, _, _ = value
    identity = TeamIdentity(identity_db)
    access = identity.authenticate(client.cookies.get(SESSION_COOKIE))
    token = _current_scope.set(access)
    try:
        request = PreparedReviewRequest(model_consent=True,
                    preparation_id=artifact["preparation_id"],
                    preparation_digest=artifact["preparation_digest"], policy_revision=2)
        yield (value, url, permission, artifact, TeamDataPath(database.parent.parent),
               identity, access, request)
    finally:
        _current_scope.reset(token)


def allow(prepared, *, external="ALLOW", revision=1):
    value, url, permission, *_ = prepared
    body = assertion(permission, revision)
    body["external_ai"] = external
    response = value[0].post(url + "/usage-policy", json=body, headers=headers(value[0]))
    assert response.status_code == 200, response.text


def gate_for(prepared):
    value, _, _, _, path, identity, access, request = prepared
    return PreparedPdfGate(path, identity, access, value[1].id, request)


def lazy(gate, after=lambda: None, factory_after=lambda: None):
    counts = {"factories": 0, "calls": 0}

    class Provider:
        mode, model = "SCRIPTED_TEST_DOUBLE", "synthetic-pdf"

        async def complete(self, **kwargs):
            assert kwargs["payload"] == gate.payload
            counts["calls"] += 1
            after()
            return Reply(value={"findings": [{"anchor_id": next(iter(gate.anchors)),
                                             "interpretation": "Synthetic limited observation"}],
                                "questions": [], "conclusion": "NEEDS_EXPERT_REVIEW"},
                         response_id="synthetic", input_tokens=4, output_tokens=6)

    def factory():
        counts["factories"] += 1
        factory_after()
        return Provider()

    return LazyResearchProvider(factory, gate), counts


def call(provider, gate, payload=None):
    return asyncio.run(provider.complete(instructions="Synthetic only", payload=(
        gate.payload if payload is None else payload), schema=gate.schema, max_output_tokens=10))


def test_prepared_revision_one_then_external_allow_revision_two_positive(prepared):
    allow(prepared)
    gate = gate_for(prepared)
    assert gate.artifact["policy_revision"] == 1 and gate.request.policy_revision == 2
    provider, counts = lazy(gate)
    reply = call(provider, gate)
    review = resolve_review(reply.value, gate.anchors)
    assert review["findings"][0]["quote"] == gate.artifact["pages"][0]["text"]
    assert set(gate.payload) == {"preparation_id", "preparation_digest", "pdf_sha256", "segments"}
    assert counts == {"factories": 1, "calls": 1}
    assert provider.actual_calls == 1 and provider.last_usage["input_tokens"] == 4


@pytest.mark.parametrize("external", ["UNKNOWN", "DENY"])
def test_missing_or_denied_pdf_external_rights_block_gate(prepared, external):
    allow(prepared, external=external)
    with pytest.raises(HTTPException) as error:
        gate_for(prepared)
    assert error.value.status_code == 403
    assert prepared[0][6]["calls"] == prepared[0][6]["factories"] == 0


@pytest.mark.parametrize("change", ["expiry", "viewer", "team", "digest", "bytes", "revision"])
def test_fresh_gate_checks_each_call_before_factory(prepared, change):
    allow(prepared)
    gate = gate_for(prepared)
    provider, counts = lazy(gate)
    value, _, _, _, _, _, access, _ = prepared
    if change in ("expiry", "viewer"):
        with sqlite3.connect(value[3]) as con:
            con.execute("UPDATE sessions SET absolute_expires_at=0" if change == "expiry"
                        else "UPDATE memberships SET role='viewer',permission_epoch=2")
    elif change == "team":
        gate.access = replace(access, team_id=str(uuid4()))
    elif change == "digest":
        value[1].sources[0].digest = "f" * 64
        ResearchStore(value[2]).save_run(value[1])
    elif change == "bytes":
        with sqlite3.connect(value[2]) as con:
            con.execute("UPDATE public_pdf_blobs SET content=?", (b"%PDF-tampered",))
    else:
        allow(prepared, revision=2)
    with pytest.raises(ModelError, match="POLICY_DENIED"):
        call(provider, gate)
    assert counts == {"factories": 0, "calls": 0}


@pytest.mark.parametrize("phase", ["factory", "response"])
def test_revoke_after_factory_or_response_rejects_request_or_publication(prepared, phase):
    allow(prepared)
    gate = gate_for(prepared)

    def revoke():
        # Same actual identity and PDF policy API, no implicit source-text authorization.
        allow(prepared, external="DENY", revision=2)

    provider, counts = lazy(gate, **{"factory_after" if phase == "factory" else "after": revoke})
    with pytest.raises(ModelError, match="POLICY_DENIED"):
        call(provider, gate)
    assert counts == {"factories": 1, "calls": 0 if phase == "factory" else 1}


def test_mutated_payload_is_rejected_before_factory(prepared):
    allow(prepared)
    gate = gate_for(prepared)
    provider, counts = lazy(gate)
    body = copy.deepcopy(gate.payload)
    body["segments"][0]["text"] = "arbitrary browser injected body"
    with pytest.raises(ModelError, match="POLICY_DENIED"):
        call(provider, gate, body)
    assert counts == {"factories": 0, "calls": 0}


@pytest.mark.parametrize("change", ["consent", "extra", "revision-bool", "bad-id"])
def test_request_is_exact_and_explicit(prepared, change):
    body = prepared[7].model_dump()
    if change == "consent":
        body["model_consent"] = 1
    elif change == "extra":
        body["text"] = "arbitrary browser body"
    elif change == "revision-bool":
        body["policy_revision"] = True
    else:
        body["preparation_id"] = "arbitrary"
    with pytest.raises(ValueError):
        PreparedReviewRequest.model_validate(body)


def test_unicode_offsets_server_quotes_and_unknown_duplicate_anchors(prepared):
    artifact = copy.deepcopy(prepared[3])
    artifact["pages"] = [{"page": 1, "text": "가😀" * 550}, {"page": 2, "text": ""}]
    payload, anchors, _ = anchor_context(artifact)
    assert [(s["start"], s["end"]) for s in payload["segments"]] == [(0, 1000), (1000, 1100)]
    aid = list(anchors)[1]
    body = {"findings": [{"anchor_id": aid, "interpretation": "Synthetic"}],
            "questions": [], "conclusion": "NEEDS_EXPERT_REVIEW"}
    resolved = resolve_review(body, anchors)["findings"][0]
    assert resolved["quote"] == artifact["pages"][0]["text"][1000:1100]
    assert "box" not in json.dumps(resolved)
    for invalid in ({**body, "findings": body["findings"] * 2},
                    {**body, "findings": [{"anchor_id": "unknown", "interpretation": "x"}]},
                    {**body, "findings": [{**body["findings"][0], "quote": "forged"}]}):
        with pytest.raises(ValueError):
            resolve_review(invalid, anchors)
