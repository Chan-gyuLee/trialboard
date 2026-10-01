"""MOC connectors and provider: no network, credentials or clinical validation in these tests."""

import asyncio
import hashlib
import json
import sqlite3
from threading import BoundedSemaphore

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trialboard.agent.provider import Reply
from trialboard.api.research import research_router
from trialboard.api.scout import EvidenceStore, normalize
from trialboard.research import collect
from trialboard.research.agent import run_research
from trialboard.research.models import CurationInput, ResearchRequest
from trialboard.research.retry_queue import RetryQueue
from trialboard.research.store import ResearchStore

ORIGIN = {"Origin": "http://127.0.0.1:5173"}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    path = tmp_path / "evidence.sqlite"
    record = {
        "protocolSection": {
            "identificationModule": {"nctId": "NCT00000001", "briefTitle": "MOC trial"},
            "conditionsModule": {"conditions": ["MOC condition"]},
            "referencesModule": {"references": [{"pmid": "123", "type": "BACKGROUND"}]},
        },
        "documentSection": {
            "largeDocumentModule": {
                "largeDocs": [
                    {"filename": "Prot_000.pdf", "hasProtocol": True, "date": "2020-01-01"}
                ]
            }
        },
    }
    data = {"studies": [record], "totalCount": 1}
    receipt = EvidenceStore(path).save("MOC drug", data, normalize(data))
    request = ResearchRequest(
        search_id=receipt["id"],
        nct_id="NCT00000001",
        asset="MOC drug",
        indication="MOC condition",
        public_consent=True,
        model_consent=False,
    )
    queries = []

    async def registry(query):
        return data

    async def fetch(url, params):
        queries.append((url, params))
        if url == collect.FDA:
            return {
                "results": [
                    {
                        "application_number": "NDA123",
                        "submissions": [
                            {
                                "application_docs": [
                                    {
                                        "type": "Label",
                                        "date": "20250101",
                                        "url": "http://www.accessdata.fda.gov/drugsatfda_docs/label/2025/123lbl.pdf",
                                    }
                                ]
                            }
                        ],
                    }
                ],
                "meta": {"results": {"total": 1}},
            }
        return {
            "hitCount": 1,
            "resultList": {
                "result": [
                    {
                        "source": "MED",
                        "pmid": "123",
                        "title": "MOC <i>drug</i> trial",
                        "abstractText": (
                            "MOC findings: NCT00000001 uses 10 mg. This is a synthetic test."
                        ),
                        "firstPublicationDate": "2020-01-01",
                    }
                ]
            },
        }

    monkeypatch.setattr(collect, "fetch_registry", registry)
    monkeypatch.setattr(collect, "get_json", fetch)
    return path, request, queries


