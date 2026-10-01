"""Explicit local checkpoints. Internal consistency is not clinical approval/authorship."""

import base64
import binascii
import hashlib
import json
import secrets
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from trialboard.agent.field_review_contract import PdfSource, ReviewPacket
from trialboard.agent.revalidate import read_json
from trialboard.api.boundary import DEV_ORIGINS
from trialboard.api.scout import EvidenceStore
from trialboard.api.team_auth import TeamDataPath, current_access_scope

PROJECT_BODY_BYTES = 48 * 1024 * 1024
BUNDLE_BYTES = 32 * 1024 * 1024
CONTEXT_DETACH_TRANSFORMATION = "legacy-context-detach/1"
POLICY_VERIFICATION = "USER_ATTESTED_UNVERIFIED"


def restricted_project_digest(path: Path | TeamDataPath, digest: str) -> bool:
    """Read-only guard for known TEAM project bytes; not a generic upload DLP."""
    if current_access_scope() is None or not isinstance(path, TeamDataPath):
        return False
    database = path.lookup()
    if database is None or not database.exists():
        return False
    con = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=5)
    try:
        tables = {
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
                "('project_checkpoints','project_access_policies')"
            )
        }
        if tables != {"project_checkpoints", "project_access_policies"}:
            return False
        return con.execute(
            """SELECT 1 FROM project_checkpoints c JOIN project_access_policies p
            ON p.project_id=c.project_id
            WHERE c.pdf_digest=? AND p.sharing_scope='restricted' LIMIT 1""",
            (digest,),
        ).fetchone() is not None
    finally:
        con.close()


class CheckpointInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    consent: Literal[True]
    project_id: str | None = Field(default=None, max_length=36)
    expected_revision: int = Field(ge=0, le=100)
    title: str = Field(min_length=1, max_length=120)
    pdf_base64: str = Field(max_length=7 * 1024 * 1024)
    bundle_json: str = Field(max_length=BUNDLE_BYTES)
    public_authorized_non_sensitive: Literal[True] | None = None
    sharing_scope: Literal["team_wide", "restricted"] | None = None
    access_members: list["ProjectAccessMember"] = Field(default_factory=list, max_length=100)
    source_project_id: str | None = Field(default=None, min_length=36, max_length=36)
    source_project_revision: int | None = Field(default=None, ge=1, le=100)
    usage_policy: "UsagePolicyAssertion | None" = None

    @field_validator("consent", mode="before")
    @classmethod
    def require_explicit_consent(cls, value):
        if value is not True:
            raise ValueError("EXPLICIT_TRUE_REQUIRED")
        return value

    @field_validator("public_authorized_non_sensitive", mode="before")
    @classmethod
    def require_explicit_public_authorization(cls, value):
        if value is not None and value is not True:
            raise ValueError("EXPLICIT_TRUE_REQUIRED")
        return value

    @field_validator("project_id", "source_project_id")
    @classmethod
    def canonical_project_id(cls, value: str | None) -> str | None:
        return str(UUID(value)) if value is not None else None


