"""Exact prepared-PDF review integration; all accounts/DBs/text/providers are synthetic."""

import asyncio
import inspect
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_pdf_preparation import post as prepare
from test_pdf_preparation import scenario as scenario
from test_project_acl import headers
from test_research_pdf_policy import assertion
from test_team_auth import ORIGIN, login

from trialboard.agent.provider import ModelError, Reply
from trialboard.api.app import create_app
from trialboard.api.team_auth import TeamDataPath, TeamIdentity
from trialboard.research import prepared_pdf_review as pdf
from trialboard.research.pdf_policy import PdfPolicyUpdate, update
from trialboard.research.store import ResearchStore


@pytest.fixture
def api_case(scenario, monkeypatch):
    fixture, _, _ = scenario
    value, pdf_url, permission = fixture
    artifact = prepare(scenario).json()
    policy = assertion(permission, 1)
    policy["external_ai"] = "ALLOW"
    assert value[0].post(pdf_url + "/usage-policy", json=policy,
                         headers=headers(value[0])).status_code == 200
    state = {"factories": 0, "calls": 0, "after": lambda: None,
             "factory_after": lambda: None, "response": lambda value: value,
             "input_tokens": 4, "output_tokens": 6}

    class Provider:
        mode, model = "SCRIPTED_TEST_DOUBLE", "synthetic-prepared-pdf"

        async def complete(self, **kwargs):
            state["calls"] += 1
            state["payload"] = kwargs["payload"]
            after = state["after"]()
            if inspect.isawaitable(after):
                await after
            result = {"findings": [{"anchor_id": kwargs["payload"]["segments"][0]["anchor_id"],
                                    "interpretation": "Synthetic limited observation"}],
                      "questions": ["Synthetic expert question"],
                      "conclusion": "NEEDS_EXPERT_REVIEW"}
            return Reply(value=state["response"](result), response_id="synthetic-pdf-reply",
                         input_tokens=state["input_tokens"], output_tokens=state["output_tokens"])

    def factory(*_):
        state["factories"] += 1
        state["factory_after"]()
        provider = Provider()
        provider.mode = state.get("mode", "SCRIPTED_TEST_DOUBLE")
        return provider

    # Rebuild the actual TEAM app with the explicitly counted factory before closure binding.
    monkeypatch.setattr("trialboard.agent.runtime.runtime_provider", factory)
    app = create_app(access_mode="team", identity_db=value[3],
                     team_storage_root=value[2].parent.parent,
                     evidence_db=value[2].parent.parent.parent / "legacy.sqlite3",
                     enable_evidence_scout=True, enable_pdf_agent=True)
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        request = {"model_consent": True, "preparation_id": artifact["preparation_id"],
                   "preparation_digest": artifact["preparation_digest"], "policy_revision": 2}
        yield client, value, pdf_url, permission, artifact, request, state


def post(case):
    client, value, _, _, _, request, _ = case
    return client.post(value[4] + "/review-prepared-pdf", json=request, headers=headers(client))


def records(case):
    with sqlite3.connect(case[1][2]) as con:
        return [json.loads(row[0]) for row in con.execute(
            "SELECT data FROM research_pdf_review_records ORDER BY phase")]


def set_policy(case, *, storage="ALLOW", external="ALLOW"):
    client, _, url, permission, *_ = case
    body = assertion(permission, 2, storage)
    body["external_ai"] = external
    assert client.post(url + "/usage-policy", json=body,
                       headers=headers(client)).status_code == 200


