"""Literal support and count/context checks, not semantic entailment certification."""

import re

from trialboard.agent.clinical import (
    count_token,
    metric_identity,
    percentage,
    rate_count_consistent,
    reported_rate_binding,
)
from trialboard.agent.models import AgentInput, Critique, Extraction, Finding, Observation


def finding(code, observation=None, field=None, detail="") -> Finding:
    return Finding(code=code, observation_id=observation, field=field, detail=detail)


def verify(data: AgentInput, extraction: Extraction) -> tuple[list[Observation], list[Finding]]:
    spans = {s.id: s for s in data.spans}
    accepted, issues = [], []
    ids = [o.id for o in extraction.observations]
    for obs in extraction.observations:
        local = []
        gaps = []
        rate_only = obs.value_kind == "reported_percentage"
        if ids.count(obs.id) != 1:
            local.append(finding("DUPLICATE_OBSERVATION", obs.id))
        for name in type(obs.fields).model_fields:
            value = getattr(obs.fields, name)
            if value.value is None:
                if value.span_id is not None or value.quote is not None:
                    local.append(finding("INCONSISTENT_MISSING_CITATION", obs.id, name))
                if name == "reported_rate" and not rate_only:
                    continue
                if name == "events" and rate_only:
                    continue
                target = (
                    gaps
                    if rate_only
                    and name not in ("asset", "indication", "study", "metric", "reported_rate")
                    else local
                )
                target.append(finding("MISSING_FIELD", obs.id, name))
                continue
            span = spans.get(value.span_id)
            if span is None or not value.quote or value.quote not in span.text:
                local.append(finding("QUOTE_NOT_IN_SOURCE", obs.id, name))
            elif not re.search(r"(?<!\w)" + re.escape(value.value) + r"(?!\w)", value.quote):
                local.append(finding("VALUE_NOT_IN_QUOTE", obs.id, name))
        for name in ("asset", "indication", "study"):
            if getattr(obs.fields, name).value != getattr(data, name):
                local.append(finding("CONTEXT_MISMATCH", obs.id, name))
        if (
            metric_identity(
                obs.fields.metric.value, obs.fields.definition.value, obs.fields.definition.quote
            )
            is None
        ):
            local.append(finding("UNSUPPORTED_METRIC", obs.id, "metric"))
        counts = [obs.fields.events.value, obs.fields.denominator.value]
        if rate_only:
            if obs.fields.events.value is not None:
                local.append(finding("COUNT_IN_REPORTED_RATE", obs.id, "events"))
            gaps.append(
                finding(
                    "REPORTED_RATE_ONLY",
                    obs.id,
                    detail="No event count may be reconstructed from a reported rate.",
                )
            )
            n = obs.fields.denominator
            if n.value is not None and (not count_token(n.value, n.quote) or int(n.value) <= 0):
                local.append(finding("INVALID_DENOMINATOR", obs.id, "denominator"))
        elif any(v is None or re.fullmatch(r"[0-9]{1,7}", v) is None for v in counts):
            local.append(finding("INVALID_COUNT", obs.id))
        elif not 0 <= int(counts[0]) <= int(counts[1]) or int(counts[1]) == 0:
            local.append(finding("INVALID_DENOMINATOR", obs.id))
        elif any(
            not count_token(getattr(obs.fields, name).value, getattr(obs.fields, name).quote)
            for name in ("events", "denominator")
        ):
            local.append(finding("COUNT_ROLE_UNSUPPORTED", obs.id))
        rate = obs.fields.reported_rate
        if rate.value is not None:
            if percentage(rate.value) is None:
                local.append(finding("INVALID_REPORTED_PERCENTAGE", obs.id, "reported_rate"))
            else:
                if (
                    not rate_only
                    and all(v is not None for v in counts)
                    and not (rate_count_consistent(rate.value, *counts))
                ):
                    local.append(finding("RATE_COUNT_MISMATCH", obs.id))
                binding = reported_rate_binding(obs.fields, spans)
                if binding == "MISMATCH":
                    local.append(finding("RATE_POPULATION_MISMATCH", obs.id))
                elif binding == "UNVERIFIED":
                    gaps.append(finding("RATE_BINDING_UNVERIFIED", obs.id))
        issues.extend(gaps)
        if local:
            issues.extend(local)
        else:
            accepted.append(obs)
    if not extraction.observations:
        issues.append(finding("NO_OBSERVATIONS", detail="No supported structured observations."))

    # Repeated rows remain conflicts, never pooled or silently deduplicated.
    def group_key(o):
        f = o.fields
        return (
            f.dose.value,
            metric_identity(f.metric.value, f.definition.value, f.definition.quote),
            f.cohort.value,
            f.population.value,
            f.window.value,
        )

    keys = [group_key(o) for o in accepted]
    duplicates = {k for k in keys if keys.count(k) > 1}
    if duplicates:
        for o in accepted:
            if group_key(o) in duplicates:
                issues.append(finding("DUPLICATE_DOSE_METRIC", o.id))
        accepted = [o for o in accepted if group_key(o) not in duplicates]
    doses = {o.fields.dose.value for o in accepted if o.fields.dose.value is not None}
    if len(doses) < 2:
        issues.append(finding("SECOND_DOSE_MISSING"))
    for dose in sorted(doses):
        for metric in ("response", "adverse_event"):
            if not any(
                o.fields.dose.value == dose
                and metric_identity(
                    o.fields.metric.value, o.fields.definition.value, o.fields.definition.quote
                )[0]
                == metric
                for o in accepted
            ):
                issues.append(finding("ENDPOINT_MISSING", detail=f"{dose}: {metric}"))
    for metric in ("response", "adverse_event"):
        rows = [
            o
            for o in accepted
            if metric_identity(
                o.fields.metric.value, o.fields.definition.value, o.fields.definition.quote
            )[0]
            == metric
        ]
        if (
            len(
                {
                    metric_identity(
                        o.fields.metric.value, o.fields.definition.value, o.fields.definition.quote
                    )[1]
                    for o in rows
                }
            )
            > 1
        ):
            issues.append(finding("ENDPOINT_SUBTYPE_MISMATCH", detail=metric))
        for field in ("cohort", "population", "window", "definition"):
            if len({getattr(o.fields, field).value for o in rows}) > 1:
                issues.append(finding("COMPARISON_CONTEXT_MISMATCH", field=field, detail=metric))
    return accepted, issues


def critique_findings(data: AgentInput, extraction: Extraction, critique: Critique):
    ids = {o.id for o in extraction.observations}
    spans = {s.id for s in data.spans}
    issues = []
    for concern in critique.concerns:
        if not set(concern.observation_ids) <= ids or not set(concern.span_ids) <= spans:
            issues.append(finding("INVALID_CRITIQUE_REFERENCE"))
        elif concern.scope == "comparison_limitation":
            # A comparison gap does not invalidate a correctly quoted observation.
            # The complete references remain in the critique audit record.
            issues.append(finding("MODEL_COMPARISON_LIMITATION", detail=concern.reason))
        else:
            for oid in concern.observation_ids:
                issues.append(finding("MODEL_CONCERN", oid, detail=concern.reason))
    return issues
