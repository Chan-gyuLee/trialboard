"""Opt-in local TEAM authentication and request-scoped storage isolation.

This is a loopback development boundary, not production SSO or a TLS perimeter.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import stat
import threading
import time
from contextvars import ContextVar
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse
from starlette.routing import Match
from starlette.types import ASGIApp, Receive, Scope, Send

from trialboard.api.boundary import DEV_ORIGINS

SESSION_COOKIE = "trialboard_session"
PRELOGIN_COOKIE = "trialboard_prelogin"
SESSION_CONTEXT_HEADER = b"x-trialboard-session-context"
SESSION_ABSOLUTE_SECONDS = 8 * 60 * 60
SESSION_IDLE_SECONDS = 30 * 60
PRELOGIN_SECONDS = 5 * 60
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 3
SCRYPT_DKLEN = 32
SCRYPT_MAXMEM = 64 * 1024 * 1024
MAX_USERNAME = 120
MAX_PASSWORD_BYTES = 1024


class AccessMode(StrEnum):
    LEGACY_LOOPBACK = "legacy_loopback"
    TEAM = "team"


@dataclass(frozen=True)
class AccessScope:
    subject_id: str
    username: str
    team_id: str
    team_name: str
    role: Literal["admin", "reviewer", "viewer"]
    permission_epoch: int
    session_id: str
    absolute_expires_at: int
    idle_expires_at: int


_current_scope: ContextVar[AccessScope | None] = ContextVar("trialboard_access_scope", default=None)


class TeamDataPath:
    """Resolve a DB only from the authenticated server-side team context."""

    def __init__(self, root: Path, *, forbidden_path: Path | None = None):
        self.root = root.resolve(strict=True)
        self.forbidden_path = forbidden_path.resolve(strict=False) if forbidden_path else None

    def _team_directory(self) -> Path:
        access = _current_scope.get()
        if access is None:
            raise RuntimeError("TEAM_CONTEXT_REQUIRED")
        team = str(UUID(access.team_id))
        directory = self.root / team
        if directory.is_symlink():
            raise RuntimeError("UNSAFE_TEAM_STORAGE_PATH")
        resolved_directory = directory.resolve(strict=False)
        if resolved_directory.parent != self.root:
            raise RuntimeError("UNSAFE_TEAM_STORAGE_PATH")
        return directory

    def lookup(self) -> Path | None:
        """Return an existing team database without creating directories or files."""
        directory = self._team_directory()
        if not directory.exists():
            return None
        if directory.is_symlink() or stat.S_IMODE(directory.stat().st_mode) & 0o077:
            raise RuntimeError("UNSAFE_TEAM_STORAGE_PERMISSIONS")
        database = directory / "evidence.sqlite3"
        if not database.exists():
            return None
        self._validate_database(database)
        return database

    def _validate_database(self, database: Path) -> None:
        if database.is_symlink():
            raise RuntimeError("UNSAFE_TEAM_STORAGE_PATH")
        if database.stat().st_nlink != 1:
            raise RuntimeError("UNSAFE_TEAM_STORAGE_ALIAS")
        if (
            self.forbidden_path
            and self.forbidden_path.exists()
            and database.samefile(self.forbidden_path)
        ):
            raise RuntimeError("UNSAFE_TEAM_STORAGE_ALIAS")

    def resolve(self) -> Path:
        directory = self._team_directory()
        directory.mkdir(mode=0o700, parents=False, exist_ok=True)
        if directory.is_symlink() or stat.S_IMODE(directory.stat().st_mode) & 0o077:
            raise RuntimeError("UNSAFE_TEAM_STORAGE_PERMISSIONS")
        database = directory / "evidence.sqlite3"
        if database.exists():
            self._validate_database(database)
        return database


def resolve_database_path(path: Path | TeamDataPath) -> Path:
    return path.resolve() if isinstance(path, TeamDataPath) else path


def current_access_scope() -> AccessScope | None:
    """Return the server-verified request scope; never infer it from request input."""
    return _current_scope.get()


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode("ascii")).digest()


def _token_digest(value: str, *, length: int) -> bytes | None:
    """Hash only canonical generated-token shapes; never accept stored hex hashes."""
    if len(value) != length or not value.isascii():
        return None
    if any(not (character.isalnum() or character in "-_") for character in value):
        return None
    if length == 64 and all(character in "0123456789abcdefABCDEF" for character in value):
        return None
    return _digest(value)


def _password_hash(password: str, salt: bytes) -> bytes:
    raw = password.encode("utf-8")
    if not raw or len(raw) > MAX_PASSWORD_BYTES:
        raise ValueError("INVALID_PASSWORD_LENGTH")
    return hashlib.scrypt(
        raw,
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=SCRYPT_MAXMEM,
        dklen=SCRYPT_DKLEN,
    )


SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash BLOB NOT NULL, salt BLOB NOT NULL,
    scrypt_n INTEGER NOT NULL, scrypt_r INTEGER NOT NULL, scrypt_p INTEGER NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE memberships (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    team_id TEXT NOT NULL REFERENCES teams(id), role TEXT NOT NULL,
    permission_epoch INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, team_id), CHECK(role IN ('admin','reviewer','viewer'))
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, token_hash BLOB NOT NULL UNIQUE,
    membership_id TEXT NOT NULL REFERENCES memberships(id), csrf_hash BLOB NOT NULL,
    created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
    absolute_expires_at INTEGER NOT NULL, idle_seconds INTEGER NOT NULL,
    revoked_at INTEGER
);
CREATE TABLE login_challenges (
    token_hash BLOB PRIMARY KEY, csrf_hash BLOB NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE TABLE session_csrf_tokens (
    session_id TEXT NOT NULL REFERENCES sessions(id), token_hash BLOB NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY(session_id, token_hash)
);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
"""


