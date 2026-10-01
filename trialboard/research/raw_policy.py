"""Exact stored RAW_SNAPSHOT assertions/readers; no automatic SOURCE_TEXT/PDF grants."""

import json
import re
import sqlite3
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field, StrictInt

from trialboard.agent.provider import parse_json
from trialboard.api.projects import UsagePolicyAssertion
from trialboard.api.team_auth import current_access_scope
from trialboard.research.models import Collection
from trialboard.research.saved_review import team_database, utc_now
from trialboard.research.source_policy import (
    PURPOSES,
    can_manage,
    existing_connection,
    source_rows,
    tables,
)
from trialboard.serialization import sha256_json

MAX_RAW_BYTES = 5_000_000
MAX_SOURCE_SNAPSHOTS = 100
MAX_RUN_BINDINGS = 1000
MAX_TOTAL_RAW_BYTES = 25_000_000


class RawPolicyUpdate(UsagePolicyAssertion):
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    snapshot_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_policy_revision: StrictInt = Field(ge=0, le=100)


def sources(con, run_id):
    rows = {sid: (digest, data) for sid, digest, data in source_rows(con, run_id)}
    run = Collection.model_validate_json(con.execute(
        "SELECT data FROM research_runs WHERE id=?", (run_id,)).fetchone()[0])
    if len(rows) != len(run.sources):
        raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
    count = 0
    for source in run.sources:
        row = rows.get(source.id)
        if row is None or source.digest != row[0]:
            raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
        from trialboard.research.source_binding import validate

        validate(con, run, source, row[1])
        refs = source.raw_snapshots
        count += len(refs)
        if len(refs) > MAX_SOURCE_SNAPSHOTS or count > MAX_RUN_BINDINGS:
            raise HTTPException(422, "RAW_BINDING_LOOKUP_LIMIT")
        if len(refs) != len(set(refs)):
            raise HTTPException(409, "RAW_SNAPSHOT_BINDING_MISMATCH")
        for digest in refs:
            if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                raise HTTPException(409, "RAW_SNAPSHOT_BINDING_MISMATCH")
            if "research_links" not in tables(con) or not con.execute(
                "SELECT 1 FROM research_links WHERE run_id=? AND source_id=? "
                "AND relation='RAW_SNAPSHOT' AND target=?", (run_id, source.id, digest)
            ).fetchone():
                raise HTTPException(409, "RAW_SNAPSHOT_BINDING_MISMATCH")
    return run.sources


def binding(con, key):
    run_id, sid, digest, snapshot = key
    source = next((s for s in sources(con, run_id) if s.id == sid), None)
    if source is None:
        raise HTTPException(404, "RESEARCH_SOURCE_NOT_FOUND")
    if source.digest != digest:
        raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
    if snapshot not in source.raw_snapshots:
        raise HTTPException(404, "RAW_SNAPSHOT_NOT_BOUND")
    return source


def snapshot_size(con, digest):
    size = None
    if "snapshots" in tables(con):
        size = con.execute("SELECT length(CAST(raw AS BLOB)) FROM snapshots WHERE digest=?",
                           (digest,)).fetchone()
    if size is None:
        raise HTTPException(404, "RAW_SNAPSHOT_NOT_FOUND")
    if type(size[0]) is not int or not 1 <= size[0] <= MAX_RAW_BYTES:
        raise HTTPException(422, "RAW_SNAPSHOT_SIZE_LIMIT")
    return size[0]


def snapshot(con, digest):
    """Validate a stored JSON object without authorization; private helper for assertions."""
    size = snapshot_size(con, digest)
    raw = con.execute("SELECT raw FROM snapshots WHERE digest=?", (digest,)).fetchone()[0]
    try:
        if not isinstance(raw, str) or len(raw.encode()) != size:
            raise ValueError
        value = parse_json(raw)
        if not isinstance(value, dict) or sha256_json(value) != digest:
            raise ValueError
    except (ValueError, TypeError, RecursionError):
        raise HTTPException(409, "RAW_SNAPSHOT_INTEGRITY_FAILED") from None
    return value, size


