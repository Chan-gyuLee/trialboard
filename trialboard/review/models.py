"""Strict contracts for the first executable review, independent of legacy claims.

Source-record checks establish consistency, not scientific truth or PDF entailment.
All examples in this milestone are explicitly synthetic.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from trialboard.serialization import sha256_json

Identifier = Annotated[str, Field(min_length=1, pattern=r"^[A-Za-z0-9_-]+$")]
Probability = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Metric = Literal["response", "adverse_event"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Context(Contract):
    asset: Identifier
    indication: str = Field(min_length=1)
    cohort: Identifier
    population: str = Field(min_length=1)
    window: str = Field(min_length=1)


class Observation(Contract):
    id: Identifier
    context: Context
    arm: Identifier
    metric: Metric
    events: int = Field(ge=0, strict=True)
    denominator: int = Field(gt=0, strict=True)
    unit: Literal["proportion"] = "proportion"

    @model_validator(mode="after")
    def valid_count(self) -> Observation:
        if self.events > self.denominator:
            raise ValueError("events cannot exceed denominator")
        return self


class EvidenceSource(Contract):
    id: Identifier
    title: str = Field(min_length=1)
    version: str = Field(min_length=1)
    kind: Literal["synthetic"] = "synthetic"
    records: tuple[Observation, ...]
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")

    def computed_digest(self) -> str:
        return sha256_json(self.model_dump(mode="json", exclude={"digest"}))

    @model_validator(mode="after")
    def unique_records(self) -> EvidenceSource:
        if len({r.id for r in self.records}) != len(self.records):
            raise ValueError("record IDs must be unique within a source")
        return self


class EvidenceClaim(Contract):
    id: Identifier
    source_id: Identifier
    source_version: str = Field(min_length=1)
    record_id: Identifier
    stated: Observation


class ReviewRequest(Contract):
    question: str = Field(min_length=1)
    context: Context
    arms: tuple[Identifier, ...] = Field(min_length=2, max_length=4)
    sources: tuple[EvidenceSource, ...]
    claims: tuple[EvidenceClaim, ...]

    @model_validator(mode="after")
    def unique_ids(self) -> ReviewRequest:
        for label, values in (
            ("arm", self.arms),
            ("source", tuple(s.id for s in self.sources)),
            ("claim", tuple(c.id for c in self.claims)),
        ):
            if len(set(values)) != len(values):
                raise ValueError(f"duplicate {label} IDs")
        return self


class Issue(Contract):
    code: str
    message: str
    claim_id: str | None = None
    affected_decision: str
    owner: str
    needed: str


class CheckedClaim(Contract):
    claim: EvidenceClaim
    locator: str
    status: Literal["synthetic_record_matched"] = "synthetic_record_matched"


class Scenario(Contract):
    id: Identifier
    label: str
    arms: tuple[Identifier, ...] = Field(min_length=2, max_length=4)
    response: tuple[Probability, ...]
    adverse_event: tuple[Probability, ...]
    adverse_event_penalty: float = Field(ge=0, le=10, allow_inf_nan=False)
    maximum_adverse_event_rate: Probability
    rationale: str = Field(min_length=1)
    provenance: Literal["synthetic_assumption"] = "synthetic_assumption"

    @model_validator(mode="after")
    def matching_arms(self) -> Scenario:
        if len(set(self.arms)) != len(self.arms):
            raise ValueError("scenario arms must be unique")
        if not len(self.arms) == len(self.response) == len(self.adverse_event):
            raise ValueError("one response and adverse-event probability is required per arm")
        return self


class Design(Contract):
    id: Identifier
    label: str
    per_arm: int = Field(ge=2, le=500, strict=True)


class SimulationResult(Contract):
    scenario: Scenario
    design: Design
    seed: int
    repetitions: int
    total_sample_size: int
    selection_probability: dict[str, float]
    no_selection_probability: float
    selects_true_utility_best_probability: float
    selects_true_unsafe_probability: float
    monte_carlo_se: dict[str, float]
    true_utility_best_arms: tuple[str, ...]
    assumptions: tuple[str, ...]


class ReviewReport(Contract):
    question: str
    context: Context
    status: Literal["DRAFT_FOR_REVIEW", "PARTIAL_ABSTENTION"]
    evidence_mode: Literal["SYNTHETIC_ONLY"] = "SYNTHETIC_ONLY"
    input_digest: str
    checked_claims: tuple[CheckedClaim, ...]
    issues: tuple[Issue, ...]
    simulations: tuple[SimulationResult, ...]
    runtime: dict[str, str]
    limitations: tuple[str, ...]
