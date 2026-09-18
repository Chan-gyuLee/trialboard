"""Output constraints and independent validation; synthetic sources/model only."""

import asyncio
import re

import pytest
from pydantic import ValidationError
from test_research import FakeModel, execute, setup  # noqa: F401

from trialboard.agent.provider import ModelError
from trialboard.research.models import ResearchReview, SearchPlan
from trialboard.research.validation import (
    FOLLOWUP_PATTERN,
    research_failure_code,
    source_bound_schema,
    validate_plan,
    validate_review,
    validation_details,
)


def test_wire_schema_binds_both_stages_without_mutating_stored_contracts():
    old = SearchPlan.model_json_schema()
    schema = source_bound_schema(SearchPlan, ["paper_2", "paper_1", "paper_2"])
    assert schema["$defs"]["Priority"]["properties"]["source_id"]["enum"] == ["paper_1", "paper_2"]
    assert schema["properties"]["followup_terms"]["items"]["pattern"] == FOLLOWUP_PATTERN
    assert SearchPlan.model_json_schema() == old
    review = source_bound_schema(ResearchReview, ["paper_3"])
    assert review["$defs"]["Insight"]["properties"]["source_id"]["enum"] == ["paper_3"]


@pytest.mark.parametrize(
    "contract,field", [(SearchPlan, "priorities"), (ResearchReview, "findings")]
)
def test_no_sources_means_no_cited_items(contract, field):
    schema = source_bound_schema(contract, [])
    assert schema["properties"][field]["maxItems"] == 0
    assert '"enum": []' not in str(schema)


@pytest.mark.parametrize(
    "term",
    [
        "dose (comparison)",
        '"dose"',
        "safety/toxicity",
        "SRC:MED",
        "https://example.com",
        "a" * 81,
        "한글",
        "x\ny",
    ],
)
def test_invalid_search_syntax_is_visible_in_schema_and_rejected_locally(term):
    assert re.fullmatch(FOLLOWUP_PATTERN, term) is None
    with pytest.raises(ValueError, match="INVALID_FOLLOWUP_TERMS"):
        validate_plan({"priorities": [], "missing_evidence": [], "followup_terms": [term]}, set())


@pytest.mark.parametrize("term", ["NCT00000001", "  "])
def test_semantic_query_checks_remain_after_schema(term):
    with pytest.raises(ValueError, match="INVALID_FOLLOWUP_TERMS"):
        validate_plan({"priorities": [], "missing_evidence": [], "followup_terms": [term]}, set())


def test_unknown_ids_and_quotes_are_not_repaired():
    with pytest.raises(ValueError, match="UNKNOWN_PRIORITY_SOURCE"):
        validate_plan(
            {
                "priorities": [{"source_id": "other", "reason": "MOC"}],
                "missing_evidence": [],
                "followup_terms": [],
            },
            {"paper_1"},
        )
    with pytest.raises(ValueError, match="UNSUPPORTED_REVIEW_CITATION"):
        validate_review(
            {
                "findings": [
                    {"source_id": "paper_1", "quote": "changed quote", "interpretation": "MOC"}
                ],
                "questions": [],
                "conclusion": "INSUFFICIENT_EVIDENCE",
            },
            {"paper_1": "original quote"},
        )


def test_safe_schema_details_do_not_leak_extra_keys_values_or_messages():
    try:
        SearchPlan.model_validate(
            {"followup_terms": ["secret-value"] * 3, "private-key-as-field": "private-value"}
        )
    except ValidationError as error:
        details = validation_details(error)
    assert any(d["field"] == "followup_terms" and d["type"] == "too_long" for d in details)
    assert any(d["field"] == "unknown_field" for d in details)
    assert not any(x in str(details) for x in ["secret-value", "private-key", "private-value"])


def test_model_errors_keep_only_allowlisted_codes():
    assert research_failure_code(ModelError("DACON_QUOTA_EXHAUSTED")) == "DACON_QUOTA_EXHAUSTED"
    assert research_failure_code(ModelError("private-error")) == "MODEL_CALL_OR_RESPONSE_FAILED"
    assert research_failure_code(TimeoutError("private")) == "MODEL_TIMEOUT"


def test_live_engine_passes_each_calls_actual_source_ids_and_contract_version(setup):  # noqa: F811
    path, request, _ = setup
    provider = FakeModel()
    run = asyncio.run(execute(path, request, provider))
    call = provider.calls[0]
    assert set(call["schema"]["$defs"]["Priority"]["properties"]["source_id"]["enum"]) == {
        s["id"] for s in call["payload"]["sources"]
    }
    call = provider.calls[1]
    assert set(call["schema"]["$defs"]["AnchoredInsight"]["properties"]["anchor_id"]["enum"]) == {
        segment["anchor_id"] for s in call["payload"]["sources"] for segment in s["segments"]
    }
    assert len(run.calls) == 2 and all(c["validation"] == "PASSED" for c in run.calls)
    assert [c["contract_version"] for c in run.calls] == ["source-bound/1", "source-spans/2"]
