"""SQLite evidence graph.

One table per entity, each row = (id, a few indexed columns, JSON payload of the
Pydantic model). Simple, portable, and the whole graph ships as one file with
the demo. Swap the engine URL for Postgres later without touching callers.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import JSON, Column, MetaData, String, Table, create_engine, select, text
from sqlalchemy.engine import Engine

from trialboard.core.schemas import Claim, LineageEdge, LineageNode, Manifest, Source, Span

T = TypeVar("T", bound=BaseModel)

DEFAULT_DB = Path(os.environ.get("TRIALBOARD_DATA", "data")) / "db" / "trialboard.sqlite"

metadata = MetaData()

sources = Table(
    "sources",
    metadata,
    Column("id", String, primary_key=True),
    Column("type", String, index=True),
    Column("content_hash", String, index=True),
    Column("payload", JSON, nullable=False),
)
spans = Table(
    "spans",
    metadata,
    Column("id", String, primary_key=True),
    Column("source_id", String, index=True),
    Column("payload", JSON, nullable=False),
)
claims = Table(
    "claims",
    metadata,
    Column("id", String, primary_key=True),
    Column("subject", String, index=True),
    Column("field", String, index=True),
    Column("status", String, index=True),
    Column("span_id", String, index=True),
    Column("payload", JSON, nullable=False),
)
lineage_nodes = Table(
    "lineage_nodes",
    metadata,
    Column("id", String, primary_key=True),
    Column("trial_id", String, index=True),
    Column("kind", String, index=True),
    Column("date", String, index=True),
    Column("payload", JSON, nullable=False),
)
lineage_edges = Table(
    "lineage_edges",
    metadata,
    Column("id", String, primary_key=True),
    Column("from_node", String, index=True),
    Column("to_node", String, index=True),
    Column("payload", JSON, nullable=False),
)
runs = Table(
    "runs",
    metadata,
    Column("id", String, primary_key=True),
    Column("payload", JSON, nullable=False),
)


class GraphStore:
    def __init__(self, path: Path | str = DEFAULT_DB, echo: bool = False):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.engine: Engine = create_engine(f"sqlite:///{self.path}", echo=echo, future=True)
        metadata.create_all(self.engine)
        with self.engine.begin() as c:
            c.execute(text("PRAGMA journal_mode=WAL"))

    # ------------------------------------------------------------------ generic
    def _upsert(self, table: Table, rows: list[dict]) -> int:
        if not rows:
            return 0
        from sqlalchemy.dialects.sqlite import insert

        stmt = insert(table)
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={c.name: stmt.excluded[c.name] for c in table.c if c.name != "id"},
        )
        with self.engine.begin() as c:
            c.execute(stmt, rows)
        return len(rows)

    def _select_all(self, table: Table, model: type[T], where=None) -> list[T]:
        stmt = select(table.c.payload)
        if where is not None:
            stmt = stmt.where(where)
        with self.engine.connect() as c:
            return [model.model_validate(r[0]) for r in c.execute(stmt)]

    def _get(self, table: Table, model: type[T], id_: str) -> T | None:
        with self.engine.connect() as c:
            r = c.execute(select(table.c.payload).where(table.c.id == id_)).first()
        return model.model_validate(r[0]) if r else None

    # ------------------------------------------------------------------ typed API
    def upsert_sources(self, items: Iterable[Source]) -> int:
        return self._upsert(
            sources,
            [
                {
                    "id": s.source_id,
                    "type": s.type.value,
                    "content_hash": s.content_hash,
                    "payload": _dump(s),
                }
                for s in items
            ],
        )

    def upsert_spans(self, items: Iterable[Span]) -> int:
        return self._upsert(
            spans, [{"id": s.span_id, "source_id": s.source_id, "payload": _dump(s)} for s in items]
        )

    def upsert_claims(self, items: Iterable[Claim]) -> int:
        return self._upsert(
            claims,
            [
                {
                    "id": c.claim_id,
                    "subject": c.subject,
                    "field": c.field,
                    "status": c.status.value,
                    "span_id": c.span_id,
                    "payload": _dump(c),
                }
                for c in items
            ],
        )

    def upsert_lineage(
        self, nodes: Iterable[LineageNode], edges: Iterable[LineageEdge]
    ) -> tuple[int, int]:
        n = self._upsert(
            lineage_nodes,
            [
                {
                    "id": x.node_id,
                    "trial_id": x.trial_id,
                    "kind": x.kind.value,
                    "date": x.date.isoformat() if x.date else None,
                    "payload": _dump(x),
                }
                for x in nodes
            ],
        )
        e = self._upsert(
            lineage_edges,
            [
                {
                    "id": f"{x.from_node}->{x.to_node}:{x.relation}",
                    "from_node": x.from_node,
                    "to_node": x.to_node,
                    "payload": _dump(x),
                }
                for x in edges
            ],
        )
        return n, e

    def upsert_manifest(self, m: Manifest) -> None:
        self._upsert(runs, [{"id": m.run_id, "payload": _dump(m)}])

    def source(self, source_id: str) -> Source | None:
        return self._get(sources, Source, source_id)

    def span(self, span_id: str) -> Span | None:
        return self._get(spans, Span, span_id)

    def list_sources(self) -> list[Source]:
        return self._select_all(sources, Source)

    def list_claims(self, subject: str | None = None) -> list[Claim]:
        return self._select_all(claims, Claim, claims.c.subject == subject if subject else None)

    def list_lineage(self, trial_id: str) -> tuple[list[LineageNode], list[LineageEdge]]:
        nodes = self._select_all(lineage_nodes, LineageNode, lineage_nodes.c.trial_id == trial_id)
        ids = {n.node_id for n in nodes}
        edges = [e for e in self._select_all(lineage_edges, LineageEdge) if e.from_node in ids]
        nodes.sort(key=lambda n: (n.date.isoformat() if n.date else "9999", n.title))
        return nodes, edges

    def counts(self) -> dict[str, int]:
        out = {}
        with self.engine.connect() as c:
            for t in (sources, spans, claims, lineage_nodes, lineage_edges, runs):
                out[t.name] = c.execute(text(f"select count(*) from {t.name}")).scalar_one()
        return out


def _dump(m: BaseModel) -> dict:
    return json.loads(m.model_dump_json())
