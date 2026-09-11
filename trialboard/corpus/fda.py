"""FDA sources: Drugs@FDA (application documents), openFDA labels, and PDF downloads."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from trialboard.core.hashing import short_id
from trialboard.core.schemas import Attribution, Source, SourceType
from trialboard.corpus.snapshot import SnapshotStore

OPENFDA = "https://api.fda.gov"

_DOC_TYPE_MAP = {
    "Review": SourceType.FDA_REVIEW,
    "Letter": SourceType.FDA_LETTER,
    "Label": SourceType.FDA_LABEL,
}


class FDAClient:
    def __init__(self, store: SnapshotStore):
        self.store = store

    # ------------------------------------------------------------ Drugs@FDA
    def drugsfda(self, generic_name: str) -> tuple[dict[str, Any], Source]:
        data, f = self.store.get_json(
            f"{OPENFDA}/drug/drugsfda.json",
            params={"search": f"openfda.generic_name:{generic_name}", "limit": 1},
        )
        app = data["results"][0]
        src = Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=SourceType.DRUGSFDA_INDEX,
            url=f.url,
            title=f"Drugs@FDA {app.get('application_number')}",
            issuer="FDA",
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=Attribution.REVIEWER,
            meta={"application_number": app.get("application_number")},
        )
        return app, src

    def application_docs(self, app: dict[str, Any]) -> list[dict[str, Any]]:
        """Flatten submissions -> documents with submission metadata attached."""
        docs: list[dict[str, Any]] = []
        for sub in app.get("submissions", []):
            for d in sub.get("application_docs", []):
                docs.append(
                    {
                        "submission_type": sub.get("submission_type"),
                        "submission_number": sub.get("submission_number"),
                        "submission_status": sub.get("submission_status"),
                        "submission_status_date": sub.get("submission_status_date"),
                        "submission_class_code": sub.get("submission_class_code_description"),
                        "doc_type": d.get("type"),
                        "url": d.get("url"),
                        "date": d.get("date"),
                        "id": d.get("id"),
                    }
                )
        docs.sort(key=lambda x: (x["submission_status_date"] or "", x["doc_type"] or ""))
        return docs

    def fetch_pdf(self, url: str, *, title: str, doc_type: str, date_yyyymmdd: str | None,
                  version: str | None = None) -> Source:
        f = self.store.get(url)
        stype = _DOC_TYPE_MAP.get(doc_type, SourceType.FDA_REVIEW)
        # Reviews contain both applicant data and reviewer judgement; default to
        # REVIEWER and let the attribution gate refine per span.
        attribution = Attribution.REVIEWER if stype != SourceType.FDA_LABEL else Attribution.SPONSOR
        return Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=stype,
            url=f.url,
            title=title,
            issuer="FDA",
            doc_date=_ymd(date_yyyymmdd),
            version=version,
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=attribution,
            meta={"doc_type": doc_type},
        )

    # ------------------------------------------------------------ openFDA label
    def label(self, generic_name: str) -> tuple[dict[str, Any], Source]:
        data, f = self.store.get_json(
            f"{OPENFDA}/drug/label.json",
            params={"search": f"openfda.generic_name:{generic_name}", "limit": 1},
        )
        rec = data["results"][0]
        src = Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=SourceType.FDA_LABEL,
            url=f.url,
            title=f"openFDA label {','.join(rec.get('openfda', {}).get('brand_name', []))}",
            issuer="FDA/openFDA",
            doc_date=_ymd(rec.get("effective_time")),
            version=rec.get("version"),
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=Attribution.SPONSOR,
            meta={"set_id": rec.get("set_id")},
        )
        return rec, src


def _ymd(s: str | None):
    if not s:
        return None
    try:
        return datetime.strptime(s[:8], "%Y%m%d").date()
    except ValueError:
        return None
