"""Minimal per-user cache namespace: same key, different users never share a value.

docs/DEVELOPMENT_DACON_2026-09-30.md lists a per-user cache (separate from the
shared/common caches that are correctly shared, e.g. PDF bytes keyed by digest
in api/research.py) as left out of this implementation. This is the formal,
minimal version: entries are keyed by (user_id, key), so two users querying
the identical key never read each other's cached result, bounded by a small
per-user entry cap and optional TTL so it cannot grow without limit.
"""

import time

DEFAULT_MAX_ENTRIES_PER_USER = 200


class UserScopedCache[V]:
    def __init__(
        self,
        *,
        max_entries_per_user: int = DEFAULT_MAX_ENTRIES_PER_USER,
        ttl_seconds: float | None = None,
    ):
        if max_entries_per_user < 1:
            raise ValueError("max_entries_per_user must be at least 1")
        self._store: dict[str, dict[str, tuple[float, V]]] = {}
        self._max_entries_per_user = max_entries_per_user
        self._ttl_seconds = ttl_seconds

    def get(self, user_id: str, key: str) -> V | None:
        bucket = self._store.get(user_id)
        if bucket is None or key not in bucket:
            return None
        stored_at, value = bucket[key]
        if self._ttl_seconds is not None and time.monotonic() - stored_at > self._ttl_seconds:
            del bucket[key]
            return None
        return value

    def set(self, user_id: str, key: str, value: V) -> None:
        bucket = self._store.setdefault(user_id, {})
        bucket[key] = (time.monotonic(), value)
        if len(bucket) > self._max_entries_per_user:
            oldest_key = min(bucket, key=lambda k: bucket[k][0])
            del bucket[oldest_key]

    def invalidate_user(self, user_id: str) -> None:
        self._store.pop(user_id, None)

    def invalidate_key_for_all_users(self, key: str) -> None:
        for bucket in self._store.values():
            bucket.pop(key, None)

    def user_count(self) -> int:
        return len(self._store)

    def __len__(self) -> int:
        return sum(len(bucket) for bucket in self._store.values())
