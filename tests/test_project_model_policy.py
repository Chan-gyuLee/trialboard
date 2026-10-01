"""Synthetic TEAM model-policy gates; no network or real provider credentials."""

import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from test_project_acl import headers
from test_team_auth import ORIGIN, collaboration_payload, login, make_team_app

from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.provider import ModelError
from trialboard.api.agent_demo import PdfAgentRequest
from trialboard.api.proposals import ProposalRequest


class CountingFailure:
    mode = "DACON_RESPONSES"
    model = "fake-model"

    def __init__(self):
        self.calls = 0

    async def complete(self, **_kwargs):
        self.calls += 1
        raise ModelError("SYNTHETIC_FAILURE")


def pdf_input(body):
    source = json.loads(body["bundle_json"])["source"]
    value = demo_input().model_dump(mode="json")
    value["provenance"] = "user_pdf_export_unverified"
    value["spans"] = [
        {
            **span,
            "id": source["pages"][0]["spans"][index]["id"],
            "source_digest": source["sha256"],
            "page": 1,
            "text": source["pages"][0]["spans"][index]["text"],
            "locator": None,
        }
        for index, span in enumerate(value["spans"])
    ]
    return value


def binding(saved):
    return {
        "project_id": saved["project_id"],
        "review_revision": saved["revision"],
        "pdf_digest": saved["pdf_digest"],
        "policy_revision": saved["usage_policy"]["policy_revision"],
    }


def post_pdf(client, data, model_binding=None, *, public_authorized_non_sensitive=True):
    body = {
        "input": data,
        "consent": True,
        "public_authorized_non_sensitive": public_authorized_non_sensitive,
    }
    if model_binding is not None:
        body["model_binding"] = model_binding
    return client.post("/api/pdf-agent/run", json=body, headers=headers(client))


def allow_project(client, *, title="Synthetic team document"):
    body = collaboration_payload()
    body["title"] = title
    body["usage_policy"]["external_ai"] = "ALLOW"
    response = client.post("/api/projects", json=body, headers=headers(client))
    assert response.status_code == 200, response.text
    return body, response.json()


def proposal_input(saved, *, pdf_base64=None):
    from test_design_api import payload

    _, body = payload(imported=True)
    body.pop("brief")
    body.pop("ai_json")
    body.update(
        consent=True,
        constraints={"objective": "synthetic comparison", "max_per_arm": 80},
        public_authorized_non_sensitive=True,
        model_binding=binding(saved),
    )
    if pdf_base64 is not None:
        body["pdf_base64"] = pdf_base64
    return body


def test_public_attestation_rejects_coercion_but_preserves_legacy_optional():
    from test_design_api import payload

    pdf_body = {"input": pdf_input(collaboration_payload()), "consent": True}
    _, proposal_body = payload(imported=True)
    proposal_body.pop("brief")
    proposal_body.pop("ai_json")
    proposal_body.update(
        consent=True,
        constraints={"objective": "synthetic comparison", "max_per_arm": 80},
    )

    for request_type, body in (
        (PdfAgentRequest, pdf_body),
        (ProposalRequest, proposal_body),
    ):
        assert request_type.model_validate(body).public_authorized_non_sensitive is None
        assert (
            request_type.model_validate(
                {**body, "public_authorized_non_sensitive": True}
            ).public_authorized_non_sensitive
            is True
        )
        for value in (False, 1, 1.0, "true", "1"):
            with pytest.raises(ValidationError):
                request_type.model_validate(
                    {**body, "public_authorized_non_sensitive": value}
                )


