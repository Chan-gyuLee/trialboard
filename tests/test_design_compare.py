"""Hypothetical design integration with explicitly synthetic source contracts."""

import asyncio
import copy
import hashlib
import json
import os
import subprocess
import sys

import pytest
from test_field_revalidation import encode, revise, sample

from trialboard.agent.design_compare import DesignBrief, compare_designs, markdown
from trialboard.agent.example import ScriptedProvider
from trialboard.agent.provider import Reply
from trialboard.agent.recritique import recritique
from trialboard.serialization import sha256_json


def brief_for(f):
    return {
        "schema_version": "design-brief/1",
        "source_digest": f["review"]["sourceDigest"],
        "review_content_digest": sha256_json(f["review"]),
        "question": f["context"]["question"]
        if f["context"]
        else json.loads(f["agent"])["input"]["question"],
        "arms": [
            {"id": "arm-a", "source_dose": "dose-A", "observation_ids": ["obs-0", "obs-2"]},
            {"id": "arm-b", "source_dose": "dose-B", "observation_ids": ["obs-1", "obs-3"]},
        ],
        "plans": [
            {"id": "small", "label": "30 per arm", "per_arm": 30, "rationale": "Synthetic size A"},
            {"id": "large", "label": "60 per arm", "per_arm": 60, "rationale": "Synthetic size B"},
        ],
        "scenarios": [
            {
                "id": "plateau",
                "label": "Hypothetical plateau",
                "response": [0.3, 0.32],
                "adverse_event": [0.12, 0.25],
                "adverse_event_penalty": 0.7,
                "maximum_adverse_event_rate": 0.35,
                "rationale": "Explicit hypothetical values, not evidence estimates",
                "provenance": "user_declared_hypothetical",
            },
            {
                "id": "unsafe",
                "label": "Hypothetical both unsafe",
                "response": [0.3, 0.4],
                "adverse_event": [0.6, 0.7],
                "adverse_event_penalty": 0.7,
                "maximum_adverse_event_rate": 0.35,
                "rationale": "Explicit stress test",
                "provenance": "user_declared_hypothetical",
            },
        ],
        "seed": 42,
        "repetitions": 500,
    }


@pytest.mark.parametrize(
    "reserved",
    ["no_selection", "true_utility_best", "true_unsafe", "__proto__", "constructor", "prototype"],
)
def test_reserved_arm_ids_cannot_overwrite_simulation_statistics(reserved):
    b = brief_for(sample())
    b["arms"][0]["id"] = reserved
    with pytest.raises(ValueError, match="RESERVED_ARM_ID"):
        DesignBrief.model_validate(b)


def run(f=None, brief=None, ai=None):
    f = f or sample()
    return compare_designs(
        encode(brief or brief_for(f)),
        encode(f["review"]),
        encode(f["source"]),
        f["pdf"],
        agent_raw=f["agent"],
        context=f["context"],
        ai_raw=ai,
    )


def ai_result(f, concerns=None):
    class Opinions(ScriptedProvider):
        async def complete(self, **kwargs):
            return Reply({"concerns": concerns or [], "next_questions": []}, "synthetic", 0, 0)

    return asyncio.run(
        recritique(
            encode(f["review"]),
            encode(f["source"]),
            f["pdf"],
            Opinions(),
            agent_raw=f["agent"],
            context=f["context"],
        )
    )


def prior_limited_sample():
    f = sample(imported=True)
    report = json.loads(f["agent"])
    report["attempts"][-1]["critique"]["concerns"] = [
        {
            "scope": "comparison_limitation",
            "observation_ids": ["obs-0", "obs-1"],
            "span_ids": ["p1-i0", "p1-i1"],
            "reason": "Synthetic applicability gap requiring new evidence",
        }
    ]
    f["agent"] = encode(report)
    f["review"]["origin"]["reportDigest"] = hashlib.sha256(f["agent"]).hexdigest()
    return f


def test_original_comparison_limitations_survive_human_field_confirmation():
    f = prior_limited_sample()
    result = run(f)
    assert result["status"] == "BLOCKED_EVIDENCE_LINK"
    assert result["simulations"] == []
    assert any(b["code"] == "PREVIOUS_AI_LIMITATION_UNRESOLVED" for b in result["blockers"])
    assert result["kol_questions"]


def test_current_recritique_supersedes_old_comparison_limitations():
    f = prior_limited_sample()
    result = run(f, ai=encode(ai_result(f)))
    assert len(result["simulations"]) == 4
    assert not any(b["code"] == "PREVIOUS_AI_LIMITATION_UNRESOLVED" for b in result["blockers"])


