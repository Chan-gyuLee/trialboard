"""MOC durable pipeline: real contracts/engine/storage, scripted model and PDF bytes."""

import hashlib
import json
from threading import BoundedSemaphore

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.provider import Reply
from trialboard.api.automation import automation_router
from trialboard.research.automation import AutomationStore, Preparation
from trialboard.research.models import Collection, ResearchRequest, Source

ORIGIN = {"Origin": "http://127.0.0.1:5173"}
RUN = "00000000-0000-4000-8000-000000000001"
RAW = b"%PDF-1.7\nMOC synthetic bytes, not a real parsed PDF"
HASH = hashlib.sha256(RAW).hexdigest()


def document():
    span = {
        "id": "p42-i0",
        "page": 42,
        "item": 0,
        "text": "MOC drug 10 mg",
        "box": {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.1},
    }
    return {
        "status": "READY",
        "sourceId": "doc_1",
        "attempts": [{"sourceId": "doc_1", "status": "READY"}],
        "source": {
            "schemaVersion": "pdf-evidence-window/1",
            "name": "MOC.pdf",
            "sha256": HASH,
            "byteLength": len(RAW),
            "extractor": "MOC",
            "pages": [
                {
                    "number": 42,
                    "width": 100,
                    "height": 100,
                    "rotation": 0,
                    "spans": [span],
                    "status": "TEXT_EXTRACTED",
                }
            ],
            "status": "TEXT_EXTRACTED",
            "coordinateSystem": "normalized_top_left_rotated_viewport",
        },
        "coverage": {
            "policy": "lexical-pages/1",
            "totalPages": 43,
            "scannedPages": list(range(1, 44)),
            "retainedPages": [42],
            "omittedPages": [p for p in range(1, 44) if p != 42],
            "noTextPages": [],
            "clinicalReview": "NOT_PERFORMED",
            "selection": [{"page": 42, "score": 1, "signals": ["용량·투여"]}],
        },
        "candidates": [
            {
                "spanId": "p42-i0",
                "page": 42,
                "text": span["text"],
                "score": 4,
                "reasons": ["용량·투여 단위"],
            }
        ],
        "input": {
            "asset": "MOC drug",
            "indication": "MOC tumor",
            "study": "NCT00000001",
            "question": "MOC question",
            "provenance": "user_pdf_export_unverified",
            "spans": [
                {
                    "id": span["id"],
                    "page": 42,
                    "text": span["text"],
                    "source_digest": HASH,
                    "locator": None,
                }
            ],
        },
    }


class Model:
    mode = "SCRIPTED_TEST_DOUBLE"
    model = "MOC"

    def __init__(self):
        self.calls = 0

    async def complete(self, **kwargs):
        self.calls += 1
        return Reply(value={"observations": []}, response_id="moc", input_tokens=1, output_tokens=1)


@pytest.fixture
def setup(tmp_path):
    path = tmp_path / "automation.sqlite"
    store = AutomationStore(path)
    run = Collection(
        id=RUN,
        project_id="a" * 64,
        created_at="2026-09-16T00:00:00Z",
        request=ResearchRequest(
            search_id=RUN,
            nct_id="NCT00000001",
            asset="MOC drug",
            indication="MOC tumor",
            public_consent=True,
            model_consent=True,
        ),
        status="COMPLETE",
        sources=[
            Source(
                id="doc_1",
                kind="SAP",
                title="MOC SAP",
                url="https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/SAP_001.pdf",
                text="",
                content_level="PDF_AVAILABLE",
                link_basis=["REGISTRY_DOCUMENT"],
                identifiers={"nct": "NCT00000001"},
                fetched_at="2026-09-16T00:00:00Z",
                digest="b" * 64,
            )
        ],
        coverage=[],
        events=[],
        execution_mode="SCRIPTED_TEST_DOUBLE",
    )
    store.save_run(run)
    con = store.connect()
    with con:
        con.execute("CREATE TABLE public_pdf_blobs (digest TEXT PRIMARY KEY,content BLOB)")
        con.execute("CREATE TABLE public_pdf_receipts (run_id TEXT,source_id TEXT,digest TEXT)")
        con.execute("INSERT INTO public_pdf_blobs VALUES (?,?)", (HASH, RAW))
        con.execute("INSERT INTO public_pdf_receipts VALUES (?,?,?)", (RUN, "doc_1", HASH))
    con.close()
    model, slot = Model(), BoundedSemaphore(1)
    app = FastAPI()
    app.include_router(automation_router(path, slot, lambda: model))
    return path, store, model, slot, TestClient(app)


