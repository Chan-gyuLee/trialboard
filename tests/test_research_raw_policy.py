"""RAW_SNAPSHOT metadata and assertion contract with synthetic JSON and temporary TEAM DBs."""

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import HTTPException
from test_project_acl import headers
from test_saved_research_review import scenario as base_scenario
from test_team_auth import login

from trialboard.research import raw_policy as raw
from trialboard.research.source_policy import initialize
from trialboard.research.store import ResearchStore

DATA = {"synthetic": "private raw value must not appear in metadata", "values": [1, 2]}


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    generator = base_scenario.__wrapped__(tmp_path, monkeypatch)
    value = next(generator)
    client, run, database, identity, base, *_ = value
    store = ResearchStore(database)
    digest = store.snapshot(DATA)
    for index, source in enumerate(run.sources):
        source.digest = ("a" if index == 0 else "b") * 64
        source.raw_snapshots = [digest]
    store.save_run(run)
    with sqlite3.connect(identity) as con:
        owner = con.execute("SELECT id FROM users").fetchone()[0]
    with sqlite3.connect(database) as con:
        initialize(con)
        con.execute("INSERT INTO research_run_owners VALUES (?,?)", (run.id, owner))
    body = {"source_digest": run.sources[0].digest, "snapshot_digest": digest,
            "expected_policy_revision": 0, "original_storage": "ALLOW",
            "internal_search": "UNKNOWN", "external_ai": "UNKNOWN", "training": "DENY",
            "evidence_reference": "Synthetic raw license", "reason": "Synthetic local test only"}
    url = base + f"/sources/{run.sources[0].id}/raw-usage-policy"
    yield value, url, body
    try:
        next(generator)
    except StopIteration:
        pass


def post(scenario, body=None):
    value, url, default = scenario
    return value[0].post(url, json=default if body is None else body, headers=headers(value[0]))


def read(scenario, *, purpose="original_storage", sid=None):
    value, _, body = scenario
    source = value[1].sources[0 if sid is None else sid]
    with sqlite3.connect(value[2].resolve().as_uri() + "?mode=ro", uri=True) as con:
        con.execute("BEGIN")
        return raw.read_snapshot(con, (value[1].id, source.id, source.digest,
                                      body["snapshot_digest"]), purpose=purpose)


def test_unknown_metadata_readonly_then_explicit_allow_and_immutable_history(scenario):
    value, url, body = scenario
    client, run, database, _, base, *_ = value
    before = database.read_bytes()
    response = client.get(base + "/raw-metadata")
    assert response.status_code == 200, response.text
    assert DATA["synthetic"] not in response.text and "https://" not in response.text
    packet = response.json()
    assert set(packet) == {"run_id", "resource_kind", "can_manage", "sources"}
    assert packet["can_manage"] is True and packet["resource_kind"] == "RAW_SNAPSHOT"
    version = packet["sources"][0]["snapshots"][0]
    assert version["snapshot_digest"] == body["snapshot_digest"] and version["byte_length"] > 0
    assert all(version["usage_policy"][p] == "UNKNOWN" for p in raw.PURPOSES)
    assert version["usage_policy"]["policy_revision"] == 0
    assert database.read_bytes() == before
    with pytest.raises(HTTPException) as error:
        read(scenario)
    assert error.value.status_code == 403
    allowed = post(scenario)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["current"]["verification"] == "USER_ATTESTED_UNVERIFIED"
    assert read(scenario) == DATA
    for purpose in ("internal_search", "external_ai", "training"):
        with pytest.raises(HTTPException) as denied:
            read(scenario, purpose=purpose)
        assert denied.value.status_code == 403
    with pytest.raises(HTTPException):
        read(scenario, sid=1)  # Identical raw hash on another source does not inherit permission.
    assert post(scenario).status_code == 409
    denied_body = {**body, "expected_policy_revision": 1, "original_storage": "DENY"}
    assert post(scenario, denied_body).status_code == 200
    history = client.get(url, params={k: body[k] for k in (
        "source_digest", "snapshot_digest")})
    assert history.status_code == 200 and len(history.json()["history"]) == 2
    assert history.json()["current"]["original_storage"] == "DENY"
    with pytest.raises(HTTPException):
        read(scenario)
    with sqlite3.connect(database) as con:
        with pytest.raises(sqlite3.IntegrityError, match="IMMUTABLE"):
            con.execute("DELETE FROM research_raw_policies")
    assert value[6]["calls"] == value[6]["factories"] == 0


@pytest.mark.parametrize("change", ["revision-bool", "extra", "blank", "digest", "snapshot"])
def test_invalid_assertion_does_not_create_policy(scenario, change):
    value, _, body = scenario
    body = dict(body)
    if change == "revision-bool":
        body["expected_policy_revision"] = True
    elif change == "extra":
        body["raw"] = DATA
    elif change == "blank":
        body["evidence_reference"] = " "
    elif change == "digest":
        body["source_digest"] = "f" * 64
    else:
        body["snapshot_digest"] = "f" * 64
    assert post(scenario, body).status_code in (404, 409, 422)
    with sqlite3.connect(value[2]) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_raw_policies'").fetchone()


