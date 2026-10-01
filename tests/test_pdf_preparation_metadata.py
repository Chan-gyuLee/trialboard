"""Read-only preparation discovery; synthetic parser and temporary TEAM database."""

import json
import sqlite3
from uuid import uuid4

import pytest
from test_pdf_preparation import post
from test_pdf_preparation import scenario as scenario
from test_project_acl import headers
from test_research_pdf_policy import SHA, assertion
from test_team_auth import login

from trialboard.research import pdf_preparation as prep
from trialboard.serialization import sha256_json


def listing(scenario):
    fixture, request, _ = scenario
    value, url, _ = fixture
    return value[0].get(url + "/pdf-preparations", params={
        "source_digest": request["source_digest"], "pdf_sha256": SHA})


@pytest.mark.parametrize("platform,status", [("darwin", "UNSUPPORTED_SANDBOX"),
                                            ("linux", "RUNTIME_CHECK_REQUIRED")])
def test_capabilities_has_exact_existing_limits_and_does_not_run_parser(scenario, monkeypatch,
                                                                     platform, status):
    value = scenario[0][0]
    before = value[2].read_bytes()
    monkeypatch.setattr(prep.sys, "platform", platform)
    response = value[0].get("/api/research/pdf-preparation-capabilities")
    assert response.status_code == 200
    assert response.json() == {"schema": "research-pdf-preparation-capabilities/1",
                               "status": status, "limits": prep.LIMITS}
    assert value[2].read_bytes() == before
    assert scenario[2]["parses"] == 0


def test_empty_and_existing_preparations_are_readonly_bodyless_and_storage_gated(scenario):
    fixture, request, state = scenario
    value, url, body = fixture
    client, _, database, _, base, _, provider, _ = value
    assert listing(scenario).json()["preparations"] == []
    artifact = post(scenario).json()
    before = database.read_bytes()
    response = listing(scenario)
    assert response.status_code == 200
    assert response.json() == {"schema": "research-pdf-preparation-list/1",
        "run_id": artifact["run_id"], "source_id": artifact["source_id"],
        "source_digest": request["source_digest"], "pdf_sha256": SHA,
        "preparations": [{k: artifact[k] for k in (
            "preparation_id", "preparation_digest", "created_at")} | {"page_count": 1}]}
    assert "Synthetic server-extracted text" not in response.text
    assert database.read_bytes() == before
    assert client.get(f"{base}/pdf-preparations/{artifact['preparation_id']}").json() == artifact
    assert state["parses"] == 1 and provider["calls"] == provider["factories"] == 0
    assert client.post(url + "/usage-policy", json=assertion(body, 1, "DENY"),
                       headers=headers(client)).status_code == 200
    assert listing(scenario).status_code == 403


def test_valid_viewer_can_discover_permitted_preparations(scenario):
    artifact = post(scenario).json()
    value = scenario[0][0]
    with sqlite3.connect(value[3]) as con:
        con.execute("UPDATE memberships SET role='viewer',permission_epoch=2")
    login(value[0])
    assert value[0].get("/api/auth/session").json()["role"] == "viewer"
    selected = listing(scenario).json()["preparations"][0]
    assert selected["preparation_id"] == artifact["preparation_id"]


def test_recent_thirty_and_total_scan_limit(scenario):
    artifact = post(scenario).json()
    database = scenario[0][0][2]
    with sqlite3.connect(database) as con:
        for index in range(30):
            copy = {**artifact, "preparation_id": str(uuid4()),
                    "created_at": f"2026-10-01T00:00:{index:02d}+00:00"}
            copy["preparation_digest"] = sha256_json(
                {k: v for k, v in copy.items() if k != "preparation_digest"})
            con.execute("INSERT INTO research_pdf_preparations VALUES (?,?,?)",
                        (copy["preparation_id"], copy["run_id"], json.dumps(copy)))
    listed = listing(scenario).json()["preparations"]
    assert len(listed) == 30
    assert listed == sorted(
        listed, key=lambda x: (x["created_at"], x["preparation_id"]), reverse=True)
    with sqlite3.connect(database) as con:
        for _ in range(970):
            copy = {**artifact, "preparation_id": str(uuid4())}
            copy["preparation_digest"] = sha256_json(
                {k: v for k, v in copy.items() if k != "preparation_digest"})
            con.execute("INSERT INTO research_pdf_preparations VALUES (?,?,?)",
                        (copy["preparation_id"], copy["run_id"], json.dumps(copy)))
    result = listing(scenario)
    assert result.status_code == 422 and result.json()["detail"] == "PDF_PREPARATION_LOOKUP_LIMIT"


def test_corrupt_row_binding_never_leaks_body(scenario):
    artifact = post(scenario).json()
    with sqlite3.connect(scenario[0][0][2]) as con:
        con.execute("INSERT INTO research_pdf_preparations VALUES (?,?,?)",
                    (str(uuid4()), artifact["run_id"], json.dumps(artifact)))
    result = listing(scenario)
    assert result.status_code == 409 and "Synthetic server-extracted text" not in result.text


def test_listing_and_get_revalidate_with_one_read_snapshot(scenario, monkeypatch):
    artifact = post(scenario).json()
    calls = []
    original = prep.raw_bytes

    def snapshot_checked(con, key):
        assert con.in_transaction
        calls.append(key)
        return original(con, key)

    monkeypatch.setattr(prep, "raw_bytes", snapshot_checked)
    assert listing(scenario).status_code == 200
    value = scenario[0][0]
    target = f"{value[4]}/pdf-preparations/{artifact['preparation_id']}"
    assert value[0].get(target).status_code == 200
    assert len(calls) == 2
