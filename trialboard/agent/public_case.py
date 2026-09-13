"""Frozen development case, NOT an independent/expert-labelled clinical benchmark.

FDA-authored public announcement, retrieved 2026-09-13. Verbatim paragraphs retain
the source's spelling. Digest covers selected UTF-8 text via canonical JSON, not
the HTML/PDF bytes. No network fetching occurs during case execution.
"""

from trialboard.agent.models import AgentInput, AgentReport, Span
from trialboard.serialization import sha256_json

CASE_VERSION = "selpercatinib-fda-2024/1"
SOURCE_URL = (
    "https://www.fda.gov/drugs/resources-information-approved-drugs/"
    "fda-approves-selpercatinib-ret-fusion-positive-thyroid-cancer"
)
SOURCE_DATE = "2024-06-12"
TEXTS = [
    "On June 12, 2024, the Food and Drug Administration granted traditional approval to "
    "selpercatinib (Retevmo, Eli Lilly and Company) for adult and pediatric patients 2 years "
    "of age and older with advanced or metastatic RET fusion-positive thyroid cancer who "
    "require systemic therapy and who are radioactive iodine-refractory "
    "(if radioactive iodine is appropriate).",
    "Efficacy was evaluated in LIBRETTO-001 (NCT03157128), a multicenter, open-label, "
    "muti-cohort clinical trial in 65 patients with RET fusion-positive thyroid cancer "
    "who were radioactive iodine (RAI)-refractory (if RAI was an appropriate treatment "
    "option) and were systemic therapy naïve and patients who were previously treated, "
    "in separate cohorts.",
    "The major efficacy outcome measures were overall response rate (ORR) and duration "
    "of response (DOR). The ORR was 85% (95% CI: 71%, 94%) in the 41 previously treated "
    "patients and 96% (95% CI: 79%, 100%) in the 24 systemic therapy naïve patients. "
    "Median DOR was 26.7 months (95% CI: 12.1, not evaluable [NE]) in the previously "
    "treated patients and NE (95% CI: 42.8, NE) in the systemic therapy naïve patients.",
    "Supportive evidence included ORR and DOR data from 10 pediatric and young adult "
    "patients with RET fusion-positive thyroid cancer treated in Study LIBRETTO-121 "
    "(J2G-OX-JZJJ; NCT03899792), an international, single-arm, multi-cohort clinical "
    "trial of selpercatinib in pediatric and young adult patients with advanced "
    "RET-altered solid tumors. The ORR was 60% (95% CI: 26%, 88%), and 83% had an "
    "observed duration of response ≥ 12 months.",
    "The recommended selpercatinib dose for pediatric patients 2 to less than 12 years "
    "of age is based on body surface area. It is based on weight for patients 12 years "
    "of age and older. See the prescribing information for specific dosing information.",
]


def public_input():
    digest = sha256_json(TEXTS)
    return AgentInput(
        question="LIBRETTO-001의 코호트별 ORR, 보고된 분모와 결측을 분리해 검토하라. "
        "이 발췌만으로 용량 간 비교가 가능한가?",
        asset="selpercatinib",
        indication="RET fusion-positive thyroid cancer",
        study="LIBRETTO-001",
        provenance="curated_public_excerpt",
        spans=[
            Span(
                id=f"fda-{i}",
                source_digest=digest,
                page=None,
                text=text,
                locator=f"{SOURCE_URL} · {CASE_VERSION} · selected paragraph {i + 1}",
            )
            for i, text in enumerate(TEXTS)
        ],
    )


def score_public_report(report: AgentReport):
    """Visible, developer-authored acceptance checks; not an AI/expert quality grade."""
    expected_input = public_input()
    if report.input_digest != sha256_json(expected_input.model_dump()):
        raise ValueError("EVALUATION_INPUT_MISMATCH")
    from trialboard.agent.clinical import metric_identity, normalized

    rows = report.accepted
    tuples = {
        (
            o.fields.reported_rate.value,
            o.fields.denominator.value,
            normalized(o.fields.population.value),
        )
        for o in rows
    }
    expected = {
        ("85%", "41", "previously treated patients"),
        ("96%", "24", "systemic therapy naïve patients"),
    }
    all_rows = [o for a in report.attempts if a.extraction for o in a.extraction.observations]
    checks = {
        "source_input_matches": report.input == expected_input,
        "both_cohorts_retained": len(rows) == 2 and tuples == expected,
        "no_invented_counts_in_any_attempt": bool(all_rows)
        and all(
            o.value_kind == "reported_percentage" and o.fields.events.value is None
            for o in all_rows
        ),
        "no_invented_dose_or_window": bool(rows)
        and all(o.fields.dose.value is None and o.fields.window.value is None for o in rows),
        "no_other_trial_adopted": bool(rows)
        and all(o.fields.study.value == "LIBRETTO-001" for o in rows),
        "orr_expansion_preserved": bool(rows)
        and all(
            metric_identity(
                o.fields.metric.value, o.fields.definition.value, o.fields.definition.quote
            )
            == ("response", "overall_response_rate")
            for o in rows
        ),
        "comparison_withheld": report.status == "PARTIAL_ABSTENTION",
    }
    return {
        "case_version": CASE_VERSION,
        "annotation_status": "DEVELOPER_NOT_EXPERT_REVIEWED",
        "scope": "Single development case; not held-out clinical accuracy",
        "all_checks_pass": all(checks.values()),
        "checks": checks,
    }
