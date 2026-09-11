"""Bounded public inputs; the broader review contracts remain internal."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator
from pydantic_core import PydanticCustomError

from trialboard.review.example import DemoMode, example_scenarios
from trialboard.review.models import Contract, Design, ReviewReport, ReviewRequest, Scenario

MAX_BODY_BYTES = 32_768
MAX_SCENARIOS = 5
MAX_REPETITIONS = 100_000
MAX_WORK_UNITS = 1_000_000
MAX_CONCURRENT_RUNS = 2
ARMS = ("dose_a", "dose_b")

Rate = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
SampleSize = Annotated[int, Field(strict=True, ge=2, le=500)]


class ScenarioInput(Contract):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    label: str = Field(min_length=1, max_length=120)
    response: tuple[Rate, Rate]
    adverse_event: tuple[Rate, Rate]
    adverse_event_penalty: float = Field(strict=True, ge=0, le=10)
    maximum_adverse_event_rate: Rate
    rationale: str = Field(min_length=1, max_length=500)

    def to_scenario(self) -> Scenario:
        return Scenario(**self.model_dump(), arms=ARMS)


def default_scenarios() -> tuple[ScenarioInput, ...]:
    return tuple(
        ScenarioInput(**s.model_dump(exclude={"arms", "provenance"})) for s in example_scenarios()
    )


class ExecutionInput(Contract):
    mode: DemoMode = "normal"
    scenarios: tuple[ScenarioInput, ...] = Field(
        default_factory=default_scenarios, min_length=1, max_length=MAX_SCENARIOS
    )
    per_arm: tuple[SampleSize, SampleSize] = (30, 60)
    seed: int = Field(default=42, strict=True, ge=0, le=2**32 - 1)
    repetitions: int = Field(default=10_000, strict=True, ge=100, le=MAX_REPETITIONS)

    @property
    def work_units(self) -> int:
        # One unit = one repetition × arm × scenario × design, not patient count.
        return self.repetitions * len(ARMS) * len(self.scenarios) * len(self.per_arm)

    @model_validator(mode="after")
    def bounded_comparison(self) -> ExecutionInput:
        if len({s.id for s in self.scenarios}) != len(self.scenarios):
            raise PydanticCustomError("duplicate_scenario_ids", "scenario IDs must be unique")
        if self.per_arm[0] >= self.per_arm[1]:
            raise PydanticCustomError(
                "sample_size_order", "per_arm requires two distinct sizes in ascending order"
            )
        if self.work_units > MAX_WORK_UNITS:
            raise PydanticCustomError("work_budget_exceeded", "calculation budget exceeded")
        return self

    def to_designs(self) -> tuple[Design, ...]:
        return tuple(
            Design(id=id_, label=f"각 군 {n}명 고정 비교 예제", per_arm=n)
            for id_, n in zip(("small", "larger"), self.per_arm, strict=True)
        )


class ExecutionOutput(Contract):
    execution_id: UUID
    started_at: datetime
    elapsed_ms: float
    execution_mode: Literal["LIVE_COMPUTE_SYNTHETIC"] = "LIVE_COMPUTE_SYNTHETIC"
    input: ExecutionInput
    evidence_input: ReviewRequest
    report: ReviewReport
    markdown: str
    # IDs identify responses, not persistent records or authenticated audit entries.
    persisted: Literal[False] = False
