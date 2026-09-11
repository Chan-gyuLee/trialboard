import pytest
from pydantic import ValidationError

from trialboard.review.engine import check_evidence, run_review, simulate
from trialboard.review.example import example_designs, example_scenarios, make_example
from trialboard.review.models import EvidenceClaim, EvidenceSource, Observation, Scenario
from trialboard.review.report import to_markdown
from trialboard.serialization import sha256_json


def codes(request):
    return {i.code for i in check_evidence(request)[1]}


def test_normal_records_match_but_do_not_claim_clinical_verification():
    checked, issues = check_evidence(make_example())
    assert len(checked) == 4
    assert not issues
    assert {c.status for c in checked} == {"synthetic_record_matched"}


def test_denominator_error_excluded_and_explained():
    checked, issues = check_evidence(make_example("denominator-error"))
    assert len(checked) == 3
    assert {i.code for i in issues} == {"RECORD_VALUE_MISMATCH", "EVIDENCE_GAP"}
    assert all(i.needed and i.owner and i.affected_decision for i in issues)


def test_missing_evidence_preserves_other_results():
    checked, issues = check_evidence(make_example("missing-evidence"))
    assert len(checked) == 3
    assert [i.code for i in issues] == ["EVIDENCE_GAP"]


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("source_id", "nonexistent", "SOURCE_MISSING"),
        ("record_id", "nonexistent", "RECORD_MISSING"),
        ("source_version", "old_version", "SOURCE_VERSION_MISMATCH"),
    ],
)
def test_broken_references_rejected(field, value, code):
    request = make_example()
    claim = request.claims[0].model_copy(update={field: value})
    request = request.model_copy(update={"claims": (claim, *request.claims[1:])})
    assert code in codes(request)


def test_source_hash_change_rejected():
    request = make_example()
    source = request.sources[0].model_copy(update={"title": "changed source"})
    request = request.model_copy(update={"sources": (source,)})
    assert "SOURCE_HASH_MISMATCH" in codes(request)
    assert not check_evidence(request)[0]


def test_other_cohort_is_not_comparable():
    request = make_example()
    request = request.model_copy(
        update={
            "context": request.context.model_copy(
                update={"cohort": "different_cohort"},
            )
        }
    )
    assert "CONTEXT_MISMATCH" in codes(request)
    assert not check_evidence(request)[0]


def test_conflicting_valid_sources_do_not_get_averaged():
    request = make_example()
    record = request.sources[0].records[0].model_copy(update={"events": 8})
    payload = {
        "id": "other_source",
        "title": "Another synthetic record",
        "version": "v1",
        "kind": "synthetic",
        "records": [record.model_dump(mode="json")],
    }
    source = EvidenceSource(**payload, digest=sha256_json(payload))
    claim = EvidenceClaim(
        id="other_claim",
        source_id=source.id,
        source_version=source.version,
        record_id=record.id,
        stated=record,
    )
    request = request.model_copy(
        update={"sources": (*request.sources, source), "claims": (*request.claims, claim)}
    )
    checked, issues = check_evidence(request)
    assert "CONFLICTING_RECORDS" in {i.code for i in issues}
    assert not [c for c in checked if c.claim.stated.id == record.id]


@pytest.mark.parametrize(("events", "denominator"), [(2, 1), (-1, 20), (1, 0), (1.0, 20)])
def test_invalid_counts_rejected(events, denominator):
    observation = make_example().sources[0].records[0].model_dump()
    observation.update(events=events, denominator=denominator)
    with pytest.raises(ValidationError):
        Observation(**observation)


def test_duplicate_ids_rejected():
    request = make_example().model_dump()
    request["claims"] = [request["claims"][0], request["claims"][0]]
    from trialboard.review.models import ReviewRequest

    with pytest.raises(ValidationError, match="duplicate claim"):
        ReviewRequest(**request)


def test_simulation_reproduces_and_probabilities_partition():
    s, d = example_scenarios()[0], example_designs()[0]
    a = simulate(s, d, repetitions=2000)
    b = simulate(s, d, repetitions=2000)
    assert a == b
    assert sum(a.selection_probability.values()) + a.no_selection_probability == pytest.approx(1)
    assert all(0 <= p <= 1 for p in a.selection_probability.values())
    assert all(0 <= e <= 0.5 / 2000**0.5 for e in a.monte_carlo_se.values())


