import asyncio
import copy
import json
import os
import sys
from pathlib import Path

import pytest

from trialboard.agent.codex_provider import (
    CODE_MODE_DISABLED_NOTICE,
    DISABLED_FEATURES,
    TESTED_VERSION,
    CodexChatGPT,
    child_environment,
    parse_events,
    run_process,
)
from trialboard.agent.engine import Limits, run_agent
from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.models import Extraction
from trialboard.agent.provider import ModelError
from trialboard.agent.report import markdown


def events(value=None):
    return [
        {"type": "thread.started", "thread_id": "test-thread"},
        {"type": "turn.started"},
        {"type": "item.completed", "item": {"type": "reasoning", "text": "not retained"}},
        {
            "type": "item.completed",
            "item": {"type": "agent_message", "text": json.dumps(value or {"observations": []})},
        },
        {
            "type": "turn.completed",
            "usage": {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 50},
        },
    ]


def encoded(items):
    return "\n".join(json.dumps(item) for item in items).encode()


def test_jsonl_retains_only_final_json_and_usage_not_reasoning():
    reply = parse_events(encoded(events()))
    assert reply.value == {"observations": []}
    assert reply.response_id == "codex-thread:test-thread"
    assert (reply.input_tokens, reply.output_tokens) == (100, 50)
    assert "not retained" not in repr(reply)


@pytest.mark.parametrize(
    "kind",
    [
        "command_execution",
        "mcp_tool_call",
        "web_search",
        "file_change",
        "collab_tool_call",
        "unknown",
    ],
)
def test_unexpected_tool_events_fail_closed(kind):
    stream = events()
    stream[2]["item"]["type"] = kind
    with pytest.raises(ModelError, match="^CODEX_UNEXPECTED_TOOL_EVENT$"):
        parse_events(encoded(stream))


@pytest.mark.parametrize(
    "mutation",
    [
        lambda x: x.pop(),
        lambda x: x[-1].pop("usage"),
        lambda x: x[-1]["usage"].update(input_tokens=True),
        lambda x: x[-1]["usage"].update(output_tokens=-1),
        lambda x: x[-1]["usage"].update(output_tokens="50"),
        lambda x: x[0].update(thread_id="private/path"),
        lambda x: x[3]["item"].update(text='{"x":1,"x":2}'),
        lambda x: x[3]["item"].update(text='{"x":NaN}'),
        lambda x: x[3]["item"].update(text="[]"),
        lambda x: x.insert(3, copy.deepcopy(x[3])),
        lambda x: x.append({"type": "turn.started"}),
        lambda x: x[1].update(type="future.unknown"),
    ],
)
def test_malformed_stream_does_not_become_a_success_or_zero_usage(mutation):
    stream = events()
    mutation(stream)
    with pytest.raises(ModelError, match="^CODEX_RESPONSE_INVALID$"):
        parse_events(encoded(stream))


def test_provider_error_text_is_not_exposed():
    stream = events()[:2] + [{"type": "error", "message": "PRIVATE_DIAGNOSTIC"}]
    with pytest.raises(ModelError, match="^CODEX_TURN_FAILED$"):
        parse_events(encoded(stream))


def test_only_exact_disabled_host_startup_notice_is_allowed_and_recorded():
    stream = events()
    notice = {
        "type": "item.completed",
        "item": {"type": "error", "message": CODE_MODE_DISABLED_NOTICE},
    }
    stream.insert(1, notice)
    assert parse_events(encoded(stream)).notices == ("CODEX_CODE_MODE_DISABLED",)
    stream[1]["item"]["message"] = "Unrecognized warning or private diagnostic"
    with pytest.raises(ModelError, match="^CODEX_ITEM_ERROR$"):
        parse_events(encoded(stream))
    stream = events()
    notice["item"]["message"] = CODE_MODE_DISABLED_NOTICE
    stream.insert(3, notice)
    with pytest.raises(ModelError, match="^CODEX_ITEM_ERROR$"):
        parse_events(encoded(stream))


class Runner:
    def __init__(self, login="Logged in using ChatGPT", version=TESTED_VERSION, code=0):
        self.login, self.version, self.code = login, version, code
        self.calls = []

    async def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if args[1:] == ["--version"]:
            return 0, self.version.encode(), b""
        if args[1:] == ["login", "status"]:
            return 0, b"", self.login.encode()
        schema_path = Path(args[args.index("--output-schema") + 1])
        assert json.loads(schema_path.read_text())["title"] == "Extraction"
        assert schema_path.stat().st_mode & 0o777 == 0o600
        assert list(schema_path.parent.iterdir()) == [schema_path]
        return self.code, encoded(events()), b"PRIVATE_DIAGNOSTIC"


def complete(provider):
    return asyncio.run(
        provider.complete(
            instructions="Extract.",
            payload={"source": "untrusted"},
            schema=Extraction.model_json_schema(),
            max_output_tokens=4000,
        )
    )


def test_command_uses_saved_chatgpt_auth_without_shell_or_repository_context():
    runner = Runner()
    provider = CodexChatGPT(runner=runner, executable="/test/codex")
    complete(provider)
    args, kwargs = runner.calls[-1]
    assert args[:2] == ["/test/codex", "exec"]
    assert args[-1] == "-"
    assert "--ignore-user-config" in args and "--ephemeral" in args
    assert args[args.index("--sandbox") + 1] == "read-only"
    assert 'forced_login_method="chatgpt"' in args
    assert 'model_provider="openai"' in args
    assert 'web_search="disabled"' in args
    assert 'approval_policy="never"' in args
    assert "mcp_servers={}" in args
    assert all(args[args.index(f) - 1] == "--disable" for f in DISABLED_FEATURES)
    assert b"untrusted" in kwargs["stdin"]
    assert "untrusted" not in " ".join(args)
    assert not Path(kwargs["cwd"]).exists()
    assert provider.model == "codex-cli-default-not-resolved"
    assert provider.runtime["codex_cli"] == TESTED_VERSION