def bootstrap_identity_database(
    path: Path, *, username: str, password: str, team_name: str
) -> tuple[str, str]:
    """Create one fresh identity DB. Existing files are never opened or migrated."""
    username, team_name = username.strip(), team_name.strip()
    if not 1 <= len(username) <= MAX_USERNAME or not team_name or len(team_name) > 120:
        raise ValueError("INVALID_BOOTSTRAP_IDENTITY")
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError("UNSAFE_IDENTITY_DB_PATH")
    parent_existed = path.parent.exists()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not parent_existed:
        path.parent.chmod(0o700)
    if stat.S_IMODE(path.parent.stat().st_mode) & 0o077:
        raise ValueError("UNSAFE_IDENTITY_DB_PERMISSIONS")
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise ValueError("IDENTITY_DB_MUST_BE_FRESH") from error
    os.close(descriptor)
    try:
        salt = secrets.token_bytes(16)
        password_hash = _password_hash(password, salt)
        user_id, team_id, membership_id = str(uuid4()), str(uuid4()), str(uuid4())
        con = sqlite3.connect(path)
        con.executescript(SCHEMA)
        with con:
            con.execute("INSERT INTO metadata VALUES ('schema_version','team-auth/1')")
            con.execute(
                "INSERT INTO users VALUES (?,?,?,?,?,?,?,0)",
                (user_id, username, password_hash, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P),
            )
            con.execute("INSERT INTO teams VALUES (?,?)", (team_id, team_name))
            con.execute(
                "INSERT INTO memberships VALUES (?,?,?,?,1,1)",
                (membership_id, user_id, team_id, "admin"),
            )
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        if "con" in locals():
            con.close()
    path.chmod(0o600)
    return user_id, team_id


