"""Local append-only source versions; independently recoverable collection runs."""

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from trialboard.api.scout import EvidenceStore
from trialboard.research.models import Collection, CurationInput, ResearchRequest
from trialboard.serialization import sha256_json


class ResearchStore(EvidenceStore):
    def __init__(self, path: Path):
        super().__init__(path)

    def connect(self):
        con = super().connect()
        con.execute("""CREATE TABLE IF NOT EXISTS research_runs (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL,
            data TEXT NOT NULL)""")
        con.execute("""CREATE INDEX IF NOT EXISTS idx_research_project_time
            ON research_runs(project_id, created_at)""")
        con.execute("""CREATE TABLE IF NOT EXISTS source_versions (
            id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL,
            PRIMARY KEY(id, digest))""")
        con.execute("""CREATE TABLE IF NOT EXISTS research_sources (
            run_id TEXT NOT NULL REFERENCES research_runs(id), source_id TEXT NOT NULL,
            digest TEXT NOT NULL, PRIMARY KEY(run_id, source_id),
            FOREIGN KEY(source_id, digest) REFERENCES source_versions(id, digest))""")
        con.execute("""CREATE TABLE IF NOT EXISTS research_links (
            run_id TEXT NOT NULL REFERENCES research_runs(id), source_id TEXT NOT NULL,
            relation TEXT NOT NULL, target TEXT NOT NULL,
            PRIMARY KEY(run_id, source_id, relation, target))""")
        con.execute("""CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(
            source_id UNINDEXED, digest UNINDEXED, title, body)""")
        con.execute("""CREATE TABLE IF NOT EXISTS research_curation (
            run_id TEXT NOT NULL REFERENCES research_runs(id), source_id TEXT NOT NULL,
            revision INTEGER NOT NULL, data TEXT NOT NULL,
            PRIMARY KEY(run_id, source_id, revision))""")
        return con

    def curate(self, run_id: str, note: CurationInput) -> dict:
        run = self.get_run(run_id)
        item = next((s for s in run.sources if s.id == note.source_id), None) if run else None
        if not item:
            raise ValueError("RESEARCH_SOURCE_NOT_FOUND")
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                revision = con.execute(
                    "SELECT COALESCE(MAX(revision), 0) FROM research_curation "
                    "WHERE run_id=? AND source_id=?",
                    (run_id, note.source_id),
                ).fetchone()[0]
                if revision != note.expected_revision:
                    raise ValueError("CURATION_VERSION_CONFLICT")
                if revision >= 100:
                    raise ValueError("CURATION_HISTORY_LIMIT")
                value = {
                    "run_id": run_id,
                    "source_id": item.id,
                    "source_digest": item.digest,
                    "revision": revision + 1,
                    "decision": note.decision,
                    "reason": note.reason,
                    "reviewer_label": note.reviewer_label,
                    "reviewer_authenticated": False,
                    "clinical_verified": False,
                    "created_at": datetime.now(UTC).isoformat(),
                }
                con.execute(
                    "INSERT INTO research_curation VALUES (?,?,?,?)",
                    (
                        run_id,
                        item.id,
                        revision + 1,
                        json.dumps(value, ensure_ascii=False),
                    ),
                )
                return value
        finally:
            con.close()

    def curation(self, run_id: str, source_id: str | None = None) -> list[dict]:
        con = self.connect()
        try:
            if source_id:
                rows = con.execute(
                    "SELECT data FROM research_curation WHERE run_id=? AND source_id=? "
                    "ORDER BY revision DESC LIMIT 100",
                    (run_id, source_id),
                ).fetchall()
            else:
                rows = con.execute(
                    """SELECT c.data FROM research_curation c
                    JOIN (SELECT source_id, MAX(revision) AS rev FROM research_curation
                    WHERE run_id=? GROUP BY source_id) latest
                    ON latest.source_id=c.source_id AND latest.rev=c.revision
                    WHERE c.run_id=? ORDER BY c.source_id""",
                    (run_id, run_id),
                ).fetchall()
            return [json.loads(r[0]) for r in rows]
        finally:
            con.close()

    def start(self, request: ResearchRequest) -> Collection:
        base = self.read(request.search_id)
        if not base:
            raise ValueError("SEARCH_NOT_FOUND")
        studies = [s for s in base["studies"] if s["nct_id"] == request.nct_id]
        if len(studies) != 1 or request.indication not in studies[0]["conditions"]:
            raise ValueError("SELECTED_TRIAL_CONTEXT_MISMATCH")
        context = {
            k: getattr(request, k).strip().casefold() for k in ("asset", "indication", "nct_id")
        }
        run = Collection(
            id=str(uuid4()),
            project_id=sha256_json(context),
            created_at=datetime.now(UTC).isoformat(),
            request=request,
            status="RUNNING",
            sources=[],
            coverage=[],
            events=[],
        )
        self.save_run(run)
        return run

    def save_run(self, run: Collection):
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                previous = con.execute(
                    "SELECT data FROM research_runs WHERE id=?", (run.id,)
                ).fetchone()
                if previous and any(
                    e.get("stage") == "RECOVERED" for e in json.loads(previous[0])["events"]
                ):
                    raise ValueError("RECOVERED_RUN_IS_CLOSED")
                con.execute(
                    """INSERT INTO research_runs VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET data=excluded.data""",
                    (run.id, run.project_id, run.created_at, run.model_dump_json()),
                )
                for source in run.sources:
                    inserted = con.execute(
                        "INSERT OR IGNORE INTO source_versions VALUES (?, ?, ?)",
                        (source.id, source.digest, source.model_dump_json()),
                    )
                    if inserted.rowcount:
                        con.execute(
                            "INSERT INTO source_fts VALUES (?,?,?,?)",
                            (source.id, source.digest, source.title, source.text),
                        )
                    for relation, targets in (
                        ("LINK_BASIS", source.link_basis),
                        ("RAW_SNAPSHOT", source.raw_snapshots),
                    ):
                        for target in targets:
                            con.execute(
                                "INSERT OR IGNORE INTO research_links VALUES (?,?,?,?)",
                                (run.id, source.id, relation, target),
                            )
                    con.execute(
                        """INSERT INTO research_sources VALUES (?, ?, ?)
                        ON CONFLICT(run_id, source_id) DO UPDATE SET digest=excluded.digest""",
                        (run.id, source.id, source.digest),
                    )
        finally:
            con.close()

    def get_run(self, run_id: str) -> Collection | None:
        con = self.connect()
        try:
            row = con.execute("SELECT data FROM research_runs WHERE id=?", (run_id,)).fetchone()
            return Collection.model_validate_json(row[0]) if row else None
        finally:
            con.close()

    def recover_run(self, run_id: str, *, now: datetime | None = None) -> Collection:
        """Explicitly close an expired run; preserve partial data and fence late writers.

        Not process termination/resumption. The API job budget is 240 s. Require
        300 s without a stored event as well as 300 s since creation, so another
        local worker with recent activity cannot be labelled interrupted.
        """
        now = now or datetime.now(UTC)
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                row = con.execute("SELECT data FROM research_runs WHERE id=?", (run_id,)).fetchone()
                if not row:
                    raise ValueError("RESEARCH_NOT_FOUND")
                run = Collection.model_validate_json(row[0])
                if any(e.get("stage") == "RECOVERED" for e in run.events):
                    return run
                if run.status != "RUNNING":
                    raise ValueError("RUN_NOT_RECOVERABLE")
                elapsed = (now - datetime.fromisoformat(run.created_at)).total_seconds()
                last_ms = max((e.get("elapsed_ms", 0) for e in run.events), default=0)
                if elapsed < 300 or elapsed - last_ms / 1000 < 300:
                    raise ValueError("RUN_MAY_BE_ACTIVE")
                run.status = "CANCELLED"
                message = (
                    "갱신이 멈춘 실행을 중단 기록으로 정리했습니다. "
                    "부분 자료는 보존했고 새 검색·모델 호출은 하지 않았습니다."
                )
                run.notices.append(message)
                run.events.append(
                    {
                        "run_id": run.id,
                        "sequence": len(run.events) + 1,
                        "stage": "RECOVERED",
                        "elapsed_ms": round(elapsed * 1000),
                        "message": message,
                        "recovered_at": now.isoformat(),
                    }
                )
                con.execute(
                    "UPDATE research_runs SET data=? WHERE id=?", (run.model_dump_json(), run.id)
                )
                return run
        finally:
            con.close()

    def list_runs(self) -> list[dict]:
        if not self.path.exists():
            return []
        con = self.connect()
        try:
            rows = con.execute(
                "SELECT data FROM research_runs ORDER BY created_at DESC LIMIT 30"
            ).fetchall()
            return [
                {
                    k: v
                    for k, v in json.loads(row[0]).items()
                    if k in ("id", "project_id", "created_at", "request", "status")
                }
                for row in rows
            ]
        finally:
            con.close()

    def snapshot(self, data: dict) -> str:
        raw = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        digest = sha256_json(data)
        con = self.connect()
        try:
            with con:
                con.execute("INSERT OR IGNORE INTO snapshots VALUES (?,?)", (digest, raw))
        finally:
            con.close()
        return digest

    def previous_changes(self, run: Collection) -> dict:
        con = self.connect()
        try:
            row = con.execute(
                """SELECT data FROM research_runs
                WHERE project_id=? AND created_at<? AND id<>?
                ORDER BY created_at DESC LIMIT 1""",
                (run.project_id, run.created_at, run.id),
            ).fetchone()
        finally:
            con.close()
        if not row:
            return {"previous_id": None, "added": [], "changed": [], "not_retrieved": []}
        previous = Collection.model_validate_json(row[0])
        old = {s.id: s.digest for s in previous.sources}
        new = {s.id: s.digest for s in run.sources}
        return {
            "previous_id": previous.id,
            "added": sorted(new.keys() - old.keys()),
            "changed": sorted(k for k in new.keys() & old.keys() if new[k] != old[k]),
            "not_retrieved": sorted(old.keys() - new.keys()),
        }

    def search_sources(self, run_id: str, query: str) -> list[dict]:
        import re

        terms = re.findall(r"\w+", query)[:8]
        if not terms:
            return []
        match = " AND ".join('"' + term + '"' for term in terms)
        con = self.connect()
        try:
            rows = con.execute(
                """SELECT source_fts.source_id, source_fts.title,
                snippet(source_fts, 3, '[', ']', '…', 24) FROM source_fts
                JOIN research_sources rs ON rs.source_id=source_fts.source_id
                    AND rs.digest=source_fts.digest
                WHERE rs.run_id=? AND source_fts MATCH ? ORDER BY rank LIMIT 20""",
                (run_id, match),
            ).fetchall()
            return [{"source_id": r[0], "title": r[1], "snippet": r[2]} for r in rows]
        finally:
            con.close()
