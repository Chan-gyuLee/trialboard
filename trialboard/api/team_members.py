"""Offline member administration for the opt-in local TEAM identity database."""

from __future__ import annotations

import argparse
import getpass
import sqlite3
from pathlib import Path
from typing import Literal
from uuid import uuid4

from trialboard.api.team_auth import (
    MAX_PASSWORD_BYTES,
    MAX_USERNAME,
    SCRYPT_N,
    SCRYPT_P,
    SCRYPT_R,
    TeamIdentity,
    _password_hash,
)

Role = Literal["admin", "reviewer", "viewer"]


def add_member(path: Path, *, username: str, password: str, role: Role) -> str:
    identity = TeamIdentity(path)
    username = username.strip()
    if not 1 <= len(username) <= MAX_USERNAME or role not in {"admin", "reviewer", "viewer"}:
        raise ValueError("INVALID_MEMBER")
    salt = __import__("secrets").token_bytes(16)
    password_hash = _password_hash(password, salt)
    user_id, membership_id = str(uuid4()), str(uuid4())
    with identity.connect() as con:
        con.execute("BEGIN IMMEDIATE")
        teams = con.execute("SELECT id FROM teams ORDER BY id LIMIT 2").fetchall()
        if len(teams) != 1:
            raise ValueError("ONE_TEAM_IDENTITY_DB_REQUIRED")
        try:
            con.execute(
                "INSERT INTO users VALUES (?,?,?,?,?,?,?,0)",
                (user_id, username, password_hash, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P),
            )
            con.execute(
                "INSERT INTO memberships VALUES (?,?,?,?,1,1)",
                (membership_id, user_id, teams[0][0], role),
            )
        except sqlite3.IntegrityError as error:
            raise ValueError("MEMBER_ALREADY_EXISTS") from error
    return user_id


def change_member(path: Path, *, username: str, role: Role | None, revoke: bool) -> None:
    identity = TeamIdentity(path)
    with identity.connect() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            """SELECT m.id,m.role,m.active FROM memberships m JOIN users u ON u.id=m.user_id
            WHERE u.username=? COLLATE NOCASE""",
            (username.strip(),),
        ).fetchone()
        if row is None:
            raise ValueError("MEMBER_NOT_FOUND")
        removes_admin = row[1] == "admin" and row[2] and (revoke or role != "admin")
        if removes_admin:
            admins = con.execute(
                "SELECT COUNT(*) FROM memberships WHERE role='admin' AND active=1"
            ).fetchone()[0]
            if admins <= 1:
                raise ValueError("LAST_ADMIN_LOCKOUT")
        next_role = role or row[1]
        if next_role not in {"admin", "reviewer", "viewer"}:
            raise ValueError("INVALID_MEMBER_ROLE")
        con.execute(
            "UPDATE memberships SET role=?,active=?,permission_epoch=permission_epoch+1 WHERE id=?",
            (next_role, 0 if revoke else 1, row[0]),
        )
        con.execute(
            "UPDATE sessions SET revoked_at=COALESCE("
            "revoked_at,CAST(strftime('%s','now') AS INTEGER)) WHERE membership_id=?",
            (row[0],),
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage local TrialBoard TEAM members")
    parser.add_argument("--identity-db", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("add")
    add.add_argument("--username", required=True)
    add.add_argument("--role", choices=["admin", "reviewer", "viewer"], required=True)
    update = commands.add_parser("set-role")
    update.add_argument("--username", required=True)
    update.add_argument("--role", choices=["admin", "reviewer", "viewer"], required=True)
    revoke = commands.add_parser("revoke")
    revoke.add_argument("--username", required=True)
    args = parser.parse_args()
    try:
        if args.command == "add":
            password = getpass.getpass("New password (hidden): ")
            confirmation = getpass.getpass("Confirm password (hidden): ")
            if (
                password != confirmation
                or not password
                or len(password.encode()) > MAX_PASSWORD_BYTES
            ):
                parser.error("passwords do not match or length is invalid")
            add_member(args.identity_db, username=args.username, password=password, role=args.role)
        else:
            change_member(
                args.identity_db,
                username=args.username,
                role=getattr(args, "role", None),
                revoke=args.command == "revoke",
            )
    except (ValueError, RuntimeError) as error:
        parser.error(str(error))
    print("TEAM membership updated; active sessions for that member were revoked.")


if __name__ == "__main__":
    main()
