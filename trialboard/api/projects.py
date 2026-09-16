"""Explicit local checkpoints. Internal consistency is not clinical approval/authorship."""

import base64
import binascii
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from trialboard.agent.field_review_contract import PdfSource, ReviewPacket
from trialboard.agent.revalidate import read_json
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.api.scout import EvidenceStore

PROJECT_BODY_BYTES = 48 * 1024 * 1024
BUNDLE_BYTES = 32 * 1024 * 1024


class CheckpointInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    consent: Literal[True]
    project_id: str | None = Field(default=None, max_length=36)
    expected_revision: int = Field(ge=0, le=100)
    title: str = Field(min_length=1, max_length=120)
    pdf_base64: str = Field(max_length=7 * 1024 * 1024)
    bundle_json: str = Field(max_length=BUNDLE_BYTES)


def validate_bundle(raw: str, pdf: bytes):
    bundle = read_json(raw.encode(), limit=BUNDLE_BYTES)
    keys = {
        "schema",
        "source",
        "notes",
        "reviewRaw",
        "draftRaw",
        "meetingRaw",
        "agentRaw",
        "context",
    }
    if (
        not isinstance(bundle, dict)
        or set(bundle) != keys
        or bundle["schema"] != "trialboard-project/1"
    ):
        raise ValueError("INVALID_BUNDLE")
    source = PdfSource.model_validate(bundle["source"])
    if (
        not pdf.startswith(b"%PDF-")
        or len(pdf) != source.byteLength
        or hashlib.sha256(pdf).hexdigest() != source.sha256
    ):
        raise ValueError("PDF_MISMATCH")
    review = ReviewPacket.model_validate(read_json(bundle["reviewRaw"].encode(), limit=2_000_000))
    if review.sourceDigest != source.sha256:
        raise ValueError("REVIEW_MISMATCH")
    draft = read_json(bundle["draftRaw"].encode(), limit=100_000)
    if (
        draft.get("schema_version") != "design-draft/1"
        or draft.get("source_digest") != source.sha256
    ):
        raise ValueError("DRAFT_MISMATCH")
    # Domain-level restore checks are also performed against freshly extracted PDF in the browser.
    if bundle["meetingRaw"] is not None:
        packet = read_json(bundle["meetingRaw"].encode(), limit=24 * 1024 * 1024)
        if (
            packet.get("schema_version") != "trialboard-meeting-packet/1"
            or packet.get("clinical_approval") is not False
        ):
            raise ValueError("INVALID_PACKET")
    if bundle["agentRaw"] is not None:
        read_json(bundle["agentRaw"].encode(), limit=2_000_000)
        if hashlib.sha256(bundle["agentRaw"].encode()).hexdigest() != review.origin.reportDigest:
            raise ValueError("AGENT_MISMATCH")
    if not isinstance(bundle["notes"], list) or len(bundle["notes"]) > 100:
        raise ValueError("INVALID_NOTES")
    context = bundle["context"]
    if context is not None:
        required = {"asset", "indication", "study", "question", "receiptId"}
        if (
            not isinstance(context, dict)
            or not required <= set(context)
            or set(context) - required - {"document"}
        ):
            raise ValueError("INVALID_CONTEXT")
        if any(
            not isinstance(context[k], str) or not 0 < len(context[k]) <= 2000 for k in required
        ):
            raise ValueError("INVALID_CONTEXT")
        if "document" in context:
            doc = context["document"]
            if (
                not isinstance(doc, dict)
                or set(doc) != {"runId", "sourceId", "title"}
                or any(not isinstance(v, str) or not 0 < len(v) <= 2000 for v in doc.values())
            ):
                raise ValueError("INVALID_CONTEXT")
    return source