def test_one_call_bodyless_sse_bound_get_immutable_parent_and_separate_usage(api_case):
    client, value, _, _, artifact, _, state = api_case
    with sqlite3.connect(value[2]) as con:
        before = con.execute("SELECT data FROM research_runs WHERE id=?", (value[1].id,)).fetchone()
    response = post(api_case)
    assert response.status_code == 200, response.text
    events = [json.loads(line[6:]) for line in response.text.splitlines()
              if line.startswith("data: ")]
    assert [(e["type"], e["sequence"]) for e in events] == [("STARTED", 1), ("COMPLETE", 2)]
    assert all(set(e) == {"schema", "run_id", "attempt_id", "sequence", "type", "message"}
               and e["schema"] == "research-pdf-review-event/1" for e in events)
    assert "Synthetic server-extracted text" not in response.text
    result = client.get(value[4] + "/pdf-review-attempts/" + events[0]["attempt_id"])
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved["status"] == "COMPLETED" and saved["policy_revision"] == 2
    assert saved["preparation_id"] == artifact["preparation_id"]
    assert saved["review"]["findings"][0]["quote"] == artifact["pages"][0]["text"]
    assert "source_bindings" not in saved and "context" not in saved
    assert state["factories"] == state["calls"] == saved["model_calls"] == 1
    usage = client.get(value[4] + "/pdf-review-usage").json()
    assert usage["schema"] == "research-pdf-review-usage/1"
    assert usage["scope"] == "PREPARED_PDF_REVIEW_ONLY"
    assert usage["attempts_total"] == usage["completed_attempts"] == 1
    assert usage["usage_by_mode"]["SCRIPTED_TEST_DOUBLE"] == {
        "observed_model_calls": 1, "observed_input_tokens": 4, "observed_output_tokens": 6,
        "input_unknown_attempts": 0, "output_unknown_attempts": 0}
    assert usage["usage_by_mode"]["DACON_RESPONSES"]["observed_model_calls"] == 0
    assert client.get(value[4] + "/review-usage").json()["attempts_total"] == 0
    prep_url = value[4] + "/pdf-preparations/" + artifact["preparation_id"]
    assert client.get(prep_url).json() == artifact
    with sqlite3.connect(value[2]) as con:
        after = con.execute("SELECT data FROM research_runs WHERE id=?", (value[1].id,)).fetchone()
        assert after == before
        with pytest.raises(sqlite3.IntegrityError, match="IMMUTABLE"):
            con.execute("DELETE FROM research_pdf_review_records")


@pytest.mark.parametrize("change", [
    "storage", "external", "digest", "revision", "consent", "extra"])
def test_preflight_denied_never_constructs_provider(api_case, change):
    _, _, _, _, _, request, state = api_case
    if change in ("storage", "external"):
        set_policy(api_case, **{change: "DENY"})
        request["policy_revision"] = 3
    elif change == "digest":
        request["preparation_digest"] = "f" * 64
    elif change == "revision":
        request["policy_revision"] = 1
    elif change == "consent":
        request["model_consent"] = 1
    else:
        request["text"] = "browser injected private text"
    assert post(api_case).status_code in (403, 409, 422)
    assert state["factories"] == state["calls"] == 0


@pytest.mark.parametrize("change", ["factory", "expiry", "role", "source", "bytes", "policy"])
def test_midflight_revalidation_blocks_publication_and_preserves_observed_usage(api_case, change):
    _, value, *_ = api_case
    state = api_case[6]

    def revoke():
        if change in ("factory", "expiry", "role"):
            with sqlite3.connect(value[3]) as con:
                con.execute("UPDATE memberships SET role='viewer',permission_epoch=2"
                            if change == "role" else "UPDATE sessions SET absolute_expires_at=0")
        elif change == "source":
            value[1].sources[0].digest = "f" * 64
            ResearchStore(value[2]).save_run(value[1])
        elif change == "bytes":
            with sqlite3.connect(value[2]) as con:
                con.execute("UPDATE public_pdf_blobs SET content=?", (b"%PDF-tampered",))
        else:
            body = assertion(api_case[3], 2)
            body["external_ai"] = "DENY"
            update(TeamDataPath(value[2].parent.parent), TeamIdentity(value[3]),
                   value[1].id, value[1].sources[0].id, PdfPolicyUpdate(**body))

    state["factory_after" if change == "factory" else "after"] = revoke
    response = post(api_case)
    assert response.status_code == 200 and '"type": "FAILED"' in response.text
    terminal = records(api_case)[1]
    assert terminal["status"] == "FAILED" and terminal["review"] is None
    assert terminal["error_code"] == "MODEL_POLICY_DENIED"
    assert terminal["model_calls"] == state["calls"] == (0 if change == "factory" else 1)
    assert terminal["input_tokens"] == (None if change == "factory" else 4)


