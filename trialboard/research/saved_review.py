"""Immutable, selected SOURCE_TEXT review attempts. Never grants PDF/raw rights."""

import json
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from pydantic import Field, StrictBool, StrictInt, model_validator

from trialboard.api.model_policy import ModelPolicyDenied
from trialboard.api.team_auth import TeamDataPath, current_access_scope
from trialboard.research.citations import citation_context
from trialboard.research.models import Collection, Contract
from trialboard.research.source_policy import (
    current_policy,
    existing_connection,
    source_rows,
    tables,
)


class SavedBinding(Contract):
    source_id: str = Field(min_length=1, max_length=150)
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    policy_revision: StrictInt = Field(ge=1, le=100)


class SavedReviewRequest(Contract):
    model_consent: StrictBool
    source_bindings: list[SavedBinding] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def explicit_consent(self):
        ids = [b.source_id for b in self.source_bindings]
        if self.model_consent is not True or len(set(ids)) != len(ids):
            raise ValueError("SAVED_REVIEW_EXPLICIT_CONSENT_AND_UNIQUE_SOURCES_REQUIRED")
        return self


def utc_now():
    return datetime.now(UTC).isoformat()


def team_database(path):
    if not isinstance(path, TeamDataPath):
        raise HTTPException(404, "SAVED_REVIEW_TEAM_REQUIRED")
    database = path.lookup()
    if database is None or not database.exists():
        raise HTTPException(404, "RESEARCH_NOT_FOUND")
    return database


def selected(con, run_id, bindings, *, outgoing, raw_revisions=None):
    from trialboard.research.raw_policy import RawReadContext

    raw_context = RawReadContext(con, run_id)
    rows = {sid: (digest, data) for sid, digest, data in source_rows(con, run_id)}
    raw = con.execute("SELECT data FROM research_runs WHERE id=?", (run_id,)).fetchone()
    run = Collection.model_validate_json(raw[0])
    originals = {s.id: s for s in run.sources}
    sources = []
    for binding in bindings:
        sid, digest = binding["source_id"], binding["source_digest"]
        if sid not in rows:
            raise HTTPException(404 if outgoing else 409, "RESEARCH_SOURCE_NOT_FOUND")
        if rows[sid][0] != digest:
            raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
        source = originals.get(sid)
        if source is None:
            raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
        if not source.title.strip() or len(source.title) > 20000:
            raise HTTPException(422, "SAVED_REVIEW_SOURCE_METADATA_LIMIT")
        policy = current_policy(con, run_id, sid, digest)
        purposes = ("original_storage", "external_ai") if outgoing else ("original_storage",)
        if any(policy[purpose] != "ALLOW" for purpose in purposes):
            raise HTTPException(403, "SAVED_REVIEW_USAGE_NOT_ALLOWED")
        if outgoing and policy["policy_revision"] != binding["policy_revision"]:
            raise HTTPException(409, "SOURCE_POLICY_VERSION_CONFLICT")
        revisions = raw_context.authorize_source(
            sid, digest, purpose="external_ai" if outgoing else "original_storage")
        if outgoing and raw_revisions is not None:
            if any(key in raw_revisions and raw_revisions[key] != revision
                   for key, revision in revisions.items()):
                raise HTTPException(409, "RAW_POLICY_VERSION_CONFLICT")
            raw_revisions.update(revisions)
        sources.append(source)
    context = {"asset": run.request.asset, "indication": run.request.indication,
               "nct_id": run.request.nct_id}
    return context, sources


