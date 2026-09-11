"""Synchronous bounded calculations run in FastAPI's worker thread pool."""

import logging
from datetime import UTC, datetime
from threading import BoundedSemaphore
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from trialboard.api.boundary import DEV_ORIGINS, LocalBoundary
from trialboard.api.models import (
    ARMS,
    MAX_BODY_BYTES,
    MAX_CONCURRENT_RUNS,
    MAX_REPETITIONS,
    MAX_SCENARIOS,
    MAX_WORK_UNITS,
    ExecutionInput,
    ExecutionOutput,
)
from trialboard.review.engine import run_review
from trialboard.review.example import make_example
from trialboard.review.report import to_markdown

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(
        title="TrialBoard local synthetic review API",
        version="0.1.0",
        description=(
            "합성 자료 전용 로컬 개발 API. 임상 권고·LLM·실제 자료 업로드·영구 저장 없음. "
            "입력 확률은 근거에서 추정하지 않은 사용자의 가정입니다."
        ),
    )
    slots = BoundedSemaphore(MAX_CONCURRENT_RUNS)

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Do not echo raw values (including NaN or private text) or exception context.
        fields = [{"path": list(e["loc"]), "type": e["type"]} for e in exc.errors()[:20]]
        return JSONResponse({"error": {"code": "INVALID_INPUT", "fields": fields}}, status_code=422)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "evidence_mode": "SYNTHETIC_ONLY", "persisted": False}

    @app.get("/api/reviews/defaults")
    async def defaults() -> dict:
        return {
            "input": ExecutionInput().model_dump(mode="json"),
            "arms": ARMS,
            "modes": ["normal", "denominator-error", "missing-evidence"],
            "limits": {
                "body_bytes": MAX_BODY_BYTES,
                "scenarios": MAX_SCENARIOS,
                "repetitions": {"min": 100, "max": MAX_REPETITIONS},
                "per_arm": {"min": 2, "max": 500, "count": 2, "ascending": True},
                "work_units": MAX_WORK_UNITS,
                "work_unit_formula": "repetitions * 2 arms * scenario_count * 2 designs",
                "concurrent_runs_per_process": MAX_CONCURRENT_RUNS,
            },
            "notice": "합성 가정 탐색이며 실제 약물의 추정치·임상 권고·AI 판단이 아닙니다.",
        }

    @app.post("/api/reviews", response_model=ExecutionOutput)
    def execute(payload: ExecutionInput) -> ExecutionOutput | JSONResponse:
        if not slots.acquire(blocking=False):
            return JSONResponse(
                {"error": {"code": "RUN_CAPACITY_REACHED"}},
                status_code=429,
                headers={"Retry-After": "1"},
            )
        execution_id = uuid4()
        started_at = datetime.now(UTC)
        start = perf_counter()
        try:
            evidence = make_example(payload.mode)
            report = run_review(
                evidence,
                tuple(s.to_scenario() for s in payload.scenarios),
                payload.to_designs(),
                seed=payload.seed,
                repetitions=payload.repetitions,
            )
            return ExecutionOutput(
                execution_id=execution_id,
                started_at=started_at,
                elapsed_ms=round((perf_counter() - start) * 1000, 3),
                input=payload,
                evidence_input=evidence,
                report=report,
                markdown=to_markdown(report),
            )
        except Exception as exc:
            # Local prototype: no submitted content or exception text in responses/logs.
            logger.error("Execution %s failed (%s)", execution_id, type(exc).__name__)
            return JSONResponse(
                {"error": {"code": "EXECUTION_FAILED", "execution_id": str(execution_id)}},
                status_code=500,
            )
        finally:
            slots.release()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(DEV_ORIGINS),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.add_middleware(LocalBoundary)
    # Host check is outermost, before same-origin comparison (DNS rebinding defense).
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])
    return app


app = create_app()
