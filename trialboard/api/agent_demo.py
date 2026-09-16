"""Opt-in single-user agent stream; PDF excerpts require a separate enable flag.

No durable job API, authentication claims, automatic paid retries or fallback models.
Disconnect cancels/reaps the CLI process through the existing adapter; consumed
account usage is not refunded. This router must never be hosted publicly.
"""

import asyncio
import json
from collections.abc import Callable
from threading import BoundedSemaphore
from time import monotonic
from typing import Literal
from uuid import uuid4

from anyio import CancelScope
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, field_validator

from trialboard.agent.engine import Limits, run_agent
from trialboard.agent.example import demo_input
from trialboard.agent.models import AgentInput
from trialboard.agent.provider import Provider
from trialboard.agent.public_case import public_input
from trialboard.agent.revalidate import read_json
from trialboard.agent.runtime import runtime_provider
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.api.models import MAX_BODY_BYTES

CASE_LIMITS = {
    "public": {"max_calls": 2, "max_repairs": 0},
    "synthetic": {"max_calls": 4, "max_repairs": 1},
}


class DemoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    case: Literal["public", "synthetic"]
    consent: Literal[True]

    @field_validator("consent", mode="before")
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError("EXPLICIT_CONSENT_REQUIRED")
        return value


class PdfAgentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    input: AgentInput
    consent: Literal[True]

    @field_validator("consent", mode="before")
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError("EXPLICIT_CONSENT_REQUIRED")
        return value

    @field_validator("input")
    @classmethod
    def pdf_only(cls, value):
        if (
            value.provenance != "user_pdf_export_unverified"
            or len({s.source_digest for s in value.spans}) != 1
        ):
            raise ValueError("SINGLE_PDF_EXCERPTS_REQUIRED")
        if any(s.page is None or s.locator is not None for s in value.spans):
            raise ValueError("PDF_PAGE_REQUIRED")
        return value


def demo_router(
    provider_factory: Callable[[], Provider] = runtime_provider,
    *,
    enable_pdf: bool = False,
    enable_fixed: bool = True,
    model_slot: BoundedSemaphore | None = None,
) -> APIRouter:
    router = APIRouter()
    running = False
    slot = model_slot or BoundedSemaphore(1)

    async def execute(payload: DemoRequest, request: Request):
        return await execute_data(
            public_input() if payload.case == "public" else demo_input(),
            request,
            payload.case,
            CASE_LIMITS[payload.case],
        )

    if enable_fixed:
        router.add_api_route("/api/agent-demo/run", execute, methods=["POST"])

    if enable_pdf:

        @router.post("/api/pdf-agent/run")
        async def execute_pdf(request: Request):
            try:
                payload = PdfAgentRequest.model_validate(
                    read_json(await request.body(), limit=MAX_BODY_BYTES)
                )
            except (ValueError, TypeError):
                return JSONResponse({"error": {"code": "INVALID_PDF_AGENT_INPUT"}}, 422)
            return await execute_data(
                payload.input, request, "pdf", {"max_calls": 4, "max_repairs": 1}
            )

    async def execute_data(data: AgentInput, request: Request, case: str, case_limits: dict):
        nonlocal running
        # Require explicit browser Origin even for local callers; no cross-site form trigger.
        if request.headers.get("origin") not in DEV_ORIGINS:
            return JSONResponse({"error": {"code": "LOCAL_BROWSER_ORIGIN_REQUIRED"}}, 403)
        if running or not slot.acquire(blocking=False):
            return JSONResponse({"error": {"code": "AGENT_DEMO_BUSY"}}, 429)
        running = True  # Atomic in this single-process event loop, before any await.
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=64)
        run_id = str(uuid4())
        start = monotonic()
        sequence = 0

        def send(kind, **data):
            nonlocal sequence
            sequence += 1
            queue.put_nowait(
                {
                    "type": kind,
                    "sequence": sequence,
                    "run_id": run_id,
                    "elapsed_ms": round((monotonic() - start) * 1000),
                    **data,
                }
            )

        async def worker():
            try:
                provider = provider_factory()
                send("started", case=case, execution_mode=provider.mode)
                report = await run_agent(
                    data,
                    provider,
                    # The public excerpt deliberately lacks a second dose: another
                    # extraction cannot create new evidence. Hand off after critique.
                    Limits(
                        **case_limits,
                        seconds=120,
                    ),
                    on_progress=lambda event: send("progress", **event),
                )
                send("result", report=report.model_dump(mode="json"))
            except asyncio.CancelledError:
                raise
            except Exception:
                # Exceptions can include subprocess diagnostics: never echo them.
                send("error", code="AGENT_DEMO_EXECUTION_FAILED")

        async def stream():
            nonlocal running
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
                    # StreamingResponse's disconnect cancel scope must not interrupt
                    # CLI cleanup or leave the single-run slot permanently occupied.
                    with CancelScope(shield=True):
                        await asyncio.gather(task, return_exceptions=True)
                finally:
                    running = False
                    slot.release()

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
        )

    return router
