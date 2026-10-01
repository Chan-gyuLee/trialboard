#!/usr/bin/env python3
"""Bounded, explicit Codex worker using only the competition Responses provider.

No login changes, implicit key discovery, personal-provider fallback, or daemon.
Run records are local/private; prompts must contain only authorized non-sensitive data.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path

BASE_URL = "https://dacon-apim-hackathon-0903.azure-api.net/hackathon/openai/v1"
MODELS = ("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")
KEY_ENV = "TRIALBOARD_WORKER_DACON_KEY"
REPO = Path(__file__).resolve().parents[1]


def read_key(path: Path) -> str:
    """Read only the explicitly supplied owner-only regular file, never a symlink."""
    if path.is_symlink():
        raise ValueError("Key file must not be a symlink")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "r") as stream:
        info = os.fstat(stream.fileno())
        parent = path.parent.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError("Key file must be an owned regular file")
        if stat.S_IMODE(info.st_mode) != 0o600 or stat.S_IMODE(parent.st_mode) != 0o700:
            raise ValueError("Key file/directory permissions must be 600/700")
        key = stream.read(1025).strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,256}", key):
        raise ValueError("Key file format is invalid; value is not displayed")
    return key


def redact(text: str, key: str) -> str:
    return text.replace(key, "[REDACTED]")


def private_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    path.chmod(0o600)


def child_environment(key: str) -> dict[str, str]:
    # Keep normal OS home unchanged; never copy personal tokens or login metadata.
    allowed = {"PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"}
    env = {name: value for name, value in os.environ.items() if name in allowed}
    env.update({KEY_ENV: key, "RUST_LOG": "error", "NO_COLOR": "1"})
    return env


def command(binary: str, args: argparse.Namespace, run_dir: Path) -> list[str]:
    config = {
        "model_provider": '"trialboard_dacon"',
        "model_providers.trialboard_dacon.name": '"TrialBoard competition worker"',
        "model_providers.trialboard_dacon.base_url": json.dumps(BASE_URL),
        "model_providers.trialboard_dacon.wire_api": '"responses"',
        "model_providers.trialboard_dacon.env_key": json.dumps(KEY_ENV),
        "model_providers.trialboard_dacon.env_http_headers": '{ "api-key" = "' + KEY_ENV + '" }',
        "model_providers.trialboard_dacon.requires_openai_auth": "false",
        "model_providers.trialboard_dacon.request_max_retries": "0",
        "model_providers.trialboard_dacon.stream_max_retries": "0",
        "model_providers.trialboard_dacon.stream_idle_timeout_ms": "90000",
        "model_reasoning_effort": '"medium"',
        "service_tier": '"default"',
        "approval_policy": '"never"',
        "web_search": '"disabled"',
        "allow_login_shell": "false",
        "shell_environment_policy.inherit": '"core"',
        "shell_environment_policy.ignore_default_excludes": "false",
        "shell_environment_policy.filters": '{ "*KEY*" = "exclude", '
        '"*TOKEN*" = "exclude", "*SECRET*" = "exclude" }',
        "sandbox_workspace_write.network_access": "false",
        "features.multi_agent": "false",
        "agents.enabled": "false",
        "features.apps": "false",
        "features.shell_snapshot": "false",
        "memories.use_memories": "false",
        "memories.generate_memories": "false",
        "log_dir": json.dumps(str(run_dir / "codex-logs")),
        "sqlite_home": json.dumps(str(run_dir / "codex-state")),
        "history.persistence": '"none"',
    }
    result = [
        binary,
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--json",
        "--color",
        "never",
        "--skip-git-repo-check",
        "--model",
        args.model,
        "--sandbox",
        "workspace-write" if args.write else "read-only",
        "--cd",
        str(args.workspace),
    ]
    for name, value in config.items():
        result.extend(["-c", f"{name}={value}"])
    return result + ["-"]


def worker_prompt(task: str, write: bool) -> str:
    return (
        """You are a delegated TrialBoard worker, not the parent conversation.
