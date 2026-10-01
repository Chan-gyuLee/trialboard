"""Minimal retry queue for failed/rate-limited evidence collection channels.

Previously an explicit gap: docs/CHANGYU_DEPLOYMENT_HANDOFF_2026-10-01.md and
DEVELOPMENT_DACON_2026-09-30.md both list an automatic retry queue for failed
collection attempts as left out of this implementation. This is the minimal
version — track each failed (channel, query), retry up to a fixed limit, and
flag it for human intervention once exhausted, so a failed source is tracked
rather than silently dropped. Opt-in: run_research() only touches a queue
instance when the caller supplies one.
"""

from typing import Literal

from pydantic import Field

from trialboard.agent.models import Contract, Text

MAX_AUTOMATIC_ATTEMPTS = 3


class RetryEntry(Contract):
    id: Text
    channel: Text
    query: Text
    reason: Text
    attempts: int = Field(ge=0, le=1000)
    status: Literal["PENDING_RETRY", "RESOLVED", "NEEDS_HUMAN"]


class RetryQueue:
    """Process-local tracker. Callers persist entries via `all()` if needed."""

    def __init__(self, *, max_attempts: int = MAX_AUTOMATIC_ATTEMPTS):
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self._max_attempts = max_attempts
        self._entries: dict[str, RetryEntry] = {}

    def enqueue(self, *, id: str, channel: str, query: str, reason: str) -> RetryEntry:
        """Record a failed attempt. Re-enqueuing the same id updates its reason only."""
        existing = self._entries.get(id)
        if existing is None:
            entry = RetryEntry(
                id=id, channel=channel, query=query, reason=reason,
                attempts=0, status="PENDING_RETRY",
            )
        else:
            entry = existing.model_copy(update={"reason": reason})
        self._entries[id] = entry
        return entry

    def record_attempt(self, id: str, *, success: bool, reason: str | None = None) -> RetryEntry:
        entry = self._entries.get(id)
        if entry is None:
            raise KeyError(id)
        attempts = entry.attempts + 1
        if success:
            status = "RESOLVED"
        elif attempts >= self._max_attempts:
            status = "NEEDS_HUMAN"
        else:
            status = "PENDING_RETRY"
        entry = entry.model_copy(
            update={"attempts": attempts, "status": status, "reason": reason or entry.reason}
        )
        self._entries[id] = entry
        return entry

    def pending(self) -> list[RetryEntry]:
        return [e for e in self._entries.values() if e.status == "PENDING_RETRY"]

    def needs_human(self) -> list[RetryEntry]:
        return [e for e in self._entries.values() if e.status == "NEEDS_HUMAN"]

    def all(self) -> list[RetryEntry]:
        return list(self._entries.values())

    def __len__(self) -> int:
        return len(self._entries)
