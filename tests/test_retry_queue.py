"""Retry queue: bounded retries, escalates to human, never drops a failed entry."""

import pytest

from trialboard.research.retry_queue import RetryQueue


def test_enqueue_starts_pending_with_zero_attempts():
    q = RetryQueue()
    entry = q.enqueue(id="pubmed:drug", channel="PubMed DRUG_SEARCH", query="X", reason="timeout")
    assert entry.status == "PENDING_RETRY"
    assert entry.attempts == 0
    assert q.pending() == [entry]
    assert len(q) == 1


def test_resolved_on_successful_attempt():
    q = RetryQueue()
    q.enqueue(id="a", channel="c", query="q", reason="timeout")
    entry = q.record_attempt("a", success=True)
    assert entry.status == "RESOLVED"
    assert entry.attempts == 1
    assert q.pending() == []
    assert q.needs_human() == []


def test_stays_pending_until_max_attempts_then_escalates():
    q = RetryQueue(max_attempts=3)
    q.enqueue(id="a", channel="c", query="q", reason="rate_limited")
    first = q.record_attempt("a", success=False)
    assert first.status == "PENDING_RETRY" and first.attempts == 1
    second = q.record_attempt("a", success=False)
    assert second.status == "PENDING_RETRY" and second.attempts == 2
    third = q.record_attempt("a", success=False)
    assert third.status == "NEEDS_HUMAN" and third.attempts == 3
    assert q.needs_human() == [third]
    assert q.pending() == []


def test_record_attempt_on_unknown_id_raises():
    q = RetryQueue()
    with pytest.raises(KeyError):
        q.record_attempt("missing", success=False)


def test_reenqueue_same_id_updates_reason_without_resetting_attempts():
    q = RetryQueue(max_attempts=5)
    q.enqueue(id="a", channel="c", query="q", reason="first failure")
    q.record_attempt("a", success=False)
    q.enqueue(id="a", channel="c", query="q", reason="second failure, different cause")
    entry = q.all()[0]
    assert entry.attempts == 1
    assert entry.reason == "second failure, different cause"


def test_never_silently_drops_a_failed_entry():
    q = RetryQueue(max_attempts=1)
    q.enqueue(id="a", channel="c", query="q", reason="down")
    q.record_attempt("a", success=False)
    assert len(q) == 1
    assert q.all()[0].status == "NEEDS_HUMAN"


def test_max_attempts_must_be_positive():
    with pytest.raises(ValueError):
        RetryQueue(max_attempts=0)


def test_multiple_independent_entries_tracked_separately():
    q = RetryQueue()
    q.enqueue(id="a", channel="c1", query="q1", reason="r1")
    q.enqueue(id="b", channel="c2", query="q2", reason="r2")
    q.record_attempt("a", success=True)
    assert {e.id for e in q.pending()} == {"b"}
    assert {e.id for e in q.needs_human()} == set()
    assert len(q) == 2
