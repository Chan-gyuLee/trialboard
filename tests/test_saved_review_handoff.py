"""Read-only next-action context from selected saved review; fake provider, temporary TEAM DB."""

import json
import sqlite3
from uuid import uuid4

import pytest
from test_project_acl import headers
from test_research_source_policy import assertion
from test_saved_research_review import post
from test_saved_research_review import scenario as base_scenario
from test_team_auth import login

from trialboard.serialization import sha256_json


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    yield from base_scenario.__wrapped__(tmp_path, monkeypatch)


def completed(scenario):
    scenario[7]()
    response = post(scenario)
    assert response.status_code == 200, response.text
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    assert events[-1]["type"] == "COMPLETE"
    aid = events[0]["attempt_id"]
    url = scenario[4] + "/review-attempts/" + aid
    artifact = scenario[0].get(url)
    assert artifact.status_code == 200
    return aid, url + "/handoff", artifact.json()


def test_selected_only_handoff_readonly_exact_artifact_and_no_new_calls(scenario):
    aid, url, artifact = completed(scenario)
    client, run, database, _, base, _, state, _ = scenario
    assert client.get(base).status_code == 403  # Unselected source remains UNKNOWN.
    before = database.read_bytes()
    response = client.get(url)
    assert response.status_code == 200, response.text
    packet = response.json()
    assert set(packet) == {
        "schema",
        "run_id",
        "attempt_id",
        "artifact_digest",
        "context",
        "sources",
        "artifact",
        "clinical_verified",
    }
    assert packet["schema"] == "research-saved-review-handoff/1"
    assert packet["run_id"] == run.id and packet["attempt_id"] == aid
    assert packet["artifact"] == artifact and packet["artifact_digest"] == sha256_json(artifact)
    assert packet["context"] == {"search_id": run.request.search_id, **artifact["context"]}
    assert packet["clinical_verified"] is False
    source = run.sources[0]
    assert packet["sources"] == [
        {
            "source_id": source.id,
            "source_digest": source.digest,
            "title": source.title,
            "url": source.url,
            "pdf_url": None,
            "content_level": source.content_level,
        }
    ]
    assert run.sources[1].text not in response.text
    assert database.read_bytes() == before
    assert state["calls"] == state["factories"] == 1


@pytest.mark.parametrize("storage,status", [("ALLOW", 200), ("UNKNOWN", 403), ("DENY", 403)])
def test_current_storage_rechecked_external_revoke_does_not_rewrite_history(
    scenario, storage, status
):
    _, url, artifact = completed(scenario)
    client, run, _, _, base, _, state, _ = scenario
    body = assertion(run.sources[0].digest, 1, storage=storage).model_copy(
        update={"external_ai": "DENY"}
    )
    assert (
        client.post(
            base + f"/sources/{run.sources[0].id}/usage-policy",
            json=body.model_dump(),
            headers=headers(client),
        ).status_code
        == 200
    )
    response = client.get(url)
    assert response.status_code == status
    if status == 200:
        assert response.json()["artifact"] == artifact
    else:
        assert run.sources[0].text not in response.text
    assert state["calls"] == 1


def test_fresh_viewer_can_read_but_expired_session_cannot(scenario):
    _, url, _ = completed(scenario)
    with sqlite3.connect(scenario[3]) as con:
        con.execute("UPDATE memberships SET role='viewer',permission_epoch=2")
    login(scenario[0])
    assert scenario[0].get(url).status_code == 200
    with sqlite3.connect(scenario[3]) as con:
        con.execute("UPDATE sessions SET revoked_at=1")
    assert scenario[0].get(url).status_code == 401


def test_missing_attempt_or_other_run_does_not_return_artifact(scenario):
    aid, _, _ = completed(scenario)
    assert scenario[0].get(scenario[4] + f"/review-attempts/{uuid4()}/handoff").status_code == 404
    assert (
        scenario[0].get(f"/api/research/runs/{uuid4()}/review-attempts/{aid}/handoff").status_code
        == 404
    )


