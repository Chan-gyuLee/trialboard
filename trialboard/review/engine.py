"""Evidence gates and a deliberately limited, fixed-sample simulation baseline."""

from __future__ import annotations

import hashlib
import platform

import numpy as np

from trialboard.review.models import (
    CheckedClaim,
    Design,
    Issue,
    ReviewReport,
    ReviewRequest,
    Scenario,
    SimulationResult,
)
from trialboard.serialization import sha256_json


def structurally_valid_claims(request: ReviewRequest) -> tuple[list[CheckedClaim], list[Issue]]:
    """Per-claim structural gate only: source/version/record/context/arm/value match.

    Shared by check_evidence() and review/conflict_classifier.py so both ever
    look at the same notion of "a claim that passed the basic record checks" —
    conflict detection and its optional AI annotation never disagree on that.
    """
    sources = {s.id: s for s in request.sources}
    checked: list[CheckedClaim] = []
    issues: list[Issue] = []
    for claim in request.claims:
        source = sources.get(claim.source_id)
        record = (
            next((r for r in source.records if r.id == claim.record_id), None) if source else None
        )
        code = None
        message = ""
        if source is None:
            code, message = "SOURCE_MISSING", "참조한 자료가 없습니다."
        elif source.digest != source.computed_digest():
            code, message = "SOURCE_HASH_MISMATCH", "자료 내용이 기록된 hash와 다릅니다."
        elif claim.source_version != source.version:
            code, message = "SOURCE_VERSION_MISMATCH", "주장이 지정한 자료 버전과 다릅니다."
        elif record is None:
            code, message = "RECORD_MISSING", "지정한 원문 레코드가 없습니다."
        elif record.context != request.context:
            code, message = "CONTEXT_MISMATCH", "약물·적응증·코호트·분석집단·관찰기간이 다릅니다."
        elif record.arm not in request.arms:
            code, message = "ARM_MISMATCH", "검토 대상에 없는 용량군입니다."
        elif claim.stated != record:
            code, message = "RECORD_VALUE_MISMATCH", "주장의 값·분모 또는 문맥이 자료와 다릅니다."
        if code:
            issues.append(
                Issue(
                    code=code,
                    message=message,
                    claim_id=claim.id,
                    affected_decision="해당 근거를 이용한 용량군 비교",
                    owner="자료 검토 담당자",
                    needed="지정된 자료 버전과 레코드를 대조하고 수정된 주장으로 재실행",
                )
            )
        else:
            checked.append(
                CheckedClaim(
                    claim=claim,
                    locator=f"{claim.source_id}@{claim.source_version}#record={claim.record_id}",
                )
            )
    return checked, issues


def conflicting_groups(
    checked: list[CheckedClaim], arms: tuple[str, ...]
) -> list[tuple[str, str, list[CheckedClaim]]]:
    """(arm, metric, claims) triples where structurally valid claims still disagree."""
    groups = []
    for arm in arms:
        for metric in ("response", "adverse_event"):
            group = [
                c for c in checked if c.claim.stated.arm == arm and c.claim.stated.metric == metric
            ]
            values = {(c.claim.stated.events, c.claim.stated.denominator) for c in group}
            if len(values) > 1:
                groups.append((arm, metric, group))
    return groups


def check_evidence(request: ReviewRequest) -> tuple[list[CheckedClaim], list[Issue]]:
    checked, issues = structurally_valid_claims(request)

    # Distinct sources may disagree. Do not silently average them or choose the first.
    conflicted = set()
    for arm, metric, group in conflicting_groups(checked, request.arms):
        conflicted.update(c.claim.id for c in group)
        issues.append(
            Issue(
                code="CONFLICTING_RECORDS",
                message=f"{arm}의 {metric} 수치가 상충합니다.",
                affected_decision="상충한 수치를 근거로 한 용량군 비교",
                owner="임상·자료 검토 담당자",
                needed="분석집단·자료 기준일·평가 정의를 대조하여 차이를 해소",
            )
        )
    checked = [c for c in checked if c.claim.id not in conflicted]
    covered = {(c.claim.stated.arm, c.claim.stated.metric) for c in checked}
    for arm in request.arms:
        for metric in ("response", "adverse_event"):
            if (arm, metric) not in covered:
                issues.append(
                    Issue(
                        code="EVIDENCE_GAP",
                        message=f"{arm}의 {metric} 비교 근거가 부족합니다.",
                        affected_decision="현재 자료에 근거한 용량 선택",
                        owner="임상개발·안전성 담당자",
                        needed=f"{arm}: 같은 분석집단·관찰기간의 {metric} 사건 수와 분모 확인",
                    )
                )
    return checked, issues


