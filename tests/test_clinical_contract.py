import asyncio
import copy
import json
import sys

import pytest

from trialboard.agent.clinical import (
    count_token,
    metric_identity,
    percentage,
    rate_count_consistent,
)
from trialboard.agent.engine import Limits, run_agent
from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.models import AgentInput, Extraction
from trialboard.agent.provider import Reply
from trialboard.agent.public_case import TEXTS, public_input, score_public_report
from trialboard.agent.report import markdown
from trialboard.agent.verify import verify


def gold():
    """Developer reference transcribed from FDA paragraphs, never sent to live models."""
    rows = []
    for i, (rate, n, population) in enumerate(
        [
            ("85%", "41", "previously treated patients"),
            ("96%", "24", "systemic therapy naïve patients"),
        ]
    ):
        fields = {
            key: {"value": None, "span_id": None, "quote": None}
            for key in (
                "asset",
                "indication",
                "study",
                "cohort",
                "dose",
                "metric",
                "events",
                "denominator",
                "population",
                "window",
                "definition",
                "reported_rate",
            )
        }
        for key, value, index in [
            ("asset", "selpercatinib", 0),
            ("indication", "RET fusion-positive thyroid cancer", 1),
            ("study", "LIBRETTO-001", 1),
            ("metric", "ORR", 2),
            ("denominator", n, 2),
            ("population", population, 2),
            ("definition", "overall response rate (ORR)", 2),
            ("reported_rate", rate, 2),
        ]:
            fields[key] = {"value": value, "span_id": f"fda-{index}", "quote": TEXTS[index]}
        rows.append({"id": f"group-{i}", "value_kind": "reported_percentage", "fields": fields})
    return Extraction.model_validate({"observations": rows})


def test_public_rates_preserve_cohorts_and_do_not_invent_counts_doses_or_timepoints():
    rows, issues = verify(public_input(), gold())
    assert len(rows) == 2
    assert all(o.fields.events.value is None for o in rows)
    assert {o.fields.denominator.value for o in rows} == {"41", "24"}
    assert all(o.fields.dose.value is None and o.fields.window.value is None for o in rows)
    assert {"SECOND_DOSE_MISSING", "REPORTED_RATE_ONLY", "MISSING_FIELD"} <= {
        i.code for i in issues
    }
    assert "DUPLICATE_DOSE_METRIC" not in {i.code for i in issues}


def test_public_excerpt_is_pinned_and_never_mislabeled_as_pdf_bytes():
    data = public_input()
    assert {s.source_digest for s in data.spans} == {
        "89cb0ce158a97d4b70fb19e6a8c38211b61a2cecd2d51613e009f9d51244a383"
    }
    assert data.provenance == "curated_public_excerpt"
    assert all(s.page is None and s.locator.startswith("https://www.fda.gov/") for s in data.spans)


@pytest.mark.parametrize(
    "field,value,span_index,code",
    [
        ("denominator", "65", 1, "RATE_POPULATION_MISMATCH"),
        ("denominator", "24", 2, "RATE_POPULATION_MISMATCH"),
        ("population", "systemic therapy naïve patients", 2, "RATE_POPULATION_MISMATCH"),
        ("reported_rate", "71%", 2, "RATE_POPULATION_MISMATCH"),
        ("reported_rate", "96%", 2, "RATE_POPULATION_MISMATCH"),
        ("events", "35", 2, "COUNT_IN_REPORTED_RATE"),
        ("study", "LIBRETTO-121", 3, "CONTEXT_MISMATCH"),
        ("reported_rate", "85", 2, "INVALID_REPORTED_PERCENTAGE"),
    ],
)
def test_real_source_mutations_are_withheld(field, value, span_index, code):
    raw = gold().model_dump()
    raw["observations"][0]["fields"][field] = {
        "value": value,
        "span_id": f"fda-{span_index}",
        "quote": TEXTS[span_index],
    }
    rows, issues = verify(public_input(), Extraction.model_validate(raw))
    assert "group-0" not in {o.id for o in rows}
    assert code in {i.code for i in issues}


