"""Synthetic development fixtures; never represent these as clinical evidence."""

from typing import Literal

from trialboard.review.models import (
    Context,
    Design,
    EvidenceClaim,
    EvidenceSource,
    Observation,
    ReviewRequest,
    Scenario,
)
from trialboard.serialization import sha256_json

DemoMode = Literal["normal", "denominator-error", "missing-evidence"]


def make_example(mode: DemoMode = "normal") -> ReviewRequest:
    if mode not in ("normal", "denominator-error", "missing-evidence"):
        raise ValueError(f"Unknown demo mode: {mode}")
    context = Context(
        asset="SYNTHETIC_ASSET",
        indication="합성 적응증",
        cohort="cohort_a",
        population="합성 전체 평가집단",
        window="합성 고정 관찰기간",
    )
    records = tuple(
        Observation(
            id=f"{arm}_{metric}",
            context=context,
            arm=arm,
            metric=metric,
            events=events,
            denominator=20,
        )
        for arm, metric, events in (
            ("dose_a", "response", 6),
            ("dose_a", "adverse_event", 2),
            ("dose_b", "response", 7),
            ("dose_b", "adverse_event", 5),
        )
    )
    if mode == "missing-evidence":
        records = tuple(r for r in records if r.id != "dose_b_adverse_event")
    payload = {
        "id": "synthetic_table",
        "title": "합성 초기 검토자료 — 실제 임상자료 아님",
        "version": "fixture-v1",
        "kind": "synthetic",
        "records": [r.model_dump(mode="json") for r in records],
    }
    source = EvidenceSource(**payload, digest=sha256_json(payload))
    claims = tuple(
        EvidenceClaim(
            id=f"claim_{r.id}",
            source_id=source.id,
            source_version=source.version,
            record_id=r.id,
            stated=r,
        )
        for r in records
    )
    if mode == "denominator-error":
        claims = tuple(
            c.model_copy(
                update={
                    "stated": c.stated.model_copy(
                        update={"denominator": 200},
                    )
                }
            )
            if c.stated.id == "dose_b_response"
            else c
            for c in claims
        )
    return ReviewRequest(
        question=(
            "우리 후보물질의 현재 자료로 다음 시험에서 어떤 용량들을 비교하고, "
            "최종 용량 선택을 위해 어떤 추가 자료가 필요한가?"
        ),
        context=context,
        arms=("dose_a", "dose_b"),
        sources=(source,),
        claims=claims,
    )


def example_scenarios() -> tuple[Scenario, ...]:
    return tuple(
        Scenario(
            id=id_,
            label=label,
            arms=("dose_a", "dose_b"),
            response=response,
            adverse_event=ae,
            adverse_event_penalty=0.7,
            maximum_adverse_event_rate=0.35,
            rationale="소프트웨어 동작 검증을 위해 지정한 합성 확률·가중치·한계값",
        )
        for id_, label, response, ae in (
            ("plateau", "효능 포화 가정", (0.30, 0.32), (0.12, 0.25)),
            ("higher_activity", "용량 B 효능 증가 가정", (0.25, 0.50), (0.12, 0.25)),
            ("both_unsafe", "두 군 모두 이상반응 한계 초과 가정", (0.30, 0.40), (0.55, 0.65)),
        )
    )


def example_designs() -> tuple[Design, ...]:
    return (
        Design(id="small", label="각 군 30명 고정 비교 예제", per_arm=30),
        Design(id="larger", label="각 군 60명 고정 비교 예제", per_arm=60),
    )