class SavedReviewGate:
    def __init__(self, path, identity, access, run_id, bindings):
        self.database = team_database(path)
        self.identity, self.access = identity, access
        self.run_id, self.bindings = run_id, bindings
        self.raw_revisions = {}
        self.context, self.sources = self.inspect()
        payload_sources, self.anchors, self.schema = citation_context(self.sources)
        self.schema["properties"]["questions"]["items"].update(minLength=1, maxLength=700)
        self.payload = {**self.context, "sources": payload_sources}

    def inspect(self):
        scope = current_access_scope()
        fresh = self.identity.revalidate(self.access) if self.identity and self.access else None
        if (fresh is None or scope is None or fresh.role not in ("admin", "reviewer")
                or (fresh.subject_id, fresh.team_id) != (scope.subject_id, scope.team_id)
                or (fresh.subject_id, fresh.team_id)
                != (self.access.subject_id, self.access.team_id)):
            raise HTTPException(403, "MODEL_IDENTITY_INVALIDATED")
        con = existing_connection(self.database)
        try:
            con.execute("BEGIN")
            return selected(con, self.run_id, self.bindings, outgoing=True,
                            raw_revisions=self.raw_revisions)
        finally:
            con.close()

    def check(self, payload):
        try:
            context, sources = self.inspect()
            if context != self.context or sources != self.sources or payload != self.payload:
                raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
            if len(json.dumps(payload)) > 2_000_000:
                raise HTTPException(422, "SAVED_REVIEW_PAYLOAD_LIMIT")
        except (HTTPException, sqlite3.Error, ValueError, TypeError, KeyError):
            raise ModelPolicyDenied("MODEL_RESEARCH_SAVED_POLICY_DENIED") from None


def initialize(con):
    con.execute("""CREATE TABLE IF NOT EXISTS research_saved_review_records (
        attempt_id TEXT NOT NULL, phase INTEGER NOT NULL CHECK(phase IN (0,1)),
        run_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(attempt_id, phase))""")
    for operation in ("UPDATE", "DELETE"):
        con.execute(f"""CREATE TRIGGER IF NOT EXISTS saved_review_no_{operation.lower()}
            BEFORE {operation} ON research_saved_review_records
            BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SAVED_REVIEW'); END""")


def persist(database, artifact, phase):
    with sqlite3.connect(database) as con:
        con.execute("BEGIN IMMEDIATE")
        initialize(con)
        if phase == 1 and not con.execute(
            "SELECT 1 FROM research_saved_review_records WHERE attempt_id=? AND phase=0",
            (artifact["attempt_id"],),
        ).fetchone():
            raise ValueError("SAVED_REVIEW_START_REQUIRED")
        con.execute("INSERT INTO research_saved_review_records VALUES (?,?,?,?,?)", (
            artifact["attempt_id"], phase, artifact["run_id"], artifact["created_at"],
            json.dumps(artifact, ensure_ascii=False, allow_nan=False),
        ))


def start_artifact(gate):
    return {
        "schema": "research-saved-review/1", "mode": "SAVED_REVIEW_ONLY",
        "run_id": gate.run_id, "attempt_id": str(uuid4()), "status": "RUNNING",
        "created_at": utc_now(), "completed_at": None,
        "asserted_by": gate.access.subject_id, "context": gate.context,
        "source_bindings": gate.bindings,
        "sources": [{"source_id": s.id, "source_digest": s.digest, "title": s.title}
                    for s in gate.sources],
        "collector_calls": 0, "plan_calls": 0, "model_calls": 0,
        "execution_mode": "COLLECTORS_ONLY", "model": None, "response_id": None,
        "input_tokens": None, "output_tokens": None, "review": None,
        "citation_bindings": [], "error_code": None,
        "notices": ["선택한 저장 출처만 1회 재검토합니다. 수집·계획·후속검색은 실행하지 않습니다.",
                    "SOURCE_TEXT 허가는 PDF/raw 허가 또는 임상 검증을 뜻하지 않습니다."],
    }


def attempts(path, run_id, attempt_id=None):
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        source_rows(con, run_id)
        rows = []
        if "research_saved_review_records" in tables(con):
            rows = con.execute("""SELECT r.data FROM research_saved_review_records r
                WHERE r.run_id=? AND (? IS NULL OR r.attempt_id=?) AND r.phase=(
                    SELECT MAX(s.phase) FROM research_saved_review_records s
                    WHERE s.attempt_id=r.attempt_id)
                ORDER BY r.created_at DESC, r.attempt_id DESC LIMIT 30""",
                (run_id, attempt_id, attempt_id)).fetchall()
        if attempt_id is None:
            keys = ("attempt_id", "run_id", "status", "created_at", "completed_at", "model_calls")
            return {"run_id": run_id,
                    "attempts": [{k: json.loads(row[0])[k] for k in keys} for row in rows]}
        if not rows:
            raise HTTPException(404, "SAVED_REVIEW_NOT_FOUND")
        artifact = json.loads(rows[0][0])
        context, _ = selected(con, run_id, artifact["source_bindings"], outgoing=False)
        if context != artifact["context"]:
            raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
        return artifact
    finally:
        con.close()
