"""Safe validation diagnostics; synthetic models only."""

import asyncio
import json

import pytest
from test_research import FakeModel, execute, setup  # noqa: F401

from trialboard.agent.provider import Reply
from trialboard.research.agent import research_failure_code


@pytest.mark.parametrize(
    "mode,code",
    [
        ("schema", "MODEL_SCHEMA_REJECTED"),
        ("source", "UNKNOWN_PRIORITY_SOURCE"),
        ("query", "INVALID_FOLLOWUP_TERMS"),
    ],
)
def test_rejected_plan_preserves_received_usage_without_claiming_validation(setup, mode, code):  # noqa: F811
    class Invalid(FakeModel):
        async def complete(self, **kwargs):
            r = await super().complete(**kwargs)
            value = dict(r.value)
            if mode == "schema":
                value["unexpected"] = "untrusted secret-like content"
            elif mode == "source":
                value["priorities"] = [{"source_id": "missing", "reason": "MOC"}]
            else:
                value["followup_terms"] = ["NCT00000002"]
            return Reply(value, "MOC-response", 11, 12)

    path, request, _ = setup
    run = asyncio.run(execute(path, request, Invalid()))
    assert run.status == "PARTIAL" and run.plan is None and run.review is None
    assert len(run.calls) == 1
    assert run.calls[0]["status"] == "RECEIVED"
    assert run.calls[0]["input_tokens"] == 11
    assert run.calls[0]["validation"] == "REJECTED"
    assert run.calls[0]["error_code"] == code
    assert "untrusted secret-like content" not in run.model_dump_json()


def test_successful_calls_and_failed_citation_have_separate_validation_states(setup):  # noqa: F811
    path, request, _ = setup
    run = asyncio.run(execute(path, request, FakeModel()))
    assert [c["validation"] for c in run.calls] == ["PASSED", "PASSED"]
    bad = asyncio.run(execute(path, request, FakeModel(bad=True)))
    assert [c["validation"] for c in bad.calls] == ["PASSED", "REJECTED"]
    assert bad.calls[-1]["error_code"] == "UNSUPPORTED_REVIEW_CITATION"


def test_unknown_exception_contents_never_enter_diagnostics():
    code = research_failure_code(RuntimeError("private-key-or-provider-body"))
    assert code == "MODEL_CALL_OR_RESPONSE_FAILED"
    assert "private" not in json.dumps(code)
