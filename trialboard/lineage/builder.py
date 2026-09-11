"""Deterministic trial-lineage builder (no LLM).

Inputs: registry version history, FDA letters/labels/reviews, ODAC briefing,
publications. Output: dated LineageNodes with quotes bound to spans, plus edges.

Rules are explicit and cited in the node summary so a reviewer can audit why a
node exists. LLM-based enrichment (one-line "what changed" summaries) can be
layered on later but never creates nodes by itself.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from trialboard.core.hashing import short_id
from trialboard.core.schemas import (
    Attribution,
    Claim,
    LineageEdge,
    LineageKind,
    LineageNode,
    Source,
    SourceType,
    Span,
    VerificationStatus,
)
from trialboard.corpus.pdf import PDFDocument, normalize_ws
from trialboard.corpus.seeds import DESIGN_MODULES

PMR_RE = re.compile(
    r"(?P<id>\d{4}-\d)\s*\n\s*(?P<text>Conduct[^\n]*(?:\n(?![\d]{4}-\d)[^\n]*){0,8})"
)


class LineageBuilder:
    def __init__(self, trial_id: str, drug: str):
        self.trial_id = trial_id
        self.drug = drug
        self.nodes: list[LineageNode] = []
        self.edges: list[LineageEdge] = []
        self.spans: list[Span] = []
        self.claims: list[Claim] = []

    # ------------------------------------------------------------ registry
    def add_registry_history(self, changes: list[dict[str, Any]], src: Source) -> None:
        prev: str | None = None
        for ch in changes:
            v = ch.get("version")
            labels = ch.get("moduleLabels", []) or []
            is_design = bool(set(labels) & DESIGN_MODULES)
            kind = LineageKind.DESIGN_CHANGE if is_design else LineageKind.REGISTRY_VERSION
            nid = short_id("ln", self.trial_id, "registry", str(v))
            span = Span(
                span_id=short_id("sp", src.source_id, f"$.changes[{v}]"),
                source_id=src.source_id,
                json_path=f"$.changes[{v}]",
                text=f"version {v} {ch.get('date')} status={ch.get('status')} modules={labels}",
            )
            self.spans.append(span)
            self.nodes.append(
                LineageNode(
                    node_id=nid,
                    trial_id=self.trial_id,
                    kind=kind,
                    date=_d(ch.get("date")),
                    title=f"Registry v{v}: {ch.get('status')}",
                    summary=("Design-relevant modules changed: " + ", ".join(labels))
                    if is_design
                    else ("Changed: " + ", ".join(labels) if labels else "Initial registration"),
                    source_id=src.source_id,
                    changed_fields=labels,
                )
            )
            if prev:
                self.edges.append(LineageEdge(from_node=prev, to_node=nid, relation="precedes"))
            prev = nid

    # ------------------------------------------------------------ FDA letters
    def add_letter(self, src: Source) -> None:
        doc = PDFDocument(src.local_path)
        full = "\n".join(doc.page_texts())
        low = full.lower()
        if "accelerated approval" in low:
            kind = LineageKind.ACCELERATED_APPROVAL
        elif "traditional approval" in low or "regular approval" in low:
            kind = LineageKind.TRADITIONAL_APPROVAL
        else:
            kind = LineageKind.LABEL_REVISION
        nid = short_id("ln", self.trial_id, "letter", src.content_hash)
        self.nodes.append(
            LineageNode(
                node_id=nid,
                trial_id=self.trial_id,
                kind=kind,
                date=src.doc_date,
                title=f"FDA action letter {src.version or ''}".strip(),
                summary=f"Classified by keyword search in letter text ({kind.value}).",
                source_id=src.source_id,
            )
        )
        # Postmarketing requirements: each becomes its own node with a verified quote.
        for m in PMR_RE.finditer(full):
            pmr_id = m.group("id")
            txt = normalize_ws(m.group("text"))
            first_sentence = txt.split(". ")[0]
            hits = doc.find_quote(first_sentence[:120])
            if not hits:
                continue
            h = hits[0]
            span = Span(
                span_id=short_id("sp", src.source_id, pmr_id),
                source_id=src.source_id,
                page=h.page,
                bbox=h.bboxes[0] if h.bboxes else None,
                text=first_sentence,
            )
            self.spans.append(span)
            claim = Claim(
                claim_id=short_id("cl", src.source_id, pmr_id),
                subject=self.drug,
                trial_id=self.trial_id,
                field="regulatory.postmarketing_requirement",
                value=pmr_id,
                span_id=span.span_id,
                quote=first_sentence,
                attribution=Attribution.REVIEWER,
                extractor="lineage.builder/regex-pmr@0.1",
                status=VerificationStatus.VERIFIED if h.exact else VerificationStatus.FLAGGED,
            )
            self.claims.append(claim)
            pid = short_id("ln", self.trial_id, "pmr", pmr_id, src.content_hash)
            dose_related = bool(re.search(r"(?i)lower (daily )?dose|dose comparison|960 mg", txt))
            self.nodes.append(
                LineageNode(
                    node_id=pid,
                    trial_id=self.trial_id,
                    kind=LineageKind.POSTMARKETING_REQUIREMENT,
                    date=src.doc_date,
                    title=f"PMR {pmr_id}" + (" (dose comparison)" if dose_related else ""),
                    summary=txt[:400],
                    source_id=src.source_id,
                    claim_ids=[claim.claim_id],
                    changed_fields=["dose"] if dose_related else [],
                )
            )
            self.edges.append(LineageEdge(from_node=nid, to_node=pid, relation="triggers"))
        doc.close()

    def add_label(self, src: Source) -> None:
        nid = short_id("ln", self.trial_id, "label", src.content_hash)
        self.nodes.append(
            LineageNode(
                node_id=nid,
                trial_id=self.trial_id,
                kind=LineageKind.LABEL_REVISION,
                date=src.doc_date,
                title=f"Label {src.version or ''}".strip(),
                summary="Prescribing information revision.",
                source_id=src.source_id,
            )
        )

    def add_review(self, src: Source) -> None:
        kind = (
            LineageKind.ADVISORY_COMMITTEE
            if src.type == SourceType.ODAC_BRIEFING
            else LineageKind.REVIEW
        )
        nid = short_id("ln", self.trial_id, "review", src.content_hash)
        self.nodes.append(
            LineageNode(
                node_id=nid,
                trial_id=self.trial_id,
                kind=kind,
                date=src.doc_date,
                title=src.title,
                summary="",
                source_id=src.source_id,
            )
        )

    def add_publication(self, src: Source) -> None:
        nid = short_id("ln", self.trial_id, "pub", src.url)
        self.nodes.append(
            LineageNode(
                node_id=nid,
                trial_id=self.trial_id,
                kind=LineageKind.PUBLICATION,
                date=src.doc_date,
                title=src.title[:140],
                summary=src.meta.get("authors", "") or "",
                source_id=src.source_id,
            )
        )

    # ------------------------------------------------------------ cross-links
    def link_pmr_to_evidence(self) -> None:
        """PMR(dose) → later ODAC/review nodes that report the comparison."""
        pmrs = [
            n
            for n in self.nodes
            if n.kind == LineageKind.POSTMARKETING_REQUIREMENT and "dose" in n.changed_fields
        ]
        targets = [
            n for n in self.nodes if n.kind in (LineageKind.ADVISORY_COMMITTEE, LineageKind.REVIEW)
        ]
        for p in pmrs:
            for t in targets:
                if p.date and t.date and t.date > p.date:
                    self.edges.append(
                        LineageEdge(from_node=p.node_id, to_node=t.node_id, relation="reports")
                    )


def _d(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None
