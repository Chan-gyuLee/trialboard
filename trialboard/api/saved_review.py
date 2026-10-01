"""TEAM-only saved-source REVIEW once; metadata-only events, separately gated artifacts."""

import asyncio
import json

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from trialboard.agent.provider import ModelError, parse_json
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.api.model_policy import ModelPolicyDenied
from trialboard.api.team_auth import current_access_scope
from trialboard.research.agent import REVIEW_PROMPT
from trialboard.research.citations import resolve_citations
from trialboard.research.model_policy import LazyResearchProvider
from trialboard.research.review_usage import review_usage
from trialboard.research.saved_review import (
    SavedReviewGate,
    SavedReviewRequest,
    attempts,
    persist,
    start_artifact,
    team_database,
    utc_now,
)
from trialboard.research.saved_review_handoff import handoff
from trialboard.research.validation import validate_design_claims


def saved_review_router(path, model_slot, provider_factory, identity):
    router = APIRouter(prefix="/api/research/runs")

    @router.get("/{run_id}/review-usage")
    async def usage(run_id: str):
        return review_usage(path, run_id)

    @router.get("/{run_id}/review-attempts")
    async def history(run_id: str):
        return attempts(path, run_id)

    @router.get("/{run_id}/review-attempts/{attempt_id}")
    async def read(run_id: str, attempt_id: str):
        return attempts(path, run_id, attempt_id)

    @router.get("/{run_id}/review-attempts/{attempt_id}/handoff")
    async def next_context(run_id: str, attempt_id: str):
        return handoff(path, identity, run_id, attempt_id)

    @router.post("/{run_id}/review-saved")
    async def execute(run_id: str, request: Request):
        team_database(path)
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 32768:
                raise HTTPException(422, "SAVED_REVIEW_REQUEST_LIMIT")
        try:
            body = SavedReviewRequest.model_validate(parse_json(bytes(data)))
        except (ValueError, UnicodeDecodeError, ValidationError):
            raise HTTPException(422, "INVALID_SAVED_REVIEW_REQUEST") from None
        gate = SavedReviewGate(path, identity, current_access_scope(), run_id,
                               [b.model_dump() for b in body.source_bindings])
        if not model_slot.acquire(blocking=False):
            raise HTTPException(409, "MODEL_BUSY")
        artifact = start_artifact(gate)
        try:
            persist(gate.database, artifact, 0)
        except Exception:
            model_slot.release()
            raise
        lazy = LazyResearchProvider(provider_factory, gate)
        queue = asyncio.Queue(maxsize=2)

        def event(sequence, kind, message):
            return {"schema": "research-saved-review-event/1", "run_id": run_id,
                    "attempt_id": artifact["attempt_id"], "sequence": sequence,
                    "type": kind, "message": message}

        async def work():
            terminal = dict(artifact)
            try:
                async with asyncio.timeout(180):
                    reply = await lazy.complete(
                        instructions=REVIEW_PROMPT, payload=gate.payload, schema=gate.schema,
                        max_output_tokens=2500,
                    )
                    review, bindings = resolve_citations(reply.value, gate.anchors, gate.sources)
                    if (any(not q.strip() or len(q) > 700 for q in review.questions)
                            or any(not f.interpretation.strip() for f in review.findings)):
                        raise ValueError("SAVED_REVIEW_INVALID_TEXT")
                    review = validate_design_claims(review, gate.sources, gate.context["nct_id"])
                    gate.check(gate.payload)
                    terminal.update(status="COMPLETED", review=review.model_dump(),
                                    citation_bindings=bindings)
            except asyncio.CancelledError:
                terminal.update(status="CANCELLED", error_code="CANCELLED")
            except (ModelError, ModelPolicyDenied) as error:
                policy_error = "POLICY" in str(error) or "IDENTITY" in str(error)
                terminal.update(status="FAILED", error_code=(
                    "MODEL_POLICY_DENIED" if policy_error else "MODEL_FAILED"))
            except Exception:
                terminal.update(status="FAILED", error_code=(
                    "MODEL_RESPONSE_REJECTED" if lazy.last_usage else "MODEL_FAILED"))
            finally:
                terminal.update(completed_at=utc_now(), model_calls=lazy.actual_calls)
                if not lazy.pending_policy:
                    terminal.update(execution_mode=lazy.mode, model=str(lazy.model)[:200])
                if lazy.last_usage:
                    for key, value in lazy.last_usage.items():
                        if key == "response_id":
                            terminal[key] = value[:200] if isinstance(value, str) else None
                        else:
                            terminal[key] = value if type(value) is int and value >= 0 else None
                persist(gate.database, terminal, 1)
                success = terminal["status"] == "COMPLETED"
                await queue.put(event(2, "COMPLETE" if success else "FAILED",
                                      "저장 검토 결과가 준비되었습니다." if success else
                                      "검토를 완료하지 못했습니다. 시도 기록을 확인하세요."))

        async def stream():
            task = None
            try:
                yield "data: " + json.dumps(event(
                    1, "STARTED", "저장 출처 재검토를 예약하고 전송 조건을 확인합니다."
                ), ensure_ascii=False) + "\n\n"
                task = asyncio.create_task(work())
                while True:
                    try:
                        item = await asyncio.wait_for(queue.get(), timeout=5)
                    except TimeoutError:
                        if task.done():
                            break
                        yield ": waiting\n\n"
                        continue
                    yield "data: " + json.dumps(item, ensure_ascii=False) + "\n\n"
                    break
            finally:
                try:
                    if task is None:
                        terminal = {**artifact, "status": "CANCELLED", "completed_at": utc_now(),
                                    "error_code": "CANCELLED"}
                        persist(gate.database, terminal, 1)
                    else:
                        task.cancel()
                        with CancelScope(shield=True):
                            await asyncio.gather(task, return_exceptions=True)
                finally:
                    model_slot.release()

        return StreamingResponse(stream(), media_type="text/event-stream")

    return router
