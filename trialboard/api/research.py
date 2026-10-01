"""Local research jobs persist every event; secrets and arbitrary URLs never enter requests."""

import asyncio
import hashlib
import json
import re
from pathlib import Path
from threading import BoundedSemaphore
from time import monotonic

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from trialboard.agent.runtime import runtime_provider
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.api.team_auth import TeamDataPath, current_access_scope
from trialboard.research import pdf_policy, pdf_preparation, raw_policy
from trialboard.research.agent import run_research
from trialboard.research.collect import download_pdf
from trialboard.research.model_policy import LazyResearchProvider, ResearchModelGate
from trialboard.research.models import CurationInput, ResearchRequest
from trialboard.research.source_policy import (
    SourcePolicyUpdate,
    metadata,
    policy_history,
    read_collection,
    require_content,
    update_policy,
)
from trialboard.research.store import ResearchStore


def research_router(
    path: Path,
    model_slot: BoundedSemaphore,
    provider_factory=runtime_provider,
    *,
    identity=None,
):
    router = APIRouter(prefix="/api/research")
    store = ResearchStore(path)
    running = False
    pdf_slot = BoundedSemaphore(1)
    preparation_slot = BoundedSemaphore(1)

    @router.get("/runs/{run_id}/raw-metadata")
    async def raw_metadata(run_id: str):
        return raw_policy.metadata(path, run_id)

    @router.get("/runs/{run_id}/sources/{source_id}/raw-usage-policy")
    async def raw_usage_policy(
        run_id: str,
        source_id: str,
        source_digest: str = Query(pattern=r"^[a-f0-9]{64}$"),
        snapshot_digest: str = Query(pattern=r"^[a-f0-9]{64}$"),
    ):
        return raw_policy.history(path, (run_id, source_id, source_digest, snapshot_digest))

    @router.post("/runs/{run_id}/sources/{source_id}/raw-usage-policy")
    async def update_raw_usage_policy(
        run_id: str,
        source_id: str,
        body: raw_policy.RawPolicyUpdate,
        request: Request,
    ):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        return raw_policy.update(path, identity, run_id, source_id, body)

    @router.get("/pdf-preparation-capabilities")
    async def preparation_capabilities():
        return pdf_preparation.capabilities(path)

    @router.get("/runs/{run_id}/documents/{source_id}/pdf-preparations")
    async def list_pdf_preparations(
        run_id: str,
        source_id: str,
        source_digest: str = Query(pattern=r"^[a-f0-9]{64}$"),
        pdf_sha256: str = Query(pattern=r"^[a-f0-9]{64}$"),
    ):
        return pdf_preparation.preparation_list(path, run_id, source_id, source_digest, pdf_sha256)

    @router.post("/runs/{run_id}/documents/{source_id}/prepare-server")
    async def prepare_pdf(
        run_id: str,
        source_id: str,
        body: pdf_preparation.PreparationRequest,
        request: Request,
    ):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        if not preparation_slot.acquire(blocking=False):
            raise HTTPException(409, "PDF_PREPARATION_BUSY")
        try:
            return await pdf_preparation.prepare(path, identity, run_id, source_id, body)
        finally:
            preparation_slot.release()

    @router.get("/runs/{run_id}/pdf-preparations/{preparation_id}")
    async def read_pdf_preparation(run_id: str, preparation_id: str):
        return pdf_preparation.read(path, run_id, preparation_id)

    @router.get("/runs")
    async def history():
        return await asyncio.to_thread(store.list_runs)

    @router.get("/runs/{run_id}/source-metadata")
    async def source_metadata(run_id: str):
        return metadata(path, run_id)

    @router.get("/runs/{run_id}/pdf-metadata")
    async def pdf_metadata(run_id: str):
        return pdf_policy.metadata(path, run_id)

    @router.get("/runs/{run_id}/documents/{source_id}/usage-policy")
    async def pdf_usage_policy(
        run_id: str,
        source_id: str,
        source_digest: str = Query(pattern=r"^[a-f0-9]{64}$"),
        pdf_sha256: str = Query(pattern=r"^[a-f0-9]{64}$"),
    ):
        return pdf_policy.history(path, run_id, source_id, source_digest, pdf_sha256)

    @router.post("/runs/{run_id}/documents/{source_id}/usage-policy")
    async def update_pdf_usage_policy(
        run_id: str,
        source_id: str,
        body: pdf_policy.PdfPolicyUpdate,
        request: Request,
    ):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        return pdf_policy.update(path, identity, run_id, source_id, body)

    @router.get("/runs/{run_id}/sources/{source_id}/usage-policy")
    async def source_usage_policy(run_id: str, source_id: str):
        return policy_history(path, run_id, source_id)

    @router.post("/runs/{run_id}/sources/{source_id}/usage-policy")
    async def update_source_usage_policy(
        run_id: str,
        source_id: str,
        body: SourcePolicyUpdate,
        request: Request,
    ):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        return update_policy(path, run_id, source_id, body)

    @router.get("/runs/{run_id}")
    async def read(run_id: str):
        run = await asyncio.to_thread(read_collection, path, run_id)
        return {"collection": run.model_dump(), "changes": store.previous_changes(run)}

    @router.get("/runs/{run_id}/search")
    async def local_search(run_id: str, q: str = ""):
        if len(q) > 150:
            raise HTTPException(422, "SEARCH_QUERY_TOO_LONG")
        metadata(path, run_id)
        return store.search_sources(run_id, q)

    @router.get("/runs/{run_id}/impact")
    async def impact(
        run_id: str,
        source_id: str = Query(min_length=1, max_length=150),
        source_digest: str = Query(pattern=r"^[a-f0-9]{64}$"),
    ):
        try:
            return await asyncio.to_thread(
                store.recorded_direct_impact, run_id, source_id, source_digest
            )
        except ValueError as error:
            code = str(error)
            if code == "RESEARCH_NOT_FOUND":
                raise HTTPException(404, code) from None
            if code == "RESEARCH_SOURCE_NOT_FOUND":
                raise HTTPException(404, code) from None
            if code == "RESEARCH_SOURCE_VERSION_MISMATCH":
                raise HTTPException(409, code) from None
            if code == "IMPACT_LOOKUP_LIMIT":
                raise HTTPException(422, code) from None
            raise HTTPException(500, "IMPACT_LOOKUP_FAILED") from None

    @router.get("/runs/{run_id}/result-tables")
    async def result_tables(run_id: str):
        from trialboard.research.result_tables import registry_results

        require_content(path, run_id)
        if not store.get_run(run_id):
            raise HTTPException(404, "RESEARCH_NOT_FOUND")
        try:
            return registry_results(store, run_id)
        except (ValueError, TypeError, KeyError):
            raise HTTPException(422, "REGISTRY_RESULTS_UNAVAILABLE") from None

    @router.post("/runs/{run_id}/recover")
    async def recover(run_id: str, request: Request):
        require_content(path, run_id)
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
        require_content(path, run_id)
        if not store.get_run(run_id):
            raise HTTPException(404, "RESEARCH_NOT_FOUND")
        return store.curation(run_id, source_id)

    @router.post("/runs/{run_id}/curation")
    async def curate(run_id: str, body: CurationInput, request: Request):
        require_content(path, run_id)
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
        access = current_access_scope()
        run_store = store
        if isinstance(path, TeamDataPath):
            from trialboard.research.raw_capture import CaptureGuard

            run_store = ResearchStore(path, capture_guard=CaptureGuard(path, identity, access, run))

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
            run_store.save_run(run)
            await queue.put(event)

        async def work():
            try:
                await emit("STARTED", "공개 근거 수집 작업을 시작했습니다.")
                async with asyncio.timeout(240):
                    provider = None
                    if has_slot:
                        provider = (
                            LazyResearchProvider(
                                provider_factory, ResearchModelGate(path, identity, access, run)
                            )
                            if isinstance(path, TeamDataPath)
                            else provider_factory()
                        )
                    await run_research(run, run_store, emit, provider)
            except asyncio.CancelledError:
                if run.status == "RUNNING":
                    run.status = "CANCELLED"
                try:
                    run_store.save_run(run)
                except Exception:
                    # Cancellation does not restore revoked write authority. The last
                    # durable record can remain unfinished; never fabricate completion.
                    pass
                raise
            except Exception:
                run.status = "FAILED"
                try:
                    await emit(
                        "ERROR", "수집 작업이 끝나지 않았습니다. 저장된 부분 기록을 확인하세요."
                    )
                except Exception:
                    # Revoked authority cannot persist another run update. Still terminate
                    # this metadata-only stream, rather than waiting forever for an event.
                    await queue.put(
                        {
                            "run_id": run.id,
                            "sequence": len(run.events) + 1,
                            "stage": "ERROR",
                            "elapsed_ms": round((monotonic() - start) * 1000),
                            "message": "권한 또는 저장 상태가 변경되어 수집을 중단했습니다.",
                        }
                    )

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
        if isinstance(path, TeamDataPath):
            raw = pdf_policy.cached(path, run_id, source_id, sha256)
            return Response(
                raw,
                media_type="application/pdf",
                headers={
                    "X-Source-Sha256": sha256,
                    "X-Source-Cache": "HIT",
                    "Cache-Control": "no-store",
                },
            )
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
        if isinstance(path, TeamDataPath):
            try:
                raw, digest, cache = await pdf_policy.download(
                    path,
                    identity,
                    run_id,
                    source_id,
                    body,
                    download_pdf,
                    pdf_slot,
                )
            except HTTPException:
                raise
            except (ValueError, TypeError):
                raise HTTPException(422, "INVALID_PDF_STORAGE_PERMISSION") from None
            except Exception:
                raise HTTPException(422, "PDF_UNAVAILABLE_OR_OVER_LIMIT") from None
            return Response(
                raw,
                media_type="application/pdf",
                headers={
                    "X-Source-Sha256": digest,
                    "X-Source-Cache": cache,
                    "Cache-Control": "no-store",
                },
            )
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
