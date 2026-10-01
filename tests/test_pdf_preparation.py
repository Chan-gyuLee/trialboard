"""Preparation protocol and rights tests; parser success is a synthetic stub on macOS."""

import asyncio
import errno
import io
import json
import sqlite3
from threading import BoundedSemaphore
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from test_project_acl import headers
from test_research_pdf_policy import SHA, assertion, download
from test_research_pdf_policy import scenario as pdf_scenario

from trialboard.research import pdf_extract_worker as worker
from trialboard.research import pdf_preparation as prep
from trialboard.serialization import sha256_json

REAL_EXTRACT = prep.isolated_extract


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    generator = pdf_scenario.__wrapped__(tmp_path, monkeypatch)
    fixture = next(generator)
    assert download(fixture).status_code == 200
    value, url, body = fixture
    request = {"consent": True, "source_digest": body["source_digest"],
               "pdf_sha256": SHA, "policy_revision": 1}
    state = {"parses": 0, "after": lambda: None}

    async def parser(raw):
        assert raw.startswith(b"%PDF-")
        state["parses"] += 1
        state["after"]()
        return {"extractor": "pdfplumber/synthetic-test-double",
                "pages": [{"page": 1, "text": "Synthetic server-extracted text."}]}

    monkeypatch.setattr(prep, "isolated_extract", parser)
    yield fixture, request, state
    try:
        next(generator)
    except StopIteration:
        pass


def post(scenario):
    fixture, request, _ = scenario
    value, url, _ = fixture
    return value[0].post(url + "/prepare-server", json=request, headers=headers(value[0]))


def test_stub_preparation_is_immutable_bound_zero_model_and_get_storage_gated(scenario):
    fixture, request, state = scenario
    value, url, body = fixture
    client, run, database, _, base, _, provider, _ = value
    result = post(scenario)
    assert result.status_code == 200, result.text
    artifact = result.json()
    assert artifact["source_digest"] == request["source_digest"]
    assert artifact["pdf_sha256"] == SHA and artifact["model_calls"] == 0
    assert artifact["preparation_digest"] == sha256_json(
        {k: v for k, v in artifact.items() if k != "preparation_digest"})
    assert state["parses"] == 1 and provider["calls"] == provider["factories"] == 0
    assert artifact["extractor"] == "pdfplumber/synthetic-test-double"
    target = f"{base}/pdf-preparations/{artifact['preparation_id']}"
    assert client.get(target).json() == artifact
    with sqlite3.connect(database) as con:
        with pytest.raises(sqlite3.IntegrityError, match="IMMUTABLE"):
            con.execute("DELETE FROM research_pdf_preparations")
    assert client.get(f"/api/research/runs/{uuid4()}/pdf-preparations/"
                      f"{artifact['preparation_id']}").status_code == 404
    assert client.post(url + "/usage-policy", json=assertion(body, 1, "DENY"),
                       headers=headers(client)).status_code == 200
    assert client.get(target).status_code == 403


@pytest.mark.parametrize("change", ["consent-int", "extra-text", "revision", "sha", "rev-bool"])
def test_bad_bindings_never_enter_parser(scenario, change):
    _, request, state = scenario
    if change == "consent-int":
        request["consent"] = 1
    elif change == "extra-text":
        request["text"] = "browser arbitrary content"
    elif change == "revision":
        request["policy_revision"] = 2
    elif change == "sha":
        request["pdf_sha256"] = "f" * 64
    else:
        request["policy_revision"] = True
    assert post(scenario).status_code in (404, 409, 422)
    assert state["parses"] == 0


@pytest.mark.parametrize("change", ["expiry", "role", "policy"])
def test_authority_or_policy_revoked_during_extraction_never_persists(scenario, change):
    fixture, _, state = scenario
    value, _, body = fixture
    _, run, database, identity, _, _, _, _ = value

    def revoke():
        if change == "policy":
            from trialboard.api.team_auth import TeamDataPath, TeamIdentity
            from trialboard.research.pdf_policy import PdfPolicyUpdate, update
            update(TeamDataPath(database.parent.parent), TeamIdentity(identity), run.id,
                   run.sources[0].id, PdfPolicyUpdate(**assertion(body, 1, "DENY")))
        else:
            with sqlite3.connect(identity) as con:
                con.execute("UPDATE sessions SET absolute_expires_at=0" if change == "expiry"
                            else "UPDATE memberships SET role='viewer',permission_epoch=2")

    state["after"] = revoke
    assert post(scenario).status_code == 403
    assert state["parses"] == 1
    with sqlite3.connect(database) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_pdf_preparations'").fetchone()


def test_actual_unsupported_platform_never_starts_subprocess(monkeypatch):
    calls = []
    monkeypatch.setattr(prep.sys, "platform", "darwin")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **kw: calls.append(a))
    with pytest.raises(HTTPException) as error:
        asyncio.run(prep.isolated_extract(b"%PDF-synthetic"))
    assert error.value.detail == "UNSUPPORTED_SANDBOX" and calls == []


