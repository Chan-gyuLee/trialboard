"""Opt-in loopback design calculation. No models, subprocesses or file persistence."""

import base64
import binascii
import json

from pydantic import Field

from trialboard.agent.design_compare import DesignBrief, compare_designs
from trialboard.agent.models import Contract, Text
from trialboard.agent.revalidate import JSON_LIMIT, PDF_LIMIT, read_json

# Per-route budget; the existing synthetic endpoint retains its smaller limit.
DESIGN_BODY_BYTES = 24 * 1024 * 1024


class Context(Contract):
    asset: Text
    indication: Text
    study: Text
    question: Text


class DesignExecution(Contract):
    brief: DesignBrief
    review_json: str = Field(min_length=2, max_length=JSON_LIMIT)
    source_json: str = Field(min_length=2, max_length=JSON_LIMIT)
    pdf_base64: str = Field(min_length=8, max_length=((PDF_LIMIT + 2) // 3) * 4)
    agent_json: str | None = Field(default=None, min_length=2, max_length=JSON_LIMIT)
    ai_json: str | None = Field(default=None, min_length=2, max_length=JSON_LIMIT)
    context: Context | None = None


def execute_design(raw: bytes):
    # The ASGI boundary bounds bytes before parsing. Reuse the duplicate-key,
    # depth, finite-number and surrogate checks on the decoded envelope.
    if len(raw) > DESIGN_BODY_BYTES:
        raise ValueError("DESIGN_BODY_TOO_LARGE")
    # Nested payloads are JSON strings with individual 8 MiB parser budgets.
    # Permit the larger outer transport only; never increase other file limits.
    data = read_json(raw, limit=DESIGN_BODY_BYTES)
    payload = DesignExecution.model_validate(data)
    try:
        pdf = base64.b64decode(payload.pdf_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("INVALID_PDF_ENCODING") from exc
    if len(pdf) > PDF_LIMIT:
        raise ValueError("PDF_TOO_LARGE")
    return compare_designs(
        json.dumps(payload.brief.model_dump(), ensure_ascii=False).encode(),
        payload.review_json.encode(),
        payload.source_json.encode(),
        pdf,
        agent_raw=payload.agent_json.encode() if payload.agent_json is not None else None,
        ai_raw=payload.ai_json.encode() if payload.ai_json is not None else None,
        context=payload.context.model_dump() if payload.context else None,
    )
