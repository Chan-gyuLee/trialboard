"""PDF_BYTES gates use synthetic byte strings and in-memory fetches only."""

import hashlib
import json
import sqlite3
from uuid import uuid4

import pytest
from test_project_acl import headers
from test_saved_research_review import scenario as base_scenario
from test_team_auth import login

from trialboard.research.store import ResearchStore

RAW = b"%PDF-1.4\nSynthetic permission fixture only.\n%%EOF"
SHA = hashlib.sha256(RAW).hexdigest()


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    generator = base_scenario.__wrapped__(tmp_path, monkeypatch)
    value = next(generator)
    client, run, database, _, base, _, state, _ = value
    run.sources[0].pdf_url = "https://clinicaltrials.gov/synthetic.pdf"
    run.sources[0].digest = "a" * 64  # New immutable source version after adding the PDF URL.
    ResearchStore(database).save_run(run)
    state["fetches"], state["fetch_after"] = 0, lambda: None

    async def fetch(_url):
        state["fetches"] += 1
        state["fetch_after"]()
        return RAW

    monkeypatch.setattr("trialboard.api.research.download_pdf", fetch)
    url = f"{base}/documents/{run.sources[0].id}"
    body = {"consent": True, "source_digest": run.sources[0].digest,
            "storage_permission": {"original_storage": "ALLOW",
                                   "evidence_reference": "Synthetic permission",
                                   "reason": "Synthetic bytes are permitted for this test."}}
    yield value, url, body
    try:
        next(generator)
    except StopIteration:
        pass


def download(scenario, body=None):
    value, url, default = scenario
    return value[0].post(url, json=default if body is None else body, headers=headers(value[0]))


def assertion(body, revision, storage="ALLOW"):
    return {"source_digest": body["source_digest"], "pdf_sha256": SHA,
            "expected_policy_revision": revision, "original_storage": storage,
            "internal_search": "UNKNOWN", "external_ai": "UNKNOWN", "training": "UNKNOWN",
            "evidence_reference": "Synthetic permission", "reason": "Synthetic policy revision"}


def test_explicit_download_creates_exact_storage_only_and_gates_cached_cas(scenario):
    value, url, body = scenario
    client, run, database, _, base, _, state, _ = value
    result = download(scenario)
    assert result.status_code == 200, result.text
    assert result.content == RAW and result.headers["X-Source-Sha256"] == SHA
    assert state["fetches"] == 1 and state["calls"] == 0
    meta = client.get(f"{base}/pdf-metadata").json()
    assert "Synthetic permission fixture only" not in json.dumps(meta)
    assert "https://" not in json.dumps(meta)
    version = meta["sources"][0]["cached_versions"][0]
    assert version["binding_status"] == "EXACT"
    assert version["usage_policy"]["original_storage"] == "ALLOW"
    assert all(version["usage_policy"][p] == "UNKNOWN"
               for p in ("internal_search", "external_ai", "training"))
    assert client.get(f"{url}/cached?sha256={SHA}").content == RAW
    assert download(scenario, {"consent": True}).content == RAW
    assert state["fetches"] == 1
    denied = client.post(f"{url}/usage-policy", json=assertion(body, 1, "DENY"),
                         headers=headers(client))
    assert denied.status_code == 200 and len(denied.json()["history"]) == 2
    assert client.get(f"{url}/cached?sha256={SHA}").status_code == 403
    assert download(scenario).status_code == 403  # No automatic rights resurrection.
    assert client.post(f"{url}/usage-policy", json=assertion(body, 1),
                       headers=headers(client)).status_code == 409
    assert state["fetches"] == 1
    with sqlite3.connect(database) as con:
        with pytest.raises(sqlite3.IntegrityError, match="IMMUTABLE"):
            con.execute("DELETE FROM research_pdf_policies")
    assert client.get(f"{base}/source-metadata").json()["sources"][0][
        "usage_policy"]["original_storage"] == "UNKNOWN"


