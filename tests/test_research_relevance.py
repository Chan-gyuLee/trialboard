"""MOC retrieval-policy checks, not relevance benchmarks or clinical evaluation."""

import asyncio

import pytest
from test_research import FakeModel, execute, setup  # noqa: F401
from test_research_citations import source

from trialboard.research.models import Collection, ResearchRequest, SearchPlan
from trialboard.research.relevance import (
    rank_sources,
    select_review_sources,
    selection_record,
    signals,
)
from trialboard.research.store import ResearchStore
from trialboard.research.validation import plan_payload


def request():
    return ResearchRequest(
        search_id="00000000-0000-0000-0000-000000000001",
        nct_id="NCT00000001",
        asset="MOC drug",
        indication="MOC condition",
        public_consent=True,
        model_consent=True,
    )


def registry():
    return source("NCT00000001 MOC registry: planned arms, not results.", "registry_1").model_copy(
        update={
            "kind": "REGISTRY",
            "content_level": "REGISTRY_TEXT",
            "identifiers": {"nct": "NCT00000001"},
            "link_basis": ["REGISTRY_RECORD"],
        }
    )


def run_with(items, preferred=()):
    return Collection(
        id="00000000-0000-0000-0000-000000000002",
        project_id="MOC",
        created_at="2026-09-16T00:00:00Z",
        request=request(),
        status="RUNNING",
        sources=items,
        coverage=[],
        events=[],
        plan=SearchPlan(
            priorities=[{"source_id": p, "reason": "MOC"} for p in preferred],
            followup_terms=[],
            missing_evidence=[],
        ),
    )


@pytest.mark.parametrize(
    "text,expected,other",
    [
        ("nct00000001 MOC", True, False),
        ("NCT000000010", False, False),
        ("XNCT00000001", False, False),
        ("NCT00000002", False, True),
        ("NCT00000001 and NCT00000002", True, True),
        ("x " * 2250 + "NCT00000001", False, False),
    ],
)
def test_nct_cues_require_exact_token_in_actual_review_window(text, expected, other):
    item = source(text).model_copy(update={"link_basis": ["NCT_SEARCH", "NCT_IN_ABSTRACT"]})
    cue = signals(item, request())
    assert cue["target_nct_in_review_window"] is expected
    assert cue["other_nct_in_review_window"] is other
    assert cue["clinical_linkage"] == "NOT_VERIFIED"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("MOC drug dose optimization remains unstudied", True),
        ("MOC drug 10 mg versus 20 mg", True),
        ("MOC drug 10 mg compared with 20 mg", True),
        ("MOC drug two doses", True),
        ("MOC drug 10 mg once daily", False),
        ("another drug dose comparison", False),
        ("MOC druglike dose comparison", False),
    ],
)
def test_dose_words_are_only_cues_anchored_to_named_drug(text, expected):
    cue = signals(source(text), request())
    assert cue["asset_and_dose_comparison_words"] is expected
    assert cue["clinical_linkage"] == "NOT_VERIFIED"


def test_background_and_model_preferences_do_not_crowd_out_registry_or_trial_text():
    background = [
        source("MOC review", f"paper_{i:02}").model_copy(
            update={"link_basis": ["REGISTRY_REFERENCE_BACKGROUND"]}
        )
        for i in range(30)
    ]
    target = source("NCT00000001 MOC drug trial", "paper_z")
    run = run_with(background + [target, registry()], [s.id for s in background[:6]])
    payload = plan_payload(run)
    assert len(payload["sources"]) == 24
    assert [s["id"] for s in payload["sources"][:2]] == ["registry_1", "paper_z"]
    review = select_review_sources(run, {s.id for s in run.sources})
    assert len(review) == 8 and [s.id for s in review[:2]] == ["registry_1", "paper_z"]


