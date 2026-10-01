"""Read-only observed SAVED_REVIEW_ONLY counters; never infer billing or account quota."""

from uuid import UUID

from fastapi import HTTPException

from trialboard.agent.provider import parse_json
from trialboard.research.saved_review import team_database, utc_now
from trialboard.research.source_policy import existing_connection, source_rows, tables

MODES = ("DACON_RESPONSES", "SCRIPTED_TEST_DOUBLE", "COLLECTORS_ONLY")
FIELDS = ("observed_model_calls", "observed_input_tokens", "observed_output_tokens",
          "input_unknown_attempts", "output_unknown_attempts")
STATUS = {"COMPLETED": "completed_attempts", "FAILED": "failed_attempts",
          "CANCELLED": "cancelled_attempts", "RUNNING": "unfinished_attempts"}
SAFE_INTEGER = 9_007_199_254_740_991
MAX_RECORDS = 10_000
KINDS = {
    "SOURCE": ("research_saved_review_records", "research-saved-review/1",
               "SAVED_REVIEW_ONLY", "research-saved-review-usage/1",
               ("source_bindings", "context", "asserted_by", "created_at")),
    "PDF": ("research_pdf_review_records", "research-pdf-review/1",
            "PREPARED_PDF_REVIEW_ONLY", "research-pdf-review-usage/1",
            ("preparation_id", "preparation_digest", "source_id", "source_digest",
             "pdf_sha256", "policy_revision", "asserted_by", "created_at")),
}


def invalid():
    raise HTTPException(422, "REVIEW_USAGE_RECORD_INVALID")


def number(value, maximum=SAFE_INTEGER):
    if type(value) is not int or not 0 <= value <= maximum:
        invalid()
    return value


def record(row, run_id, kind="SOURCE"):
    _, schema, scope, _, bindings = KINDS[kind]
    attempt_id, phase, stored_run, created_at, raw = row
    try:
        if len(raw) > 1_000_000:
            invalid()
        value = parse_json(raw)
        required = {"schema", "mode", "run_id", "attempt_id", "created_at", "completed_at",
                    "execution_mode", "model_calls", "input_tokens", "output_tokens",
                    "asserted_by", "status", *bindings}
        if (type(phase) is not int or phase not in (0, 1) or stored_run != run_id
                or str(UUID(attempt_id)) != attempt_id or not isinstance(value, dict)
                or not required.issubset(value)
                or value.get("schema") != schema
                or value.get("mode") != scope
                or value.get("run_id") != run_id or value.get("attempt_id") != attempt_id
                or value.get("created_at") != created_at
                or value.get("execution_mode") not in MODES):
            invalid()
        status = value.get("status")
        if status not in STATUS or (phase == 0) != (status == "RUNNING"):
            invalid()
        calls = number(value.get("model_calls"), 1)
        for key in ("input_tokens", "output_tokens"):
            if value.get(key) is not None:
                number(value[key])
                if calls == 0:
                    invalid()
        if phase == 0 and (calls != 0 or value.get("completed_at") is not None
                           or value["execution_mode"] != "COLLECTORS_ONLY"):
            invalid()
        if phase == 1 and not isinstance(value.get("completed_at"), str):
            invalid()
        if (value["execution_mode"] == "COLLECTORS_ONLY" and calls != 0
                or status == "COMPLETED" and calls != 1):
            invalid()
        for key in bindings:
            if key not in value:
                invalid()
        if kind == "PDF":
            if (set(value) != required | {"model", "response_id", "review", "error_code", "notices"}
                    or str(UUID(value["preparation_id"])) != value["preparation_id"]
                    or not isinstance(value["source_id"], str) or not value["source_id"]
                    or number(value["policy_revision"], 100) < 1):
                invalid()
            for key in ("preparation_digest", "source_digest", "pdf_sha256"):
                digest = value[key]
                if (not isinstance(digest, str) or len(digest) != 64
                        or any(c not in "0123456789abcdef" for c in digest)):
                    invalid()
        return value
    except (ValueError, TypeError, KeyError, AttributeError):
        invalid()


def aggregate(result, value):
    result["attempts_total"] += 1
    result[STATUS[value["status"]]] += 1
    if value["status"] == "RUNNING":
        return  # Neither provider nor actual call count is established by a start record.
    group = result["usage_by_mode"][value["execution_mode"]]
    group["observed_model_calls"] += value["model_calls"]
    for direction in ("input", "output"):
        tokens = value[direction + "_tokens"]
        if tokens is not None:
            group["observed_" + direction + "_tokens"] += tokens
        elif value["model_calls"] > 0:
            group[direction + "_unknown_attempts"] += 1
    for total in group.values():
        number(total)


def review_usage(path, run_id, *, kind="SOURCE"):
    table, _, scope, schema, bindings = KINDS[kind]  # Internal static enum; never request SQL.
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        source_rows(con, run_id)  # Metadata existence/team scope only; no source body is returned.
        result = {"schema": schema, "scope": scope,
                  "run_id": run_id, "as_of": utc_now(), "attempts_total": 0,
                  **dict.fromkeys(STATUS.values(), 0),
                  "usage_by_mode": {mode: dict.fromkeys(FIELDS, 0) for mode in MODES}}
        if table not in tables(con):
            return result
        rows = con.execute(f"""SELECT attempt_id,phase,run_id,created_at,data
            FROM {table} WHERE run_id=? ORDER BY attempt_id,phase
            LIMIT ?""", (run_id, MAX_RECORDS + 1))
        pending, previous_phase = None, None
        for index, row in enumerate(rows, 1):
            if index > MAX_RECORDS:
                raise HTTPException(422, "REVIEW_USAGE_LOOKUP_LIMIT")
            value = record(row, run_id, kind)
            if pending is None or pending["attempt_id"] != value["attempt_id"]:
                if pending is not None:
                    aggregate(result, pending)
                if row[1] != 0:
                    invalid()
                pending = value
            else:
                if previous_phase != 0 or row[1] != 1:
                    invalid()
                for key in bindings:
                    if pending[key] != value[key]:
                        invalid()
                pending = value
            previous_phase = row[1]
        if pending is not None:
            aggregate(result, pending)
        return result
    finally:
        con.close()
