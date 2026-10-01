"""Source-bound output schemas and independent validation; never repair model claims."""

import re

from pydantic import ValidationError

from trialboard.agent.provider import ModelError
from trialboard.research.models import ResearchReview, SearchPlan
from trialboard.research.relevance import rank_sources, selection_record

RESEARCH_CONTRACT_VERSION = "source-bound/2"
FOLLOWUP_PATTERN = r"^[A-Za-z0-9 -]{2,80}$"
CONTRARIAN_PATTERN = re.compile(
    r"\b(?:failure|failed|adverse|negative|discontinu(?:ation|ed)|toxicity|"
    r"intolerability|withdrawal|termination)\b",
    re.I,
)


class ResearchValidationError(ValueError):
    def __init__(self, code, field):
        super().__init__(code)
        self.field = field


def source_bound_schema(contract, source_ids):
    """Constrain generation to the same IDs supplied in this individual model call."""
    schema = contract.model_json_schema()
    ids = sorted(set(source_ids))
    if contract is SearchPlan:
        definition, field = "Priority", "priorities"
        term = schema["$defs"]["PlannedFollowup"]["properties"]["term"]
        term.update(
            pattern=FOLLOWUP_PATTERN,
            description="Short English keywords only; no IDs, URLs or query syntax.",
        )
    elif contract is ResearchReview:
        definition, field = "Insight", "findings"
    else:
        raise ValueError("UNSUPPORTED_RESEARCH_CONTRACT")
    if ids:
        schema["$defs"][definition]["properties"]["source_id"]["enum"] = ids
    else:
        # Empty enums are unsupported; there cannot be a cited item without a source.
        schema["properties"][field]["maxItems"] = 0
    return schema


def plan_payload(run):
    """Shared live/probe input; trial context cannot be crowded out by background papers."""
    ordered = rank_sources(run.sources, run.request)[:24]
    return {
        "asset": run.request.asset,
        "nct": run.request.nct_id,
        "indication": run.request.indication,
        "sources": [
            {
                "id": s.id,
                "title": s.title,
                "kind": s.kind,
                "link_basis": s.link_basis,
                "content_level": s.content_level,
                "excerpt": s.text[:650],
            }
            for s in ordered
        ],
        "selection": selection_record(ordered, run.request),
        "coverage": [c.model_dump() for c in run.coverage],
    }


def validate_plan(value, source_ids):
    plan = SearchPlan.model_validate(value)
    if any(p.source_id not in source_ids for p in plan.priorities):
        raise ResearchValidationError("UNKNOWN_PRIORITY_SOURCE", "priorities.source_id")
    if any(
        not re.fullmatch(FOLLOWUP_PATTERN, term)
        or not term.strip()
        or re.search(r"\bNCT\d+\b", term, re.I)
        for item in plan.followups
        for term in [item.term]
    ):
        raise ResearchValidationError("INVALID_FOLLOWUP_TERMS", "followup_terms")
    contrarian = [item for item in plan.followups if CONTRARIAN_PATTERN.search(item.term)]
    if (
        not contrarian
        or plan.followups[0].intent != "CONTRARIAN"
        or any(item.intent != "CONTRARIAN" for item in contrarian)
    ):
        raise ResearchValidationError("INVALID_FOLLOWUP_INTENT", "followups.intent")
    if any(
        item.intent == "CONTRARIAN" and not CONTRARIAN_PATTERN.search(item.term)
        for item in plan.followups
    ):
        raise ResearchValidationError("INVALID_FOLLOWUP_INTENT", "followups.intent")
    return plan


def validate_review(value, texts):
    review = ResearchReview.model_validate(value)
    if any(f.source_id not in texts or f.quote not in texts[f.source_id] for f in review.findings):
        raise ResearchValidationError("UNSUPPORTED_REVIEW_CITATION", "findings.source_id_or_quote")
    return review