def validate_team_configuration(identity_db: Path, storage_root: Path, legacy_db: Path) -> None:
    if not identity_db.is_file() or identity_db.is_symlink():
        raise ValueError("TEAM_IDENTITY_DB_REQUIRED")
    if not storage_root.is_dir() or storage_root.is_symlink():
        raise ValueError("TEAM_STORAGE_ROOT_REQUIRED")
    identity = identity_db.resolve(strict=True)
    storage = storage_root.resolve(strict=True)
    legacy = legacy_db.resolve(strict=False)
    if identity_db.parent.is_symlink():
        raise ValueError("UNSAFE_TEAM_IDENTITY_PATH")
    if storage_root.parent.is_symlink():
        raise ValueError("UNSAFE_TEAM_STORAGE_PATH")
    if stat.S_IMODE(identity.stat().st_mode) & 0o077:
        raise ValueError("UNSAFE_TEAM_IDENTITY_PERMISSIONS")
    if identity.stat().st_nlink != 1:
        raise ValueError("UNSAFE_TEAM_IDENTITY_ALIAS")
    if (
        identity == legacy
        or storage == legacy
        or storage in identity.parents
        or identity in storage.parents
        or storage in legacy.parents
        or legacy in storage.parents
        or identity in legacy.parents
        or legacy in identity.parents
    ):
        raise ValueError("TEAM_STORAGE_MUST_BE_SEPARATE")
    if legacy.exists() and identity.samefile(legacy):
        raise ValueError("TEAM_STORAGE_MUST_BE_SEPARATE")
    for child in storage.iterdir():
        if child.is_symlink():
            raise ValueError("UNSAFE_TEAM_STORAGE_PATH")
        if child.is_dir():
            if stat.S_IMODE(child.stat().st_mode) & 0o077:
                raise ValueError("UNSAFE_TEAM_STORAGE_PERMISSIONS")
            evidence = child / "evidence.sqlite3"
            if evidence.is_symlink():
                raise ValueError("UNSAFE_TEAM_STORAGE_PATH")
            if evidence.exists() and evidence.stat().st_nlink != 1:
                raise ValueError("UNSAFE_TEAM_STORAGE_ALIAS")
            if evidence.exists() and legacy.exists() and evidence.samefile(legacy):
                raise ValueError("TEAM_STORAGE_MUST_BE_SEPARATE")
    try:
        with sqlite3.connect(f"{identity.as_uri()}?mode=ro", uri=True) as con:
            version = con.execute(
                "SELECT value FROM metadata WHERE key='schema_version'"
            ).fetchone()
            tables = {
                row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
    except sqlite3.Error as error:
        raise ValueError("INVALID_TEAM_IDENTITY_DB") from error
    required = {
        "users",
        "teams",
        "memberships",
        "sessions",
        "login_challenges",
        "session_csrf_tokens",
    }
    if version != ("team-auth/1",) or not required <= tables:
        raise ValueError("INVALID_TEAM_IDENTITY_DB")


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    username: str = Field(min_length=1, max_length=MAX_USERNAME)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_BYTES)


class LoginLimiter:
    def __init__(self, *, now=time.monotonic):
        self.attempts: dict[str, list[float]] = {}
        self.global_attempts: list[float] = []
        self.now = now
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = self.now()
        with self.lock:
            self.global_attempts = [stamp for stamp in self.global_attempts if now - stamp < 60]
            if len(self.global_attempts) >= 200:
                return False
            self.global_attempts.append(now)
            recent = [stamp for stamp in self.attempts.get(key, []) if now - stamp < 60]
            if len(recent) >= 5:
                self.attempts[key] = recent
                return False
            recent.append(now)
            self.attempts[key] = recent
            if len(self.attempts) > 2048:
                stale = sorted(
                    self.attempts,
                    key=lambda item: self.attempts[item][-1] if self.attempts[item] else 0,
                )[: len(self.attempts) - 2048]
                for item in stale:
                    self.attempts.pop(item, None)
            return True


def _origin_allowed(scope: Scope) -> bool:
    headers = {key.lower(): value for key, value in scope.get("headers", [])}
    origin = headers.get(b"origin", b"").decode("latin1")
    host = headers.get(b"host", b"").decode("latin1")
    same = f"{scope.get('scheme', 'http')}://{host}"
    return bool(origin) and origin in (*DEV_ORIGINS, same)


def _cookie(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        httponly=True,
        secure=False,
        samesite="strict",
        path="/",
    )


