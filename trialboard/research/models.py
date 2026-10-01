from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class RawStoragePermission(Contract):
    collector: Literal["REGISTRY", "LITERATURE", "REGULATORY"]
    original_storage: Literal["ALLOW"]
    evidence_reference: str = Field(min_length=1, max_length=2000)
    reason: str = Field(min_length=1, max_length=4000)

    @field_validator("evidence_reference", "reason")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("RAW_STORAGE_EVIDENCE_REQUIRED")
        return value.strip()


class ResearchRequest(Contract):
    search_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    nct_id: str = Field(pattern=r"^NCT\d{8}$")
    asset: str = Field(min_length=2, max_length=100, pattern=r"^[\w .()+-]+$")
    indication: str = Field(min_length=1, max_length=300)
    public_consent: Literal[True]
    model_consent: bool = False
    raw_storage_permissions: list[RawStoragePermission] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def unique_collectors(self):
        names = [p.collector for p in self.raw_storage_permissions]
        if len(names) != len(set(names)):
            raise ValueError("DUPLICATE_RAW_STORAGE_PERMISSION")
        return self

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


class PlannedFollowup(Contract):
    term: str
    intent: Literal["CONTRARIAN", "EVIDENCE_GAP"]


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


class LegacySearchPlan(Contract):
    followup_terms: list[str] = Field(max_length=2)
    priorities: list[Priority] = Field(max_length=6)
    missing_evidence: list[str] = Field(max_length=6)


class SearchPlan(Contract):
    followups: list[PlannedFollowup] = Field(min_length=1, max_length=2)
    priorities: list[Priority] = Field(max_length=6)
    missing_evidence: list[str] = Field(max_length=6)


class FollowupExecution(Contract):
    term: str
    intent: Literal["CONTRARIAN", "EVIDENCE_GAP"]
    origin: Literal["MODEL", "APPLICATION_POLICY"]
    query: str
    coverage_index: int = Field(ge=0)
    status: Literal["OK", "EMPTY", "FAILED", "SKIPPED"]
    attempted: bool


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
    pages: int | None = Field(default=None, ge=0, le=2)
    stop_reason: (
        Literal[
            "RESULTS_EXHAUSTED",
            "PAGE_LIMIT",
            "SOURCE_LIMIT",
            "CURSOR_UNAVAILABLE",
            "NO_NEW_RECORDS",
            "REQUEST_FAILED",
        ]
        | None
    ) = None


class Collection(Contract):
    id: str
    project_id: str
    created_at: str
    request: ResearchRequest
    status: Literal["RUNNING", "COMPLETE", "PARTIAL", "CANCELLED", "FAILED"]
    sources: list[Source]
    coverage: list[Coverage]
    events: list[dict]
    plan: SearchPlan | LegacySearchPlan | None = None
    followup_executions: list[FollowupExecution] = Field(default_factory=list, max_length=2)
    review: ResearchReview | None = None
    calls: list[dict] = Field(default_factory=list)
    notices: list[str] = Field(default_factory=list)
    execution_mode: Literal[
        "COLLECTORS_ONLY", "CODEX_CHATGPT", "DACON_RESPONSES", "SCRIPTED_TEST_DOUBLE"
    ] = "COLLECTORS_ONLY"

    @model_validator(mode="after")
    def consistent_followup_provenance(self):
        if not self.request.model_consent and self.followup_executions:
            raise ValueError("FOLLOWUP_WITHOUT_MODEL_CONSENT")
        if isinstance(self.plan, LegacySearchPlan):
            if self.followup_executions:
                raise ValueError("LEGACY_PLAN_HAS_NEW_EXECUTION_PROVENANCE")
            return self
        if self.plan is None:
            if self.followup_executions:
                raise ValueError("FOLLOWUP_WITHOUT_PLAN")
            return self
        if len(self.followup_executions) > len(self.plan.followups):
            raise ValueError("FOLLOWUP_PLAN_EXECUTION_MISMATCH")
        for planned, execution in zip(self.plan.followups, self.followup_executions, strict=False):
            if (planned.term, planned.intent) != (execution.term, execution.intent):
                raise ValueError("FOLLOWUP_PLAN_EXECUTION_MISMATCH")
            if execution.coverage_index >= len(self.coverage):
                raise ValueError("FOLLOWUP_COVERAGE_MISMATCH")
            receipt = self.coverage[execution.coverage_index]
            expected_query = (
                f'TITLE_ABS:"{self.request.asset.strip()}" AND ({execution.term}) AND SRC:MED'
            )
            if (
                receipt.channel != "Europe PMC / PubMed"
                or execution.query != expected_query
                or receipt.query != execution.query
                or receipt.status != execution.status
                or execution.attempted != (execution.status != "SKIPPED")
            ):
                raise ValueError("FOLLOWUP_COVERAGE_MISMATCH")
        if self.status == "COMPLETE" and self.review is not None:
            if len(self.followup_executions) != len(self.plan.followups) or not any(
                item.intent == "CONTRARIAN" and item.attempted
                for item in self.followup_executions
            ):
                raise ValueError("FOLLOWUP_EXECUTION_INCOMPLETE")
        return self
