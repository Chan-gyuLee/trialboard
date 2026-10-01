"""Read current Codex account rate limits via public RPC; no model inference."""

import json
import os
import selectors
import shutil
import subprocess
import time


def read_usage():
    binary = shutil.which("codex")
    if not binary:
        return {"status": "unavailable", "reason": "CLI_NOT_FOUND"}
    # Keep the active account's normal CLI context, never inspect credential files.
    env = os.environ.copy()
    for name in [
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
        "TRIALBOARD_DACON_API_KEY",
        "TRIALBOARD_WORKER_DACON_KEY",
    ]:
        env.pop(name, None)
    process = subprocess.Popen(
        [binary, "app-server", "--listen", "stdio://"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=env,
    )
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    pending = b""
    deadline = time.monotonic() + 25

    def send(value):
        process.stdin.write((json.dumps(value) + "\n").encode())
        process.stdin.flush()

    def response(identifier):
        nonlocal pending
        while time.monotonic() < deadline:
            if b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                try:
                    value = json.loads(line)
                except ValueError:
                    continue
                if value.get("id") == identifier:
                    return value
            elif selector.select(timeout=0.2):
                chunk = os.read(process.stdout.fileno(), 65536)
                if not chunk:
                    break
                pending += chunk
        return {}

    try:
        send(
            {
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {
                        "name": "trialboard_usage_read",
                        "title": "TrialBoard usage check",
                        "version": "1.0",
                    }
                },
            }
        )
        if "result" not in response(1):
            return {"status": "unavailable", "reason": "INITIALIZE_FAILED"}
        send({"method": "initialized", "params": {}})
        send({"id": 2, "method": "account/read", "params": {"refreshToken": False}})
        account = response(2).get("result", {}).get("account") or {}
        if account.get("type") != "chatgpt":
            return {
                "status": "unavailable",
                "reason": "NOT_CHATGPT_LOGIN",
                "account_type": account.get("type"),
            }
        send({"id": 3, "method": "account/rateLimits/read"})
        data = response(3).get("result", {})
        buckets = data.get("rateLimitsByLimitId") or {"codex": data.get("rateLimits")}
        safe = {}
        for name, bucket in buckets.items():
            if not isinstance(bucket, dict):
                continue
            safe[name] = {
                window: {
                    key: value
                    for key, value in (bucket.get(window) or {}).items()
                    if key in ["usedPercent", "windowDurationMins", "resetsAt"]
                }
                for window in ["primary", "secondary"]
            }
        known_windows = [
            window
            for bucket in safe.values()
            for window in bucket.values()
            if isinstance(window.get("usedPercent"), (int, float))
            and 0 <= window["usedPercent"] <= 100
            and isinstance(window.get("windowDurationMins"), (int, float))
            and window["windowDurationMins"] > 0
        ]
        return {
            "status": "ok" if known_windows else "unavailable",
            "account_type": "chatgpt",
            "buckets": safe,
            "checked_at": int(time.time()),
            "model_calls": 0,
        }
    finally:
        selector.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


if __name__ == "__main__":
    print(json.dumps(read_usage(), ensure_ascii=False))
