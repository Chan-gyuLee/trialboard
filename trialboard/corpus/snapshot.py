"""Content-addressed snapshot cache for every external fetch.

Modes
* ``snapshot``: serve from cache only; raise if missing (demo-safe).
* ``live``: fetch, then store (updates cache).
* ``auto``: serve from cache if present, else fetch and store (default for dev).

Files live in ``data/snapshots/<sha256>.<ext>``; an index (``index.jsonl``)
maps URL -> hash, fetched_at, media type so a URL can be resolved offline.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import httpx

from trialboard.core.hashing import sha256_bytes

Mode = Literal["snapshot", "live", "auto"]

DEFAULT_ROOT = Path(os.environ.get("TRIALBOARD_DATA", "data")) / "snapshots"
USER_AGENT = "TrialBoard/0.1 (research prototype; contact: team@trialboard.local)"

_EXT = {
    "application/pdf": "pdf",
    "application/json": "json",
    "text/html": "html",
    "application/xml": "xml",
    "text/xml": "xml",
}


class SnapshotMiss(RuntimeError):
    pass


@dataclass
class Fetched:
    url: str
    content: bytes
    content_hash: str
    media_type: str
    fetched_at: datetime
    local_path: Path
    from_cache: bool


class SnapshotStore:
    def __init__(self, root: Path = DEFAULT_ROOT, mode: Mode = "auto", timeout: float = 60.0):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.index_path = self.root / "index.jsonl"
        self.mode = mode
        self._index: dict[str, dict] = self._load_index()
        self._client = httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )
        self.api_calls = 0

    # ------------------------------------------------------------------ index
    def _load_index(self) -> dict[str, dict]:
        idx: dict[str, dict] = {}
        if self.index_path.exists():
            for line in self.index_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    rec = json.loads(line)
                    idx[rec["url"]] = rec
        return idx

    def _append_index(self, rec: dict) -> None:
        self._index[rec["url"]] = rec
        with self.index_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def _path_for(self, content_hash: str, media_type: str) -> Path:
        ext = _EXT.get(media_type.split(";")[0].strip(), "bin")
        return self.root / f"{content_hash}.{ext}"

    # ------------------------------------------------------------------ public
    def get(self, url: str, *, params: dict | None = None, accept: str | None = None) -> Fetched:
        key = _key(url, params)
        cached = self._index.get(key)
        if cached and self.mode in ("snapshot", "auto"):
            path = Path(cached["local_path"])
            if path.exists():
                return Fetched(
                    url=key,
                    content=path.read_bytes(),
                    content_hash=cached["content_hash"],
                    media_type=cached["media_type"],
                    fetched_at=datetime.fromisoformat(cached["fetched_at"]),
                    local_path=path,
                    from_cache=True,
                )
        if self.mode == "snapshot":
            raise SnapshotMiss(f"No snapshot for {key}")

        headers = {"Accept": accept} if accept else {}
        resp = self._client.get(url, params=params, headers=headers)
        self.api_calls += 1
        resp.raise_for_status()
        content = resp.content
        media_type = resp.headers.get("content-type", "application/octet-stream").split(";")[0]
        content_hash = sha256_bytes(content)
        path = self._path_for(content_hash, media_type)
        if not path.exists():
            path.write_bytes(content)
        fetched_at = datetime.now(UTC)
        self._append_index(
            {
                "url": key,
                "content_hash": content_hash,
                "media_type": media_type,
                "fetched_at": fetched_at.isoformat(),
                "local_path": str(path),
                "status": resp.status_code,
            }
        )
        return Fetched(key, content, content_hash, media_type, fetched_at, path, False)

    def get_json(self, url: str, *, params: dict | None = None) -> tuple[dict | list, Fetched]:
        f = self.get(url, params=params, accept="application/json")
        return json.loads(f.content.decode("utf-8")), f

    def close(self) -> None:
        self._client.close()


def _key(url: str, params: dict | None) -> str:
    if not params:
        return url
    q = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    return f"{url}?{q}"
