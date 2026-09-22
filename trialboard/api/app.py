"""Synchronous bounded calculations run in FastAPI's worker thread pool."""

import logging
from datetime import UTC, datetime
from pathlib import Path
from threading import BoundedSemaphore
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
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


def create_app(
    *,
    enable_designs: bool = False,
    enable_agent_demo: bool = False,
    enable_pdf_agent: bool = False,
    enable_evidence_scout: bool = False,
    agent_provider: str = "dacon",
    evidence_db: Path = Path("output/evidence/trialboard.sqlite3"),
) -> FastAPI:
    from trialboard.agent.runtime import runtime_metadata, runtime_provider

    metadata = runtime_metadata(agent_provider)
    provider_factory = lambda: runtime_provider(agent_provider)  # noqa: E731
    app = FastAPI(
        title="TrialBoard local review API",
        version="0.1.0",
        description=(
            "로컬 개발 API. 기본값은 합성 자료 전용. 명시적으로 활성화한 설계 경로만 "
            "공개·사용 허가된 PDF를 메모리에서 처리. 기본 경로는 LLM·영구 저장 없음. "
            "별도 opt-in 에이전트는 설정된 대회 API 또는 명시적으로 선택한 Codex로 실행. "
            "입력 확률은 근거에서 추정하지 않은 사용자의 가정입니다."
        ),
    )
    slots = BoundedSemaphore(MAX_CONCURRENT_RUNS)
    model_slot = BoundedSemaphore(1)

    @app.get("/api/design-proposals/capabilities")
    async def proposal_capabilities() -> dict:
        return {
            "enabled": enable_designs and enable_pdf_agent,
            "persisted": False,
            "max_calls": 1,
            "transport": "LOOPBACK_ONLY",
            "clinical_approval": False,
            **metadata,
        }

    if enable_designs and enable_pdf_agent:
        from trialboard.api.proposals import proposal_router

        app.include_router(proposal_router(model_slot, provider_factory))

    @app.get("/api/evidence-scout/capabilities")
    async def scout_capabilities() -> dict:
        return {
            "enabled": enable_evidence_scout,
            "persisted": enable_evidence_scout,
            "source": "ClinicalTrials.gov API v2",
            "limit": 20,
            "model_calls": 0,
        }

    if enable_evidence_scout:
        from trialboard.api.projects import project_router
        from trialboard.api.research import research_router
        from trialboard.api.scout import scout_router

        app.include_router(scout_router(evidence_db))
        app.include_router(research_router(evidence_db, model_slot, provider_factory))
        app.include_router(project_router(evidence_db))
        if enable_designs:
            from trialboard.api.exploration import exploration_router

            app.include_router(exploration_router(evidence_db, slots))
        if enable_pdf_agent:
            from trialboard.api.automation import automation_router

            app.include_router(automation_router(evidence_db, model_slot, provider_factory))

    @app.get("/api/agent-demo/capabilities")
    async def agent_capabilities() -> dict:
        from trialboard.api.agent_demo import CASE_LIMITS

        return {
            "enabled": enable_agent_demo,
            "persisted": False,
            "cases": ["public", "synthetic"],
            "transport": "LOOPBACK_ONLY",
            "max_calls": 4,
            "max_seconds": 120,
            "concurrent_runs": 1,
            **metadata,
            "clinical_approval": False,
            "case_limits": CASE_LIMITS,
            "pdf_enabled": enable_pdf_agent,
            "automation_enabled": enable_pdf_agent and enable_evidence_scout,
            "exploration_enabled": enable_designs and enable_evidence_scout,
        }

    if enable_agent_demo or enable_pdf_agent:
        from trialboard.api.agent_demo import demo_router

        app.include_router(
            demo_router(
                enable_pdf=enable_pdf_agent,
                enable_fixed=enable_agent_demo,
                model_slot=model_slot,
                provider_factory=provider_factory,
            )
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Do not echo raw values (including NaN or private text) or exception context.
        fields = [{"path": list(e["loc"]), "type": e["type"]} for e in exc.errors()[:20]]
        return JSONResponse({"error": {"code": "INVALID_INPUT", "fields": fields}}, status_code=422)

    @app.get("/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "evidence_mode": "LOCAL_PDF_OPT_IN" if enable_designs else "SYNTHETIC_ONLY",
            "persisted": enable_evidence_scout,
        }

    @app.get("/api/design-comparisons/capabilities")
    async def design_capabilities() -> dict:
        return {
            "enabled": enable_designs,
            "persisted": False,
            "model_calls": 0,
            "transport": "LOOPBACK_ONLY",
            "clinical_approval": False,
        }

    if enable_designs:
        from trialboard.api.designs import DESIGN_BODY_BYTES, execute_design

        def calculate_design(raw: bytes):
            if not slots.acquire(blocking=False):
                return JSONResponse({"error": {"code": "RUN_CAPACITY_REACHED"}}, status_code=429)
            try:
                return execute_design(raw)
            except (ValueError, TypeError, AttributeError):
                return JSONResponse({"error": {"code": "DESIGN_INPUT_MISMATCH"}}, status_code=422)
            except Exception:
                # No submitted values, exception text, or model calls in this path.
                return JSONResponse({"error": {"code": "DESIGN_EXECUTION_FAILED"}}, status_code=500)
            finally:
                slots.release()

        @app.post("/api/design-comparisons")
        async def design_comparison(request: Request):
            return await run_in_threadpool(calculate_design, await request.body())

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
    from trialboard.api.projects import PROJECT_BODY_BYTES

    app.add_middleware(
        LocalBoundary,
        design_body_bytes=DESIGN_BODY_BYTES if enable_designs else None,
        project_body_bytes=PROJECT_BODY_BYTES if enable_evidence_scout else None,
    )
    # Host check is outermost, before same-origin comparison (DNS rebinding defense).
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])
    return app


app = create_app()
