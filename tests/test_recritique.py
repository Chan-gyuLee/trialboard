"""Frozen review -> one-shot critique contracts; fixtures are not real clinical PDFs."""

import asyncio
import copy
import json
import os
import subprocess
import sys

import pytest
from test_field_revalidation import encode, revise, sample

from trialboard.agent.engine import Limits
from trialboard.agent.example import ScriptedProvider
from trialboard.agent.provider import ModelError, Reply
from trialboard.agent.recritique import markdown, recritique, save_result
from trialboard.serialization import sha256_json


def execute(f=None, provider=None, limits=None):
    f = f or sample()
    return asyncio.run(
        recritique(
            encode(f["review"]),
            encode(f["source"]),
            f["pdf"],
            provider or ScriptedProvider(),
            agent_raw=f["agent"],
            context=f["context"],
            limits=limits,
        )
    )


class Answer(ScriptedProvider):
    def __init__(self, value=None, *, tokens=10):
        super().__init__()
        self.value = value if value is not None else {"concerns": [], "next_questions": []}
        self.tokens = tokens

    async def complete(self, **kwargs):
        self.requests.append(copy.deepcopy(kwargs))
        return Reply(self.value, "test-response", self.tokens, 2)


def concern(scope="observation_error", oid="obs-0", sid="p1-i0"):
    return {
        "scope": scope,
        "observation_ids": [oid],
        "span_ids": [sid],
        "reason": "Synthetic concern; not clinical evidence",
    }


def test_snapshot_preserved_single_critique_no_reextract_and_bound_to_full_review():
    f, p = sample(imported=True), Answer()
    original = copy.deepcopy(f)
    r = execute(f, p)
    assert f == original
    assert r["status"] == "COMPLETED"
    assert r["execution_mode"] == "SCRIPTED_TEST_DOUBLE"
    assert r["user_values_modified"] is False
    assert r["clinical_approval"] is False
    assert r["comparison_status"] == "NOT_APPROVED"
    assert len(r["remaining_draft_ids"]) == 4
    assert r["revalidation"]["review"] == f["review"]
    assert r["review_content_digest"] == sha256_json(f["review"])
    assert len(p.requests) == len(r["calls"]) == 1
    request = p.requests[0]
    assert request["schema"]["title"] == "Critique"
    assert "Do not edit or re-extract values" in request["instructions"]
    assert set(request["payload"]) == {"source", "extraction", "deterministic_findings"}
    assert r["request_digest"] == sha256_json(request["payload"])
    assert r["revalidation"]["previous_model_review"] is not None
    assert "previous_model_review" not in json.dumps(request["payload"])


def test_corrected_model_error_sent_as_current_value_and_original_kept_locally():
    f, p = sample(imported=True, scenario="persistent"), Answer()
    field = f["review"]["rows"][1]["fields"]["denominator"]
    value = copy.deepcopy(field["current"])
    value["value"] = "20"
    revise(field, value)
    r = execute(f, p)
    assert (
        p.requests[0]["payload"]["extraction"]["observations"][1]["fields"]["denominator"]["value"]
        == "20"
    )
    assert (
        r["revalidation"]["review"]["rows"][1]["fields"]["denominator"]["original"]["value"]
        == "200"
    )
    assert (
        r["revalidation"]["previous_model_review"]["extraction"]["observations"][1]["fields"][
            "denominator"
        ]["value"]
        == "200"
    )


@pytest.mark.parametrize(
    "scope,remaining,withheld",
    [
        ("observation_error", 3, ["obs-0"]),
        ("comparison_limitation", 4, []),
    ],
)
def test_error_withholds_row_but_comparison_limitation_does_not(scope, remaining, withheld):
    r = execute(
        provider=Answer({"concerns": [concern(scope)], "next_questions": ["Check source?"]})
    )
    assert r["status"] == "COMPLETED"
    assert len(r["remaining_draft_ids"]) == remaining
    assert r["withheld_by_model_ids"] == withheld
    assert len(r["revalidation"]["accepted"]) == 4
    assert r["comparison_status"] == "NOT_APPROVED"


def test_user_held_rows_never_reintroduced_by_critique():
    f, p = sample(), Answer()
    revise(f["review"]["rows"][0]["fields"]["reported_rate"], decision="held")
    r = execute(f, p)
    assert len(r["candidate_ids"]) == 3
    assert "obs-0" not in r["remaining_draft_ids"]
    assert all(o["id"] != "obs-0" for o in p.requests[0]["payload"]["extraction"]["observations"])
    invalid = execute(f, Answer({"concerns": [concern()], "next_questions": []}))
    assert invalid["status"] == "FAILED"
    assert invalid["errors"] == ["INVALID_CRITIQUE_REFERENCE"]


def test_no_candidates_does_not_spend_usage():
    f, p = sample(), Answer()
    for row in f["review"]["rows"]:
        revise(row["fields"]["dose"], decision="held")
    r = execute(f, p)
    assert r["status"] == "NO_CANDIDATES"
    assert r["critique"] is None
    assert not p.requests and not r["calls"] and not r["remaining_draft_ids"]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda f: f.update(pdf=b"%PDF-WRONG"),
        lambda f: f["review"].update(clinicalApproval=True),
        lambda f: f["review"]["rows"][0]["fields"]["dose"].update(decision="held"),
        lambda f: f["review"]["rows"][0]["fields"]["dose"]["current"].update(value="wrong"),
        lambda f: f.update(agent=b"{}", context=None),
    ],
)
def test_bad_input_rejected_before_provider(mutation):
    f, p = sample(), Answer()
    mutation(f)
    with pytest.raises(ValueError):
        execute(f, p)
    assert not p.requests