@pytest.mark.parametrize("role,owner,status", [("viewer", True, 403), ("reviewer", True, 200),
                                             ("reviewer", False, 403)])
def test_fresh_role_and_run_owner_are_required(scenario, role, owner, status):
    value, _, _ = scenario
    with sqlite3.connect(value[3]) as con:
        con.execute("UPDATE memberships SET role=?,permission_epoch=2", (role,))
    if not owner:
        with sqlite3.connect(value[2]) as con:
            con.execute("UPDATE research_run_owners SET subject_id=?", (str(uuid4()),))
    assert login(value[0]).status_code == 200
    assert value[0].get("/api/auth/session").json()["role"] == role
    metadata = value[0].get(value[4] + "/raw-metadata")
    assert metadata.status_code == 200 and metadata.json()["can_manage"] == (status == 200)
    assert post(scenario).status_code == status


@pytest.mark.parametrize("change", [
    "bytes", "missing", "link", "source", "oversize", "duplicate-json"])
def test_integrity_or_binding_change_blocks_metadata_and_assertion(scenario, change):
    value, _, _ = scenario
    with sqlite3.connect(value[2]) as con:
        if change == "bytes":
            con.execute("UPDATE snapshots SET raw=?", ('{"altered":true}',))
        elif change == "missing":
            con.execute("DELETE FROM snapshots")
        elif change == "link":
            con.execute("DELETE FROM research_links WHERE relation='RAW_SNAPSHOT'")
        elif change == "oversize":
            con.execute("UPDATE snapshots SET raw=?", (" " * 5_000_001,))
        elif change == "duplicate-json":
            con.execute("UPDATE snapshots SET raw=?", ('{"x":1,"x":2}',))
        else:
            value[1].sources[0].digest = "f" * 64
            ResearchStore(value[2]).save_run(value[1])
    # The current source metadata may exist after an intentional version change,
    # but the old assertion must never authorize the new source version.
    if change != "source":
        result = value[0].get(value[4] + "/raw-metadata")
        assert result.status_code in (404, 409, 422)
        assert DATA["synthetic"] not in result.text
    assert post(scenario).status_code in (404, 409, 422)


def test_reader_requires_one_explicit_snapshot_transaction(scenario):
    assert post(scenario).status_code == 200
    value, _, body = scenario
    with sqlite3.connect(value[2]) as con:
        with pytest.raises(HTTPException, match="RAW_SNAPSHOT_TRANSACTION_REQUIRED"):
            raw.read_snapshot(con, (value[1].id, value[1].sources[0].id,
                                    body["source_digest"], body["snapshot_digest"]))


def test_same_hash_on_another_run_never_inherits_permission(scenario):
    assert post(scenario).status_code == 200
    value, _, body = scenario
    other = value[1].model_copy(deep=True, update={"id": str(uuid4())})
    ResearchStore(value[2]).save_run(other)
    with sqlite3.connect(value[2]) as con:
        con.execute("BEGIN")
        with pytest.raises(HTTPException) as error:
            raw.read_snapshot(con, (other.id, other.sources[0].id,
                                    other.sources[0].digest, body["snapshot_digest"]))
    assert error.value.status_code == 403


def test_other_team_metadata_and_mutation_are_not_found(scenario):
    value, url, body = scenario
    with sqlite3.connect(value[3]) as con:
        password = con.execute(
            "SELECT password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users").fetchone()
        team, user, member = str(uuid4()), str(uuid4()), str(uuid4())
        con.execute("INSERT INTO teams VALUES (?,?)", (team, "Synthetic Beta"))
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,0)", (user, "beta", *password))
        con.execute("INSERT INTO memberships VALUES (?,?,?,?,1,1)", (member, user, team, "admin"))
    assert login(value[0], "beta").status_code == 200
    root = value[2].parent.parent / team
    assert not root.exists()
    assert value[0].get(value[4] + "/raw-metadata").status_code == 404
    assert value[0].get(url, params={k: body[k] for k in (
        "source_digest", "snapshot_digest")}).status_code == 404
    assert post(scenario).status_code == 404
    assert not root.exists()  # Neither missing read nor forbidden write bootstraps another DB.


def test_concurrent_cas_has_exactly_one_winner(scenario):
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: post(scenario).status_code, range(2)))
    assert sorted(results) == [200, 409]
    value, _, _ = scenario
    with sqlite3.connect(value[2]) as con:
        assert con.execute("SELECT count(*) FROM research_raw_policies").fetchone()[0] == 1


