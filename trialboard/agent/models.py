"""Versioned source and model-output contracts; model claims never approve themselves."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Text = Annotated[str, Field(min_length=1, max_length=2000)]
Id = Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")]
Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)


class Span(Contract):
    id: Id
    source_digest: Digest
    page: int | None = Field(ge=1, le=10000)
    text: Text
    locator: str | None = None


class AgentInput(Contract):
    question: Text
    asset: Text
    indication: Text
    study: Text
    spans: list[Span] = Field(min_length=1, max_length=40)
    provenance: Literal["synthetic_fixture", "user_pdf_export_unverified", "curated_public_excerpt"]

    @model_validator(mode="after")
    def unique_and_bounded(self):
        if len({s.id for s in self.spans}) != len(self.spans):
            raise ValueError("duplicate span ID")
        if sum(len(s.text.encode("utf-8")) for s in self.spans) > 24000:
            raise ValueError("source text budget exceeded")
        return self


class CitedValue(Contract):
    # Every field is required in structured output. Missing knowledge is explicit null.
    value: Text | None
    span_id: Id | None
    quote: Text | None


class Fields(Contract):
    asset: CitedValue
    indication: CitedValue
    study: CitedValue
    cohort: CitedValue
    dose: CitedValue
    metric: CitedValue
    events: CitedValue
    denominator: CitedValue
    population: CitedValue
    window: CitedValue
    definition: CitedValue
    reported_rate: CitedValue


class Observation(Contract):
    id: Id
    value_kind: Literal["event_count", "reported_percentage"]
    fields: Fields


class Extraction(Contract):
    observations: list[Observation] = Field(max_length=12)


class Concern(Contract):
    scope: Literal["observation_error", "comparison_limitation"]
    observation_ids: list[Id] = Field(min_length=1, max_length=12)
    span_ids: list[Id] = Field(min_length=1, max_length=12)
    reason: Text


class Critique(Contract):
    concerns: list[Concern] = Field(max_length=12)
    next_questions: list[Text] = Field(max_length=8)


class Finding(Contract):
    code: str
    observation_id: str | None
    field: str | None
    detail: str


class Event(Contract):
    stage: str
    attempt: int
    codes: list[str]


class CallRecord(Contract):
    stage: str
    attempt: int
    response_id: str | None
    input_tokens: int | None
    output_tokens: int | None
    outcome: str
    notices: list[str] = Field(default_factory=list)


class Attempt(Contract):
    number: int
    extraction: Extraction | None
    findings: list[Finding]
    critique: Critique | None


class CanonicalMetric(Contract):
    observation_id: str
    source_label: str
    family: str
    code: str
    mapping_version: str


class AgentReport(Contract):
    run_id: str
    started_at: str
    input_digest: Digest
    input: AgentInput
    prompt_version: str
    prompt_digest: Digest
    engine_version: str
    runtime: dict[str, str]
    execution_mode: Literal[
        "OPENAI_RESPONSES", "DACON_RESPONSES", "CODEX_CHATGPT", "SCRIPTED_TEST_DOUBLE"
    ]
    model: str
    budgets: dict[str, int | float]
    status: Literal["DRAFT_FOR_EXPERT_REVIEW", "PARTIAL_ABSTENTION", "FAILED", "BUDGET_EXCEEDED"]
    accepted: list[Observation]
    metric_mappings: list[CanonicalMetric]
    attempts: list[Attempt]
    calls: list[CallRecord]
    events: list[Event]
    limitations: list[str]
