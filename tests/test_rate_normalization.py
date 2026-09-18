"""Synthetic split-percent fixtures; no model/network or clinical validation."""

import base64
import copy
import json

import pytest
from test_field_revalidation import codes, field, revise, run, sample


def normalized_fixture():
    f = sample()
    f["review"]["schemaVersion"] = "pdf-field-review/3"
    row = f["review"]["rows"][0]
    row["valueKind"] = "reported_percentage"
    row["fields"]["events"] = {
        "original": {"value": None, "citation": None},
        "current": {"value": None, "citation": None},
        "decision": "unreviewed",
        "history": [],
    }
    spans = f["source"]["source"]["pages"][0]["spans"]
    ids = []
    for text, x, width in [("36", 0.3, 0.04), ("%", 0.345, 0.02)]:
        i = len(spans)
        ids.append(f"p1-i{i}")
        spans.append(
            {
                "id": ids[-1],
                "item": i,
                "page": 1,
                "text": text,
                "box": {"x": x, "y": 0.7, "width": width, "height": 0.03},
            }
        )
    value = {
        "value": "36",
        "citation": {"spanId": ids[0], "page": 1, "quote": "36"},
        "supporting": [{"spanId": ids[1], "page": 1, "quote": "%", "role": "unit"}],
        "normalization": {
            "method": "adjacent-percent/1",
            "display": "36%",
            "unitSpanId": ids[1],
            "pointEstimateAttested": True,
            "sameGroupAttested": True,
        },
    }
    revise(field(f, "reported_rate"), value)
    return f


def replace_rate(f, mutate):
    rf = field(f, "reported_rate")
    mutate(rf["current"])
    rf["history"][-1]["after"] = copy.deepcopy(rf["current"])


def test_normalized_percent_keeps_raw_citations_history_and_no_inferred_events():
    from trialboard.agent.revalidate import markdown

    f = normalized_fixture()
    before = copy.deepcopy(f)
    r = run(f)
    assert f == before
    assert r["normalized_rates"] == {"obs-0": "36%"}
    assert len(r["accepted"]) == 4
    assert r["review"] == f["review"]
    assert field(f, "reported_rate")["current"]["citation"]["quote"] == "36"
    assert field(f, "events")["current"]["value"] is None
    assert "REPORTED_RATE_ONLY" in codes(r)
    assert r["clinical_approval"] is False
    assert r["model_calls"] == 0
    assert "사용자 해석: 36%" in markdown(r)


@pytest.mark.parametrize(
    "change",
    [
        {"display": "37%"},
        {"method": "automatic/1"},
        {"unitSpanId": "p1-i0"},
        {"pointEstimateAttested": False},
        {"pointEstimateAttested": 1},
        {"sameGroupAttested": "true"},
        {"sameGroupAttested": 1},
    ],
)
def test_rejects_forged_display_method_unit_and_coerced_attestations(change):
    f = normalized_fixture()
    replace_rate(f, lambda v: v["normalization"].update(change))
    with pytest.raises(ValueError):
        run(f)


@pytest.mark.parametrize("version", ["pdf-field-review/1", "pdf-field-review/2"])
def test_rejects_downgrade(version):
    f = normalized_fixture()
    f["review"]["schemaVersion"] = version
    with pytest.raises(ValueError, match="NORMALIZATION_REQUIRES_RATE_V3"):
        run(f)


@pytest.mark.parametrize("change", [{"x": 0.6}, {"y": 0.2}, {"x": 0.26}])
def test_nonadjacent_or_header_unit_rejected(change):
    f = normalized_fixture()
    f["source"]["source"]["pages"][0]["spans"][-1]["box"].update(change)
    with pytest.raises(ValueError, match="NORMALIZATION_UNIT_NOT_ADJACENT"):
        run(f)


@pytest.mark.parametrize("text", ["95% CI", "confidence interval", "p value", "신뢰구간"])
def test_nearby_interval_or_p_value_is_not_accepted_as_outcome(text):
    f = normalized_fixture()
    spans = f["source"]["source"]["pages"][0]["spans"]
    spans.append(
        {
            "id": f"p1-i{len(spans)}",
            "item": len(spans),
            "page": 1,
            "text": text,
            "box": {"x": 0.2, "y": 0.7, "width": 0.09, "height": 0.03},
        }
    )
    with pytest.raises(ValueError, match="NORMALIZATION_INTERVAL_CONTEXT"):
        run(f)


def test_missing_metadata_does_not_silently_attach_unit():
    f = normalized_fixture()
    replace_rate(f, lambda v: v.pop("normalization"))
    r = run(f)
    assert "normalized_rates" not in r
    assert len(r["accepted"]) == 3


def test_held_row_excluded_but_historical_normalization_still_validated():
    f = normalized_fixture()
    revise(field(f, "dose"), decision="held")
    r = run(f)
    assert "normalized_rates" not in r
    f["source"]["source"]["pages"][0]["spans"][-1]["text"] = "mg"
    with pytest.raises(ValueError, match="NORMALIZATION_LITERAL_UNIT_REQUIRED"):
        run(f)


def test_design_and_ai_receive_separate_user_interpretation_not_modified_quote():
    from test_design_compare import brief_for
    from test_design_compare import run as compare
    from test_recritique import Answer, execute

    f, p = normalized_fixture(), Answer()
    result = execute(f, p)
    assert result["status"] == "COMPLETED"
    payload = p.requests[0]["payload"]
    assert payload["user_normalized_rates"] == {"obs-0": "36%"}
    rate = payload["extraction"]["observations"][0]["fields"]["reported_rate"]
    assert rate["value"] == rate["quote"] == "36"
    brief = brief_for(f)
    design = compare(f, brief)
    assert design["status"] == "HYPOTHETICAL_COMPARISON_ONLY"
    assert brief["scenarios"][0]["response"] == [0.3, 0.32]


def test_v3_project_reopen_preserves_raw_unit_and_interpretation(tmp_path):
    from trialboard.api.projects import CheckpointInput, ProjectStore

    f = normalized_fixture()
    source = f["source"]["source"]
    bundle = {
        "schema": "trialboard-project/1",
        "source": source,
        "notes": [],
        "reviewRaw": json.dumps(f["review"]),
        "agentRaw": None,
        "context": None,
        "meetingRaw": None,
        "draftRaw": json.dumps(
            {"schema_version": "design-draft/1", "source_digest": source["sha256"]}
        ),
    }
    path = tmp_path / "normalization.sqlite"
    saved = ProjectStore(path).save(
        CheckpointInput(
            consent=True,
            expected_revision=0,
            project_id=None,
            title="MOC split-percent",
            bundle_json=json.dumps(bundle),
            pdf_base64=base64.b64encode(f["pdf"]).decode(),
        )
    )
    loaded = ProjectStore(path).read(saved["project_id"], 1)
    assert json.loads(loaded["bundle_json"])["reviewRaw"] == bundle["reviewRaw"]
