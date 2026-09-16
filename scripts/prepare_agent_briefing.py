"""Prepare explicitly labelled presentation records; never call a model.

Only the exact repository public development excerpt and synthetic test data
may be bundled. Arbitrary user documents are not accepted for publication.
"""

import argparse
import asyncio
from pathlib import Path

from trialboard.agent.engine import run_agent
from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.models import AgentReport
from trialboard.agent.public_case import public_input
from trialboard.serialization import sha256_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-report", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = AgentReport.model_validate_json(args.public_report.read_text())
    expected = public_input()
    if (
        report.input != expected
        or report.input_digest != sha256_json(expected.model_dump())
        or report.execution_mode != "CODEX_CHATGPT"
        or report.engine_version != "bounded-evidence-agent/3.2"
    ):
        raise ValueError("Only the exact recorded public development case is allowed")
    repair = asyncio.run(run_agent(demo_input(), ScriptedProvider("repair")))
    args.output.mkdir(parents=True, exist_ok=True)
    # Exclusive creation protects earlier presentation records from silent replacement.
    for name, data in [("public-record.json", report), ("synthetic-repair.json", repair)]:
        with (args.output / name).open("x") as target:
            target.write(data.model_dump_json(indent=2))
            target.write("\n")


if __name__ == "__main__":
    main()