@pytest.mark.parametrize(
    "value,quote",
    [
        ("36", "ORR 36%"),
        ("36", "36 %"),
        ("1", "RECIST 1.1"),
        ("36", "36.5%"),
        ("36", "-36"),
        ("36", "+36"),
        ("36", "136 patients"),
        ("36", "36,000 patients"),
        ("36", "−36 patients"),
        ("36", "36％"),
    ],
)
def test_digits_in_percent_decimals_or_signed_values_are_not_counts(value, quote):
    assert not count_token(value, quote)


@pytest.mark.parametrize(
    "value,quote",
    [
        ("6", "events 6"),
        ("41", "41 patients"),
        ("0", "0 events"),
        ("20", "N=20"),
        ("36", "36 patients; events 36."),
        ("36", "events 36, total 100"),
    ],
)
def test_integer_count_tokens(value, quote):
    assert count_token(value, quote)


@pytest.mark.parametrize("value", ["101%", "-1%", "36", "NaN%", "<5%", "1e2%"])
def test_unsupported_percentage_formats_are_not_point_estimates(value):
    assert percentage(value) is None


def test_rate_consistency_accounts_for_reported_precision_without_back_calculation():
    assert rate_count_consistent("33%", "1", "3")
    assert rate_count_consistent("33.3%", "1", "3")
    assert not rate_count_consistent("33.0%", "1", "3")
    assert not rate_count_consistent("35%", "6", "20")
    assert not rate_count_consistent("0%", "0", "0")


def test_metric_aliases_do_not_collapse_distinct_endpoints():
    assert metric_identity("ORR") is None
    assert metric_identity("ORR", "overall response rate (ORR)") == (
        "response",
        "overall_response_rate",
    )
    assert metric_identity("ORR", "objective response rate (ORR)") != (
        metric_identity("ORR", "overall response rate (ORR)")
    )
    assert metric_identity("adverse reactions") != metric_identity("adverse events")
    assert metric_identity("treatment-related adverse events") != (
        metric_identity("treatment-emergent adverse events")
    )
    assert (
        metric_identity("ORR", "overall response rate (ORR); objective response rate (ORR)") is None
    )
    assert metric_identity("best response") is None


def test_abbreviation_expansion_can_live_in_the_verified_quote_not_the_field_value():
    raw = gold().model_dump()
    for row in raw["observations"]:
        row["fields"]["definition"]["value"] = "overall response rate"
        row["fields"]["definition"]["quote"] = "overall response rate (ORR)"
    rows, issues = verify(public_input(), Extraction.model_validate(raw))
    assert len(rows) == 2
    assert "UNSUPPORTED_METRIC" not in {i.code for i in issues}
    assert metric_identity("ORR", "overall response rate", "overall response rate") is None
    assert metric_identity("ORR", "objective response rate", "overall response rate (ORR)") is None
    raw["observations"][0]["fields"]["definition"] = {
        "value": "objective response rate",
        "span_id": "fda-2",
        "quote": "objective response rate (ORR)",
    }
    rows, issues = verify(public_input(), Extraction.model_validate(raw))
    assert len(rows) == 1
    assert "QUOTE_NOT_IN_SOURCE" in {i.code for i in issues}


def test_unsupported_rate_sentence_remains_unverified_not_successful_comparison():
    data = public_input().model_dump()
    data["spans"][2]["text"] = (
        "ORR overall response rate (ORR); 85%; 41; previously treated patients"
    )
    raw = gold().model_dump()
    raw["observations"] = raw["observations"][:1]
    for field in raw["observations"][0]["fields"].values():
        if field["span_id"] == "fda-2":
            field["quote"] = data["spans"][2]["text"]
    rows, issues = verify(AgentInput.model_validate(data), Extraction.model_validate(raw))
    assert len(rows) == 1
    assert "RATE_BINDING_UNVERIFIED" in {i.code for i in issues}


