"""Audited percent-unit attachment, never inferred counts or clinical table understanding."""

import re

from trialboard.agent.clinical import percentage


def normalized_rate(value, source, *, field="reported_rate", kind="reported_percentage"):
    n = value.normalization
    if n is None:
        return None
    if field != "reported_rate" or kind != "reported_percentage":
        raise ValueError("NORMALIZATION_RATE_ONLY")
    raw = value.value or ""
    if not re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{1,4})?", raw):
        raise ValueError("NORMALIZATION_SINGLE_NUMBER_REQUIRED")
    if percentage(raw + "%") is None or n.display != raw + "%":
        raise ValueError("NORMALIZATION_DISPLAY_MISMATCH")
    index = {s.id: s for page in source.pages for s in page.spans}
    primary = value.citation
    unit = next((c for c in value.supporting if c.spanId == n.unitSpanId), None)
    p = index.get(primary.spanId) if primary else None
    u = index.get(unit.spanId) if unit else None
    if (
        not primary
        or not unit
        or unit.role != "unit"
        or not p
        or not u
        or not p.box
        or not u.box
        or primary.page != unit.page
        or primary.page != p.page
        or unit.page != u.page
        or p.id == u.id
        or primary.quote.strip() != raw
        or p.text.strip() != raw
        or unit.quote.strip() != "%"
        or u.text.strip() != "%"
    ):
        raise ValueError("NORMALIZATION_LITERAL_UNIT_REQUIRED")
    # Only a nearby same-line standalone '%' is supported in version 1.
    # Column headings/CI/table-wide units are deliberately not inferred.
    a, b = p.box, u.box
    overlap = min(a.y + a.height, b.y + b.height) - max(a.y, b.y)
    if overlap < min(a.height, b.height) * 0.5 or not -0.002 <= b.x - (a.x + a.width) <= 0.04:
        raise ValueError("NORMALIZATION_UNIT_NOT_ADJACENT")
    # A separate confidence-level/CI label on the same visual line is ambiguous.
    for s in source.pages[p.page - 1].spans:
        if s.id in (p.id, u.id) or not s.box:
            continue
        box = s.box
        same_line = min(a.y + a.height, box.y + box.height) - max(a.y, box.y) > 0
        nearby = box.x <= b.x + b.width + 0.12 and box.x + box.width >= a.x - 0.12
        if (
            same_line
            and nearby
            and re.search(r"\b(?:CI|confidence|p\s*value)\b|신뢰구간", s.text, re.I)
        ):
            raise ValueError("NORMALIZATION_INTERVAL_CONTEXT")
    return n.display


def reviewed_rates(review, source):
    result = {}
    for row in review.rows:
        if any(f.decision == "held" for f in row.fields.values()):
            continue
        f = row.fields["reported_rate"]
        if f.decision in ("confirmed", "corrected"):
            rate = normalized_rate(f.current, source, kind=row.valueKind)
            if rate:
                result[row.id] = rate
    return result