class ProjectAccessMember(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    subject_id: str = Field(min_length=36, max_length=36)
    access: Literal["owner", "write", "read"]

    @field_validator("subject_id")
    @classmethod
    def canonical_subject_id(cls, value: str) -> str:
        return str(UUID(value))


class ProjectAccessUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_acl_revision: int = Field(ge=0, le=10_000)
    sharing_scope: Literal["team_wide", "restricted"]
    members: list[ProjectAccessMember] = Field(default_factory=list, max_length=100)


class UsagePolicyAssertion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    original_storage: Literal["ALLOW", "DENY", "UNKNOWN"]
    internal_search: Literal["ALLOW", "DENY", "UNKNOWN"]
    external_ai: Literal["ALLOW", "DENY", "UNKNOWN"]
    training: Literal["ALLOW", "DENY", "UNKNOWN"]
    evidence_reference: str = Field(min_length=1, max_length=2000)
    reason: str = Field(min_length=1, max_length=4000)

    @field_validator("evidence_reference", "reason")
    @classmethod
    def strip_policy_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("USAGE_POLICY_EVIDENCE_REQUIRED")
        return value


class UsagePolicyUpdate(UsagePolicyAssertion):
    expected_policy_revision: int = Field(ge=0, le=10_000)
    pdf_digest: str = Field(pattern=r"^[a-f\d]{64}$")


CheckpointInput.model_rebuild()


class ImportInput(CheckpointInput):
    confirmation: Literal[True] | None = None
    context_detachment_acknowledged: Literal[True] | None = None
    import_preview_digest: str | None = Field(default=None, pattern=r"^[a-f\d]{64}$")

    @field_validator("confirmation", "context_detachment_acknowledged", mode="before")
    @classmethod
    def require_explicit_import_confirmation(cls, value):
        if value is not None and value is not True:
            raise ValueError("EXPLICIT_TRUE_REQUIRED")
        return value


class SourceVersionInput(CheckpointInput):
    confirmation: Literal[True]
    predecessor_project_id: str = Field(min_length=36, max_length=36)
    predecessor_review_revision: int = Field(ge=1, le=100)
    expected_series_head_revision: int = Field(ge=0, le=2_147_483_647)

    @field_validator("confirmation", mode="before")
    @classmethod
    def require_explicit_source_confirmation(cls, value):
        if value is not True:
            raise ValueError("EXPLICIT_TRUE_REQUIRED")
        return value

    @field_validator("predecessor_project_id")
    @classmethod
    def canonical_predecessor_id(cls, value: str) -> str:
        return str(UUID(value))


class ReviewEventInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_revision: int = Field(ge=0, le=10_000)
    kind: Literal["note", "review_approval"]
    text: str = Field(min_length=1, max_length=4000)
    base_document_revision: int = Field(ge=1, le=100)

    @field_validator("text")
    @classmethod
    def reject_whitespace_only(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("EMPTY_REVIEW_TEXT")
        return value


def validate_bundle(raw: str, pdf: bytes):
    bundle = read_json(raw.encode(), limit=BUNDLE_BYTES)
    keys = {
        "schema",
        "source",
        "notes",
        "reviewRaw",
        "draftRaw",
        "meetingRaw",
        "agentRaw",
        "context",
    }
    if (
        not isinstance(bundle, dict)
        or set(bundle) != keys
        or bundle["schema"] != "trialboard-project/1"
    ):
        raise ValueError("INVALID_BUNDLE")
    source = PdfSource.model_validate(bundle["source"])
    if (
        not pdf.startswith(b"%PDF-")
        or len(pdf) != source.byteLength
        or hashlib.sha256(pdf).hexdigest() != source.sha256
    ):
        raise ValueError("PDF_MISMATCH")
    review = ReviewPacket.model_validate(read_json(bundle["reviewRaw"].encode(), limit=2_000_000))
    if review.sourceDigest != source.sha256:
        raise ValueError("REVIEW_MISMATCH")
    draft = read_json(bundle["draftRaw"].encode(), limit=100_000)
    if (
        draft.get("schema_version") != "design-draft/1"
        or draft.get("source_digest") != source.sha256
    ):
        raise ValueError("DRAFT_MISMATCH")
    # Domain-level restore checks are also performed against freshly extracted PDF in the browser.
    if bundle["meetingRaw"] is not None:
        packet = read_json(bundle["meetingRaw"].encode(), limit=24 * 1024 * 1024)
        if (
            packet.get("schema_version") != "trialboard-meeting-packet/1"
            or packet.get("clinical_approval") is not False
        ):
            raise ValueError("INVALID_PACKET")
    if bundle["agentRaw"] is not None:
        read_json(bundle["agentRaw"].encode(), limit=2_000_000)
        if hashlib.sha256(bundle["agentRaw"].encode()).hexdigest() != review.origin.reportDigest:
            raise ValueError("AGENT_MISMATCH")
    if not isinstance(bundle["notes"], list) or len(bundle["notes"]) > 100:
        raise ValueError("INVALID_NOTES")
    context = bundle["context"]
    if context is not None:
        required = {"asset", "indication", "study", "question", "receiptId"}
        if (
            not isinstance(context, dict)
            or not required <= set(context)
            or set(context) - required - {"document"}
        ):
            raise ValueError("INVALID_CONTEXT")
        if any(
            not isinstance(context[k], str) or not 0 < len(context[k]) <= 2000 for k in required
        ):
            raise ValueError("INVALID_CONTEXT")
        if "document" in context:
            doc = context["document"]
            if (
                not isinstance(doc, dict)
                or set(doc) != {"runId", "sourceId", "title"}
                or any(not isinstance(v, str) or not 0 < len(v) <= 2000 for v in doc.values())
            ):
                raise ValueError("INVALID_CONTEXT")
    return source


class ProjectStore(EvidenceStore):
    def __init__(
        self,
        path: Path | TeamDataPath,
        *,
        collaboration: bool = False,
        member_resolver: Callable[[object], list[dict]] | None = None,
    ):
        super().__init__(path)
        self.collaboration = collaboration
        self.member_resolver = member_resolver

    def connect(self):
        con = super().connect()
        con.execute(
            "CREATE TABLE IF NOT EXISTS project_pdfs "
            "(digest TEXT PRIMARY KEY, content BLOB NOT NULL)"
        )
        con.execute("""CREATE TABLE IF NOT EXISTS project_checkpoints (
            project_id TEXT NOT NULL, revision INTEGER NOT NULL, title TEXT NOT NULL,
            created_at TEXT NOT NULL, pdf_digest TEXT NOT NULL REFERENCES project_pdfs(digest),
            bundle_digest TEXT NOT NULL, bundle_json TEXT NOT NULL,
            PRIMARY KEY(project_id, revision))""")
        if not self.collaboration:
            return con
        con.execute("""CREATE TABLE IF NOT EXISTS team_project_registry (
            project_id TEXT PRIMARY KEY, created_by TEXT NOT NULL,
            created_by_username TEXT NOT NULL,
            original_filename TEXT NOT NULL, provenance TEXT NOT NULL,
            public_authorized_attested INTEGER NOT NULL,
            sharing_scope TEXT NOT NULL CHECK(sharing_scope='team_wide'))""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_review_events (
            project_id TEXT NOT NULL, event_revision INTEGER NOT NULL,
            document_revision INTEGER NOT NULL, kind TEXT NOT NULL,
            text TEXT NOT NULL, subject_id TEXT NOT NULL, username TEXT NOT NULL,
            role TEXT NOT NULL, created_at TEXT NOT NULL,
            clinical_approval INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(project_id,event_revision),
            CHECK(kind IN ('note','review_approval')), CHECK(clinical_approval=0))""")
        con.execute("""CREATE TABLE IF NOT EXISTS team_project_attestations (
            project_id TEXT NOT NULL, document_revision INTEGER NOT NULL,
            pdf_digest TEXT NOT NULL, bundle_digest TEXT NOT NULL,
            subject_id TEXT NOT NULL, username TEXT NOT NULL, attested_at TEXT NOT NULL,
            statement TEXT NOT NULL,
            PRIMARY KEY(project_id,document_revision),
            FOREIGN KEY(project_id) REFERENCES team_project_registry(project_id))""")
        con.execute("""CREATE TABLE IF NOT EXISTS team_import_registry (
            pdf_digest TEXT NOT NULL, bundle_digest TEXT NOT NULL, project_id TEXT NOT NULL UNIQUE,
            PRIMARY KEY(pdf_digest,bundle_digest),
            FOREIGN KEY(project_id) REFERENCES team_project_registry(project_id))""")
        con.execute("""CREATE TABLE IF NOT EXISTS team_import_provenance (
            project_id TEXT PRIMARY KEY, original_pdf_digest TEXT NOT NULL,
            original_bundle_digest TEXT NOT NULL, working_bundle_digest TEXT NOT NULL,
            original_bundle_json TEXT NOT NULL, original_context_json TEXT NOT NULL,
            imported_by_subject TEXT NOT NULL, imported_by_username TEXT NOT NULL,
            imported_at TEXT NOT NULL, transformation_version TEXT NOT NULL,
            detachment_statement TEXT NOT NULL, context_detached INTEGER NOT NULL,
            history_authentication TEXT NOT NULL,
            UNIQUE(original_pdf_digest,original_bundle_digest),
            UNIQUE(original_pdf_digest,working_bundle_digest),
            FOREIGN KEY(project_id) REFERENCES team_project_registry(project_id),
            CHECK(context_detached=1),
            CHECK(history_authentication='imported_non_authenticated_history'))""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_access_policies (
            project_id TEXT PRIMARY KEY, sharing_scope TEXT NOT NULL,
            acl_revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
            CHECK(sharing_scope IN ('team_wide','restricted')),
            FOREIGN KEY(project_id) REFERENCES team_project_registry(project_id))""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_access_members (
            project_id TEXT NOT NULL, subject_id TEXT NOT NULL, username TEXT NOT NULL,
            access TEXT NOT NULL, PRIMARY KEY(project_id,subject_id),
            CHECK(access IN ('owner','write','read')),
            FOREIGN KEY(project_id) REFERENCES team_project_registry(project_id))""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_access_audit (
            project_id TEXT NOT NULL, acl_revision INTEGER NOT NULL,
            subject_id TEXT NOT NULL, username TEXT NOT NULL, role TEXT NOT NULL,
            changed_at TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
            PRIMARY KEY(project_id,acl_revision))""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_derivations (
            project_id TEXT PRIMARY KEY, source_project_id TEXT NOT NULL,
            source_revision INTEGER NOT NULL, source_pdf_digest TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES team_project_registry(project_id),
            FOREIGN KEY(source_project_id) REFERENCES team_project_registry(project_id))""")
        con.execute("""CREATE TABLE IF NOT EXISTS document_source_series (
            series_id TEXT PRIMARY KEY, head_project_id TEXT NOT NULL UNIQUE,
            head_revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(head_project_id) REFERENCES team_project_registry(project_id))""")
        con.execute("""CREATE TABLE IF NOT EXISTS document_source_versions (
            project_id TEXT PRIMARY KEY, series_id TEXT NOT NULL, version_id TEXT NOT NULL UNIQUE,
            predecessor_project_id TEXT, predecessor_review_revision INTEGER,
            pdf_digest TEXT NOT NULL, original_filename TEXT NOT NULL,
            author_subject_id TEXT NOT NULL, author_username TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES team_project_registry(project_id),
            FOREIGN KEY(series_id) REFERENCES document_source_series(series_id),
            FOREIGN KEY(predecessor_project_id) REFERENCES team_project_registry(project_id),
            CHECK((predecessor_project_id IS NULL) = (predecessor_review_revision IS NULL)))""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_usage_policy_versions (
            project_id TEXT NOT NULL, policy_revision INTEGER NOT NULL, pdf_digest TEXT NOT NULL,
            original_storage TEXT NOT NULL, internal_search TEXT NOT NULL,
            external_ai TEXT NOT NULL, training TEXT NOT NULL,
            evidence_reference TEXT NOT NULL, reason TEXT NOT NULL,
            author_subject_id TEXT NOT NULL, author_username TEXT NOT NULL,
            author_role TEXT NOT NULL, asserted_at TEXT NOT NULL,
            verification_status TEXT NOT NULL,
            PRIMARY KEY(project_id,policy_revision),
            FOREIGN KEY(project_id) REFERENCES team_project_registry(project_id),
            CHECK(original_storage IN ('ALLOW','DENY','UNKNOWN')),
            CHECK(internal_search IN ('ALLOW','DENY','UNKNOWN')),
            CHECK(external_ai IN ('ALLOW','DENY','UNKNOWN')),
            CHECK(training IN ('ALLOW','DENY','UNKNOWN')),
            CHECK(verification_status='USER_ATTESTED_UNVERIFIED'))""")
        con.execute("""CREATE TABLE IF NOT EXISTS project_usage_policy_heads (
            project_id TEXT PRIMARY KEY, policy_revision INTEGER NOT NULL,
            pdf_digest TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id,policy_revision)
            REFERENCES project_usage_policy_versions(project_id,policy_revision))""")
        con.execute("""CREATE UNIQUE INDEX IF NOT EXISTS document_source_version_digest
            ON document_source_versions(series_id,pdf_digest)""")
        con.execute("""CREATE TRIGGER IF NOT EXISTS document_source_versions_no_update
            BEFORE UPDATE ON document_source_versions
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOURCE_VERSION'); END""")
        con.execute("""CREATE TRIGGER IF NOT EXISTS document_source_versions_no_delete
            BEFORE DELETE ON document_source_versions
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOURCE_VERSION'); END""")
        con.execute("""CREATE TRIGGER IF NOT EXISTS project_access_audit_no_update
            BEFORE UPDATE ON project_access_audit
            BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT'); END""")
        con.execute("""CREATE TRIGGER IF NOT EXISTS project_access_audit_no_delete
            BEFORE DELETE ON project_access_audit
            BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT'); END""")
        con.execute("""CREATE TRIGGER IF NOT EXISTS team_import_provenance_no_update
            BEFORE UPDATE ON team_import_provenance
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_IMPORT_PROVENANCE'); END""")
        con.execute("""CREATE TRIGGER IF NOT EXISTS team_import_provenance_no_delete
            BEFORE DELETE ON team_import_provenance
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_IMPORT_PROVENANCE'); END""")
        con.execute("""CREATE TRIGGER IF NOT EXISTS project_usage_policy_versions_no_update
            BEFORE UPDATE ON project_usage_policy_versions
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_USAGE_POLICY'); END""")
        con.execute("""CREATE TRIGGER IF NOT EXISTS project_usage_policy_versions_no_delete
            BEFORE DELETE ON project_usage_policy_versions
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_USAGE_POLICY'); END""")
        return con

    @staticmethod
    def _scope():
        return current_access_scope()

    @staticmethod
    def _registered(con, pid: str) -> bool:
        return con.execute(
            "SELECT 1 FROM team_project_registry WHERE project_id=?", (pid,)
        ).fetchone() is not None

    @staticmethod
    def _policy(con, pid: str):
        return con.execute(
            """SELECT COALESCE(p.sharing_scope,r.sharing_scope),COALESCE(p.acl_revision,0),
            r.created_by,r.created_by_username FROM team_project_registry r
            LEFT JOIN project_access_policies p ON p.project_id=r.project_id
            WHERE r.project_id=?""",
            (pid,),
        ).fetchone()

    @classmethod
    def _access(cls, con, pid: str, *, write: bool = False, manage: bool = False):
        actor = cls._scope()
        policy = cls._policy(con, pid)
        if actor is None:
            return policy
        if policy is None:
            return None
        sharing_scope, acl_revision, creator_id, _ = policy
        if actor.role == "admin":
            return (*policy, "team_admin_override")
        member = con.execute(
            "SELECT access FROM project_access_members WHERE project_id=? AND subject_id=?",
            (pid, actor.subject_id),
        ).fetchone()
        # Only legacy rows without an explicit ACL retain creator management. Once a
        # policy exists, membership is authoritative: removing the creator must not
        # silently resurrect ownership on a restricted project.
        member_access = member[0] if member else (
            "owner"
            if creator_id == actor.subject_id
            and (acl_revision == 0 or sharing_scope == "team_wide")
            else None
        )
        if manage:
            return (
                (*policy, "project_owner")
                if actor.role != "viewer" and member_access == "owner"
                else None
            )
        if sharing_scope == "team_wide":
            if write and actor.role == "viewer":
                return None
            return (*policy, "team_wide")
        if member_access is None:
            return None
        if write and (actor.role == "viewer" or member_access == "read"):
            return None
        return (*policy, member_access)

    def _active_members(self) -> dict[str, dict]:
        actor = self._scope()
        if actor is None or self.member_resolver is None:
            raise ValueError("TEAM_MEMBER_DIRECTORY_REQUIRED")
        return {member["id"]: member for member in self.member_resolver(actor)}

    def _validated_members(self, members: list[ProjectAccessMember]) -> list[dict]:
        directory = self._active_members()
        seen: set[str] = set()
        result = []
        for member in members:
            if member.subject_id in seen or member.subject_id not in directory:
                raise ValueError("INVALID_PROJECT_MEMBER")
            seen.add(member.subject_id)
            result.append({**directory[member.subject_id], "access": member.access})
        if any(
            member["access"] == "owner" and member["role"] not in {"admin", "reviewer"}
            for member in result
        ):
            raise ValueError("INVALID_PROJECT_OWNER")
        return result

    def _validate_new_project_source(self, con, body: CheckpointInput, source: PdfSource):
        source_id, source_revision = body.source_project_id, body.source_project_revision
        if (source_id is None) != (source_revision is None):
            raise ValueError("SOURCE_PROJECT_BINDING_REQUIRED")
        bound = None
        if source_id is not None:
            bound = con.execute(
                "SELECT pdf_digest FROM project_checkpoints WHERE project_id=? AND revision=?",
                (source_id, source_revision),
            ).fetchone()
            if bound is None or bound[0] != source.sha256 or self._access(con, source_id) is None:
                raise ValueError("PROJECT_NOT_FOUND")
        if body.sharing_scope != "team_wide":
            return (source_id, source_revision) if source_id is not None else None
        restricted_sources = con.execute(
            """SELECT DISTINCT c.project_id FROM project_checkpoints c
            JOIN project_access_policies p ON p.project_id=c.project_id
            WHERE c.pdf_digest=? AND p.sharing_scope='restricted'""",
            (source.sha256,),
        ).fetchall()
        for (restricted_id,) in restricted_sources:
            if self._access(con, restricted_id) is None:
                raise ValueError("PROJECT_NOT_FOUND")
            if self._access(con, restricted_id, manage=True) is None:
                raise ValueError("SOURCE_PROJECT_WIDEN_FORBIDDEN")
        return (source_id, source_revision) if source_id is not None else None

    @staticmethod
    def _acl_state(scope: str, revision: int, members: list[dict]) -> dict:
        return {
            "sharing_scope": scope,
            "acl_revision": revision,
            "members": [
                {"subject_id": m["id"], "username": m["username"], "access": m["access"]}
                for m in sorted(members, key=lambda row: row["id"])
            ],
        }

    def _create_policy(self, con, pid: str, body: CheckpointInput, access, stamp: str) -> None:
        if body.sharing_scope is None:
            raise ValueError("PROJECT_SHARING_SCOPE_REQUIRED")
        members = self._validated_members(body.access_members)
        if body.sharing_scope == "team_wide" and members:
            raise ValueError("TEAM_WIDE_MEMBERS_NOT_ALLOWED")
        if any(member["id"] == access.subject_id for member in members):
            raise ValueError("CREATOR_ACCESS_IS_IMPLICIT")
        owner = {"id": access.subject_id, "username": access.username, "access": "owner"}
        full_members = [owner, *members] if body.sharing_scope == "restricted" else []
        con.execute(
            "INSERT INTO project_access_policies VALUES (?,?,1,?)",
            (pid, body.sharing_scope, stamp),
        )
        for member in full_members:
            con.execute(
                "INSERT INTO project_access_members VALUES (?,?,?,?)",
                (pid, member["id"], member["username"], member["access"]),
            )
        after = self._acl_state(body.sharing_scope, 1, full_members)
        con.execute(
            "INSERT INTO project_access_audit VALUES (?,?,?,?,?,?,?,?)",
            (pid, 1, access.subject_id, access.username, access.role, stamp, "null",
             json.dumps(after, sort_keys=True)),
        )

    def _copy_policy(self, con, source_pid: str, target_pid: str, access, stamp: str) -> None:
        policy = self._policy(con, source_pid)
        if policy is None:
            raise ValueError("PROJECT_NOT_FOUND")
        scope, acl_revision = policy[:2]
        members = con.execute(
            "SELECT subject_id,username,access FROM project_access_members WHERE project_id=?",
            (source_pid,),
        ).fetchall()
        if scope == "restricted":
            directory = self._active_members()
            if any(
                subject_id not in directory
                or directory[subject_id]["username"] != username
                or (member_access == "owner" and directory[subject_id]["role"] == "viewer")
                for subject_id, username, member_access in members
            ):
                raise ValueError("SOURCE_VERSION_ACL_INACTIVE")
            if not any(member_access == "owner" for _, _, member_access in members):
                raise ValueError("SOURCE_VERSION_ACL_INACTIVE")
        elif members:
            raise ValueError("SOURCE_VERSION_ACL_INVALID")
        con.execute(
            "INSERT INTO project_access_policies VALUES (?,?,?,?)",
            (target_pid, scope, acl_revision, stamp),
        )
        con.executemany(
            "INSERT INTO project_access_members VALUES (?,?,?,?)",
            [(target_pid, subject_id, username, member_access)
             for subject_id, username, member_access in members],
        )
        state_members = [
            {"id": subject_id, "username": username, "access": member_access}
            for subject_id, username, member_access in members
        ]
        con.execute(
            "INSERT INTO project_access_audit VALUES (?,?,?,?,?,?,?,?)",
            (target_pid, acl_revision, access.subject_id, access.username, access.role, stamp,
             "null",
             json.dumps(self._acl_state(scope, acl_revision, state_members), sort_keys=True)),
        )

    def _source_metadata(self, con, pid: str):
        row = con.execute(
            """SELECT v.series_id,v.version_id,v.predecessor_project_id,
            v.predecessor_review_revision,s.head_project_id,s.head_revision
            FROM document_source_versions v JOIN document_source_series s
            ON s.series_id=v.series_id WHERE v.project_id=?""",
            (pid,),
        ).fetchone()
        if row is None:
            return {
                "version_id": None,
                "is_series_head": True,
                "series_head_revision": 0,
                "predecessor_project_id": None,
                "predecessor_review_revision": None,
            }
        if row[4] != pid and self._access(con, row[4]) is None:
            return None
        predecessor = row[2]
        if predecessor is not None and self._access(con, predecessor) is None:
            predecessor = None
        return {
            "version_id": row[1],
            "is_series_head": row[4] == pid,
            "series_head_revision": row[5],
            "predecessor_project_id": predecessor,
            "predecessor_review_revision": row[3] if predecessor is not None else None,
        }

    @staticmethod
    def _unknown_usage_policy(pid: str, pdf_digest: str, can_manage: bool) -> dict:
        return {
            "project_id": pid,
            "pdf_digest": pdf_digest,
            "policy_revision": 0,
            "original_storage": "UNKNOWN",
            "internal_search": "UNKNOWN",
            "external_ai": "UNKNOWN",
            "training": "UNKNOWN",
            "evidence_reference": None,
            "reason": "No asserted project usage policy is recorded.",
            "author": None,
            "asserted_at": None,
            "verification_status": POLICY_VERIFICATION,
            "can_manage": can_manage,
            "training_capability": "CAPABILITY_ABSENT",
        }

    @classmethod
    def _usage_policy(cls, con, pid: str, pdf_digest: str, *, can_manage=False) -> dict:
        tables = {
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
                "('project_usage_policy_versions','project_usage_policy_heads')"
            )
        }
        if tables != {"project_usage_policy_versions", "project_usage_policy_heads"}:
            return cls._unknown_usage_policy(pid, pdf_digest, can_manage)
        row = con.execute(
            """SELECT v.policy_revision,v.pdf_digest,v.original_storage,v.internal_search,
            v.external_ai,v.training,v.evidence_reference,v.reason,v.author_subject_id,
            v.author_username,v.author_role,v.asserted_at,v.verification_status
            FROM project_usage_policy_heads h JOIN project_usage_policy_versions v
            ON v.project_id=h.project_id AND v.policy_revision=h.policy_revision
            WHERE h.project_id=?""",
            (pid,),
        ).fetchone()
        if row is None:
            return cls._unknown_usage_policy(pid, pdf_digest, can_manage)
        return {
            "project_id": pid, "policy_revision": row[0], "pdf_digest": row[1],
            "original_storage": row[2], "internal_search": row[3],
            "external_ai": row[4], "training": row[5], "evidence_reference": row[6],
            "reason": row[7],
            "author": {"subject_id": row[8], "username": row[9], "role": row[10]},
            "asserted_at": row[11], "verification_status": row[12],
            "can_manage": can_manage, "training_capability": "CAPABILITY_ABSENT",
        }

    @staticmethod
    def _insert_usage_policy(
        con, pid: str, pdf_digest: str, assertion, access, stamp: str, revision: int = 1
    ) -> None:
        if assertion is None or assertion.original_storage != "ALLOW":
            raise ValueError("ORIGINAL_STORAGE_ALLOW_REQUIRED")
        con.execute(
            """INSERT INTO project_usage_policy_versions VALUES
            (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, revision, pdf_digest, assertion.original_storage,
             assertion.internal_search, assertion.external_ai, assertion.training,
             assertion.evidence_reference, assertion.reason, access.subject_id,
             access.username, access.role, stamp, POLICY_VERIFICATION),
        )
        con.execute(
            "INSERT INTO project_usage_policy_heads VALUES (?,?,?,?)",
            (pid, revision, pdf_digest, stamp),
        )

    @classmethod
    def _require_storage_allowed(cls, con, pid: str, pdf_digest: str) -> dict:
        policy = cls._usage_policy(con, pid, pdf_digest)
        if policy["pdf_digest"] != pdf_digest:
            raise ValueError("PROJECT_USAGE_POLICY_BINDING_MISMATCH")
        if policy["original_storage"] != "ALLOW":
            raise ValueError("PROJECT_ORIGINAL_STORAGE_BLOCKED")
        return policy

    @staticmethod
    def _require_clean_source_bundle(body: SourceVersionInput) -> None:
        bundle = read_json(body.bundle_json.encode(), limit=BUNDLE_BYTES)
        review = ReviewPacket.model_validate(
            read_json(bundle["reviewRaw"].encode(), limit=2_000_000)
        )
        if (
            bundle["notes"]
            or bundle["meetingRaw"] is not None
            or bundle["agentRaw"] is not None
            or bundle["context"] is not None
            or review.rows
            or review.modelFindings
            or review.origin.kind != "manual"
        ):
            raise ValueError("SOURCE_VERSION_REQUIRES_CLEAN_BUNDLE")

    def preview_import(self, body: ImportInput):
        if (
            body.project_id is not None
            or body.expected_revision != 0
            or body.source_project_id is not None
            or body.source_project_revision is not None
            or not body.title.strip()
        ):
            raise ValueError("IMPORT_MUST_CREATE_PROJECT")
        pdf, source, original_digest, _working_json, working_digest, context = (
            self._decode_and_prepare_import(body)
        )
        self._require_team_attestation(body)
        if body.usage_policy is None or body.usage_policy.original_storage != "ALLOW":
            raise ValueError("ORIGINAL_STORAGE_ALLOW_REQUIRED")
        access = self._scope()
        if access is None:
            raise ValueError("TEAM_CONTEXT_REQUIRED")
        if access.role == "viewer":
            raise ValueError("IMPORT_WRITE_FORBIDDEN")
        preview_digest = self._import_preview_digest(
            body, source.sha256, original_digest, working_digest, context is not None
        )
        if body.sharing_scope is None:
            raise ValueError("PROJECT_SHARING_SCOPE_REQUIRED")
        self._validated_members(body.access_members)
        path = self.path.lookup() if isinstance(self.path, TeamDataPath) else self.path
        duplicate = None
        if path is None or not path.exists():
            return self._import_preview(
                body, pdf, source, original_digest, working_digest, context,
                preview_digest, duplicate,
            )
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        try:
            tables = {
                row[0]
                for row in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
                    "('project_checkpoints','team_project_registry','project_access_policies',"
                    "'team_import_registry')"
                )
            }
            if {"project_checkpoints", "team_project_registry"} <= tables:
                duplicates = list(con.execute(
                    """SELECT c.project_id,c.revision FROM project_checkpoints c
                    JOIN team_project_registry r ON r.project_id=c.project_id
                    WHERE c.pdf_digest=? AND c.bundle_digest=?""",
                    (source.sha256, working_digest),
                ).fetchall())
                if "team_import_registry" in tables:
                    duplicates.extend(con.execute(
                        """SELECT r.project_id,1 FROM team_import_registry r
                        WHERE r.pdf_digest=? AND r.bundle_digest=?""",
                        (source.sha256, original_digest),
                    ).fetchall())
                duplicates = list(dict.fromkeys(duplicates))
                duplicate = next(
                    (
                        row
                        for row in duplicates
                        if "project_access_policies" not in tables
                        or self._access(con, row[0]) is not None
                    ),
                    None,
                )
                opaque_conflict = bool(duplicates) and duplicate is None
            else:
                opaque_conflict = False
        finally:
            con.close()
        return self._import_preview(
            body, pdf, source, original_digest, working_digest, context,
            preview_digest, duplicate, opaque_conflict,
        )

    @staticmethod
    def _import_preview(
        body, pdf, source, original_digest, working_digest, context, preview_digest,
        duplicate, opaque_conflict=False,
    ):
        result = {
            "valid": True,
            "writes_performed": False,
            "title": body.title.strip(),
            "original_filename": source.name,
            "pdf_digest": source.sha256,
            "bundle_digest": original_digest,
            "bytes": len(pdf),
            "destination": "current_team_new_project",
            "sharing_scope": body.sharing_scope,
            "duplicate": (
                {"project_id": duplicate[0], "revision": duplicate[1]} if duplicate else None
            ),
            "duplicate_conflict": opaque_conflict,
            "legacy_authorship_imported": False,
            "clinical_approval": False,
            "import_preview_digest": preview_digest,
        }
        if context is not None:
            result.update({
                "context_detached": True,
                "original_bundle_digest": original_digest,
                "working_bundle_digest": working_digest,
                "original_context": context,
                "transformation_version": CONTEXT_DETACH_TRANSFORMATION,
                "provenance_status": "UNVERIFIED",
                "current_team_links_verified": False,
                "model_run_performed": False,
            })
        return result

    @staticmethod
    def _require_team_attestation(body: CheckpointInput) -> None:
        if current_access_scope() is not None and body.public_authorized_non_sensitive is not True:
            raise ValueError("PUBLIC_AUTHORIZED_ATTESTATION_REQUIRED")

    def _decode_and_prepare_import(self, body: ImportInput):
        pdf, source, original_digest = self._decode_and_validate(body)
        bundle = read_json(body.bundle_json.encode(), limit=BUNDLE_BYTES)
        context = bundle["context"]
        if context is None:
            return pdf, source, original_digest, body.bundle_json, original_digest, None
        if body.context_detachment_acknowledged is not True:
            raise ValueError("LEGACY_CONTEXT_RELINK_REQUIRED")
        working = {**bundle, "context": None}
        working_json = json.dumps(
            working, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        try:
            validate_bundle(working_json, pdf)
        except (ValueError, TypeError, AttributeError, KeyError) as error:
            raise ValueError("LEGACY_CONTEXT_DETACH_UNSAFE") from error
        working_digest = hashlib.sha256(working_json.encode()).hexdigest()
        return pdf, source, original_digest, working_json, working_digest, context

    @staticmethod
    def _import_preview_digest(
        body: ImportInput, pdf_digest: str, original_digest: str,
        working_digest: str, detached: bool,
    ) -> str:
        intent = {
            "access_members": sorted(
                ({"subject_id": member.subject_id, "access": member.access}
                 for member in body.access_members),
                key=lambda member: (member["subject_id"], member["access"]),
            ),
            "context_detached": detached,
            "original_bundle_digest": original_digest,
            "pdf_digest": pdf_digest,
            "public_authorized_non_sensitive": body.public_authorized_non_sensitive is True,
            "sharing_scope": body.sharing_scope,
            "title": body.title.strip(),
            "transformation_version": CONTEXT_DETACH_TRANSFORMATION if detached else None,
            "working_bundle_digest": working_digest,
            "usage_policy": body.usage_policy.model_dump() if body.usage_policy else None,
        }
        return hashlib.sha256(
            json.dumps(intent, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def _decode_and_validate(self, body: CheckpointInput):
        try:
            pdf = base64.b64decode(body.pdf_base64, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("INVALID_PDF") from None
        source = validate_bundle(body.bundle_json, pdf)
        return pdf, source, hashlib.sha256(body.bundle_json.encode()).hexdigest()

    def _validate_context(self, body: CheckpointInput, source: PdfSource) -> None:
        context = read_json(body.bundle_json.encode(), limit=BUNDLE_BYTES)["context"]
        if context is None:
            return
        receipt = EvidenceStore(self.path).read(context["receiptId"])
        selected = (
            next((s for s in receipt["studies"] if s["nct_id"] == context["study"]), None)
            if receipt
            else None
        )
        if not selected or context["indication"] not in selected["conditions"]:
            raise ValueError("UNKNOWN_PROJECT_CONTEXT")
        if not context.get("document"):
            return
        from trialboard.research.store import ResearchStore

        document = context["document"]
        research = ResearchStore(self.path)
        run = research.get_run(document["runId"])
        if (
            not run
            or run.request.search_id != context["receiptId"]
            or run.request.nct_id != context["study"]
            or run.request.asset != context["asset"]
            or run.request.indication != context["indication"]
        ):
            raise ValueError("UNKNOWN_DOCUMENT_CONTEXT")
        # Receipt association is not an assertion that the document studies this trial.
        connection = research.connect()
        try:
            exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE name='public_pdf_receipts'"
            ).fetchone()
            cached = (
                connection.execute(
                    "SELECT digest FROM public_pdf_receipts "
                    "WHERE run_id=? AND source_id=? AND digest=?",
                    (document["runId"], document["sourceId"], source.sha256),
                ).fetchone()
                if exists
                else None
            )
        finally:
            connection.close()
        if not cached or cached[0] != source.sha256:
            raise ValueError("DOCUMENT_PDF_MISMATCH")

    def save(self, body: CheckpointInput):
        pdf, source, digest = self._decode_and_validate(body)
        self._validate_context(body, source)
        self._require_team_attestation(body)
        if not body.title.strip() or (body.project_id is None and body.expected_revision != 0):
            raise ValueError("INVALID_PROJECT")
        pid = str(UUID(body.project_id)) if body.project_id else str(uuid4())
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                previous = con.execute(
                    "SELECT revision, pdf_digest FROM project_checkpoints WHERE project_id=? "
                    "ORDER BY revision DESC LIMIT 1",
                    (pid,),
                ).fetchone()
                access = self._scope()
                if access is not None and previous and not self._registered(con, pid):
                    raise ValueError("UNREGISTERED_TEAM_PROJECT")
                if access is not None and previous and self._access(con, pid, write=True) is None:
                    raise ValueError("PROJECT_NOT_FOUND")
                if access is not None and previous and (
                    body.sharing_scope is not None or body.access_members
                ):
                    raise ValueError("PROJECT_ACL_UPDATE_SEPARATE")
                if access is not None and previous:
                    self._require_storage_allowed(con, pid, previous[1])
                if access is not None and not previous and (
                    body.usage_policy is None
                    or body.usage_policy.original_storage != "ALLOW"
                ):
                    raise ValueError("ORIGINAL_STORAGE_ALLOW_REQUIRED")
                source_binding = (
                    self._validate_new_project_source(con, body, source)
                    if access is not None and not previous
                    else None
                )
                context = read_json(body.bundle_json.encode(), limit=BUNDLE_BYTES)["context"]
                sharing_scope = (
                    self._policy(con, pid)[0]
                    if previous and access is not None
                    else body.sharing_scope
                )
                if access is not None and sharing_scope == "restricted" and context is not None:
                    raise ValueError("PRIVATE_PROJECT_DERIVED_ACTIONS_DISABLED")
                if (previous[0] if previous else 0) != body.expected_revision or (
                    body.project_id and not previous
                ):
                    raise ValueError("PROJECT_VERSION_CONFLICT")
                if previous and previous[1] != source.sha256:
                    raise ValueError("PROJECT_PDF_CHANGED")
                count = con.execute(
                    "SELECT COUNT(DISTINCT project_id), "
                    "COALESCE(SUM(length(CAST(bundle_json AS BLOB))),0) FROM project_checkpoints"
                ).fetchone()
                pdf_size = con.execute(
                    "SELECT COALESCE(SUM(length(content)),0) FROM project_pdfs"
                ).fetchone()[0]
                if (
                    body.expected_revision >= 100
                    or (not previous and count[0] >= 100)
                    or count[1] + pdf_size + len(pdf) + len(body.bundle_json.encode()) > 1024**3
                ):
                    raise ValueError("PROJECT_STORAGE_LIMIT")
                stamp = datetime.now(UTC).isoformat()
                con.execute("INSERT OR IGNORE INTO project_pdfs VALUES (?,?)", (source.sha256, pdf))
                con.execute(
                    "INSERT INTO project_checkpoints VALUES (?,?,?,?,?,?,?)",
                    (
                        pid,
                        body.expected_revision + 1,
                        body.title.strip(),
                        stamp,
                        source.sha256,
                        digest,
                        body.bundle_json,
                    ),
                )
                if access is not None and not previous:
                    con.execute(
                        "INSERT INTO team_project_registry VALUES (?,?,?,?,?,?,?)",
                        (
                            pid,
                            access.subject_id,
                            access.username,
                            source.name,
                            "user_attested_public_or_authorized_non_sensitive",
                            1,
                            "team_wide",
                        ),
                    )
                    self._create_policy(con, pid, body, access, stamp)
                    self._insert_usage_policy(
                        con, pid, source.sha256, body.usage_policy, access, stamp
                    )
                    if source_binding is not None:
                        con.execute(
                            "INSERT INTO project_derivations VALUES (?,?,?,?,?)",
                            (pid, source_binding[0], source_binding[1], source.sha256, stamp),
                        )
                if access is not None:
                    self._insert_attestation(
                        con,
                        pid,
                        body.expected_revision + 1,
                        source.sha256,
                        digest,
                        access,
                        stamp,
                    )
            source_metadata = self._source_metadata(con, pid) if access is not None else None
            return {
                "project_id": pid,
                "revision": body.expected_revision + 1,
                "title": body.title.strip(),
                "created_at": stamp,
                "pdf_digest": source.sha256,
                "bundle_digest": digest,
                **(
                    {
                        "original_filename": source.name,
                        "sharing_scope": self._policy(con, pid)[0],
                        "acl_revision": self._policy(con, pid)[1],
                        "access_source": (
                            "team_admin_override" if access.role == "admin" else "project_owner"
                        ),
                        "can_manage_access": self._access(con, pid, manage=True) is not None,
                        "usage_policy": self._usage_policy(
                            con, pid, source.sha256, can_manage=True
                        ),
                        "author": access.username,
                        **({"source_version": source_metadata} if source_metadata else {}),
                    }
                    if access is not None
                    else {}
                ),
            }
        finally:
            con.close()

    def save_source_version(self, body: SourceVersionInput):
        if (
            body.project_id is not None
            or body.expected_revision != 0
            or body.sharing_scope is not None
            or body.access_members
            or body.source_project_id is not None
            or body.source_project_revision is not None
            or not body.title.strip()
        ):
            raise ValueError("SOURCE_VERSION_MUST_CREATE_PROJECT")
        access = self._scope()
        if access is None:
            raise ValueError("TEAM_CONTEXT_REQUIRED")
        pdf, source, digest = self._decode_and_validate(body)
        self._require_clean_source_bundle(body)
        self._require_team_attestation(body)
        if body.usage_policy is None or body.usage_policy.original_storage != "ALLOW":
            raise ValueError("ORIGINAL_STORAGE_ALLOW_REQUIRED")
        pid, stamp = str(uuid4()), datetime.now(UTC).isoformat()
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                parent_id = body.predecessor_project_id
                if not self._registered(con, parent_id) or self._access(
                    con, parent_id, manage=True
                ) is None:
                    raise ValueError("PROJECT_NOT_FOUND")
                parent = con.execute(
                    """SELECT c.pdf_digest,r.original_filename,r.created_by,
                    r.created_by_username,c.created_at FROM project_checkpoints c
                    JOIN team_project_registry r ON r.project_id=c.project_id
                    WHERE c.project_id=? AND c.revision=?""",
                    (parent_id, body.predecessor_review_revision),
                ).fetchone()
                if parent is None:
                    raise ValueError("PROJECT_NOT_FOUND")

                version = con.execute(
                    "SELECT series_id FROM document_source_versions WHERE project_id=?",
                    (parent_id,),
                ).fetchone()
                if version is None:
                    if body.expected_series_head_revision != 0:
                        raise ValueError("SOURCE_SERIES_HEAD_CONFLICT")
                    series_id = str(uuid4())
                    con.execute(
                        "INSERT INTO document_source_series VALUES (?,?,0,?)",
                        (series_id, parent_id, stamp),
                    )
                    con.execute(
                        """INSERT INTO document_source_versions
                        VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (parent_id, series_id, str(uuid4()), None, None, parent[0], parent[1],
                         parent[2], parent[3], parent[4]),
                    )
                    head_revision = 0
                else:
                    series_id = version[0]
                    head = con.execute(
                        "SELECT head_project_id,head_revision FROM document_source_series "
                        "WHERE series_id=?",
                        (series_id,),
                    ).fetchone()
                    if (
                        head is None
                        or head[0] != parent_id
                        or head[1] != body.expected_series_head_revision
                    ):
                        raise ValueError("SOURCE_SERIES_HEAD_CONFLICT")
                    head_revision = head[1]
                if con.execute(
                    "SELECT 1 FROM document_source_versions WHERE series_id=? AND pdf_digest=?",
                    (series_id, source.sha256),
                ).fetchone():
                    raise ValueError("SOURCE_PDF_ALREADY_VERSIONED")

                count = con.execute(
                    "SELECT COUNT(DISTINCT project_id), "
                    "COALESCE(SUM(length(CAST(bundle_json AS BLOB))),0) FROM project_checkpoints"
                ).fetchone()
                pdf_size = con.execute(
                    "SELECT COALESCE(SUM(length(content)),0) FROM project_pdfs"
                ).fetchone()[0]
                if (
                    count[0] >= 100
                    or count[1] + pdf_size + len(pdf) + len(body.bundle_json.encode()) > 1024**3
                ):
                    raise ValueError("PROJECT_STORAGE_LIMIT")

                con.execute("INSERT OR IGNORE INTO project_pdfs VALUES (?,?)", (source.sha256, pdf))
                con.execute(
                    "INSERT INTO project_checkpoints VALUES (?,?,?,?,?,?,?)",
                    (pid, 1, body.title.strip(), stamp, source.sha256, digest, body.bundle_json),
                )
                con.execute(
                    "INSERT INTO team_project_registry VALUES (?,?,?,?,?,?,?)",
                    (pid, access.subject_id, access.username, source.name,
                     "user_attested_public_or_authorized_non_sensitive", 1, "team_wide"),
                )
                self._copy_policy(con, parent_id, pid, access, stamp)
                self._insert_usage_policy(
                    con, pid, source.sha256, body.usage_policy, access, stamp
                )
                self._insert_attestation(con, pid, 1, source.sha256, digest, access, stamp)
                con.execute(
                    """INSERT INTO document_source_versions
                    VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (pid, series_id, str(uuid4()), parent_id,
                     body.predecessor_review_revision, source.sha256, source.name,
                     access.subject_id, access.username, stamp),
                )
                next_head_revision = secrets.randbelow(2_147_483_647) + 1
                while next_head_revision == head_revision:
                    next_head_revision = secrets.randbelow(2_147_483_647) + 1
                updated = con.execute(
                    """UPDATE document_source_series SET head_project_id=?,head_revision=?,
                    updated_at=? WHERE series_id=? AND head_project_id=? AND head_revision=?""",
                    (pid, next_head_revision, stamp, series_id, parent_id, head_revision),
                )
                if updated.rowcount != 1:
                    raise ValueError("SOURCE_SERIES_HEAD_CONFLICT")
            policy = self._policy(con, pid)
            return {
                "project_id": pid,
                "revision": 1,
                "title": body.title.strip(),
                "created_at": stamp,
                "pdf_digest": source.sha256,
                "bundle_digest": digest,
                "original_filename": source.name,
                "sharing_scope": policy[0],
                "acl_revision": policy[1],
                "access_source": (
                    "team_admin_override" if access.role == "admin" else "project_owner"
                ),
                "can_manage_access": self._access(con, pid, manage=True) is not None,
                "usage_policy": self._usage_policy(
                    con, pid, source.sha256,
                    can_manage=self._access(con, pid, manage=True) is not None,
                ),
                "can_create_source_version": True,
                "author": access.username,
                "source_version": self._source_metadata(con, pid),
            }
        except sqlite3.IntegrityError as error:
            if "document_source_version_digest" in str(error):
                raise ValueError("SOURCE_PDF_ALREADY_VERSIONED") from error
            raise
        finally:
            con.close()

    @staticmethod
    def _insert_attestation(
        con, pid, document_revision, pdf_digest, bundle_digest, access, stamp
    ) -> None:
        con.execute(
            "INSERT INTO team_project_attestations VALUES (?,?,?,?,?,?,?,?)",
            (
                pid,
                document_revision,
                pdf_digest,
                bundle_digest,
                access.subject_id,
                access.username,
                stamp,
                "user_attested_public_or_authorized_non_sensitive",
            ),
        )

    def import_checkpoint(self, body: ImportInput):
        if (
            body.project_id is not None
            or body.expected_revision != 0
            or body.source_project_id is not None
            or body.source_project_revision is not None
        ):
            raise ValueError("IMPORT_MUST_CREATE_PROJECT")
        self._require_team_attestation(body)
        pdf, source, original_digest, working_json, working_digest, context = (
            self._decode_and_prepare_import(body)
        )
        if body.usage_policy is None or body.usage_policy.original_storage != "ALLOW":
            raise ValueError("ORIGINAL_STORAGE_ALLOW_REQUIRED")
        expected_preview = self._import_preview_digest(
            body, source.sha256, original_digest, working_digest, context is not None
        )
        if body.import_preview_digest != expected_preview:
            raise ValueError("IMPORT_PREVIEW_REQUIRED")
        if not body.title.strip():
            raise ValueError("INVALID_PROJECT")
        access = self._scope()
        if access is None:
            raise ValueError("TEAM_CONTEXT_REQUIRED")
        if access.role == "viewer":
            raise ValueError("IMPORT_WRITE_FORBIDDEN")
        pid, stamp = str(uuid4()), datetime.now(UTC).isoformat()
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                duplicate = con.execute(
                    """SELECT c.project_id FROM project_checkpoints c
                    JOIN team_project_registry r ON r.project_id=c.project_id
                    WHERE c.pdf_digest=? AND c.bundle_digest=? LIMIT 1""",
                    (source.sha256, working_digest),
                ).fetchone()
                if duplicate is None:
                    duplicate = con.execute(
                        """SELECT project_id FROM team_import_registry
                        WHERE pdf_digest=? AND bundle_digest=? LIMIT 1""",
                        (source.sha256, original_digest),
                    ).fetchone()
                if duplicate:
                    raise ValueError("IMPORT_DUPLICATE")
                count = con.execute(
                    "SELECT COUNT(DISTINCT project_id), "
                    "COALESCE(SUM(length(CAST(bundle_json AS BLOB))),0) FROM project_checkpoints"
                ).fetchone()
                pdf_size = con.execute(
                    "SELECT COALESCE(SUM(length(content)),0) FROM project_pdfs"
                ).fetchone()[0]
                provenance_size = con.execute(
                    "SELECT COALESCE(SUM(length(CAST(original_bundle_json AS BLOB))),0) "
                    "FROM team_import_provenance"
                ).fetchone()[0]
                if (
                    count[0] >= 100
                    or count[1] + pdf_size + provenance_size + len(pdf)
                    + len(working_json.encode())
                    + (len(body.bundle_json.encode()) if context is not None else 0) > 1024**3
                ):
                    raise ValueError("PROJECT_STORAGE_LIMIT")
                con.execute("INSERT OR IGNORE INTO project_pdfs VALUES (?,?)", (source.sha256, pdf))
                con.execute(
                    "INSERT INTO project_checkpoints VALUES (?,?,?,?,?,?,?)",
                    (pid, 1, body.title.strip(), stamp, source.sha256,
                     working_digest, working_json),
                )
                con.execute(
                    "INSERT INTO team_project_registry VALUES (?,?,?,?,?,?,?)",
                    (
                        pid,
                        access.subject_id,
                        access.username,
                        source.name,
                        "user_attested_public_or_authorized_non_sensitive",
                        1,
                        "team_wide",
                    ),
                )
                self._create_policy(con, pid, body, access, stamp)
                self._insert_usage_policy(
                    con, pid, source.sha256, body.usage_policy, access, stamp
                )
                con.execute(
                    "INSERT INTO team_import_registry VALUES (?,?,?)",
                    (source.sha256, original_digest, pid),
                )
                self._insert_attestation(
                    con, pid, 1, source.sha256, working_digest, access, stamp
                )
                if context is not None:
                    con.execute(
                        """INSERT INTO team_import_provenance
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            pid, source.sha256, original_digest, working_digest,
                            body.bundle_json, json.dumps(
                                context, ensure_ascii=False, sort_keys=True,
                                separators=(",", ":"),
                            ),
                            access.subject_id, access.username, stamp,
                            CONTEXT_DETACH_TRANSFORMATION,
                            "past_research_links_detached_and_original_history_preserved",
                            1, "imported_non_authenticated_history",
                        ),
                    )
            return {
                "project_id": pid,
                "revision": 1,
                "title": body.title.strip(),
                "created_at": stamp,
                "pdf_digest": source.sha256,
                "bundle_digest": working_digest,
                "original_filename": source.name,
                "sharing_scope": body.sharing_scope,
                "acl_revision": 1,
                "access_source": (
                    "team_admin_override" if access.role == "admin" else "project_owner"
                ),
                "can_manage_access": self._access(con, pid, manage=True) is not None,
                "usage_policy": self._usage_policy(
                    con, pid, source.sha256,
                    can_manage=self._access(con, pid, manage=True) is not None,
                ),
                "author": access.username,
            }
        except sqlite3.IntegrityError as error:
            if (
                "team_import_registry.pdf_digest" in str(error)
                or "team_import_provenance.original_pdf_digest" in str(error)
            ):
                raise ValueError("IMPORT_DUPLICATE") from error
            raise
        finally:
            con.close()

    def usage_policy(self, pid: str):
        if self._scope() is None or not isinstance(self.path, TeamDataPath):
            return None
        database = self.path.lookup()
        if database is None or not database.exists():
            return None
        con = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=5)
        try:
            tables = {
                row[0]
                for row in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
                    "('project_checkpoints','team_project_registry','project_access_policies',"
                    "'project_access_members','project_usage_policy_versions',"
                    "'project_usage_policy_heads')"
                )
            }
            if not {"project_checkpoints", "team_project_registry"} <= tables:
                return None
            if self._access(con, pid) is None:
                return None
            row = con.execute(
                "SELECT pdf_digest FROM project_checkpoints WHERE project_id=? "
                "ORDER BY revision DESC LIMIT 1", (pid,),
            ).fetchone()
            if row is None:
                return None
            can_manage = self._access(con, pid, manage=True) is not None
            current = self._usage_policy(con, pid, row[0], can_manage=can_manage)
            history = []
            if "project_usage_policy_versions" in tables:
                revisions = con.execute(
                    """SELECT policy_revision,pdf_digest,original_storage,internal_search,
                    external_ai,training,evidence_reference,reason,author_subject_id,
                    author_username,author_role,asserted_at,verification_status
                    FROM project_usage_policy_versions WHERE project_id=?
                    ORDER BY policy_revision DESC""", (pid,),
                ).fetchall()
                history = [
                    {
                        "project_id": pid, "policy_revision": value[0],
                        "pdf_digest": value[1], "original_storage": value[2],
                        "internal_search": value[3], "external_ai": value[4],
                        "training": value[5], "evidence_reference": value[6],
                        "reason": value[7],
                        "author": {"subject_id": value[8], "username": value[9],
                                   "role": value[10]},
                        "asserted_at": value[11], "verification_status": value[12],
                        "training_capability": "CAPABILITY_ABSENT",
                    }
                    for value in revisions
                ]
            return {"current": current, "history": history}
        finally:
            con.close()

    def update_usage_policy(self, pid: str, body: UsagePolicyUpdate):
        access = self._scope()
        if access is None:
            raise ValueError("TEAM_CONTEXT_REQUIRED")
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                if self._access(con, pid, manage=True) is None:
                    raise ValueError("PROJECT_NOT_FOUND")
                row = con.execute(
                    "SELECT pdf_digest FROM project_checkpoints WHERE project_id=? "
                    "ORDER BY revision DESC LIMIT 1", (pid,),
                ).fetchone()
                if row is None:
                    raise ValueError("PROJECT_NOT_FOUND")
                if row[0] != body.pdf_digest:
                    raise ValueError("PROJECT_USAGE_POLICY_BINDING_MISMATCH")
                head = con.execute(
                    "SELECT policy_revision,pdf_digest FROM project_usage_policy_heads "
                    "WHERE project_id=?", (pid,),
                ).fetchone()
                current_revision = head[0] if head else 0
                if current_revision != body.expected_policy_revision:
                    raise ValueError("PROJECT_USAGE_POLICY_VERSION_CONFLICT")
                if head is not None and head[1] != body.pdf_digest:
                    raise ValueError("PROJECT_USAGE_POLICY_BINDING_MISMATCH")
                next_revision = current_revision + 1
                stamp = datetime.now(UTC).isoformat()
                con.execute(
                    """INSERT INTO project_usage_policy_versions VALUES
                    (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (pid, next_revision, body.pdf_digest, body.original_storage,
                     body.internal_search, body.external_ai, body.training,
                     body.evidence_reference, body.reason, access.subject_id,
                     access.username, access.role, stamp, POLICY_VERIFICATION),
                )
                if head is None:
                    con.execute(
                        "INSERT INTO project_usage_policy_heads VALUES (?,?,?,?)",
                        (pid, next_revision, body.pdf_digest, stamp),
                    )
                else:
                    updated = con.execute(
                        """UPDATE project_usage_policy_heads SET policy_revision=?,updated_at=?
                        WHERE project_id=? AND policy_revision=? AND pdf_digest=?""",
                        (next_revision, stamp, pid, current_revision, body.pdf_digest),
                    )
                    if updated.rowcount != 1:
                        raise ValueError("PROJECT_USAGE_POLICY_VERSION_CONFLICT")
            return self.usage_policy(pid)
        finally:
            con.close()

    def history(self):
        con = self.connect()
        try:
            # Latest 100 checkpoints, not only latest projects: old versions remain recoverable.
            access = self._scope()
            if access is None:
                rows = con.execute(
                    "SELECT project_id,revision,title,created_at,pdf_digest,bundle_digest "
                    "FROM project_checkpoints ORDER BY created_at DESC LIMIT 100"
                ).fetchall()
            else:
                rows = con.execute(
                    """SELECT c.project_id,c.revision,c.title,c.created_at,c.pdf_digest,
                    c.bundle_digest,r.original_filename,COALESCE(p.sharing_scope,r.sharing_scope),
                    r.created_by_username,COALESCE(p.acl_revision,0)
                    FROM project_checkpoints c JOIN team_project_registry r
                    ON r.project_id=c.project_id LEFT JOIN project_access_policies p
                    ON p.project_id=c.project_id ORDER BY c.created_at DESC"""
                ).fetchall()
                rows = [row for row in rows if self._access(con, row[0]) is not None][:100]
            result = [
                dict(zip(
                    ("project_id", "revision", "title", "created_at", "pdf_digest",
                     "bundle_digest", "original_filename", "sharing_scope", "author",
                     "acl_revision")[:len(row)],
                    row,
                    strict=True,
                ))
                for row in rows
            ]
            if access is not None:
                for item in result:
                    metadata = self._source_metadata(con, item["project_id"])
                    if metadata is not None:
                        item["source_version"] = metadata
                    item["can_create_source_version"] = (
                        metadata is not None
                        and metadata["is_series_head"]
                        and self._access(con, item["project_id"], manage=True) is not None
                    )
                    item["usage_policy"] = self._usage_policy(
                        con, item["project_id"], item["pdf_digest"],
                        can_manage=self._access(
                            con, item["project_id"], manage=True
                        ) is not None,
                    )
            return result
        finally:
            con.close()

    def read(self, pid: str, revision: int):
        con = self.connect()
        try:
            project_access = self._access(con, pid) if self._scope() is not None else None
            if self._scope() is not None and project_access is None:
                return None
            if self._scope() is not None:
                binding = con.execute(
                    "SELECT pdf_digest FROM project_checkpoints WHERE project_id=? AND revision=?",
                    (pid, revision),
                ).fetchone()
                if binding is None:
                    return None
                usage_policy = self._require_storage_allowed(con, pid, binding[0])
            else:
                usage_policy = None
            row = con.execute(
                "SELECT c.title,c.created_at,c.pdf_digest,c.bundle_digest,c.bundle_json,p.content "
                "FROM project_checkpoints c JOIN project_pdfs p ON p.digest=c.pdf_digest "
                "WHERE project_id=? AND revision=?",
                (pid, revision),
            ).fetchone()
            if row is None:
                return None
            if (
                hashlib.sha256(row[4].encode()).hexdigest() != row[3]
                or hashlib.sha256(row[5]).hexdigest() != row[2]
            ):
                raise ValueError("PROJECT_INTEGRITY_ERROR")
            source_metadata = (
                self._source_metadata(con, pid) if self._scope() is not None else None
            )
            return {
                "project_id": pid,
                "revision": revision,
                "title": row[0],
                "created_at": row[1],
                "pdf_digest": row[2],
                "bundle_digest": row[3],
                "bundle_json": row[4],
                "pdf_base64": base64.b64encode(row[5]).decode(),
                **(
                    {
                        "sharing_scope": project_access[0],
                        "acl_revision": project_access[1],
                        "access_source": project_access[4],
                        "can_manage_access": self._access(con, pid, manage=True) is not None,
                        "usage_policy": usage_policy,
                        **({"source_version": source_metadata} if source_metadata else {}),
                    }
                    if self._scope() is not None
                    else {}
                ),
            }
        finally:
            con.close()

    def import_provenance(self, pid: str, revision: int):
        con = self.connect()
        try:
            if self._scope() is None or self._access(con, pid) is None or not con.execute(
                "SELECT 1 FROM project_checkpoints WHERE project_id=? AND revision=?",
                (pid, revision),
            ).fetchone():
                return None
            digest = con.execute(
                "SELECT pdf_digest FROM project_checkpoints WHERE project_id=? AND revision=?",
                (pid, revision),
            ).fetchone()[0]
            self._require_storage_allowed(con, pid, digest)
            row = con.execute(
                """SELECT original_pdf_digest,original_bundle_digest,working_bundle_digest,
                original_bundle_json,original_context_json,imported_by_subject,
                imported_by_username,imported_at,
                transformation_version,detachment_statement,history_authentication
                FROM team_import_provenance WHERE project_id=?""",
                (pid,),
            ).fetchone()
            if row is None:
                return {"project_id": pid, "revision": revision, "provenance": None}
            original_bundle = read_json(row[3].encode(), limit=BUNDLE_BYTES)
            original_context = read_json(row[4].encode(), limit=BUNDLE_BYTES)
            active = con.execute(
                "SELECT pdf_digest,bundle_digest FROM project_checkpoints "
                "WHERE project_id=? AND revision=1",
                (pid,),
            ).fetchone()
            if (
                hashlib.sha256(row[3].encode()).hexdigest() != row[1]
                or original_bundle.get("context") != original_context
                or active is None
                or active[0] != row[0]
                or active[1] != row[2]
            ):
                raise ValueError("PROJECT_INTEGRITY_ERROR")
            return {
                "project_id": pid,
                "revision": revision,
                "provenance": {
                    "schema": "trialboard-import-provenance/1",
                    "kind": "legacy_context_detached",
                    "original_pdf_digest": row[0],
                    "original_bundle_digest": row[1],
                    "working_bundle_digest": row[2],
                    "original_context": original_context,
                    "imported_by": {"subject_id": row[5], "username": row[6]},
                    "imported_at": row[7],
                    "transformation_version": row[8],
                    "detachment_statement": row[9],
                    "history_authentication": row[10],
                    "verification_status": "UNVERIFIED",
                    "current_team_links_verified": False,
                    "model_run_performed": False,
                    "nested_history": {
                        "review": "imported_non_authenticated_history",
                        "agent": "imported_non_authenticated_history",
                        "design": "imported_non_authenticated_history",
                        "meeting": "imported_non_authenticated_history",
                    },
                },
            }
        finally:
            con.close()

    def review_events(self, pid: str, revision: int):
        con = self.connect()
        try:
            if self._access(con, pid) is None or not con.execute(
                "SELECT 1 FROM project_checkpoints WHERE project_id=? AND revision=?",
                (pid, revision),
            ).fetchone():
                return None
            rows = con.execute(
                """SELECT event_revision,document_revision,kind,text,subject_id,username,role,
                created_at,clinical_approval FROM project_review_events
                WHERE project_id=? ORDER BY event_revision""",
                (pid,),
            ).fetchall()
            return [
                {
                    "event_revision": row[0], "base_document_revision": row[1], "kind": row[2],
                    "text": row[3], "subject": {"id": row[4], "username": row[5]},
                    "role": row[6], "created_at": row[7],
                    "clinical_approval": bool(row[8]),
                }
                for row in rows
            ]
        finally:
            con.close()

    def append_review_event(self, pid: str, revision: int, body: ReviewEventInput):
        access = self._scope()
        if access is None:
            raise ValueError("TEAM_CONTEXT_REQUIRED")
        if access.role not in {"admin", "reviewer"}:
            raise ValueError("REVIEW_WRITE_FORBIDDEN")
        if body.base_document_revision != revision:
            raise ValueError("DOCUMENT_REVISION_MISMATCH")
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                if not self._registered(con, pid) or not con.execute(
                    "SELECT 1 FROM project_checkpoints WHERE project_id=? AND revision=?",
                    (pid, revision),
                ).fetchone():
                    raise ValueError("PROJECT_NOT_FOUND")
                if self._access(con, pid, write=True) is None:
                    raise ValueError("PROJECT_NOT_FOUND")
                latest = con.execute(
                    "SELECT COALESCE(MAX(event_revision),0) FROM project_review_events "
                    "WHERE project_id=?",
                    (pid,),
                ).fetchone()[0]
                if latest != body.expected_revision:
                    raise ValueError("REVIEW_VERSION_CONFLICT")
                stamp = datetime.now(UTC).isoformat()
                con.execute(
                    "INSERT INTO project_review_events VALUES (?,?,?,?,?,?,?,?,?,0)",
                    (pid, latest + 1, revision, body.kind, body.text.strip(), access.subject_id,
                     access.username, access.role, stamp),
                )
            return {
                "event_revision": latest + 1, "base_document_revision": revision,
                "kind": body.kind, "text": body.text.strip(),
                "subject": {"id": access.subject_id, "username": access.username},
                "role": access.role, "created_at": stamp, "clinical_approval": False,
            }
        finally:
            con.close()

    def project_access(self, pid: str):
        con = self.connect()
        try:
            policy = self._access(con, pid, manage=True)
            if policy is None:
                return None
            members = con.execute(
                """SELECT subject_id,username,access FROM project_access_members
                WHERE project_id=? ORDER BY username COLLATE NOCASE,subject_id""",
                (pid,),
            ).fetchall()
            return {
                "project_id": pid,
                "sharing_scope": policy[0],
                "acl_revision": policy[1],
                "management_source": policy[4],
                "members": [
                    {"subject_id": row[0], "username": row[1], "access": row[2]}
                    for row in members
                ],
                "download_revoke_limitation": True,
            }
        finally:
            con.close()

    def update_access(self, pid: str, body: ProjectAccessUpdate):
        access = self._scope()
        if access is None:
            raise ValueError("TEAM_CONTEXT_REQUIRED")
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                policy = self._access(con, pid, manage=True)
                if policy is None:
                    raise ValueError("PROJECT_NOT_FOUND")
                members = self._validated_members(body.members)
                if body.sharing_scope == "team_wide" and members:
                    raise ValueError("TEAM_WIDE_MEMBERS_NOT_ALLOWED")
                if body.sharing_scope == "restricted" and not any(
                    member["access"] == "owner" for member in members
                ):
                    raise ValueError("LAST_PROJECT_OWNER_REQUIRED")
                if policy[1] != body.expected_acl_revision:
                    raise ValueError("PROJECT_ACL_VERSION_CONFLICT")
                existing = con.execute(
                    """SELECT subject_id id,username,access FROM project_access_members
                    WHERE project_id=?""",
                    (pid,),
                ).fetchall()
                before_members = [
                    {"id": row[0], "username": row[1], "access": row[2]} for row in existing
                ]
                next_revision = policy[1] + 1
                stamp = datetime.now(UTC).isoformat()
                con.execute(
                    """INSERT INTO project_access_policies VALUES (?,?,?,?)
                    ON CONFLICT(project_id) DO UPDATE SET sharing_scope=excluded.sharing_scope,
                    acl_revision=excluded.acl_revision,updated_at=excluded.updated_at""",
                    (pid, body.sharing_scope, next_revision, stamp),
                )
                con.execute("DELETE FROM project_access_members WHERE project_id=?", (pid,))
                for member in members if body.sharing_scope == "restricted" else []:
                    con.execute(
                        "INSERT INTO project_access_members VALUES (?,?,?,?)",
                        (pid, member["id"], member["username"], member["access"]),
                    )
                after_members = members if body.sharing_scope == "restricted" else []
                before = self._acl_state(policy[0], policy[1], before_members)
                after = self._acl_state(body.sharing_scope, next_revision, after_members)
                con.execute(
                    "INSERT INTO project_access_audit VALUES (?,?,?,?,?,?,?,?)",
                    (pid, next_revision, access.subject_id, access.username, access.role, stamp,
                     json.dumps(before, sort_keys=True), json.dumps(after, sort_keys=True)),
                )
            current = self.project_access(pid)
            if current is not None:
                return current
            return {
                "project_id": pid,
                "sharing_scope": body.sharing_scope,
                "acl_revision": next_revision,
                "access_revoked": self._access(con, pid) is None,
            }
        finally:
            con.close()


def project_router(
    path: Path | TeamDataPath,
    *,
    collaboration: bool = False,
    member_resolver: Callable[[object], list[dict]] | None = None,
):
    router = APIRouter(prefix="/api/projects")
    store = ProjectStore(
        path, collaboration=collaboration, member_resolver=member_resolver
    )

    def valid_origin(request: Request) -> bool:
        return request.headers.get("origin") in (
            *DEV_ORIGINS, str(request.base_url).rstrip("/"),
        )

    @router.get("")
    def history():
        return store.history()

    @router.get("/{project_id}/access")
    def project_access(project_id: UUID):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_ACCESS_ONLY")
        value = store.project_access(str(project_id))
        if value is None:
            raise HTTPException(404, "PROJECT_NOT_FOUND")
        return value

    @router.post("/{project_id}/access")
    def update_project_access(project_id: UUID, body: ProjectAccessUpdate):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_ACCESS_ONLY")
        try:
            return store.update_access(str(project_id), body)
        except ValueError as error:
            code = str(error)
            if code == "PROJECT_ACL_VERSION_CONFLICT":
                raise HTTPException(409, code) from None
            if code == "PROJECT_NOT_FOUND":
                raise HTTPException(404, code) from None
            raise HTTPException(422, code) from None

    @router.get("/{project_id}/usage-policy")
    def project_usage_policy(project_id: UUID):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_ACCESS_ONLY")
        value = store.usage_policy(str(project_id))
        if value is None:
            raise HTTPException(404, "PROJECT_NOT_FOUND")
        return value

    @router.post("/{project_id}/usage-policy")
    def update_project_usage_policy(project_id: UUID, body: UsagePolicyUpdate):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_ACCESS_ONLY")
        try:
            return store.update_usage_policy(str(project_id), body)
        except ValueError as error:
            code = str(error)
            if code == "PROJECT_USAGE_POLICY_VERSION_CONFLICT":
                raise HTTPException(409, code) from None
            if code == "PROJECT_NOT_FOUND":
                raise HTTPException(404, code) from None
            raise HTTPException(422, code) from None

    @router.get("/{project_id}/{revision}")
    def read(project_id: UUID, revision: int):
        try:
            saved = store.read(str(project_id), revision)
        except ValueError as error:
            if str(error) == "PROJECT_ORIGINAL_STORAGE_BLOCKED":
                raise HTTPException(403, str(error)) from None
            raise HTTPException(409, "PROJECT_INTEGRITY_ERROR") from None
        if saved is None:
            raise HTTPException(404, "PROJECT_NOT_FOUND")
        return saved

    @router.post("")
    def save(body: CheckpointInput, request: Request):
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        try:
            return store.save(body)
        except (ValueError, TypeError, AttributeError, KeyError) as error:
            code = str(error)
            if code in {"PROJECT_VERSION_CONFLICT", "PROJECT_STORAGE_LIMIT"}:
                raise HTTPException(409, code) from None
            if code == "PROJECT_NOT_FOUND":
                raise HTTPException(404, code) from None
            if code in {
                "PROJECT_SHARING_SCOPE_REQUIRED",
                "PRIVATE_PROJECT_DERIVED_ACTIONS_DISABLED",
                "SOURCE_PROJECT_BINDING_REQUIRED",
                "SOURCE_PROJECT_WIDEN_FORBIDDEN",
                "ORIGINAL_STORAGE_ALLOW_REQUIRED",
                "PROJECT_ORIGINAL_STORAGE_BLOCKED",
                "PROJECT_USAGE_POLICY_UPDATE_SEPARATE",
                "PROJECT_USAGE_POLICY_BINDING_MISMATCH",
            }:
                raise HTTPException(422, code) from None
            raise HTTPException(422, "INVALID_PROJECT_CHECKPOINT") from None

    @router.post("/source-versions")
    def save_source_version(body: SourceVersionInput, request: Request):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_SOURCE_VERSIONS_ONLY")
        if request.headers.get("origin") not in DEV_ORIGINS:
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        try:
            return store.save_source_version(body)
        except (ValueError, TypeError, AttributeError, KeyError) as error:
            code = str(error)
            if code in {
                "SOURCE_SERIES_HEAD_CONFLICT",
                "SOURCE_PDF_ALREADY_VERSIONED",
                "PROJECT_STORAGE_LIMIT",
            }:
                raise HTTPException(409, code) from None
            if code == "PROJECT_NOT_FOUND":
                raise HTTPException(404, code) from None
            if code in {
                "SOURCE_VERSION_MUST_CREATE_PROJECT",
                "SOURCE_VERSION_REQUIRES_CLEAN_BUNDLE",
                "SOURCE_VERSION_ACL_INACTIVE",
                "SOURCE_VERSION_ACL_INVALID",
                "PUBLIC_AUTHORIZED_ATTESTATION_REQUIRED",
                "ORIGINAL_STORAGE_ALLOW_REQUIRED",
            }:
                raise HTTPException(422, code) from None
            raise HTTPException(422, "INVALID_SOURCE_VERSION") from None

    @router.post("/import/preview")
    def preview_import(body: ImportInput, request: Request):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_IMPORT_ONLY")
        if not valid_origin(request):
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        try:
            return store.preview_import(body)
        except ValueError as error:
            if str(error) == "IMPORT_WRITE_FORBIDDEN":
                raise HTTPException(403, str(error)) from None
            if str(error) in {
                "LEGACY_CONTEXT_RELINK_REQUIRED",
                "LEGACY_CONTEXT_DETACH_UNSAFE",
                "PUBLIC_AUTHORIZED_ATTESTATION_REQUIRED",
                "PROJECT_SHARING_SCOPE_REQUIRED",
                "ORIGINAL_STORAGE_ALLOW_REQUIRED",
            }:
                raise HTTPException(422, str(error)) from None
            raise HTTPException(422, "INVALID_LEGACY_IMPORT") from None
        except (TypeError, AttributeError, KeyError):
            raise HTTPException(422, "INVALID_LEGACY_IMPORT") from None

    @router.post("/import/commit")
    def commit_import(body: ImportInput, request: Request):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_IMPORT_ONLY")
        if not valid_origin(request):
            raise HTTPException(403, "LOCAL_BROWSER_ORIGIN_REQUIRED")
        if body.confirmation is not True:
            raise HTTPException(422, "IMPORT_CONFIRMATION_REQUIRED")
        try:
            return store.import_checkpoint(body)
        except ValueError as error:
            if str(error) == "IMPORT_DUPLICATE":
                raise HTTPException(409, "IMPORT_DUPLICATE") from None
            if str(error) == "IMPORT_WRITE_FORBIDDEN":
                raise HTTPException(403, str(error)) from None
            if str(error) in {
                "LEGACY_CONTEXT_RELINK_REQUIRED",
                "LEGACY_CONTEXT_DETACH_UNSAFE",
                "CONTEXT_DETACH_PREVIEW_REQUIRED",
                "IMPORT_PREVIEW_REQUIRED",
                "PUBLIC_AUTHORIZED_ATTESTATION_REQUIRED",
                "PROJECT_SHARING_SCOPE_REQUIRED",
                "ORIGINAL_STORAGE_ALLOW_REQUIRED",
            }:
                raise HTTPException(422, str(error)) from None
            raise HTTPException(422, "INVALID_LEGACY_IMPORT") from None

    @router.get("/{project_id}/{revision}/provenance")
    def import_provenance(project_id: UUID, revision: int):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_IMPORT_ONLY")
        try:
            value = store.import_provenance(str(project_id), revision)
        except ValueError as error:
            if str(error) == "PROJECT_ORIGINAL_STORAGE_BLOCKED":
                raise HTTPException(403, str(error)) from None
            raise HTTPException(409, "PROJECT_INTEGRITY_ERROR") from None
        if value is None:
            raise HTTPException(404, "PROJECT_NOT_FOUND")
        return value

    @router.get("/{project_id}/{revision}/events")
    def review_events(project_id: UUID, revision: int):
        if current_access_scope() is None:
            raise HTTPException(404, "TEAM_REVIEW_ONLY")
        events = store.review_events(str(project_id), revision)
        if events is None:
            raise HTTPException(404, "PROJECT_NOT_FOUND")
        return {
            "project_id": str(project_id),
            "document_revision": revision,
            "events": events,
            "event_revision": events[-1]["event_revision"] if events else 0,
        }

    @router.post("/{project_id}/{revision}/events")
    def append_review_event(project_id: UUID, revision: int, body: ReviewEventInput):
        try:
            event = store.append_review_event(str(project_id), revision, body)
            return {"project_id": str(project_id), "document_revision": revision, **event}
        except ValueError as error:
            code = str(error)
            if code == "REVIEW_VERSION_CONFLICT":
                raise HTTPException(409, code) from None
            if code == "REVIEW_WRITE_FORBIDDEN":
                raise HTTPException(403, code) from None
            if code == "PROJECT_NOT_FOUND":
                raise HTTPException(404, code) from None
            raise HTTPException(422, code) from None

    return router
