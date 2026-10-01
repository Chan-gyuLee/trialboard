"""Opt-in local, consent-gated proposal stream. No uploads or model keys persisted."""

import asyncio
import base64
import hashlib
import json
from collections.abc import Callable
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
from trialboard.api.model_policy import (
    GatedProvider,
    ModelPolicyDenied,
    ProjectModelBinding,
    team_model_gate,
)
from trialboard.api.team_auth import TeamIdentity, current_access_scope


class ProposalRequest(Contract):
    consent: Literal[True]
    constraints: ProposalConstraints
    review_json: str = Field(min_length=2, max_length=JSON_LIMIT)
    source_json: str = Field(min_length=2, max_length=JSON_LIMIT)
    pdf_base64: str = Field(min_length=8, max_length=((PDF_LIMIT + 2) // 3) * 4)
    agent_json: str | None = Field(default=None, min_length=2, max_length=JSON_LIMIT)
    context: Context | None = None
    public_authorized_non_sensitive: Literal[True] | None = None
    model_binding: ProjectModelBinding | None = None

    @field_validator("consent", mode="before")
    @classmethod
    def explicit(cls, value):
        if value is not True:
            raise ValueError("EXPLICIT_CONSENT_REQUIRED")
        return value

    @field_validator("public_authorized_non_sensitive", mode="before")
    @classmethod
    def explicit_public_authorization(cls, value):
        if value is not None and value is not True:
            raise ValueError("EXPLICIT_PUBLIC_AUTHORIZATION_REQUIRED")
        return value


def proposal_router(
    slot,
    provider_factory,
    restricted_source: Callable[[str], bool] | None = None,
    *,
    identity: TeamIdentity | None = None,
    data_path=None,
):
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
        actual_pdf_digest = hashlib.sha256(pdf).hexdigest()
        if restricted_source is not None and restricted_source(actual_pdf_digest):
            return JSONResponse(
                {"error": {"code": "PRIVATE_PROJECT_DERIVED_ACTIONS_DISABLED"}}, 403
            )
        try:
            if (
                identity is not None
                and payload.model_binding is not None
                and payload.model_binding.pdf_digest != actual_pdf_digest
            ):
                raise ModelPolicyDenied("MODEL_PROJECT_BINDING_MISMATCH")
            gate = team_model_gate(
                identity=identity,
                data_path=data_path,
                access=current_access_scope(),
                binding=payload.model_binding,
                purpose="design_proposal",
            )
            if identity is not None and payload.public_authorized_non_sensitive is not True:
                raise ModelPolicyDenied("PUBLIC_NONSENSITIVE_ATTESTATION_REQUIRED")
        except ModelPolicyDenied as error:
            return JSONResponse({"error": {"code": str(error)}}, 403)
        if not slot.acquire(blocking=False):
            return JSONResponse({"error": {"code": "MODEL_BUSY"}}, 429)

        queue = asyncio.Queue(maxsize=16)

        async def worker():
            try:
                provider = provider_factory()
                if gate is not None:
                    provider = GatedProvider(provider, gate)
                result = await propose_design(
                    payload.review_json.encode(),
                    payload.source_json.encode(),
                    pdf,
                    provider,
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
