"""Saved SOURCE_TEXT review uses only synthetic sources, fake providers and temporary DBs."""

import asyncio
import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_project_acl import headers
from test_research_source_policy import assertion, synthetic_run
from test_team_auth import ORIGIN, login, make_team_app

from trialboard.agent.provider import Reply
from trialboard.research.store import ResearchStore


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    state = {"factories": 0, "calls": 0, "payloads": [], "after": lambda: None,
             "factory_after": lambda: None}

    class Provider:
        mode, model = "SCRIPTED_TEST_DOUBLE", "saved-synthetic"

        async def complete(self, **kwargs):
            state["calls"] += 1
            state["payloads"].append(kwargs["payload"])
            state["after"]()
            anchor = kwargs["payload"]["sources"][0]["segments"][0]["anchor_id"]
            return Reply(value={"findings": [{"anchor_id": anchor,
                                             "interpretation": "합성 출처의 제한된 관찰입니다."}],
                                "questions": ["전문가 확인이 필요합니다."],
                                "conclusion": "NEEDS_EXPERT_REVIEW"},
                         response_id="saved-fake", input_tokens=4, output_tokens=6)

    def factory(*_args):
        state["factories"] += 1
        state["factory_after"]()
        return Provider()

    monkeypatch.setattr("trialboard.agent.runtime.runtime_provider", factory)
    app, identity_db, root = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        team = client.get("/api/teams/current").json()["id"]
        directory = root / team
        directory.mkdir(mode=0o700, exist_ok=True)
        database = directory / "evidence.sqlite3"
        run = synthetic_run()
        ResearchStore(database).save_run(run)
        source = run.sources[0]
        base = f"/api/research/runs/{run.id}"
        request = {"model_consent": True, "source_bindings": [{
            "source_id": source.id, "source_digest": source.digest, "policy_revision": 1,
        }]}

        def allow():
            body = assertion(source.digest).model_copy(update={"external_ai": "ALLOW"})
            result = client.post(f"{base}/sources/{source.id}/usage-policy",
                                 json=body.model_dump(), headers=headers(client))
            assert result.status_code == 200

        yield client, run, database, identity_db, base, request, state, allow


def post(scenario):
    client, _, _, _, base, request, _, _ = scenario
    return client.post(f"{base}/review-saved", json=request, headers=headers(client))


def test_positive_one_call_metadata_sse_immutable_parent_and_rights_gated_get(scenario):
    client, run, database, _, base, request, state, allow = scenario
    allow()  # Unselected source remains UNKNOWN: never sent or included in the artifact.
    with sqlite3.connect(database) as con:
        before = con.execute("SELECT data FROM research_runs WHERE id=?", (run.id,)).fetchone()[0]
    response = post(scenario)
    assert response.status_code == 200, response.text
    events = [json.loads(line[6:]) for line in response.text.splitlines()
              if line.startswith("data: ")]
    assert [e["type"] for e in events] == ["STARTED", "COMPLETE"]
    assert [e["sequence"] for e in events] == [1, 2]
    assert all(set(e) == {"schema", "run_id", "attempt_id", "sequence", "type", "message"}
               for e in events)
    assert "secretneedle" not in response.text
    aid = events[0]["attempt_id"]
    result = client.get(f"{base}/review-attempts/{aid}")
    assert result.status_code == 200, result.text
    artifact = result.json()
    assert artifact["status"] == "COMPLETED"
    assert artifact["source_bindings"] == request["source_bindings"]
    assert artifact["review"]["findings"][0]["quote"] == run.sources[0].text
    assert artifact["model_calls"] == state["calls"] == state["factories"] == 1
    assert artifact["collector_calls"] == artifact["plan_calls"] == 0
    assert artifact["input_tokens"] == 4 and artifact["output_tokens"] == 6
    assert len(state["payloads"][0]["sources"]) == 1
    assert set(state["payloads"][0]) == {"asset", "indication", "nct_id", "sources"}
    assert len(artifact["citation_bindings"]) == 1
    with sqlite3.connect(database) as con:
        after = con.execute("SELECT data FROM research_runs WHERE id=?", (run.id,)).fetchone()[0]
        assert after == before
        assert con.execute("SELECT COUNT(*) FROM research_saved_review_records").fetchone()[0] == 2
        with pytest.raises(sqlite3.IntegrityError, match="IMMUTABLE"):
            con.execute("DELETE FROM research_saved_review_records")
    source = run.sources[0]
    body = assertion(source.digest, 1).model_copy(update={"external_ai": "DENY"})
    assert client.post(f"{base}/sources/{source.id}/usage-policy", json=body.model_dump(),
                       headers=headers(client)).status_code == 200
    assert client.get(f"{base}/review-attempts/{aid}").status_code == 200
    body = assertion(source.digest, 2, storage="DENY")
    assert client.post(f"{base}/sources/{source.id}/usage-policy", json=body.model_dump(),
                       headers=headers(client)).status_code == 200
    assert client.get(f"{base}/review-attempts/{aid}").status_code == 403
    listing = client.get(f"{base}/review-attempts")
    assert listing.status_code == 200 and "secretneedle" not in listing.text
    assert set(listing.json()["attempts"][0]) == {
        "run_id", "attempt_id", "status", "created_at", "completed_at", "model_calls",
    }


@pytest.mark.parametrize("change", ["unknown", "consent-int", "consent-false", "extra",
                                    "revision-bool", "duplicate", "digest", "revision",
                                    "cross-team"])
