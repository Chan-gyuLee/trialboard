"""The historical developer worker must not spend product-runtime credits."""

import argparse
import importlib.util
from pathlib import Path


def test_worker_refuses_before_credentials_or_process(monkeypatch, capsys):
    path = Path(__file__).resolve().parents[1] / "scripts" / "dacon_worker.py"
    spec = importlib.util.spec_from_file_location("disabled_dacon_worker", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def forbidden(*args, **kwargs):
        raise AssertionError("Disabled development worker must not access secrets or spawn")

    monkeypatch.setattr(module, "read_key", forbidden)
    monkeypatch.setattr(module.subprocess, "Popen", forbidden)
    monkeypatch.setattr(module, "_archived_run", forbidden)
    assert module.run(argparse.Namespace()) == 2
    assert "DACON_DEVELOPMENT_DISABLED" in capsys.readouterr().err
