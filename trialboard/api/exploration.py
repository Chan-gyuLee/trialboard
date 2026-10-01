"""Bounded, opt-in local synthetic exploration; no model or external requests."""

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from trialboard.api.boundary import DEV_ORIGINS
from trialboard.research.exploration import ExplorationStore
from trialboard.research.source_policy import require_content


def exploration_router(path, slots):
    store = ExplorationStore(path)
    def content_gate(run_id: str):
        require_content(path, run_id)

    router = APIRouter(prefix="/api/research/runs", dependencies=[Depends(content_gate)])

    @router.get("/{run_id}/exploration")
    async def read(run_id: str):
        if not store.get_run(run_id):
            raise HTTPException(404, "RESEARCH_NOT_FOUND")
        try:
            return store.get(run_id)
        except ValueError:
            raise HTTPException(409, "EXPLORATION_INTEGRITY") from None

    def calculate(run_id):
        if not slots.acquire(blocking=False):
            raise HTTPException(429, "LOCAL_COMPUTE_BUSY")
        try:
            return store.create(run_id)
        except ValueError:
            raise HTTPException(409, "EXPLORATION_NOT_READY") from None
        finally:
            slots.release()

    @router.post("/{run_id}/exploration")
    async def create(run_id: str, request: Request):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        try:
            body = await request.json()
            if (
                not isinstance(body, dict)
                or set(body) != {"consent"}
                or body["consent"] is not True
            ):
                raise ValueError("CONSENT_REQUIRED")
        except (ValueError, TypeError):
            raise HTTPException(422, "EXPLORATION_CONSENT_REQUIRED") from None
        return await run_in_threadpool(calculate, run_id)

    return router
