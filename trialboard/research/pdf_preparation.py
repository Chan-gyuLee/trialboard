"""Server PDF text preparation only. No model provider or browser-provided text."""

import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path
from uuid import UUID, uuid4

from anyio import CancelScope
from fastapi import HTTPException
from pydantic import Field, StrictBool, StrictInt, model_validator

from trialboard.agent.provider import parse_json
from trialboard.api.team_auth import TeamDataPath, current_access_scope
from trialboard.research.models import Contract
from trialboard.research.pdf_policy import current, management, raw_bytes
from trialboard.research.saved_review import team_database, utc_now
from trialboard.research.source_policy import existing_connection, source_rows, tables
from trialboard.serialization import sha256_json

LIMITS = {"max_pdf_bytes": 5_000_000, "max_pages": 10, "max_text_chars": 30_000,
          "cpu_seconds": 2, "wall_seconds": 5, "memory_bytes": 536_870_912,
          "max_output_bytes": 200_000}
ERRORS = {"UNSUPPORTED_SANDBOX", "PDF_ENCRYPTED_UNSUPPORTED", "PDF_PAGE_LIMIT",
          "PDF_TEXT_LIMIT", "PDF_TEXT_UNAVAILABLE", "PDF_PARSE_FAILED", "PDF_OUTPUT_LIMIT"}


class PreparationRequest(Contract):
    consent: StrictBool
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    pdf_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    policy_revision: StrictInt = Field(ge=1, le=100)

    @model_validator(mode="after")
    def explicit(self):
        if self.consent is not True:
            raise ValueError("EXPLICIT_CONSENT_REQUIRED")
        return self


def protocol(raw):
    try:
        if len(raw) > LIMITS["max_output_bytes"]:
            raise ValueError
        value = parse_json(raw)
        if (isinstance(value, dict) and set(value) == {"status", "code"}
                and value["status"] == "ERROR" and value["code"] in ERRORS):
            raise HTTPException(422, value["code"])
        if (not isinstance(value, dict) or set(value) != {"status", "extractor", "pages"}
                or value["status"] != "OK" or not isinstance(value["extractor"], str)
                or not value["extractor"].startswith("pdfplumber/")
                or len(value["extractor"]) > 100 or not isinstance(value["pages"], list)
                or not 1 <= len(value["pages"]) <= 10):
            raise ValueError
        count = 0
        for i, page in enumerate(value["pages"], 1):
            if (not isinstance(page, dict) or set(page) != {"page", "text"}
                    or type(page["page"]) is not int or page["page"] != i
                    or not isinstance(page["text"], str)):
                raise ValueError
            count += len(page["text"])
        if count > 30_000 or not any(p["text"].strip() for p in value["pages"]):
            raise ValueError
        return {"extractor": value["extractor"], "pages": value["pages"]}
    except (ValueError, TypeError, KeyError):
        raise HTTPException(422, "PDF_PARSER_PROTOCOL_INVALID") from None


async def isolated_extract(raw):
    if sys.platform != "linux":
        raise HTTPException(422, "UNSUPPORTED_SANDBOX")
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-I", str(Path(__file__).with_name("pdf_extract_worker.py")),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env={"PATH": os.defpath, "LANG": "C.UTF-8"},
        )
    except OSError:
        raise HTTPException(422, "PDF_PARSER_PROCESS_FAILED") from None

    async def write():
        try:
            process.stdin.write(raw)
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            process.stdin.close()

    sender = asyncio.create_task(write())
    chunks, count = [], 0
    try:
        async with asyncio.timeout(LIMITS["wall_seconds"]):
            while True:
                chunk = await process.stdout.read(min(32768, 200001 - count))
                if not chunk:
                    break
                count += len(chunk)
                if count > 200000:
                    raise HTTPException(422, "PDF_OUTPUT_LIMIT")
                chunks.append(chunk)
            await sender
            code = await process.wait()
            if code:
                raise HTTPException(422, "PDF_PARSER_PROCESS_FAILED")
        return protocol(b"".join(chunks))
    except TimeoutError:
        raise HTTPException(422, "PDF_PARSER_TIMEOUT") from None
    finally:
        with CancelScope(shield=True):
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
            await process.wait()
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)


