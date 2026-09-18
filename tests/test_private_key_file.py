"""Synthetic credentials only; no user credential files are opened by tests."""

import os

import pytest

from trialboard.agent.credentials import read_private_key


@pytest.mark.skipif(os.name != "posix", reason="POSIX owner-only key files")
def test_private_file_is_secret_and_not_echoed(tmp_path):
    path = tmp_path / "secret"
    path.write_text("test-only-key\n")
    path.chmod(0o600)
    key = read_private_key(path)
    assert key.get_secret_value() == "test-only-key"
    assert "test-only-key" not in str(key) + repr(key)


@pytest.mark.parametrize(
    "kind",
    [
        "readable",
        "empty",
        "large",
        "whitespace",
        "unicode",
        "missing",
        "symlink",
        "hardlink",
        "directory",
        "fifo",
    ],
)
@pytest.mark.skipif(os.name != "posix", reason="POSIX owner-only key files")
def test_unsafe_files_fail_with_no_contents_or_path(tmp_path, kind):
    path = tmp_path / "private-path"
    if kind == "directory":
        path.mkdir()
    elif kind == "fifo":
        os.mkfifo(path)
    elif kind != "missing":
        path.write_text(
            {
                "empty": "",
                "large": "x" * 4097,
                "whitespace": "key with spaces",
                "unicode": "테스트",
            }.get(kind, "secret")
        )
        path.chmod(0o644 if kind == "readable" else 0o600)
        if kind in ("symlink", "hardlink"):
            target = tmp_path / "link"
            if kind == "symlink":
                target.symlink_to(path)
            else:
                os.link(path, target)
            path = target
    with pytest.raises(ValueError, match="^INVALID_PRIVATE_KEY_FILE$"):
        read_private_key(path)


def test_server_key_file_option_loads_before_app_without_exposing_value(tmp_path, monkeypatch):
    from trialboard.api import __main__ as command

    path = tmp_path / "key"
    path.write_text("test-only-key")
    path.chmod(0o600)
    monkeypatch.setenv("TRIALBOARD_DACON_API_KEY", "")
    monkeypatch.setattr("sys.argv", ["api", "--dacon-key-file", str(path)])
    calls = []
    monkeypatch.setattr(command.uvicorn, "run", lambda *a, **kw: calls.append(kw))
    command.main()
    assert os.environ["TRIALBOARD_DACON_API_KEY"] == "test-only-key"
    assert calls[0]["host"] == "127.0.0.1" and calls[0]["access_log"] is False


@pytest.mark.parametrize("extra", [["--prompt-dacon-key"], ["--agent-provider", "codex"]])
def test_incompatible_credential_options_fail_before_read(monkeypatch, extra):
    from trialboard.api import __main__ as command

    monkeypatch.setattr("sys.argv", ["api", "--dacon-key-file", "not-opened", *extra])
    monkeypatch.setattr(
        "trialboard.agent.credentials.read_private_key", lambda *a: pytest.fail("must not read")
    )
    with pytest.raises(SystemExit) as result:
        command.main()
    assert result.value.code == 2
