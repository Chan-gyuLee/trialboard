"""Canonical content is global; discovery provenance is an immutable per-run record."""

import json
import re
from datetime import datetime

from fastapi import HTTPException

from trialboard.research.models import Source
from trialboard.serialization import sha256_json

PROVENANCE = {"fetched_at", "link_basis", "raw_snapshots"}


def initialize(con):
    con.execute("""CREATE TABLE IF NOT EXISTS research_source_provenance (
        run_id TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL,
        digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,source_id,revision))""")
    for operation in ("UPDATE", "DELETE"):
        con.execute(f"""CREATE TRIGGER IF NOT EXISTS source_provenance_no_{operation.lower()}
            BEFORE {operation} ON research_source_provenance
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOURCE_PROVENANCE'); END""")


def record(con, run, item):
    initialize(con)
    data = {k: item.model_dump()[k] for k in PROVENANCE}
    data.update(source_digest=item.digest, request_digest=sha256_json(run.request.model_dump()))
    if con.execute("SELECT 1 FROM sqlite_master WHERE name='research_raw_captures'").fetchone():
        receipts = con.execute(
            "SELECT digest,snapshot_digest FROM research_raw_captures WHERE run_id=?", (run.id,)
        ).fetchall()
        if receipts:
            data["capture_receipts"] = sorted(d for d, raw in receipts if raw in item.raw_snapshots)
    digest = sha256_json(data)
    row = con.execute(
        "SELECT revision,digest FROM research_source_provenance WHERE run_id=? "
        "AND source_id=? ORDER BY revision DESC LIMIT 1",
        (run.id, item.id),
    ).fetchone()
    if row and row[1] == digest:
        return
    revision = row[0] + 1 if row else 1
    if revision > 100:
        raise ValueError("SOURCE_PROVENANCE_LIMIT")
    con.execute(
        "INSERT INTO research_source_provenance VALUES (?,?,?,?,?)",
        (run.id, item.id, revision, digest, json.dumps(data, ensure_ascii=False)),
    )


def validate(con, run, item, raw):
    try:
        stored = Source.model_validate_json(raw)
        if item.model_dump(exclude=PROVENANCE) != stored.model_dump(exclude=PROVENANCE):
            raise ValueError
        if not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", item.fetched_at
        ):
            raise ValueError
        datetime.fromisoformat(item.fetched_at)
        if any(len(values) != len(set(values)) for values in (item.link_basis, item.raw_snapshots)):
            raise ValueError
        links = set(
            con.execute(
                "SELECT relation,target FROM research_links WHERE run_id=? AND source_id=?",
                (run.id, item.id),
            ).fetchall()
        )
        expected = {("LINK_BASIS", v) for v in item.link_basis} | {
            ("RAW_SNAPSHOT", v) for v in item.raw_snapshots
        }
        if links != expected:
            raise ValueError
        exists = con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_source_provenance'"
        ).fetchone()
        row = (
            con.execute(
                "SELECT digest,data FROM research_source_provenance WHERE run_id=? "
                "AND source_id=? ORDER BY revision DESC LIMIT 1",
                (run.id, item.id),
            ).fetchone()
            if exists
            else None
        )
        if row:
            data = json.loads(row[1])
            expected = {k: item.model_dump()[k] for k in PROVENANCE}
            expected.update(
                source_digest=item.digest, request_digest=sha256_json(run.request.model_dump())
            )
            if "capture_receipts" in data:
                covered = set()
                for digest in data["capture_receipts"]:
                    receipt = con.execute(
                        "SELECT run_id,snapshot_digest,data FROM research_raw_captures "
                        "WHERE digest=?",
                        (digest,),
                    ).fetchone()
                    if receipt is None:
                        raise ValueError
                    value = json.loads(receipt[2])
                    if (
                        sha256_json(value) != digest
                        or receipt[0] != run.id
                        or value["run_id"] != run.id
                        or value["snapshot_digest"] != receipt[1]
                        or value["request_digest"] != expected["request_digest"]
                        or receipt[1] not in item.raw_snapshots
                    ):
                        raise ValueError
                    covered.add(receipt[1])
                if covered != set(item.raw_snapshots):
                    raise ValueError
                expected["capture_receipts"] = data["capture_receipts"]
            if data != expected or sha256_json(data) != row[0]:
                raise ValueError
        elif item != stored:
            raise ValueError  # Old records without a receipt keep the strict legacy binding.
    except (ValueError, TypeError, KeyError):
        raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH") from None
    return item