def validate_design_claims(review, sources, nct):
    """Narrow contradiction guard, not a comprehensive clinical fact checker."""
    randomized = any(
        s.kind == "REGISTRY"
        and s.identifiers.get("nct") == nct
        and s.identifiers.get("allocation") == "RANDOMIZED"
        for s in sources
    )
    if randomized:
        ids = {s.id for s in sources if s.kind == "REGISTRY" and s.identifiers.get("nct") == nct}
        if any(
            f.source_id in ids
            and re.search(r"비\s*무작위|non[- ]?randomi[sz]ed", f.interpretation, re.I)
            for f in review.findings
        ):
            raise ResearchValidationError(
                "CONTRADICTED_ALLOCATION_CLAIM", "findings.interpretation"
            )
    return review


def research_failure_code(error):
    """Only fixed codes cross the model/transport diagnostic boundary."""
    if isinstance(error, ValidationError):
        return "MODEL_SCHEMA_REJECTED"
    if isinstance(error, ValueError) and str(error) in {
        "UNKNOWN_PRIORITY_SOURCE",
        "INVALID_FOLLOWUP_TERMS",
        "INVALID_FOLLOWUP_INTENT",
        "UNSUPPORTED_REVIEW_CITATION",
        "CONTRADICTED_ALLOCATION_CLAIM",
    }:
        return str(error)
    if isinstance(error, ModelError) and str(error) in {
        "MODEL_IDENTITY_INVALIDATED",
        "MODEL_RESEARCH_EXTERNAL_AI_NOT_ALLOWED",
        "MODEL_RESEARCH_POLICY_CHANGED",
        "MODEL_RESEARCH_VERSION_MISMATCH",
        "MODEL_RESEARCH_BINDING_MISMATCH",
        "MODEL_RESEARCH_PAYLOAD_MISMATCH",
        "MODEL_RESEARCH_PAYLOAD_LIMIT",
        "MODEL_RESEARCH_POLICY_UNAVAILABLE",
        "MODEL_RESEARCH_NOT_FOUND",
        "DACON_AUTH_FAILED",
        "DACON_REQUEST_REJECTED",
        "DACON_MODEL_OR_ENDPOINT_UNAVAILABLE",
        "DACON_RATE_LIMITED",
        "DACON_QUOTA_EXHAUSTED",
        "DACON_HTTP_ERROR",
        "MODEL_REQUEST_TOO_LARGE",
        "MODEL_RESPONSE_TOO_LARGE",
        "MODEL_INCOMPLETE",
        "MODEL_REFUSAL",
        "MODEL_OUTPUT_INVALID",
        "MODEL_TIMEOUT",
        "MODEL_RESPONSE_INVALID",
    }:
        return str(error)
    if isinstance(error, TimeoutError):
        return "MODEL_TIMEOUT"
    return "MODEL_CALL_OR_RESPONSE_FAILED"


def validation_details(error):
    """Safe field names/error types only; never values, exception messages or extra keys."""
    if isinstance(error, ResearchValidationError):
        fields = {
            "priorities.source_id",
            "followup_terms",
            "followups.intent",
            "findings.source_id_or_quote",
            "findings.anchor_id",
        }
        return [
            {"field": error.field if error.field in fields else "response", "type": "constraint"}
        ]
    if not isinstance(error, ValidationError):
        return []
    names = {
        "followup_terms",
        "followups",
        "term",
        "intent",
        "priorities",
        "missing_evidence",
        "source_id",
        "anchor_id",
        "reason",
        "findings",
        "quote",
        "interpretation",
        "questions",
        "conclusion",
    }
    types = {
        "missing",
        "extra_forbidden",
        "too_long",
        "too_short",
        "string_too_long",
        "string_too_short",
        "string_pattern_mismatch",
        "literal_error",
        "string_type",
        "list_type",
        "model_type",
        "dict_type",
    }
    return [
        {
            "field": ".".join(
                str(part)
                if type(part) is int and 0 <= part <= 100
                else part
                if type(part) is str and part in names
                else "unknown_field"
                for part in issue["loc"][:4]
            )
            or "response",
            "type": issue["type"] if issue["type"] in types else "schema_constraint",
        }
        for issue in error.errors(include_url=False, include_context=False, include_input=False)[:8]
    ]
