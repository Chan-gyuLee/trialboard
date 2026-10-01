"""Per-user cache: same key, different users never see each other's cached value."""

import pytest

from trialboard.user_cache import UserScopedCache


def test_miss_returns_none():
    cache = UserScopedCache()
    assert cache.get("alice", "k") is None


def test_set_then_get_same_user():
    cache = UserScopedCache()
    cache.set("alice", "k", "value-a")
    assert cache.get("alice", "k") == "value-a"


def test_same_key_isolated_between_users():
    cache = UserScopedCache()
    cache.set("alice", "k", "alice-value")
    cache.set("bob", "k", "bob-value")
    assert cache.get("alice", "k") == "alice-value"
    assert cache.get("bob", "k") == "bob-value"


def test_unknown_user_never_sees_another_users_entry():
    cache = UserScopedCache()
    cache.set("alice", "k", "alice-value")
    assert cache.get("bob", "k") is None


def test_invalidate_user_clears_only_that_user():
    cache = UserScopedCache()
    cache.set("alice", "k", "a")
    cache.set("bob", "k", "b")
    cache.invalidate_user("alice")
    assert cache.get("alice", "k") is None
    assert cache.get("bob", "k") == "b"


def test_invalidate_key_for_all_users_clears_across_users():
    cache = UserScopedCache()
    cache.set("alice", "k", "a")
    cache.set("bob", "k", "b")
    cache.invalidate_key_for_all_users("k")
    assert cache.get("alice", "k") is None
    assert cache.get("bob", "k") is None


def test_per_user_entry_cap_evicts_oldest_within_that_user_only(monkeypatch):
    import trialboard.user_cache as module

    clock = [0.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    cache = UserScopedCache(max_entries_per_user=2)
    cache.set("alice", "k1", 1)
    clock[0] += 1
    cache.set("alice", "k2", 2)
    clock[0] += 1
    cache.set("bob", "k1", "unrelated")
    clock[0] += 1
    cache.set("alice", "k3", 3)
    assert cache.get("alice", "k1") is None
    assert cache.get("alice", "k2") == 2
    assert cache.get("alice", "k3") == 3
    assert cache.get("bob", "k1") == "unrelated"


def test_ttl_expiry(monkeypatch):
    import trialboard.user_cache as module

    clock = [0.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    cache = UserScopedCache(ttl_seconds=10)
    cache.set("alice", "k", "v")
    clock[0] = 5
    assert cache.get("alice", "k") == "v"
    clock[0] = 11
    assert cache.get("alice", "k") is None


def test_max_entries_per_user_must_be_positive():
    with pytest.raises(ValueError):
        UserScopedCache(max_entries_per_user=0)


def test_len_and_user_count():
    cache = UserScopedCache()
    cache.set("alice", "k1", 1)
    cache.set("alice", "k2", 2)
    cache.set("bob", "k1", 3)
    assert len(cache) == 3
    assert cache.user_count() == 2
