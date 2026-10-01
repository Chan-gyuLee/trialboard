"""One exact server-prepared PDF review; metadata SSE and separately gated results."""

import asyncio
import json
from uuid import UUID

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from trialboard.agent.provider import ModelError, parse_json
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.api.model_policy import ModelPolicyDenied
from trialboard.api.team_auth import current_access_scope
from trialboard.research import prepared_pdf_review as pdf
from trialboard.research.model_policy import LazyResearchProvider
from trialboard.research.review_usage import review_usage
from trialboard.research.saved_review import team_database, utc_now


def prepared_pdf_review_router(path, model_slot, provider_factory, identity):
    router = APIRouter(prefix="/api/research/runs")

    @router.get("/{run_id}/pdf-review-usage")
    async def usage(run_id: str):
        return review_usage(path, run_id, kind="PDF")

    @router.get("/{run_id}/pdf-review-attempts")
    async def history(run_id: str, preparation_id: str):
        try:
            if str(UUID(preparation_id)) != preparation_id:
                raise ValueError
        except ValueError:
            raise HTTPException(422, "INVALID_PREPARATION_ID") from None
        return pdf.attempts(path, run_id, preparation_id=preparation_id)

    @router.get("/{run_id}/pdf-review-attempts/{attempt_id}")
    async def read(run_id: str, attempt_id: str):
        return pdf.attempts(path, run_id, attempt_id)

    @router.post("/{run_id}/review-prepared-pdf")
    async def execute(run_id: str, request: Request):
        team_database(path)
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 8192:
                raise HTTPException(422, "PDF_REVIEW_REQUEST_LIMIT")
        try:
            body = pdf.PreparedReviewRequest.model_validate(parse_json(bytes(data)))
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(422, "INVALID_PDF_REVIEW_REQUEST") from None
        gate = pdf.PreparedPdfGate(path, identity, current_access_scope(), run_id, body)
        artifact = pdf.start_artifact(gate)
        if not model_slot.acquire(blocking=False):
            raise HTTPException(409, "MODEL_BUSY")
        try:
            pdf.persist(gate.database, artifact, 0)
        except BaseException:
            model_slot.release()
            raise
        lazy = LazyResearchProvider(provider_factory, gate)
        queue = asyncio.Queue(maxsize=1)

        def event(sequence, kind, message):
            return {"schema": "research-pdf-review-event/1", "run_id": run_id,
                    "attempt_id": artifact["attempt_id"], "sequence": sequence,
                    "type": kind, "message": message}

        async def work():
            terminal = dict(artifact)
            try:
                async with asyncio.timeout(180):
                    reply = await lazy.complete(instructions=pdf.PROMPT, payload=gate.payload,
                                                schema=gate.schema, max_output_tokens=2500)
                    review = pdf.resolve_review(reply.value, gate.anchors)
                    gate.check(gate.payload)
                    terminal.update(status="COMPLETED", review=review)
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
                if lazy.actual_calls > 0 and not lazy.pending_policy:
                    terminal.update(execution_mode=lazy.mode, model=str(lazy.model)[:200])
                if lazy.last_usage:
                    for key, value in lazy.last_usage.items():
                        if key == "response_id":
                            terminal[key] = value[:200] if isinstance(value, str) else None
                        else:
                            terminal[key] = value if type(value) is int and (
                                0 <= value <= 9_007_199_254_740_991) else None
                try:
                    pdf.persist(gate.database, terminal, 1)
                except Exception:
                    await queue.put(event(2, "FAILED",
                        "종료 기록을 저장하지 못했습니다. 실행 상태와 사용량은 미확정입니다."))
                else:
                    success = terminal["status"] == "COMPLETED"
                    await queue.put(event(2, "COMPLETE" if success else "FAILED",
                        "PDF 검토 결과가 준비되었습니다." if success else
                        "PDF 검토를 완료하지 못했습니다. 시도 기록을 확인하세요."))

        async def stream():
            task = None
            try:
                yield "data: " + json.dumps(event(1, "STARTED",
                    "PDF 검토를 예약하고 전송 조건을 확인합니다."), ensure_ascii=False) + "\n\n"
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
                        pdf.persist(gate.database, {**artifact, "status": "CANCELLED",
                            "completed_at": utc_now(), "error_code": "CANCELLED"}, 1)
                    else:
                        task.cancel()
                        with CancelScope(shield=True):
                            await asyncio.gather(task, return_exceptions=True)
                finally:
                    model_slot.release()

        return StreamingResponse(stream(), media_type="text/event-stream")

    return router
