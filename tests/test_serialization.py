import hashlib

import pytest

from trialboard.serialization import sha256_json


def test_fingerprint_ignores_object_key_order():
    assert sha256_json({"a": 1, "b": 2}) == sha256_json({"b": 2, "a": 1})


def test_fingerprint_preserves_array_order():
    assert sha256_json([1, 2]) != sha256_json([2, 1])


def test_fingerprint_matches_existing_valid_json_encoding():
    assert sha256_json({"값": 1}) == hashlib.sha256('{"값":1}'.encode()).hexdigest()


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_fingerprint_rejects_nonfinite_values(value):
    with pytest.raises(ValueError):
        sha256_json({"value": value})
