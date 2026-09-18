"""One-call diagnostics use saved inputs; no real model or credentials."""

import asyncio
import sqlite3

import pytest
from test_research import FakeModel, execute, setup  # noqa: F401

from trialboard.agent.provider import Reply
from trialboard.research.plan_probe import main, probe_plan, read_saved_run


def test_probe_reads_saved_record_without_writes_searches_or_second_call(setup):  # noqa: F811
    path, request, queries = setup
    saved = asyncio.run(execute(path, request))
    original = path.read_bytes()
    fetched = read_saved_run(path, saved.id)
    count = len(queries)
    provider = FakeModel()
    result = asyncio.run(probe_plan(fetched, provider))
    assert result["validation"] == "PASSED" and result["model_calls"] == 1
    assert result["kind"] == "PLAN_PROBE_NOT_FULL_RESEARCH"
    assert result["provider"] == "SCRIPTED_TEST_DOUBLE"
    assert len(provider.calls) == 1 and len(queries) == count
    assert path.read_bytes() == original
    assert fetched.model_dump() == saved.model_dump()
    assert "MOC priority" not in str(result)


def test_probe_rejection_keeps_usage_and_never_leaks_raw_value(setup):  # noqa: F811
    path, request, _ = setup
    saved = asyncio.run(execute(path, request))

    class Bad(FakeModel):
        async def complete(self, **kwargs):
            self.calls.append(kwargs)
            return Reply({"private-field": "private-value"}, "MOC", 12, 34)

    provider = Bad()
    result = asyncio.run(probe_plan(saved, provider))
    assert result["validation"] == "REJECTED" and result["input_tokens"] == 12
    assert result["error_code"] == "MODEL_SCHEMA_REJECTED" and len(provider.calls) == 1
    assert "private" not in str(result)


def test_missing_db_is_not_created(tmp_path):
    path = tmp_path / "absent.sqlite"
    with pytest.raises(sqlite3.OperationalError):
        read_saved_run(path, "00000000-0000-0000-0000-000000000001")
    assert not path.exists()


def test_no_external_consent_does_not_read_key_or_run(monkeypatch):
    monkeypatch.setattr(
        "trialboard.research.plan_probe.read_saved_run",
        lambda *a: pytest.fail("no read without consent"),
    )
    monkeypatch.setattr(
        "trialboard.research.plan_probe.read_private_key",
        lambda *a: pytest.fail("no key without consent"),
    )
    with pytest.raises(SystemExit) as result:
        main(["--run-id", "unused", "--key-file", "unused"])
    assert result.value.code == 2
