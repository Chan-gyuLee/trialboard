"""Synthetic context links, not table interpretation or expert confirmation."""

import base64
import copy
import json

import pytest
from test_field_revalidation import field, revise, run, sample
from test_recritique import Answer, execute

from trialboard.agent.field_review_contract import ReviewPacket
from trialboard.agent.review_context import critique_payload
from trialboard.api.projects import CheckpointInput, ProjectStore


def linked(*, imported=False):
    f = sample(imported=imported)
    f["review"]["schemaVersion"] = "pdf-field-review/2"
    spans = f["source"]["source"]["pages"][0]["spans"]
    i = len(spans)
    spans.append(
        {
            **copy.deepcopy(spans[0]),
            "id": f"p1-i{i}",
            "item": i,
            "text": "Synthetic table heading; not clinical evidence",
        }
    )
    value = copy.deepcopy(field(f)["current"])
    value["supporting"] = [
        {"spanId": f"p1-i{i}", "page": 1, "quote": spans[-1]["text"], "role": "header"}
    ]
    revise(field(f), value)
    return f


@pytest.mark.parametrize("imported", [False, True])
def test_roundtrip_preserves_old_and_new_fields_and_revalidation_input(imported):
    f = linked(imported=imported)
    assert ReviewPacket.model_validate(f["review"]).model_dump() == f["review"]
    r = run(f)
    assert r["review"] == f["review"]
    support = field(f)["current"]["supporting"][0]
    assert support["spanId"] in {s["id"] for s in r["input"]["spans"]}
    assert r["accepted"][0]["fields"]["dose"]["value"] == field(f)["current"]["value"]
    assert r["clinical_approval"] is False


def test_legacy_output_exactly_preserved_without_empty_support_arrays():
    f = sample()
    assert run(f)["review"] == f["review"]
    assert "field_context_citations" not in critique_payload(run(f))


@pytest.mark.parametrize(
    "mutation", ["downgrade", "quote", "page", "duplicate", "role", "box", "history"]
)
def test_rejects_untrusted_links(mutation):
    f = linked()
    v = copy.deepcopy(field(f)["current"])
    s = v["supporting"][0]
    if mutation == "downgrade":
        f["review"]["schemaVersion"] = "pdf-field-review/1"
    elif mutation == "quote":
        s["quote"] = "fabricated heading"
    elif mutation == "page":
        s["page"] = 2
    elif mutation == "duplicate":
        s.update(v["citation"])
    elif mutation == "role":
        s["role"] = "approved"
    elif mutation == "box":
        f["source"]["source"]["pages"][0]["spans"][-1]["box"] = None
    elif mutation == "history":
        field(f)["history"][-1]["after"]["supporting"][0]["role"] = "unit"
    if mutation not in ("downgrade", "box", "history"):
        revise(field(f), v)
    with pytest.raises(ValueError):
        run(f)


def test_recritique_receives_links_but_never_held_row_context():
    f, p = linked(imported=True), Answer()
    r = execute(f, p)
    assert r["status"] == "COMPLETED"
    assert r["prompt_version"] == "human-review-recritique/2"
    links = p.requests[0]["payload"]["field_context_citations"]
    assert links == [
        {"observation_id": "obs-0", "field": "dose", "citations": field(f)["current"]["supporting"]}
    ]
    assert "NOT verified" in p.requests[0]["instructions"]
    revise(field(f), decision="held")
    p = Answer()
    execute(f, p)
    assert "field_context_citations" not in p.requests[0]["payload"]


def test_project_storage_preserves_v2_links_after_reopen(tmp_path):
    f = linked()
    source = f["source"]["source"]
    bundle = {
        "schema": "trialboard-project/1",
        "source": source,
        "notes": [],
        "reviewRaw": json.dumps(f["review"]),
        "agentRaw": None,
        "context": None,
        "meetingRaw": None,
        "draftRaw": json.dumps(
            {"schema_version": "design-draft/1", "source_digest": source["sha256"]}
        ),
    }
    path = tmp_path / "support.sqlite"
    body = CheckpointInput(
        consent=True,
        expected_revision=0,
        project_id=None,
        title="MOC supporting citations",
        bundle_json=json.dumps(bundle),
        pdf_base64=base64.b64encode(f["pdf"]).decode(),
    )
    saved = ProjectStore(path).save(body)
    loaded = ProjectStore(path).read(saved["project_id"], 1)
    assert json.loads(loaded["bundle_json"])["reviewRaw"] == bundle["reviewRaw"]