def test_invalid_preflight_creates_no_attempt_or_provider(scenario, change):
    client, _, database, _, base, request, state, allow = scenario
    if change != "unknown":
        allow()
    expected = 422
    if change == "consent-int":
        request["model_consent"] = 1
    elif change == "consent-false":
        request["model_consent"] = False
    elif change == "extra":
        request["body"] = "injected private content"
    elif change == "revision-bool":
        request["source_bindings"][0]["policy_revision"] = True
    elif change == "duplicate":
        request["source_bindings"] *= 2
    elif change == "digest":
        request["source_bindings"][0]["source_digest"] = "f" * 64
        expected = 409
    elif change == "revision":
        request["source_bindings"][0]["policy_revision"] = 2
        expected = 409
    elif change == "unknown":
        expected = 403
    else:
        base = f"/api/research/runs/{uuid4()}"
        expected = 404
    response = client.post(f"{base}/review-saved", json=request, headers=headers(client))
    assert response.status_code == expected, response.text
    assert state["calls"] == state["factories"] == 0
    with sqlite3.connect(database) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_saved_review_records'"
        ).fetchone()


@pytest.mark.parametrize("change", ["role", "expiry", "policy", "version"])
def test_revocation_while_awaiting_reply_blocks_publication_and_preserves_usage(scenario, change):
    client, run, database, identity_db, base, _, state, allow = scenario
    allow()

    def revoke():
        if change in ("role", "expiry"):
            with sqlite3.connect(identity_db) as con:
                sql = ("UPDATE memberships SET role='viewer',permission_epoch=2" if change == "role"
                       else "UPDATE sessions SET absolute_expires_at=0")
                con.execute(sql)
        elif change == "version":
            run.sources[0].digest = "f" * 64
            ResearchStore(database).save_run(run)
        else:
            from trialboard.api.team_auth import TeamDataPath
            from trialboard.research.source_policy import update_policy
            source = run.sources[0]
            update_policy(TeamDataPath(database.parent.parent), run.id, source.id,
                          assertion(source.digest, 1, storage="DENY"))

    state["after"] = revoke
    response = post(scenario)
    assert response.status_code == 200
    assert '"type": "FAILED"' in response.text and "secretneedle" not in response.text
    with sqlite3.connect(database) as con:
        artifact = json.loads(con.execute(
            "SELECT data FROM research_saved_review_records WHERE phase=1").fetchone()[0])
    assert artifact["status"] == "FAILED"
    assert artifact["error_code"] == "MODEL_POLICY_DENIED"
    assert artifact["review"] is None and artifact["citation_bindings"] == []
    assert artifact["model_calls"] == state["calls"] == 1
    assert artifact["response_id"] == "saved-fake" and artifact["input_tokens"] == 4


def test_factory_side_revocation_prevents_actual_request(scenario):
    _, _, database, identity_db, _, _, state, allow = scenario
    allow()

    def revoke():
        with sqlite3.connect(identity_db) as con:
            con.execute("UPDATE sessions SET revoked_at=1")

    state["factory_after"] = revoke
    response = post(scenario)
    assert response.status_code == 200 and '"type": "FAILED"' in response.text
    assert state["factories"] == 1 and state["calls"] == 0
    with sqlite3.connect(database) as con:
        terminal = json.loads(con.execute(
            "SELECT data FROM research_saved_review_records WHERE phase=1").fetchone()[0])
    assert terminal["model_calls"] == 0 and terminal["error_code"] == "MODEL_POLICY_DENIED"


def test_cancelled_provider_records_one_terminal_without_retry(scenario):
    _, _, database, _, _, _, state, allow = scenario
    allow()

    def cancel():
        raise asyncio.CancelledError

    state["after"] = cancel
    response = post(scenario)
    assert response.status_code == 200 and '"type": "FAILED"' in response.text
    with sqlite3.connect(database) as con:
        terminal = json.loads(con.execute(
            "SELECT data FROM research_saved_review_records WHERE phase=1").fetchone()[0])
    assert terminal["status"] == "CANCELLED" and terminal["error_code"] == "CANCELLED"
    assert state["calls"] == state["factories"] == terminal["model_calls"] == 1


def test_denied_purpose_stale_revision_and_request_limit_are_zero_call(scenario):
    client, run, _, _, base, request, state, allow = scenario
    allow()
    source = run.sources[0]
    deny = assertion(source.digest, 1).model_copy(update={"external_ai": "DENY"})
    assert client.post(f"{base}/sources/{source.id}/usage-policy", json=deny.model_dump(),
                       headers=headers(client)).status_code == 200
    request["source_bindings"][0]["policy_revision"] = 2
    assert post(scenario).status_code == 403
    response = client.post(f"{base}/review-saved", content=b" " * 32769,
                           headers={**headers(client), "Content-Type": "application/json"})
    assert response.status_code == 413  # Existing common boundary rejects before parsing.
    assert state["calls"] == state["factories"] == 0


def test_actual_other_team_cannot_read_or_review_known_run_and_attempt(scenario):
    client, _, database, identity_db, base, _, state, allow = scenario
    allow()
    assert post(scenario).status_code == 200
    aid = client.get(f"{base}/review-attempts").json()["attempts"][0]["attempt_id"]
    with sqlite3.connect(identity_db) as con:
        password = con.execute(
            "SELECT password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users"
        ).fetchone()
        user_b, team_b, member_b = str(uuid4()), str(uuid4()), str(uuid4())
        con.execute("INSERT INTO teams VALUES (?,?)", (team_b, "Synthetic Beta"))
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,0)", (user_b, "beta", *password))
        con.execute("INSERT INTO memberships VALUES (?,?,?,?,1,1)",
                    (member_b, user_b, team_b, "admin"))
    assert login(client, "beta").status_code == 200
    assert post(scenario).status_code == 404
    assert client.get(f"{base}/review-attempts").status_code == 404
    assert client.get(f"{base}/review-attempts/{aid}").status_code == 404
    assert state["calls"] == state["factories"] == 1
    assert not (database.parent.parent / team_b).exists()