def test_other_team_cannot_read_completed_attempt(scenario):
    _, url, _ = completed(scenario)
    with sqlite3.connect(scenario[3]) as con:
        first = con.execute(
            "SELECT password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users"
        ).fetchone()
        team, user = str(uuid4()), str(uuid4())
        con.execute("INSERT INTO teams VALUES (?,?)", (team, "Synthetic Beta"))
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,0)", (user, "beta", *first))
        con.execute(
            "INSERT INTO memberships VALUES (?,?,?,?,1,1)", (str(uuid4()), user, team, "admin")
        )
    login(scenario[0], "beta")
    response = scenario[0].get(url)
    assert response.status_code == 404 and scenario[1].sources[0].text not in response.text


def test_failed_review_has_no_handoff(scenario):
    scenario[7]()

    def fail():
        raise RuntimeError("synthetic")

    scenario[6]["after"] = fail
    response = post(scenario)
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    assert events[-1]["type"] == "FAILED"
    url = scenario[4] + "/review-attempts/" + events[0]["attempt_id"] + "/handoff"
    assert scenario[0].get(url).status_code == 409


@pytest.mark.parametrize(
    "change", ["quote", "span", "span-bool", "source", "context", "extra", "model", "notices"]
)
def test_stored_artifact_tampering_is_not_handed_off(scenario, change):
    aid, url, artifact = completed(scenario)
    if change == "quote":
        artifact["review"]["findings"][0]["quote"] = "forged quote"
    elif change == "span":
        artifact["citation_bindings"][0]["start"] += 1
    elif change == "span-bool":
        artifact["citation_bindings"][0]["start"] = False
    elif change == "source":
        artifact["sources"][0]["title"] = "forged title"
    elif change == "context":
        artifact["context"]["asset"] = "wrong drug"
    elif change == "model":
        artifact["model"] = {"private_body": "must never leak"}
    elif change == "notices":
        artifact["notices"] = [{"private_body": "must never leak"}]
    else:
        artifact["private_body"] = "must never leak"
    with sqlite3.connect(scenario[2]) as con:
        con.execute("DROP TRIGGER saved_review_no_update")  # Synthetic corruption only.
        con.execute(
            "UPDATE research_saved_review_records SET data=? WHERE attempt_id=? AND phase=1",
            (json.dumps(artifact), aid),
        )
    response = scenario[0].get(url)
    assert response.status_code in (409, 422)
    assert "forged" not in response.text and "must never leak" not in response.text


def test_identity_revoked_during_read_prevents_publication(scenario, monkeypatch):
    from trialboard.research import saved_review_handoff as module

    _, url, _ = completed(scenario)
    original = module.selected

    def revoke(*args, **kwargs):
        value = original(*args, **kwargs)
        with sqlite3.connect(scenario[3]) as con:
            con.execute("UPDATE sessions SET revoked_at=1")
        return value

    monkeypatch.setattr(module, "selected", revoke)
    response = scenario[0].get(url)
    assert response.status_code == 403 and scenario[1].sources[0].text not in response.text


def test_selected_raw_rights_rechecked_without_unselected_permission(tmp_path, monkeypatch):
    from test_research_raw_policy import scenario as raw_scenario

    generator = raw_scenario.__wrapped__(tmp_path, monkeypatch)
    value, policy_url, policy = next(generator)
    try:
        client = value[0]
        value[5]["source_bindings"][0]["source_digest"] = value[1].sources[0].digest
        assert (
            client.post(
                policy_url, headers=headers(client), json={**policy, "external_ai": "ALLOW"}
            ).status_code
            == 200
        )
        _, url, _ = completed(value)
        assert client.get(url).status_code == 200
        assert (
            client.post(
                policy_url,
                headers=headers(client),
                json={
                    **policy,
                    "expected_policy_revision": 1,
                    "original_storage": "DENY",
                },
            ).status_code
            == 200
        )
        response = client.get(url)
        assert response.status_code == 403 and value[1].sources[0].text not in response.text
    finally:
        try:
            next(generator)
        except StopIteration:
            pass