@pytest.mark.parametrize(
    "value,code",
    [
        (
            {"concerns": [], "next_questions": [], "replacement_values": {}},
            "INVALID_CRITIQUE_SCHEMA",
        ),
        ({"concerns": [], "next_questions": [], "approved": True}, "INVALID_CRITIQUE_SCHEMA"),
        (
            {"concerns": [concern(oid="missing")], "next_questions": []},
            "INVALID_CRITIQUE_REFERENCE",
        ),
        (
            {"concerns": [concern(sid="missing")], "next_questions": []},
            "INVALID_CRITIQUE_REFERENCE",
        ),
        (
            {"concerns": [concern(scope="approved")], "next_questions": []},
            "INVALID_CRITIQUE_SCHEMA",
        ),
        ({"concerns": [], "next_questions": ["x"] * 9}, "INVALID_CRITIQUE_SCHEMA"),
    ],
)
def test_invalid_model_output_never_becomes_completed(value, code):
    r = execute(provider=Answer(value))
    assert r["status"] == "FAILED" and r["errors"] == [code]
    assert r["critique"] is None and not r["remaining_draft_ids"]
    assert len(r["calls"]) == 1


def test_same_value_new_confirmation_invalidates_review_identity():
    f = sample()
    before = execute(f)
    revise(f["review"]["rows"][0]["fields"]["dose"], decision="confirmed")
    after = execute(f)
    assert before["review_content_digest"] != after["review_content_digest"]
    assert before["request_digest"] == after["request_digest"]


def test_budget_failure_before_and_after_call_is_not_success():
    p = Answer()
    r = execute(provider=p, limits=Limits(max_calls=1, max_repairs=0, max_total_tokens=1000))
    assert r["status"] == "BUDGET_EXCEEDED" and not p.requests
    r = execute(provider=Answer(tokens=210000))
    assert r["status"] == "BUDGET_EXCEEDED" and len(r["calls"]) == 1
    assert r["calls"][0]["input_tokens"] == 210000
    assert r["critique"] is None and not r["remaining_draft_ids"]


@pytest.mark.parametrize("tokens", [-1, True, None])
def test_invalid_usage_fails_closed(tokens):
    r = execute(provider=Answer(tokens=tokens))
    assert r["status"] == "FAILED"
    assert r["calls"][0]["input_tokens"] is None


def test_transport_error_is_sanitized_no_fallback():
    class Failing(Answer):
        async def complete(self, **kwargs):
            raise ModelError("SECRET_UNTRUSTED_ERROR")

    r = execute(provider=Failing())
    assert r["errors"] == ["MODEL_REQUEST_FAILED"]
    assert "SECRET" not in json.dumps(r)
    assert len(r["calls"]) == 1 and r["critique"] is None


def test_timeout_cancels_provider_and_no_completed_result():
    class Slow(Answer):
        cancelled = False

        async def complete(self, **kwargs):
            try:
                await asyncio.sleep(10)
            finally:
                self.cancelled = True

    p = Slow()
    r = execute(provider=p, limits=Limits(max_calls=1, max_repairs=0, seconds=0.01))
    assert p.cancelled and r["errors"] == ["RECRITIQUE_TIMEOUT"]
    assert r["status"] == "FAILED" and not r["remaining_draft_ids"]


def test_external_cancellation_propagates():
    f = sample()

    async def scenario():
        started = asyncio.Event()

        class Waiting(Answer):
            async def complete(self, **kwargs):
                started.set()
                await asyncio.Future()

        task = asyncio.create_task(
            recritique(
                encode(f["review"]), encode(f["source"]), f["pdf"], Waiting(), context=f["context"]
            )
        )
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())


def test_only_single_call_codex_or_scripted_mode_enabled():
    with pytest.raises(ValueError):
        execute(limits=Limits())
    p = Answer()
    p.mode = "OPENAI_RESPONSES"
    with pytest.raises(ValueError):
        execute(provider=p)
    assert not p.requests


def test_private_nonoverwriting_artifacts_and_escaped_text(tmp_path):
    c = concern()
    c["reason"] = "<script>alert(1)</script>"
    r = execute(provider=Answer({"concerns": [c], "next_questions": []}))
    root = save_result(r, tmp_path)
    assert json.loads((root / "report.json").read_text()) == r
    assert "<script>" not in (root / "report.md").read_text()
    assert "실제 LLM을 호출하지 않았습니다" in markdown(r)
    if os.name == "posix":
        assert root.stat().st_mode & 0o777 == 0o700
        assert (root / "report.json").stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        save_result(r, tmp_path)


def test_cli_opt_in_and_scripted_output(tmp_path):
    f = sample()
    for name, data in [
        ("review.json", encode(f["review"])),
        ("source.json", encode(f["source"])),
        ("source.pdf", f["pdf"]),
    ]:
        (tmp_path / name).write_bytes(data)
    args = [
        sys.executable,
        "-m",
        "trialboard.agent.recritique",
        "--review",
        str(tmp_path / "review.json"),
        "--source-export",
        str(tmp_path / "source.json"),
        "--pdf",
        str(tmp_path / "source.pdf"),
    ]
    for k, v in f["context"].items():
        args += [f"--{k}", v]
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    no_opt_in = subprocess.run(args, cwd=tmp_path, capture_output=True, timeout=10)
    assert no_opt_in.returncode == 2
    run = subprocess.run([*args, "--scripted-test"], cwd=tmp_path, capture_output=True, timeout=10)
    assert run.returncode == 0, run.stderr
    assert b"SCRIPTED_TEST_DOUBLE" in run.stdout
    assert len(list((tmp_path / "output/recritique").glob("*/report.json"))) == 1
    assert all((tmp_path / name).read_bytes() == raw for name, raw in before.items())