def current(con, key):
    run_id, sid, digest, snapshot_digest = key
    empty = {"resource_kind": "RAW_SNAPSHOT", "run_id": run_id, "source_id": sid,
             "source_digest": digest, "snapshot_digest": snapshot_digest, "policy_revision": 0,
             **dict.fromkeys(PURPOSES, "UNKNOWN"), "evidence_reference": None, "reason": None,
             "asserted_by": None, "created_at": None, "verification": "UNVERIFIED"}
    if "research_raw_policies" not in tables(con):
        return empty
    count, first, last = con.execute(
        "SELECT count(*),min(revision),max(revision) FROM research_raw_policies WHERE run_id=? "
        "AND source_id=? AND source_digest=? AND snapshot_digest=?", key).fetchone()
    if count and (first != 1 or count != last or not 1 <= count <= 100):
        raise HTTPException(409, "RAW_POLICY_INTEGRITY_FAILED")
    row = con.execute("SELECT revision,data FROM research_raw_policies WHERE run_id=? "
                      "AND source_id=? AND source_digest=? AND snapshot_digest=? "
                      "ORDER BY revision DESC LIMIT 1", key).fetchone()
    if row is None:
        return empty
    return decode_policy(row, key)


def decode_policy(row, key):
    try:
        revision, raw = row
        if not isinstance(raw, str) or len(raw) > 30000:
            raise ValueError
        value = parse_json(raw)
        expected = {"resource_kind", "run_id", "source_id", "source_digest", "snapshot_digest",
                    "policy_revision", *PURPOSES, "evidence_reference", "reason", "asserted_by",
                    "created_at", "verification"}
        if (not isinstance(value, dict) or set(value) != expected
                or value["resource_kind"] != "RAW_SNAPSHOT"
                or tuple(value[k] for k in (
                    "run_id", "source_id", "source_digest", "snapshot_digest"))
                != key or type(revision) is not int or not 1 <= revision <= 100
                or type(value["policy_revision"]) is not int or value["policy_revision"] != revision
                or value["verification"] != "USER_ATTESTED_UNVERIFIED"
                or str(UUID(value["asserted_by"])) != value["asserted_by"]
                or not isinstance(value["created_at"], str)):
            raise ValueError
        UsagePolicyAssertion.model_validate({k: value[k] for k in (
            *PURPOSES, "evidence_reference", "reason")})
        timestamp = value["created_at"]
        if not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", timestamp
        ):
            raise ValueError
        datetime.fromisoformat(timestamp)  # Reject impossible dates/times, not only bad spelling.
        return value
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(409, "RAW_POLICY_INTEGRITY_FAILED") from None


class RawReadContext:
    """One transaction/run: validate sources once, cap and parse each unique raw only once."""

    def __init__(self, con, run_id):
        if not con.in_transaction:
            raise HTTPException(409, "RAW_SNAPSHOT_TRANSACTION_REQUIRED")
        self.con, self.run_id = con, run_id
        self.sources = {s.id: s for s in sources(con, run_id)}
        self.cache, self.total_bytes = {}, 0

    def _snapshot(self, digest):
        if not self.con.in_transaction:
            raise HTTPException(409, "RAW_SNAPSHOT_TRANSACTION_REQUIRED")
        if digest not in self.cache:
            size = snapshot_size(self.con, digest)
            if self.total_bytes + size > MAX_TOTAL_RAW_BYTES:
                raise HTTPException(422, "RAW_SNAPSHOT_TOTAL_SIZE_LIMIT")
            self.cache[digest] = snapshot(self.con, digest)
            self.total_bytes += size
        return self.cache[digest]

    def read(self, key, *, purpose="original_storage"):
        if purpose not in PURPOSES:
            raise ValueError("UNKNOWN_RAW_PURPOSE")
        run_id, sid, digest, snapshot_digest = key
        source = self.sources.get(sid)
        if (run_id != self.run_id or source is None or source.digest != digest
                or snapshot_digest not in source.raw_snapshots):
            raise HTTPException(409, "RAW_SNAPSHOT_BINDING_MISMATCH")
        policy = current(self.con, key)
        if any(policy[p] != "ALLOW" for p in ("original_storage", purpose)):
            raise HTTPException(403, "RAW_SNAPSHOT_USAGE_NOT_ALLOWED")
        return self._snapshot(snapshot_digest)[0]

    def authorize_source(self, sid, digest, *, purpose="original_storage"):
        source = self.sources.get(sid)
        if source is None or source.digest != digest:
            raise HTTPException(409, "RAW_SNAPSHOT_BINDING_MISMATCH")
        revisions = {}
        for snapshot_digest in source.raw_snapshots:
            key = (self.run_id, sid, digest, snapshot_digest)
            self.read(key, purpose=purpose)
            revisions[(sid, digest, snapshot_digest)] = current(self.con, key)["policy_revision"]
        return revisions


