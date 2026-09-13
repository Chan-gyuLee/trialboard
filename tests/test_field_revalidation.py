"""Synthetic contracts only: no real PDF interpretation, network or model invocation."""

import asyncio
import copy
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from trialboard.agent.engine import run_agent
from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.field_review_contract import ReviewPacket
from trialboard.agent.pdf_input import from_pdf_export
from trialboard.agent.revalidate import JSON_LIMIT, markdown, read_json, revalidate


def encode(value):
    return json.dumps(value, ensure_ascii=False).encode()


def sample(*, imported=False, scenario="normal"):
    demo = demo_input()
    # Byte-level identity fixture, deliberately NOT a renderable or clinical PDF.
    pdf = b"%PDF-SYNTHETIC-CONTRACT-ONLY"
    digest = hashlib.sha256(pdf).hexdigest()
    box = {"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.1}
    spans = [
        {"id": f"p1-i{i}", "item": i, "page": 1, "text": s.text, "box": box}
        for i, s in enumerate(demo.spans)
    ]
    source = {
        "schemaVersion": "pdf-evidence/1",
        "name": "synthetic.pdf",
        "sha256": digest,
        "byteLength": len(pdf),
        "extractor": "synthetic-test",
        "status": "TEXT_EXTRACTED",
        "coordinateSystem": "normalized_top_left_rotated_viewport",
        "pages": [
            {
                "number": 1,
                "width": 100,
                "height": 100,
                "rotation": 0,
                "status": "TEXT_EXTRACTED",
                "spans": spans,
            }
        ],
    }
    notes = [
        {
            "spanId": s["id"],
            "sourceDigest": digest,
            "quote": s["text"],
            "page": 1,
            "box": box,
            "locationStatus": "USER_ATTESTED_VISUAL_MATCH",
            "meaningStatus": "NOT_ASSESSED",
        }
        for s in spans
    ]
    packet = {"schemaVersion": "pdf-evidence-review/1", "source": source, "notes": notes}
    context = {k: getattr(demo, k) for k in ("asset", "indication", "study", "question")}
    data = from_pdf_export(packet, **context)
    report = asyncio.run(run_agent(data, ScriptedProvider(scenario)))
    agent_raw = report.model_dump_json().encode()
    origin = {"kind": "manual", "runId": None, "reportDigest": None, "mode": None}
    if imported:
        origin = {
            "kind": "imported_agent_report",
            "runId": report.run_id,
            "reportDigest": hashlib.sha256(agent_raw).hexdigest(),
            "mode": report.execution_mode,
        }
    review = {
        "schemaVersion": "pdf-field-review/1",
        "sourceDigest": digest,
        "sourceName": source["name"],
        "origin": origin,
        "rows": [],
        "modelFindings": [],
        "persisted": False,
        "reviewerIdentity": "UNAUTHENTICATED_USER",
        "clinicalApproval": False,
        "downstreamStatus": "REQUIRES_REVALIDATION",
        "limitations": [],
    }
    for o in report.attempts[-1].extraction.observations:
        fields = {}
        for name in type(o.fields).model_fields:
            f = getattr(o.fields, name)
            value = {
                "value": f.value,
                "citation": {"spanId": f.span_id, "page": 1, "quote": f.quote}
                if f.span_id
                else None,
            }
            original = copy.deepcopy(value) if imported else {"value": None, "citation": None}
            fields[name] = {
                "original": original,
                "current": copy.deepcopy(original),
                "decision": "unreviewed",
                "history": [],
            }
            if f.value is not None:
                revise(fields[name], value, "confirmed" if imported else "corrected")
        review["rows"].append(
            {"id": o.id, "origin": origin["kind"], "valueKind": o.value_kind, "fields": fields}
        )
    return {
        "review": review,
        "source": packet,
        "pdf": pdf,
        "agent": agent_raw if imported else None,
        "context": None if imported else context,
    }


def revise(field, value=None, decision="corrected", reason="합성 자료 확인"):
    after = copy.deepcopy(field["current"] if value is None else value)
    field["history"].append(
        {
            "revision": len(field["history"]) + 1,
            "decision": decision,
            "before": copy.deepcopy(field["current"]),
            "after": after,
            "reason": reason,
            "at": "2026-09-13T00:00:00.000Z",
        }
    )
    field["current"] = copy.deepcopy(after)
    field["decision"] = decision


def run(fixture):
    return revalidate(
        encode(fixture["review"]),
        encode(fixture["source"]),
        fixture["pdf"],
        agent_raw=fixture["agent"],
        context=fixture["context"],
    )


def field(fixture, name="dose", row=0):
    return fixture["review"]["rows"][row]["fields"][name]


def codes(result):
    return {f["code"] for f in result["findings"]}


@pytest.mark.parametrize("imported", [False, True])
def test_review_roundtrip_is_offline_unapproved_and_keeps_all_audit_values(imported):
    fixture = sample(imported=imported)
    original = copy.deepcopy(fixture)
    result = run(fixture)
    assert len(result["accepted"]) == 4
    assert fixture == original
    assert result["model_calls"] == 0
    assert result["clinical_approval"] is False
    assert result["critique_status"] == "NOT_RERUN"
    assert result["comparison_status"] == "NOT_APPROVED"
    assert "NOT_REEXTRACTED" in result["source_integrity"]
    assert result["review"] == fixture["review"]
    assert (result["previous_model_review"] is not None) == imported


def test_correcting_unsupported_denominator_removes_rule_issue_but_not_ai_history():
    fixture = sample(imported=True, scenario="persistent")
    f = field(fixture, "denominator", 1)
    fixed = copy.deepcopy(f["current"])
    fixed["value"] = "20"
    revise(f, fixed)
    result = run(fixture)
    assert len(result["accepted"]) == 4
    assert "VALUE_NOT_IN_QUOTE" not in codes(result)
    assert any(
        f["code"] == "VALUE_NOT_IN_QUOTE" for f in result["finding_delta"]["no_longer_emitted"]
    )
    assert result["review"]["rows"][1]["fields"]["denominator"]["original"]["value"] == "200"
    assert (
        result["previous_model_review"]["extraction"]["observations"][1]["fields"]["denominator"][
            "value"
        ]
        == "200"
    )
    assert result["critique_status"] == "NOT_RERUN"


def test_unreviewed_fields_do_not_silently_pass_even_if_the_model_accepted_them():
    fixture = sample(imported=True)
    f = field(fixture, "denominator")
    f["decision"], f["history"] = "unreviewed", []
    result = run(fixture)
    assert len(result["accepted"]) == 3
    assert {"FIELD_UNREVIEWED", "MISSING_FIELD", "INVALID_COUNT"} <= codes(result)
    assert (
        result["effective_extraction"]["observations"][0]["fields"]["denominator"]["value"] is None
    )
    assert field(fixture, "denominator")["current"]["value"] == "20"


@pytest.mark.parametrize("name", ["dose", "denominator", "reported_rate"])
def test_even_an_optional_or_missing_held_field_excludes_observation(name):
    fixture = sample(imported=True)
    revise(field(fixture, name), decision="held")
    result = run(fixture)
    assert result["excluded_observation_ids"] == ["obs-0"]
    assert "obs-0" not in {o["id"] for o in result["accepted"]}
    assert "obs-0" not in {o["id"] for o in result["effective_extraction"]["observations"]}
    assert "FIELD_HELD" in codes(result)
    assert {o["id"] for o in result["accepted"]} == {"obs-1", "obs-2", "obs-3"}


def test_all_held_has_no_observations_not_fake_success():
    fixture = sample(imported=True)
    for row in fixture["review"]["rows"]:
        revise(row["fields"]["dose"], decision="held")
    result = run(fixture)
    assert result["accepted"] == []
    assert result["status"] == "NO_REVIEWABLE_OBSERVATIONS"
    assert "NO_OBSERVATIONS" in codes(result)


def test_same_source_wrong_study_is_rejected_as_clinical_context_not_missing():
    fixture = sample()
    fixture["context"]["study"] = "different-trial"
    result = run(fixture)
    assert result["accepted"] == []
    assert "CONTEXT_MISMATCH" in codes(result)


def test_releasing_a_duplicate_by_holding_it_recomputes_group_checks():
    fixture = sample()
    extra = copy.deepcopy(fixture["review"]["rows"][0])
    extra["id"] = "manual-extra"
    fixture["review"]["rows"].append(extra)
    assert "DUPLICATE_DOSE_METRIC" in codes(run(fixture))
    revise(extra["fields"]["dose"], decision="held")
    result = run(fixture)
    assert len(result["accepted"]) == 4
    assert "DUPLICATE_DOSE_METRIC" not in codes(result)
    assert result["excluded_observation_ids"] == ["manual-extra"]


def test_window_change_recomputes_comparison_without_discarding_unrelated_observations():
    fixture = sample()
    span = fixture["source"]["source"]["pages"][0]["spans"][0]
    span["text"] += " Alternative window week-8."
    revise(
        field(fixture, "window"),
        {
            "value": "week-8",
            "citation": {"spanId": span["id"], "page": 1, "quote": "Alternative window week-8."},
        },
    )
    result = run(fixture)
    assert len(result["accepted"]) == 4  # Literal source-supported observations, not pooled rates.
    assert any(
        f["code"] == "COMPARISON_CONTEXT_MISMATCH" and f["field"] == "window"
        for f in result["finding_delta"]["added"]
    )
    assert result["comparison_status"] == "NOT_APPROVED"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda f: f.update(pdf=b"%PDF-another"),
        lambda f: f["source"]["source"].update(sha256="0" * 64),
        lambda f: f["source"]["source"].update(byteLength=999),
        lambda f: f["review"].update(sourceDigest="0" * 64),
        lambda f: f["review"].update(sourceName="different.pdf"),
        lambda f: f["source"]["source"]["pages"][0].update(number=2),
        lambda f: f["source"]["source"]["pages"][0]["spans"][0].update(page=2),
        lambda f: f["source"]["source"]["pages"][0]["spans"].append(
            copy.deepcopy(f["source"]["source"]["pages"][0]["spans"][0])
        ),
        lambda f: f["source"]["source"]["pages"][0]["spans"][0].update(box=None),
        lambda f: f["source"]["source"]["pages"][0]["spans"][0]["box"].update(x=0.9),
        lambda f: f["source"]["source"]["pages"][0].update(status="NO_TEXT"),
    ],
)
def test_wrong_pdf_identity_page_geometry_or_source_structure_fails_closed(mutation):
    fixture = sample()
    mutation(fixture)
    with pytest.raises(ValueError):
        run(fixture)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda f: f.update(decision="approved"),
        lambda f: f.update(history=[]),
        lambda f: f["current"].update(value="invented"),
        lambda f: f["history"][0].update(revision=2),
        lambda f: f["history"][0].update(reason=" "),
        lambda f: f["history"][0].update(at="2026-09-13"),
        lambda f: f["history"][0].update(at="not-a-date"),
        lambda f: f["history"][0].update(decision="held"),
        lambda f: f["history"][0]["before"].update(value="altered"),
        lambda f: f["original"].update(value="model-original"),
    ],
)
def test_forged_or_inconsistent_history_is_not_treated_as_reviewed(mutation):
    fixture = sample()
    mutation(field(fixture))
    with pytest.raises(ValueError):
        run(fixture)