@pytest.mark.parametrize("failure", ["cancel", "provider", "response"])
def test_failures_are_not_retried_and_unknown_tokens_are_explicit(api_case, failure):
    client, value, *_, state = api_case

    def fail():
        if failure == "cancel":
            raise asyncio.CancelledError
        raise ModelError("synthetic provider failure")

    if failure == "response":
        state["response"] = lambda value: {**value, "findings": [
            {"anchor_id": "invented", "interpretation": "x"}]}
    else:
        state["after"] = fail
    assert '"type": "FAILED"' in post(api_case).text
    terminal = records(api_case)[1]
    assert terminal["status"] == ("CANCELLED" if failure == "cancel" else "FAILED")
    assert terminal["review"] is None and state["calls"] == state["factories"] == 1
    usage = client.get(value[4] + "/pdf-review-usage").json()
    group = usage["usage_by_mode"]["SCRIPTED_TEST_DOUBLE"]
    assert group["input_unknown_attempts"] == group["output_unknown_attempts"] == (
        0 if failure == "response" else 1)


def test_preparation_scoped_history_and_revoked_storage_read(api_case, scenario):
    client, value, _, _, artifact, *_ = api_case
    assert post(api_case).status_code == 200
    another = prepare(scenario)
    assert another.status_code == 409  # Original preparation request pins old policy revision.
    scenario[1]["policy_revision"] = 2
    another = prepare(scenario).json()
    target = value[4] + "/pdf-review-attempts"
    assert client.get(target).status_code == 422
    assert client.get(target, params={"preparation_id": another["preparation_id"]}).json()[
        "attempts"] == []
    metadata = client.get(target, params={"preparation_id": artifact["preparation_id"]}).json()
    assert metadata["preparation_id"] == artifact["preparation_id"]
    assert len(metadata["attempts"]) == 1
    aid = metadata["attempts"][0]["attempt_id"]
    assert client.get(target, params={"preparation_id": str(uuid4())}).status_code == 404
    set_policy(api_case, storage="DENY")
    assert client.get(target + "/" + aid).status_code == 403
    metadata = client.get(target, params={"preparation_id": artifact["preparation_id"]})
    assert metadata.status_code == 200
    assert client.get(value[4] + "/pdf-review-usage").status_code == 200


def test_terminal_write_failure_releases_slot_and_retains_unfinished_unknown(api_case, monkeypatch):
    client, value, *_ = api_case
    original = pdf.persist

    def broken(database, artifact, phase):
        if phase == 1:
            raise sqlite3.OperationalError("synthetic disk failure")
        original(database, artifact, phase)

    monkeypatch.setattr(pdf, "persist", broken)
    response = post(api_case)
    assert response.status_code == 200 and '"type": "FAILED"' in response.text
    assert "미확정" in response.text and "synthetic disk failure" not in response.text
    usage = client.get(value[4] + "/pdf-review-usage").json()
    assert usage["unfinished_attempts"] == usage["attempts_total"] == 1
    assert all(g["observed_model_calls"] == 0 for g in usage["usage_by_mode"].values())
    monkeypatch.setattr(pdf, "persist", original)
    assert '"type": "COMPLETE"' in post(api_case).text
    assert api_case[6]["calls"] == 2


def test_personal_provider_mode_never_receives_a_request(api_case):
    api_case[6]["mode"] = "CODEX_CHATGPT"
    assert '"type": "FAILED"' in post(api_case).text
    terminal = records(api_case)[1]
    assert terminal["model_calls"] == api_case[6]["calls"] == 0
    assert terminal["execution_mode"] == "COLLECTORS_ONLY"
    assert api_case[6]["factories"] == 1


def test_concurrent_review_busy_then_slot_reusable(api_case):
    entered, release = Event(), Event()

    async def wait():
        entered.set()
        assert await asyncio.to_thread(release.wait, 3)

    api_case[6]["after"] = wait
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(post, api_case)
        try:
            assert entered.wait(3)
            blocked = post(api_case)
            assert blocked.status_code == 409 and blocked.json()["detail"] == "MODEL_BUSY"
            assert api_case[6]["calls"] == api_case[6]["factories"] == 1
        finally:
            release.set()
        assert '"type": "COMPLETE"' in first.result(timeout=3).text
    assert '"type": "COMPLETE"' in post(api_case).text
    assert api_case[6]["calls"] == 2


