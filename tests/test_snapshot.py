import httpx
import pytest
import respx

from trialboard.corpus.snapshot import SnapshotMiss, SnapshotStore


@respx.mock
def test_snapshot_caches_and_serves_offline(tmp_path):
    route = respx.get("https://example.org/a.json").mock(
        return_value=httpx.Response(
            200, json={"k": 1}, headers={"content-type": "application/json"}
        )
    )
    store = SnapshotStore(root=tmp_path, mode="auto")
    data, f1 = store.get_json("https://example.org/a.json")
    assert data == {"k": 1} and not f1.from_cache and route.call_count == 1

    data2, f2 = store.get_json("https://example.org/a.json")
    assert data2 == {"k": 1} and f2.from_cache and route.call_count == 1
    assert f1.content_hash == f2.content_hash

    # a fresh store in snapshot mode must serve from disk without network
    offline = SnapshotStore(root=tmp_path, mode="snapshot")
    data3, f3 = offline.get_json("https://example.org/a.json")
    assert data3 == {"k": 1} and f3.from_cache

    with pytest.raises(SnapshotMiss):
        offline.get("https://example.org/missing.json")