def test_team_pdf_gate_denies_unbound_wrong_or_nonallowed_before_provider_creation(
    tmp_path, monkeypatch
):
    provider = CountingFailure()
    factories = []
    monkeypatch.setattr(
        "trialboard.agent.runtime.runtime_provider",
        lambda *_: factories.append(True) or provider,
    )
    app, _, _ = make_team_app(
        tmp_path, enable_pdf_agent=True, enable_evidence_scout=True
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        body = collaboration_payload()
        saved = client.post("/api/projects", json=body, headers=headers(client)).json()
        data = pdf_input(body)
        assert post_pdf(client, data).status_code == 403
        wrong = {**binding(saved), "pdf_digest": "f" * 64}
        assert post_pdf(client, data, wrong).status_code == 403
        assert post_pdf(client, data, binding(saved)).status_code == 403
        assert factories == [] and provider.calls == 0


def test_team_pdf_gate_allows_exact_policy_and_rejects_tampered_excerpt(tmp_path, monkeypatch):
    provider = CountingFailure()
    factories = []
    monkeypatch.setattr(
        "trialboard.agent.runtime.runtime_provider",
        lambda *_: factories.append(True) or provider,
    )
    app, _, _ = make_team_app(
        tmp_path, enable_pdf_agent=True, enable_evidence_scout=True
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        body = collaboration_payload()
        body["usage_policy"]["external_ai"] = "ALLOW"
        saved = client.post("/api/projects", json=body, headers=headers(client)).json()
        data = pdf_input(body)
        omitted = {
            "input": data,
            "consent": True,
            "model_binding": binding(saved),
        }
        assert client.post(
            "/api/pdf-agent/run", json=omitted, headers=headers(client)
        ).status_code == 403
        assert post_pdf(
            client,
            data,
            binding(saved),
            public_authorized_non_sensitive=None,
        ).status_code == 403
        for value in (False, 1, 1.0, "true", "1"):
            blocked = post_pdf(
                client,
                data,
                binding(saved),
                public_authorized_non_sensitive=value,
            )
            assert blocked.status_code == 422
        assert factories == [] and provider.calls == 0
        tampered = json.loads(json.dumps(data))
        tampered["spans"][0]["text"] += " changed"
        assert post_pdf(client, tampered, binding(saved)).status_code == 403
        assert factories == [] and provider.calls == 0
        response = post_pdf(client, data, binding(saved))
        assert response.status_code == 200
        assert len(factories) == provider.calls == 1
        assert '"status": "FAILED"' in response.text


def test_team_proposal_requires_actual_pdf_digest_before_provider_creation(
    tmp_path, monkeypatch
):
    from test_design_proposal import Proposer

    provider = Proposer()
    factories = []
    monkeypatch.setattr(
        "trialboard.agent.runtime.runtime_provider",
        lambda *_: factories.append(True) or provider,
    )
    app, _, _ = make_team_app(
        tmp_path,
        enable_designs=True,
        enable_pdf_agent=True,
        enable_evidence_scout=True,
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        _, saved = allow_project(client)
        omitted = proposal_input(saved)
        omitted.pop("public_authorized_non_sensitive")
        assert client.post(
            "/api/design-proposals", json=omitted, headers=headers(client)
        ).status_code == 403
        explicit_none = proposal_input(saved)
        explicit_none["public_authorized_non_sensitive"] = None
        assert client.post(
            "/api/design-proposals", json=explicit_none, headers=headers(client)
        ).status_code == 403
        for value in (False, 1, 1.0, "true", "1"):
            invalid = proposal_input(saved)
            invalid["public_authorized_non_sensitive"] = value
            blocked = client.post(
                "/api/design-proposals", json=invalid, headers=headers(client)
            )
            assert blocked.status_code == 422
        assert factories == [] and provider.calls == []
        wrong = proposal_input(saved, pdf_base64="JVBERi1XUk9ORw==")
        blocked = client.post("/api/design-proposals", json=wrong, headers=headers(client))
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "MODEL_PROJECT_BINDING_MISMATCH"
        assert factories == [] and provider.calls == []

        allowed = client.post(
            "/api/design-proposals", json=proposal_input(saved), headers=headers(client)
        )
        assert allowed.status_code == 200
        assert len(factories) == len(provider.calls) == 1
        assert '"status": "AWAITING_REVIEW"' in allowed.text


class MutatingProvider(ScriptedProvider):
    def __init__(self, mutate):
        super().__init__()
        self.mutate = mutate
        self.actual_calls = 0

    async def complete(self, **kwargs):
        self.actual_calls += 1
        reply = await super().complete(**kwargs)
        if self.actual_calls == 1:
            self.mutate()
        return reply


def test_role_epoch_revocation_after_first_call_prevents_critique(tmp_path, monkeypatch):
    holder = {}
    monkeypatch.setattr("trialboard.agent.runtime.runtime_provider", lambda *_: holder["provider"])
    app, identity_db, _ = make_team_app(
        tmp_path, enable_pdf_agent=True, enable_evidence_scout=True
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        body = collaboration_payload()
        body["usage_policy"]["external_ai"] = "ALLOW"
        saved = client.post("/api/projects", json=body, headers=headers(client)).json()

        def revoke():
            with sqlite3.connect(identity_db) as con:
                con.execute(
                    "UPDATE memberships SET role='viewer',permission_epoch=permission_epoch+1"
                )

        holder["provider"] = MutatingProvider(revoke)
        response = post_pdf(client, pdf_input(body), binding(saved))
        assert response.status_code == 200
        assert holder["provider"].actual_calls == 1
        assert '"status": "FAILED"' in response.text
        assert "MODEL_IDENTITY_INVALIDATED" in response.text


def test_policy_change_after_first_call_prevents_critique_and_releases_slot(
    tmp_path, monkeypatch
):
    holder = {}
    monkeypatch.setattr("trialboard.agent.runtime.runtime_provider", lambda *_: holder["provider"])
    app, _, storage = make_team_app(
        tmp_path, enable_pdf_agent=True, enable_evidence_scout=True
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        body = collaboration_payload()
        body["usage_policy"]["external_ai"] = "ALLOW"
        saved = client.post("/api/projects", json=body, headers=headers(client)).json()
        team_id = client.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"

        def deny():
            with sqlite3.connect(database) as con:
                current = con.execute(
                    "SELECT * FROM project_usage_policy_versions WHERE project_id=?",
                    (saved["project_id"],),
                ).fetchone()
                con.execute(
                    "INSERT INTO project_usage_policy_versions "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (current[0], 2, current[2], current[3], current[4], "DENY", *current[6:]),
                )
                con.execute(
                    "UPDATE project_usage_policy_heads SET policy_revision=2 WHERE project_id=?",
                    (saved["project_id"],),
                )

        first = MutatingProvider(deny)
        holder["provider"] = first
        response = post_pdf(client, pdf_input(body), binding(saved))
        assert response.status_code == 200 and first.actual_calls == 1
        assert "MODEL_EXTERNAL_AI_NOT_ALLOWED" in response.text
        holder["provider"] = CountingFailure()
        blocked = post_pdf(client, pdf_input(body), binding(saved))
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "MODEL_EXTERNAL_AI_NOT_ALLOWED"
        assert holder["provider"].calls == 0


def test_own_project_private_transition_after_first_call_blocks_followup(
    tmp_path, monkeypatch
):
    holder = {}
    monkeypatch.setattr("trialboard.agent.runtime.runtime_provider", lambda *_: holder["provider"])
    app, _, storage = make_team_app(
        tmp_path, enable_pdf_agent=True, enable_evidence_scout=True
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        body, saved = allow_project(client)
        team_id = client.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"

        def restrict():
            with sqlite3.connect(database) as con:
                con.execute(
                    "UPDATE project_access_policies "
                    "SET sharing_scope='restricted',acl_revision=acl_revision+1 "
                    "WHERE project_id=?",
                    (saved["project_id"],),
                )

        holder["provider"] = MutatingProvider(restrict)
        response = post_pdf(client, pdf_input(body), binding(saved))
        assert response.status_code == 200
        assert holder["provider"].actual_calls == 1
        assert "PRIVATE_PROJECT_DERIVED_ACTIONS_DISABLED" in response.text


def test_same_digest_other_project_private_transition_blocks_followup(
    tmp_path, monkeypatch
):
    holder = {}
    monkeypatch.setattr("trialboard.agent.runtime.runtime_provider", lambda *_: holder["provider"])
    app, _, storage = make_team_app(
        tmp_path, enable_pdf_agent=True, enable_evidence_scout=True
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        body, saved = allow_project(client)
        _, other = allow_project(client, title="Same digest policy sentinel")
        assert other["project_id"] != saved["project_id"]
        assert other["pdf_digest"] == saved["pdf_digest"]
        team_id = client.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"

        def restrict_other():
            with sqlite3.connect(database) as con:
                con.execute(
                    "UPDATE project_access_policies "
                    "SET sharing_scope='restricted',acl_revision=acl_revision+1 "
                    "WHERE project_id=?",
                    (other["project_id"],),
                )

        holder["provider"] = MutatingProvider(restrict_other)
        response = post_pdf(client, pdf_input(body), binding(saved))
        assert response.status_code == 200
        assert holder["provider"].actual_calls == 1
        assert "PRIVATE_PROJECT_DERIVED_ACTIONS_DISABLED" in response.text


def test_session_revoke_expiry_and_cross_team_change_block_followup(
    tmp_path, monkeypatch
):
    for mutation in ("revoke", "expire", "cross_team"):
        case = tmp_path / mutation
        case.mkdir(mode=0o700)
        holder = {}
        monkeypatch.setattr(
            "trialboard.agent.runtime.runtime_provider",
            lambda *_, holder=holder: holder["provider"],
        )
        app, identity_db, _ = make_team_app(
            case, enable_pdf_agent=True, enable_evidence_scout=True
        )
        with TestClient(app, base_url=ORIGIN) as client:
            login(client)
            body, saved = allow_project(client)

            def invalidate(identity_db=identity_db, mutation=mutation):
                with sqlite3.connect(identity_db) as con:
                    if mutation == "revoke":
                        con.execute("UPDATE sessions SET revoked_at=0")
                    elif mutation == "expire":
                        con.execute("UPDATE sessions SET absolute_expires_at=0")
                    else:
                        team_id = str(uuid4())
                        con.execute("INSERT INTO teams VALUES (?,?)", (team_id, "Other team"))
                        con.execute("UPDATE memberships SET team_id=?", (team_id,))

            holder["provider"] = MutatingProvider(invalidate)
            response = post_pdf(client, pdf_input(body), binding(saved))
            assert response.status_code == 200
            assert holder["provider"].actual_calls == 1
            assert "MODEL_IDENTITY_INVALIDATED" in response.text
