"""Read-only, selected-source handoff. No new model, numeric evidence or PDF permission."""

from urllib.parse import urlsplit

from fastapi import HTTPException

from trialboard.api.team_auth import current_access_scope
from trialboard.research.citations import citation_context
from trialboard.research.models import Collection, ResearchReview
from trialboard.research.review_usage import record
from trialboard.research.saved_review import SavedReviewRequest, selected, team_database
from trialboard.research.source_policy import existing_connection, source_rows, tables
from trialboard.serialization import sha256_json

ARTIFACT_KEYS = {
    "schema",
    "mode",
    "run_id",
    "attempt_id",
    "status",
    "created_at",
    "completed_at",
    "asserted_by",
    "context",
    "source_bindings",
    "sources",
    "collector_calls",
    "plan_calls",
    "model_calls",
    "execution_mode",
    "model",
    "response_id",
    "input_tokens",
    "output_tokens",
    "review",
    "citation_bindings",
    "error_code",
    "notices",
}


def identity_check(identity, access):
    scope = current_access_scope()
    fresh = identity.revalidate(access) if identity and access else None
    if (
        fresh is None
        or scope is None
        or fresh.role not in ("admin", "reviewer", "viewer")
        or (fresh.subject_id, fresh.team_id, fresh.role)
        != (access.subject_id, access.team_id, access.role)
        or (scope.subject_id, scope.team_id) != (fresh.subject_id, fresh.team_id)
    ):
        raise HTTPException(403, "SAVED_REVIEW_HANDOFF_IDENTITY_INVALIDATED")


def checked_url(value, *, nullable=False):
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not 1 <= len(value) <= 2048:
        raise ValueError
    parsed = urlsplit(value)
    if (
        parsed.scheme not in ("https", "http")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or any(ord(c) < 33 or ord(c) == 127 for c in value)
    ):
        raise ValueError
    return value


def handoff(path, identity, run_id, attempt_id):
    access = current_access_scope()
    identity_check(identity, access)
    con = existing_connection(team_database(path))
    try:
        con.execute("BEGIN")
        source_rows(con, run_id)
        if "research_saved_review_records" not in tables(con):
            raise HTTPException(404, "SAVED_REVIEW_NOT_FOUND")
        rows = con.execute(
            """SELECT attempt_id,phase,run_id,created_at,data
            FROM research_saved_review_records WHERE run_id=? AND attempt_id=?
            ORDER BY phase LIMIT 3""",
            (run_id, attempt_id),
        ).fetchall()
        if not rows:
            raise HTTPException(404, "SAVED_REVIEW_NOT_FOUND")
        values = [record(row, run_id) for row in rows]
        artifact = values[-1]
        if artifact["status"] != "COMPLETED":
            raise HTTPException(409, "SAVED_REVIEW_HANDOFF_NOT_READY")
        try:
            if (
                len(values) != 2
                or rows[0][1] != 0
                or rows[1][1] != 1
                or any(set(value) != ARTIFACT_KEYS for value in values)
                or any(
                    values[0][key] != artifact[key]
                    for key in (
                        "source_bindings",
                        "sources",
                        "context",
                        "asserted_by",
                        "created_at",
                    )
                )
                or artifact["attempt_id"] != attempt_id
                or artifact["error_code"] is not None
                or any(
                    type(artifact[key]) is not int or artifact[key] != 0
                    for key in ("collector_calls", "plan_calls")
                )
            ):
                raise ValueError
            SavedReviewRequest.model_validate(
                {"model_consent": True, "source_bindings": artifact["source_bindings"]}
            )
            if (
                any(
                    value is not None and (not isinstance(value, str) or len(value) > 200)
                    for value in (artifact["model"], artifact["response_id"])
                )
                or not isinstance(artifact["notices"], list)
                or len(artifact["notices"]) > 10
                or any(
                    not isinstance(value, str) or not 1 <= len(value) <= 500
                    for value in artifact["notices"]
                )
            ):
                raise ValueError
            context, sources = selected(con, run_id, artifact["source_bindings"], outgoing=False)
            if context != artifact["context"] or artifact["sources"] != [
                {"source_id": source.id, "source_digest": source.digest, "title": source.title}
                for source in sources
            ]:
                raise HTTPException(409, "RESEARCH_SOURCE_VERSION_MISMATCH")
            review = ResearchReview.model_validate(artifact["review"])
            if any(not q.strip() or len(q) > 700 for q in review.questions):
                raise ValueError
            _, anchors, _ = citation_context(sources)
            bindings = artifact["citation_bindings"]
            if not isinstance(bindings, list) or len(bindings) != len(review.findings):
                raise ValueError
            for finding, binding in zip(review.findings, bindings, strict=True):
                span = anchors.get(binding.get("anchor_id")) if isinstance(binding, dict) else None
                if (
                    span is None
                    or type(binding.get("start")) is not int
                    or type(binding.get("end")) is not int
                    or binding != span.binding()
                    or finding.source_id != span.source_id
                    or finding.quote != span.text
                    or not finding.interpretation.strip()
                ):
                    raise HTTPException(409, "SAVED_REVIEW_CITATION_MISMATCH")
            run = Collection.model_validate_json(
                con.execute("SELECT data FROM research_runs WHERE id=?", (run_id,)).fetchone()[0]
            )
            metadata = [
                {
                    "source_id": source.id,
                    "source_digest": source.digest,
                    "title": source.title,
                    "url": checked_url(source.url),
                    "pdf_url": checked_url(source.pdf_url, nullable=True),
                    "content_level": source.content_level,
                }
                for source in sources
            ]
            packet = {
                "schema": "research-saved-review-handoff/1",
                "run_id": run_id,
                "attempt_id": attempt_id,
                "artifact_digest": sha256_json(artifact),
                "context": {"search_id": run.request.search_id, **context},
                "sources": metadata,
                "artifact": artifact,
                "clinical_verified": False,
            }
        except (ValueError, TypeError, KeyError, AttributeError):
            raise HTTPException(422, "SAVED_REVIEW_HANDOFF_RECORD_INVALID") from None
        identity_check(identity, access)
        return packet
    finally:
        con.close()
