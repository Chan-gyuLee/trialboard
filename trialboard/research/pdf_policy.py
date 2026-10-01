"""TEAM PDF_BYTES permissions, separate from normalized SOURCE_TEXT assertions."""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import HTTPException
from pydantic import Field, StrictBool, StrictInt, model_validator

from trialboard.api.projects import UsagePolicyAssertion
from trialboard.api.team_auth import current_access_scope
from trialboard.research.models import Collection, Contract
from trialboard.research.saved_review import team_database
from trialboard.research.source_policy import (
    PURPOSES,
    can_manage,
    existing_connection,
    source_rows,
    tables,
)


class PdfPolicyUpdate(UsagePolicyAssertion):
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    pdf_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_policy_revision: StrictInt = Field(ge=0, le=100)


class StoragePermission(Contract):
    original_storage: Literal["ALLOW"]
    evidence_reference: str = Field(min_length=1, max_length=2000)
    reason: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def nonblank(self):
        if not self.evidence_reference.strip() or not self.reason.strip():
            raise ValueError("PDF_STORAGE_EVIDENCE_REQUIRED")
        return self


class DownloadPermission(Contract):
    consent: StrictBool
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    storage_permission: StoragePermission

    @model_validator(mode="after")
    def consent_required(self):
        if self.consent is not True:
            raise ValueError("EXPLICIT_CONSENT_REQUIRED")
        return self


def initialize(con):
    con.execute("""CREATE TABLE IF NOT EXISTS research_pdf_bindings (
        run_id TEXT, source_id TEXT, source_digest TEXT, pdf_sha256 TEXT,
        PRIMARY KEY(run_id,source_id,source_digest,pdf_sha256))""")
    con.execute("""CREATE TABLE IF NOT EXISTS research_pdf_policies (
        run_id TEXT, source_id TEXT, source_digest TEXT, pdf_sha256 TEXT,
        revision INTEGER, data TEXT,
        PRIMARY KEY(run_id,source_id,source_digest,pdf_sha256,revision))""")
    for table in ("research_pdf_bindings", "research_pdf_policies"):
        for operation in ("UPDATE", "DELETE"):
            con.execute(f"""CREATE TRIGGER IF NOT EXISTS {table}_no_{operation.lower()}
                BEFORE {operation} ON {table}
                BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_PDF_POLICY'); END""")


def source(con, run_id, source_id, digest=None):
    row = next((r for r in source_rows(con, run_id) if r[0] == source_id), None)
    if row is None:
        raise HTTPException(404, "RESEARCH_SOURCE_NOT_FOUND")
    run = Collection.model_validate_json(con.execute(
        "SELECT data FROM research_runs WHERE id=?", (run_id,)).fetchone()[0])
    item = next((s for s in run.sources if s.id == source_id), None)
    if item is None or (
        digest is not None and item.digest != digest
    ):
        raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
    from trialboard.research.source_binding import validate

    return validate(con, run, item, row[2])


def receipts(con, run_id, source_id):
    if not {"public_pdf_receipts", "public_pdf_blobs"}.issubset(tables(con)):
        return []
    rows = con.execute("""SELECT r.digest,length(b.content) FROM public_pdf_receipts r
        JOIN public_pdf_blobs b ON b.digest=r.digest WHERE r.run_id=? AND r.source_id=?
        ORDER BY r.digest LIMIT 101""", (run_id, source_id)).fetchall()
    if len(rows) > 100:
        raise HTTPException(422, "PDF_VERSION_LOOKUP_LIMIT")
    return rows


def bound(con, key):
    return "research_pdf_bindings" in tables(con) and bool(con.execute(
        "SELECT 1 FROM research_pdf_bindings WHERE run_id=? AND source_id=? "
        "AND source_digest=? AND pdf_sha256=?", key).fetchone())


