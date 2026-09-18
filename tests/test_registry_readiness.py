"""MOC rule checks; passing these tests is not clinical validation."""

import copy

import pytest

from trialboard.research.readiness import assess_results
from trialboard.research.result_context import compact_results, result_pages


def packet():
    rows = []
    for i, dose in enumerate((10, 20)):
        rows.append(
            {
                "title": "MOC Objective Response Rate",
                "type": "PRIMARY",
                "groupId": f"OG{i}",
                "groupTitle": f"MOC drug {dose} mg",
                "groupDescription": f"MOC drug {dose} mg daily",
                "population": "MOC analysis population",
                "window": "MOC week 12",
                "definition": "MOC objective response",
                "parameter": "NUMBER",
                "unit": "percentage of participants",
                "classTitle": "",
                "categoryTitle": "",
                "value": "20.0",
                "lower": None,
                "upper": None,
                "dispersion": "",
                "denominators": [{"unit": "Participants", "value": "21"}],
                "locator": "/studies/0/resultsSection/outcomeMeasuresModule/outcomeMeasures/0"
                f"/classes/0/categories/0/measurements/{i}",
            }
        )
    safety = [
        {
            "groupId": f"EG{i}",
            "groupTitle": f"MOC drug {dose} mg",
            "groupDescription": f"MOC drug {dose} mg daily",
            "metric": "serious adverse events",
            "affected": i,
            "atRisk": 21,
            "window": "MOC week 12",
            "description": "MOC safety definition",
            "locator": f"/studies/0/resultsSection/adverseEventsModule/eventGroups/{i}",
        }
        for i, dose in enumerate((10, 20))
    ]
    return {
        "nctId": "NCT00000001",
        "snapshotDigest": "a" * 64,
        "outcomes": rows,
        "safety": safety,
        "limited": False,
        "notice": "MOC no clinical validation",
    }


def test_supported_rows_are_only_expert_review_candidates():
    r = assess_results(packet())
    assert r["status"] == "EXPERT_REVIEW_REQUIRED"
    assert r["responseCandidate"] and r["safetyCandidate"]
    assert r["clinicalApproved"] is False and r["simulationExecuted"] is False
    assert r["method"] == "DETERMINISTIC_RULES"
    assert r["series"][0]["valueKind"] == "REPORTED_PERCENTAGE"
    assert "events" not in r["series"][0]


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("population", "MOC single cohort", "POOLED_OR_MULTI_DOSE_CONTEXT"),
        ("groupDescription", "MOC 10 mg or 20 mg", "POOLED_OR_MULTI_DOSE_CONTEXT"),
        ("groupTitle", "MOC drug", "DISTINCT_DOSE_LABELS_MISSING"),
        ("window", "", "CONTEXT_INCOMPLETE"),
        ("window", "MOC different week", "CONTEXT_DIFFERS"),
        ("denominators", [], "DENOMINATOR_UNRESOLVED"),
        ("value", "NaN", "VALUE_UNRESOLVED"),
        ("value", "1e999999", "VALUE_UNRESOLVED"),
        ("value", "101", "VALUE_UNRESOLVED"),
        ("unit", "months", "UNSUPPORTED_VALUE_ROLE"),
    ],
)
def test_ambiguous_rows_never_become_response_candidates(field, value, code):
    p = packet()
    p["outcomes"][0][field] = value
    r = assess_results(p)
    assert r["status"] == "NEEDS_EVIDENCE" and not r["responseCandidate"]
    assert code in r["series"][0]["issues"]


def test_distinct_class_denom_and_group_ids_are_not_merged():
    p = packet()
    p["outcomes"][1]["locator"] = p["outcomes"][1]["locator"].replace("classes/0", "classes/1")
    r = assess_results(p)
    assert len([s for s in r["series"] if s["family"] == "RESPONSE"]) == 2
    assert not r["responseCandidate"]


def test_counts_above_denominator_and_zero_denominator_are_blocked():
    p = packet()
    p["safety"][0]["affected"] = 22
    p["safety"][1]["atRisk"] = 0
    r = assess_results(p)
    assert not r["safetyCandidate"]
    assert {"VALUE_UNRESOLVED", "DENOMINATOR_UNRESOLVED"} <= set(r["series"][1]["issues"])


def test_partial_tables_cannot_clear_evidence_gate():
    p = packet()
    p["limited"] = True
    assert assess_results(p)["status"] == "NEEDS_EVIDENCE"


def test_compact_context_preserves_all_rows_and_deduplicates_shared_definition():
    p = packet()
    before = copy.deepcopy(p)
    text, ledger = compact_results(p)
    assert p == before
    assert len(ledger["included"]) == 4 and not ledger["omitted"]
    assert text.count('"definition":"MOC objective response"') == 1
    assert '"groupId":"OG0"' in text and '"groupId":"EG0"' in text
    assert "serious adverse events" in text and '"affected":0' in text


def test_oversized_block_is_omitted_whole_not_truncated_into_an_orphan_number():
    p = packet()
    for row in p["outcomes"]:
        row["definition"] = "MOC " * 10000
    text, ledger = compact_results(p)
    assert len(text) <= 18000 and len(ledger["omitted"]) == 2
    assert '"value":"20.0"' not in text
    assert "serious adverse events" in text


def test_context_pages_keep_each_row_once():
    p = packet()
    for row in p["outcomes"]:
        row["definition"] = "MOC " * 2500
    p["safety"][0]["description"] = p["safety"][1]["description"] = "MOC " * 2500
    pages = result_pages(p)
    refs = [x for _, ledger in pages for x in ledger["included"]]
    assert len(pages) == 2 and len(refs) == len(set(refs)) == 4
    assert all(len(text) <= 18000 for text, _ in pages)
    assert all("4/4 rows INCLUDED; 0 rows OMITTED" in text for text, _ in pages)
    assert all(ledger["global_omitted"] == 0 for _, ledger in pages)


@pytest.mark.parametrize("label", ["MOC drug 10.0mg", "MOC drug 10000 mcg"])
def test_dose_formatting_or_unit_changes_do_not_create_a_comparison(label):
    p = packet()
    p["outcomes"][1]["groupTitle"] = label
    assert not assess_results(p)["responseCandidate"]


def test_identically_named_categories_still_stay_separate():
    p = packet()
    p["outcomes"][1]["locator"] = p["outcomes"][1]["locator"].replace(
        "categories/0", "categories/1"
    )
    r = assess_results(p)
    assert not r["responseCandidate"]
    assert len([s for s in r["series"] if s["family"] == "RESPONSE"]) == 2


@pytest.mark.parametrize(
    "claim", ["MOC 비무작위 시험", "MOC non-randomized trial", "MOC nonrandomised trial"]
)
def test_explicit_randomized_registry_blocks_contradictory_allocation_claim(claim):
    from test_research_citations import source

    from trialboard.research.models import Insight, ResearchReview
    from trialboard.research.validation import ResearchValidationError, validate_design_claims

    s = source("MOC RANDOMIZED", "registry_MOC").model_copy(
        update={
            "kind": "REGISTRY",
            "identifiers": {"nct": "NCT00000001", "allocation": "RANDOMIZED"},
        }
    )
    review = ResearchReview(
        findings=[Insight(source_id=s.id, quote=s.text, interpretation=claim)],
        questions=[],
        conclusion="NEEDS_EXPERT_REVIEW",
    )
    with pytest.raises(ResearchValidationError, match="CONTRADICTED_ALLOCATION_CLAIM"):
        validate_design_claims(review, [s], "NCT00000001")
    assert validate_design_claims(review, [s], "NCT00000002") is review
