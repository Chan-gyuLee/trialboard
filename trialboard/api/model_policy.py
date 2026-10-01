"""Project-bound TEAM authorization checked immediately before every model call."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from trialboard.agent.models import AgentInput
from trialboard.agent.provider import ModelError, Provider, Reply
from trialboard.api.team_auth import AccessScope, TeamDataPath, TeamIdentity


class ProjectModelBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    project_id: str = Field(min_length=36, max_length=36)
    review_revision: int = Field(ge=1, le=100)
    pdf_digest: str = Field(pattern=r"^[a-f\d]{64}$")
    policy_revision: int = Field(ge=1, le=10_000)

    @field_validator("project_id")
    @classmethod
    def canonical_project_id(cls, value: str) -> str:
        return str(UUID(value))


class ModelPolicyDenied(RuntimeError):
    pass


class ProjectModelGate:
    """A request-owned gate. It never refreshes sessions or keeps DB transactions open."""

    def __init__(
        self,
        *,
        identity: TeamIdentity,
        data_path: TeamDataPath,
        access: AccessScope,
        binding: ProjectModelBinding,
        purpose: Literal["pdf_agent", "design_proposal"],
        excerpts: Sequence[object] = (),
    ):
        self.identity = identity
        self.access = access
        self.binding = binding
        self.purpose = purpose
        self.excerpts = tuple(excerpts)
        self.database: Path | None = data_path.lookup()

    def check(self) -> None:
        fresh = self.identity.revalidate(self.access)
        if fresh is None or fresh.role == "viewer":
            raise ModelPolicyDenied("MODEL_IDENTITY_INVALIDATED")
        if self.database is None or not self.database.exists():
            raise ModelPolicyDenied("MODEL_PROJECT_NOT_FOUND")
        con = sqlite3.connect(f"file:{self.database}?mode=ro", uri=True, timeout=5)
        try:
            checkpoint = con.execute(
                """SELECT c.pdf_digest,c.bundle_json,p.sharing_scope,p.acl_revision,
                r.created_by FROM project_checkpoints c
                JOIN team_project_registry r ON r.project_id=c.project_id
                JOIN project_access_policies p ON p.project_id=c.project_id
                WHERE c.project_id=? AND c.revision=?""",
                (self.binding.project_id, self.binding.review_revision),
            ).fetchone()
            if checkpoint is None or checkpoint[0] != self.binding.pdf_digest:
                raise ModelPolicyDenied("MODEL_PROJECT_BINDING_MISMATCH")
            restricted = con.execute(
                """SELECT 1 FROM project_checkpoints c
                JOIN project_access_policies p ON p.project_id=c.project_id
                WHERE c.pdf_digest=? AND p.sharing_scope='restricted' LIMIT 1""",
                (self.binding.pdf_digest,),
            ).fetchone()
            if restricted is not None:
                raise ModelPolicyDenied("PRIVATE_PROJECT_DERIVED_ACTIONS_DISABLED")
            if checkpoint[2] == "restricted":
                member = con.execute(
                    """SELECT access FROM project_access_members
                    WHERE project_id=? AND subject_id=?""",
                    (self.binding.project_id, fresh.subject_id),
                ).fetchone()
                if fresh.role != "admin" and member is None:
                    raise ModelPolicyDenied("MODEL_PROJECT_ACCESS_REVOKED")
            policy = con.execute(
                """SELECT h.policy_revision,h.pdf_digest,v.external_ai
                FROM project_usage_policy_heads h JOIN project_usage_policy_versions v
                ON v.project_id=h.project_id AND v.policy_revision=h.policy_revision
                WHERE h.project_id=?""",
                (self.binding.project_id,),
            ).fetchone()
            if (
                policy is None
                or policy[0] != self.binding.policy_revision
                or policy[1] != self.binding.pdf_digest
                or policy[2] != "ALLOW"
            ):
                raise ModelPolicyDenied("MODEL_EXTERNAL_AI_NOT_ALLOWED")
            if self.purpose == "pdf_agent":
                self._validate_excerpts(checkpoint[1])
        except sqlite3.Error as error:
            raise ModelPolicyDenied("MODEL_POLICY_UNAVAILABLE") from error
        finally:
            con.close()

    def _validate_excerpts(self, bundle_raw: str) -> None:
        try:
            source = json.loads(bundle_raw)["source"]
            stored = {
                (span["id"], span["page"], span["text"])
                for page in source["pages"]
                for span in page["spans"]
            }
            source_digest = source["sha256"]
            submitted = {
                (span.id, span.page, span.text)
                for span in self.excerpts
                if getattr(span, "source_digest", None) == source_digest
            }
        except (KeyError, TypeError, ValueError):
            raise ModelPolicyDenied("MODEL_SOURCE_BINDING_INVALID") from None
        if len(submitted) != len(self.excerpts) or not submitted or not submitted <= stored:
            raise ModelPolicyDenied("MODEL_SOURCE_EXCERPTS_MISMATCH")


class GatedProvider:
    def __init__(self, provider: Provider, gate: ProjectModelGate):
        self._provider = provider
        self._gate = gate
        self.mode = provider.mode
        self.model = provider.model
        self.runtime = getattr(provider, "runtime", {})

    async def complete(
        self, *, instructions: str, payload: dict, schema: dict, max_output_tokens: int
    ) -> Reply:
        try:
            self._gate.check()
        except ModelPolicyDenied as error:
            raise ModelError(str(error)) from None
        return await self._provider.complete(
            instructions=instructions,
            payload=payload,
            schema=schema,
            max_output_tokens=max_output_tokens,
        )


class IdentityGatedProvider:
    """Fresh identity checks for the explicitly synthetic fixed demo."""

    def __init__(self, provider: Provider, identity: TeamIdentity, access: AccessScope):
        self._provider = provider
        self._identity = identity
        self._access = access
        self.mode = provider.mode
        self.model = provider.model
        self.runtime = getattr(provider, "runtime", {})

    async def complete(
        self, *, instructions: str, payload: dict, schema: dict, max_output_tokens: int
    ) -> Reply:
        fresh = self._identity.revalidate(self._access)
        if fresh is None or fresh.role == "viewer":
            raise ModelError("MODEL_IDENTITY_INVALIDATED")
        return await self._provider.complete(
            instructions=instructions,
            payload=payload,
            schema=schema,
            max_output_tokens=max_output_tokens,
        )


def team_model_gate(
    *,
    identity: TeamIdentity | None,
    data_path: Path | TeamDataPath,
    access: AccessScope | None,
    binding: ProjectModelBinding | None,
    purpose: Literal["pdf_agent", "design_proposal"],
    input_data: AgentInput | None = None,
) -> ProjectModelGate | None:
    if identity is None:
        return None
    if access is None or not isinstance(data_path, TeamDataPath) or binding is None:
        raise ModelPolicyDenied("MODEL_PROJECT_BINDING_REQUIRED")
    gate = ProjectModelGate(
        identity=identity,
        data_path=data_path,
        access=access,
        binding=binding,
        purpose=purpose,
        excerpts=input_data.spans if input_data is not None else (),
    )
    gate.check()
    return gate