def test_worker_unsupported_platform_never_imports_or_calls_parser(monkeypatch):
    output, calls = io.BytesIO(), []
    monkeypatch.setattr(worker, "sys", SimpleNamespace(platform="darwin",
                        stdin=SimpleNamespace(buffer=io.BytesIO(b"%PDF-synthetic")),
                        stdout=SimpleNamespace(buffer=output)))
    monkeypatch.setattr(worker, "extract", lambda raw: calls.append(raw))
    worker.main()
    assert json.loads(output.getvalue()) == {"status": "ERROR", "code": "UNSUPPORTED_SANDBOX"}
    assert calls == []


def test_linux_sandbox_requires_enforced_memory_probe(monkeypatch):
    values = {}
    monkeypatch.setattr(worker.sys, "platform", "linux")
    monkeypatch.setattr(worker.resource, "setrlimit", lambda k, v: values.update({k: v}))
    monkeypatch.setattr(worker.resource, "getrlimit", lambda k: values[k])
    monkeypatch.setattr(worker.mmap, "mmap", lambda *a: SimpleNamespace(close=lambda: None))
    with pytest.raises(ValueError, match="UNSUPPORTED_SANDBOX"):
        worker.sandbox()

    def denied(*_args):
        raise OSError(errno.ENOMEM, "synthetic hard-limit denial")

    monkeypatch.setattr(worker.mmap, "mmap", denied)
    worker.sandbox()  # Protocol test only: monkeypatched limits are not real isolation evidence.
    assert values[worker.resource.RLIMIT_AS] == (536_870_912, 536_870_912)

    for code in (errno.EPERM, errno.EINVAL, errno.EBADF):
        def unrelated_error(*_args, error_code=code):
            raise OSError(error_code, "synthetic unrelated failure")

        monkeypatch.setattr(worker.mmap, "mmap", unrelated_error)
        with pytest.raises(ValueError, match="UNSUPPORTED_SANDBOX"):
            worker.sandbox()


@pytest.mark.parametrize("value", [
    {"status": "OK", "extractor": "pdfplumber/test", "pages": []},
    {"status": "OK", "extractor": "pdfplumber/test", "pages": [{"page": True, "text": "x"}]},
    {"status": "OK", "extractor": "pdfplumber/test", "pages": [{"page": 1, "text": " "}]},
    {"status": "OK", "extractor": "pdfplumber/test", "pages": [{"page": 1, "text": "x" * 30001}]},
    {"status": "ERROR", "code": "private supplier exception"},
])
def test_parser_protocol_is_bounded_and_fail_closed(value):
    with pytest.raises(HTTPException, match="PDF_PARSER_PROTOCOL_INVALID"):
        prep.protocol(json.dumps(value).encode())


@pytest.mark.parametrize("kind", ["empty", "encrypted", "too-many", "too-long"])
def test_parser_page_logic_with_synthetic_document_double(monkeypatch, kind):
    import pdfplumber

    class FakePdf:
        doc = SimpleNamespace(encryption=kind == "encrypted")
        pages = [SimpleNamespace(extract_text=lambda: "" if kind == "empty" else
                                 "x" * (30001 if kind == "too-long" else 1))]

        def __enter__(self):
            if kind == "too-many":
                self.pages *= 11
            return self

        def __exit__(self, *_):
            pass

    monkeypatch.setattr(pdfplumber, "open", lambda *_: FakePdf())
    with pytest.raises(ValueError, match={"empty": "PDF_TEXT_UNAVAILABLE",
                       "encrypted": "PDF_ENCRYPTED_UNSUPPORTED", "too-many": "PDF_PAGE_LIMIT",
                       "too-long": "PDF_TEXT_LIMIT"}[kind]):
        worker.extract(b"%PDF-synthetic-double")


def test_actual_route_reports_unsupported_without_saving_preparation(scenario, monkeypatch):
    fixture, _, state = scenario
    value, _, _ = fixture
    monkeypatch.setattr(prep, "isolated_extract", REAL_EXTRACT)
    monkeypatch.setattr(prep.sys, "platform", "darwin")
    response = post(scenario)
    assert response.status_code == 422 and response.json()["detail"] == "UNSUPPORTED_SANDBOX"
    assert state["parses"] == 0
    with sqlite3.connect(value[2]) as con:
        assert not con.execute(
            "SELECT 1 FROM sqlite_master WHERE name='research_pdf_preparations'").fetchone()


