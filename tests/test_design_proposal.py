"""Synthetic contract tests, not clinical validation or real model quality evidence."""

import asyncio
import copy

import pytest
from test_design_compare import brief_for
from test_design_compare import run as compare
from test_field_revalidation import encode, revise, sample

from trialboard.agent.design_compare import DesignBrief, proposal_review_digest
from trialboard.agent.design_proposal import ProposalConstraints, propose_design
from trialboard.agent.provider import ModelError, Reply


class Proposer:
    mode = "SCRIPTED_TEST_DOUBLE"
    model = "proposal-contract-test"

    def __init__(self, mutation=None):
        self.calls = []
        b = brief_for(sample())
        self.value = dict(
            status="PROPOSED",
            summary="합성 자료의 표본수와 민감도 비교 초안",
            plans=b["plans"],
            scenarios=[],
            questions=["가정 범위를 전문가와 확인할까요?"],
        )
        for s in b["scenarios"]:
            self.value["scenarios"].append(
                {k: v for k, v in s.items() if k != "provenance"}
                | {"evidence_ids": ["obs-0", "obs-1", "obs-2", "obs-3"]}
            )
        if mutation:
            mutation(self.value)

    async def complete(self, **kwargs):
        self.calls.append(kwargs)
        return Reply(copy.deepcopy(self.value), "test", 10, 20)


def propose(f=None, provider=None):
    f = f or sample()
    return asyncio.run(
        propose_design(
            encode(f["review"]),
            encode(f["source"]),
            f["pdf"],
            provider or Proposer(),
            constraints=ProposalConstraints(objective="표본수 비교", max_per_arm=80),
            agent_raw=f["agent"],
            context=f["context"],
        )
    )


def acknowledge(brief):
    b = copy.deepcopy(brief)
    digest = proposal_review_digest(DesignBrief.model_validate(b))
    for s in b["scenarios"]:
        s["provenance"]["reviewed_input_digest"] = digest
    return b


def test_proposal_never_approves_itself_and_explicit_review_unlocks_local_calculation():
    p = Proposer()
    r = propose(provider=p)
    assert r["status"] == "AWAITING_REVIEW" and len(p.calls) == 1
    assert r["clinical_approval"] is r["user_approved"] is False
    assert r["brief"]["scenarios"][0]["provenance"]["reviewed_input_digest"] is None
    assert compare(brief=r["brief"])["simulations"] == []
    approved = acknowledge(r["brief"])
    result = compare(brief=approved)
    assert len(result["simulations"]) == 4 and result["clinical_approval"] is False
    assert result["brief"]["scenarios"][0]["provenance"]["kind"] == "ai_proposed_hypothetical"


@pytest.mark.parametrize(
    "change",
    [
        lambda b: b["plans"][0].update(per_arm=31),
        lambda b: b["scenarios"][0]["response"].__setitem__(0, 0.5),
        lambda b: b.update(seed=43),
        lambda b: b["scenarios"][0]["provenance"].update(evidence_ids=["obs-0"]),
    ],
)
def test_input_edits_invalidate_acknowledgement(change):
    b = acknowledge(propose()["brief"])
    change(b)
    r = compare(brief=b)
    assert not r["simulations"]
    assert any(x["code"] == "AI_PROPOSAL_REVIEW_REQUIRED" for x in r["blockers"])


def test_held_evidence_abstains_without_model_call():
    f, p = sample(), Proposer()
    revise(f["review"]["rows"][0]["fields"]["events"], decision="held")
    r = propose(f, p)
    assert r["status"] == "NEEDS_EVIDENCE" and not p.calls and r["brief"] is None


@pytest.mark.parametrize(
    "mutation",
    [
        lambda v: v["plans"][0].update(per_arm=100),
        lambda v: v["plans"][0].update(per_arm=60),
        lambda v: v["scenarios"][0].update(evidence_ids=["invented"]),
        lambda v: v["scenarios"][0].update(response=[0.2]),
        lambda v: v.update(clinical_approval=True),
    ],
)
def test_invalid_proposals_are_never_adopted_or_retried(mutation):
    p = Proposer(mutation)
    r = propose(provider=p)
    assert r["status"] == "FAILED" and r["brief"] is None and len(p.calls) == 1


def test_model_can_abstain():
    p = Proposer(lambda v: v.update(status="NEEDS_EVIDENCE", plans=[], scenarios=[]))
    r = propose(provider=p)
    assert r["status"] == "NEEDS_EVIDENCE" and r["brief"] is None


@pytest.mark.parametrize("exception", [ModelError("PRIVATE_DETAIL"), TimeoutError()])
def test_failure_is_bounded_and_sanitized(exception):
    class Failing(Proposer):
        async def complete(self, **kwargs):
            self.calls.append(kwargs)
            raise exception

    p = Failing()
    result = propose(provider=p)
    assert result["status"] == "FAILED" and result["brief"] is None
    assert len(p.calls) == 1 and "PRIVATE_DETAIL" not in str(result)


def test_cancellation_propagates_without_retry_or_approval():
    class Cancelled(Proposer):
        async def complete(self, **kwargs):
            self.calls.append(kwargs)
            raise asyncio.CancelledError()

    p = Cancelled()
    with pytest.raises(asyncio.CancelledError):
        propose(provider=p)
    assert len(p.calls) == 1