@pytest.mark.parametrize(
    "key,value",
    [
        ("clinicalApproval", True),
        ("clinicalApproval", 0),
        ("persisted", True),
        ("reviewerIdentity", "EXPERT"),
        ("downstreamStatus", "APPROVED"),
    ],
)
def test_browser_trust_flags_cannot_promote_approval(key, value):
    fixture = sample()
    fixture["review"][key] = value
    with pytest.raises(ValueError):
        run(fixture)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda f: f.update(agent=None),
        lambda f: f.update(agent=f["agent"] + b" "),
        lambda f: f.update(context={"question": "override"}),
        lambda f: f["review"]["origin"].update(runId="other-run"),
        lambda f: f["review"]["origin"].update(mode="CODEX_CHATGPT"),
        lambda f: f["review"]["rows"].pop(),
        lambda f: f["review"]["rows"][0].update(valueKind="reported_percentage"),
    ],
)
def test_imported_review_requires_exact_original_report_and_row_identity(mutation):
    fixture = sample(imported=True)
    mutation(fixture)
    with pytest.raises(ValueError):
        run(fixture)


def test_changing_model_original_even_with_consistent_history_is_detected():
    fixture = sample(imported=True)
    f = field(fixture)
    f["original"]["value"] = "dose-B"
    f["history"][0]["before"]["value"] = "dose-B"
    f["history"][0]["decision"] = "corrected"
    f["decision"] = "corrected"
    with pytest.raises(ValueError, match="MODEL_ORIGINAL_CHANGED"):
        run(fixture)


