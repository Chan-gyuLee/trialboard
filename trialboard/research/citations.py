"""Model selects source-bound span IDs; the server copies exact original quotations."""

import re
from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from trialboard.research.models import Contract, Insight, ResearchReview, Source
from trialboard.research.result_context import review_char_limit
from trialboard.research.validation import ResearchValidationError, validate_review
from trialboard.serialization import sha256_json

CITATION_CONTRACT_VERSION = "source-spans/2"
MAX_REVIEW_SOURCES = 8
MAX_SOURCE_CHARS = 4500
MAX_QUOTE_CHARS = 600


class AnchoredInsight(Contract):
    anchor_id: str
    interpretation: str = Field(min_length=1, max_length=700)


class AnchoredReview(Contract):
    findings: list[AnchoredInsight] = Field(max_length=8)
    questions: list[str] = Field(max_length=8)
    conclusion: Literal["NEEDS_EXPERT_REVIEW", "INSUFFICIENT_EVIDENCE"]


@dataclass(frozen=True)
class CitationSpan:
    anchor_id: str
    source_id: str
    source_digest: str
    start: int
    end: int
    text: str

    def binding(self):
        return {
            "anchor_id": self.anchor_id,
            "source_id": self.source_id,
            "source_digest": self.source_digest,
            "start": self.start,
            "end": self.end,
            "offset_unit": "UNICODE_CODE_POINTS",
        }


def span_id(source, start, end):
    return (
        "q_"
        + sha256_json(
            {
                "source_id": source.id,
                "source_digest": source.digest,
                "start": start,
                "end": end,
                "text": source.text[start:end],
            }
        )[:24]
    )


def source_spans(source: Source) -> list[CitationSpan]:
    """Bounded exact windows; sentence/space boundaries preferred, no text normalization."""
    text = source.text[:review_char_limit(source)]
    spans = []
    start = 0
    while start < len(text):
        if text[start].isspace():
            start += 1
            continue
        end = min(start + MAX_QUOTE_CHARS, len(text))
        if end < len(text):
            window = text[start:end]
            # Do not split decimals. Prefer a late sentence/newline boundary.
            breaks = [
                m.start()
                for m in re.finditer(r"\n|(?<=[.!?])\s+(?=[A-Z])", window)
                if m.start() >= MAX_QUOTE_CHARS // 2
            ]
            if not breaks:
                breaks = [
                    m.start()
                    for m in re.finditer(r"\s+", window)
                    if m.start() >= MAX_QUOTE_CHARS // 2
                ]
            if breaks:
                end = start + breaks[-1]
        while end > start and text[end - 1].isspace():
            end -= 1
        spans.append(
            CitationSpan(
                span_id(source, start, end), source.id, source.digest, start, end, text[start:end]
            )
        )
        start = end
    return spans


def citation_context(sources: list[Source]):
    if len(sources) > MAX_REVIEW_SOURCES or len({s.id for s in sources}) != len(sources):
        raise ValueError("INVALID_CITATION_CONTEXT")
    anchors = {}
    payload_sources = []
    for source in sources:
        spans = source_spans(source)
        for span in spans:
            if span.anchor_id in anchors:
                raise ValueError("INVALID_CITATION_CONTEXT")
            anchors[span.anchor_id] = span
        payload_sources.append(
            {
                "id": source.id,
                "title": source.title,
                "content_level": source.content_level,
                "link_basis": source.link_basis,
                "input_chars": min(len(source.text), review_char_limit(source)),
                "segments": [{"anchor_id": span.anchor_id, "text": span.text} for span in spans],
            }
        )
    schema = AnchoredReview.model_json_schema()
    if anchors:
        schema["$defs"]["AnchoredInsight"]["properties"]["anchor_id"]["enum"] = sorted(anchors)
    else:
        schema["properties"]["findings"]["maxItems"] = 0
    return payload_sources, anchors, schema


def resolve_citations(value, anchors: dict[str, CitationSpan], sources: list[Source]):
    """Fail closed for unknown/stale spans; no nearest-match or generated quote fallback."""
    draft = AnchoredReview.model_validate(value)
    by_id = {s.id: s for s in sources}
    findings, bindings = [], []
    for finding in draft.findings:
        span = anchors.get(finding.anchor_id)
        source = by_id.get(span.source_id) if span else None
        if (
            not span
            or not source
            or source.digest != span.source_digest
            or not 0 <= span.start < span.end <= min(len(source.text), review_char_limit(source))
            or span.end - span.start > MAX_QUOTE_CHARS
            or source.text[span.start : span.end] != span.text
            or span_id(source, span.start, span.end) != finding.anchor_id
        ):
            raise ResearchValidationError("UNSUPPORTED_REVIEW_CITATION", "findings.anchor_id")
        findings.append(
            Insight(
                source_id=source.id,
                quote=source.text[span.start : span.end],
                interpretation=finding.interpretation,
            )
        )
        bindings.append(span.binding())
    review = ResearchReview(
        findings=findings, questions=draft.questions, conclusion=draft.conclusion
    )
    return validate_review(review, {s.id: s.text[:review_char_limit(s)] for s in sources}), bindings
