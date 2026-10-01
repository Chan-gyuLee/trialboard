"""Synthetic scout integrity and fresh-session publication boundaries; network/model zero."""

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from test_evidence_scout import data as data_fixture
from test_project_acl import headers
from test_team_auth import ORIGIN, login, make_team_app

from trialboard.api import scout


@pytest.mark.parametrize("change", ["none", "session", "role", "nct", "publication"])
def test_fetch_revalidation_and_exact_nct(tmp_path, monkeypatch, change):
    app, identity, root = make_team_app(tmp_path, enable_evidence_scout=True)
    calls = []

    async def fake(query):
        calls.append(query)
        if change in ("session", "role"):
            with sqlite3.connect(identity) as con:
                con.execute(
                    "UPDATE sessions SET revoked_at=1"
                    if change == "session"
                    else "UPDATE memberships SET role='viewer',permission_epoch=2"
                )
        return data_fixture.__wrapped__()

    monkeypatch.setattr(scout, "fetch_registry", fake)
    original_save = scout.EvidenceStore.save

    def save_then_revoke(self, *args, **kwargs):
        receipt = original_save(self, *args, **kwargs)
        with sqlite3.connect(identity) as con:
            con.execute("UPDATE sessions SET revoked_at=1")
        return receipt

    if change == "publication":
        monkeypatch.setattr(scout.EvidenceStore, "save", save_then_revoke)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        team = client.get("/api/teams/current").json()["id"]
        response = client.post(
            "/api/evidence-scout/search",
            headers=headers(client),
            json={
                "query": "NCT00000002" if change == "nct" else "NCT00000001",
                "public_query_confirmed": True,
            },
        )
        assert response.status_code == 200 and len(calls) == 1
        events = [json.loads(line) for line in response.text.splitlines()]
        assert events[-1]["stage"] == ("COMPLETE" if change == "none" else "ERROR")
        path = root / team / "evidence.sqlite3"
        if change == "publication":
            assert "MOC test trial" not in response.text
            with sqlite3.connect(path) as con:
                assert con.execute("SELECT count(*) FROM searches").fetchone()[0] == 1
        elif change != "none":
            assert not path.exists()
            assert "MOC test trial" not in response.text
        else:
            saved = client.get("/api/evidence-scout/searches/" + events[-1]["receipt"]["id"])
            assert saved.status_code == 200 and saved.json() == events[-1]["receipt"]


@pytest.mark.parametrize("change", ["raw", "receipt", "row-id", "row-time", "row-digest"])
def test_stored_snapshot_receipt_and_sql_binding_tamper_fail_closed(tmp_path, change):
    store = scout.EvidenceStore(tmp_path / "test.sqlite3")
    data = data_fixture.__wrapped__()
    receipt = store.save("synthetic", data, scout.normalize(data))
    with sqlite3.connect(store.path) as con:
        if change == "raw":
            con.execute("UPDATE snapshots SET raw='{}'")
        elif change == "receipt":
            value = dict(receipt, query="altered")
            con.execute("UPDATE searches SET receipt=?", (json.dumps(value),))
        else:
            column = {"row-id": "id", "row-time": "created_at", "row-digest": "digest"}[change]
            con.execute(f"UPDATE searches SET {column}=?", ("f" * 64,))
    with pytest.raises(ValueError, match="INTEGRITY"):
        store.read()


@pytest.mark.parametrize(
    "change", ["title", "total_count", "fetched_count", "truncated", "mode", "clinical_verified"]
)
def test_legacy_receipt_reconstruction_and_readonly_lookup(tmp_path, change):
    store = scout.EvidenceStore(tmp_path / "test.sqlite3")
    data = data_fixture.__wrapped__()
    receipt = store.save("synthetic", data, scout.normalize(data))
    with sqlite3.connect(store.path) as con:
        con.execute("DROP TABLE search_receipt_integrity")  # Synthetic pre-upgrade schema only.
    before = store.path.read_bytes()
    assert store.read(receipt["id"]) == receipt and store.path.read_bytes() == before
    with sqlite3.connect(store.path) as con:
        if change == "title":
            receipt["studies"][0]["title"] = "forged"
        else:
            receipt[change] = {
                "total_count": 9,
                "fetched_count": True,
                "truncated": False,
                "mode": "TRUSTED",
                "clinical_verified": True,
            }[change]
        con.execute("UPDATE searches SET receipt=?", (json.dumps(receipt),))
    with pytest.raises(ValueError, match="INTEGRITY"):
        store.read()


def test_precommit_authority_failure_rolls_back_snapshot_and_receipt(tmp_path):
    store = scout.EvidenceStore(tmp_path / "test.sqlite3")
    calls = []

    def authority():
        calls.append(1)
        if len(calls) == 2:
            raise ValueError("SCOUT_IDENTITY_INVALIDATED")

    data = data_fixture.__wrapped__()
    with pytest.raises(ValueError, match="IDENTITY"):
        store.save("synthetic", data, scout.normalize(data), authorize=authority)
    assert store.read() == []
    with sqlite3.connect(store.path) as con:
        assert con.execute("SELECT count(*) FROM snapshots").fetchone()[0] == 0


@pytest.mark.parametrize("history", [False, True])
def test_read_revalidates_after_thread_before_body_publication(tmp_path, monkeypatch, history):
    app, identity, root = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        team = client.get("/api/teams/current").json()["id"]
        (root / team).mkdir(mode=0o700, exist_ok=True)
        store = scout.EvidenceStore(root / team / "evidence.sqlite3")
        data = data_fixture.__wrapped__()
        receipt = store.save("synthetic", data, scout.normalize(data))
        original = scout.EvidenceStore.read

        def read_then_revoke(self, *args):
            result = original(self, *args)
            with sqlite3.connect(identity) as con:
                con.execute("UPDATE sessions SET revoked_at=1")
            return result

        monkeypatch.setattr(scout.EvidenceStore, "read", read_then_revoke)
        response = client.get(
            "/api/evidence-scout/searches" + ("" if history else "/" + receipt["id"])
        )
        assert response.status_code == 403 and "MOC test trial" not in response.text
