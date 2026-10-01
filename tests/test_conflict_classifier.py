"""AI conflict-explanation hypothesis: additive, never changes what check_evidence excludes."""

import asyncio

import pytest

from trialboard.agent.provider import Reply
from trialboard.review.conflict_classifier import classify_conflicts
from trialboard.review.engine import check_evidence
from trialboard.review.example import make_example
from trialboard.review.models import EvidenceClaim, EvidenceSource
from trialboard.serialization import sha256_json


def conflicting_request():
    request = make_example()
    record = request.sources[0].records[0].model_copy(update={"events": 8})
    payload = {
        "id": "other_source",
        "title": "Interim CSR, earlier data cutoff",
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
    return request.model_copy(
        update={"sources": (*request.sources, source), "claims": (*request.claims, claim)}
    )


class FakeProvider:
    mode = "SCRIPTED_TEST_DOUBLE"
    model = "conflict-classifier-test"

    def __init__(self, value):
        self.value = value
        self.calls = []

    async def complete(self, **kwargs):
        self.calls.append(kwargs)
        return Reply(self.value, "test", 10, 20)


def run(request, provider):
    return asyncio.run(classify_conflicts(request, provider))


def test_no_provider_skips_classification_without_error():
    assert run(conflicting_request(), None) == []


def test_unsupported_provider_mode_skips_classification():
    class Unsupported(FakeProvider):
        mode = "SOME_OTHER_MODE"

    assert run(conflicting_request(), Unsupported({"classifications": []})) == []


def test_no_conflicts_never_calls_the_model():
    provider = FakeProvider({"classifications": []})
    assert run(make_example(), provider) == []
    assert not provider.calls


def test_valid_verdict_passes_through():
    _, issues = check_evidence(conflicting_request())
    assert "CONFLICTING_RECORDS" in {i.code for i in issues}
    provider = FakeProvider(
        {
            "classifications": [
                {
                    "group_key": "dose_a__response",
                    "verdict": "LIKELY_REASONABLE_DISCREPANCY",
                    "rationale": "한 출처는 중간분석, 다른 출처는 더 이른 자료 기준일입니다.",
                    "claim_ids": ["claim_dose_a_response", "other_claim"],
                }
            ]
        }
    )
    verdicts = run(conflicting_request(), provider)
    assert len(verdicts) == 1
    assert verdicts[0].verdict == "LIKELY_REASONABLE_DISCREPANCY"
    assert len(provider.calls) == 1


def test_classification_never_reincludes_the_conflicting_claims():
    request = conflicting_request()
    checked, issues = check_evidence(request)
    provider = FakeProvider(
        {
            "classifications": [
                {
                    "group_key": "dose_a__response",
                    "verdict": "LIKELY_REASONABLE_DISCREPANCY",
                    "rationale": "근거 자료 기준일 차이로 보입니다.",
                    "claim_ids": ["claim_dose_a_response", "other_claim"],
                }
            ]
        }
    )
    run(request, provider)
    # The classifier call does not re-run or mutate check_evidence's own result.
    assert "CONFLICTING_RECORDS" in {i.code for i in issues}
    assert not [c for c in checked if c.claim.stated.id == "dose_a_response"]


def test_verdict_citing_claim_outside_its_group_is_dropped():
    provider = FakeProvider(
        {
            "classifications": [
                {
                    "group_key": "dose_a__response",
                    "verdict": "LIKELY_TRUE_CONFLICT",
                    "rationale": "근거 불명확",
                    "claim_ids": ["claim_dose_b_adverse_event"],
                }
            ]
        }
    )
    assert run(conflicting_request(), provider) == []


def test_malformed_model_output_degrades_to_empty_list():
    provider = FakeProvider({"classifications": [{"group_key": "dose_a__response"}]})
    assert run(conflicting_request(), provider) == []


def test_model_exception_degrades_to_empty_list():
    class Failing(FakeProvider):
        async def complete(self, **kwargs):
            self.calls.append(kwargs)
            raise RuntimeError("MODEL_HTTP_ERROR")

    assert run(conflicting_request(), Failing({})) == []


def test_unknown_group_key_is_dropped():
    provider = FakeProvider(
        {
            "classifications": [
                {
                    "group_key": "dose_z__response",
                    "verdict": "UNCERTAIN",
                    "rationale": "존재하지 않는 그룹",
                    "claim_ids": ["claim_dose_a_response"],
                }
            ]
        }
    )
    assert run(conflicting_request(), provider) == []


@pytest.mark.parametrize(
    "verdict", ["LIKELY_REASONABLE_DISCREPANCY", "LIKELY_TRUE_CONFLICT", "UNCERTAIN"]
)
def test_all_verdict_values_accepted(verdict):
    provider = FakeProvider(
        {
            "classifications": [
                {
                    "group_key": "dose_a__response",
                    "verdict": verdict,
                    "rationale": "근거 검토",
                    "claim_ids": ["claim_dose_a_response"],
                }
            ]
        }
    )
    verdicts = run(conflicting_request(), provider)
    assert verdicts[0].verdict == verdict
