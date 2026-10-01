"""Opt-in one-call diagnostic against saved evidence; no searches or DB writes."""

import argparse
import asyncio
import json
import sqlite3
from pathlib import Path
from uuid import UUID

from trialboard.agent.credentials import read_private_key
from trialboard.agent.dacon_provider import DaconResponses
from trialboard.research.agent import PLAN_PROMPT
from trialboard.research.models import Collection, SearchPlan
from trialboard.research.validation import (
    RESEARCH_CONTRACT_VERSION,
    plan_payload,
    research_failure_code,
    source_bound_schema,
    validate_plan,
    validation_details,
)
from trialboard.serialization import sha256_json


def read_saved_run(path: Path, run_id: str) -> Collection:
    if str(UUID(run_id)) != run_id:
        raise ValueError("INVALID_RUN_ID")
    # Read-only URI: do not create a missing DB or mutate historical records.
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as con:
        row = con.execute("SELECT data FROM research_runs WHERE id=?", (run_id,)).fetchone()
    if not row:
        raise ValueError("RESEARCH_NOT_FOUND")
    run = Collection.model_validate_json(row[0])
    if run.id != run_id or run.status == "RUNNING" or not run.sources:
        raise ValueError("INVALID_SAVED_RESEARCH")
    return run


async def probe_plan(run, provider):
    if provider.mode not in ("DACON_RESPONSES", "SCRIPTED_TEST_DOUBLE"):
        raise ValueError("PROBE_PROVIDER_NOT_ALLOWED")
    payload = plan_payload(run)
    ids = {s["id"] for s in payload["sources"]}
    report = {
        "kind": "PLAN_PROBE_NOT_FULL_RESEARCH",
        "based_on_run": run.id,
        "provider": provider.mode,
        "contract_version": RESEARCH_CONTRACT_VERSION,
        "payload_digest": sha256_json(payload),
        "sources_supplied": len(ids),
        "model_calls": 1,
        "status": "STARTED",
    }
    try:
        async with asyncio.timeout(85):
            reply = await provider.complete(
                instructions=PLAN_PROMPT,
                payload=payload,
                schema=source_bound_schema(SearchPlan, ids),
                max_output_tokens=3000,
            )
        report.update(
            status="RECEIVED", input_tokens=reply.input_tokens, output_tokens=reply.output_tokens
        )
        plan = validate_plan(reply.value, ids)
        report.update(
            validation="PASSED", priorities=len(plan.priorities), followups=len(plan.followups)
        )
    except Exception as error:
        report.update(
            validation="REJECTED" if report["status"] == "RECEIVED" else "NOT_EVALUATED",
            error_code=research_failure_code(error),
            details=validation_details(error),
        )
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--db", type=Path, default=Path("output/evidence/trialboard.sqlite3"))
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--allow-external", action="store_true")
    args = parser.parse_args(argv)
    if not args.allow_external:
        parser.error("--allow-external required: sends saved public excerpts; one team API call")
    try:
        run = read_saved_run(args.db, args.run_id)
        provider = DaconResponses(read_private_key(args.key_file))
        report = asyncio.run(probe_plan(run, provider))
    except Exception:
        parser.exit(
            1, "Probe setup failed. Check run and private key file; no raw errors printed.\n"
        )
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report.get("validation") == "PASSED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
