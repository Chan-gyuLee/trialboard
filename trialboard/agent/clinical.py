"""Small, explicit vocabulary and numeric guards, NOT general clinical NLP.

Keep source labels intact. Mapping a family never establishes comparable endpoints.
Percentage-to-count reconstruction is intentionally absent.
"""

import re
from decimal import Decimal

METRIC_VERSION = "clinical-labels/1.1"
LABELS = {
    "response": ("response", "synthetic_response"),
    "overall response rate": ("response", "overall_response_rate"),
    "objective response rate": ("response", "objective_response_rate"),
    "adverse_event": ("adverse_event", "synthetic_adverse_event"),
    "adverse events": ("adverse_event", "adverse_events"),
    "adverse reactions": ("adverse_event", "adverse_reactions"),
    "treatment-related adverse events": ("adverse_event", "treatment_related_adverse_events"),
    "treatment-emergent adverse events": ("adverse_event", "treatment_emergent_adverse_events"),
}


def normalized(text):
    return " ".join((text or "").casefold().split())


def metric_identity(label, definition=None, definition_quote=None):
    key = normalized(label)
    if key in LABELS:
        return LABELS[key]
    if key == "orr":
        # Only an explicit expansion in the separately source-cited definition resolves ORR.
        matches = [
            name
            for name in ("overall response rate", "objective response rate")
            if f"{name} (orr)" in normalized(definition)
            or (normalized(definition) == name and f"{name} (orr)" in normalized(definition_quote))
        ]
        if len(matches) == 1:
            return LABELS[matches[0]]
    return None


def percentage(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:\d{1,3})(?:\.\d{1,4})?\s*%", value):
        return None
    number = Decimal(value.rstrip("% "))
    return number if 0 <= number <= 100 else None


def count_token(value, quote):
    """An isolated integer, not digits inside a percent, decimal or signed number."""
    if value is None or not re.fullmatch(r"[0-9]{1,7}", value):
        return False
    return bool(
        re.search(
            r"(?<![\w.,+−–—-])" + re.escape(value) + r"(?!\w|[.,]\d|\s*[%％])",
            quote or "",
        )
    )


def reported_rate_binding(fields, spans):
    """Recognize only '<rate>% (CI...) in the <n> <group> patients' prose.

    Unsupported syntax stays explicitly unverified. Do not invent a relationship
    merely because the three values occur somewhere on the same page.
    """
    selected = spans.get(fields.reported_rate.span_id)
    if selected is None:
        return "UNVERIFIED"
    pairs = re.findall(
        r"(\d{1,3}(?:\.\d{1,4})?%)\s*(?:\([^)]*\)\s*)?in\s+(?:the\s+)?"
        r"(\d{1,7})\s+([^.;]+?patients)\b",
        selected.text,
        flags=re.I,
    )
    if not pairs:
        return "UNVERIFIED"
    matching_rates = [
        (n, group)
        for rate, n, group in pairs
        if percentage(rate) == percentage(fields.reported_rate.value)
    ]
    if not matching_rates:
        # A quoted CI bound must not replace a rate in a recognized construction.
        return "MISMATCH"
    if fields.denominator.value is None or fields.population.value is None:
        return "UNVERIFIED"
    for n, group in matching_rates:
        if n == fields.denominator.value and normalized(group) == normalized(
            fields.population.value
        ):
            return "MATCH"
    return "MISMATCH"


def rate_count_consistent(rate, events, denominator):
    """Check rounding compatibility only; never manufacture or replace a count."""
    value = percentage(rate)
    if (
        value is None
        or not all(re.fullmatch(r"[0-9]{1,7}", s or "") for s in (events, denominator))
        or int(denominator) == 0
    ):
        return False
    places = max(0, -value.as_tuple().exponent)
    tolerance = Decimal("0.5") * Decimal(10) ** -places
    actual = Decimal(events) * 100 / Decimal(denominator)
    return abs(actual - value) <= tolerance