def test_preparation_preserves_sparse_pages_and_is_idempotent(setup):
    path, store, _, _, _ = setup
    doc = Preparation.model_validate(document())
    first = store.prepare(RUN, doc)
    assert first == AutomationStore(path).prepare(RUN, doc)
    assert first["document"]["source"]["pages"][0]["number"] == 42
    assert first["textVerifiedAgainstPdf"] is False
    changed = document()
    changed["input"]["question"] = "Another MOC question"
    with pytest.raises(ValueError, match="VERSION_CONFLICT"):
        store.prepare(RUN, Preparation.model_validate(changed))


@pytest.mark.parametrize(
    "mutation",
    [
        lambda d: d["source"]["pages"][0].update(number=1),
        lambda d: d["coverage"].update(retainedPages=[1]),
        lambda d: d["coverage"].update(scannedPages=[42]),
        lambda d: d["coverage"].update(omittedPages=[]),
        lambda d: d["coverage"].update(noTextPages=[42]),
        lambda d: d["source"]["pages"][0]["spans"][0].update(id="p1-i0"),
        lambda d: d["input"]["spans"][0].update(text="invented MOC text"),
        lambda d: d["input"]["spans"][0].update(source_digest="c" * 64),
        lambda d: d["candidates"][0].update(page=1),
        lambda d: d["coverage"].update(clinicalReview="APPROVED"),
        lambda d: d["source"].update(schemaVersion="pdf-evidence/1"),
        lambda d: d["source"].update(status="NO_TEXT"),
        lambda d: d["input"].update(provenance="synthetic_fixture"),
    ],
)
def test_invalid_window_never_saved(setup, mutation):
    _, _, model, _, client = setup
    doc = document()
    mutation(doc)
    response = client.post(
        f"/api/research/runs/{RUN}/automation",
        json={"document": doc, "consent": True},
        headers=ORIGIN,
    )
    assert response.status_code == 422
    assert client.get(f"/api/research/runs/{RUN}/automation").json() is None
    assert model.calls == 0


def test_original_receipt_and_context_are_required(setup):
    _, store, _, _, _ = setup
    doc = document()
    doc["input"]["asset"] = "Other MOC drug"
    with pytest.raises(ValueError, match="CONTEXT"):
        store.prepare(RUN, Preparation.model_validate(doc))
    con = store.connect()
    with con:
        con.execute("DELETE FROM public_pdf_receipts")
    con.close()
    with pytest.raises(ValueError, match="ORIGINAL"):
        store.prepare(RUN, Preparation.model_validate(document()))


def test_end_to_end_persists_report_and_never_repeats_paid_work(setup):
    path, store, model, slot, client = setup
    base = f"/api/research/runs/{RUN}/automation"
    assert (
        client.post(
            base, json={"document": document(), "consent": True}, headers=ORIGIN
        ).status_code
        == 200
    )
    response = client.post(base + "/run", json={"consent": True}, headers=ORIGIN)
    assert response.status_code == 200
    events = [json.loads(x[6:]) for x in response.text.split("\n\n") if x.startswith("data: ")]
    assert events[-1]["type"] == "result"
    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
    saved = AutomationStore(path).get(RUN)
    assert saved["status"] == "NEEDS_EVIDENCE"
    assert saved["report"]["accepted"] == []
    assert saved["decision"]["simulationExecuted"] is False
    assert saved["events"][0]["execution_mode"] == "SCRIPTED_TEST_DOUBLE"
    assert client.post(base + "/run", json={"consent": True}, headers=ORIGIN).status_code == 409
    assert store.prepare(RUN, Preparation.model_validate(document()))["status"] == "NEEDS_EVIDENCE"
    assert model.calls == 1
    assert slot.acquire(blocking=False)
    slot.release()


def test_consent_origin_and_slot_before_model(setup):
    _, store, model, slot, client = setup
    store.prepare(RUN, Preparation.model_validate(document()))
    url = f"/api/research/runs/{RUN}/automation/run"
    assert client.post(url, json={"consent": True}).status_code == 403
    for consent in [False, 1, "true"]:
        assert client.post(url, json={"consent": consent}, headers=ORIGIN).status_code == 422
    slot.acquire()
    assert client.post(url, json={"consent": True}, headers=ORIGIN).status_code == 429
    slot.release()
    assert model.calls == 0