class FakeModel:
    mode = "SCRIPTED_TEST_DOUBLE"
    model = "MOC"

    def __init__(self, bad=False):
        self.calls = []
        self.bad = bad

    async def complete(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            value = {
                "followups": [
                    {"term": "adverse discontinuation", "intent": "CONTRARIAN"},
                    {"term": "dose comparison", "intent": "EVIDENCE_GAP"},
                ],
                "priorities": [{"source_id": "paper_123", "reason": "MOC priority"}],
                "missing_evidence": ["MOC second dose"],
            }
        else:
            source = next(s for s in kwargs["payload"]["sources"] if s["id"] == "paper_123")
            value = {
                "findings": [
                    {
                        "anchor_id": (
                            "unknown-anchor" if self.bad else source["segments"][0]["anchor_id"]
                        ),
                        "interpretation": "MOC interpretation, not clinical",
                    }
                ],
                "questions": ["MOC second-dose evidence?"],
                "conclusion": "NEEDS_EXPERT_REVIEW",
            }
        return Reply(value, f"MOC-{len(self.calls)}", 100, 50)


async def execute(path, request, provider=None, retry_queue=None):
    if provider is not None:
        request = request.model_copy(update={"model_consent": True})
    store = ResearchStore(path)
    run = store.start(request)

    async def emit(stage, message, **extra):
        run.events.append({"stage": stage, "message": message, **extra})
        store.save_run(run)

    await run_research(run, store, emit, provider, retry_queue=retry_queue)
    return run


def test_sources_deduplicate_without_promoting_background_to_trial_proof(setup):
    path, request, queries = setup
    run = asyncio.run(execute(path, request))
    assert run.status == "COMPLETE" and run.review is None
    assert len(run.sources) == 4 and len(queries) == 4
    paper = next(s for s in run.sources if s.id == "paper_123")
    assert "REGISTRY_REFERENCE_BACKGROUND" in paper.link_basis
    assert "NCT_IN_ABSTRACT" in paper.link_basis
    assert paper.content_level == "ABSTRACT" and paper.title == "MOC drug trial"
    assert all(s.raw_snapshots for s in run.sources)
    assert run.execution_mode == "COLLECTORS_ONLY"
    stored = ResearchStore(path).get_run(run.id)
    assert stored == run
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM research_links").fetchone()[0] >= 8
        assert db.execute("SELECT COUNT(*) FROM source_versions").fetchone()[0] == 4


def test_ai_plan_drives_real_followup_connector_and_cited_review(setup):
    path, request, queries = setup
    provider = FakeModel()
    run = asyncio.run(execute(path, request, provider))
    assert len(provider.calls) == 2
    assert any("dose comparison" in p.get("query", "") for _, p in queries)
    assert any("adverse discontinuation" in p.get("query", "") for _, p in queries)
    assert len(run.followup_executions) == 2
    assert run.followup_executions[0].intent == "CONTRARIAN"
    assert run.followup_executions[0].attempted is True
    receipt = run.coverage[run.followup_executions[0].coverage_index]
    assert receipt.query == run.followup_executions[0].query
    assert receipt.status == run.followup_executions[0].status
    assert run.review.findings[0].source_id == "paper_123"
    assert run.execution_mode == "SCRIPTED_TEST_DOUBLE"


def test_no_model_consent_runs_zero_followups_and_zero_model_calls(setup):
    path, request, queries = setup
    provider = FakeModel()
    store = ResearchStore(path)
    run = store.start(request)

    async def emit(stage, message, **extra):
        run.events.append({"stage": stage, "message": message, **extra})

    asyncio.run(run_research(run, store, emit, provider))
    assert provider.calls == []
    assert run.followup_executions == []
    assert not any("AI 추가" in p.get("query", "") for _, p in queries)


def test_new_followup_evidence_reaches_second_model_input(setup, monkeypatch):
    path, request, _ = setup
    original = collect.get_json

    async def fetch(url, params):
        result = await original(url, params)
        if "dose comparison" in params.get("query", ""):
            result["resultList"]["result"][0]["pmid"] = "999"
        return result

    monkeypatch.setattr(collect, "get_json", fetch)
    provider = FakeModel()
    run = asyncio.run(execute(path, request, provider))
    assert run.review is not None
    assert any(s["id"] == "paper_999" for s in provider.calls[1]["payload"]["sources"])


def test_changed_source_has_new_version_and_search_keeps_old_run(setup, monkeypatch):
    path, request, _ = setup
    first = asyncio.run(execute(path, request))
    original = collect.get_json

    async def updated(url, params):
        result = await original(url, params)
        if url == collect.EPMC:
            result["resultList"]["result"][0]["abstractText"] = "MOC revised 20 mg"
        return result

    monkeypatch.setattr(collect, "get_json", updated)
    second = asyncio.run(execute(path, request))
    store = ResearchStore(path)
    assert store.previous_changes(second)["changed"] == ["paper_123"]
    assert store.search_sources(first.id, "10 mg")
    assert not store.search_sources(second.id, "10 mg")
    assert store.search_sources(second.id, "20 mg")


def test_unsupported_citation_fails_closed_preserves_sources_and_plan(setup):
    path, request, _ = setup
    run = asyncio.run(execute(path, request, FakeModel(bad=True)))
    assert run.status == "PARTIAL" and run.review is None and run.plan is not None
    assert len(run.sources) == 4 and any("인용 검증" in n for n in run.notices)


def test_source_search_is_local_and_scoped_and_repeat_has_no_fake_changes(setup):
    path, request, queries = setup
    first = asyncio.run(execute(path, request))
    second = asyncio.run(execute(path, request))
    store = ResearchStore(path)
    calls = len(queries)
    assert store.search_sources(second.id, "10 mg")[0]["source_id"] == "paper_123"
    assert store.search_sources("missing", "10 mg") == []
    assert store.search_sources(second.id, '"); DROP TABLE source_versions; --') == []
    assert len(queries) == calls
    changes = store.previous_changes(second)
    assert changes["previous_id"] == first.id and changes["changed"] == []
    assert changes["added"] == [] and changes["not_retrieved"] == []


def test_recorded_direct_impact_is_exact_scoped_deduplicated_and_read_only(setup):
    path, request, _ = setup
    anchor = asyncio.run(execute(path, request, FakeModel()))
    exact = asyncio.run(execute(path, request, FakeModel()))
    inventory_only = asyncio.run(execute(path, request))
    different_version = asyncio.run(execute(path, request, FakeModel()))
    unrelated_project = asyncio.run(
        execute(path, request.model_copy(update={"asset": "Other MOC drug"}), FakeModel())
    )
    store = ResearchStore(path)
    anchor_source = next(source for source in anchor.sources if source.id == "paper_123")

    different_version.sources = [
        source.model_copy(update={"digest": "d" * 64})
        if source.id == "paper_123"
        else source
        for source in different_version.sources
    ]
    store.save_run(different_version)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    impact = store.recorded_direct_impact(anchor.id, anchor_source.id, anchor_source.digest)
    after = hashlib.sha256(path.read_bytes()).hexdigest()
    assert before == after
    assert impact["scope"] == "RECORDED_DIRECT_ONLY"
    assert impact["candidate_count"] == 1
    assert [candidate["run_id"] for candidate in impact["candidates"]] == [exact.id]
    assert impact["candidates"][0]["uses"] == [
        {"kind": "REVIEW_FINDING", "reference_count": 1},
        {"kind": "REVIEW_INPUT_PRIORITY", "reference_count": 1},
    ]
    assert inventory_only.id not in {candidate["run_id"] for candidate in impact["candidates"]}
    assert different_version.id not in {
        candidate["run_id"] for candidate in impact["candidates"]
    }
    assert unrelated_project.id not in {
        candidate["run_id"] for candidate in impact["candidates"]
    }
    assert any("PDF 바이트 지문" in caveat for caveat in impact["caveats"])
    assert any("다운스트림" in caveat for caveat in impact["caveats"])


def test_recorded_direct_impact_api_distinguishes_empty_missing_version_and_failure(setup):
    path, request, _ = setup
    anchor = asyncio.run(execute(path, request, FakeModel()))
    source = next(item for item in anchor.sources if item.id == "paper_123")
    app = FastAPI()
    app.include_router(research_router(path, BoundedSemaphore(1)))
    url = f"/api/research/runs/{anchor.id}/impact"
    params = {"source_id": source.id, "source_digest": source.digest}
    with TestClient(app) as client:
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        response = client.get(url, params=params)
        assert response.status_code == 200
        assert response.json()["candidate_count"] == 0
        assert hashlib.sha256(path.read_bytes()).hexdigest() == before
        assert client.get(url.replace(anchor.id, "missing"), params=params).status_code == 404
        assert client.get(url, params={**params, "source_id": "missing"}).status_code == 404
        mismatch = client.get(url, params={**params, "source_digest": "f" * 64})
        assert mismatch.status_code == 409
        malicious = client.get(url, params={**params, "source_id": "x' OR 1=1 --"})
        assert malicious.status_code == 404
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT COUNT(*) FROM research_runs WHERE id=?", (anchor.id,)
            ).fetchone()[0] == 1
            db.execute(
                "INSERT INTO research_runs VALUES (?, ?, ?, ?)",
                ("corrupt", anchor.project_id, "2026-09-30T00:00:00Z", "{}"),
            )
            db.execute(
                "INSERT INTO research_sources VALUES (?, ?, ?)",
                ("corrupt", source.id, source.digest),
            )
        failed = client.get(url, params=params)
        assert failed.status_code == 500
        assert failed.json() == {"detail": "IMPACT_LOOKUP_FAILED"}


