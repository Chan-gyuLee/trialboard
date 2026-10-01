"""Local, consent-bound, one-shot extraction with durable terminal outcomes."""

import asyncio
import json
from threading import BoundedSemaphore
from time import monotonic
from uuid import uuid4

from anyio import CancelScope
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from trialboard.agent.engine import Limits, run_agent
from trialboard.agent.runtime import runtime_provider
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.api.team_auth import TeamDataPath
from trialboard.research.automation import AutomationStore, Preparation, decision_packet
from trialboard.research.pdf_policy import cached as permitted_pdf
from trialboard.research.source_policy import require_content

AUTOMATION_BODY_BYTES = 4_000_000


def automation_router(path, model_slot: BoundedSemaphore, provider_factory=runtime_provider):
    def content_gate(run_id: str):
        require_content(path, run_id)

    router = APIRouter(prefix="/api/research/runs", dependencies=[Depends(content_gate)])
    store = AutomationStore(path)
    if not isinstance(path, TeamDataPath):
        store.interrupt_stale()

    def origin(request):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")

    @router.get("/{run_id}/automation")
    async def read(run_id: str):
        if not store.get_run(run_id):
            raise HTTPException(404, "RESEARCH_NOT_FOUND")
        value = store.get(run_id)
        if isinstance(path, TeamDataPath) and value:
            try:
                doc = value["document"]
                permitted_pdf(path, run_id, doc["sourceId"], doc["source"]["sha256"])
            except (KeyError, TypeError):
                raise HTTPException(409, "AUTOMATION_PDF_BINDING_REQUIRED") from None
        return value

    @router.post("/{run_id}/automation")
    async def prepare(run_id: str, request: Request):
        origin(request)
        try:
            body = await request.json()
            if (
                not isinstance(body, dict)
                or set(body) != {"document", "consent"}
                or body["consent"] is not True
            ):
                raise ValueError("CONSENT_REQUIRED")
            prepared = Preparation.model_validate(body["document"])
            if isinstance(path, TeamDataPath):
                permitted_pdf(path, run_id, prepared.sourceId, prepared.source.sha256)
            return store.prepare(run_id, prepared)
        except (ValueError, TypeError):
            raise HTTPException(422, "INVALID_AUTOMATION_PREPARATION") from None

    @router.post("/{run_id}/automation/run")
    async def execute(run_id: str, request: Request):
        origin(request)
        if isinstance(path, TeamDataPath):
            raise HTTPException(403, {
                "code": "AUTOMATION_PDF_USAGE_POLICY_REQUIRED",
                "message": "PDF 원문과 외부 AI 전송 권리의 별도 연결이 필요합니다. "
                "출처 텍스트 허가는 PDF 허가가 아닙니다. 현재 팀 자동 추출은 차단됩니다.",
            })
        try:
            body = await request.json()
            if body != {"consent": True} or body["consent"] is not True:
                raise ValueError("CONSENT_REQUIRED")
        except (ValueError, TypeError):
            raise HTTPException(422, "AUTOMATION_CONSENT_REQUIRED") from None
        value = store.get(run_id)
        if not value or value["status"] != "PREPARED":
            raise HTTPException(409, "AUTOMATION_ALREADY_STARTED_OR_MISSING")
        if not model_slot.acquire(blocking=False):
            raise HTTPException(429, "MODEL_BUSY")
        try:
            provider = provider_factory()
            if provider.mode not in ("DACON_RESPONSES", "SCRIPTED_TEST_DOUBLE"):
                raise ValueError("DACON_REQUIRED")
            prepared = Preparation.model_validate(value["document"])
            store.transition(run_id, "PREPARED", "RUNNING")
        except Exception:
            model_slot.release()
            raise HTTPException(409, "AUTOMATION_START_REJECTED") from None
        queue = asyncio.Queue(maxsize=64)
        events, started, stream_id = [], monotonic(), str(uuid4())

        def send(kind, **data):
            event = {
                "type": kind,
                "sequence": len(events) + 1,
                "run_id": stream_id,
                "elapsed_ms": round((monotonic() - started) * 1000),
                **data,
            }
            # Final report has a dedicated stored field; don't duplicate it in events.
            events.append({k: v for k, v in event.items() if k != "report"})
            store.transition(run_id, "RUNNING", "RUNNING", events=events)
            queue.put_nowait(event)

        async def work():
            try:
                send("started", case="pdf", execution_mode=provider.mode)
                report = await run_agent(
                    prepared.input,
                    provider,
                    Limits(max_calls=2, max_repairs=0, seconds=120),
                    on_progress=lambda e: send("progress", **e),
                )
                decision = decision_packet(report)
                terminal = (
                    "FAILED"
                    if report.status in ("FAILED", "BUDGET_EXCEEDED")
                    else decision["status"]
                )
                stored_report = report.model_dump(mode="json")
                store.transition(
                    run_id,
                    "RUNNING",
                    terminal,
                    report=stored_report,
                    decision=decision,
                    events=events,
                )
                queue.put_nowait(
                    {
                        "type": "result",
                        "sequence": len(events) + 1,
                        "run_id": stream_id,
                        "elapsed_ms": round((monotonic() - started) * 1000),
                        "report": stored_report,
                    }
                )
            except asyncio.CancelledError:
                if store.get(run_id)["status"] == "RUNNING":
                    store.transition(run_id, "RUNNING", "CANCELLED", events=events)
                raise
            except Exception:
                if store.get(run_id)["status"] == "RUNNING":
                    store.transition(run_id, "RUNNING", "FAILED", events=events)
                queue.put_nowait(
                    {
                        "type": "error",
                        "sequence": len(events) + 1,
                        "run_id": stream_id,
                        "elapsed_ms": round((monotonic() - started) * 1000),
                        "code": "AUTOMATION_EXECUTION_FAILED",
                    }
                )

        async def stream():
            task = asyncio.create_task(work())
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
                with CancelScope(shield=True):
                    await asyncio.gather(task, return_exceptions=True)
                    if store.get(run_id)["status"] == "RUNNING":
                        store.transition(run_id, "RUNNING", "CANCELLED", events=events)
                model_slot.release()

        return StreamingResponse(stream(), media_type="text/event-stream")

    return router
