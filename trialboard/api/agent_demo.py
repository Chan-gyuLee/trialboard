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
from trialboard.api.model_policy import (
    GatedProvider,
    IdentityGatedProvider,
    ModelPolicyDenied,
    ProjectModelBinding,
    team_model_gate,
)
from trialboard.api.models import MAX_BODY_BYTES
from trialboard.api.team_auth import TeamIdentity, current_access_scope

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
    public_authorized_non_sensitive: Literal[True] | None = None
    model_binding: ProjectModelBinding | None = None

    @field_validator("consent", mode="before")
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError("EXPLICIT_CONSENT_REQUIRED")
        return value

    @field_validator("public_authorized_non_sensitive", mode="before")
    @classmethod
    def explicit_public_authorization(cls, value):
        if value is not None and value is not True:
            raise ValueError("EXPLICIT_PUBLIC_AUTHORIZATION_REQUIRED")
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
    restricted_source: Callable[[str], bool] | None = None,
    identity: TeamIdentity | None = None,
    data_path=None,
) -> APIRouter:
    router = APIRouter()
    running = False
    slot = model_slot or BoundedSemaphore(1)

    async def execute(payload: DemoRequest, request: Request):
        if identity is not None and payload.case == "public":
            return JSONResponse(
                {"error": {"code": "MODEL_PROJECT_BINDING_REQUIRED"}}, status_code=403
            )
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
            digest = payload.input.spans[0].source_digest
            if restricted_source is not None and restricted_source(digest):
                return JSONResponse(
                    {"error": {"code": "PRIVATE_PROJECT_DERIVED_ACTIONS_DISABLED"}}, 403
                )
            try:
                gate = team_model_gate(
                    identity=identity,
                    data_path=data_path,
                    access=current_access_scope(),
                    binding=payload.model_binding,
                    purpose="pdf_agent",
                    input_data=payload.input,
                )
                if identity is not None and payload.public_authorized_non_sensitive is not True:
                    raise ModelPolicyDenied("PUBLIC_NONSENSITIVE_ATTESTATION_REQUIRED")
            except ModelPolicyDenied as error:
                return JSONResponse({"error": {"code": str(error)}}, status_code=403)
            return await execute_data(
                payload.input,
                request,
                "pdf",
                {"max_calls": 4, "max_repairs": 1},
                gate=gate,
            )

    async def execute_data(
        data: AgentInput, request: Request, case: str, case_limits: dict, *, gate=None
    ):
        nonlocal running
        # Require explicit browser Origin even for local callers; no cross-site form trigger.
        if request.headers.get("origin") not in DEV_ORIGINS:
            return JSONResponse({"error": {"code": "LOCAL_BROWSER_ORIGIN_REQUIRED"}}, 403)
        access = current_access_scope()
        if identity is not None and (access is None or identity.revalidate(access) is None):
            return JSONResponse({"error": {"code": "MODEL_IDENTITY_INVALIDATED"}}, 403)
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
                if gate is not None:
                    provider = GatedProvider(provider, gate)
                elif identity is not None and access is not None:
                    provider = IdentityGatedProvider(provider, identity, access)
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
