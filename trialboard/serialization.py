"""Stable fingerprints for the current review contracts."""

import hashlib
import json


def sha256_json(value: object) -> str:
    """Hash JSON deterministically; reject non-JSON NaN and infinity values."""
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
