"""MOC connector/provider events: persistence facts, not simulated clinical progress."""

import asyncio

import pytest
from test_research import FakeModel, execute
from test_research import setup as research_setup

from trialboard.research import collect
from trialboard.research.store import ResearchStore


@pytest.fixture
def setup(tmp_path, monkeypatch):
    return research_setup.__wrapped__(tmp_path, monkeypatch)


def test_every_saved_source_is_delivered_once_with_content_level(setup):
    path, request, _ = setup
    run = asyncio.run(execute(path, request, FakeModel()))
    cards = [s for e in run.events for s in e.get("sources", [])]
    assert len(cards) == len(run.sources)
    assert {s["id"] for s in cards} == {s.id for s in run.sources}
    assert all(len(e.get("sources", [])) <= 6 for e in run.events)
    assert all("text" not in s and s["content_level"] and s["url"] for s in cards)
    inventory = run.events[-1]["inventory"]
    assert inventory == {
        "total": 4,
        "REGISTRY_TEXT": 1,
        "ABSTRACT": 1,
        "METADATA": 0,
        "PDF_AVAILABLE": 2,
    }
    assert ResearchStore(path).get_run(run.id).events == run.events


def test_model_input_and_anchor_counts_are_actual_payloads(setup):
    path, request, _ = setup
    provider = FakeModel()
    run = asyncio.run(execute(path, request, provider))
    inputs = [e for e in run.events if e["stage"] in ("AI_PLAN", "AI_REVIEW")]
    assert len(inputs) == len(provider.calls) == 2
    for event, call in zip(inputs, provider.calls, strict=True):
        assert event["input_sources"] == [s["id"] for s in call["payload"]["sources"]]
    citation = next(e for e in run.events if e["stage"] == "CITATIONS_READY")
    assert citation["input_sources"] == inputs[-1]["input_sources"]
    assert citation["anchor_count"] == sum(
        len(s["segments"]) for s in provider.calls[-1]["payload"]["sources"]
    )


def test_parallel_search_receipts_keep_own_query_and_do_not_drop_sources(setup, monkeypatch):
    path, request, _ = setup
    original = collect.get_json

    async def many(url, params):
        data = await original(url, params)
        if url == collect.EPMC:
            await asyncio.sleep(0)  # Exercise overlapping requests, not presentation delay.
            query = params["query"]
            offset = 100 if query.startswith("(") else 200 if query.startswith('"') else 300
            paper = data["resultList"]["result"][0]
            data["resultList"]["result"] = [
                {**paper, "pmid": str(offset + i), "title": f"MOC source {offset + i}"}
                for i in range(20)
            ]
            data["hitCount"] = offset
        return data

    monkeypatch.setattr(collect, "get_json", many)
    run = asyncio.run(execute(path, request))
    cards = [s for e in run.events for s in e.get("sources", [])]
    assert len(cards) == len({s["id"] for s in cards}) == len(run.sources) == 63
    assert len(run.events) < 100
    receipts = [e for e in run.events if "coverage" in e]
    assert len(receipts) == len(run.coverage) == 5
    for event in receipts:
        receipt = event["coverage"]
        assert receipt in [c.model_dump() for c in run.coverage]
        if "PubMed" in event["channel"]:
            assert event["query"] == receipt["query"]
            assert receipt["fetched"] == 20 and receipt["limited"]
        if event["channel"] == "Drugs@FDA":
            assert receipt["fetched"] == 1  # Applications, not paper/document count.


def test_failed_collector_is_not_reported_as_received(setup, monkeypatch):
    path, request, _ = setup
    original = collect.get_json

    async def fail_fda(url, params):
        if url == collect.FDA:
            raise ValueError("MOC unavailable")
        return await original(url, params)

    monkeypatch.setattr(collect, "get_json", fail_fda)
    run = asyncio.run(execute(path, request))
    gap = next(e for e in run.events if e.get("channel") == "Drugs@FDA" and e["stage"] == "GAP")
    assert gap["coverage"]["status"] == "FAILED"
    assert gap["coverage"]["fetched"] == 0 and gap["coverage"]["total"] is None
    assert run.status == "PARTIAL"