@pytest.mark.parametrize("change", ["schema", "mode", "bool", "negative", "binding"])
def test_pdf_usage_rejects_corrupt_records_without_source_counter_contamination(api_case, change):
    assert post(api_case).status_code == 200
    client, value, *_ = api_case
    start, terminal = records(api_case)
    start["attempt_id"] = terminal["attempt_id"] = str(uuid4())
    if change == "schema":
        terminal["schema"] = "research-saved-review/1"
    elif change == "mode":
        terminal["execution_mode"] = "UNKNOWN"
    elif change == "bool":
        terminal["input_tokens"] = True
    elif change == "negative":
        terminal["output_tokens"] = -1
    else:
        terminal["preparation_digest"] = "f" * 64
    pdf.persist(value[2], start, 0)
    pdf.persist(value[2], terminal, 1)
    result = client.get(value[4] + "/pdf-review-usage")
    assert result.status_code == 422 and result.json()["detail"] == "REVIEW_USAGE_RECORD_INVALID"
    assert client.get(value[4] + "/review-usage").json()["attempts_total"] == 0


def test_result_read_rejects_forged_quotes_even_with_known_anchor(api_case):
    assert post(api_case).status_code == 200
    client, value, *_ = api_case
    start, terminal = records(api_case)
    start["attempt_id"] = terminal["attempt_id"] = str(uuid4())
    terminal["review"]["findings"][0]["quote"] = "forged private content"
    pdf.persist(value[2], start, 0)
    pdf.persist(value[2], terminal, 1)
    result = client.get(value[4] + "/pdf-review-attempts/" + terminal["attempt_id"])
    assert result.status_code == 409 and "forged private content" not in result.text


def test_other_team_cannot_read_or_execute_known_identifiers(api_case):
    client, value, _, _, artifact, *_ = api_case
    assert post(api_case).status_code == 200
    aid = records(api_case)[1]["attempt_id"]
    with sqlite3.connect(value[3]) as con:
        password = con.execute(
            "SELECT password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users").fetchone()
        team, user, member = str(uuid4()), str(uuid4()), str(uuid4())
        con.execute("INSERT INTO teams VALUES (?,?)", (team, "Synthetic Beta"))
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,0)", (user, "beta", *password))
        con.execute("INSERT INTO memberships VALUES (?,?,?,?,1,1)", (member, user, team, "admin"))
    assert login(client, "beta").status_code == 200
    urls = [value[4] + "/pdf-review-usage", value[4] + "/pdf-review-attempts/" + aid,
            value[4] + "/pdf-review-attempts?preparation_id=" + artifact["preparation_id"]]
    for url in urls:
        assert client.get(url).status_code == 404
    assert post(api_case).status_code == 404
    assert api_case[6]["factories"] == api_case[6]["calls"] == 1


def test_external_revocation_blocks_new_transfer_not_permitted_old_result(api_case):
    client, value, *_ = api_case
    assert post(api_case).status_code == 200
    aid = records(api_case)[1]["attempt_id"]
    set_policy(api_case, external="DENY")
    assert client.get(value[4] + "/pdf-review-attempts/" + aid).status_code == 200
    api_case[5]["policy_revision"] = 3
    assert post(api_case).status_code == 403
    assert api_case[6]["calls"] == 1


def test_start_persistence_failure_releases_slot_without_provider(api_case, monkeypatch):
    original = pdf.persist

    def fail(*_):
        raise sqlite3.OperationalError("synthetic start failure")

    monkeypatch.setattr(pdf, "persist", fail)
    with pytest.raises(sqlite3.OperationalError, match="synthetic start failure"):
        post(api_case)
    assert api_case[6]["calls"] == api_case[6]["factories"] == 0
    monkeypatch.setattr(pdf, "persist", original)
    assert '"type": "COMPLETE"' in post(api_case).text


def test_partial_usage_keeps_unknown_direction_distinct(api_case):
    api_case[6]["input_tokens"] = None
    assert '"type": "COMPLETE"' in post(api_case).text
    client, value, *_ = api_case
    packet = client.get(value[4] + "/pdf-review-usage").json()
    assert packet["usage_by_mode"]["SCRIPTED_TEST_DOUBLE"] == {
        "observed_model_calls": 1, "observed_input_tokens": 0, "observed_output_tokens": 6,
        "input_unknown_attempts": 1, "output_unknown_attempts": 0}