def test_changed_assumptions_change_the_preferred_arm():
    d = example_designs()[1]
    plateau = simulate(example_scenarios()[0], d, repetitions=10000)
    higher = simulate(example_scenarios()[1], d, repetitions=10000)
    assert plateau.selection_probability["dose_a"] > 0.65
    assert higher.selection_probability["dose_b"] > 0.8


def test_all_unsafe_can_abstain():
    s = example_scenarios()[0].model_dump()
    s.update(adverse_event=(1.0, 1.0))
    result = simulate(Scenario(**s), example_designs()[0], repetitions=100)
    assert result.no_selection_probability == 1
    assert result.selects_true_utility_best_probability == 1
    assert result.selects_true_unsafe_probability == 0
    assert result.true_utility_best_arms == ()


def test_known_best_extreme_is_selected_exactly():
    s = example_scenarios()[0].model_dump()
    s.update(response=(1.0, 0.0), adverse_event=(0.0, 0.0))
    result = simulate(Scenario(**s), example_designs()[0], repetitions=100)
    assert result.selection_probability == {"dose_a": 1, "dose_b": 0}


def test_exact_ties_not_always_assigned_to_first_arm():
    s = example_scenarios()[0].model_dump()
    s.update(response=(0.0, 0.0), adverse_event=(0.0, 0.0))
    result = simulate(Scenario(**s), example_designs()[0], repetitions=10000)
    assert 0.47 < result.selection_probability["dose_a"] < 0.53


@pytest.mark.parametrize("probabilities", [(float("nan"), 0.2), (1.1, 0.2), (-0.1, 0.2), (0.2,)])
def test_bad_scenario_probabilities_rejected(probabilities):
    s = example_scenarios()[0].model_dump()
    s.update(response=probabilities)
    with pytest.raises(ValidationError):
        Scenario(**s)


def test_partial_report_does_not_fill_missing_evidence_with_simulation():
    report = run_review(
        make_example("missing-evidence"), example_scenarios(), example_designs(), repetitions=100
    )
    assert report.status == "PARTIAL_ABSTENTION"
    assert len(report.checked_claims) == 3
    assert len(report.simulations) == 6
    assert report.evidence_mode == "SYNTHETIC_ONLY"
    markdown = to_markdown(report)
    assert "EVIDENCE_GAP" in markdown
    assert "실제 임상 근거 또는 투여 권고가 아닙니다" in markdown
    assert "장기 내약성" in markdown


def test_input_hash_changes_with_assumptions():
    a = run_review(make_example(), example_scenarios(), example_designs(), repetitions=10)
    b = run_review(make_example(), example_scenarios(), example_designs(), seed=43, repetitions=10)
    assert a.input_digest != b.input_digest


def test_mismatched_arms_rejected():
    scenarios = (example_scenarios()[0].model_copy(update={"arms": ("different", "arms")}),)
    with pytest.raises(ValueError, match="scenario arms"):
        run_review(make_example(), scenarios, example_designs())


def test_report_does_not_drop_third_arm():
    arms = ("dose_a", "dose_b", "dose_c")
    request = make_example().model_copy(update={"arms": arms})
    s = example_scenarios()[0].model_dump()
    s.update(arms=arms, response=(0.3, 0.4, 0.5), adverse_event=(0.1, 0.2, 0.3))
    report = run_review(request, (Scenario(**s),), example_designs(), repetitions=10)
    markdown = to_markdown(report)
    assert "dose_c 선택" in markdown
    result = report.simulations[0]
    assert result.total_sample_size == 90
    assert set(result.selection_probability) == set(arms)


@pytest.mark.parametrize("repetitions", [0, -1, 100001, True, 1.5])
def test_simulation_budget_rejected(repetitions):
    with pytest.raises(ValueError):
        simulate(example_scenarios()[0], example_designs()[0], repetitions=repetitions)


def test_no_selection_matches_small_exact_binomial_case():
    # n=2, p(AE)=0.5, threshold=0.35: an arm passes only with zero AEs.
    # P(no arm passes) = (1 - 0.5**2)**2 = 0.5625.
    s = example_scenarios()[0].model_dump()
    s.update(adverse_event=(0.5, 0.5))
    design = example_designs()[0].model_copy(update={"per_arm": 2})
    result = simulate(Scenario(**s), design, repetitions=10000)
    assert result.no_selection_probability == pytest.approx(0.5625, abs=0.02)
