from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from trialboard.core.hashing import sha256_json, short_id
from trialboard.core.schemas import (
    Attribution,
    Claim,
    Source,
    SourceType,
    VerificationStatus,
)


def test_short_id_deterministic():
    assert short_id("src", "a", "b") == short_id("src", "a", "b")
    assert short_id("src", "a", "b") != short_id("src", "ab")


def test_sha256_json_key_order_invariant():
    assert sha256_json({"a": 1, "b": 2}) == sha256_json({"b": 2, "a": 1})


def test_claim_requires_span_and_quote():
    with pytest.raises(ValidationError):
        Claim(claim_id="c", subject="sotorasib", field="pk.auc", extractor="manual")  # type: ignore[call-arg]


def test_source_roundtrip():
    s = Source(
        source_id="src_x",
        type=SourceType.FDA_LABEL,
        url="https://example.org/x.pdf",
        fetched_at=datetime.now(UTC),
        content_hash="0" * 64,
        media_type="application/pdf",
        local_path="/tmp/x.pdf",
        attribution_default=Attribution.SPONSOR,
    )
    assert Source.model_validate_json(s.model_dump_json()) == s


def test_claim_default_status_pending():
    c = Claim(
        claim_id="c1",
        subject="sotorasib",
        field="pk.auc_ss",
        span_id="sp1",
        quote="AUC 71.8",
        extractor="manual",
    )
    assert c.status == VerificationStatus.PENDING
