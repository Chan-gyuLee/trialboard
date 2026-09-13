"""Bridge from selected PDF export spans; supplied hashes are NOT independently verified."""

import re

from trialboard.agent.models import AgentInput, Span


def from_pdf_export(
    packet: dict, *, asset: str, indication: str, study: str, question: str
) -> AgentInput:
    def invalid():
        raise ValueError("INVALID_PDF_EXPORT")

    try:
        if packet["schemaVersion"] != "pdf-evidence-review/1":
            invalid()
        source = packet["source"]
        digest = source["sha256"]
        if source["schemaVersion"] != "pdf-evidence/1" or not re.fullmatch("[0-9a-f]{64}", digest):
            invalid()
        pages = source["pages"]
        if not isinstance(pages, list) or not 1 <= len(pages) <= 40:
            invalid()
        index = {}
        for number, page in enumerate(pages, 1):
            if type(page["number"]) is not int or page["number"] != number:
                invalid()
            for position, span in enumerate(page["spans"]):
                if span["id"] in index or type(span["page"]) is not int or span["page"] != number:
                    invalid()
                if not isinstance(span["text"], str) or len(span["text"]) > 2000:
                    invalid()
                index[span["id"]] = (span, number, position)
        notes = packet["notes"]
        if not isinstance(notes, list) or not 1 <= len(notes) <= 100:
            invalid()
        selected = set()
        for note in notes:
            span, number, position = index[note["spanId"]]
            if (
                note["sourceDigest"] != digest
                or note["quote"] != span["text"]
                or note["page"] != number
                or note["box"] != span["box"]
                or not span["box"]
                or note["locationStatus"] != "USER_ATTESTED_VISUAL_MATCH"
                or note["meaningStatus"] != "NOT_ASSESSED"
            ):
                invalid()
            # Include immediate context, never silently send the whole PDF export.
            neighbors = pages[number - 1]["spans"][max(0, position - 2) : position + 3]
            selected.update(s["id"] for s in neighbors)
        spans = [
            Span(id=s["id"], source_digest=digest, page=number, text=s["text"])
            for s, number, _ in index.values()
            if s["id"] in selected
        ]
        return AgentInput(
            question=question,
            asset=asset,
            indication=indication,
            study=study,
            spans=spans,
            provenance="user_pdf_export_unverified",
        )
    except (KeyError, TypeError, AttributeError):
        raise ValueError("INVALID_PDF_EXPORT") from None