def simulate(
    scenario: Scenario,
    design: Design,
    *,
    seed: int = 42,
    repetitions: int = 10000,
) -> SimulationResult:
    """Compare fixed-size equal-allocation designs under declared synthetic truth.

    NOT DROID/MERIT, a powered confirmatory test, or a clinical dose recommendation.
    Select greatest observed utility among arms below an observed AE-rate threshold.
    Break exact utility ties uniformly; select no arm if all fail the threshold.
    """
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise ValueError("seed must be a nonnegative integer")
    if not isinstance(repetitions, int) or isinstance(repetitions, bool):
        raise ValueError("repetitions must be an integer")
    if not 1 <= repetitions <= 100000:
        raise ValueError("repetitions must be in [1, 100000]")
    # A local stream per full input makes outputs independent of execution order.
    key = sha256_json(
        {
            "scenario": scenario.model_dump(mode="json"),
            "design": design.model_dump(mode="json"),
            "seed": seed,
        }
    )
    local_seed = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big")
    rng = np.random.Generator(np.random.PCG64(local_seed))
    shape = (repetitions, len(scenario.arms))
    response = rng.binomial(design.per_arm, scenario.response, size=shape) / design.per_arm
    adverse_event = (
        rng.binomial(design.per_arm, scenario.adverse_event, size=shape) / design.per_arm
    )
    eligible = adverse_event <= scenario.maximum_adverse_event_rate
    utility = response - scenario.adverse_event_penalty * adverse_event
    utility = np.where(eligible, utility, -np.inf)
    has_selection = eligible.any(axis=1)
    maxima = utility.max(axis=1, keepdims=True)
    tied = np.isclose(utility, maxima, rtol=0, atol=1e-12) & eligible
    # Independent uniform ranks give equal tie probabilities without favouring arm order.
    chosen = np.where(tied, rng.random(shape), -1).argmax(axis=1)
    chosen = np.where(has_selection, chosen, -1)
    truth_eligible = np.array(scenario.adverse_event) <= scenario.maximum_adverse_event_rate
    truth_utility = np.array(scenario.response) - (
        scenario.adverse_event_penalty * np.array(scenario.adverse_event)
    )
    if truth_eligible.any():
        best_value = truth_utility[truth_eligible].max()
        best = np.flatnonzero(
            truth_eligible
            & np.isclose(
                truth_utility,
                best_value,
                rtol=0,
                atol=1e-12,
            )
        )
        correct = np.isin(chosen, best)
    else:
        best = np.array([], dtype=int)
        correct = chosen == -1
    unsafe = np.isin(chosen, np.flatnonzero(~truth_eligible))
    probs = {arm: float(np.mean(chosen == i)) for i, arm in enumerate(scenario.arms)}
    no_selection = float(np.mean(chosen == -1))
    best_probability, unsafe_probability = float(correct.mean()), float(unsafe.mean())
    rates = {
        **probs,
        "no_selection": no_selection,
        "true_utility_best": best_probability,
        "true_unsafe": unsafe_probability,
    }
    return SimulationResult(
        scenario=scenario,
        design=design,
        seed=seed,
        repetitions=repetitions,
        total_sample_size=design.per_arm * len(scenario.arms),
        selection_probability=probs,
        no_selection_probability=no_selection,
        selects_true_utility_best_probability=best_probability,
        selects_true_unsafe_probability=unsafe_probability,
        monte_carlo_se={k: float(np.sqrt(p * (1 - p) / repetitions)) for k, p in rates.items()},
        true_utility_best_arms=tuple(scenario.arms[i] for i in best),
        assumptions=(
            "합성 모수이며 실제 약물의 추정치가 아님",
            "각 군 동일 표본수, 독립 환자, 고정 관찰기간, 결측·탈락·중간중단 없음",
            "반응과 이상반응은 독립 Bernoulli 결과로 가정",
            "utility = 반응률 - 가정한 가중치 × 이상반응률; 임상적으로 검증된 함수가 아님",
            "관측 이상반응률 한계 이하의 군 중 utility 최대 군 선택; 동률은 균등 추첨",
            "모든 군이 관측 한계를 넘으면 선택 보류; 실제 한계 초과 군의 오선택률 별도 보고",
            "군 간 우월성·비열등성 검정이나 허가 확률 계산이 아님",
        ),
    )


def run_review(
    request: ReviewRequest,
    scenarios: tuple[Scenario, ...],
    designs: tuple[Design, ...],
    *,
    seed: int = 42,
    repetitions: int = 10000,
) -> ReviewReport:
    for name, items in (("scenario", scenarios), ("design", designs)):
        if len({x.id for x in items}) != len(items):
            raise ValueError(f"duplicate {name} IDs")
    if not scenarios or len(designs) < 2:
        raise ValueError("at least one scenario and two candidate designs are required")
    if any(s.arms != request.arms for s in scenarios):
        raise ValueError("scenario arms and ordering must match the review request")
    checked, issues = check_evidence(request)
    # Synthetic scenario exploration is intentionally separate from evidence selection.
    # Evidence errors must not be filled using hypothetical probabilities.
    results = tuple(
        simulate(s, d, seed=seed, repetitions=repetitions) for s in scenarios for d in designs
    )
    return ReviewReport(
        question=request.question,
        context=request.context,
        status="PARTIAL_ABSTENTION" if issues else "DRAFT_FOR_REVIEW",
        input_digest=sha256_json(
            {
                "request": request.model_dump(mode="json"),
                "scenarios": [s.model_dump(mode="json") for s in scenarios],
                "designs": [d.model_dump(mode="json") for d in designs],
                "seed": seed,
                "repetitions": repetitions,
            }
        ),
        checked_claims=tuple(checked),
        issues=tuple(issues),
        simulations=results,
        runtime={
            "engine": "review-prototype/0.1",
            "python": platform.python_version(),
            "numpy": np.__version__,
            "rng": "PCG64",
        },
        limitations=(
            "전체 사례와 수치는 합성 데이터. 실제 sotorasib 또는 기업 임상자료가 아님",
            "구조화 레코드 대조만 구현. PDF 문맥 검증·외부 검색·LLM 에이전트는 미연결",
            "두 설계는 입력으로 지정한 고정 표본수 비교이며 자동 생성 또는 권장 설계가 아님",
            "합성 시뮬레이션은 근거 결측을 해소하지 않으며 현실의 용량 선택을 허용하지 않음",
            "장기 내약성·PK/PD·노출–반응·모집 가능성은 별도 검토 필요",
            "전문가 검증과 임상적 성능 평가 전의 연구용 프로토타입",
        ),
    )