Use only this configured competition model. Do not launch other agents, Codex,
or alternative model/API clients. No personal-account fallback. Do not read
credentials, auth.json, keychains, .env files, environment dumps or secret folders.
Never print secrets. Do not commit, push, deploy, send messages or install global tools.
Preserve all existing tracked/untracked edits. Apply only the bounded task below.
Use apply_patch for source edits. Do not clean/reset/revert unrelated files.
Read applicable AGENTS.md and task-relevant skills before acting. Do not follow old
handoff tasks as authorization for new work. Report changed paths, tests, limitations.
Only public/authorized non-sensitive material may be sent to the model.
Image generation and ElevenLabs are separate services: do not call them here.
"""
        + (
            "File edits are authorized only within the task scope.\n"
            if write
            else "Read-only task: no file edits, builds with outputs, or external calls.\n"
        )
        + task
    )


def stop_process(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
    except ProcessLookupError:
        pass


def run(args: argparse.Namespace) -> int:
    # 2026-10-01: competition credits are reserved for product runtime only.
    # Fail before reading credentials, taking locks, or spawning a model process.
    print(
        "DACON_DEVELOPMENT_DISABLED: competition API is product-runtime only; "
        "use the personal-account development session.",
        file=sys.stderr,
    )
    return 2


def _archived_run(args: argparse.Namespace) -> int:
    """Historical worker implementation; not reachable from the CLI."""
    os.umask(0o077)
    args.workspace = args.workspace.expanduser().resolve(strict=True)
    if not args.workspace.is_dir():
        raise ValueError("Workspace must be a directory")
    key = read_key(args.dacon_key_file.expanduser().absolute())
    task = args.task_file.read_text()
    if not task.strip() or len(task) > 100_000 or key in task:
        raise ValueError("Task must be nonempty, <=100000 characters, and contain no API key")
    binary = shutil.which("codex")
    if not binary:
        raise ValueError("Codex executable is not installed")
    run_root = REPO / "output" / "dacon-worker"
    run_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_id = hashlib.sha256(str(args.workspace).encode()).hexdigest()[:16]
    with (run_root / f"workspace-{lock_id}.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Another worker owns this workspace; wait for it to finish") from None
        if args.check:
            print(
                json.dumps(
                    {
                        "status": "ready",
                        "network_calls": 0,
                        "model": args.model,
                        "provider": "trialboard_dacon",
                        "base_url": BASE_URL,
                    }
                )
            )
            return 0
        if not args.allow_external:
            raise ValueError("--allow-external required: consumes shared competition quota")
        run_dir = run_root / (time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8])
        run_dir.mkdir(mode=0o700)
        status = {
            "state": "running",
            "model": args.model,
            "provider": "trialboard_dacon",
            "base_url": BASE_URL,
            "workspace": str(args.workspace),
            "write": args.write,
            "timeout_seconds": args.timeout,
            "pid": os.getpid(),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "personal_fallback": False,
            "usage": None,
        }
        private_json(run_dir / "status.json", status)
        (run_dir / "task.txt").write_text(worker_prompt(task, args.write))
        print(f"RUN_DIR={run_dir}", flush=True)
        try:
            process = subprocess.Popen(
                command(binary, args, run_dir),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=child_environment(key),
                start_new_session=True,
            )
        except OSError:
            status["state"] = "launch_failed"
            private_json(run_dir / "status.json", status)
            raise
        status["worker_pid"] = process.pid
        private_json(run_dir / "status.json", status)
        assert process.stdin and process.stdout
        deadline = time.monotonic() + args.timeout
        final = ""
        completed = False
        timed_out = False
        pending = b""

        def record(raw: bytes, log) -> None:
            nonlocal final, completed
            line = redact(raw.decode("utf-8", errors="replace"), key)
            log.write(line + "\n")
            log.flush()
            try:
                event = json.loads(line)
            except ValueError:
                return
            kind = event.get("type", "")
            if kind == "turn.completed":
                completed = True
                status["usage"] = event.get("usage")
            if kind == "item.completed":
                item = event.get("item", {})
                if item.get("type") == "agent_message":
                    final = item.get("text", "")
                print(f"worker: {item.get('type', 'item')} completed", flush=True)
            if kind in {"turn.failed", "error"}:
                print(f"worker: {kind}; inspect private events.jsonl", flush=True)

        try:
            process.stdin.write(worker_prompt(task, args.write).encode())
            process.stdin.close()
            with (
                selectors.DefaultSelector() as selector,
                (run_dir / "events.jsonl").open("w") as log,
            ):
                selector.register(process.stdout, selectors.EVENT_READ)
                while selector.get_map():
                    if time.monotonic() >= deadline:
                        timed_out = True
                        stop_process(process)
                        break
                    for selected, _ in selector.select(timeout=0.5):
                        block = os.read(selected.fileobj.fileno(), 65536)
                        if not block:
                            selector.unregister(selected.fileobj)
                            break
                        pending += block
                        while b"\n" in pending:
                            line, pending = pending.split(b"\n", 1)
                            record(line, log)
                if pending:
                    record(pending, log)
            process.wait(timeout=5)
        except BaseException:
            stop_process(process)
            status["state"] = "interrupted"
            private_json(run_dir / "status.json", status)
            raise
        status.update(
            {
                "state": "timed_out"
                if timed_out
                else ("completed" if process.returncode == 0 and completed else "failed"),
                "exit_code": process.returncode,
                "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
        )
        (run_dir / "result.md").write_text(final)
        private_json(run_dir / "status.json", status)
        print(json.dumps(status, ensure_ascii=False), flush=True)
        return 0 if status["state"] == "completed" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dacon-key-file", required=True, type=Path)
    parser.add_argument("--task-file", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--model", choices=MODELS, default="gpt-5.6-sol")
    parser.add_argument("--write", action="store_true", help="Enable scoped workspace writes")
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--allow-external", action="store_true")
    parser.add_argument(
        "--check", action="store_true", help="Validate locally without a model call"
    )
    args = parser.parse_args()
    if not 10 <= args.timeout <= 3600:
        parser.error("Timeout must be 10..3600 seconds")

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        return run(args)
    except (ValueError, OSError):
        # Deliberately do not echo arbitrary exception text or HTTP bodies.
        print(
            "Worker setup failed. Check explicit paths, permissions and workspace lock. "
            "No personal-account fallback.",
            file=sys.stderr,
        )
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
