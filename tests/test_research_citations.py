"""Exact quote materialization with synthetic sources; not clinical validation."""

import asyncio
from dataclasses import replace

import pytest
from pydantic import ValidationError
from test_research import FakeModel, execute, setup  # noqa: F401

from trialboard.research.citations import (
    MAX_QUOTE_CHARS,
    citation_context,
    resolve_citations,
    source_spans,
)
from trialboard.research.models import Source
from trialboard.research.store import ResearchStore
from trialboard.serialization import sha256_json


def source(text="MOC 36.5% (95% CI: 20–50); not a clinical result.", identity="paper_1"):
    return Source(
        id=identity,
        kind="PAPER",
        title="MOC source",
        url="https://pubmed.ncbi.nlm.nih.gov/1/",
        text=text,
        content_level="ABSTRACT",
        link_basis=["DRUG_SEARCH"],
        identifiers={"PMID": "1"},
        fetched_at="2026-09-16T00:00:00Z",
        digest=sha256_json({"text": text}),
    )


def draft(anchor_id):
    return {
        "findings": [{"anchor_id": anchor_id, "interpretation": "MOC; expert review needed"}],
        "questions": ["MOC question?"],
        "conclusion": "NEEDS_EXPERT_REVIEW",
    }


@pytest.mark.parametrize(
    "text",
    [
        "",
        " \n\t",
        "a" * 9000,
        "a " * 3000,
        "MOC 😀 가설 36.5%\u00a0text.\nNext sentence. " * 200,
        "First sentence. " * 90,
        "line\r\n" * 1000,
    ],
)
def test_spans_bound_all_nonwhitespace_without_normalizing_or_skipping(text):
    item = source(text)
    spans = source_spans(item)
    assert spans == source_spans(item)
    assert len(spans) <= 15
    assert len({s.anchor_id for s in spans}) == len(spans)
    reconstructed = "".join(s.text for s in spans)
    assert "".join(reconstructed.split()) == "".join(text[:4500].split())
    for span in spans:
        assert 0 <= span.start < span.end <= 4500
        assert 1 <= len(span.text) <= MAX_QUOTE_CHARS
        assert item.text[span.start : span.end] == span.text


def test_wire_model_selects_ids_never_supplies_quotes_or_source_ids():
    payload, anchors, schema = citation_context([source()])
    fields = schema["$defs"]["AnchoredInsight"]["properties"]
    assert set(fields) == {"anchor_id", "interpretation"}
    assert fields["anchor_id"]["enum"] == sorted(anchors)
    assert "text" not in payload[0] and payload[0]["segments"][0]["text"] == source().text
    anchor = next(iter(anchors))
    review, bindings = resolve_citations(draft(anchor), anchors, [source()])
    assert review.findings[0].quote == source().text
    assert review.findings[0].source_id == source().id
    assert bindings[0]["offset_unit"] == "UNICODE_CODE_POINTS"
    assert "quote" not in bindings[0]


def test_posted_registry_results_can_cite_beyond_4500_without_changing_paper_budget():
    text = "MOC registered context. " * 300 + "MOC terminal result 0 / 21."
    item = source(text).model_copy(update={"kind": "REGISTRY", "link_basis": ["REGISTRY_RESULTS"]})
    _, anchors, _ = citation_context([item])
    last = list(anchors.values())[-1]
    assert last.end > 4500 and last.end <= 18000
    review, _ = resolve_citations(draft(last.anchor_id), anchors, [item])
    assert "MOC terminal result" in review.findings[0].quote
    assert all(s.end <= 4500 for s in source_spans(source(text)))


@pytest.mark.parametrize(
    "kind",
    [
        "unknown",
        "wrong_source",
        "changed_version",
        "changed_text",
        "changed_anchor_text",
        "changed_offsets",
        "missing_source",
    ],
)
def test_unknown_stale_or_tampered_anchor_rejected_without_fuzzy_repair(kind):
    item = source()
    _, anchors, _ = citation_context([item])
    key = next(iter(anchors))
    output = draft(key)
    items = [item]
    if kind == "unknown":
        output["findings"][0]["anchor_id"] = "invented"
    elif kind == "wrong_source":
        items = [source(identity="paper_2")]
    elif kind == "changed_version":
        items = [item.model_copy(update={"digest": "b" * 64})]
    elif kind == "changed_text":
        items = [item.model_copy(update={"text": item.text.replace("36.5", "46.5")})]
    elif kind == "changed_anchor_text":
        anchors[key] = replace(anchors[key], text="fabrication")
    elif kind == "changed_offsets":
        anchors[key] = replace(anchors[key], start=1)
    else:
        items = []
    with pytest.raises(ValueError, match="UNSUPPORTED_REVIEW_CITATION"):
        resolve_citations(output, anchors, items)


def test_empty_context_has_no_selectable_citation_and_can_report_insufficiency():
    payload, anchors, schema = citation_context([])
    assert payload == [] and anchors == {}
    assert schema["properties"]["findings"]["maxItems"] == 0
    review, bindings = resolve_citations(
        {"findings": [], "questions": [], "conclusion": "INSUFFICIENT_EVIDENCE"}, anchors, []
    )
    assert review.conclusion == "INSUFFICIENT_EVIDENCE" and bindings == []


def test_model_cannot_smuggle_a_quote_beside_a_valid_anchor():
    _, anchors, _ = citation_context([source()])
    output = draft(next(iter(anchors)))
    output["findings"][0]["quote"] = "fabricated"
    with pytest.raises(ValidationError):
        resolve_citations(output, anchors, [source()])


def test_duplicate_or_excessive_sources_rejected():
    for items in [[source(), source()], [source(identity=str(i)) for i in range(9)]]:
        with pytest.raises(ValueError, match="INVALID_CITATION_CONTEXT"):
            citation_context(items)


def test_same_text_different_source_or_version_gets_different_id():
    base = source()
    other = source(identity="paper_2")
    changed = base.model_copy(update={"digest": "b" * 64})
    ids = [source_spans(s)[0].anchor_id for s in [base, other, changed]]
    assert len(set(ids)) == 3


def test_engine_persists_original_quotes_bindings_events_and_two_call_limit(setup):  # noqa: F811
    path, request, _ = setup
    provider = FakeModel()
    run = asyncio.run(execute(path, request, provider))
    restored = ResearchStore(path).get_run(run.id)
    assert restored == run and run.review is not None
    assert len(provider.calls) == 2 and run.calls[1]["validation"] == "PASSED"
    assert any(e["stage"] == "CITATIONS_READY" for e in run.events)
    for finding, binding in zip(
        run.review.findings, run.calls[1]["citation_bindings"], strict=True
    ):
        item = next(s for s in run.sources if s.id == binding["source_id"])
        assert binding["source_digest"] == item.digest
        assert finding.quote == item.text[binding["start"] : binding["end"]]
        assert len(finding.quote) <= 600