def test_manual_context_required_and_row_fields_complete_unique():
    fixture = sample()
    for mutate in [
        lambda f: f.update(context=None),
        lambda f: f["review"]["rows"].append(copy.deepcopy(f["review"]["rows"][0])),
        lambda f: f["review"]["rows"][0]["fields"].pop("dose"),
    ]:
        changed = copy.deepcopy(fixture)
        mutate(changed)
        with pytest.raises(ValueError):
            run(changed)


@pytest.mark.parametrize(
    "raw",
    [
        b'{"a":1,"a":2}',
        b'{"__proto__":{}}',
        b'{"constructor":1}',
        b'{"x":1e999}',
        b'{"x":NaN}',
        b"\xff",
        b"[] trailing",
        b"[" * 40 + b"0" + b"]" * 40,
    ],
)
def test_untrusted_json_input_rejected(raw):
    with pytest.raises(ValueError):
        read_json(raw)


def test_size_and_history_budgets():
    with pytest.raises(ValueError):
        read_json(b" " * (JSON_LIMIT + 1))
    fixture = sample()
    f = field(fixture)
    for _ in range(40):
        revise(f, decision="confirmed")
    with pytest.raises(ValueError):
        ReviewPacket.model_validate(fixture["review"])


def test_markdown_escapes_user_reason_and_does_not_claim_resolved_or_ai_approved():
    fixture = sample()
    field(fixture)["history"][0]["reason"] = "<script> [click](https://example.test)"
    text = markdown(run(fixture))
    assert "<script>" not in text
    assert r"\[click\]" in text
    assert "해결 인증 아님" in text
    assert "AI 반론 미재실행" in text