class TeamIdentity:
    def __init__(self, path: Path, now=lambda: int(time.time())):
        self.path = path.absolute()
        self._checked_path()
        self.now = now

    def _checked_path(self) -> Path:
        if not self.path.is_file() or self.path.is_symlink() or self.path.parent.is_symlink():
            raise RuntimeError("UNSAFE_TEAM_IDENTITY_PATH")
        info = self.path.stat()
        if info.st_nlink != 1:
            raise RuntimeError("UNSAFE_TEAM_IDENTITY_ALIAS")
        if stat.S_IMODE(info.st_mode) & 0o077:
            raise RuntimeError("UNSAFE_TEAM_IDENTITY_PERMISSIONS")
        return self.path.resolve(strict=True)

    def connect(self) -> sqlite3.Connection:
        path = self._checked_path()
        con = sqlite3.connect(f"{path.as_uri()}?mode=rw", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def challenge(self) -> tuple[str, str]:
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        now = self.now()
        with self.connect() as con:
            con.execute("DELETE FROM login_challenges WHERE expires_at < ?", (now,))
            con.execute(
                "INSERT INTO login_challenges VALUES (?,?,?,?,NULL)",
                (_digest(token), _digest(csrf), now, now + PRELOGIN_SECONDS),
            )
        return token, csrf

    def login(
        self, username: str, password: str, challenge: str, csrf: str
    ) -> tuple[str, AccessScope]:
        now = self.now()
        challenge_hash = _token_digest(challenge, length=43)
        csrf_hash = _token_digest(csrf, length=43)
        if challenge_hash is None or csrf_hash is None:
            raise ValueError("LOGIN_CSRF_INVALID")
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            consumed = con.execute(
                """UPDATE login_challenges SET used_at=?
                WHERE token_hash=? AND csrf_hash=? AND used_at IS NULL AND expires_at>=?""",
                (now, challenge_hash, csrf_hash, now),
            )
            if consumed.rowcount != 1:
                con.commit()
                raise ValueError("LOGIN_CSRF_INVALID")
            con.commit()
        with self.connect() as con:
            rows = con.execute(
                """SELECT u.id user_id,u.username,u.password_hash,u.salt,
                u.scrypt_n,u.scrypt_r,u.scrypt_p,u.disabled,m.id membership_id,
                m.team_id,m.role,m.permission_epoch,m.active,t.name team_name
                FROM users u JOIN memberships m ON m.user_id=u.id
                JOIN teams t ON t.id=m.team_id WHERE u.username=? COLLATE NOCASE
                ORDER BY m.id LIMIT 2""",
                (username.strip(),),
            ).fetchall()
            if len(rows) != 1:
                _password_hash(password, b"\0" * 16)
                raise ValueError("LOGIN_FAILED")
            account = rows[0]
            if (account["scrypt_n"], account["scrypt_r"], account["scrypt_p"]) != (
                SCRYPT_N,
                SCRYPT_R,
                SCRYPT_P,
            ):
                raise ValueError("UNSAFE_PASSWORD_PARAMETERS")
            actual = _password_hash(password, account["salt"])
            if (
                account["disabled"]
                or not account["active"]
                or not hmac.compare_digest(account["password_hash"], actual)
            ):
                raise ValueError("LOGIN_FAILED")
            token, session_csrf, session_id = (
                secrets.token_urlsafe(48),
                secrets.token_urlsafe(32),
                str(uuid4()),
            )
            expires = now + SESSION_ABSOLUTE_SECONDS
            con.execute(
                "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,NULL)",
                (
                    session_id,
                    _digest(token),
                    account["membership_id"],
                    _digest(session_csrf),
                    now,
                    now,
                    expires,
                    SESSION_IDLE_SECONDS,
                ),
            )
            con.execute(
                "INSERT INTO session_csrf_tokens VALUES (?,?,?)",
                (session_id, _digest(session_csrf), now),
            )
        return token, AccessScope(
            subject_id=account["user_id"],
            username=account["username"],
            team_id=account["team_id"],
            team_name=account["team_name"],
            role=account["role"],
            permission_epoch=account["permission_epoch"],
            session_id=session_id,
            absolute_expires_at=expires,
            idle_expires_at=now + SESSION_IDLE_SECONDS,
        )

    def authenticate(self, token: str) -> AccessScope | None:
        token_hash = _token_digest(token, length=64)
        if token_hash is None:
            return None
        now = self.now()
        with self.connect() as con:
            row = con.execute(
                """SELECT s.id session_id,s.last_seen_at,s.absolute_expires_at,s.idle_seconds,
                s.revoked_at,u.id user_id,u.username,u.disabled,m.team_id,m.role,
                m.permission_epoch,m.active,t.name team_name
                FROM sessions s JOIN memberships m ON m.id=s.membership_id
                JOIN users u ON u.id=m.user_id JOIN teams t ON t.id=m.team_id
                WHERE s.token_hash=?""",
                (token_hash,),
            ).fetchone()
            if not row:
                return None
            idle_expires = row["last_seen_at"] + row["idle_seconds"]
            if (
                row["revoked_at"] is not None
                or row["disabled"]
                or not row["active"]
                or now >= row["absolute_expires_at"]
                or now >= idle_expires
            ):
                return None
            con.execute("UPDATE sessions SET last_seen_at=? WHERE id=?", (now, row["session_id"]))
        return AccessScope(
            subject_id=row["user_id"],
            username=row["username"],
            team_id=row["team_id"],
            team_name=row["team_name"],
            role=row["role"],
            permission_epoch=row["permission_epoch"],
            session_id=row["session_id"],
            absolute_expires_at=row["absolute_expires_at"],
            idle_expires_at=now + row["idle_seconds"],
        )

    def revalidate(self, expected: AccessScope) -> AccessScope | None:
        """Recheck a running request's identity without extending its idle lifetime."""
        now = self.now()
        with self.connect() as con:
            row = con.execute(
                """SELECT s.id session_id,s.last_seen_at,s.absolute_expires_at,s.idle_seconds,
                s.revoked_at,u.id user_id,u.username,u.disabled,m.team_id,m.role,
                m.permission_epoch,m.active,t.name team_name
                FROM sessions s JOIN memberships m ON m.id=s.membership_id
                JOIN users u ON u.id=m.user_id JOIN teams t ON t.id=m.team_id
                WHERE s.id=?""",
                (expected.session_id,),
            ).fetchone()
        if row is None:
            return None
        idle_expires = row["last_seen_at"] + row["idle_seconds"]
        if (
            row["revoked_at"] is not None
            or row["disabled"]
            or not row["active"]
            or now >= row["absolute_expires_at"]
            or now >= idle_expires
            or row["user_id"] != expected.subject_id
            or row["team_id"] != expected.team_id
            or row["role"] != expected.role
            or row["permission_epoch"] != expected.permission_epoch
        ):
            return None
        return AccessScope(
            subject_id=row["user_id"],
            username=row["username"],
            team_id=row["team_id"],
            team_name=row["team_name"],
            role=row["role"],
            permission_epoch=row["permission_epoch"],
            session_id=row["session_id"],
            absolute_expires_at=row["absolute_expires_at"],
            idle_expires_at=idle_expires,
        )

    def csrf_valid(self, session_id: str, token: str) -> bool:
        token_hash = _token_digest(token, length=43)
        if token_hash is None:
            return False
        with self.connect() as con:
            row = con.execute(
                "SELECT 1 FROM session_csrf_tokens WHERE session_id=? AND token_hash=?",
                (session_id, token_hash),
            ).fetchone()
        return bool(row)

    def csrf_for_session(self, session_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self.connect() as con:
            con.execute(
                "INSERT INTO session_csrf_tokens VALUES (?,?,?)",
                (session_id, _digest(token), self.now()),
            )
            con.execute(
                """DELETE FROM session_csrf_tokens WHERE session_id=? AND token_hash NOT IN
                (SELECT token_hash FROM session_csrf_tokens WHERE session_id=?
                 ORDER BY created_at DESC, rowid DESC LIMIT 8)""",
                (session_id, session_id),
            )
        return token

    def logout(self, session_id: str) -> None:
        with self.connect() as con:
            con.execute("UPDATE sessions SET revoked_at=? WHERE id=?", (self.now(), session_id))

    def active_team_members(self, access: AccessScope) -> list[dict]:
        """Return only public identity fields for active members of the actor's team."""
        with self.connect() as con:
            rows = con.execute(
                """SELECT u.id,u.username,m.role FROM memberships m
                JOIN users u ON u.id=m.user_id
                WHERE m.team_id=? AND m.active=1 AND u.disabled=0
                ORDER BY u.username COLLATE NOCASE,u.id""",
                (access.team_id,),
            ).fetchall()
        return [{"id": row[0], "username": row[1], "role": row[2]} for row in rows]


PUBLIC_PATHS = {
    ("GET", "/health"),
    ("GET", "/api/access-mode"),
    ("GET", "/api/auth/login-challenge"),
    ("POST", "/api/auth/login"),
}
AUTH_PATHS = {
    ("GET", "/api/auth/session"),
    ("GET", "/api/auth/csrf"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/teams/current"),
    ("GET", "/api/teams/current/members"),
}
PROTECTED_PATHS = {
    ("GET", "/api/design-proposals/capabilities"),
    ("POST", "/api/design-proposals"),
    ("GET", "/api/evidence-scout/capabilities"),
    ("GET", "/api/evidence-scout/searches"),
    ("GET", "/api/evidence-scout/searches/{run_id}"),
    ("POST", "/api/evidence-scout/search"),
    ("GET", "/api/agent-demo/capabilities"),
    ("POST", "/api/agent-demo/run"),
    ("POST", "/api/pdf-agent/run"),
    ("GET", "/api/design-comparisons/capabilities"),
    ("POST", "/api/design-comparisons"),
    ("GET", "/api/reviews/defaults"),
    ("POST", "/api/reviews"),
    ("GET", "/api/projects"),
    ("GET", "/api/projects/{project_id}/{revision}"),
    ("GET", "/api/projects/{project_id}/{revision}/provenance"),
    ("POST", "/api/projects"),
    ("POST", "/api/projects/source-versions"),
    ("POST", "/api/projects/import/preview"),
    ("POST", "/api/projects/import/commit"),
    ("GET", "/api/projects/{project_id}/{revision}/events"),
    ("POST", "/api/projects/{project_id}/{revision}/events"),
    ("GET", "/api/projects/{project_id}/access"),
    ("POST", "/api/projects/{project_id}/access"),
    ("GET", "/api/projects/{project_id}/usage-policy"),
    ("POST", "/api/projects/{project_id}/usage-policy"),
    ("GET", "/api/research/runs"),
    ("GET", "/api/research/runs/{run_id}"),
    ("GET", "/api/research/runs/{run_id}/source-metadata"),
    ("GET", "/api/research/runs/{run_id}/pdf-metadata"),
    ("GET", "/api/research/runs/{run_id}/raw-metadata"),
    ("GET", "/api/research/runs/{run_id}/sources/{source_id}/raw-usage-policy"),
    ("POST", "/api/research/runs/{run_id}/sources/{source_id}/raw-usage-policy"),
    ("GET", "/api/research/pdf-preparation-capabilities"),
    ("GET", "/api/research/runs/{run_id}/documents/{source_id}/pdf-preparations"),
    ("POST", "/api/research/runs/{run_id}/documents/{source_id}/prepare-server"),
    ("GET", "/api/research/runs/{run_id}/pdf-preparations/{preparation_id}"),
    ("GET", "/api/research/runs/{run_id}/documents/{source_id}/usage-policy"),
    ("POST", "/api/research/runs/{run_id}/documents/{source_id}/usage-policy"),
    ("POST", "/api/research/runs/{run_id}/review-saved"),
    ("GET", "/api/research/runs/{run_id}/review-attempts"),
    ("GET", "/api/research/runs/{run_id}/review-usage"),
    ("GET", "/api/research/runs/{run_id}/review-attempts/{attempt_id}"),
    ("GET", "/api/research/runs/{run_id}/review-attempts/{attempt_id}/handoff"),
    ("POST", "/api/research/runs/{run_id}/review-prepared-pdf"),
    ("GET", "/api/research/runs/{run_id}/pdf-review-attempts"),
    ("GET", "/api/research/runs/{run_id}/pdf-review-attempts/{attempt_id}"),
    ("GET", "/api/research/runs/{run_id}/pdf-review-usage"),
    ("GET", "/api/research/runs/{run_id}/sources/{source_id}/usage-policy"),
    ("POST", "/api/research/runs/{run_id}/sources/{source_id}/usage-policy"),
    ("GET", "/api/research/runs/{run_id}/search"),
    ("GET", "/api/research/runs/{run_id}/impact"),
    ("GET", "/api/research/runs/{run_id}/result-tables"),
    ("POST", "/api/research/runs/{run_id}/recover"),
    ("GET", "/api/research/runs/{run_id}/curation"),
    ("POST", "/api/research/runs/{run_id}/curation"),
    ("POST", "/api/research/run"),
    ("GET", "/api/research/runs/{run_id}/documents/{source_id}/cached"),
    ("POST", "/api/research/runs/{run_id}/documents/{source_id}"),
    ("GET", "/api/research/runs/{run_id}/automation"),
    ("POST", "/api/research/runs/{run_id}/automation"),
    ("POST", "/api/research/runs/{run_id}/automation/run"),
    ("GET", "/api/research/runs/{run_id}/exploration"),
    ("POST", "/api/research/runs/{run_id}/exploration"),
}


class TeamAccessBoundary:
    """Deny unknown API routes and authorize every matched route method."""

    def __init__(self, app: ASGIApp, *, identity: TeamIdentity, routes: list):
        self.app, self.identity, self.routes = app, identity, routes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self.app(scope, receive, send)
            return
        if scope["type"] != "http":
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            return
        path, method = scope.get("path", ""), scope.get("method", "GET")
        if method == "OPTIONS":
            await self.app(scope, receive, send)
            return
        header_pairs = scope.get("headers", [])
        if any(
            sum(1 for key, _ in header_pairs if key.lower() == name) > 1
            for name in (b"host", b"origin", b"cookie", b"x-csrf-token", SESSION_CONTEXT_HEADER)
        ):
            await JSONResponse({"error": {"code": "AMBIGUOUS_SECURITY_HEADER"}}, status_code=400)(
                scope, receive, send
            )
            return
        matched_path = None
        for route in _iter_routes(self.routes):
            match, _ = route.matches(scope)
            if match is Match.FULL:
                matched_path = getattr(route, "path", None)
                break
        key = (method, matched_path or path)
        if key in PUBLIC_PATHS:
            await self.app(scope, receive, send)
            return
        if not path.startswith("/api/"):
            await JSONResponse({"error": {"code": "TEAM_ROUTE_NOT_PUBLIC"}}, status_code=404)(
                scope, receive, send
            )
            return
        headers = {k.lower(): v for k, v in header_pairs}
        cookies = {}
        for part in headers.get(b"cookie", b"").decode("latin1").split(";"):
            if "=" in part:
                name, value = part.strip().split("=", 1)
                cookies[name] = value
        access = self.identity.authenticate(cookies.get(SESSION_COOKIE, ""))
        if access is None:
            await JSONResponse({"error": {"code": "AUTH_REQUIRED"}}, status_code=401)(
                scope, receive, send
            )
            return
        if key not in AUTH_PATHS | PROTECTED_PATHS:
            await JSONResponse({"error": {"code": "API_ROUTE_DENIED"}}, status_code=403)(
                scope, receive, send
            )
            return
        expected_context = headers.get(SESSION_CONTEXT_HEADER)
        actual_context = _session_context(access).encode("ascii")
        if key != ("GET", "/api/auth/session") and (
            expected_context is None
            or len(expected_context) != len(actual_context)
            or not hmac.compare_digest(expected_context, actual_context)
        ):
            await JSONResponse(
                {"error": {"code": "SESSION_CONTEXT_MISMATCH"}},
                status_code=409,
                headers={"X-TrialBoard-Error-Code": "SESSION_CONTEXT_MISMATCH"},
            )(scope, receive, send)
            return
        if method not in {"GET", "HEAD"}:
            if access.role == "viewer" and key not in AUTH_PATHS:
                await JSONResponse({"error": {"code": "WRITE_FORBIDDEN"}}, status_code=403)(
                    scope, receive, send
                )
                return
            csrf = headers.get(b"x-csrf-token", b"").decode("latin1")
            if not _origin_allowed(scope) or not self.identity.csrf_valid(access.session_id, csrf):
                await JSONResponse({"error": {"code": "CSRF_REJECTED"}}, status_code=403)(
                    scope, receive, send
                )
                return
        context_token = _current_scope.set(access)
        scope.setdefault("state", {})["access"] = access
        try:
            await self.app(scope, receive, send)
        finally:
            _current_scope.reset(context_token)


def auth_router(identity: TeamIdentity) -> APIRouter:
    router, limiter = APIRouter(), LoginLimiter()

    def client_key(request: Request) -> str:
        return request.client.host if request.client else "local"

    @router.get("/api/access-mode")
    def access_mode():
        return {"mode": AccessMode.TEAM, "tls": False, "production_ready": False}

    @router.get("/api/auth/login-challenge")
    def login_challenge(request: Request, response: Response):
        if not limiter.allow(f"challenge:{client_key(request)}"):
            raise HTTPException(429, "LOGIN_RATE_LIMITED", headers={"Retry-After": "60"})
        token, csrf = identity.challenge()
        _cookie(response, PRELOGIN_COOKIE, token, PRELOGIN_SECONDS)
        return {"csrf_token": csrf, "expires_in": PRELOGIN_SECONDS}

    @router.post("/api/auth/login")
    def login(body: LoginInput, request: Request, response: Response):
        if not _origin_allowed(request.scope):
            raise HTTPException(403, "LOGIN_ORIGIN_REQUIRED")
        address = client_key(request)
        if not limiter.allow(f"login-ip:{address}") or not limiter.allow(
            f"login-user:{address}:{body.username.casefold()}"
        ):
            raise HTTPException(429, "LOGIN_RATE_LIMITED", headers={"Retry-After": "60"})
        try:
            token, access = identity.login(
                body.username,
                body.password,
                request.cookies.get(PRELOGIN_COOKIE, ""),
                request.headers.get("x-csrf-token", ""),
            )
        except ValueError:
            raise HTTPException(401, "LOGIN_FAILED") from None
        response.delete_cookie(PRELOGIN_COOKIE, path="/")
        _cookie(response, SESSION_COOKIE, token, SESSION_ABSOLUTE_SECONDS)
        return _session_packet(access)

    @router.get("/api/auth/session")
    def session(request: Request):
        return _session_packet(request.state.access)

    @router.get("/api/auth/csrf")
    def csrf(request: Request):
        return {"csrf_token": identity.csrf_for_session(request.state.access.session_id)}

    @router.post("/api/auth/logout")
    def logout(request: Request, response: Response):
        identity.logout(request.state.access.session_id)
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"logged_out": True}

    @router.get("/api/teams/current")
    def current_team(request: Request):
        access = request.state.access
        return {
            "id": access.team_id,
            "name": access.team_name,
            "role": access.role,
            "permission_epoch": access.permission_epoch,
        }

    @router.get("/api/teams/current/members")
    def current_team_members(request: Request):
        return {"members": identity.active_team_members(request.state.access)}

    return router


def _session_packet(access: AccessScope) -> dict:
    return {
        "authenticated": True,
        "subject": {"id": access.subject_id, "username": access.username},
        "team": {"id": access.team_id, "name": access.team_name},
        "role": access.role,
        "permission_epoch": access.permission_epoch,
        "absolute_expires_at": access.absolute_expires_at,
        "idle_expires_at": access.idle_expires_at,
        "session_context": _session_context(access),
    }


def _session_context(access: AccessScope) -> str:
    """Opaque equality fence only; never an authentication or authorization credential."""
    value = f"team-auth/1\0{access.subject_id}\0{access.team_id}".encode()
    return hashlib.sha256(value).hexdigest()


def assert_route_policy_complete(routes: list) -> None:
    ignored = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
    known = PUBLIC_PATHS | AUTH_PATHS | PROTECTED_PATHS
    missing = []
    for route in _iter_routes(routes):
        path = getattr(route, "path", "")
        for method in getattr(route, "methods", None) or set():
            if (
                path not in ignored
                and method not in {"HEAD", "OPTIONS"}
                and (method, path) not in known
            ):
                missing.append(f"{method} {path}")
    if missing:
        raise RuntimeError("UNCLASSIFIED_ROUTES: " + ", ".join(sorted(missing)))


def _iter_routes(routes):
    for route in routes:
        nested = getattr(getattr(route, "original_router", None), "routes", None)
        if nested is not None:
            yield from _iter_routes(nested)
        else:
            yield route