def test_result_reference_is_not_equivalent_to_background_or_verified_outcomes():
    bg = source("MOC", "paper_a").model_copy(
        update={"link_basis": ["REGISTRY_REFERENCE_BACKGROUND"]}
    )
    result = source("MOC", "paper_z").model_copy(
        update={"link_basis": ["REGISTRY_REFERENCE_RESULT"]}
    )
    assert rank_sources([bg, result], request(), [bg.id])[0] == result
    cue = signals(result, request())
    assert cue["registry_result_reference"] and not cue["target_nct_in_review_window"]
    assert cue["clinical_linkage"] == "NOT_VERIFIED"


def test_dose_candidate_is_not_lost_to_model_selected_background():
    bg = source("MOC general context", "paper_a")
    dose = source("MOC drug dose comparison with NCT00000002", "paper_z")
    assert rank_sources([bg, dose], request(), [bg.id])[0] == dose
    assert signals(dose, request())["other_nct_in_review_window"]


def test_followup_reservation_keeps_registry_linked_paper_and_no_duplicate_slots():
    old = [registry(), source("NCT00000001 MOC", "paper_target")]
    old += [source("MOC drug dose comparison", f"old_{i}") for i in range(10)]
    new = [
        source("MOC", f"new_{i}").model_copy(update={"link_basis": ["AI_FOLLOWUP"]})
        for i in range(3)
    ]
    selected = select_review_sources(run_with(old + new), {s.id for s in old})
    ids = [s.id for s in selected]
    assert len(ids) == len(set(ids)) == 8
    assert {"registry_1", "paper_target", "new_0", "new_1"} <= set(ids)
    selected = select_review_sources(run_with(old + new), set())
    assert len(selected) == 8 and len({s.id for s in selected}) == 8


def test_pdf_metadata_cannot_consume_quote_context_or_discovery_slots():
    pdf = source("NCT00000001 MOC drug dose comparison", "doc_1").model_copy(
        update={"kind": "PROTOCOL", "content_level": "PDF_AVAILABLE", "link_basis": ["AI_FOLLOWUP"]}
    )
    metadata = source("NCT00000001 MOC", "paper_meta").model_copy(
        update={"content_level": "METADATA"}
    )
    run = run_with([pdf, metadata])
    assert len(plan_payload(run)["sources"]) == 2
    assert select_review_sources(run, set()) == []


def test_registry_identifier_mismatch_not_reserved_as_selected_trial():
    item = registry().model_copy(update={"identifiers": {"nct": "NCT00000002"}})
    assert not signals(item, request())["selected_registry"]


def test_deterministic_bounded_selection_does_not_mutate_evidence_or_plan():
    items = [source("MOC", f"paper_{i:02}") for i in range(30)] + [registry()]
    run = run_with(items, ["paper_29"])
    before = run.model_dump_json()
    selected = select_review_sources(run, set())
    run.sources.reverse()
    assert select_review_sources(run, set()) == selected
    run.sources.reverse()
    assert run.model_dump_json() == before
    record = selection_record(selected, request())
    assert record["version"] == "dose-context/2"
    assert len(record["sources"]) == 8
    assert [x["source_digest"] for x in record["sources"]] == [s.digest for s in selected]
    assert all(
        set(s) == {"source_id", "source_digest", "signals", "input_char_limit"}
        for s in record["sources"]
    )


@pytest.mark.parametrize("bad", [False, True])
def test_live_engine_persists_both_selections_even_on_quote_rejection(setup, bad):  # noqa: F811
    path, req, _ = setup
    provider = FakeModel(bad=bad)
    run = asyncio.run(execute(path, req, provider))
    assert len(provider.calls) == 2
    for call, wire in zip(run.calls, provider.calls, strict=True):
        record = call["context_selection"]
        assert record == wire["payload"]["selection"]
        assert [s["source_id"] for s in record["sources"]] == [
            s["id"] for s in wire["payload"]["sources"]
        ]
        assert any(s["signals"]["selected_registry"] for s in record["sources"])
    assert ResearchStore(path).get_run(run.id) == run
    assert run.status == ("PARTIAL" if bad else "COMPLETE")
    event = next(e for e in run.events if e["stage"] == "CITATIONS_READY")
    assert "선택 시험 등록정보 1개" in event["message"]
