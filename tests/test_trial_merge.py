"""Same-trial merge judgment: fail-closed on unverified quotes, additive only."""

import asyncio

from trialboard.agent.provider import Reply
from trialboard.research.trial_merge import (
    SourceSameTrialInput,
    judge_same_trial,
    merge_grouping,
)


class FakeProvider:
    mode = "SCRIPTED_TEST_DOUBLE"
    model = "trial-merge-test"

    def __init__(self, value):
        self.value = value
        self.calls = []

    async def complete(self, **kwargs):
        self.calls.append(kwargs)
        return Reply(self.value, "test", 10, 20)


def run(nct, candidates, provider):
    return asyncio.run(judge_same_trial(nct, candidates, provider))


SOURCE_A = SourceSameTrialInput(
    source_id="src-a",
    title="Efficacy results from NCT12345678 in advanced disease",
    text="This report describes results from trial NCT12345678, phase 2 cohort A.",
)
SOURCE_B = SourceSameTrialInput(
    source_id="src-b",
    title="A related phase 1 dose escalation study",
    text="Patients received escalating doses in a separate first-in-human study.",
)


def test_no_provider_returns_empty():
    assert run("NCT12345678", [SOURCE_A], None) == []


def test_no_candidates_never_calls_model():
    provider = FakeProvider({"judgments": []})
    assert run("NCT12345678", [], provider) == []
    assert not provider.calls


def test_unsupported_provider_mode_returns_empty():
    class Unsupported(FakeProvider):
        mode = "SOME_OTHER_MODE"

    assert run("NCT12345678", [SOURCE_A], Unsupported({"judgments": []})) == []


def test_same_trial_verdict_with_verified_quote_passes_through():
    provider = FakeProvider(
        {
            "judgments": [
                {
                    "source_id": "src-a",
                    "verdict": "SAME_TRIAL",
                    "rationale": "제목과 본문에 선택한 NCT 번호가 그대로 등장합니다.",
                    "evidence_quote": "NCT12345678",
                }
            ]
        }
    )
    verdicts = run("NCT12345678", [SOURCE_A], provider)
    assert len(verdicts) == 1
    assert verdicts[0].verdict == "SAME_TRIAL"


def test_same_trial_verdict_with_fabricated_quote_is_dropped():
    provider = FakeProvider(
        {
            "judgments": [
                {
                    "source_id": "src-b",
                    "verdict": "SAME_TRIAL",
                    "rationale": "근거 날조",
                    "evidence_quote": "NCT12345678 explicitly stated",
                }
            ]
        }
    )
    assert run("NCT12345678", [SOURCE_B], provider) == []


def test_same_trial_verdict_without_quote_is_dropped():
    provider = FakeProvider(
        {
            "judgments": [
                {
                    "source_id": "src-a",
                    "verdict": "SAME_TRIAL",
                    "rationale": "인용 없이 주장",
                    "evidence_quote": None,
                }
            ]
        }
    )
    assert run("NCT12345678", [SOURCE_A], provider) == []


def test_different_trial_and_uncertain_do_not_require_a_quote():
    provider = FakeProvider(
        {
            "judgments": [
                {
                    "source_id": "src-b",
                    "verdict": "DIFFERENT_TRIAL",
                    "rationale": "다른 1상 시험을 설명합니다.",
                    "evidence_quote": None,
                },
            ]
        }
    )
    verdicts = run("NCT12345678", [SOURCE_B], provider)
    assert verdicts[0].verdict == "DIFFERENT_TRIAL"


def test_verdict_for_unknown_source_id_is_dropped():
    provider = FakeProvider(
        {
            "judgments": [
                {
                    "source_id": "src-unknown",
                    "verdict": "SAME_TRIAL",
                    "rationale": "x",
                    "evidence_quote": "x",
                }
            ]
        }
    )
    assert run("NCT12345678", [SOURCE_A], provider) == []


def test_model_exception_degrades_to_empty_list():
    class Failing(FakeProvider):
        async def complete(self, **kwargs):
            self.calls.append(kwargs)
            raise RuntimeError("MODEL_HTTP_ERROR")

    assert run("NCT12345678", [SOURCE_A], Failing({})) == []


def test_merge_grouping_separates_merge_review_and_exclude():
    provider = FakeProvider(
        {
            "judgments": [
                {
                    "source_id": "src-a",
                    "verdict": "SAME_TRIAL",
                    "rationale": "일치",
                    "evidence_quote": "NCT12345678",
                },
                {
                    "source_id": "src-b",
                    "verdict": "UNCERTAIN",
                    "rationale": "불명확",
                    "evidence_quote": None,
                },
            ]
        }
    )
    verdicts = run("NCT12345678", [SOURCE_A, SOURCE_B], provider)
    grouping = merge_grouping("NCT12345678", verdicts)
    assert grouping == {
        "nct": "NCT12345678",
        "merged_source_ids": ["src-a"],
        "needs_review_source_ids": ["src-b"],
        "excluded_source_ids": [],
    }