class PublicGoldProvider:
    mode = "SCRIPTED_TEST_DOUBLE"
    model = "developer-gold-not-a-model"

    async def complete(self, **kwargs):
        value = (
            gold().model_dump()
            if kwargs["schema"]["title"] == "Extraction"
            else {"concerns": [], "next_questions": []}
        )
        return Reply(value, "gold-test", 0, 0)


def test_public_case_grader_is_explicit_development_reference_and_fails_on_missing_rows():
    report = asyncio.run(
        run_agent(public_input(), PublicGoldProvider(), Limits(max_calls=2, max_repairs=0))
    )
    result = score_public_report(report)
    assert result["all_checks_pass"]
    assert result["annotation_status"] == "DEVELOPER_NOT_EXPERT_REVIEWED"
    incomplete = report.model_copy(update={"accepted": report.accepted[:1]})
    assert not score_public_report(incomplete)["all_checks_pass"]
    technical = report.model_copy(update={"status": "FAILED", "accepted": []})
    assert not score_public_report(technical)["all_checks_pass"]
    with pytest.raises(ValueError, match="EVALUATION_INPUT_MISMATCH"):
        score_public_report(report.model_copy(update={"input_digest": "0" * 64}))
    text = markdown(report)
    assert "reported_percentage" in text
    assert "PDF p.None" not in text
    assert "미보고" in text
    assert len(report.metric_mappings) == 2
    assert all(
        m.source_label == "ORR" and m.code == "overall_response_rate"
        for m in report.metric_mappings
    )
    assert "curated" not in result["annotation_status"].lower()


def test_schema_requires_new_fields_and_explicit_nulls():
    schema = Extraction.model_json_schema()
    for obj in schema["$defs"].values():
        if obj.get("type") == "object":
            assert set(obj["properties"]) == set(obj["required"])
            assert obj["additionalProperties"] is False


def test_alias_matching_does_not_hide_endpoint_subtype_conflicts():
    data = demo_input().model_dump()
    for i, label in [(0, "overall response rate"), (1, "objective response rate")]:
        data["spans"][i]["text"] = data["spans"][i]["text"].replace(
            "metric response;", f"metric {label};"
        )
    data = AgentInput.model_validate(data)
    raw = asyncio.run(
        ScriptedProvider().complete(
            instructions="",
            payload={"source": data.model_dump()},
            schema=Extraction.model_json_schema(),
            max_output_tokens=4000,
        )
    ).value
    rows, issues = verify(data, Extraction.model_validate(raw))
    assert len(rows) == 4
    assert "ENDPOINT_SUBTYPE_MISMATCH" in {i.code for i in issues}


def test_conflicting_duplicate_stays_a_conflict_but_distinct_cohorts_do_not_collapse():
    raw = gold().model_dump()
    duplicate = copy.deepcopy(raw["observations"][0])
    duplicate["id"] = "duplicate"
    raw["observations"].append(duplicate)
    rows, issues = verify(public_input(), Extraction.model_validate(raw))
    assert len(rows) == 1
    assert "DUPLICATE_DOSE_METRIC" in {i.code for i in issues}


@pytest.mark.parametrize("empty", [False, True])
def test_public_cli_persists_evaluation_and_exits_nonzero_when_checks_fail(
    monkeypatch, tmp_path, empty
):
    from trialboard.agent import __main__ as cli

    class TestProvider(PublicGoldProvider):
        async def complete(self, **kwargs):
            if empty:
                return Reply({"observations": []}, "empty-test", 0, 0)
            return await super().complete(**kwargs)

    monkeypatch.setattr(cli, "runtime_provider", lambda name: TestProvider())
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "trialboard-agent",
            "--public-example",
            "selpercatinib-2024",
            "--allow-external",
            "--max-calls",
            "2",
            "--max-repairs",
            "0",
        ],
    )
    if empty:
        with pytest.raises(SystemExit) as exc:
            cli.main()
        assert exc.value.code == 3
    else:
        cli.main()
    files = list((tmp_path / "output" / "agent").glob("*.evaluation.json"))
    assert len(files) == 1
    assert json.loads(files[0].read_text())["all_checks_pass"] is (not empty)
    assert files[0].stat().st_mode & 0o777 == 0o600