def checked(con, key, revision, identity, access):
    management(con, key[0], identity, access)
    raw = raw_bytes(con, key)
    if current(con, key)["policy_revision"] != revision:
        raise HTTPException(409, "PDF_POLICY_VERSION_CONFLICT")
    return raw


async def prepare(path, identity, run_id, sid, body):
    database, access = team_database(path), current_access_scope()
    key = (run_id, sid, body.source_digest, body.pdf_sha256)
    con = existing_connection(database)
    try:
        con.execute("BEGIN")
        raw = checked(con, key, body.policy_revision, identity, access)
    finally:
        con.close()
    extracted = await isolated_extract(raw)
    # Revalidate the subprocess protocol even when a synthetic test parser is injected.
    extracted = protocol(json.dumps({"status": "OK", **extracted}).encode())
    artifact = {"schema": "research-pdf-preparation/1", "mode": "SERVER_PDF_TEXT_ONLY",
                "preparation_id": str(uuid4()), "run_id": run_id, "source_id": sid,
                "source_digest": body.source_digest, "pdf_sha256": body.pdf_sha256,
                "policy_revision": body.policy_revision, "asserted_by": access.subject_id,
                "created_at": utc_now(), **extracted, "limits": LIMITS, "model_calls": 0,
                "verification": "SERVER_EXTRACTED_NOT_CLINICALLY_VERIFIED",
                "notices": ["서버가 저장 PDF에서 추출한 텍스트이며 임상 검증이 아닙니다.",
                            "외부 AI 호출은 실행하지 않았습니다. PDF 자동 검토는 아직 차단됩니다.",
                            "CPU·메모리·시간 제한은 완전한 OS 파일/네트워크 격리가 아닙니다."]}
    artifact["preparation_digest"] = sha256_json(artifact)
    with sqlite3.connect(database) as con:
        con.execute("BEGIN IMMEDIATE")
        if checked(con, key, body.policy_revision, identity, access) != raw:
            raise HTTPException(409, "SAVED_DOCUMENT_INTEGRITY_FAILED")
        con.execute("""CREATE TABLE IF NOT EXISTS research_pdf_preparations (
            id TEXT PRIMARY KEY, run_id TEXT NOT NULL, data TEXT NOT NULL)""")
        for operation in ("UPDATE", "DELETE"):
            con.execute(f"""CREATE TRIGGER IF NOT EXISTS preparation_no_{operation.lower()}
                BEFORE {operation} ON research_pdf_preparations
                BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_PDF_PREPARATION'); END""")
        con.execute("INSERT INTO research_pdf_preparations VALUES (?,?,?)",
                    (artifact["preparation_id"], run_id, json.dumps(artifact, ensure_ascii=False)))
    return artifact


def capabilities(path):
    if not isinstance(path, TeamDataPath) or current_access_scope() is None:
        raise HTTPException(404, "PDF_PREPARATION_TEAM_REQUIRED")
    return {"schema": "research-pdf-preparation-capabilities/1",
            "status": "RUNTIME_CHECK_REQUIRED" if sys.platform == "linux"
            else "UNSUPPORTED_SANDBOX", "limits": dict(LIMITS)}


