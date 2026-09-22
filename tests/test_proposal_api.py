import copy
import json
from threading import BoundedSemaphore

from fastapi.testclient import TestClient
from test_design_api import payload
from test_design_proposal import Proposer

from trialboard.api.app import create_app
from trialboard.api.proposals import proposal_router

ORIGIN = {"origin": "http://127.0.0.1:5173"}


def setup():
    p = Proposer()
    app = create_app(enable_designs=True)
    slot = BoundedSemaphore(1)
    app.include_router(proposal_router(slot, lambda: p))
    _, body = payload()
    body.pop("brief")
    body.pop("ai_json")
    body.update(consent=True, constraints={"objective": "표본수 비교", "max_per_arm": 80})
    return TestClient(app, base_url="http://127.0.0.1"), body, p, slot


def test_stream_preflight_model_validation_result_and_slot_release():
    client, body, p, slot = setup()
    for _ in range(2):
        r = client.post("/api/design-proposals", json=body, headers=ORIGIN)
        assert r.status_code == 200
        events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
        assert [e["stage"] for e in events[:-1]] == [
            "REVALIDATING_EVIDENCE",
            "PROPOSING_HYPOTHESES",
            "CHECKING_PROPOSAL",
        ]
        assert events[-1]["result"]["status"] == "AWAITING_REVIEW"
    assert len(p.calls) == 2 and slot.acquire(blocking=False)


def test_no_origin_or_nonboolean_consent_never_calls_model():
    client, body, p, _ = setup()
    assert client.post("/api/design-proposals", json=body).status_code == 403
    for value in (False, 1, "true", None):
        changed = copy.deepcopy(body)
        changed["consent"] = value
        assert client.post("/api/design-proposals", json=changed, headers=ORIGIN).status_code == 422
    assert not p.calls


def test_busy_and_bad_pdf_do_not_call_model_or_echo_input():
    client, body, p, slot = setup()
    slot.acquire()
    assert client.post("/api/design-proposals", json=body, headers=ORIGIN).status_code == 429
    slot.release()
    body["pdf_base64"] = "PRIVATE INPUT"
    r = client.post("/api/design-proposals", json=body, headers=ORIGIN)
    assert r.status_code == 422 and "PRIVATE" not in r.text and not p.calls


def test_disabled_unless_both_designs_and_pdf_agent_enabled():
    for designs, pdf in ((False, False), (True, False), (False, True), (True, True)):
        c = TestClient(
            create_app(enable_designs=designs, enable_pdf_agent=pdf), base_url="http://127.0.0.1"
        )
        assert c.get("/api/design-proposals/capabilities").json()["enabled"] is (designs and pdf)
        if not designs or not pdf:
            assert c.post("/api/design-proposals", json={}, headers=ORIGIN).status_code == 404
