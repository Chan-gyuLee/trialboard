"""Sparse page contracts; synthetic only, never model/clinical validation."""

import copy
import json

import pytest
from test_design_compare import brief_for
from test_design_compare import run as compare
from test_field_revalidation import run, sample
from test_rate_normalization import normalized_fixture

from trialboard.agent.field_review_contract import PdfSource
from trialboard.agent.pdf_input import from_pdf_export


def selected_fixture(f=None):
    f = f or sample()

    def move(value):
        if isinstance(value, list):
            return [move(v) for v in value]
        if isinstance(value, dict):
            return {
                k: 48 if k in ("page", "number") and v == 1 else move(v) for k, v in value.items()
            }
        if isinstance(value, str) and value.startswith("p1-i"):
            return value.replace("p1-i", "p48-i", 1)
        return value

    f = move(f)
    source = f["source"]["source"]
    source.update(schemaVersion="pdf-evidence-selected/1", totalPages=80)
    empty = {**source["pages"][0], "number": 73, "spans": [], "status": "NO_TEXT"}
    source["pages"].append(empty)
    source["status"] = "PARTIAL_NO_TEXT"
    return f


def test_sparse_source_revalidation_and_design_keep_original_citations():
    f = selected_fixture()
    before = copy.deepcopy(f)
    result = run(f)
    assert len(result["accepted"]) == 4
    assert all(s["page"] == 48 for s in result["input"]["spans"])
    assert result["model_calls"] == 0
    assert result["clinical_approval"] is False
    assert "전체 80쪽 중 2쪽" in result["limitations"][0]
    design = compare(f, brief_for(f))
    assert design["clinical_approval"] is False
    assert "전체 80쪽 중 2쪽" in design["limitations"][0]
    assert f == before
    source = PdfSource.model_validate(f["source"]["source"])
    assert source.model_dump()["totalPages"] == 80
    assert [p.number for p in source.pages] == [48, 73]


def test_legacy_source_serialization_remains_byte_contract_compatible():
    source = sample()["source"]["source"]
    assert PdfSource.model_validate(source).model_dump() == source


def test_sparse_notes_context_neighbors_and_rate_normalization():
    f = selected_fixture()
    result = from_pdf_export(f["source"], **f["context"])
    assert all(s.page == 48 for s in result.spans)
    normalized = selected_fixture(normalized_fixture())
    assert run(normalized)["normalized_rates"] == {"obs-0": "36%"}


@pytest.mark.parametrize(
    "mutation",
    [
        lambda s: s.pop("totalPages"),
        lambda s: s.update(totalPages=None),
        lambda s: s.update(totalPages=201),
        lambda s: s.update(totalPages=47),
        lambda s: s.update(totalPages=True),
        lambda s: s.update(schemaVersion="pdf-evidence/1"),
        lambda s: s.update(schemaVersion="pdf-evidence-window/1"),
        lambda s: s["pages"].reverse(),
        lambda s: s["pages"].append(copy.deepcopy(s["pages"][0])),
        lambda s: s["pages"][0]["spans"][0].update(page=1),
        lambda s: s["pages"][0]["spans"][0].update(id="p1-i0"),
    ],
)
def test_malformed_selected_source_fails_closed(mutation):
    f = selected_fixture()
    mutation(f["source"]["source"])
    with pytest.raises(ValueError):
        run(f)


def test_citation_to_unselected_page_never_resolves_by_ordinal():
    f = selected_fixture()
    raw = json.dumps(f["review"]).replace('"page": 48', '"page": 1')
    f["review"] = json.loads(raw)
    with pytest.raises(ValueError, match="CITATION_SOURCE_MISMATCH"):
        run(f)
