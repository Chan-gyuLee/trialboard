"""AI second opinion on KOL question priority: additive, never replaces the rule-based order."""

import asyncio

import pytest

from trialboard.agent.kol_priority import suggest_kol_priority
from trialboard.agent.provider import Reply

QUESTIONS = [
    {
        "id": "gap-1",
        "category": "evidence_gap",
        "priority": "BEFORE_COMPARISON",
        "question": "필수 원문 관측값이 보류되어 비교에 사용할 수 없습니다.",
        "urgency_score": 400,
        "urgency_reasons": ["비교 계산 전 해결해야 하는 근거 차단 항목입니다."],
    },
    {
        "id": "dose_schedule",
        "category": "dose_schedule",
        "priority": "BEFORE_PROTOCOL",
        "question": "각 후보 용량의 실제 투여량·빈도·감량/중단 규칙을 어떻게 정의할 것인가?",
        "urgency_score": 100,
        "urgency_reasons": ["프로토콜 확정 전에 투여·감량·중단 규칙을 확인할 의제입니다."],
    },
]


class FakeProvider:
    mode = "SCRIPTED_TEST_DOUBLE"
    model = "kol-priority-test"

    def __init__(self, value):
        self.value = value
        self.calls = []

    async def complete(self, **kwargs):
        self.calls.append(kwargs)
        return Reply(self.value, "test", 10, 20)


def run(questions, provider):
    return asyncio.run(suggest_kol_priority(questions, provider))


def test_no_provider_returns_empty():
    assert run(QUESTIONS, None) == []


def test_no_questions_never_calls_model():
    provider = FakeProvider({"priorities": []})
    assert run([], provider) == []
    assert not provider.calls


def test_unsupported_provider_mode_returns_empty():
    class Unsupported(FakeProvider):
        mode = "SOME_OTHER_MODE"

    assert run(QUESTIONS, Unsupported({"priorities": []})) == []


def test_valid_priorities_pass_through_sorted_by_rank():
    provider = FakeProvider(
        {
            "priorities": [
                {
                    "question_id": "dose_schedule",
                    "ai_rank": 1,
                    "rationale": "용량 일정이 다른 모든 결정의 전제입니다.",
                },
                {
                    "question_id": "gap-1",
                    "ai_rank": 2,
                    "rationale": "근거 보류는 규칙상 최우선이지만 자료 요청은 이미 진행 중입니다.",
                },
            ]
        }
    )
    result = run(QUESTIONS, provider)
    assert [p.question_id for p in result] == ["dose_schedule", "gap-1"]
    assert len(provider.calls) == 1


def test_unknown_question_id_is_dropped():
    provider = FakeProvider(
        {
            "priorities": [
                {"question_id": "nonexistent", "ai_rank": 1, "rationale": "x"},
                {"question_id": "gap-1", "ai_rank": 2, "rationale": "실제 근거"},
            ]
        }
    )
    result = run(QUESTIONS, provider)
    assert [p.question_id for p in result] == ["gap-1"]


def test_duplicate_question_id_keeps_only_first_occurrence():
    provider = FakeProvider(
        {
            "priorities": [
                {"question_id": "gap-1", "ai_rank": 1, "rationale": "first"},
                {"question_id": "gap-1", "ai_rank": 2, "rationale": "duplicate"},
            ]
        }
    )
    result = run(QUESTIONS, provider)
    assert len(result) == 1
    assert result[0].rationale == "first"


def test_model_exception_degrades_to_empty_list():
    class Failing(FakeProvider):
        async def complete(self, **kwargs):
            self.calls.append(kwargs)
            raise RuntimeError("MODEL_HTTP_ERROR")

    assert run(QUESTIONS, Failing({})) == []


def test_malformed_output_degrades_to_empty_list():
    provider = FakeProvider({"priorities": [{"question_id": "gap-1"}]})
    assert run(QUESTIONS, provider) == []


@pytest.mark.parametrize("bad_rank", [0, 21])
def test_out_of_range_rank_is_rejected_whole_response(bad_rank):
    provider = FakeProvider(
        {"priorities": [{"question_id": "gap-1", "ai_rank": bad_rank, "rationale": "x"}]}
    )
    assert run(QUESTIONS, provider) == []
