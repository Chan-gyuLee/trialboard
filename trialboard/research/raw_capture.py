"""Per-request TEAM collector permission; explicit storage only, never model permission."""

import json
import sqlite3
from datetime import UTC, datetime

from fastapi import HTTPException

from trialboard.api.team_auth import TeamDataPath, current_access_scope
from trialboard.research.models import Collection, Coverage
from trialboard.research.source_policy import can_manage
from trialboard.serialization import sha256_json


class CaptureGuard:
    def __init__(self, path, identity, access, run):
        self.path, self.identity, self.access = path, identity, access
        self.run_id, self.request = run.id, run.request.model_copy(deep=True)
        self.database = path.lookup()
        self.permissions = {p.collector: p for p in self.request.raw_storage_permissions}
        self.receipts = {}

    def check(self, run, con=None):
        scope = current_access_scope()
        fresh = self.identity.revalidate(self.access) if self.identity and self.access else None
        if (
            fresh is None
            or scope is None
            or fresh.role not in ("admin", "reviewer")
            or (fresh.subject_id, fresh.team_id, fresh.role)
            != (self.access.subject_id, self.access.team_id, self.access.role)
            or (scope.subject_id, scope.team_id) != (fresh.subject_id, fresh.team_id)
            or self.path.lookup() != self.database
            or run.id != self.run_id
            or run.request != self.request
        ):
            raise HTTPException(403, "RAW_CAPTURE_IDENTITY_INVALIDATED")
        own = con is None
        if own:
            con = sqlite3.connect(self.database.resolve().as_uri() + "?mode=ro", uri=True)
        try:
            row = con.execute("SELECT data FROM research_runs WHERE id=?", (run.id,)).fetchone()
            if row is None or Collection.model_validate_json(row[0]).request != self.request:
                raise HTTPException(409, "RAW_CAPTURE_REQUEST_CHANGED")
            if not can_manage(con, run.id):
                raise HTTPException(403, "RAW_CAPTURE_OWNER_REQUIRED")
        finally:
            if own:
                con.close()

    def capture(self, store, run, collector, query, data):
        self.check(run)
        permission = self.permissions.get(collector)
        if permission is None:
            raise HTTPException(403, "RAW_STORAGE_PERMISSION_REQUIRED")
        encoded = json.dumps(data, ensure_ascii=False, allow_nan=False)
        if not isinstance(data, dict) or len(encoded.encode()) > 5_000_000:
            raise ValueError("RAW_CAPTURE_SIZE_LIMIT")
        digest = sha256_json(data)
        sizes = {key: value["byte_length"] for key, value in self.receipts.items()}
        sizes[digest] = len(encoded.encode())
        if sum(sizes.values()) > 25_000_000 or len(sizes) > 100:
            raise ValueError("RAW_CAPTURE_TOTAL_LIMIT")
        receipt = {
            "run_id": run.id,
            "snapshot_digest": digest,
            "collector": collector,
            "query": query,
            "byte_length": sizes[digest],
            "request_digest": sha256_json(self.request.model_dump()),
            "permission": permission.model_dump(),
            "asserted_by": self.access.subject_id,
            "created_at": datetime.now(UTC).isoformat(),
        }
        receipt_digest = sha256_json(receipt)
        con = store.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                self.check(run, con)
                con.execute("""CREATE TABLE IF NOT EXISTS research_raw_captures (
                    digest TEXT PRIMARY KEY,run_id TEXT NOT NULL,snapshot_digest TEXT NOT NULL,
                    data TEXT NOT NULL)""")
                for operation in ("UPDATE", "DELETE"):
                    con.execute(f"""CREATE TRIGGER IF NOT EXISTS raw_capture_no_{operation.lower()}
                        BEFORE {operation} ON research_raw_captures
                        BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RAW_CAPTURE'); END""")
                con.execute(
                    "INSERT OR IGNORE INTO snapshots(digest,raw) VALUES (?,?)", (digest, encoded)
                )
                from trialboard.research.raw_policy import snapshot

                snapshot(con, digest)
                con.execute(
                    "INSERT INTO research_raw_captures VALUES (?,?,?,?)",
                    (receipt_digest, run.id, digest, json.dumps(receipt)),
                )
        finally:
            con.close()
        self.receipts[digest] = receipt
        return digest

    def bind(self, con, run, source):
        self.check(run, con)
        for digest in source.raw_snapshots:
            receipt = self.receipts.get(digest)
            if receipt is None:
                raise ValueError("RAW_CAPTURE_RECEIPT_REQUIRED")
            key = (run.id, source.id, source.digest, digest)
            con.execute("""CREATE TABLE IF NOT EXISTS research_raw_policies (
                run_id TEXT,source_id TEXT,source_digest TEXT,snapshot_digest TEXT,
                revision INTEGER,data TEXT,
                PRIMARY KEY(run_id,source_id,source_digest,snapshot_digest,revision))""")
            if con.execute(
                "SELECT 1 FROM research_raw_policies WHERE run_id=? AND source_id=? "
                "AND source_digest=? AND snapshot_digest=?",
                key,
            ).fetchone():
                continue  # Never overwrite a later user's DENY/UNKNOWN with the capture assertion.
            for operation in ("UPDATE", "DELETE"):
                con.execute(f"""CREATE TRIGGER IF NOT EXISTS raw_policy_no_{operation.lower()}
                    BEFORE {operation} ON research_raw_policies
                    BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RAW_POLICY'); END""")
            permission = receipt["permission"]
            value = {
                "resource_kind": "RAW_SNAPSHOT",
                "run_id": run.id,
                "source_id": source.id,
                "source_digest": source.digest,
                "snapshot_digest": digest,
                "policy_revision": 1,
                "original_storage": "ALLOW",
                "internal_search": "UNKNOWN",
                "external_ai": "UNKNOWN",
                "training": "UNKNOWN",
                "evidence_reference": permission["evidence_reference"],
                "reason": permission["reason"],
                "asserted_by": receipt["asserted_by"],
                "created_at": receipt["created_at"],
                "verification": "USER_ATTESTED_UNVERIFIED",
            }
            con.execute(
                "INSERT INTO research_raw_policies VALUES (?,?,?,?,?,?)",
                (*key, 1, json.dumps(value)),
            )


def permitted(store, run, collector, channel, query):
    if not isinstance(store.path, TeamDataPath):
        return True
    guard = store.capture_guard
    if guard is None:
        raise HTTPException(403, "RAW_CAPTURE_GUARD_REQUIRED")
    guard.check(run)
    if collector in guard.permissions:
        return True
    run.coverage.append(
        Coverage(
            channel=channel, query=query, status="SKIPPED", total=None, fetched=0, limited=False
        )
    )
    notice = (f"{channel}: 원본 저장 권리 진술이 없어 네트워크 요청을 생략했습니다. "
              "수집 조건을 명시하세요.")
    if notice not in run.notices:
        run.notices.append(notice)
    return False


def capture(store, run, collector, query, data):
    if isinstance(store.path, TeamDataPath):
        if store.capture_guard is None:
            raise HTTPException(403, "RAW_CAPTURE_GUARD_REQUIRED")
        return store.capture_guard.capture(store, run, collector, query, data)
    return store.snapshot(data)
