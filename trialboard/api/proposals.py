"""Opt-in local, consent-gated proposal stream. No uploads or model keys persisted."""

import asyncio
import base64
import json
from typing import Literal

from anyio import CancelScope
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field, field_validator

from trialboard.agent.design_proposal import ProposalConstraints, propose_design
from trialboard.agent.models import Contract
from trialboard.agent.revalidate import JSON_LIMIT, PDF_LIMIT, read_json
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.api.designs import DESIGN_BODY_BYTES, Context


class ProposalRequest(Contract):
    consent: Literal[True]
    constraints: ProposalConstraints
    review_json: str = Field(min_length=2, max_length=JSON_LIMIT)
    source_json: str = Field(min_length=2, max_length=JSON_LIMIT)
    pdf_base64: str = Field(min_length=8, max_length=((PDF_LIMIT + 2) // 3) * 4)
    agent_json: str | None = Field(default=None, min_length=2, max_length=JSON_LIMIT)
    context: Context | None = None

    @field_validator("consent", mode="before")
    @classmethod
    def explicit(cls, value):
        if value is not True:
            raise ValueError("EXPLICIT_CONSENT_REQUIRED")
        return value


def proposal_router(slot, provider_factory):
    router = APIRouter()

    @router.post("/api/design-proposals")
    async def run(request: Request):
        if request.headers.get("origin") not in DEV_ORIGINS:
            return JSONResponse({"error": {"code": "LOCAL_BROWSER_ORIGIN_REQUIRED"}}, 403)
        try:
            payload = ProposalRequest.model_validate(
                read_json(await request.body(), limit=DESIGN_BODY_BYTES)
            )
            pdf = base64.b64decode(payload.pdf_base64, validate=True)
            if len(pdf) > PDF_LIMIT:
                raise ValueError("PDF_TOO_LARGE")
        except (ValueError, TypeError):
            return JSONResponse({"error": {"code": "INVALID_PROPOSAL_INPUT"}}, 422)
        if not slot.acquire(blocking=False):
            return JSONResponse({"error": {"code": "MODEL_BUSY"}}, 429)

        queue = asyncio.Queue(maxsize=16)

        async def worker():
            try:
                result = await propose_design(
                    payload.review_json.encode(),
                    payload.source_json.encode(),
                    pdf,
                    provider_factory(),
                    constraints=payload.constraints,
                    agent_raw=payload.agent_json.encode() if payload.agent_json else None,
                    context=payload.context.model_dump() if payload.context else None,
                    on_progress=lambda stage: queue.put_nowait(
                        {"type": "progress", "stage": stage}
                    ),
                )
                queue.put_nowait({"type": "result", "result": result})
            except asyncio.CancelledError:
                raise
            except Exception:
                queue.put_nowait({"type": "error", "code": "PROPOSAL_EXECUTION_FAILED"})

        async def stream():
            task = asyncio.create_task(worker())
            try:
                while True:
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=5)
                    except TimeoutError:
                        yield ": waiting\n\n"
                        continue
                    yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
                    if event["type"] in ("result", "error"):
                        break
            finally:
                task.cancel()
                try:
                    with CancelScope(shield=True):
                        await asyncio.gather(task, return_exceptions=True)
                finally:
                    slot.release()

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
        )

    return router