def test_restart_marks_interrupted_without_reexecution(setup):
    path, store, model, _, client = setup
    store.prepare(RUN, Preparation.model_validate(document()))
    store.transition(RUN, "PREPARED", "RUNNING")
    AutomationStore(path).interrupt_stale()
    assert store.get(RUN)["status"] == "INTERRUPTED"
    response = client.post(
        f"/api/research/runs/{RUN}/automation/run", json={"consent": True}, headers=ORIGIN
    )
    assert response.status_code == 409
    assert model.calls == 0


def test_private_provider_never_used_as_fallback(setup):
    _, store, model, slot, client = setup
    store.prepare(RUN, Preparation.model_validate(document()))
    model.mode = "CODEX_CHATGPT"
    response = client.post(
        f"/api/research/runs/{RUN}/automation/run", json={"consent": True}, headers=ORIGIN
    )
    assert response.status_code == 409
    assert model.calls == 0
    assert store.get(RUN)["status"] == "PREPARED"
    assert slot.acquire(blocking=False)
    slot.release()


def test_supported_drafts_still_require_review_not_automatic_clinical_approval(setup):
    _, store, model, _, client = setup
    doc = document()
    demo = demo_input()
    spans = []
    for i, span in enumerate(demo.spans):
        text = (
            span.text.replace(demo.asset, "MOC drug")
            .replace(demo.indication, "MOC tumor")
            .replace(demo.study, "NCT00000001")
        )
        spans.append(
            {**doc["source"]["pages"][0]["spans"][0], "id": f"p42-i{i}", "item": i, "text": text}
        )
    doc["source"]["pages"][0]["spans"] = spans
    doc["candidates"] = [
        {**doc["candidates"][0], "spanId": s["id"], "text": s["text"]}
        for s in (spans[0], spans[-1])
    ]
    doc["input"]["spans"] = [
        {"id": s["id"], "page": 42, "source_digest": HASH, "text": s["text"], "locator": None}
        for s in spans
    ]
    store.prepare(RUN, Preparation.model_validate(doc))
    scripted = ScriptedProvider()
    model.complete = scripted.complete
    response = client.post(
        f"/api/research/runs/{RUN}/automation/run", json={"consent": True}, headers=ORIGIN
    )
    assert response.status_code == 200
    saved = store.get(RUN)
    assert saved["status"] == "REVIEW_REQUIRED"
    assert len(saved["report"]["accepted"]) == 4
    assert len(saved["report"]["calls"]) == 2
    assert saved["decision"]["clinicalApproved"] is False
    assert saved["decision"]["simulationExecuted"] is False


def test_provider_error_persists_safe_failure_and_releases_slot(setup):
    _, store, model, slot, client = setup
    store.prepare(RUN, Preparation.model_validate(document()))

    async def explode(**kwargs):
        raise RuntimeError("MOC secret diagnostic must not leak")

    model.complete = explode
    response = client.post(
        f"/api/research/runs/{RUN}/automation/run", json={"consent": True}, headers=ORIGIN
    )
    assert "MOC secret" not in response.text
    assert store.get(RUN)["status"] == "FAILED"
    assert "MOC secret" not in json.dumps(store.get(RUN))
    assert slot.acquire(blocking=False)
    slot.release()


def test_expanded_body_limit_is_specific_and_disabled_without_feature(tmp_path):
    from trialboard.api.app import create_app

    body = json.dumps({"document": "MOC" * 15000, "consent": True})
    headers = {**ORIGIN, "Content-Type": "application/json"}
    with TestClient(
        create_app(
            enable_evidence_scout=True,
            enable_pdf_agent=True,
            evidence_db=tmp_path / "boundary.sqlite",
        ),
        base_url="http://127.0.0.1",
    ) as client:
        assert (
            client.post(
                f"/api/research/runs/{RUN}/automation", content=body, headers=headers
            ).status_code
            == 422
        )
        assert client.post("/api/reviews", content=body, headers=headers).status_code == 413
        assert (
            client.post(
                f"/api/research/runs/{RUN}/automation/run", content=body, headers=headers
            ).status_code
            == 413
        )
    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        assert (
            client.post(
                f"/api/research/runs/{RUN}/automation", content=body, headers=headers
            ).status_code
            == 413
        )