@pytest.mark.parametrize("kind", ["ok", "oversize", "timeout", "kill-race", "invalid"])
def test_subprocess_protocol_is_bounded_and_always_reaped(monkeypatch, kind):
    monkeypatch.setattr(prep.sys, "platform", "linux")
    monkeypatch.setitem(prep.LIMITS, "wall_seconds", 0.01)

    class Stream:
        data = (b"x" * 200001 if kind in ("oversize", "kill-race") else
                b"invalid" if kind == "invalid" else
                b'{"status":"OK","extractor":"pdfplumber/stub",'
                b'"pages":[{"page":1,"text":"x"}]}')

        async def read(self, n):
            if kind == "timeout":
                await asyncio.sleep(60)
            head, self.data = self.data[:n], self.data[n:]
            return head

    class Input:
        def write(self, raw):
            assert raw == b"%PDF-stub"

        async def drain(self):
            pass

        def close(self):
            pass

    class Process:
        returncode, waited, killed = None, 0, 0
        stdin, stdout = Input(), Stream()

        def kill(self):
            self.killed += 1
            self.returncode = -9
            if kind == "kill-race":
                raise ProcessLookupError

        async def wait(self):
            self.waited += 1
            self.returncode = self.returncode or 0
            return self.returncode

    process = Process()

    async def spawn(*args, **kwargs):
        assert args[1] == "-I" and set(kwargs["env"]) == {"PATH", "LANG"}
        assert kwargs["stderr"] == asyncio.subprocess.DEVNULL
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    if kind == "ok":
        result = asyncio.run(prep.isolated_extract(b"%PDF-stub"))
        assert result["pages"] == [{"page": 1, "text": "x"}]
    else:
        with pytest.raises(HTTPException) as error:
            asyncio.run(prep.isolated_extract(b"%PDF-stub"))
        assert error.value.detail == {"oversize": "PDF_OUTPUT_LIMIT",
                                     "kill-race": "PDF_OUTPUT_LIMIT",
                                     "timeout": "PDF_PARSER_TIMEOUT",
                                     "invalid": "PDF_PARSER_PROTOCOL_INVALID"}[kind]
    assert process.waited >= 1
    if kind in ("oversize", "kill-race", "timeout"):
        assert process.killed == 1


def test_subprocess_spawn_failure_exposes_only_fixed_code(monkeypatch):
    monkeypatch.setattr(prep.sys, "platform", "linux")

    async def fail(*_args, **_kwargs):
        raise OSError("private file system path")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fail)
    with pytest.raises(HTTPException) as error:
        asyncio.run(prep.isolated_extract(b"%PDF-stub"))
    assert error.value.detail == "PDF_PARSER_PROCESS_FAILED"


def test_preparation_id_mismatch_is_rejected_even_with_valid_content_hash(scenario):
    fixture, _, _ = scenario
    value, _, _ = fixture
    client, _, database, _, base, _, _, _ = value
    artifact = post(scenario).json()
    wrong_key = str(uuid4())
    with sqlite3.connect(database) as con:
        con.execute("INSERT INTO research_pdf_preparations VALUES (?,?,?)",
                    (wrong_key, artifact["run_id"], json.dumps(artifact)))
    response = client.get(f"{base}/pdf-preparations/{wrong_key}")
    assert response.status_code == 409
    assert response.json()["detail"] == "PDF_PREPARATION_BINDING_MISMATCH"


def test_cancelling_parser_task_kills_and_reaps_child(monkeypatch):
    monkeypatch.setattr(prep.sys, "platform", "linux")

    async def exercise():
        entered = asyncio.Event()
        state = {"killed": 0, "waited": 0, "stdin_closed": False}

        class Input:
            def write(self, _raw):
                pass

            async def drain(self):
                await asyncio.sleep(0)

            def close(self):
                state["stdin_closed"] = True

        class Output:
            async def read(self, _n):
                entered.set()
                await asyncio.Future()  # Deterministic pending read, no wall-clock sleep.

        class Process:
            stdin, stdout, returncode = Input(), Output(), None

            def kill(self):
                state["killed"] += 1
                self.returncode = -9

            async def wait(self):
                await asyncio.sleep(0)
                state["waited"] += 1
                return self.returncode

        async def spawn(*_args, **_kwargs):
            return Process()

        monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
        task = asyncio.create_task(prep.isolated_extract(b"%PDF-cancel-stub"))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert state == {"killed": 1, "waited": 1, "stdin_closed": True}

    asyncio.run(exercise())


def test_cancelled_preparation_route_releases_its_slot(tmp_path, monkeypatch):
    from trialboard.api.boundary import DEV_ORIGINS
    from trialboard.api.research import research_router

    calls = []

    async def preparation(*_args):
        calls.append("prepare")
        if len(calls) == 1:
            raise asyncio.CancelledError
        return {"synthetic": True}

    monkeypatch.setattr(prep, "prepare", preparation)
    router = research_router(tmp_path / "unused.sqlite3", BoundedSemaphore(1))
    endpoint = next(r.endpoint for r in router.routes if r.path.endswith("/prepare-server"))
    body = prep.PreparationRequest(consent=True, source_digest="a" * 64,
                                   pdf_sha256="b" * 64, policy_revision=1)
    request = SimpleNamespace(headers={"origin": DEV_ORIGINS[0]})

    async def exercise():
        with pytest.raises(asyncio.CancelledError):
            await endpoint(str(uuid4()), "synthetic", body, request)
        assert await endpoint(str(uuid4()), "synthetic", body, request) == {"synthetic": True}

    asyncio.run(exercise())
    assert calls == ["prepare", "prepare"]
    assert not (tmp_path / "unused.sqlite3").exists()
