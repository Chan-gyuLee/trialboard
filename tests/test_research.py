"""MOC connectors and provider: no network, credentials or clinical validation in these tests."""

import asyncio
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
                "followup_terms": ["dose comparison"],
                "priorities": [{"source_id": "paper_123", "reason": "MOC priority"}],
                "missing_evidence": ["MOC second dose"],
            }
        else:
            value = {
                "findings": [
                    {
                        "source_id": "paper_123",
                        "quote": ("fabricated quote" if self.bad else "NCT00000001 uses 10 mg"),
                        "interpretation": "MOC interpretation, not clinical",
                    }
                ],
                "questions": ["MOC second-dose evidence?"],
                "conclusion": "NEEDS_EXPERT_REVIEW",
            }
        return Reply(value, f"MOC-{len(self.calls)}", 100, 50)


async def execute(path, request, provider=None):
    store = ResearchStore(path)
    run = store.start(request)

    async def emit(stage, message, **extra):
        run.events.append({"stage": stage, "message": message, **extra})
        store.save_run(run)

    await run_research(run, store, emit, provider)
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
    assert run.review.findings[0].source_id == "paper_123"
    assert run.execution_mode == "SCRIPTED_TEST_DOUBLE"


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


def test_failed_connector_is_partial_not_zero_evidence(setup, monkeypatch):
    path, request, _ = setup

    async def failed(url, params):
        raise TimeoutError("sensitive diagnostics")

    monkeypatch.setattr(collect, "get_json", failed)
    run = asyncio.run(execute(path, request))
    assert run.status == "PARTIAL" and any(c.status == "FAILED" for c in run.coverage)
    assert "sensitive diagnostics" not in run.model_dump_json()
    assert len(run.sources) == 2


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
