import hashlib
import re

import pytest

from trialboard.evidence.build import ANCHORS, ROOT, SOURCES
from trialboard.evidence.pdf import EvidenceIntegrityError, anchor_pattern, locate, verify_file


def test_hash_mismatch_is_rejected(tmp_path):
    path = tmp_path / "source.txt"
    path.write_bytes(b"original")
    digest = hashlib.sha256(b"original").hexdigest()
    verify_file(path, digest)
    path.write_bytes(b"changed")
    with pytest.raises(EvidenceIntegrityError, match="hash mismatch"):
        verify_file(path, digest)


def test_anchor_allows_line_breaks_not_prefix_match():
    pattern = anchor_pattern("the safety and efficacy")
    assert re.search(pattern, "the safety\nand efficacy")
    assert not re.search(pattern, "the safety and efficacyChanged")
    assert not re.search(pattern, "the safety and")
    assert not re.search(pattern, "the safety plus efficacy")


def test_regex_characters_are_literal():
    pattern = anchor_pattern("safety (all grades)")
    assert re.search(pattern, "safety (all grades)")
    assert not re.search(pattern, "safety all grades")


@pytest.mark.parametrize("quote", ["", "dose", "the dose"])
def test_underspecified_anchor_rejected(quote):
    with pytest.raises(EvidenceIntegrityError):
        anchor_pattern(quote)


def test_ambiguous_and_missing_anchors_rejected(monkeypatch, tmp_path):
    class Page:
        def __init__(self, hits):
            self.hits = hits

        def search(self, *args, **kwargs):
            return self.hits

    class PDF:
        def __init__(self, hits):
            self.pages = [Page(hits)]

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    path = tmp_path / "test.pdf"
    path.write_bytes(b"test")
    digest = hashlib.sha256(b"test").hexdigest()
    for hits in ([], [{}, {}]):
        monkeypatch.setattr(
            "trialboard.evidence.pdf.pdfplumber.open", lambda _, hits=hits: PDF(hits)
        )
        with pytest.raises(EvidenceIntegrityError, match="Expected one exact anchor"):
            locate(path, digest, 1, "three word anchor")


@pytest.mark.parametrize("anchor", ANCHORS, ids=[a["id"] for a in ANCHORS])
def test_actual_pinned_source_anchor(anchor):
    source = SOURCES[anchor["source_id"]]
    path = ROOT / "data" / "snapshots" / f"{source['sha256']}.pdf"
    if not path.exists():
        pytest.skip("Pinned public source not downloaded in this checkout")
    result = locate(path, source["sha256"], anchor["page"], anchor["quote"])
    assert " ".join(result["quote"].split()) == anchor["quote"]
    assert result["boxes"]
    assert result["meaning_status"] == "developer_curated_not_expert_validated"
    assert result["page"] == anchor["page"]