def test_failed_connector_is_partial_not_zero_evidence(setup, monkeypatch):
    path, request, _ = setup

    async def failed(url, params):
        raise TimeoutError("sensitive diagnostics")

    monkeypatch.setattr(collect, "get_json", failed)
    run = asyncio.run(execute(path, request))
    assert run.status == "PARTIAL" and any(c.status == "FAILED" for c in run.coverage)
    assert "sensitive diagnostics" not in run.model_dump_json()
    assert len(run.sources) == 2


def test_failed_connector_enqueues_into_supplied_retry_queue(setup, monkeypatch):
    path, request, _ = setup

    async def failed(url, params):
        raise TimeoutError("sensitive diagnostics")

    monkeypatch.setattr(collect, "get_json", failed)
    queue = RetryQueue()
    run = asyncio.run(execute(path, request, retry_queue=queue))
    assert run.status == "PARTIAL"
    assert queue.pending()
    assert all(e.channel for e in queue.pending())
    assert "sensitive diagnostics" not in str(queue.all())


def test_no_retry_queue_supplied_is_a_no_op(setup, monkeypatch):
    path, request, _ = setup

    async def failed(url, params):
        raise TimeoutError("boom")

    monkeypatch.setattr(collect, "get_json", failed)
    run = asyncio.run(execute(path, request))
    assert run.status == "PARTIAL"