def decode_artifact(raw, run_id, preparation_id):
    """Validate persisted bindings/protocol before returning any private text."""
    try:
        if not isinstance(raw, str) or len(raw) > 250_000:
            raise ValueError
        artifact = parse_json(raw)
        if isinstance(artifact, dict) and (
            artifact.get("run_id") != run_id or artifact.get("preparation_id") != preparation_id
        ):
            raise HTTPException(409, "PDF_PREPARATION_BINDING_MISMATCH")
        fields = {"schema", "mode", "preparation_id", "preparation_digest", "run_id",
                  "source_id", "source_digest", "pdf_sha256", "policy_revision", "asserted_by",
                  "created_at", "extractor", "pages", "limits", "model_calls", "verification",
                  "notices"}
        if (not isinstance(artifact, dict) or set(artifact) != fields
                or artifact["schema"] != "research-pdf-preparation/1"
                or artifact["mode"] != "SERVER_PDF_TEXT_ONLY"
                or artifact["run_id"] != run_id
                or artifact["preparation_id"] != preparation_id
                or str(UUID(preparation_id)) != preparation_id
                or str(UUID(artifact["asserted_by"])) != artifact["asserted_by"]
                or type(artifact["model_calls"]) is not int or artifact["model_calls"] != 0
                or artifact["limits"] != LIMITS
                or any(type(v) is not int for v in artifact["limits"].values())
                or artifact["verification"] != "SERVER_EXTRACTED_NOT_CLINICALLY_VERIFIED"
                or not isinstance(artifact["created_at"], str)
                or not isinstance(artifact["source_id"], str)
                or not isinstance(artifact["notices"], list)
                or any(not isinstance(n, str) for n in artifact["notices"])):
            raise ValueError
        PreparationRequest(consent=True, source_digest=artifact["source_digest"],
                           pdf_sha256=artifact["pdf_sha256"],
                           policy_revision=artifact["policy_revision"])
        if artifact["preparation_digest"] != sha256_json(
            {k: v for k, v in artifact.items() if k != "preparation_digest"}
        ):
            raise ValueError
        protocol(json.dumps({"status": "OK", "extractor": artifact["extractor"],
                             "pages": artifact["pages"]}).encode())
        return artifact
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(409, "PDF_PREPARATION_INTEGRITY_FAILED") from None


def read_record(con, run_id, preparation_id):
    row = None
    if "research_pdf_preparations" in tables(con):
        row = con.execute("SELECT data FROM research_pdf_preparations WHERE id=? AND run_id=?",
                          (preparation_id, run_id)).fetchone()
    if row is None:
        raise HTTPException(404, "PDF_PREPARATION_NOT_FOUND")
    artifact = decode_artifact(row[0], run_id, preparation_id)
    raw_bytes(con, (run_id, artifact["source_id"], artifact["source_digest"],
                    artifact["pdf_sha256"]))
    return artifact


def preparation_list(path, run_id, sid, digest, sha):
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        raw_bytes(con, (run_id, sid, digest, sha))
        result = {"schema": "research-pdf-preparation-list/1", "run_id": run_id,
                  "source_id": sid, "source_digest": digest, "pdf_sha256": sha,
                  "preparations": []}
        if "research_pdf_preparations" not in tables(con):
            return result
        rows = con.execute("SELECT id,data FROM research_pdf_preparations WHERE run_id=? "
                           "ORDER BY id LIMIT 1001", (run_id,))
        matches = []
        for index, (pid, raw) in enumerate(rows, 1):
            if index > 1000:
                raise HTTPException(422, "PDF_PREPARATION_LOOKUP_LIMIT")
            artifact = decode_artifact(raw, run_id, pid)
            if (artifact["source_id"], artifact["source_digest"], artifact["pdf_sha256"]) != (
                sid, digest, sha
            ):
                continue
            matches.append({"preparation_id": pid,
                            "preparation_digest": artifact["preparation_digest"],
                            "created_at": artifact["created_at"],
                            "page_count": len(artifact["pages"])})
        result["preparations"] = sorted(
            matches, key=lambda x: (x["created_at"], x["preparation_id"]), reverse=True
        )[:30]
        return result
    finally:
        con.close()


def read(path, run_id, preparation_id):
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        source_rows(con, run_id)
        return read_record(con, run_id, preparation_id)
    finally:
        con.close()
