"""Europe PMC search + open-access full text."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from trialboard.core.hashing import short_id
from trialboard.core.schemas import Attribution, Source, SourceType
from trialboard.corpus.snapshot import SnapshotStore

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"


class EuropePMCClient:
    def __init__(self, store: SnapshotStore):
        self.store = store

    def search(self, query: str, page_size: int = 25) -> tuple[list[dict[str, Any]], Source]:
        data, f = self.store.get_json(
            f"{EPMC}/search",
            params={"query": query, "format": "json", "pageSize": page_size, "resultType": "lite"},
        )
        results = data.get("resultList", {}).get("result", [])
        src = Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=SourceType.PUBLICATION,
            url=f.url,
            title=f"Europe PMC search: {query}",
            issuer="Europe PMC",
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=Attribution.AUTHOR,
            meta={"n": len(results)},
        )
        return results, src

    def fulltext_xml(self, pmcid: str) -> Source | None:
        """Open-access full text (JATS XML). None if not OA."""
        try:
            f = self.store.get(f"{EPMC}/{pmcid}/fullTextXML")
        except Exception:
            return None
        return Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=SourceType.PUBLICATION,
            url=f.url,
            title=f"{pmcid} full text",
            issuer="Europe PMC",
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=Attribution.AUTHOR,
            meta={"pmcid": pmcid},
        )


def publication_source(rec: dict[str, Any], search_src: Source) -> Source:
    """Wrap one search hit as a metadata-only Source (no full text yet)."""
    doi = rec.get("doi")
    url = f"https://doi.org/{doi}" if doi else f"https://europepmc.org/article/{rec.get('source')}/{rec.get('id')}"
    d = rec.get("firstPublicationDate")
    return Source(
        source_id=short_id("src", url),
        type=SourceType.PUBLICATION,
        url=url,
        title=rec.get("title", ""),
        issuer=rec.get("journalTitle", ""),
        doc_date=datetime.strptime(d, "%Y-%m-%d").date() if d else None,
        fetched_at=search_src.fetched_at,
        content_hash=search_src.content_hash,
        media_type="application/json",
        local_path=search_src.local_path,
        attribution_default=Attribution.AUTHOR,
        meta={
            "pmid": rec.get("pmid"),
            "pmcid": rec.get("pmcid"),
            "doi": doi,
            "is_oa": rec.get("isOpenAccess") == "Y",
            "authors": rec.get("authorString"),
        },
    )