def test_two_plans_two_scenarios_are_hypothetical_not_recommended():
    f = sample()
    before = copy.deepcopy(f)
    b = brief_for(f)
    r = run(f, b)
    assert f == before
    assert r["status"] == "HYPOTHETICAL_COMPARISON_ONLY"
    assert r["clinical_approval"] is False and r["recommended_plan_id"] is None
    assert r["model_calls"] == 0 and r["ai_status"] == "NOT_SUPPLIED"
    assert len(r["simulations"]) == 4 and len(r["evidence_rows"]) == 4
    assert [p["total_sample_size"] for p in r["plans"]] == [60, 120]
    for s in r["simulations"]:
        assert (
            abs(sum(s["selection_probability"].values()) + s["no_selection_probability"] - 1)
            < 1e-10
        )
        assert "true_utility_best" in s["monte_carlo_se"]
        assert s["scenario"]["provenance"] == "synthetic_assumption"
    assert r["simulations"] == run(f, b)["simulations"]
    assert all(q["answer_status"] == "UNANSWERED" for q in r["kol_questions"])


def test_scenario_assumptions_not_derived_from_observed_counts():
    f = sample()
    b = brief_for(f)
    b["scenarios"][0]["response"] = [0.01, 0.99]
    r = run(f, b)
    assert r["simulations"][0]["scenario"]["response"] == [0.01, 0.99]
    assert r["evidence_rows"][0]["fields"]["events"]["value"] == "6"


def test_user_hold_blocks_comparison_and_creates_action_questions():
    f = sample()
    revise(f["review"]["rows"][0]["fields"]["reported_rate"], decision="held")
    r = run(f)
    assert r["status"] == "BLOCKED_EVIDENCE_LINK" and not r["simulations"]
    assert any(b["code"] == "OBSERVATION_WITHHELD" for b in r["blockers"])
    assert any(q["priority"] == "BEFORE_COMPARISON" for q in r["kol_questions"])
    assert len(r["plans"]) == 2


def test_unreviewed_required_fields_never_feed_comparison():
    f = sample()
    for field in f["review"]["rows"][0]["fields"].values():
        field.update(current=copy.deepcopy(field["original"]), decision="unreviewed", history=[])
    assert not run(f)["simulations"]


def test_wrong_dose_mapping_blocks_not_auto_corrects():
    f = sample()
    b = brief_for(f)
    b["arms"][0]["source_dose"] = "40 mg"
    r = run(f, b)
    assert any(x["code"] == "SOURCE_DOSE_MISMATCH" for x in r["blockers"])
    assert not r["simulations"]


def test_source_context_mismatch_blocks_comparison():
    f = sample()
    span = f["source"]["source"]["pages"][0]["spans"][1]
    span["text"] = span["text"].replace("week-12", "week-24")
    field = f["review"]["rows"][1]["fields"]["window"]
    field["current"]["value"] = "week-24"
    field["current"]["citation"]["quote"] = "window week-24"
    field["history"][-1]["after"] = copy.deepcopy(field["current"])
    r = run(f)
    assert any(x["code"] == "COMPARISON_CONTEXT_MISMATCH" for x in r["blockers"])
    assert not r["simulations"]


@pytest.mark.parametrize("scope", ["observation_error", "comparison_limitation"])
def test_supplied_current_ai_objection_blocks_plan_without_mutating_review(scope):
    f = sample(imported=True)
    ai = ai_result(
        f,
        [
            {
                "scope": scope,
                "observation_ids": ["obs-0"],
                "span_ids": ["p1-i0"],
                "reason": "Synthetic question",
            }
        ],
    )
    r = run(f, ai=encode(ai))
    assert not r["simulations"]
    assert r["revalidation"]["review"] == f["review"]
    assert r["ai_status"] == "CURRENT_REPORT_SUPPLIED_UNAUTHENTICATED"


def test_current_ai_empty_opinions_does_not_claim_approval():
    f = sample(imported=True)
    ai = ai_result(f)
    r = run(f, ai=encode(ai))
    assert len(r["simulations"]) == 4 and not r["clinical_approval"]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda b: b.update(review_content_digest="0" * 64),
        lambda b: b.update(source_digest="0" * 64),
        lambda b: b.update(question="Different question"),
        lambda b: b["arms"][0].update(observation_ids=["missing"]),
        lambda b: b["arms"][1].update(observation_ids=["obs-0"]),
        lambda b: b["arms"][1].update(source_dose="dose-A"),
        lambda b: b["plans"][1].update(per_arm=30),
        lambda b: b["plans"][0].update(per_arm=True),
        lambda b: b["plans"][0].update(per_arm=501),
        lambda b: b["plans"][0].update(id="large"),
        lambda b: b["scenarios"][0].update(response=[0.3]),
        lambda b: b["scenarios"][0].update(response=[float("nan"), 0.3]),
        lambda b: b["scenarios"][0].update(provenance="estimated_from_evidence"),
        lambda b: b.update(repetitions=20001),
        lambda b: b.update(seed=True),
        lambda b: b.update(clinical_approval=True),
    ],
)
def test_invalid_or_stale_brief_refused(mutation):
    f = sample()
    b = brief_for(f)
    mutation(b)
    with pytest.raises(ValueError):
        run(f, b)


