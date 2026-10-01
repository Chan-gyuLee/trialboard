"""TEAM assertions for stored SOURCE_TEXT only; not PDF/raw/model authorization."""

import json
import sqlite3
from datetime import UTC, datetime

from fastapi import HTTPException
from pydantic import Field

from trialboard.api.projects import UsagePolicyAssertion
from trialboard.api.team_auth import TeamDataPath, current_access_scope
from trialboard.research.models import Collection

PURPOSES = ("original_storage", "internal_search", "external_ai", "training")


class SourcePolicyUpdate(UsagePolicyAssertion):
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_policy_revision: int = Field(ge=0, le=100)


def existing_connection(path):
    database = path.lookup() if isinstance(path, TeamDataPath) else path
    if database is None or not database.exists():
        raise HTTPException(404, "RESEARCH_NOT_FOUND")
    return sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)


def tables(con):
    return {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def initialize(con):
    con.execute("""CREATE TABLE IF NOT EXISTS research_run_owners (
        run_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS research_source_policies (
        run_id TEXT NOT NULL, source_id TEXT NOT NULL, digest TEXT NOT NULL,
        revision INTEGER NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(run_id, source_id, digest, revision))""")
    for operation in ("UPDATE", "DELETE"):
        con.execute(f"""CREATE TRIGGER IF NOT EXISTS source_policy_no_{operation.lower()}
            BEFORE {operation} ON research_source_policies
            BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SOURCE_POLICY'); END""")


def can_manage(con, run_id):
    access = current_access_scope()
    if access is None or access.role == "viewer":
        return False
    if access.role == "admin":
        return True
    if "research_run_owners" not in tables(con):
        return False
    owner = con.execute(
        "SELECT subject_id FROM research_run_owners WHERE run_id=?", (run_id,)
    ).fetchone()
    return bool(owner and owner[0] == access.subject_id)


def current_policy(con, run_id, source_id, digest):
    if "research_source_policies" in tables(con):
        row = con.execute(
            "SELECT data FROM research_source_policies WHERE run_id=? AND source_id=? "
            "AND digest=? ORDER BY revision DESC LIMIT 1", (run_id, source_id, digest)
        ).fetchone()
        if row:
            return json.loads(row[0])
    return {
        "resource_kind": "SOURCE_TEXT", "run_id": run_id, "source_id": source_id,
        "source_digest": digest, "policy_revision": 0,
        **dict.fromkeys(PURPOSES, "UNKNOWN"),
        "evidence_reference": None, "reason": None, "asserted_by": None,
        "created_at": None, "verification": "UNVERIFIED",
    }


def source_rows(con, run_id):
    if "research_runs" not in tables(con) or not con.execute(
        "SELECT 1 FROM research_runs WHERE id=?", (run_id,)
    ).fetchone():
        raise HTTPException(404, "RESEARCH_NOT_FOUND")
    rows = con.execute(
        "SELECT rs.source_id, rs.digest, sv.data FROM research_sources rs "
        "JOIN source_versions sv ON sv.id=rs.source_id AND sv.digest=rs.digest "
        "WHERE rs.run_id=? ORDER BY rs.source_id LIMIT 501", (run_id,)
    ).fetchall()
    if len(rows) > 500:
        raise HTTPException(422, "SOURCE_POLICY_LOOKUP_LIMIT")
    for sid, digest, data in rows:
        source = json.loads(data)
        if source.get("id") != sid or source.get("digest") != digest:
            raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
    return rows


def metadata(path, run_id):
    con = existing_connection(path)
    try:
        return {
            "run_id": run_id, "resource_kind": "SOURCE_TEXT",
            "can_manage": isinstance(path, TeamDataPath) and can_manage(con, run_id),
            "sources": [
                {"source_id": sid, "source_digest": digest,
                 "title": json.loads(data)["title"],
                 "usage_policy": current_policy(con, run_id, sid, digest)}
                for sid, digest, data in source_rows(con, run_id)
            ],
        }
    finally:
        con.close()


def policy_history(path, run_id, source_id):
    con = existing_connection(path)
    try:
        source = next((r for r in source_rows(con, run_id) if r[0] == source_id), None)
        if source is None:
            raise HTTPException(404, "RESEARCH_SOURCE_NOT_FOUND")
        digest = source[1]
        history = []
        if "research_source_policies" in tables(con):
            history = [json.loads(r[0]) for r in con.execute(
                "SELECT data FROM research_source_policies WHERE run_id=? AND source_id=? "
                "AND digest=? ORDER BY revision DESC LIMIT 100", (run_id, source_id, digest)
            )]
        return {"current": current_policy(con, run_id, source_id, digest),
                "history": history,
                "can_manage": isinstance(path, TeamDataPath) and can_manage(con, run_id)}
    finally:
        con.close()


def update_policy(path, run_id, source_id, body):
    if not isinstance(path, TeamDataPath):
        raise HTTPException(404, "TEAM_SOURCE_POLICY_REQUIRED")
    # Lookup is read-only even for a rejected mutation: never initialize a missing DB.
    probe = existing_connection(path)
    try:
        source_rows(probe, run_id)
        if not can_manage(probe, run_id):
            raise HTTPException(403, "SOURCE_POLICY_MANAGEMENT_FORBIDDEN")
    finally:
        probe.close()
    con = sqlite3.connect(path.lookup())
    try:
        with con:
            con.execute("BEGIN IMMEDIATE")
            source = next((r for r in source_rows(con, run_id) if r[0] == source_id), None)
            if source is None:
                raise HTTPException(404, "RESEARCH_SOURCE_NOT_FOUND")
            if source[1] != body.source_digest:
                raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
            if not can_manage(con, run_id):
                raise HTTPException(403, "SOURCE_POLICY_MANAGEMENT_FORBIDDEN")
            current = current_policy(con, run_id, source_id, source[1])
            revision = current["policy_revision"]
            if revision != body.expected_policy_revision:
                raise HTTPException(409, "SOURCE_POLICY_VERSION_CONFLICT")
            if revision >= 100:
                raise HTTPException(422, "SOURCE_POLICY_HISTORY_LIMIT")
            initialize(con)
            value = {
                **body.model_dump(exclude={"expected_policy_revision"}),
                "resource_kind": "SOURCE_TEXT", "run_id": run_id, "source_id": source_id,
                "policy_revision": revision + 1,
                "asserted_by": current_access_scope().subject_id,
                "created_at": datetime.now(UTC).isoformat(),
                "verification": "USER_ATTESTED_UNVERIFIED",
            }
            con.execute("INSERT INTO research_source_policies VALUES (?,?,?,?,?)",
                        (run_id, source_id, source[1], revision + 1, json.dumps(value)))
    finally:
        con.close()
    return policy_history(path, run_id, source_id)


def require_content_con(con, run_id):
    """SOURCE_TEXT and actual RAW dependencies, on the caller's read/write transaction."""
    from trialboard.research.raw_policy import RawReadContext

    context = RawReadContext(con, run_id)
    for source in context.sources.values():
        if current_policy(con, run_id, source.id, source.digest)["original_storage"] != "ALLOW":
            raise HTTPException(403, "RESEARCH_SOURCE_STORAGE_NOT_ALLOWED")
        context.authorize_source(source.id, source.digest)
    return context


def require_content(path, run_id):
    """Conservative whole-run dependency gate, including saved derived artifacts."""
    if not isinstance(path, TeamDataPath):
        return
    con = existing_connection(path)
    try:
        con.execute("BEGIN")
        require_content_con(con, run_id)
    finally:
        con.close()


def read_collection(path, run_id):
    """Read the returned source versions and their policies in one SQLite snapshot."""
    con = existing_connection(path)
    try:
        con.execute("BEGIN")
        if isinstance(path, TeamDataPath):
            require_content_con(con, run_id)
        rows = source_rows(con, run_id)
        run = Collection.model_validate_json(con.execute(
            "SELECT data FROM research_runs WHERE id=?", (run_id,)
        ).fetchone()[0])
        versions = {(sid, digest) for sid, digest, _ in rows}
        for source in run.sources:
            if (source.id, source.digest) not in versions:
                raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
            if isinstance(path, TeamDataPath) and current_policy(
                con, run_id, source.id, source.digest
            )["original_storage"] != "ALLOW":
                raise HTTPException(403, "RESEARCH_SOURCE_STORAGE_NOT_ALLOWED")
        return run
    finally:
        con.close()


def searchable_sources(con, run_id):
    from trialboard.research.raw_policy import RawReadContext

    context, allowed = RawReadContext(con, run_id), []
    for source in context.sources.values():
        if not all(current_policy(con, run_id, source.id, source.digest)[p] == "ALLOW"
                   for p in ("original_storage", "internal_search")):
            continue
        try:
            context.authorize_source(source.id, source.digest, purpose="internal_search")
        except HTTPException as error:
            if error.status_code == 403:
                continue
            raise
        allowed.append((source.id, source.digest))
    return allowed
