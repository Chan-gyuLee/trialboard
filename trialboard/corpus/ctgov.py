"""ClinicalTrials.gov clients.

* v2 public API for the current record.
* ``api/int`` history endpoint for the version lineage (dates + changed modules)
  and, where available, the full payload of a given historical version.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from trialboard.core.hashing import short_id
from trialboard.core.schemas import Attribution, Source, SourceType
from trialboard.corpus.snapshot import SnapshotStore

V2 = "https://clinicaltrials.gov/api/v2"
INT = "https://clinicaltrials.gov/api/int"


class CTGovClient:
    def __init__(self, store: SnapshotStore):
        self.store = store

    def study(self, nct: str) -> tuple[dict[str, Any], Source]:
        data, f = self.store.get_json(f"{V2}/studies/{nct}")
        ident = data.get("protocolSection", {}).get("identificationModule", {})
        status = data.get("protocolSection", {}).get("statusModule", {})
        last = status.get("lastUpdatePostDateStruct", {}).get("date")
        src = Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=SourceType.REGISTRY,
            url=f.url,
            title=ident.get("briefTitle", nct),
            issuer="ClinicalTrials.gov",
            doc_date=_date(last),
            version=str(status.get("versionHolder")) if status.get("versionHolder") else None,
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=Attribution.REGISTRY,
            meta={"nct": nct, "from_cache": f.from_cache},
        )
        return data, src

    def history(self, nct: str) -> tuple[list[dict[str, Any]], Source]:
        data, f = self.store.get_json(f"{INT}/studies/{nct}/history")
        changes = data.get("changes", []) if isinstance(data, dict) else []
        src = Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=SourceType.REGISTRY_HISTORY,
            url=f.url,
            title=f"{nct} registry version history",
            issuer="ClinicalTrials.gov",
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=Attribution.REGISTRY,
            meta={"nct": nct, "n_versions": len(changes)},
        )
        return changes, src

    def history_version(
        self, nct: str, version: int
    ) -> tuple[dict[str, Any] | None, Source | None]:
        """Full record at a given version. Returns (None, None) if endpoint unavailable."""
        try:
            data, f = self.store.get_json(f"{INT}/studies/{nct}/history/{version}")
        except Exception:
            return None, None
        src = Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=SourceType.REGISTRY_HISTORY,
            url=f.url,
            title=f"{nct} v{version}",
            issuer="ClinicalTrials.gov",
            version=str(version),
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=Attribution.REGISTRY,
            meta={"nct": nct, "version": version},
        )
        return data, src


def _date(s: str | None):
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").replace(tzinfo=UTC).date()
    except ValueError:
        return None