@pytest.mark.parametrize("change", ["missing", "false", "int", "digest", "extra", "blank"])
def test_invalid_permission_calls_network_zero(scenario, change):
    value, _, body = scenario
    if change == "missing":
        body = {"consent": True}
    elif change == "false":
        body["consent"] = False
    elif change == "int":
        body["consent"] = 1
    elif change == "digest":
        body["source_digest"] = "f" * 64
    elif change == "extra":
        body["url"] = "https://example.org/injected"
    else:
        body["storage_permission"]["reason"] = "   "
    assert download(scenario, body).status_code in (409, 422)
    assert value[6]["fetches"] == value[6]["factories"] == 0


@pytest.mark.parametrize("change", ["expiry", "role", "source", "url"])
def test_change_during_fetch_saves_no_bytes_or_policy(scenario, change):
    value, _, _ = scenario
    _, run, database, identity_db, _, _, state, _ = value

    def change_after():
        if change in ("expiry", "role"):
            with sqlite3.connect(identity_db) as con:
                con.execute("UPDATE sessions SET absolute_expires_at=0" if change == "expiry"
                            else "UPDATE memberships SET role='viewer',permission_epoch=2")
        else:
            if change == "source":
                run.sources[0].digest = "f" * 64
            else:
                run.sources[0].pdf_url = "https://clinicaltrials.gov/changed.pdf"
            ResearchStore(database).save_run(run)

    state["fetch_after"] = change_after
    assert download(scenario).status_code in (403, 409)
    with sqlite3.connect(database) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='public_pdf_blobs'"
        ).fetchone()
    assert state["fetches"] == 1


def test_legacy_receipt_unknown_until_explicit_binding_and_cache_integrity(scenario):
    value, url, body = scenario
    client, run, database, _, base, _, state, _ = value
    with sqlite3.connect(database) as con:
        con.execute("CREATE TABLE public_pdf_blobs(digest TEXT PRIMARY KEY,content BLOB)")
        con.execute("CREATE TABLE public_pdf_receipts(run_id TEXT,source_id TEXT,digest TEXT)")
        con.execute("INSERT INTO public_pdf_blobs VALUES (?,?)", (SHA, RAW))
        con.execute("INSERT INTO public_pdf_receipts VALUES (?,?,?)",
                    (run.id, run.sources[0].id, SHA))
    meta = client.get(f"{base}/pdf-metadata").json()["sources"][0]["cached_versions"][0]
    assert meta["binding_status"] == "LEGACY_UNBOUND"
    assert meta["usage_policy"]["policy_revision"] == 0
    assert client.get(f"{url}/cached?sha256={SHA}").status_code == 403
    assert download(scenario).status_code == 403
    allowed = client.post(f"{url}/usage-policy", json=assertion(body, 0), headers=headers(client))
    assert allowed.status_code == 200, allowed.text
    assert client.get(f"{url}/cached?sha256={SHA}").content == RAW
    with sqlite3.connect(database) as con:
        con.execute("UPDATE public_pdf_blobs SET content=?", (b"%PDF-broken",))
    assert client.get(f"{url}/cached?sha256={SHA}").status_code == 409
    assert download(scenario, {"consent": True}).status_code == 409
    assert state["fetches"] == 0


def test_nonowner_reviewer_and_viewer_cannot_create_download_permission(scenario):
    value, _, _ = scenario
    client, _, _, identity_db, _, _, state, _ = value
    with sqlite3.connect(identity_db) as con:
        con.execute("UPDATE memberships SET role='reviewer',permission_epoch=2")
    assert login(client).status_code == 200
    assert download(scenario).status_code == 403  # Synthetic legacy run has no owner.
    with sqlite3.connect(identity_db) as con:
        con.execute("UPDATE memberships SET role='viewer',permission_epoch=3")
    assert login(client).status_code == 200
    assert download(scenario).status_code == 403
    assert state["fetches"] == 0


def test_actual_cross_team_pdf_metadata_policy_and_bytes_are_not_accessible(scenario):
    value, url, body = scenario
    client, _, database, identity_db, base, _, state, _ = value
    assert download(scenario).status_code == 200
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
    assert client.get(f"{base}/pdf-metadata").status_code == 404
    assert client.get(f"{url}/cached?sha256={SHA}").status_code == 404
    assert client.get(f"{url}/usage-policy", params={
        "source_digest": body["source_digest"], "pdf_sha256": SHA,
    }).status_code == 404
    assert download(scenario).status_code == 404
    assert not (database.parent.parent / team_b).exists()
    assert state["fetches"] == 1
