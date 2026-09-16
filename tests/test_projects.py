"""Local checkpoint storage with synthetic fixtures; no network/model/clinical evaluation."""

import base64
import copy
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from test_field_revalidation import sample

from trialboard.api.app import create_app
from trialboard.api.projects import CheckpointInput, ProjectStore
from trialboard.api.scout import EvidenceStore, normalize
from trialboard.research.models import ResearchRequest
from trialboard.research.store import ResearchStore

ORIGIN = {"Origin": "http://127.0.0.1:5173"}


@pytest.fixture
def payload():
    f = sample()
    source = f["source"]["source"]
    bundle = {
        "schema": "trialboard-project/1",
        "source": source,
        "notes": [],
        "reviewRaw": json.dumps(f["review"]),
        "draftRaw": json.dumps(
            {"schema_version": "design-draft/1", "source_digest": source["sha256"]}
        ),
        "meetingRaw": None,
        "agentRaw": None,
        "context": None,
    }
    return {
        "consent": True,
        "expected_revision": 0,
        "project_id": None,
        "title": "MOC checkpoint",
        "pdf_base64": base64.b64encode(f["pdf"]).decode(),
        "bundle_json": json.dumps(bundle),
    }


def test_append_restore_deduplicate_and_process_restart(tmp_path, payload):
    path = tmp_path / "project.sqlite"
    first = ProjectStore(path).save(CheckpointInput(**payload))
    second_input = {
        **payload,
        "project_id": first["project_id"],
        "expected_revision": 1,
        "title": "MOC v2",
    }
    second = ProjectStore(path).save(CheckpointInput(**second_input))
    assert second["revision"] == 2
    store = ProjectStore(path)
    assert store.read(first["project_id"], 1)["bundle_json"] == payload["bundle_json"]
    assert store.read(first["project_id"], 2)["pdf_base64"] == payload["pdf_base64"]
    assert store.history()[0]["title"] == "MOC v2"
    con = store.connect()
    try:
        assert con.execute("SELECT COUNT(*) FROM project_pdfs").fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM project_checkpoints").fetchone()[0] == 2
    finally:
        con.close()


def test_concurrent_stale_writes_do_not_overwrite(tmp_path, payload):
    store = ProjectStore(tmp_path / "project.sqlite")
    first = store.save(CheckpointInput(**payload))
    body = CheckpointInput(**{**payload, "project_id": first["project_id"], "expected_revision": 1})

    def save():
        try:
            return store.save(body)["revision"]
        except ValueError as e:
            return str(e)

    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _: save(), range(2)))
    assert sorted(map(str, replies)) == ["2", "PROJECT_VERSION_CONFLICT"]


@pytest.mark.parametrize(
    "mutation", ["digest", "review", "schema", "approval", "context", "agent", "duplicate", "pdf"]
)
def test_reject_mismatched_checkpoint(tmp_path, payload, mutation):
    body = copy.deepcopy(payload)
    bundle = json.loads(body["bundle_json"])
    if mutation == "digest":
        bundle["source"]["sha256"] = "a" * 64
    elif mutation == "review":
        review = json.loads(bundle["reviewRaw"])
        review["sourceDigest"] = "a" * 64
        bundle["reviewRaw"] = json.dumps(review)
    elif mutation == "schema":
        bundle["schema"] = "APPROVED"
    elif mutation == "approval":
        review = json.loads(bundle["reviewRaw"])
        review["clinicalApproval"] = True
        bundle["reviewRaw"] = json.dumps(review)
    elif mutation == "context":
        bundle["context"] = {
            "asset": "a",
            "study": "NCT00000000",
            "question": "q",
            "indication": "i",
            "receiptId": "unknown",
        }
    elif mutation == "agent":
        bundle["agentRaw"] = "{}"
    elif mutation == "pdf":
        body["pdf_base64"] = base64.b64encode(b"%PDF-WRONG").decode()
    body["bundle_json"] = json.dumps(bundle)
    if mutation == "duplicate":
        body["bundle_json"] = body["bundle_json"].replace('"notes": []', '"notes": [], "notes": []')
    with pytest.raises(ValueError):
        ProjectStore(tmp_path / "project.sqlite").save(CheckpointInput(**body))


def test_tampered_disk_content_rejected(tmp_path, payload):
    store = ProjectStore(tmp_path / "project.sqlite")
    saved = store.save(CheckpointInput(**payload))
    con = store.connect()
    try:
        with con:
            con.execute("UPDATE project_checkpoints SET bundle_json='{}'")
    finally:
        con.close()
    with pytest.raises(ValueError, match="INTEGRITY"):
        store.read(saved["project_id"], 1)


