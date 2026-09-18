"""Auditable retrieval cues, not clinical evidence grades or cohort verification."""

import re

from trialboard.research.result_context import review_char_limit

SELECTION_VERSION = "dose-context/2"
CONTEXT_CHARS = 4500
NCT = re.compile(r"\bNCT\d{8}\b", re.I)
DOSE_COMPARISON = re.compile(
    r"\bdose[- ](?:comparison|comparative|ranging|optimization|optimisation)\b"
    r"|\b(?:different|two|multiple|lower|higher) doses\b"
    r"|\b\d+(?:\.\d+)?\s*mg\s*(?:versus|vs\.?|compared (?:with|to))\s*"
    r"\d+(?:\.\d+)?\s*mg\b",
    re.I,
)
BACKGROUND_TITLE = re.compile(
    r"\b(?:review|case report|case reports|case series|meta-analysis)\b", re.I
)


def signals(source, request):
    # Only inspect text that can actually reach the review; never infer from a search label.
    text = source.text[: review_char_limit(source)]
    trial_ids = set(NCT.findall(text.upper()))
    asset = bool(re.search(r"(?<!\w)" + re.escape(request.asset) + r"(?!\w)", text, re.I))
    registry = (
        source.kind == "REGISTRY"
        and source.identifiers.get("nct") == request.nct_id
        and request.nct_id in trial_ids
        and source.content_level == "REGISTRY_TEXT"
    )
    readable = source.content_level in ("ABSTRACT", "REGISTRY_TEXT") and bool(text.strip())
    target = request.nct_id in trial_ids
    result_ref = "REGISTRY_REFERENCE_RESULT" in source.link_basis
    dose = asset and bool(DOSE_COMPARISON.search(text))
    background = "REGISTRY_REFERENCE_BACKGROUND" in source.link_basis or bool(
        BACKGROUND_TITLE.search(source.title)
    )
    return {
        "selected_registry": registry,
        "readable_text": readable,
        "target_nct_in_review_window": target,
        "other_nct_in_review_window": bool(trial_ids - {request.nct_id}),
        "registry_result_reference": result_ref,
        "asset_and_dose_comparison_words": dose,
        "background_or_case_title": background,
        "clinical_linkage": "NOT_VERIFIED",
    }


def rank_sources(sources, request, preferred=()):
    preferred = set(preferred)

    def key(source):
        cue = signals(source, request)
        tier = (
            0
            if cue["selected_registry"]
            else 1
            if cue["readable_text"] and cue["target_nct_in_review_window"]
            else 2
            if cue["readable_text"] and cue["registry_result_reference"]
            else 3
            if cue["readable_text"] and cue["asset_and_dose_comparison_words"]
            else 4
            if cue["readable_text"]
            else 5
        )
        return (tier, cue["background_or_case_title"], source.id not in preferred, source.id)

    return sorted(sources, key=key)


def select_review_sources(run, initial_ids):
    """Keep trial context and one linked paper before reserving up to two discoveries."""
    preferred = [p.source_id for p in run.plan.priorities] if run.plan else []
    ordered = [
        s
        for s in rank_sources(run.sources, run.request, preferred)
        if signals(s, run.request)["readable_text"]
    ]
    registry = [s for s in ordered if signals(s, run.request)["selected_registry"]][:3]
    linked = [
        s
        for s in ordered
        if s.kind == "PAPER"
        and (
            signals(s, run.request)["target_nct_in_review_window"]
            or signals(s, run.request)["registry_result_reference"]
        )
    ][:1]
    discovered = [
        s
        for s in ordered
        if s.kind == "PAPER" and s.id not in initial_ids and "AI_FOLLOWUP" in s.link_basis
    ][:2]
    selected = list({s.id: s for s in registry + linked + discovered + ordered}.values())[:8]
    return rank_sources(selected, run.request, preferred)


def selection_record(sources, request):
    return {
        "version": SELECTION_VERSION,
        "signal_window_chars": CONTEXT_CHARS,
        "sources": [
            {
                "source_id": s.id,
                "source_digest": s.digest,
                "signals": signals(s, request),
                "input_char_limit": review_char_limit(s),
            }
            for s in sources
        ],
    }