def test_failed_contrarian_search_is_attempted_but_not_success(setup, monkeypatch):
    path, request, _ = setup
    original = collect.get_json

    async def fail_contrarian(url, params):
        if "adverse discontinuation" in params.get("query", ""):
            raise TimeoutError("synthetic followup timeout")
        return await original(url, params)

    monkeypatch.setattr(collect, "get_json", fail_contrarian)
    run = asyncio.run(execute(path, request, FakeModel()))
    contrarian = run.followup_executions[0]
    assert contrarian.intent == "CONTRARIAN"
    assert contrarian.attempted is True and contrarian.status == "FAILED"
    assert run.status == "PARTIAL"
    assert "synthetic followup timeout" not in run.model_dump_json()


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.invalid/a.pdf",
        "http://127.0.0.1/a.pdf",
        "https://www.accessdata.fda.gov.evil.invalid/drugsatfda_docs/label/x.pdf",
        "https://u:p@www.accessdata.fda.gov/drugsatfda_docs/label/x.pdf",
        "https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/../secret.pdf",
        "https://www.accessdata.fda.gov/drugsatfda_docs/label/x.pdf?token=secret",
        "https://www.accessdata.fda.gov:invalid/drugsatfda_docs/label/x.pdf",
        "https://[broken/drugsatfda_docs/label/x.pdf",
    ],
)
def test_untrusted_document_urls_rejected(url):
    assert collect.safe_pdf(url) is None


def test_api_stream_restore_consent_context_and_model_slot(setup):
    path, request, _ = setup
    app = FastAPI()
    slot = BoundedSemaphore(1)
    app.include_router(research_router(path, slot, provider_factory=FakeModel))
    with TestClient(app) as client:
        payload = request.model_dump()
        assert client.post("/api/research/run", json=payload).status_code == 403
        wrong = {**payload, "nct_id": "NCT00000002"}
        assert client.post("/api/research/run", json=wrong, headers=ORIGIN).status_code == 422
        response = client.post("/api/research/run", json=payload, headers=ORIGIN)
        assert response.status_code == 200
        events = [json.loads(s[6:]) for s in response.text.split("\n\n") if s.startswith("data: ")]
        assert events[-1]["stage"] == "COMPLETE"
        assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
        run_id = events[-1]["run_id"]
        assert (
            client.get(f"/api/research/runs/{run_id}").json()["collection"]["status"] == "COMPLETE"
        )
        assert client.get(f"/api/research/runs/{run_id}/search?q=10%20mg").json()
        assert len(client.get("/api/research/runs").json()) == 1
        slot.acquire()
        try:
            assert (
                client.post(
                    "/api/research/run", json={**payload, "model_consent": True}, headers=ORIGIN
                ).status_code
                == 429
            )
        finally:
            slot.release()


def test_pdf_download_is_db_selected_and_hash_persisted(setup, monkeypatch):
    path, request, _ = setup
    run = asyncio.run(execute(path, request))
    import trialboard.api.research as api

    pdf = b"%PDF-1.7\nMOC fixture, not a rendered real document"
    calls = []

    async def download(url):
        calls.append(url)
        assert url.startswith("https://cdn.clinicaltrials.gov/")
        return pdf

    monkeypatch.setattr(api, "download_pdf", download)
    app = FastAPI()
    app.include_router(research_router(path, BoundedSemaphore(1)))
    with TestClient(app) as client:
        url = f"/api/research/runs/{run.id}/documents/doc_NCT00000001_Prot_000"
        assert client.post(url, json={}, headers=ORIGIN).status_code == 422
        assert client.post(url, json=[], headers=ORIGIN).status_code == 422
        assert client.post(url, content="bad-json", headers=ORIGIN).status_code == 422
        response = client.post(url, json={"consent": True}, headers=ORIGIN)
        assert response.content == pdf
        again = client.post(url, json={"consent": True}, headers=ORIGIN)
        assert again.content == pdf and again.headers["X-Source-Cache"] == "HIT"
        assert len(calls) == 1
        with sqlite3.connect(path) as db:
            raw = db.execute(
                "SELECT content FROM public_pdf_blobs WHERE digest=?",
                (response.headers["X-Source-Sha256"],),
            ).fetchone()[0]
            assert raw == pdf


