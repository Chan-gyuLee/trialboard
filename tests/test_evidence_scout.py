"""Synthetic transport fixtures; never live network or a model during unit tests."""

import asyncio
import hashlib
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from trialboard.api import scout
from trialboard.api.app import create_app


@pytest.fixture
def data():
    return {
        "totalCount": 2,
        "nextPageToken": "next",
        "studies": [
            {
                "protocolSection": {
                    "identificationModule": {
                        "nctId": "NCT00000001",
                        "briefTitle": "MOC test trial",
                    },
                    "conditionsModule": {"conditions": ["MOC condition"]},
                    "designModule": {"enrollmentInfo": {"count": 12, "type": "ESTIMATED"}},
                },
                "hasResults": False,
            }
        ],
    }


@pytest.fixture
def client(tmp_path, monkeypatch, data):
    async def fetch(query):
        return data

    monkeypatch.setattr(scout, "fetch_registry", fetch)
    with TestClient(
        create_app(enable_evidence_scout=True, evidence_db=tmp_path / "db.sqlite"),
        base_url="http://localhost",
    ) as c:
        yield c


def run(client, query="public-drug"):
    r = client.post(
        "/api/evidence-scout/search", json={"query": query, "public_query_confirmed": True}
    )
    assert r.status_code == 200
    return [json.loads(line) for line in r.text.splitlines()]


def test_disabled_by_default_no_storage(tmp_path):
    with TestClient(create_app(evidence_db=tmp_path / "unused"), base_url="http://localhost") as c:
        assert c.get("/api/evidence-scout/capabilities").json()["enabled"] is False
        assert c.get("/api/evidence-scout/searches").status_code == 404
    assert not (tmp_path / "unused").exists()


def test_stream_saved_receipt_and_reload(client):
    events = run(client)
    assert [e["stage"] for e in events] == ["SEARCHING", "COLLECTED", "SAVING", "COMPLETE"]
    receipt = events[-1]["receipt"]
    assert receipt["truncated"] and receipt["fetched_count"] == 1
    assert receipt["clinical_verified"] is False
    assert receipt["mode"] == "LIVE_PUBLIC"
    assert receipt["studies"][0]["enrollment"]["type"] == "ESTIMATED"
    assert receipt["studies"][0]["results_available"] is False
    assert client.get(f"/api/evidence-scout/searches/{receipt['id']}").json() == receipt
    history = client.get("/api/evidence-scout/searches").json()
    assert history[0]["id"] == receipt["id"] and "studies" not in history[0]
    assert client.get("/health").json()["persisted"] is True


def test_content_addressed_snapshots_preserve_history(tmp_path, data):
    path = tmp_path / "db.sqlite"
    store = scout.EvidenceStore(path)
    first = store.save("drug", data, scout.normalize(data))
    second = store.save("drug", data, scout.normalize(data))
    assert first["id"] != second["id"] and first["digest"] == second["digest"]
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 1
        raw = db.execute("SELECT raw FROM snapshots").fetchone()[0]
        assert hashlib.sha256(raw.encode()).hexdigest() == first["digest"]
    data["studies"][0]["protocolSection"]["identificationModule"]["briefTitle"] = "MOC changed"
    third = store.save("drug", data, scout.normalize(data))
    assert third["digest"] != first["digest"]
    assert scout.EvidenceStore(path).read(first["id"]) == first


@pytest.mark.parametrize(
    "query",
    [
        " ",
        "https://evil.invalid",
        "NCT12",
        "x" * 101,
        "AREA[ConditionSearch]cancer",
        "drug\nprivate",
    ],
)
def test_invalid_query_never_searches(client, query):
    assert (
        client.post(
            "/api/evidence-scout/search", json={"query": query, "public_query_confirmed": True}
        ).status_code
        == 422
    )


def test_consent_and_origin(client):
    assert (
        client.post(
            "/api/evidence-scout/search", json={"query": "drug", "public_query_confirmed": False}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/evidence-scout/search",
            headers={"Origin": "https://evil.invalid"},
            json={"query": "drug", "public_query_confirmed": True},
        ).status_code
        == 403
    )
    assert client.get("/api/evidence-scout/searches/does-not-exist").status_code == 404


def test_failure_does_not_fabricate_results_and_releases_slot(client, monkeypatch):
    async def broken(query):
        raise TimeoutError("private transport detail")

    monkeypatch.setattr(scout, "fetch_registry", broken)
    for _ in range(2):
        events = run(client)
        assert events[-1]["stage"] == "ERROR"
        assert "private transport detail" not in json.dumps(events)
    assert client.get("/api/evidence-scout/searches").json() == []


def test_empty_search_is_not_collection_failure(client, data):
    data.clear()
    data.update(studies=[], totalCount=0)
    receipt = run(client)[-1]["receipt"]
    assert receipt["fetched_count"] == 0 and receipt["truncated"] is False


def test_invalid_registry_id_and_duplicates(data):
    data["studies"] *= 2
    with pytest.raises(ValueError):
        scout.normalize(data)
    data["studies"] = data["studies"][:1]
    data["studies"][0]["protocolSection"]["identificationModule"]["nctId"] = "javascript:bad"
    with pytest.raises(ValueError):
        scout.normalize(data)


@pytest.mark.parametrize("query,nct", [("AMG 510", False), ("nct03600883", True)])
def test_registry_transport_fixed_host_encoded_query(monkeypatch, query, nct):
    original = httpx.AsyncClient
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={} if nct else {"studies": [], "totalCount": 0})

    monkeypatch.setattr(
        scout.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    data = asyncio.run(scout.fetch_registry(query))
    assert requests[0].url.host == "clinicaltrials.gov"
    if nct:
        assert requests[0].url.path.endswith("/NCT03600883")
        assert data == {"studies": [{}], "totalCount": 1}
    else:
        assert requests[0].url.params["query.intr"] == "AMG 510"
        assert requests[0].url.params["pageSize"] == "20"


@pytest.mark.parametrize(
    "status,body", [(302, b""), (200, b"bad json"), (200, b"x" * (scout.MAX_BYTES + 1))]
)
def test_registry_rejects_redirect_bad_json_and_oversize(monkeypatch, status, body):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        scout.httpx,
        "AsyncClient",
        lambda **kw: original(
            transport=httpx.MockTransport(lambda r: httpx.Response(status, content=body)), **kw
        ),
    )
    with pytest.raises((ValueError, httpx.HTTPError)):
        asyncio.run(scout.fetch_registry("drug"))


def test_missing_nct_is_empty_not_fake_successful_trial(monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        scout.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(lambda r: httpx.Response(404)), **kw),
    )
    assert asyncio.run(scout.fetch_registry("NCT00000000")) == {"studies": [], "totalCount": 0}
