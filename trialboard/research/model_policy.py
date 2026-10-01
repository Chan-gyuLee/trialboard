"""Lazy per-call TEAM SOURCE_TEXT authorization. Never authorizes PDF/raw material."""

import json
import sqlite3

from fastapi import HTTPException

from trialboard.agent.provider import ModelError
from trialboard.api.model_policy import ModelPolicyDenied
from trialboard.api.team_auth import TeamDataPath, current_access_scope
from trialboard.research.citations import citation_context
from trialboard.research.models import Collection
from trialboard.research.relevance import selection_record
from trialboard.research.source_policy import current_policy, existing_connection, source_rows
from trialboard.research.validation import plan_payload


class ResearchModelGate:
    def __init__(self, path, identity, access, run):
        context = current_access_scope()
        if (not isinstance(path, TeamDataPath) or identity is None or access is None
                or context is None or (context.subject_id, context.team_id)
                != (access.subject_id, access.team_id)):
            raise ModelPolicyDenied("MODEL_RESEARCH_BINDING_REQUIRED")
        self.path, self.identity, self.access, self.run = path, identity, access, run
        self.database = path.lookup()
        self.revisions = {}
        self.raw_revisions = {}

    def check(self, payload):
        fresh = self.identity.revalidate(self.access)
        if fresh is None or fresh.role == "viewer":
            raise ModelPolicyDenied("MODEL_IDENTITY_INVALIDATED")
        if (fresh.subject_id, fresh.team_id) != (self.access.subject_id, self.access.team_id):
            raise ModelPolicyDenied("MODEL_IDENTITY_INVALIDATED")
        if self.database is None or not self.database.exists():
            raise ModelPolicyDenied("MODEL_RESEARCH_NOT_FOUND")
        if not isinstance(payload, dict) or len(json.dumps(payload)) > 2_000_000:
            raise ModelPolicyDenied("MODEL_RESEARCH_PAYLOAD_LIMIT")
        con = existing_connection(self.database)
        try:
            con.execute("BEGIN")
            from trialboard.research.raw_policy import RawReadContext

            raw_context = RawReadContext(con, self.run.id)
            rows = source_rows(con, self.run.id)
            raw = con.execute(
                "SELECT data FROM research_runs WHERE id=?", (self.run.id,)
            ).fetchone()
            stored = Collection.model_validate_json(raw[0])
            if stored.request != self.run.request or stored.sources != self.run.sources:
                raise ModelPolicyDenied("MODEL_RESEARCH_VERSION_MISMATCH")
            versions = {(sid, digest) for sid, digest, _ in rows}
            if not stored.sources or versions != {(s.id, s.digest) for s in stored.sources}:
                raise ModelPolicyDenied("MODEL_RESEARCH_BINDING_MISMATCH")
            pending = {}
            # Previous plans and selection metadata can depend on the entire run.
            for source in stored.sources:
                policy = current_policy(con, stored.id, source.id, source.digest)
                if any(policy[p] != "ALLOW" for p in ("original_storage", "external_ai")):
                    raise ModelPolicyDenied("MODEL_RESEARCH_EXTERNAL_AI_NOT_ALLOWED")
                key = (source.id, source.digest)
                if any(sid == source.id and digest != source.digest
                       for sid, digest in self.revisions):
                    raise ModelPolicyDenied("MODEL_RESEARCH_VERSION_MISMATCH")
                revision = policy["policy_revision"]
                if key in self.revisions and self.revisions[key] != revision:
                    raise ModelPolicyDenied("MODEL_RESEARCH_POLICY_CHANGED")
                pending[key] = revision
                raw_revisions = raw_context.authorize_source(
                    source.id, source.digest, purpose="external_ai")
                if any(key in self.raw_revisions and self.raw_revisions[key] != revision
                       for key, revision in raw_revisions.items()):
                    raise ModelPolicyDenied("MODEL_RESEARCH_RAW_POLICY_CHANGED")
                self.raw_revisions.update(raw_revisions)
            self._payload(stored, payload)
            self.revisions.update(pending)
        except (sqlite3.Error, ValueError, KeyError, TypeError, HTTPException) as error:
            raise ModelPolicyDenied("MODEL_RESEARCH_POLICY_UNAVAILABLE") from error
        finally:
            con.close()

    @staticmethod
    def _payload(run, payload):
        if "coverage" in payload:
            expected = plan_payload(run)
        else:
            if run.plan is None or not isinstance(payload.get("sources"), list):
                raise ModelPolicyDenied("MODEL_RESEARCH_PAYLOAD_MISMATCH")
            ids = [s["id"] for s in payload["sources"]]
            sources = {s.id: s for s in run.sources}
            if len(ids) > 8 or len(set(ids)) != len(ids) or any(sid not in sources for sid in ids):
                raise ModelPolicyDenied("MODEL_RESEARCH_PAYLOAD_MISMATCH")
            ordered = [sources[sid] for sid in ids]
            context, _, _ = citation_context(ordered)
            expected = {
                "asset": run.request.asset, "nct": run.request.nct_id,
                "indication": run.request.indication, "sources": context,
                "selection": selection_record(ordered, run.request),
                "missing_evidence": run.plan.missing_evidence,
            }
        if payload != expected:
            raise ModelPolicyDenied("MODEL_RESEARCH_PAYLOAD_MISMATCH")


class LazyResearchProvider:
    """No provider construction until rights are checked for the actual outgoing payload."""

    mode = "DACON_RESPONSES"
    model = "POLICY_PENDING"

    def __init__(self, factory, gate):
        self.factory, self.gate, self.provider = factory, gate, None
        self.actual_calls, self.last_usage = 0, None

    @property
    def pending_policy(self):
        return self.provider is None

    async def complete(self, *, instructions, payload, schema, max_output_tokens):
        self.last_usage = None
        try:
            self.gate.check(payload)
            if self.provider is None:
                provider = self.factory()
                if provider.mode not in ("DACON_RESPONSES", "SCRIPTED_TEST_DOUBLE"):
                    raise ModelPolicyDenied("DACON_REQUIRED")
                self.provider = provider
                self.mode, self.model = provider.mode, provider.model
            self.gate.check(payload)
        except ModelPolicyDenied as error:
            raise ModelError(str(error)) from None
        self.actual_calls += 1
        reply = await self.provider.complete(
            instructions=instructions, payload=payload, schema=schema,
            max_output_tokens=max_output_tokens,
        )
        self.last_usage = {
            "response_id": reply.response_id, "input_tokens": reply.input_tokens,
            "output_tokens": reply.output_tokens,
        }
        try:
            self.gate.check(payload)  # Revocation while awaiting a response blocks its publication.
        except ModelPolicyDenied as error:
            raise ModelError(str(error)) from None
        return reply
