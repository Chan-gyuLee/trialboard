"""TEAM preparation races with temporary databases and a synthetic parser only."""

import asyncio
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from test_pdf_preparation import post
from test_pdf_preparation import scenario as scenario
from test_team_auth import login

from trialboard.research import pdf_preparation as prep
from trialboard.research.store import ResearchStore


def assert_no_preparation(database):
    with sqlite3.connect(database) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_pdf_preparations'"
        ).fetchone()


@pytest.mark.parametrize("change", ["source-digest", "cached-bytes"])
def test_changed_input_during_parser_never_publishes_or_persists(scenario, change):
    fixture, _, state = scenario
    value, _, _ = fixture
    _, run, database, _, _, _, provider, _ = value

    def mutate():
        if change == "source-digest":
            run.sources[0].digest = "f" * 64
            ResearchStore(database).save_run(run)
        else:
            with sqlite3.connect(database) as con:
                con.execute("UPDATE public_pdf_blobs SET content=?", (b"%PDF-tampered",))

    state["after"] = mutate
    result = post(scenario)
    assert result.status_code == 409, result.text
    assert "Synthetic server-extracted text" not in result.text
    assert "preparation_id" not in result.json()
    assert state["parses"] == 1
    assert provider["calls"] == provider["factories"] == 0
    assert_no_preparation(database)


def test_viewer_cannot_start_parser(scenario):
    fixture, _, state = scenario
    value, _, _ = fixture
    with sqlite3.connect(value[3]) as con:
        con.execute("UPDATE memberships SET role='viewer',permission_epoch=2")
    login(value[0])
    session = value[0].get("/api/auth/session")
    assert session.status_code == 200 and session.json()["role"] == "viewer"
    assert post(scenario).status_code == 403
    assert state["parses"] == value[6]["calls"] == value[6]["factories"] == 0
    assert_no_preparation(value[2])


def test_concurrent_team_preparation_is_busy_then_slot_is_reusable(scenario, monkeypatch):
    entered, release = Event(), Event()
    calls = []

    async def parser(raw):
        assert raw.startswith(b"%PDF-")
        calls.append("parse")
        entered.set()
        assert await asyncio.to_thread(release.wait, 3), "synthetic parser release timed out"
        return {"extractor": "pdfplumber/synthetic-test-double",
                "pages": [{"page": 1, "text": "Synthetic concurrent preparation."}]}

    monkeypatch.setattr(prep, "isolated_extract", parser)
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(post, scenario)
        try:
            assert entered.wait(3), "first synthetic parser did not start"
            blocked = post(scenario)
            assert blocked.status_code == 409, blocked.text
            assert blocked.json()["detail"] == "PDF_PREPARATION_BUSY"
            assert calls == ["parse"]
        finally:
            release.set()
        completed = first.result(timeout=3)
    assert completed.status_code == 200, completed.text
    next_result = post(scenario)
    assert next_result.status_code == 200, next_result.text
    assert next_result.json()["preparation_id"] != completed.json()["preparation_id"]
    assert calls == ["parse", "parse"]
    value = scenario[0][0]
    assert value[6]["calls"] == value[6]["factories"] == 0
