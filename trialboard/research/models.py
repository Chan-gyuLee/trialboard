from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ResearchRequest(Contract):
    search_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    nct_id: str = Field(pattern=r"^NCT\d{8}$")
    asset: str = Field(min_length=2, max_length=100, pattern=r"^[\w .()+-]+$")
    indication: str = Field(min_length=1, max_length=300)
    public_consent: Literal[True]
    model_consent: bool = False

    @field_validator("asset", "indication")
    @classmethod
    def nonblank(cls, value):
        if not value.strip() or (len(value.strip()) < 2):
            raise ValueError("EMPTY_RESEARCH_CONTEXT")
        return value.strip()

    @field_validator("public_consent", mode="before")
    @classmethod
    def explicit(cls, value):
        if value is not True:
            raise ValueError("EXPLICIT_CONSENT_REQUIRED")
        return value


class Priority(Contract):
    source_id: str
    reason: str = Field(min_length=1, max_length=400)


class CurationInput(Contract):
    source_id: str = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=0)
    decision: Literal["INCLUDE", "CHECK", "EXCLUDE"]
    reason: str = Field(min_length=3, max_length=2000)
    reviewer_label: str = Field(min_length=1, max_length=80)

    @field_validator("reason", "reviewer_label")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("EMPTY_REVIEW_NOTE")
        return value.strip()

    @field_validator("reason")
    @classmethod
    def substantive_reason(cls, value):
        if len(value) < 3:
            raise ValueError("REVIEW_REASON_TOO_SHORT")
        return value


class SearchPlan(Contract):
    followup_terms: list[str] = Field(max_length=2)
    priorities: list[Priority] = Field(max_length=6)
    missing_evidence: list[str] = Field(max_length=6)


class Insight(Contract):
    source_id: str
    quote: str = Field(min_length=1, max_length=600)
    interpretation: str = Field(min_length=1, max_length=700)


class ResearchReview(Contract):
    findings: list[Insight] = Field(max_length=8)
    questions: list[str] = Field(max_length=8)
    conclusion: Literal["NEEDS_EXPERT_REVIEW", "INSUFFICIENT_EVIDENCE"]


class Source(Contract):
    id: str
    kind: Literal["REGISTRY", "PAPER", "PROTOCOL", "SAP", "REGULATORY"]
    title: str
    url: str
    text: str
    content_level: Literal["REGISTRY_TEXT", "ABSTRACT", "METADATA", "PDF_AVAILABLE"]
    link_basis: list[str]
    identifiers: dict[str, str]
    published: str | None = None
    fetched_at: str
    digest: str
    pdf_url: str | None = None
    raw_snapshots: list[str] = Field(default_factory=list)


class Coverage(Contract):
    channel: str
    query: str
    status: Literal["OK", "EMPTY", "FAILED", "SKIPPED"]
    total: int | None
    fetched: int
    limited: bool


class Collection(Contract):
    id: str
    project_id: str
    created_at: str
    request: ResearchRequest
    status: Literal["RUNNING", "COMPLETE", "PARTIAL", "CANCELLED", "FAILED"]
    sources: list[Source]
    coverage: list[Coverage]
    events: list[dict]
    plan: SearchPlan | None = None
    review: ResearchReview | None = None
    calls: list[dict] = Field(default_factory=list)
    notices: list[str] = Field(default_factory=list)
    execution_mode: Literal[
        "COLLECTORS_ONLY", "CODEX_CHATGPT", "DACON_RESPONSES", "SCRIPTED_TEST_DOUBLE"
    ] = "COLLECTORS_ONLY"