def test_reader_policy_and_raw_use_one_snapshot(scenario, monkeypatch):
    assert post(scenario).status_code == 200
    value, _, body = scenario
    with sqlite3.connect(value[2]) as con:
        con.execute("PRAGMA journal_mode=WAL")
    original = raw.current
    changed = False

    def revoke_after_policy(con, key):
        nonlocal changed
        assert con.in_transaction
        policy = original(con, key)
        if not changed:
            changed = True
            deny = {**body, "expected_policy_revision": 1, "original_storage": "DENY"}
            assert post(scenario, deny).status_code == 200
        return policy

    monkeypatch.setattr(raw, "current", revoke_after_policy)
    assert read(scenario) == DATA  # Authorized as of the same read snapshot, not a mixed read.
    with pytest.raises(HTTPException) as error:
        read(scenario)
    assert error.value.status_code == 403


def test_policy_history_cap_and_bad_stored_binding_fail_closed(scenario):
    first = post(scenario).json()["current"]
    value, _, body = scenario
    with sqlite3.connect(value[2]) as con:
        key = (value[1].id, value[1].sources[0].id, body["source_digest"], body["snapshot_digest"])
        for revision in range(2, 101):
            packet = {**first, "policy_revision": revision}
            con.execute("INSERT INTO research_raw_policies VALUES (?,?,?,?,?,?)",
                        (*key, revision, json.dumps(packet)))
    blocked = post(scenario, {**body, "expected_policy_revision": 100})
    assert blocked.status_code == 422 and blocked.json()["detail"] == "RAW_POLICY_HISTORY_LIMIT"
    with sqlite3.connect(value[2]) as con:
        forged = {**first, "policy_revision": 1, "source_id": "wrong-source"}
        source = value[1].sources[1]
        con.execute("INSERT INTO research_raw_policies VALUES (?,?,?,?,?,?)",
                    (value[1].id, source.id, source.digest, body["snapshot_digest"],
                     1, json.dumps(forged)))
    result = value[0].get(value[4] + "/raw-metadata")
    assert result.status_code == 409 and result.json()["detail"] == "RAW_POLICY_INTEGRITY_FAILED"


def test_same_snapshot_metadata_cache_and_aggregate_limit_before_parse(scenario, monkeypatch):
    value = scenario[0]
    original = raw.snapshot
    calls = []

    def counted(con, digest):
        calls.append(digest)
        return original(con, digest)

    monkeypatch.setattr(raw, "snapshot", counted)
    packet = value[0].get(value[4] + "/raw-metadata").json()
    assert len(calls) == 1  # Shared SHA across two sources, but permissions remain separate.
    size = packet["sources"][0]["snapshots"][0]["byte_length"]
    assert raw.MAX_TOTAL_RAW_BYTES == 25_000_000
    calls.clear()
    monkeypatch.setattr(raw, "MAX_TOTAL_RAW_BYTES", size - 1)
    response = value[0].get(value[4] + "/raw-metadata")
    assert response.status_code == 422
    assert response.json()["detail"] == "RAW_SNAPSHOT_TOTAL_SIZE_LIMIT"
    assert calls == []


@pytest.mark.parametrize("change", ["gap", "utc", "impossible-date", "time-reversed"])
def test_policy_history_integrity_requires_contiguous_revisions_and_valid_utc(scenario, change):
    first = post(scenario).json()["current"]
    value, url, body = scenario
    revision = 3 if change == "gap" else 2
    timestamp = first["created_at"]
    if change == "utc":
        timestamp = "2026-10-01T09:00:00+09:00"
    elif change == "impossible-date":
        timestamp = "2026-02-31T00:00:00Z"
    elif change == "time-reversed":
        timestamp = "2000-01-01T00:00:00Z"
    record = {**first, "policy_revision": revision, "created_at": timestamp}
    with sqlite3.connect(value[2]) as con:
        con.execute("INSERT INTO research_raw_policies VALUES (?,?,?,?,?,?)", (
            value[1].id, value[1].sources[0].id, body["source_digest"],
            body["snapshot_digest"], revision, json.dumps(record)))
    response = value[0].get(url, params={k: body[k] for k in (
        "source_digest", "snapshot_digest")})
    assert response.status_code == 409
    assert response.json()["detail"] == "RAW_POLICY_INTEGRITY_FAILED"


def test_source_reference_count_limit_is_fail_closed(scenario, monkeypatch):
    monkeypatch.setattr(raw, "MAX_RUN_BINDINGS", 1)
    value = scenario[0]
    result = value[0].get(value[4] + "/raw-metadata")
    assert result.status_code == 422 and result.json()["detail"] == "RAW_BINDING_LOOKUP_LIMIT"


def test_policy_write_rechecks_real_identity_after_snapshot_validation(scenario, monkeypatch):
    value = scenario[0]
    original = raw.snapshot

    def revoke_after_parse(con, digest):
        result = original(con, digest)
        with sqlite3.connect(value[3]) as identity:
            identity.execute("UPDATE sessions SET absolute_expires_at=0")
        return result

    monkeypatch.setattr(raw, "snapshot", revoke_after_parse)
    result = post(scenario)
    assert result.status_code == 403
    with sqlite3.connect(value[2]) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_raw_policies'").fetchone()