@pytest.mark.parametrize("login", ["Not logged in", "Logged in using an API key", ""])
def test_other_auth_methods_never_start_a_model_turn(login):
    runner = Runner(login=login)
    with pytest.raises(ModelError, match="^CODEX_CHATGPT_LOGIN_REQUIRED$"):
        complete(CodexChatGPT(runner=runner, executable="/test/codex"))
    assert len(runner.calls) == 2


def test_unvalidated_cli_version_stops_before_auth_or_model_calls():
    runner = Runner(version="codex-cli 0.999.0")
    with pytest.raises(ModelError, match="^CODEX_VERSION_NOT_VALIDATED$"):
        complete(CodexChatGPT(runner=runner, executable="/test/codex"))
    assert len(runner.calls) == 1


def test_exec_error_does_not_leak_raw_stderr_or_fallback():
    with pytest.raises(ModelError, match="^CODEX_EXEC_FAILED$"):
        complete(CodexChatGPT(runner=Runner(code=1), executable="/test/codex"))


def test_child_environment_does_not_forward_keys_or_provider_overrides(monkeypatch):
    monkeypatch.setenv("TRIALBOARD_OPENAI_API_KEY", "test-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://invalid.example")
    monkeypatch.setenv("CODEX_THREAD_ID", "parent-private-thread")
    monkeypatch.setenv("HTTPS_PROXY", "https://invalid.example")
    env = child_environment()
    assert env.get("HOME") == os.environ.get("HOME")
    assert not any(
        key in env
        for key in (
            "TRIALBOARD_OPENAI_API_KEY",
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "CODEX_THREAD_ID",
            "HTTPS_PROXY",
        )
    )
    assert "test-secret" not in env.values()


def test_model_override_is_explicit_and_not_a_shell_fragment():
    with pytest.raises(ValueError, match="INVALID_CODEX_MODEL"):
        CodexChatGPT(model="model; bad", executable="/test/codex")
    runner = Runner()
    complete(CodexChatGPT(model="test-model", runner=runner, executable="/test/codex"))
    args = runner.calls[-1][0]
    assert args[args.index("--model") + 1] == "test-model"


def test_runner_bounds_both_output_pipes(tmp_path):
    with pytest.raises(ModelError, match="^CODEX_OUTPUT_TOO_LARGE$"):
        asyncio.run(
            run_process(
                [sys.executable, "-c", "import sys; sys.stderr.write('x' * 10000)"],
                cwd=str(tmp_path),
                limit=100,
            )
        )


def test_runner_cancellation_kills_and_reaps_child(tmp_path, monkeypatch):
    original = asyncio.create_subprocess_exec
    processes = []

    async def capture(*args, **kwargs):
        process = await original(*args, **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", capture)

    async def task():
        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0.1):
                await run_process(
                    [sys.executable, "-c", "import time; time.sleep(30)"], cwd=str(tmp_path)
                )

    asyncio.run(task())
    assert len(processes) == 1
    assert processes[0].returncode is not None


def test_engine_marks_codex_path_and_nonhard_output_limit():
    class FakeCodex(ScriptedProvider):
        # Protocol test only: not used by the CLI or presented as a live result.
        mode = "CODEX_CHATGPT"
        runtime = {"codex_cli": "test-double"}

    result = asyncio.run(run_agent(demo_input(), FakeCodex(), Limits(max_calls=2)))
    assert result.status == "DRAFT_FOR_EXPERT_REVIEW"
    assert result.runtime["codex_cli"] == "test-double"
    assert any("NOT a hard" in text for text in result.limitations)
    assert "ChatGPT 로그인" in markdown(result)
    assert "잔여 한도가 아닙니다" in markdown(result)


def test_cli_live_example_requires_explicit_outbound_consent(monkeypatch, capsys):
    from trialboard.agent.__main__ import main

    monkeypatch.setattr(sys, "argv", ["trialboard-agent", "--live-example", "normal"])
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 2
    assert "--allow-external" in capsys.readouterr().err


def test_cli_defaults_to_codex_not_api_billing(monkeypatch, tmp_path):
    from trialboard.agent import __main__ as cli

    selected = []

    def fake_codex(model):
        selected.append(model)
        return ScriptedProvider()

    monkeypatch.setattr(cli, "CodexChatGPT", fake_codex)
    monkeypatch.delenv("TRIALBOARD_CODEX_MODEL", raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "trialboard-agent",
            "--live-example",
            "normal",
            "--allow-external",
            "--max-calls",
            "2",
            "--max-repairs",
            "0",
        ],
    )
    cli.main()
    assert selected == [None]
    files = list((tmp_path / "output" / "agent").iterdir())
    assert len(files) == 2
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in files)


def test_cli_explicit_openai_requires_its_own_configuration(monkeypatch, capsys):
    from trialboard.agent.__main__ import main

    monkeypatch.delenv("TRIALBOARD_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("TRIALBOARD_OPENAI_MODEL", raising=False)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "trialboard-agent",
            "--live-example",
            "normal",
            "--allow-external",
            "--provider",
            "openai",
        ],
    )
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 2
    assert "TRIALBOARD_OPENAI_API_KEY" in capsys.readouterr().err
