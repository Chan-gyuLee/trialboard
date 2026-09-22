"""Local research jobs persist every event; secrets and arbitrary URLs never enter requests."""

import asyncio
import hashlib
import json
import re
from pathlib import Path
from threading import BoundedSemaphore
from time import monotonic

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from trialboard.agent.runtime import runtime_provider
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.research.agent import run_research
from trialboard.research.collect import download_pdf
from trialboard.research.models import CurationInput, ResearchRequest
from trialboard.research.store import ResearchStore


def research_router(
    path: Path,
    model_slot: BoundedSemaphore,
    provider_factory=runtime_provider,
):
    router = APIRouter(prefix="/api/research")
    store = ResearchStore(path)
    running = False
    pdf_slot = BoundedSemaphore(1)

    @router.get("/runs")
    async def history():
        return await asyncio.to_thread(store.list_runs)

    @router.get("/runs/{run_id}")
    async def read(run_id: str):
        run = await asyncio.to_thread(store.get_run, run_id)
        if not run:
            raise HTTPException(404, "RESEARCH_NOT_FOUND")
        return {"collection": run.model_dump(), "changes": store.previous_changes(run)}

    @router.get("/runs/{run_id}/search")
    async def local_search(run_id: str, q: str = ""):
        if len(q) > 150:
            raise HTTPException(422, "SEARCH_QUERY_TOO_LONG")
        if not store.get_run(run_id):
            raise HTTPException(404, "RESEARCH_NOT_FOUND")
        return store.search_sources(run_id, q)

    @router.get("/runs/{run_id}/result-tables")
    async def result_tables(run_id: str):
        from trialboard.research.result_tables import registry_results

        if not store.get_run(run_id):
            raise HTTPException(404, "RESEARCH_NOT_FOUND")
        try:
            return registry_results(store, run_id)
        except (ValueError, TypeError, KeyError):
            raise HTTPException(422, "REGISTRY_RESULTS_UNAVAILABLE") from None

    @router.post("/runs/{run_id}/recover")
    async def recover(run_id: str, request: Request):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        if running:
            raise HTTPException(409, "RESEARCH_BUSY")
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(422, "RECOVERY_CONSENT_REQUIRED") from None
        if not isinstance(body, dict) or body != {"consent": True} or body["consent"] is not True:
            raise HTTPException(422, "RECOVERY_CONSENT_REQUIRED")
        try:
            run = store.recover_run(run_id)
        except ValueError as error:
            code = str(error)
            raise HTTPException(404 if code == "RESEARCH_NOT_FOUND" else 409, code) from None
        return {"collection": run.model_dump(), "changes": store.previous_changes(run)}

    @router.get("/runs/{run_id}/curation")
    async def notes(run_id: str, source_id: str | None = None):
        if not store.get_run(run_id):
            raise HTTPException(404, "RESEARCH_NOT_FOUND")
        return store.curation(run_id, source_id)

    @router.post("/runs/{run_id}/curation")
    async def curate(run_id: str, body: CurationInput, request: Request):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        try:
            return store.curate(run_id, body)
        except ValueError as error:
            if str(error) == "CURATION_VERSION_CONFLICT":
                raise HTTPException(409, "CURATION_VERSION_CONFLICT") from None
            raise HTTPException(422, "INVALID_CURATION") from None

    @router.post("/run")
    async def execute(body: ResearchRequest, request: Request):
        nonlocal running
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        if running:
            raise HTTPException(409, "RESEARCH_BUSY")
        has_slot = body.model_consent
        if has_slot and not model_slot.acquire(blocking=False):
            raise HTTPException(429, "MODEL_BUSY")
        running = True
        try:
            run = store.start(body)
        except Exception:
            running = False
            if has_slot:
                model_slot.release()
            raise HTTPException(422, "INVALID_SELECTED_CONTEXT") from None
        queue = asyncio.Queue(maxsize=100)
        start = monotonic()

        async def emit(stage, message, **extra):
            event = {
                "run_id": run.id,
                "sequence": len(run.events) + 1,
                "stage": stage,
                "elapsed_ms": round((monotonic() - start) * 1000),
                "message": message,
                **extra,
            }
            run.events.append(event)
            # Short bounded local transactions. Preserve partial findings even after disconnect.
            store.save_run(run)
            await queue.put(event)

        async def work():
            try:
                await emit("STARTED", "공개 근거 수집 작업을 시작했습니다.")
                async with asyncio.timeout(240):
                    await run_research(run, store, emit, provider_factory() if has_slot else None)
            except asyncio.CancelledError:
                if run.status == "RUNNING":
                    run.status = "CANCELLED"
                store.save_run(run)
                raise
            except Exception:
                run.status = "FAILED"
                await emit("ERROR", "수집 작업이 끝나지 않았습니다. 저장된 부분 기록을 확인하세요.")

        async def stream():
            nonlocal running
            task = asyncio.create_task(work())
            try:
                while True:
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=5)
                    except TimeoutError:
                        yield ": waiting\n\n"
                        continue
                    yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
                    if event["stage"] in ("COMPLETE", "ERROR"):
                        break
            finally:
                task.cancel()
                with CancelScope(shield=True):
                    await asyncio.gather(task, return_exceptions=True)
                running = False
                if has_slot:
                    model_slot.release()

        return StreamingResponse(stream(), media_type="text/event-stream")

    @router.get("/runs/{run_id}/documents/{source_id}/cached")
    async def cached_pdf(run_id: str, source_id: str, sha256: str):
        """Read an exact saved version; never download, pick a newer version, or call AI."""
        if not re.fullmatch(r"[a-f0-9]{64}", sha256):
            raise HTTPException(422, "INVALID_DOCUMENT_DIGEST")
        run = store.get_run(run_id)
        if not run or not any(s.id == source_id and s.pdf_url for s in run.sources):
            raise HTTPException(404, "SAVED_DOCUMENT_NOT_FOUND")
        con = store.connect()
        try:
            tables = {
                r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if not {"public_pdf_receipts", "public_pdf_blobs"}.issubset(tables):
                raise HTTPException(404, "SAVED_DOCUMENT_NOT_FOUND")
            row = con.execute(
                """SELECT b.content FROM public_pdf_receipts r
                JOIN public_pdf_blobs b ON b.digest=r.digest
                WHERE r.run_id=? AND r.source_id=? AND r.digest=?""",
                (run_id, source_id, sha256),
            ).fetchone()
        finally:
            con.close()
        if not row:
            raise HTTPException(404, "SAVED_DOCUMENT_NOT_FOUND")
        raw = row[0]
        if (
            not isinstance(raw, bytes)
            or len(raw) > 5_000_000
            or hashlib.sha256(raw).hexdigest() != sha256
        ):
            raise HTTPException(409, "SAVED_DOCUMENT_INTEGRITY_FAILED")
        return Response(
            raw,
            media_type="application/pdf",
            headers={
                "X-Source-Sha256": sha256,
                "X-Source-Cache": "HIT",
                "Cache-Control": "no-store",
            },
        )

    @router.post("/runs/{run_id}/documents/{source_id}")
    async def pdf(run_id: str, source_id: str, request: Request):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(422, "DOCUMENT_DOWNLOAD_CONSENT_REQUIRED") from None
        if not isinstance(body, dict) or body.get("consent") is not True:
            raise HTTPException(422, "DOCUMENT_DOWNLOAD_CONSENT_REQUIRED")
        run = store.get_run(run_id)
        item = next((s for s in run.sources if s.id == source_id), None) if run else None
        if not item or not item.pdf_url:
            raise HTTPException(404, "PUBLIC_DOCUMENT_NOT_FOUND")
        # Once downloaded, reopening the same run's document reads the saved bytes.
        # A fresh research run gets its own retrieval receipt/version.
        con = store.connect()
        try:
            with con:
                con.execute("""CREATE TABLE IF NOT EXISTS public_pdf_blobs
                    (digest TEXT PRIMARY KEY, content BLOB NOT NULL)""")
                con.execute("""CREATE TABLE IF NOT EXISTS public_pdf_receipts
                    (run_id TEXT, source_id TEXT, digest TEXT,
                    PRIMARY KEY(run_id, source_id, digest))""")
            cached = con.execute(
                """SELECT b.digest, b.content FROM public_pdf_receipts r
                JOIN public_pdf_blobs b ON b.digest=r.digest
                WHERE r.run_id=? AND r.source_id=? LIMIT 1""",
                (run_id, source_id),
            ).fetchone()
        finally:
            con.close()
        if cached:
            return Response(
                cached[1],
                media_type="application/pdf",
                headers={
                    "X-Source-Sha256": cached[0],
                    "X-Source-Cache": "HIT",
                    "Content-Disposition": f'inline; filename="{source_id}.pdf"',
                },
            )
        if not pdf_slot.acquire(blocking=False):
            raise HTTPException(409, "DOCUMENT_DOWNLOAD_BUSY")
        try:
            try:
                raw = await download_pdf(item.pdf_url)
            except Exception:
                raise HTTPException(422, "PDF_UNAVAILABLE_OR_OVER_LIMIT") from None
        finally:
            pdf_slot.release()
        digest = hashlib.sha256(raw).hexdigest()
        con = store.connect()
        try:
            with con:
                con.execute("""CREATE TABLE IF NOT EXISTS public_pdf_blobs
                    (digest TEXT PRIMARY KEY, content BLOB NOT NULL)""")
                con.execute("""CREATE TABLE IF NOT EXISTS public_pdf_receipts
                    (run_id TEXT, source_id TEXT, digest TEXT,
                    PRIMARY KEY(run_id, source_id, digest))""")
                con.execute("INSERT OR IGNORE INTO public_pdf_blobs VALUES (?,?)", (digest, raw))
                con.execute(
                    "INSERT OR IGNORE INTO public_pdf_receipts VALUES (?,?,?)",
                    (run_id, source_id, digest),
                )
        finally:
            con.close()
        return Response(
            raw,
            media_type="application/pdf",
            headers={
                "X-Source-Sha256": digest,
                "Content-Disposition": f'inline; filename="{source_id}.pdf"',
            },
        )

    return router