def test_cached_pdf_is_exact_read_only_and_never_downloads(setup, monkeypatch):
    path, request, _ = setup
    run = asyncio.run(execute(path, request))
    import hashlib

    import trialboard.api.research as api

    async def forbidden(*args):
        raise AssertionError("cached GET must not download")

    monkeypatch.setattr(api, "download_pdf", forbidden)
    app = FastAPI()
    app.include_router(research_router(path, BoundedSemaphore(1)))
    raw = b"%PDF-1.7\nMOC exact saved version"
    digest = hashlib.sha256(raw).hexdigest()
    url = f"/api/research/runs/{run.id}/documents/doc_NCT00000001_Prot_000/cached"
    with TestClient(app) as client:
        assert client.get(url, params={"sha256": digest}).status_code == 404
        assert client.get(url, params={"sha256": "../invalid"}).status_code == 422
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE public_pdf_blobs (digest TEXT PRIMARY KEY, content BLOB)")
            db.execute(
                "CREATE TABLE public_pdf_receipts (run_id TEXT, source_id TEXT, digest TEXT)"
            )
            db.execute("INSERT INTO public_pdf_blobs VALUES (?,?)", (digest, raw))
            db.execute(
                "INSERT INTO public_pdf_receipts VALUES (?,?,?)",
                (run.id, "doc_NCT00000001_Prot_000", digest),
            )
        response = client.get(url, params={"sha256": digest})
        assert response.content == raw
        assert response.headers["X-Source-Sha256"] == digest
        assert response.headers["Cache-Control"] == "no-store"
        assert client.get(url, params={"sha256": "0" * 64}).status_code == 404
        assert (
            client.get(
                url.replace("doc_NCT00000001_Prot_000", "paper_123"), params={"sha256": digest}
            ).status_code
            == 404
        )
        assert (
            client.get(
                url.replace(run.id, "00000000-0000-4000-8000-000000000001"),
                params={"sha256": digest},
            ).status_code
            == 404
        )
        with sqlite3.connect(path) as db:
            db.execute("UPDATE public_pdf_blobs SET content=? WHERE digest=?", (b"corrupt", digest))
        assert client.get(url, params={"sha256": digest}).status_code == 409


def test_curation_versions_are_append_only_and_do_not_modify_ai_or_sources(setup):
    path, request, _ = setup
    run = asyncio.run(execute(path, request, FakeModel()))
    store = ResearchStore(path)
    original = run.model_dump_json()
    note = CurationInput(
        source_id="paper_123",
        expected_revision=0,
        decision="CHECK",
        reason="MOC needs verification",
        reviewer_label="MOC unverified tester",
    )
    first = store.curate(run.id, note)
    assert first["revision"] == 1
    assert first["reviewer_authenticated"] is False and first["clinical_verified"] is False
    with pytest.raises(ValueError, match="VERSION_CONFLICT"):
        store.curate(run.id, note)
    second = store.curate(
        run.id, note.model_copy(update={"expected_revision": 1, "decision": "EXCLUDE"})
    )
    assert second["revision"] == 2
    assert len(store.curation(run.id, "paper_123")) == 2
    assert store.curation(run.id) == [second]
    assert store.get_run(run.id).model_dump_json() == original


def test_curation_api_requires_origin_valid_source_and_matching_version(setup):
    path, request, _ = setup
    run = asyncio.run(execute(path, request))
    app = FastAPI()
    app.include_router(research_router(path, BoundedSemaphore(1)))
    body = {
        "source_id": "paper_123",
        "expected_revision": 0,
        "decision": "CHECK",
        "reason": "MOC source needs expert review",
        "reviewer_label": "MOC tester",
    }
    url = f"/api/research/runs/{run.id}/curation"
    with TestClient(app) as client:
        assert client.post(url, json=body).status_code == 403
        assert (
            client.post(url, json={**body, "source_id": "unknown"}, headers=ORIGIN).status_code
            == 422
        )
        assert client.post(url, json=body, headers=ORIGIN).status_code == 200
        assert client.post(url, json=body, headers=ORIGIN).status_code == 409
        assert len(client.get(url).json()) == 1
        assert len(client.get(url + "?source_id=paper_123").json()) == 1


def test_plaintext_handles_encoded_markup_and_separates_block_headings():
    assert (
        collect.plain("<h4>Methods</h4><p>KRAS&lt;sup&gt;G12C&lt;/sup&gt;</p>")
        == "Methods\n\nKRASG12C"
    )