def test_cli_writes_private_new_results_and_preserves_inputs(tmp_path):
    fixture = sample()
    paths = {}
    for key, raw in [
        ("review", encode(fixture["review"])),
        ("source-export", encode(fixture["source"])),
        ("pdf", fixture["pdf"]),
    ]:
        paths[key] = tmp_path / key
        paths[key].write_bytes(raw)
    original = {k: p.read_bytes() for k, p in paths.items()}
    args = [sys.executable, "-m", "trialboard.agent.revalidate"]
    for key, path in paths.items():
        args += [f"--{key}", str(path)]
    for key, value in fixture["context"].items():
        args += [f"--{key}", value]
    env = {
        **os.environ,
        "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
    }
    for _ in range(2):
        result = subprocess.run(
            args, cwd=tmp_path, env=env, capture_output=True, text=True, timeout=20
        )
        assert result.returncode == 0, result.stderr
        assert "model_calls=0" in result.stdout
    outputs = list((tmp_path / "output/revalidation").glob("*/report.json"))
    assert len(outputs) == 2
    assert all(p.stat().st_mode & 0o777 == 0o600 for p in outputs)
    assert all(p.parent.stat().st_mode & 0o777 == 0o700 for p in outputs)
    assert {k: p.read_bytes() for k, p in paths.items()} == original
    paths["review"].write_text('{"private-secret": NaN}')
    failed = subprocess.run(args, cwd=tmp_path, env=env, capture_output=True, text=True, timeout=20)
    assert failed.returncode == 2
    assert "private-secret" not in failed.stderr
    assert len(list((tmp_path / "output/revalidation").glob("*/report.json"))) == 2