def current(con, key):
    if "research_pdf_policies" in tables(con):
        row = con.execute("SELECT data FROM research_pdf_policies WHERE run_id=? "
                          "AND source_id=? AND source_digest=? AND pdf_sha256=? "
                          "ORDER BY revision DESC LIMIT 1", key).fetchone()
        if row:
            return json.loads(row[0])
    run_id, sid, digest, sha = key
    return {"resource_kind": "PDF_BYTES", "run_id": run_id, "source_id": sid,
            "source_digest": digest, "pdf_sha256": sha, "policy_revision": 0,
            **dict.fromkeys(PURPOSES, "UNKNOWN"), "evidence_reference": None,
            "reason": None, "asserted_by": None, "created_at": None,
            "verification": "UNVERIFIED"}


def metadata(path, run_id):
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        sources = []
        for sid, digest, data in source_rows(con, run_id):
            item = json.loads(data)
            versions = []
            for sha, length in receipts(con, run_id, sid):
                key = (run_id, sid, digest, sha)
                versions.append({"pdf_sha256": sha, "byte_length": length,
                                 "binding_status": "EXACT" if bound(con, key) else "LEGACY_UNBOUND",
                                 "usage_policy": current(con, key)})
            sources.append({"source_id": sid, "source_digest": digest, "title": item["title"],
                            "download_available": bool(item.get("pdf_url")),
                            "cached_versions": versions})
        return {"run_id": run_id, "resource_kind": "PDF_BYTES",
                "can_manage": can_manage(con, run_id), "sources": sources}
    finally:
        con.close()


def raw_bytes(con, key, *, authorized=True):
    run_id, sid, digest, sha = key
    source(con, run_id, sid, digest)
    if sha not in {r[0] for r in receipts(con, run_id, sid)}:
        raise HTTPException(404, "SAVED_DOCUMENT_NOT_FOUND")
    if authorized:
        if not bound(con, key):
            raise HTTPException(403, "PDF_BINDING_REQUIRED")
        if current(con, key)["original_storage"] != "ALLOW":
            raise HTTPException(403, "PDF_STORAGE_NOT_ALLOWED")
    row = con.execute("SELECT content FROM public_pdf_blobs WHERE digest=?", (sha,)).fetchone()
    raw = row[0] if row else None
    if (not isinstance(raw, bytes) or not 5 <= len(raw) <= 5_000_000
            or not raw.startswith(b"%PDF-") or hashlib.sha256(raw).hexdigest() != sha):
        raise HTTPException(409, "SAVED_DOCUMENT_INTEGRITY_FAILED")
    return raw


def cached(path, run_id, sid, sha):
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        item = source(con, run_id, sid)
        return raw_bytes(con, (run_id, sid, item.digest, sha))
    finally:
        con.close()


def history(path, run_id, sid, digest, sha):
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        source(con, run_id, sid, digest)
        if sha not in {r[0] for r in receipts(con, run_id, sid)}:
            raise HTTPException(404, "SAVED_DOCUMENT_NOT_FOUND")
        key, rows = (run_id, sid, digest, sha), []
        if "research_pdf_policies" in tables(con):
            rows = con.execute("SELECT data FROM research_pdf_policies WHERE run_id=? "
                               "AND source_id=? AND source_digest=? AND pdf_sha256=? "
                               "ORDER BY revision DESC LIMIT 100", key).fetchall()
        return {"current": current(con, key), "history": [json.loads(r[0]) for r in rows],
                "can_manage": can_manage(con, run_id)}
    finally:
        con.close()


def management(con, run_id, identity, access):
    fresh = identity.revalidate(access) if identity and access else None
    if (fresh is None or fresh.role not in ("admin", "reviewer")
            or (fresh.subject_id, fresh.team_id, fresh.role)
            != (access.subject_id, access.team_id, access.role)):
        raise HTTPException(403, "MODEL_IDENTITY_INVALIDATED")
    if not can_manage(con, run_id):
        raise HTTPException(403, "PDF_POLICY_MANAGEMENT_FORBIDDEN")


def record(con, key, body, revision, subject):
    initialize(con)
    value = {**body, "resource_kind": "PDF_BYTES", "run_id": key[0], "source_id": key[1],
             "source_digest": key[2], "pdf_sha256": key[3], "policy_revision": revision,
             "asserted_by": subject, "created_at": datetime.now(UTC).isoformat(),
             "verification": "USER_ATTESTED_UNVERIFIED"}
    con.execute("INSERT OR IGNORE INTO research_pdf_bindings VALUES (?,?,?,?)", key)
    con.execute("INSERT INTO research_pdf_policies VALUES (?,?,?,?,?,?)",
                (*key, revision, json.dumps(value)))


