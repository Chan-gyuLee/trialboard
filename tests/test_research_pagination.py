"""MOC pagination, bounded collection, partial persistence; no model/network calls."""

import asyncio

import pytest
from test_research import execute
from test_research import setup as research_setup

from trialboard.research import collect
from trialboard.research.store import ResearchStore


@pytest.fixture
def setup(tmp_path, monkeypatch):
    return research_setup.__wrapped__(tmp_path, monkeypatch)


def page(start, count=20, total=55, cursor="page-2"):
    return {
        "hitCount": total,
        "nextCursorMark": cursor,
        "resultList": {
            "result": [
                {
                    "source": "MED",
                    "pmid": str(i),
                    "title": f"MOC paper {i}",
                    "abstractText": "MOC abstract",
                }
                for i in range(start, start + count)
            ]
        },
    }


@pytest.mark.parametrize(
    "basis,expected",
    [("NCT_SEARCH", 2), ("AI_FOLLOWUP", 2), ("DRUG_SEARCH", 1), ("REGISTRY_BIBLIOGRAPHY", 1)],
)
def test_priority_pages_are_bounded_and_snapshotted(setup, monkeypatch, basis, expected):
    path, request, _ = setup
    store = ResearchStore(path)
    run = store.start(request)
    requests, progress = [], []

    async def fetch(url, params):
        requests.append(params.copy())
        return page(100 if params["cursorMark"] == "*" else 120, cursor="page-3")

    async def observe(*args):
        progress.append((args, len(run.sources)))

    monkeypatch.setattr(collect, "get_json", fetch)
    asyncio.run(collect.literature(run, "MOC query", basis, store, {}, on_page=observe))
    receipt = run.coverage[-1]
    assert receipt.pages == expected and receipt.fetched == expected * 20
    assert receipt.stop_reason == "PAGE_LIMIT" and receipt.limited
    assert len(run.sources) == expected * 20
    assert all(s.raw_snapshots for s in run.sources)
    assert progress[0][1] == 20 and len(progress) == expected
    assert requests[0]["cursorMark"] == "*"
    if expected == 2:
        assert requests[1]["cursorMark"] == "page-3"
    store.save_run(run)
    assert store.get_run(run.id).coverage == run.coverage


@pytest.mark.parametrize("cursor", [None, "", "*", "x" * 2001])
def test_missing_or_repeated_cursor_does_not_invent_completion(setup, monkeypatch, cursor):
    path, request, _ = setup
    store = ResearchStore(path)
    run = store.start(request)

    async def fetch(url, params):
        return page(100, cursor=cursor)

    monkeypatch.setattr(collect, "get_json", fetch)
    asyncio.run(collect.literature(run, "MOC", "NCT_SEARCH", store, {}))
    receipt = run.coverage[-1]
    assert receipt.pages == 1 and receipt.stop_reason == "CURSOR_UNAVAILABLE"
    assert receipt.limited


def test_second_page_failure_preserves_first_page_and_receipt(setup, monkeypatch):
    path, request, _ = setup
    original = collect.get_json

    async def fetch(url, params):
        if url == collect.EPMC and params["query"].startswith('"'):
            if params["cursorMark"] != "*":
                raise TimeoutError("MOC failure")
            return page(100)
        return await original(url, params)

    monkeypatch.setattr(collect, "get_json", fetch)
    run = asyncio.run(execute(path, request))
    receipt = next(c for c in run.coverage if c.query.startswith('"'))
    assert receipt.status == "FAILED" and receipt.fetched == 20 and receipt.pages == 1
    assert receipt.stop_reason == "REQUEST_FAILED" and run.status == "PARTIAL"
    assert {f"paper_{i}" for i in range(100, 120)} <= {s.id for s in run.sources}
    assert any(e["stage"] == "GAP" and e.get("coverage", {}).get("pages") == 1 for e in run.events)
    assert {s["id"] for e in run.events for s in e.get("sources", [])} == {
        s.id for s in run.sources
    }


def test_last_page_and_repeated_records_are_distinguished(setup, monkeypatch):
    path, request, _ = setup
    store = ResearchStore(path)

    for repeat, reason, count in [(False, "RESULTS_EXHAUSTED", 23), (True, "NO_NEW_RECORDS", 20)]:
        run = store.start(request)

        async def fetch(url, params, repeat=repeat):
            if params["cursorMark"] == "*" or repeat:
                return page(100, total=55 if repeat else 23)
            return page(120, count=3, total=23)

        monkeypatch.setattr(collect, "get_json", fetch)
        asyncio.run(collect.literature(run, "MOC", "AI_FOLLOWUP", store, {}))
        assert run.coverage[-1].stop_reason == reason and len(run.sources) == count
        assert run.coverage[-1].limited == repeat


def test_storage_cap_prevents_extra_requests_and_marks_skipped(setup, monkeypatch):
    path, request, _ = setup
    store = ResearchStore(path)
    run = store.start(request)
    run.sources = [
        collect.source(
            id=f"paper_{i}",
            kind="PAPER",
            title="MOC",
            url=f"https://pubmed.ncbi.nlm.nih.gov/{i}/",
            text="MOC",
            content_level="METADATA",
            link_basis=[],
        )
        for i in range(1, 100)
    ]
    calls = []

    async def fetch(url, params):
        calls.append(params)
        return page(200)

    monkeypatch.setattr(collect, "get_json", fetch)
    asyncio.run(collect.literature(run, "MOC", "AI_FOLLOWUP", store, {}))
    assert len(run.sources) == 100 and len(calls) == 1
    assert run.coverage[-1].stop_reason == "SOURCE_LIMIT"
    asyncio.run(collect.literature(run, "MOC next", "AI_FOLLOWUP", store, {}))
    assert len(calls) == 1 and run.coverage[-1].status == "SKIPPED"
    assert run.coverage[-1].fetched == 0 and run.coverage[-1].total is None


def test_cancellation_propagates_without_claiming_finished(setup, monkeypatch):
    path, request, _ = setup
    store = ResearchStore(path)
    run = store.start(request)

    async def fetch(url, params):
        raise asyncio.CancelledError()

    monkeypatch.setattr(collect, "get_json", fetch)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(collect.literature(run, "MOC", "NCT_SEARCH", store, {}))
    assert not run.coverage