@pytest.mark.parametrize(
    "key,value", [("status", "FAILED"), ("clinical_approval", True), ("request_digest", "0" * 64)]
)
def test_stale_or_invalid_ai_report_is_not_ignored(key, value):
    f = sample()
    ai = ai_result(f)
    ai[key] = value
    with pytest.raises(ValueError):
        run(f, ai=encode(ai))


def test_new_confirmation_invalidates_brief_and_ai_binding():
    f = sample()
    b = brief_for(f)
    ai = ai_result(f)
    revise(f["review"]["rows"][0]["fields"]["dose"], decision="confirmed")
    with pytest.raises(ValueError):
        run(f, b)
    with pytest.raises(ValueError):
        run(f, ai=encode(ai))


def test_cli_private_reports_preserve_inputs_and_show_hypothetical_status(tmp_path):
    f = sample()
    b = brief_for(f)
    for name, data in [
        ("brief.json", encode(b)),
        ("review.json", encode(f["review"])),
        ("source.json", encode(f["source"])),
        ("source.pdf", f["pdf"]),
    ]:
        (tmp_path / name).write_bytes(data)
    args = [sys.executable, "-m", "trialboard.agent.design_compare"]
    for key, name in [
        ("brief", "brief.json"),
        ("review", "review.json"),
        ("source-export", "source.json"),
        ("pdf", "source.pdf"),
    ]:
        args += [f"--{key}", str(tmp_path / name)]
    for k, v in f["context"].items():
        args += [f"--{k}", v]
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    for _ in range(2):
        result = subprocess.run(args, cwd=tmp_path, capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr
        assert b"HYPOTHETICAL_COMPARISON_ONLY" in result.stdout
    reports = list((tmp_path / "output/design-comparison").glob("*/report.json"))
    assert len(reports) == 2
    if os.name == "posix":
        assert all(p.stat().st_mode & 0o777 == 0o600 for p in reports)
    assert all((tmp_path / name).read_bytes() == raw for name, raw in before.items())


def test_report_escapes_external_labels_and_questions():
    f = sample()
    b = brief_for(f)
    b["plans"][0]["label"] = "<script>alert(1)</script>"
    text = markdown(run(f, b))
    assert "<script>" not in text and "Monte Carlo" in text


def test_brief_rejects_aggregate_work_over_budget():
    f = sample()
    b = brief_for(f)
    b["arms"] += [
        {"id": "c", "source_dose": "C", "observation_ids": ["obs-4"]},
        {"id": "d", "source_dose": "D", "observation_ids": ["obs-5"]},
    ]
    b["plans"] += [
        {"id": "p3", "label": "P3", "per_arm": 40, "rationale": "test"},
        {"id": "p4", "label": "P4", "per_arm": 50, "rationale": "test"},
    ]
    b["scenarios"] = [
        {**b["scenarios"][0], "id": f"s{i}", "response": [0.3] * 4, "adverse_event": [0.2] * 4}
        for i in range(6)
    ]
    b["repetitions"] = 20000
    with pytest.raises(ValueError, match="SIMULATION_WORK_BUDGET"):
        DesignBrief.model_validate(b)


def test_comparison_tradeoffs_use_first_plan_as_reference_and_keep_mc_error():
    r = run()
    assert len(r["tradeoffs"]) == 2
    for t in r["tradeoffs"]:
        assert t["reference_plan_id"] == "small"
        assert t["alternative_plan_id"] == "large"
        assert t["additional_participants"] == 60
        sims = [s for s in r["simulations"] if s["scenario"]["id"] == t["scenario_id"]]
        assert t["correct_selection_or_abstention_delta"] == (
            sims[1]["selects_true_utility_best_probability"]
            - sims[0]["selects_true_utility_best_probability"]
        )
        assert t["delta_monte_carlo_se"]["true_utility_best"] >= 0
    assert len([q for q in r["kol_questions"] if q["category"] == "sample_size_tradeoff"]) == 2
    assert len(r["engine_digest"]) == 64 and r["runtime"]["numpy"]
    assert "권장" in markdown(r)


def test_blocked_evidence_does_not_offer_simulation_tradeoff_questions():
    f = sample()
    revise(f["review"]["rows"][0]["fields"]["dose"], decision="held")
    r = run(f)
    assert not r["tradeoffs"]
    assert not any(q["category"] == "sample_size_tradeoff" for q in r["kol_questions"])


def test_all_unsafe_correct_selection_metric_is_abstention_not_best_dose():
    r = run()
    unsafe = [s for s in r["simulations"] if s["scenario"]["id"] == "unsafe"]
    for s in unsafe:
        assert s["true_utility_best_arms"] == []
        assert s["selects_true_utility_best_probability"] == s["no_selection_probability"]
    assert "올바른 선택/보류" in markdown(r)