def test_routes_consent_origin_limits_and_conflict(tmp_path, payload):
    app = create_app(enable_evidence_scout=True, evidence_db=tmp_path / "project.sqlite")
    with TestClient(app, base_url="http://127.0.0.1") as client:
        assert client.post("/api/projects", json=payload).status_code == 403
        assert (
            client.post(
                "/api/projects", headers={"Origin": "https://evil.example"}, json=payload
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/projects", headers=ORIGIN, json={**payload, "consent": False}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/projects", headers=ORIGIN, json={**payload, "token": "not-a-key"}
            ).status_code
            == 422
        )
        first = client.post("/api/projects", headers=ORIGIN, json=payload)
        assert first.status_code == 200, first.text
        r = first.json()
        saved = client.get(f"/api/projects/{r['project_id']}/1")
        assert saved.status_code == 200
        assert "no-store" in saved.headers["cache-control"]
        assert (
            hashlib.sha256(saved.json()["bundle_json"].encode()).hexdigest() == r["bundle_digest"]
        )
        assert (
            client.post(
                "/api/projects", headers=ORIGIN, json={**payload, "project_id": r["project_id"]}
            ).status_code
            == 409
        )
        assert client.get(f"/api/projects/{r['project_id']}/99").status_code == 404
        assert (
            client.post(
                "/api/projects",
                headers={
                    **ORIGIN,
                    "Content-Type": "application/json",
                    "Content-Length": str(49 * 1024**2),
                },
                content="{}",
            ).status_code
            == 413
        )
        assert (
            client.post(
                "/api/research/run",
                headers={**ORIGIN, "Content-Type": "application/json"},
                content=" " * 40000,
            ).status_code
            == 413
        )


def test_disabled_by_default(tmp_path):
    with TestClient(
        create_app(evidence_db=tmp_path / "unused.sqlite"), base_url="http://127.0.0.1"
    ) as client:
        assert client.get("/api/projects").status_code == 404
    assert not (tmp_path / "unused.sqlite").exists()


@pytest.mark.parametrize("document", [False, True])
def test_saved_research_context_links_only_existing_receipts(tmp_path, payload, document):
    path = tmp_path / "context.sqlite"
    raw = {
        "studies": [
            {
                "protocolSection": {
                    "identificationModule": {"nctId": "NCT00000001", "briefTitle": "MOC study"},
                    "conditionsModule": {"conditions": ["MOC condition"]},
                }
            }
        ],
        "totalCount": 1,
    }
    receipt = EvidenceStore(path).save("MOC drug", raw, normalize(raw))
    bundle = json.loads(payload["bundle_json"])
    context = {
        "asset": "MOC drug",
        "study": "NCT00000001",
        "indication": "MOC condition",
        "question": "MOC question",
        "receiptId": receipt["id"],
    }
    if document:
        research = ResearchStore(path)
        run = research.start(
            ResearchRequest(
                search_id=receipt["id"],
                nct_id="NCT00000001",
                asset="MOC drug",
                indication="MOC condition",
                public_consent=True,
                model_consent=False,
            )
        )
        context["document"] = {"runId": run.id, "sourceId": "moc_source", "title": "MOC receipt"}
        con = research.connect()
        try:
            with con:
                con.execute(
                    "CREATE TABLE public_pdf_receipts (run_id TEXT, source_id TEXT, digest TEXT)"
                )
                con.execute(
                    "INSERT INTO public_pdf_receipts VALUES (?,?,?)",
                    (run.id, "moc_source", bundle["source"]["sha256"]),
                )
        finally:
            con.close()
    bundle["context"] = context
    body = {**payload, "bundle_json": json.dumps(bundle)}
    assert ProjectStore(path).save(CheckpointInput(**body))["revision"] == 1
    if document:
        context["document"]["sourceId"] = "unknown"
    else:
        context["study"] = "NCT00000002"
    with pytest.raises(ValueError):
        ProjectStore(path).save(CheckpointInput(**{**payload, "bundle_json": json.dumps(bundle)}))


def test_copy_creates_new_project_without_replacing_original(tmp_path, payload):
    store = ProjectStore(tmp_path / "project.sqlite")
    first = store.save(CheckpointInput(**payload))
    second = store.save(CheckpointInput(**{**payload, "title": "MOC copy"}))
    assert first["project_id"] != second["project_id"]
    assert store.read(first["project_id"], 1)["title"] == payload["title"]
    assert len(store.history()) == 2