class ProjectStore(EvidenceStore):
    def connect(self):
        con = super().connect()
        con.execute(
            "CREATE TABLE IF NOT EXISTS project_pdfs "
            "(digest TEXT PRIMARY KEY, content BLOB NOT NULL)"
        )
        con.execute("""CREATE TABLE IF NOT EXISTS project_checkpoints (
            project_id TEXT NOT NULL, revision INTEGER NOT NULL, title TEXT NOT NULL,
            created_at TEXT NOT NULL, pdf_digest TEXT NOT NULL REFERENCES project_pdfs(digest),
            bundle_digest TEXT NOT NULL, bundle_json TEXT NOT NULL,
            PRIMARY KEY(project_id, revision))""")
        return con

    def save(self, body: CheckpointInput):
        try:
            pdf = base64.b64decode(body.pdf_base64, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("INVALID_PDF") from None
        source = validate_bundle(body.bundle_json, pdf)
        context = read_json(body.bundle_json.encode(), limit=BUNDLE_BYTES)["context"]
        if context is not None:
            receipt = EvidenceStore(self.path).read(context["receiptId"])
            selected = (
                next((s for s in receipt["studies"] if s["nct_id"] == context["study"]), None)
                if receipt
                else None
            )
            if not selected or context["indication"] not in selected["conditions"]:
                raise ValueError("UNKNOWN_PROJECT_CONTEXT")
            if context.get("document"):
                from trialboard.research.store import ResearchStore

                document = context["document"]
                research = ResearchStore(self.path)
                run = research.get_run(document["runId"])
                if (
                    not run
                    or run.request.search_id != context["receiptId"]
                    or run.request.nct_id != context["study"]
                    or run.request.asset != context["asset"]
                    or run.request.indication != context["indication"]
                ):
                    raise ValueError("UNKNOWN_DOCUMENT_CONTEXT")
                # Receipt association is not an assertion that the document studies this trial.
                connection = research.connect()
                try:
                    exists = connection.execute(
                        "SELECT 1 FROM sqlite_master WHERE name='public_pdf_receipts'"
                    ).fetchone()
                    cached = (
                        connection.execute(
                            "SELECT digest FROM public_pdf_receipts WHERE run_id=? AND source_id=?",
                            (document["runId"], document["sourceId"]),
                        ).fetchone()
                        if exists
                        else None
                    )
                finally:
                    connection.close()
                if not cached or cached[0] != source.sha256:
                    raise ValueError("DOCUMENT_PDF_MISMATCH")
        if not body.title.strip() or (body.project_id is None and body.expected_revision != 0):
            raise ValueError("INVALID_PROJECT")
        pid = str(UUID(body.project_id)) if body.project_id else str(uuid4())
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                previous = con.execute(
                    "SELECT revision, pdf_digest FROM project_checkpoints WHERE project_id=? "
                    "ORDER BY revision DESC LIMIT 1",
                    (pid,),
                ).fetchone()
                if (previous[0] if previous else 0) != body.expected_revision or (
                    body.project_id and not previous
                ):
                    raise ValueError("PROJECT_VERSION_CONFLICT")
                if previous and previous[1] != source.sha256:
                    raise ValueError("PROJECT_PDF_CHANGED")
                count = con.execute(
                    "SELECT COUNT(DISTINCT project_id), "
                    "COALESCE(SUM(length(CAST(bundle_json AS BLOB))),0) FROM project_checkpoints"
                ).fetchone()
                pdf_size = con.execute(
                    "SELECT COALESCE(SUM(length(content)),0) FROM project_pdfs"
                ).fetchone()[0]
                if (
                    body.expected_revision >= 100
                    or (not previous and count[0] >= 100)
                    or count[1] + pdf_size + len(pdf) + len(body.bundle_json.encode()) > 1024**3
                ):
                    raise ValueError("PROJECT_STORAGE_LIMIT")
                stamp = datetime.now(UTC).isoformat()
                digest = hashlib.sha256(body.bundle_json.encode()).hexdigest()
                con.execute("INSERT OR IGNORE INTO project_pdfs VALUES (?,?)", (source.sha256, pdf))
                con.execute(
                    "INSERT INTO project_checkpoints VALUES (?,?,?,?,?,?,?)",
                    (
                        pid,
                        body.expected_revision + 1,
                        body.title.strip(),
                        stamp,
                        source.sha256,
                        digest,
                        body.bundle_json,
                    ),
                )
            return {
                "project_id": pid,
                "revision": body.expected_revision + 1,
                "title": body.title.strip(),
                "created_at": stamp,
                "pdf_digest": source.sha256,
                "bundle_digest": digest,
            }
        finally:
            con.close()

    def history(self):
        con = self.connect()
        try:
            # Latest 100 checkpoints, not only latest projects: old versions remain recoverable.
            rows = con.execute(
                "SELECT project_id,revision,title,created_at,pdf_digest,bundle_digest "
                "FROM project_checkpoints ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
            return [
                dict(
                    zip(
                        (
                            "project_id",
                            "revision",
                            "title",
                            "created_at",
                            "pdf_digest",
                            "bundle_digest",
                        ),
                        row,
                        strict=True,
                    )
                )
                for row in rows
            ]
        finally:
            con.close()

    def read(self, pid: str, revision: int):
        con = self.connect()
        try:
            row = con.execute(
                "SELECT c.title,c.created_at,c.pdf_digest,c.bundle_digest,c.bundle_json,p.content "
                "FROM project_checkpoints c JOIN project_pdfs p ON p.digest=c.pdf_digest "
                "WHERE project_id=? AND revision=?",
                (pid, revision),
            ).fetchone()
            if row is None:
                return None
            if (
                hashlib.sha256(row[4].encode()).hexdigest() != row[3]
                or hashlib.sha256(row[5]).hexdigest() != row[2]
            ):
                raise ValueError("PROJECT_INTEGRITY_ERROR")
            return {
                "project_id": pid,
                "revision": revision,
                "title": row[0],
                "created_at": row[1],
                "pdf_digest": row[2],
                "bundle_digest": row[3],
                "bundle_json": row[4],
                "pdf_base64": base64.b64encode(row[5]).decode(),
            }
        finally:
            con.close()


def project_router(path: Path):
    router = APIRouter(prefix="/api/projects")
    store = ProjectStore(path)

    @router.get("")
    def history():
        return store.history()

    @router.get("/{project_id}/{revision}")
    def read(project_id: UUID, revision: int):
        try:
            saved = store.read(str(project_id), revision)
        except ValueError:
            raise HTTPException(409, "PROJECT_INTEGRITY_ERROR") from None
        if saved is None:
            raise HTTPException(404, "PROJECT_NOT_FOUND")
        return saved

    @router.post("")
    def save(body: CheckpointInput, request: Request):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        try:
            return store.save(body)
        except (ValueError, TypeError, AttributeError, KeyError) as error:
            code = str(error)
            if code in {"PROJECT_VERSION_CONFLICT", "PROJECT_STORAGE_LIMIT"}:
                raise HTTPException(409, code) from None
            raise HTTPException(422, "INVALID_PROJECT_CHECKPOINT") from None

    return router
