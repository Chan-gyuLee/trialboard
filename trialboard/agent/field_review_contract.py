"""Untrusted browser review export contracts; history consistency is not authentication."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from trialboard.agent.models import Contract, Digest, Fields, Id, Text

FIELD_NAMES = tuple(Fields.model_fields)
Decision = Literal["unreviewed", "confirmed", "corrected", "held"]


class Citation(Contract):
    spanId: Id
    page: int = Field(ge=1, le=200)
    quote: Text


class SupportingCitation(Citation):
    role: Literal["header", "unit", "footnote", "context"]


class RateNormalization(Contract):
    method: Literal["adjacent-percent/1"]
    display: Text
    unitSpanId: Id
    pointEstimateAttested: Literal[True]
    sameGroupAttested: Literal[True]

    @field_validator("pointEstimateAttested", "sameGroupAttested", mode="before")
    @classmethod
    def explicit_attestation(cls, value):
        if value is not True:
            raise ValueError("NORMALIZATION_EXPLICIT_ATTESTATION_REQUIRED")
        return value


class Value(Contract):
    value: Text | None
    citation: Citation | None
    supporting: list[SupportingCitation] = Field(
        default_factory=list, max_length=4, exclude_if=lambda v: not v
    )
    normalization: RateNormalization | None = Field(default=None, exclude_if=lambda v: v is None)

    @model_validator(mode="after")
    def missing(self):
        if "normalization" in self.model_fields_set and self.normalization is None:
            raise ValueError("EMPTY_NORMALIZATION")
        if self.normalization and (not self.value or not self.citation or not self.supporting):
            raise ValueError("NORMALIZATION_REQUIRES_CITATIONS")
        if self.value is None and self.citation is not None:
            raise ValueError("MISSING_VALUE_WITH_CITATION")
        if "supporting" in self.model_fields_set:
            if not self.supporting or not self.value or not self.citation:
                raise ValueError("SUPPORT_WITHOUT_PRIMARY")
            ids = [self.citation.spanId, *(c.spanId for c in self.supporting)]
            if len(ids) != len(set(ids)) or any(
                c.page != self.citation.page for c in self.supporting
            ):
                raise ValueError("SUPPORT_PAGE_OR_DUPLICATE")
        return self


class Revision(Contract):
    revision: int = Field(ge=1, le=40)
    decision: Literal["confirmed", "corrected", "held"]
    before: Value
    after: Value
    reason: Text
    at: Annotated[str, Field(min_length=1, max_length=50)]

    @model_validator(mode="after")
    def consistent(self):
        timestamp = datetime.fromisoformat(self.at)
        if timestamp.tzinfo is None or not self.reason.strip():
            raise ValueError("INVALID_REVIEW_HISTORY")
        if self.decision in ("confirmed", "held") and self.before != self.after:
            raise ValueError("NON_CORRECTION_CHANGED_VALUE")
        if self.decision == "corrected" and self.before == self.after:
            raise ValueError("EMPTY_CORRECTION")
        if self.decision != "held" and (
            not (self.after.value or "").strip() or not self.after.citation
        ):
            raise ValueError("CONFIRMATION_WITHOUT_CITED_VALUE")
        return self


class ReviewField(Contract):
    original: Value
    current: Value
    decision: Decision
    history: list[Revision] = Field(max_length=40)

    @model_validator(mode="after")
    def replay(self):
        previous = self.original
        for number, revision in enumerate(self.history, 1):
            if revision.revision != number or revision.before != previous:
                raise ValueError("BROKEN_HISTORY_CHAIN")
            previous = revision.after
        expected = self.history[-1].decision if self.history else "unreviewed"
        if self.current != previous or self.decision != expected:
            raise ValueError("REVIEW_STATE_HISTORY_MISMATCH")
        return self


class ReviewRow(Contract):
    id: Id
    origin: Literal["manual", "imported_agent_report"]
    valueKind: Literal["event_count", "reported_percentage"]
    fields: dict[str, ReviewField]

    @model_validator(mode="after")
    def names(self):
        if set(self.fields) != set(FIELD_NAMES):
            raise ValueError("INVALID_REVIEW_FIELDS")
        if self.origin == "manual" and any(
            f.original.value is not None or f.original.citation is not None
            for f in self.fields.values()
        ):
            raise ValueError("MANUAL_ROW_HAS_MODEL_ORIGINAL")
        return self


class Origin(Contract):
    kind: Literal["manual", "imported_agent_report"]
    runId: Annotated[str, Field(min_length=1, max_length=100)] | None
    reportDigest: Digest | None
    mode: (
        Literal["CODEX_CHATGPT", "DACON_RESPONSES", "OPENAI_RESPONSES", "SCRIPTED_TEST_DOUBLE"]
        | None
    )

    @model_validator(mode="after")
    def consistent(self):
        metadata = (self.runId, self.reportDigest, self.mode)
        if self.kind == "manual" and any(v is not None for v in metadata):
            raise ValueError("MANUAL_ORIGIN_WITH_REPORT")
        if self.kind == "imported_agent_report" and any(v is None for v in metadata):
            raise ValueError("IMPORTED_ORIGIN_WITHOUT_REPORT")
        return self


class ReviewPacket(Contract):
    schemaVersion: Literal["pdf-field-review/1", "pdf-field-review/2", "pdf-field-review/3"]
    sourceDigest: Digest
    origin: Origin
    rows: list[ReviewRow] = Field(max_length=12)
    modelFindings: list[Annotated[str, Field(max_length=8100)]] = Field(max_length=300)
    sourceName: Annotated[str, Field(min_length=1, max_length=2000)]
    persisted: bool
    reviewerIdentity: Literal["UNAUTHENTICATED_USER"]
    clinicalApproval: bool
    downstreamStatus: Literal["REQUIRES_REVALIDATION"]
    limitations: list[Text] = Field(max_length=20)

    @model_validator(mode="after")
    def consistent(self):
        if self.persisted or self.clinicalApproval:
            raise ValueError("UNSUPPORTED_TRUST_CLAIM")
        for row in self.rows:
            for name, field in row.fields.items():
                values = [field.original, field.current]
                values += [v for h in field.history for v in (h.before, h.after)]
                if any(v.normalization for v in values) and (
                    self.schemaVersion != "pdf-field-review/3"
                    or name != "reported_rate"
                    or row.valueKind != "reported_percentage"
                ):
                    raise ValueError("NORMALIZATION_REQUIRES_RATE_V3")
        if self.schemaVersion == "pdf-field-review/1":
            for row in self.rows:
                for field in row.fields.values():
                    values = [field.original, field.current]
                    values += [v for h in field.history for v in (h.before, h.after)]
                    if any(v.supporting for v in values):
                        raise ValueError("SUPPORT_REQUIRES_REVIEW_V2")
        if len({r.id for r in self.rows}) != len(self.rows):
            raise ValueError("DUPLICATE_REVIEW_ROW")
        if self.origin.kind == "manual" and any(r.origin != "manual" for r in self.rows):
            raise ValueError("ROW_ORIGIN_MISMATCH")
        return self


class Box(Contract):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def bounds(self):
        if self.x + self.width > 1.000000001 or self.y + self.height > 1.000000001:
            raise ValueError("BOX_OUTSIDE_PAGE")
        return self


class PdfSpan(Contract):
    id: Id
    page: int = Field(ge=1, le=200)
    item: int = Field(ge=0, le=20000)
    text: Annotated[str, Field(min_length=1, max_length=250000)]
    box: Box | None


class PdfPage(Contract):
    number: int = Field(ge=1, le=200)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    rotation: Literal[0, 90, 180, 270]
    spans: list[PdfSpan] = Field(max_length=20000)
    status: Literal["TEXT_EXTRACTED", "NO_TEXT"]


class PdfSource(Contract):
    schemaVersion: Literal["pdf-evidence/1", "pdf-evidence-selected/1"]
    totalPages: int | None = Field(default=None, ge=1, le=200, exclude_if=lambda v: v is None)
    name: Annotated[str, Field(min_length=1, max_length=2000)]
    sha256: Digest
    byteLength: int = Field(ge=5, le=5 * 1024 * 1024)
    extractor: Text
    pages: list[PdfPage] = Field(min_length=1, max_length=40)
    status: Literal["TEXT_EXTRACTED", "PARTIAL_NO_TEXT", "NO_TEXT"]
    coordinateSystem: Literal["normalized_top_left_rotated_viewport"]

    @model_validator(mode="after")
    def structure(self):
        selected = self.schemaVersion == "pdf-evidence-selected/1"
        if (selected and self.totalPages is None) or (
            not selected and "totalPages" in self.model_fields_set
        ):
            raise ValueError("INVALID_PAGE_SELECTION")
        seen, count, characters, empty = set(), 0, 0, 0
        previous = 0
        for index, page in enumerate(self.pages, 1):
            number = page.number
            if (
                (not selected and number != index)
                or number <= previous
                or (selected and number > self.totalPages)
                or (page.status == "NO_TEXT") != (not page.spans)
            ):
                raise ValueError("INVALID_PAGE_ORDER_OR_STATUS")
            previous = number
            empty += not page.spans
            for span in page.spans:
                if span.id in seen or span.page != number or span.id != f"p{number}-i{span.item}":
                    raise ValueError("INVALID_SPAN_IDENTITY")
                seen.add(span.id)
                count += 1
                characters += len(span.text)
        status = (
            "NO_TEXT"
            if empty == len(self.pages)
            else ("PARTIAL_NO_TEXT" if empty else "TEXT_EXTRACTED")
        )
        if count > 20000 or characters > 250000 or self.status != status:
            raise ValueError("SOURCE_BUDGET_OR_STATUS")
        return self