def update(path, identity, run_id, sid, body):
    database, access = team_database(path), current_access_scope()
    with sqlite3.connect(database) as con:
        con.execute("BEGIN IMMEDIATE")
        source(con, run_id, sid, body.source_digest)
        management(con, run_id, identity, access)
        key = (run_id, sid, body.source_digest, body.pdf_sha256)
        raw_bytes(con, key, authorized=False)
        revision = current(con, key)["policy_revision"]
        if revision != body.expected_policy_revision:
            raise HTTPException(409, "PDF_POLICY_VERSION_CONFLICT")
        if revision >= 100:
            raise HTTPException(422, "PDF_POLICY_HISTORY_LIMIT")
        record(con, key, body.model_dump(exclude={"source_digest", "pdf_sha256",
                                                "expected_policy_revision"}),
               revision + 1, access.subject_id)
    return history(path, run_id, sid, body.source_digest, body.pdf_sha256)


async def download(path, identity, run_id, sid, body, fetch, slot):
    database, access = team_database(path), current_access_scope()
    con = existing_connection(database)
    try:
        con.execute("BEGIN")
        item = source(con, run_id, sid)
        versions = receipts(con, run_id, sid)
        if versions:
            if len(versions) != 1:
                raise HTTPException(409, "PDF_VERSION_SELECTION_REQUIRED")
            if body != {"consent": True} or body.get("consent") is not True:
                permission = DownloadPermission.model_validate(body)
                if permission.source_digest != item.digest:
                    raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
            raw = raw_bytes(con, (run_id, sid, item.digest, versions[0][0]))
            return raw, versions[0][0], "HIT"
        if body == {"consent": True} and body.get("consent") is True:
            raise HTTPException(409, "PDF_STORAGE_PERMISSION_REQUIRED")
        permission = DownloadPermission.model_validate(body)
        if permission.source_digest != item.digest:
            raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
        management(con, run_id, identity, access)
        if not item.pdf_url:
            raise HTTPException(404, "PUBLIC_DOCUMENT_NOT_FOUND")
    finally:
        con.close()
    if not slot.acquire(blocking=False):
        raise HTTPException(409, "DOCUMENT_DOWNLOAD_BUSY")
    try:
        raw = await fetch(item.pdf_url)
        if (not isinstance(raw, bytes) or not 5 <= len(raw) <= 5_000_000
                or not raw.startswith(b"%PDF-")):
            raise HTTPException(422, "PDF_UNAVAILABLE_OR_OVER_LIMIT")
        sha = hashlib.sha256(raw).hexdigest()
        with sqlite3.connect(database) as con:
            con.execute("BEGIN IMMEDIATE")
            if source(con, run_id, sid, item.digest) != item:
                raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
            management(con, run_id, identity, access)
            if receipts(con, run_id, sid):
                raise HTTPException(409, "PDF_VERSION_SELECTION_REQUIRED")
            con.execute("CREATE TABLE IF NOT EXISTS public_pdf_blobs "
                        "(digest TEXT PRIMARY KEY, content BLOB NOT NULL)")
            con.execute("CREATE TABLE IF NOT EXISTS public_pdf_receipts "
                        "(run_id TEXT,source_id TEXT,digest TEXT,"
                        "PRIMARY KEY(run_id,source_id,digest))")
            con.execute("INSERT OR IGNORE INTO public_pdf_blobs VALUES (?,?)", (sha, raw))
            con.execute("INSERT INTO public_pdf_receipts VALUES (?,?,?)", (run_id, sid, sha))
            key = (run_id, sid, item.digest, sha)
            record(con, key, {**dict.fromkeys(PURPOSES, "UNKNOWN"),
                             **permission.storage_permission.model_dump()}, 1, access.subject_id)
            raw_bytes(con, key)
        return raw, sha, "MISS"
    finally:
        slot.release()
