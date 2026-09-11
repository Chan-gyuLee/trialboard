"""Content hashing and deterministic ID helpers.

Every stored artifact (source bytes, prompt, tool output) is addressed by a
SHA-256 content hash so that runs are reproducible and auditable.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def sha256_json(obj: Any) -> str:
    """Hash a JSON-serialisable object with canonical key ordering."""
    canon = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return sha256_text(canon)


def short_id(prefix: str, *parts: str, length: int = 12) -> str:
    """Deterministic short identifier, e.g. ``src_3fa9c2e1b0d4``."""
    digest = sha256_text("\x1f".join(parts))
    return f"{prefix}_{digest[:length]}"
