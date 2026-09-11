"""Core data contracts shared by every agent, the graph store and the API.

Design rules encoded here:
* A Claim is never stored without a Span (source + page + quote).
* Attribution distinguishes sponsor statements from regulator judgements.
* Failure codes are a closed enum; the orchestrator only understands these.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- enums
class SourceType(StrEnum):
    REGISTRY = "registry"  # ClinicalTrials.gov current record
    REGISTRY_HISTORY = "registry_history"  # one historical version of a record
    FDA_REVIEW = "fda_review"  # multidisciplinary / clinical review
    FDA_LETTER = "fda_letter"  # approval letter (contains PMR/PMC)
    FDA_LABEL = "fda_label"  # prescribing information
    ODAC_BRIEFING = "odac_briefing"
    PUBLICATION = "publication"
    GUIDANCE = "guidance"  # FDA / ICH / MFDS / SPIRIT
    COMPOUND_DB = "compound_db"  # PubChem etc.
    DRUGSFDA_INDEX = "drugsfda_index"


class Attribution(StrEnum):
    SPONSOR = "sponsor"  # applicant's own data/claims
    REVIEWER = "reviewer"  # FDA/MFDS reviewer judgement
    REGISTRY = "registry"  # registry-entered structured data
    AUTHOR = "author"  # peer-reviewed publication authors
    AGENCY_GUIDANCE = "agency_guidance"
    UNKNOWN = "unknown"


class FailureCode(StrEnum):
    E_ID_AMBIGUOUS = "E_ID_AMBIGUOUS"
    E_UNIT = "E_UNIT"
    E_SOURCE_MISSING = "E_SOURCE_MISSING"
    E_VERSION_CONFLICT = "E_VERSION_CONFLICT"
    E_OUT_OF_SCOPE = "E_OUT_OF_SCOPE"
    E_CONFLICT = "E_CONFLICT"
    E_API = "E_API"
    E_QUOTE_NOT_FOUND = "E_QUOTE_NOT_FOUND"


class VerificationStatus(StrEnum):
    PENDING = "pending"
    VERIFIED = "verified"
    FLAGGED = "flagged"
    REJECTED = "rejected"


class RunState(StrEnum):
    COLLECT = "COLLECT"
    NORMALIZE = "NORMALIZE"
    PROPOSE = "PROPOSE"
    SIMULATE = "SIMULATE"
    VERIFY = "VERIFY"
    REVISE = "REVISE"
    ACCEPT = "ACCEPT"
    ABSTAIN = "ABSTAIN"
    FAILED = "FAILED"


ABSTAIN_REASON = "INSUFFICIENT_EVIDENCE_HUMAN_REVIEW_REQUIRED"


# --------------------------------------------------------------------------- evidence
class Source(BaseModel):
    """A fetched document or API payload, pinned by content hash."""

    source_id: str
    type: SourceType
    url: str
    title: str = ""
    issuer: str = ""  # e.g. "FDA", "Amgen", "NLM"
    doc_date: date | None = None
    version: str | None = None  # e.g. registry version number, label supplement
    fetched_at: datetime
    content_hash: str
    media_type: str  # application/pdf, application/json
    local_path: str
    attribution_default: Attribution = Attribution.UNKNOWN
    meta: dict[str, Any] = Field(default_factory=dict)


class Span(BaseModel):
    """Exact location of a quote inside a source."""

    span_id: str
    source_id: str
    page: int | None = None  # 1-based for PDFs; None for JSON payloads
    bbox: list[float] | None = None  # [x0, y0, x1, y1] in PDF points
    json_path: str | None = None  # for structured sources, e.g. $.protocolSection...
    text: str  # the verbatim quote


class Claim(BaseModel):
    """An atomic, source-bound fact. Never stored without a span."""

    claim_id: str
    subject: str  # drug name / trial id
    trial_id: str | None = None
    field: str  # e.g. "pk.auc_ss", "efficacy.orr", "safety.grade3plus_rate"
    arm: str | None = None  # e.g. "960 mg QD"
    dose_mg: float | None = None
    value: float | str | None = None
    unit: str | None = None
    n: int | None = None
    span_id: str
    quote: str
    attribution: Attribution = Attribution.UNKNOWN
    extractor: str  # tool name + version, or "manual"
    status: VerificationStatus = VerificationStatus.PENDING
    flags: list[FailureCode] = Field(default_factory=list)
    notes: str = ""


class MissingItem(BaseModel):
    field: str
    reason: str
    needed_for: str  # which decision this blocks


# --------------------------------------------------------------------------- lineage
class LineageKind(StrEnum):
    REGISTRY_VERSION = "registry_version"
    DESIGN_CHANGE = "design_change"
    ACCELERATED_APPROVAL = "accelerated_approval"
    TRADITIONAL_APPROVAL = "traditional_approval"
    POSTMARKETING_REQUIREMENT = "postmarketing_requirement"
    LABEL_REVISION = "label_revision"
    REVIEW = "review"
    ADVISORY_COMMITTEE = "advisory_committee"
    PUBLICATION = "publication"
    RESULT = "result"


class LineageNode(BaseModel):
    node_id: str
    trial_id: str | None
    kind: LineageKind
    date: date | None
    title: str
    summary: str = ""
    source_id: str
    changed_fields: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)


class LineageEdge(BaseModel):
    from_node: str
    to_node: str
    relation: Literal["precedes", "triggers", "amends", "reports", "supersedes"]


# --------------------------------------------------------------------------- run
class Manifest(BaseModel):
    run_id: str
    started_at: datetime
    finished_at: datetime | None = None
    llm_provider: str
    llm_model: str
    prompt_hashes: dict[str, str] = Field(default_factory=dict)
    tool_versions: dict[str, str] = Field(default_factory=dict)
    source_hashes: dict[str, str] = Field(default_factory=dict)
    seed: int = 42
    tokens_in: int = 0
    tokens_out: int = 0
    llm_calls: int = 0
    api_calls: int = 0
    mode: Literal["snapshot", "live"] = "snapshot"


class RunInput(BaseModel):
    drug: str
    trial_id: str | None = None
    indication: str | None = None
    mode: Literal["snapshot", "live"] = "snapshot"
    fault_injection: list[str] = Field(default_factory=list)