def read_snapshot(con, key, *, purpose="original_storage"):
    return RawReadContext(con, key[0]).read(key, purpose=purpose)


def metadata(path, run_id):
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        result = {"run_id": run_id, "resource_kind": "RAW_SNAPSHOT",
                  "can_manage": can_manage(con, run_id), "sources": []}
        context = RawReadContext(con, run_id)
        for source in context.sources.values():
            versions = []
            for digest in source.raw_snapshots:
                _, byte_length = context._snapshot(digest)
                key = (run_id, source.id, source.digest, digest)
                versions.append({"snapshot_digest": digest, "byte_length": byte_length,
                                 "usage_policy": current(con, key)})
            result["sources"].append({"source_id": source.id, "source_digest": source.digest,
                                      "title": source.title, "snapshots": versions})
        return result
    finally:
        con.close()


def history(path, key):
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        binding(con, key)
        snapshot(con, key[3])
        rows = []
        if "research_raw_policies" in tables(con):
            rows = con.execute("SELECT revision,data FROM research_raw_policies WHERE run_id=? "
                "AND source_id=? AND source_digest=? AND snapshot_digest=? ORDER BY revision DESC "
                "LIMIT 101", key).fetchall()
        if len(rows) > 100:
            raise HTTPException(422, "RAW_POLICY_HISTORY_LIMIT")
        values = [decode_policy(row, key) for row in rows]
        if any(datetime.fromisoformat(a["created_at"]) < datetime.fromisoformat(b["created_at"])
               for a, b in zip(values, values[1:], strict=False)):
            raise HTTPException(409, "RAW_POLICY_INTEGRITY_FAILED")
        return {"current": current(con, key), "history": values,
                "can_manage": can_manage(con, key[0])}
    finally:
        con.close()


def update(path, identity, run_id, sid, body):
    database, access = team_database(path), current_access_scope()
    key = (run_id, sid, body.source_digest, body.snapshot_digest)
    with sqlite3.connect(database) as con:
        con.execute("BEGIN IMMEDIATE")
        binding(con, key)
        snapshot(con, key[3])
        fresh = identity.revalidate(access) if identity and access else None
        if (fresh is None or fresh.role not in ("admin", "reviewer")
                or (fresh.subject_id, fresh.team_id, fresh.role)
                != (access.subject_id, access.team_id, access.role)):
            raise HTTPException(403, "RAW_POLICY_IDENTITY_INVALIDATED")
        if not can_manage(con, run_id):
            raise HTTPException(403, "RAW_POLICY_MANAGEMENT_FORBIDDEN")
        previous = current(con, key)["policy_revision"]
        if previous != body.expected_policy_revision:
            raise HTTPException(409, "RAW_POLICY_VERSION_CONFLICT")
        if previous >= 100:
            raise HTTPException(422, "RAW_POLICY_HISTORY_LIMIT")
        con.execute("""CREATE TABLE IF NOT EXISTS research_raw_policies (
            run_id TEXT,source_id TEXT,source_digest TEXT,snapshot_digest TEXT,
            revision INTEGER,data TEXT,
            PRIMARY KEY(run_id,source_id,source_digest,snapshot_digest,revision))""")
        for operation in ("UPDATE", "DELETE"):
            con.execute(f"""CREATE TRIGGER IF NOT EXISTS raw_policy_no_{operation.lower()}
                BEFORE {operation} ON research_raw_policies
                BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RAW_POLICY'); END""")
        value = {**body.model_dump(exclude={"expected_policy_revision"}),
                 "resource_kind": "RAW_SNAPSHOT", "run_id": run_id, "source_id": sid,
                 "policy_revision": previous + 1, "asserted_by": access.subject_id,
                 "created_at": utc_now(), "verification": "USER_ATTESTED_UNVERIFIED"}
        con.execute("INSERT INTO research_raw_policies VALUES (?,?,?,?,?,?)",
                    (*key, previous + 1, json.dumps(value, ensure_ascii=False)))
    return history(path, key)
