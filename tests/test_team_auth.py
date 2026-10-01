import base64
import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trialboard.api.app import create_app
from trialboard.api.projects import ProjectStore
from trialboard.api.scout import EvidenceStore
from trialboard.api.team_auth import (
    PROTECTED_PATHS,
    SESSION_COOKIE,
    LoginLimiter,
    TeamDataPath,
    TeamIdentity,
    assert_route_policy_complete,
    bootstrap_identity_database,
    validate_team_configuration,
)
from trialboard.api.team_members import add_member, change_member
from trialboard.research.automation import AutomationStore
from trialboard.research.exploration import ExplorationStore
from trialboard.research.models import Collection, ResearchRequest, Source
from trialboard.research.store import ResearchStore
from trialboard.serialization import sha256_json

ORIGIN = "http://127.0.0.1"
PASSWORD = "test-only-password"


def collaboration_payload():
    from test_field_revalidation import sample

    fixture = sample()
    source = fixture["source"]["source"]
    bundle = {
        "schema": "trialboard-project/1",
        "source": source,
        "notes": [],
        "reviewRaw": json.dumps(fixture["review"]),
        "draftRaw": json.dumps(
            {"schema_version": "design-draft/1", "source_digest": source["sha256"]}
        ),
        "meetingRaw": None,
        "agentRaw": None,
        "context": None,
    }
    return {
        "consent": True,
        "public_authorized_non_sensitive": True,
        "usage_policy": {
            "original_storage": "ALLOW",
            "internal_search": "UNKNOWN",
            "external_ai": "UNKNOWN",
            "training": "UNKNOWN",
            "evidence_reference": "synthetic-test-fixture",
            "reason": "Synthetic fixture permits local project storage only.",
        },
        "sharing_scope": "team_wide",
        "project_id": None,
        "expected_revision": 0,
        "title": "Synthetic team document",
        "pdf_base64": base64.b64encode(fixture["pdf"]).decode(),
        "bundle_json": json.dumps(bundle),
    }


def contextual_import_payload():
    body = collaboration_payload()
    bundle = json.loads(body["bundle_json"])
    bundle["context"] = {
        "asset": "synthetic legacy asset",
        "indication": "synthetic legacy indication",
        "study": "NCT00000000",
        "question": "synthetic legacy question",
        "receiptId": "foreign-legacy-receipt",
        "document": {
            "runId": "foreign-legacy-run",
            "sourceId": "foreign-legacy-source",
            "title": "Legacy source",
        },
    }
    body["bundle_json"] = json.dumps(bundle, ensure_ascii=False, indent=2) + "\n"
    return body


def make_team_app(tmp_path: Path, **flags):
    identity_db = tmp_path / "identity.sqlite3"
    storage = tmp_path / "teams"
    storage.mkdir(mode=0o700)
    bootstrap_identity_database(identity_db, username="admin", password=PASSWORD, team_name="Alpha")
    app = create_app(
        access_mode="team",
        identity_db=identity_db,
        team_storage_root=storage,
        evidence_db=tmp_path / "legacy.sqlite3",
        **flags,
    )
    return app, identity_db, storage


def login(client: TestClient, username="admin", password=PASSWORD):
    challenge = client.get("/api/auth/login-challenge").json()["csrf_token"]
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
        headers={"Origin": ORIGIN, "X-CSRF-Token": challenge},
    )
    if response.status_code == 200:
        client.headers["X-TrialBoard-Session-Context"] = response.json()["session_context"]
    return response


def csrf(client: TestClient) -> str:
    response = client.get("/api/auth/csrf")
    assert response.status_code == 200
    return response.json()["csrf_token"]


def test_team_configuration_fails_closed_and_legacy_default_is_unchanged(tmp_path):
    with pytest.raises(ValueError, match="TEAM_REQUIRES"):
        create_app(access_mode="team")
    with pytest.raises(ValueError, match="TEAM_CONFIGURATION"):
        create_app(identity_db=tmp_path / "identity")
    with TestClient(create_app(), base_url=ORIGIN) as client:
        assert client.get("/api/access-mode").json()["mode"] == "legacy_loopback"
        assert client.get("/api/reviews/defaults").status_code == 200


def test_bootstrap_is_fresh_and_stores_scrypt_hash_not_password(tmp_path):
    path = tmp_path / "identity.sqlite3"
    bootstrap_identity_database(path, username="admin", password=PASSWORD, team_name="Alpha")
    with pytest.raises(ValueError, match="FRESH"):
        bootstrap_identity_database(path, username="again", password=PASSWORD, team_name="Beta")
    with sqlite3.connect(path) as con:
        row = con.execute(
            "SELECT password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users"
        ).fetchone()
    assert PASSWORD.encode() not in row[0]
    assert len(row[0]) == 32 and len(row[1]) == 16
    assert row[2:] == (2**15, 8, 3)


def test_auth_session_csrf_logout_and_unknown_api_denial(tmp_path):
    app, _, _ = make_team_app(tmp_path)
    with TestClient(app, base_url=ORIGIN) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/access-mode").json()["mode"] == "team"
        preflight = client.options(
            "/api/reviews",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "X-TrialBoard-Session-Context",
            },
        )
        assert preflight.status_code == 200
        assert "x-trialboard-session-context" in preflight.headers[
            "access-control-allow-headers"
        ].lower()
        assert client.get("/api/reviews/defaults").status_code == 401
        assert login(client).status_code == 200
        cookie = client.cookies.get(SESSION_COOKIE)
        assert cookie and PASSWORD not in cookie
        assert client.get("/api/auth/session").json()["team"]["name"] == "Alpha"
        assert client.get(
            "/api/reviews/defaults", headers={"X-TrialBoard-Session-Context": ""}
        ).status_code == 409
        assert client.patch("/api/not-registered", json={}).status_code == 403
        assert client.post("/api/reviews", json={}).status_code == 403
        token = csrf(client)
        challenge = client.get("/api/auth/login-challenge").json()["csrf_token"]
        body = {"username": "admin", "password": PASSWORD}
        assert (
            client.post(
                "/api/reviews",
                json={"repetitions": 100},
                headers={"Origin": "https://hostile.example", "X-CSRF-Token": token},
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/auth/login",
                json=body,
                headers=[
                    (b"origin", ORIGIN.encode()),
                    (b"origin", b"https://hostile.example"),
                    (b"x-csrf-token", challenge.encode()),
                ],
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/api/reviews",
                json={"repetitions": 100},
                headers={"Origin": ORIGIN, "X-CSRF-Token": token},
            ).status_code
            == 200
        )
        token = csrf(client)
        assert (
            client.post(
                "/api/auth/logout", json={}, headers={"Origin": ORIGIN, "X-CSRF-Token": token}
            ).status_code
            == 200
        )
        client.cookies.set(SESSION_COOKIE, cookie)
        assert client.get("/api/auth/session").status_code == 401


def test_login_origin_challenge_replay_rate_limit_and_host(tmp_path):
    app, _, _ = make_team_app(tmp_path)
    with TestClient(app, base_url=ORIGIN) as client:
        challenge = client.get("/api/auth/login-challenge").json()["csrf_token"]
        body = {"username": "admin", "password": "wrong"}
        assert (
            client.post(
                "/api/auth/login",
                json=body,
                headers={"Origin": "https://hostile.example", "X-CSRF-Token": challenge},
            ).status_code
            == 403
        )
        first = client.post(
            "/api/auth/login", json=body, headers={"Origin": ORIGIN, "X-CSRF-Token": challenge}
        )
        assert first.status_code == 401
        assert (
            client.post(
                "/api/auth/login", json=body, headers={"Origin": ORIGIN, "X-CSRF-Token": challenge}
            ).status_code
            == 401
        )
        for _ in range(4):
            challenge = client.get("/api/auth/login-challenge").json()["csrf_token"]
            limited = client.post(
                "/api/auth/login",
                json=body,
                headers={"Origin": ORIGIN, "X-CSRF-Token": challenge},
            )
        assert limited.status_code == 429
        assert client.get("/health", headers={"Host": "evil.example"}).status_code == 400


def test_membership_revocation_and_role_change_apply_to_existing_session(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path)
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        with sqlite3.connect(identity_db) as con:
            con.execute("UPDATE memberships SET role='viewer',permission_epoch=2")
        session = client.get("/api/auth/session")
        assert session.json()["role"] == "viewer"
        token = csrf(client)
        assert (
            client.post(
                "/api/reviews",
                json={"repetitions": 100},
                headers={"Origin": ORIGIN, "X-CSRF-Token": token},
            ).status_code
            == 403
        )
        with sqlite3.connect(identity_db) as con:
            con.execute("UPDATE memberships SET active=0,permission_epoch=3")
        assert client.get("/api/auth/session").status_code == 401


def test_offline_member_management_has_one_team_and_last_admin_guards(tmp_path):
    _, identity_db, _ = make_team_app(tmp_path)
    reviewer_id = add_member(
        identity_db, username="reviewer", password=PASSWORD, role="reviewer"
    )
    assert reviewer_id
    with pytest.raises(ValueError, match="EXISTS"):
        add_member(identity_db, username="REVIEWER", password=PASSWORD, role="viewer")
    with pytest.raises(ValueError, match="LAST_ADMIN"):
        change_member(identity_db, username="admin", role="viewer", revoke=False)
    add_member(identity_db, username="backup", password=PASSWORD, role="admin")
    change_member(identity_db, username="admin", role="reviewer", revoke=False)
    with sqlite3.connect(identity_db) as con:
        assert con.execute(
            "SELECT role,permission_epoch FROM memberships m JOIN users u ON u.id=m.user_id "
            "WHERE u.username='admin'"
        ).fetchone() == ("reviewer", 2)


def test_team_import_review_history_conflict_roles_and_forged_author(tmp_path):
    app, identity_db, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    add_member(identity_db, username="reviewer", password=PASSWORD, role="reviewer")
    add_member(identity_db, username="viewer", password=PASSWORD, role="viewer")
    body = collaboration_payload()
    with TestClient(app, base_url=ORIGIN) as admin:
        assert login(admin).status_code == 200
        token = csrf(admin)
        headers = {"Origin": ORIGIN, "X-CSRF-Token": token}
        preview = admin.post("/api/projects/import/preview", json=body, headers=headers)
        assert preview.status_code == 200
        assert preview.json()["writes_performed"] is False
        team_id = admin.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"
        assert not database.exists()
        committed = admin.post(
            "/api/projects/import/commit",
            json={**body, "confirmation": True,
                  "import_preview_digest": preview.json()["import_preview_digest"]},
            headers=headers,
        )
        assert committed.status_code == 200
        saved = committed.json()
        assert saved["sharing_scope"] == "team_wide"
        with sqlite3.connect(database) as con:
            attestation = con.execute(
                "SELECT document_revision,pdf_digest,bundle_digest,username,statement "
                "FROM team_project_attestations WHERE project_id=?",
                (saved["project_id"],),
            ).fetchone()
        assert attestation == (
            1,
            saved["pdf_digest"],
            saved["bundle_digest"],
            "admin",
            "user_attested_public_or_authorized_non_sensitive",
        )
        assert admin.post(
            "/api/projects/import/commit",
            json={**body, "confirmation": True,
                  "import_preview_digest": preview.json()["import_preview_digest"]},
            headers=headers,
        ).status_code == 409
        assert admin.get(f"/api/projects/{saved['project_id']}/1").status_code == 200
        event_url = f"/api/projects/{saved['project_id']}/1/events"
        event = {
            "expected_revision": 0,
            "kind": "review_approval",
            "text": "Workflow checked",
            "base_document_revision": 1,
        }
        created = admin.post(event_url, json=event, headers=headers)
        assert created.status_code == 200
        assert created.json()["subject"]["username"] == "admin"
        assert created.json()["clinical_approval"] is False
        assert admin.post(event_url, json=event, headers=headers).status_code == 409
        assert admin.post(
            event_url,
            json={**event, "expected_revision": 1, "author": "forged"},
            headers=headers,
        ).status_code == 422
        next_body = {
            key: value
            for key, value in body.items()
            if key not in {"sharing_scope", "access_members"}
        }
        revised = admin.post(
            "/api/projects",
            json={**next_body, "project_id": saved["project_id"], "expected_revision": 1},
            headers={**headers, "Origin": "http://127.0.0.1:5173"},
        )
        assert revised.status_code == 200
        second_url = f"/api/projects/{saved['project_id']}/2/events"
        second = admin.post(
            second_url,
            json={
                **event,
                "expected_revision": 1,
                "kind": "note",
                "text": "Revision two",
                "base_document_revision": 2,
            },
            headers=headers,
        )
        assert second.status_code == 200
        timeline = admin.get(second_url).json()
        assert timeline["event_revision"] == 2
        assert [row["base_document_revision"] for row in timeline["events"]] == [1, 2]

    with TestClient(app, base_url=ORIGIN) as reviewer:
        assert login(reviewer, "reviewer").status_code == 200
        token = csrf(reviewer)
        response = reviewer.post(
            event_url,
            json={**event, "expected_revision": 2, "kind": "note", "text": "Reviewer note"},
            headers={"Origin": ORIGIN, "X-CSRF-Token": token},
        )
        assert response.status_code == 200
        assert response.json()["subject"]["username"] == "reviewer"

    with TestClient(app, base_url=ORIGIN) as viewer:
        assert login(viewer, "viewer").status_code == 200
        assert viewer.get(event_url).json()["event_revision"] == 3
        token = csrf(viewer)
        assert viewer.post(
            event_url,
            json={**event, "expected_revision": 3},
            headers={"Origin": ORIGIN, "X-CSRF-Token": token},
        ).status_code == 403


def test_team_import_preview_never_creates_product_storage_or_schema(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    body = collaboration_payload()
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf(client)}
        before = sorted(path.relative_to(storage) for path in storage.rglob("*"))
        missing_attestation = client.post(
            "/api/projects/import/preview",
            json={k: v for k, v in body.items() if k != "public_authorized_non_sensitive"},
            headers=headers,
        )
        assert missing_attestation.status_code == 422
        assert missing_attestation.json()["detail"] == "PUBLIC_AUTHORIZED_ATTESTATION_REQUIRED"
        ordinary_without_attestation = client.post(
            "/api/projects",
            json={k: v for k, v in body.items() if k != "public_authorized_non_sensitive"},
            headers={**headers, "Origin": "http://127.0.0.1:5173"},
        )
        assert ordinary_without_attestation.status_code == 422
        preview = client.post("/api/projects/import/preview", json=body, headers=headers)
        assert preview.status_code == 200
        assert preview.json()["writes_performed"] is False
        assert sorted(path.relative_to(storage) for path in storage.rglob("*")) == before

        contextual = json.loads(body["bundle_json"])
        contextual["context"] = {
            "asset": "synthetic",
            "indication": "synthetic",
            "study": "NCT00000000",
            "question": "synthetic",
            "receiptId": "legacy-receipt",
        }
        unsupported = client.post(
            "/api/projects/import/preview",
            json={**body, "bundle_json": json.dumps(contextual)},
            headers=headers,
        )
        assert unsupported.status_code == 422
        assert unsupported.json()["detail"] == "LEGACY_CONTEXT_RELINK_REQUIRED"
        assert sorted(path.relative_to(storage) for path in storage.rglob("*")) == before


def test_context_detach_import_preserves_original_and_uses_sanitized_working_bundle(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    body = contextual_import_payload()
    original_bundle = body["bundle_json"]
    original_pdf = base64.b64decode(body["pdf_base64"])
    source_bundle = tmp_path / "selected-bundle.json"
    source_pdf = tmp_path / "selected-source.pdf"
    source_bundle.write_text(original_bundle)
    source_pdf.write_bytes(original_pdf)
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client).json()
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf(client)}
        before = sorted(path.relative_to(storage) for path in storage.rglob("*"))
        without_ack = client.post("/api/projects/import/preview", json=body, headers=headers)
        assert without_ack.status_code == 422
        assert without_ack.json()["detail"] == "LEGACY_CONTEXT_RELINK_REQUIRED"
        assert client.post(
            "/api/projects/import/preview",
            json={**body, "context_detachment_acknowledged": False},
            headers=headers,
        ).status_code == 422
        assert client.post(
            "/api/projects/import/preview",
            json={**body, "detached_provenance": {"forged": True}},
            headers=headers,
        ).status_code == 422
        malformed = json.loads(body["bundle_json"])
        malformed["context"]["authorization"] = "forged"
        assert client.post(
            "/api/projects/import/preview",
            json={
                **body,
                "bundle_json": json.dumps(malformed),
                "context_detachment_acknowledged": True,
            },
            headers=headers,
        ).status_code == 422

        acknowledged = {**body, "context_detachment_acknowledged": True}
        preview = client.post(
            "/api/projects/import/preview", json=acknowledged, headers=headers
        )
        assert preview.status_code == 200, preview.text
        inspected = preview.json()
        assert inspected["writes_performed"] is False
        assert inspected["context_detached"] is True
        assert inspected["original_bundle_digest"] == hashlib.sha256(
            original_bundle.encode()
        ).hexdigest()
        assert inspected["original_bundle_digest"] != inspected["working_bundle_digest"]
        assert inspected["original_context"] == json.loads(original_bundle)["context"]
        assert inspected["current_team_links_verified"] is False
        assert inspected["model_run_performed"] is False
        assert sorted(path.relative_to(storage) for path in storage.rglob("*")) == before

        no_preview = client.post(
            "/api/projects/import/commit",
            json={**acknowledged, "confirmation": True},
            headers=headers,
        )
        assert no_preview.status_code == 422
        assert no_preview.json()["detail"] == "IMPORT_PREVIEW_REQUIRED"
        stale = client.post(
            "/api/projects/import/commit",
            json={
                **acknowledged,
                "title": "Changed after preview",
                "confirmation": True,
                "import_preview_digest": inspected["import_preview_digest"],
            },
            headers=headers,
        )
        assert stale.status_code == 422
        assert stale.json()["detail"] == "IMPORT_PREVIEW_REQUIRED"

        committed = client.post(
            "/api/projects/import/commit",
            json={
                **acknowledged,
                "confirmation": True,
                "import_preview_digest": inspected["import_preview_digest"],
            },
            headers=headers,
        )
        assert committed.status_code == 200, committed.text
        saved = committed.json()
        record = client.get(f"/api/projects/{saved['project_id']}/1").json()
        working = json.loads(record["bundle_json"])
        original = json.loads(original_bundle)
        assert working["context"] is None
        for key in ("reviewRaw", "draftRaw", "meetingRaw", "agentRaw"):
            assert working[key] == original[key]
        assert record["bundle_digest"] == inspected["working_bundle_digest"]
        assert "foreign-legacy" not in json.dumps(record)
        history_response = client.get("/api/projects")
        assert "foreign-legacy" not in history_response.text
        assert inspected["original_bundle_digest"] not in history_response.text
        provenance = client.get(
            f"/api/projects/{saved['project_id']}/1/provenance"
        ).json()["provenance"]
        assert provenance["original_bundle_digest"] == inspected["original_bundle_digest"]
        assert provenance["original_context"] == original["context"]
        assert provenance["imported_by"] == {
            "subject_id": session["subject"]["id"], "username": "admin"
        }
        assert provenance["history_authentication"] == "imported_non_authenticated_history"
        assert set(provenance["nested_history"].values()) == {
            "imported_non_authenticated_history"
        }
        team_id = client.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"
        with sqlite3.connect(database) as con:
            stored = con.execute(
                """SELECT original_bundle_json,original_context_json,working_bundle_digest
                FROM team_import_provenance WHERE project_id=?""",
                (saved["project_id"],),
            ).fetchone()
        assert stored[0] == original_bundle
        assert json.loads(stored[1]) == original["context"]
        assert stored[2] == inspected["working_bundle_digest"]
        assert source_bundle.read_text() == original_bundle
        assert source_pdf.read_bytes() == original_pdf

        repeat_original = client.post(
            "/api/projects/import/commit",
            json={
                **acknowledged,
                "confirmation": True,
                "import_preview_digest": inspected["import_preview_digest"],
            },
            headers=headers,
        )
        assert repeat_original.status_code == 409
        reformatted = {**acknowledged, "bundle_json": json.dumps(original)}
        reformatted_preview = client.post(
            "/api/projects/import/preview", json=reformatted, headers=headers
        ).json()
        assert reformatted_preview["duplicate"]["project_id"] == saved["project_id"]
        assert len(client.get("/api/projects").json()) == 1

        forged_generic = client.post(
            "/api/projects",
            json={**collaboration_payload(), "provenance": {"forged": True}},
            headers={**headers, "Origin": "http://127.0.0.1:5173"},
        )
        assert forged_generic.status_code == 422


def test_concurrent_context_detach_import_has_one_project_and_one_provenance(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    body = {**contextual_import_payload(), "context_detachment_acknowledged": True}
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf(client)}
        preview = client.post("/api/projects/import/preview", json=body, headers=headers).json()
        commit_body = {
            **body, "confirmation": True,
            "import_preview_digest": preview["import_preview_digest"],
        }

        def commit(_):
            return client.post(
                "/api/projects/import/commit", json=commit_body, headers=headers
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(commit, range(2))) == [200, 409]
        team_id = client.get("/api/teams/current").json()["id"]
        with sqlite3.connect(storage / team_id / "evidence.sqlite3") as con:
            assert con.execute("SELECT COUNT(*) FROM project_checkpoints").fetchone()[0] == 1
            assert con.execute("SELECT COUNT(*) FROM team_import_provenance").fetchone()[0] == 1


def test_existing_team_import_preview_is_byte_for_byte_read_only(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    body = collaboration_payload()
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf(client)}
        committed = client.post(
            "/api/projects/import/commit",
            json={**body, "confirmation": True,
                  "import_preview_digest": client.post(
                      "/api/projects/import/preview", json=body, headers=headers
                  ).json()["import_preview_digest"]},
            headers=headers,
        )
        assert committed.status_code == 200
        team_id = client.get("/api/teams/current").json()["id"]
        assert client.get(
            f"/api/projects/{committed.json()['project_id']}/1/provenance"
        ).json()["provenance"] is None
        database = storage / team_id / "evidence.sqlite3"
        before = database.read_bytes()
        with sqlite3.connect(database) as con:
            tables_before = con.execute(
                "SELECT name,sql FROM sqlite_master ORDER BY name"
            ).fetchall()
        preview = client.post("/api/projects/import/preview", json=body, headers=headers)
        assert preview.status_code == 200
        assert preview.json()["duplicate"]["project_id"] == committed.json()["project_id"]
        assert database.read_bytes() == before
        with sqlite3.connect(database) as con:
            tables_after = con.execute(
                "SELECT name,sql FROM sqlite_master ORDER BY name"
            ).fetchall()
        assert tables_after == tables_before


def test_import_requires_json_true_without_boolean_coercion(tmp_path):
    app, _, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    body = collaboration_payload()
    non_true_values = [1, 1.0, "true", "1", False, 0, 0.0, "false", "0", [], {}]
    fields = (
        "consent",
        "public_authorized_non_sensitive",
        "confirmation",
        "context_detachment_acknowledged",
    )
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        request_headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf(client)}
        exact_true = {
            **body,
            "confirmation": True,
            "context_detachment_acknowledged": True,
        }
        for field in fields:
            for value in non_true_values:
                assert client.post(
                    "/api/projects/import/preview",
                    json={**exact_true, field: value},
                    headers=request_headers,
                ).status_code == 422

        preview = client.post(
            "/api/projects/import/preview", json=exact_true, headers=request_headers
        )
        assert preview.status_code == 200, preview.text
        commit_body = {
            **exact_true, "import_preview_digest": preview.json()["import_preview_digest"]
        }
        for field in fields:
            for value in non_true_values:
                assert client.post(
                    "/api/projects/import/commit",
                    json={**commit_body, field: value},
                    headers=request_headers,
                ).status_code == 422

        committed = client.post(
            "/api/projects/import/commit", json=commit_body, headers=request_headers
        )
        assert committed.status_code == 200, committed.text


def test_concurrent_identical_team_import_is_atomic_and_unique(tmp_path):
    app, _, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    body = collaboration_payload()
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf(client)}
        preview_digest = client.post(
            "/api/projects/import/preview", json=body, headers=headers
        ).json()["import_preview_digest"]

        def commit(_):
            return client.post(
                "/api/projects/import/commit",
                json={**body, "confirmation": True,
                      "import_preview_digest": preview_digest},
                headers=headers,
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(commit, range(2)))
        assert sorted(statuses) == [200, 409]
        assert len(client.get("/api/projects").json()) == 1


def test_failed_import_rolls_back_all_product_artifacts(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    body = collaboration_payload()
    with TestClient(app, base_url=ORIGIN, raise_server_exceptions=False) as client:
        assert login(client).status_code == 200
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf(client)}
        first_preview = client.post(
            "/api/projects/import/preview", json=body, headers=headers
        ).json()["import_preview_digest"]
        first = client.post(
            "/api/projects/import/commit",
            json={**body, "confirmation": True, "import_preview_digest": first_preview},
            headers=headers,
        )
        assert first.status_code == 200
        team_id = client.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"
        changed_body = {**body, "bundle_json": body["bundle_json"] + " "}
        changed_preview = client.post(
            "/api/projects/import/preview", json=changed_body, headers=headers
        ).json()["import_preview_digest"]
        with sqlite3.connect(database) as con:
            before = {
                table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in (
                    "project_pdfs",
                    "project_checkpoints",
                    "team_project_registry",
                    "team_import_registry",
                    "team_project_attestations",
                    "project_usage_policy_versions",
                    "project_usage_policy_heads",
                )
            }
            con.execute(
                "CREATE TRIGGER reject_next_team_registry BEFORE INSERT ON team_project_registry "
                "BEGIN SELECT RAISE(ABORT, 'synthetic crash'); END"
            )
        failed = client.post(
            "/api/projects/import/commit",
            json={**changed_body, "confirmation": True,
                  "import_preview_digest": changed_preview},
            headers=headers,
        )
        assert failed.status_code == 500
        with sqlite3.connect(database) as con:
            after = {
                table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in before
            }
        assert after == before


def test_review_event_rejects_whitespace_without_new_revision(tmp_path):
    app, _, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    body = collaboration_payload()
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf(client)}
        preview_digest = client.post(
            "/api/projects/import/preview", json=body, headers=headers
        ).json()["import_preview_digest"]
        saved = client.post(
            "/api/projects/import/commit",
            json={**body, "confirmation": True,
                  "import_preview_digest": preview_digest},
            headers=headers,
        ).json()
        url = f"/api/projects/{saved['project_id']}/1/events"
        response = client.post(
            url,
            json={
                "expected_revision": 0,
                "kind": "note",
                "text": " \n\t ",
                "base_document_revision": 1,
            },
            headers=headers,
        )
        assert response.status_code == 422
        assert client.get(url).json()["event_revision"] == 0


def test_all_enabled_api_families_are_unauthenticated_and_viewer_write_denied(tmp_path):
    app, identity_db, _ = make_team_app(
        tmp_path,
        enable_designs=True,
        enable_agent_demo=True,
        enable_pdf_agent=True,
        enable_evidence_scout=True,
    )
    paths = [
        "/api/reviews/defaults",
        "/api/design-comparisons/capabilities",
        "/api/design-proposals/capabilities",
        "/api/agent-demo/capabilities",
        "/api/evidence-scout/capabilities",
        "/api/evidence-scout/searches",
        "/api/research/runs",
        "/api/projects",
        f"/api/research/runs/{uuid4()}/automation",
        f"/api/research/runs/{uuid4()}/exploration",
    ]
    writes = [
        "/api/reviews",
        "/api/design-comparisons",
        "/api/design-proposals",
        "/api/agent-demo/run",
        "/api/pdf-agent/run",
        "/api/evidence-scout/search",
        "/api/research/run",
        "/api/projects",
        f"/api/research/runs/{uuid4()}/recover",
        f"/api/research/runs/{uuid4()}/curation",
        f"/api/research/runs/{uuid4()}/documents/source",
        f"/api/research/runs/{uuid4()}/automation",
        f"/api/research/runs/{uuid4()}/automation/run",
        f"/api/research/runs/{uuid4()}/exploration",
    ]
    with TestClient(app, base_url=ORIGIN) as client:
        assert all(client.get(path).status_code == 401 for path in paths)
        assert login(client).status_code == 200
        with sqlite3.connect(identity_db) as con:
            con.execute("UPDATE memberships SET role='viewer',permission_epoch=2")
        token = csrf(client)
        headers = {"Origin": ORIGIN, "X-CSRF-Token": token}
        assert all(
            client.post(path, json={}, headers=headers).status_code == 403 for path in writes
        )


def test_team_storage_isolation_ignores_spoofed_headers(tmp_path):
    app, identity_db, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with sqlite3.connect(identity_db) as con:
        first = con.execute(
            "SELECT id,password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users"
        ).fetchone()
        team_a = con.execute("SELECT id FROM teams").fetchone()[0]
        user_b, team_b, member_b = str(uuid4()), str(uuid4()), str(uuid4())
        con.execute("INSERT INTO teams VALUES (?,?)", (team_b, "Beta"))
        con.execute(
            "INSERT INTO users VALUES (?,?,?,?,?,?,?,0)",
            (user_b, "beta", first[1], first[2], first[3], first[4], first[5]),
        )
        con.execute(
            "INSERT INTO memberships VALUES (?,?,?,?,1,1)",
            (member_b, user_b, team_b, "admin"),
        )
    for team, query in ((team_a, "alpha"), (team_b, "beta")):
        (storage / team).mkdir(mode=0o700)
        EvidenceStore(storage / team / "evidence.sqlite3").save(
            query, {"totalCount": 0, "studies": []}, []
        )
    with TestClient(app, base_url=ORIGIN) as alpha:
        assert login(alpha).status_code == 200
        rows = alpha.get(
            "/api/evidence-scout/searches", headers={"X-Team": team_b, "X-Role": "admin"}
        ).json()
        assert [row["query"] for row in rows] == ["alpha"]
    with TestClient(app, base_url=ORIGIN) as beta:
        assert login(beta, "beta").status_code == 200
        assert [row["query"] for row in beta.get("/api/evidence-scout/searches").json()] == ["beta"]


def test_route_inventory_fails_for_new_unclassified_method():
    app = FastAPI()

    @app.patch("/api/future")
    def future():
        return None

    with pytest.raises(RuntimeError, match="PATCH /api/future"):
        assert_route_policy_complete(app.routes)
    assert ("POST", "/api/reviews") in PROTECTED_PATHS


def test_random_session_token_hash_cannot_authenticate(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path)
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        with sqlite3.connect(identity_db) as con:
            stored = con.execute("SELECT token_hash FROM sessions").fetchone()[0]
        client.cookies.set(SESSION_COOKIE, bytes(stored).hex())
        assert client.get("/api/auth/session").status_code == 401
        client.cookies.set(SESSION_COOKIE, secrets_token := "x" * 64)
        assert secrets_token.encode() not in bytes(stored)
        assert client.get("/api/auth/session").status_code == 401


def test_malformed_tokens_fail_closed_and_csrf_tokens_do_not_invalidate_other_tabs(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path)
    with TestClient(app, base_url=ORIGIN, raise_server_exceptions=False) as client:
        assert (
            client.get(
                "/api/auth/session", headers=[(b"cookie", SESSION_COOKIE.encode() + b"=\xff")]
            ).status_code
            == 401
        )
        client.get("/api/auth/login-challenge")
        assert (
            client.post(
                "/api/auth/login",
                json={"username": "admin", "password": PASSWORD},
                headers=[(b"origin", ORIGIN.encode()), (b"x-csrf-token", b"\xff")],
            ).status_code
            == 401
        )
        assert login(client).status_code == 200
        first, second = csrf(client), csrf(client)
        for token in (first, second):
            assert (
                client.post(
                    "/api/reviews",
                    json={"repetitions": 100},
                    headers={"Origin": ORIGIN, "X-CSRF-Token": token},
                ).status_code
                == 200
            )
        with sqlite3.connect(identity_db) as con:
            stored_csrf = bytes(
                con.execute("SELECT token_hash FROM session_csrf_tokens LIMIT 1").fetchone()[0]
            ).hex()
        assert (
            client.post(
                "/api/reviews",
                json={"repetitions": 100},
                headers={"Origin": ORIGIN, "X-CSRF-Token": stored_csrf},
            ).status_code
            == 403
        )


def test_failed_password_consumes_challenge_and_expiry_uses_fake_clock(tmp_path):
    identity_path = tmp_path / "identity.sqlite3"
    bootstrap_identity_database(identity_path, username="admin", password=PASSWORD, team_name="A")
    clock = [1000]
    identity = TeamIdentity(identity_path, now=lambda: clock[0])
    challenge, proof = identity.challenge()
    with pytest.raises(ValueError, match="LOGIN_FAILED"):
        identity.login("admin", "wrong", challenge, proof)
    with pytest.raises(ValueError, match="LOGIN_CSRF_INVALID"):
        identity.login("admin", PASSWORD, challenge, proof)
    challenge, proof = identity.challenge()
    token, scope = identity.login("admin", PASSWORD, challenge, proof)
    assert identity.authenticate(token) is not None
    clock[0] = scope.idle_expires_at
    assert identity.authenticate(token) is None
    challenge, proof = identity.challenge()
    token, scope = identity.login("admin", PASSWORD, challenge, proof)
    while clock[0] + 1700 < scope.absolute_expires_at:
        clock[0] += 1700
        assert identity.authenticate(token) is not None
    clock[0] = scope.absolute_expires_at
    assert identity.authenticate(token) is None


def test_bootstrap_atomic_and_storage_topology_rejects_aliases(tmp_path):
    path = tmp_path / "identity.sqlite3"

    def create():
        try:
            bootstrap_identity_database(path, username="admin", password=PASSWORD, team_name="A")
            return True
        except ValueError:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: create(), range(2))) == [False, True]
    assert path.stat().st_mode & 0o777 == 0o600

    invalid = tmp_path / "invalid-password.sqlite3"
    with pytest.raises(ValueError, match="PASSWORD"):
        bootstrap_identity_database(invalid, username="admin", password="", team_name="A")
    assert not invalid.exists()

    identity = TeamIdentity(path)
    path.unlink()
    with pytest.raises(RuntimeError, match="IDENTITY_PATH"):
        identity.connect()
    assert not path.exists()

    bootstrap_identity_database(path, username="admin", password=PASSWORD, team_name="A")
    root = tmp_path / "teams"
    root.mkdir(mode=0o700)
    with pytest.raises(ValueError, match="SEPARATE"):
        validate_team_configuration(path, root, root / "legacy.sqlite3")
    linked = tmp_path / "linked-teams"
    linked.symlink_to(root, target_is_directory=True)
    with pytest.raises(ValueError, match="STORAGE_ROOT"):
        validate_team_configuration(path, linked, tmp_path / "legacy.sqlite3")
    team_dir = root / str(uuid4())
    team_dir.mkdir(mode=0o700)
    target = tmp_path / "target.sqlite3"
    target.touch()
    (team_dir / "evidence.sqlite3").symlink_to(target)
    with pytest.raises(ValueError, match="STORAGE_PATH"):
        validate_team_configuration(path, root, tmp_path / "legacy.sqlite3")


def test_login_limiter_has_bounded_nonclearing_ip_budget():
    clock = [0.0]
    limiter = LoginLimiter(now=lambda: clock[0])
    assert [limiter.allow("ip") for _ in range(6)] == [True] * 5 + [False]
    for index in range(3000):
        limiter.allow(f"random-{index}")
    assert len(limiter.attempts) <= 2048
    assert limiter.allow("ip") is False
    clock[0] = 61
    assert limiter.allow("ip") is True


def _seed_team_families(path: Path, label: str) -> tuple[str, str, str]:
    receipt = EvidenceStore(path).save(label, {"totalCount": 0, "studies": []}, [])
    run_id = str(uuid4())
    source_id = f"source_{label}"
    raw_pdf = b"%PDF-1.4\nsynthetic\n"
    pdf_digest = hashlib.sha256(raw_pdf).hexdigest()
    run = Collection(
        id=run_id,
        project_id=label * 64,
        created_at="2026-09-30T00:00:00Z",
        request=ResearchRequest(
            search_id=receipt["id"],
            nct_id="NCT00000001",
            asset="MOC drug",
            indication="MOC tumor",
            public_consent=True,
        ),
        status="PARTIAL",
        sources=[
            Source(
                id=source_id,
                kind="SAP",
                title=label,
                url="https://clinicaltrials.gov/study/NCT00000001",
                text="MOC",
                content_level="PDF_AVAILABLE",
                link_basis=["REGISTRY_DOCUMENT"],
                identifiers={"nct": "NCT00000001"},
                fetched_at="2026-09-30T00:00:00Z",
                digest=hashlib.sha256(label.encode()).hexdigest(),
                pdf_url="https://cdn.clinicaltrials.gov/moc.pdf",
            )
        ],
        coverage=[],
        events=[],
    )
    ResearchStore(path).save_run(run)
    project_id = str(uuid4())
    bundle = json.dumps({"team": label})
    bundle_digest = hashlib.sha256(bundle.encode()).hexdigest()
    with ProjectStore(path, collaboration=True).connect() as con:
        con.execute("INSERT INTO project_pdfs VALUES (?,?)", (pdf_digest, raw_pdf))
        con.execute(
            "INSERT INTO project_checkpoints VALUES (?,?,?,?,?,?,?)",
            (project_id, 1, label, "2026-09-30T00:00:00Z", pdf_digest, bundle_digest, bundle),
        )
        con.execute(
            "INSERT INTO team_project_registry VALUES (?,?,?,?,?,?,?)",
            (project_id, f"user-{label}", label, f"{label}.pdf", "synthetic_fixture", 1,
             "team_wide"),
        )
    automation = {
        "schema": "research-automation/1",
        "runId": run_id,
        "status": "PREPARED",
        "team": label,
        "document": {"sourceId": source_id, "source": {"sha256": pdf_digest}},
    }
    with AutomationStore(path).connect() as con:
        con.execute(
            "INSERT INTO research_automation VALUES (?,?,?,?)",
            (run_id, label, "PREPARED", json.dumps(automation)),
        )
        con.execute(
            "CREATE TABLE IF NOT EXISTS public_pdf_blobs (digest TEXT PRIMARY KEY,content BLOB)"
        )
        con.execute(
            "CREATE TABLE IF NOT EXISTS public_pdf_receipts "
            "(run_id TEXT,source_id TEXT,digest TEXT)"
        )
        con.execute("INSERT INTO public_pdf_blobs VALUES (?,?)", (pdf_digest, raw_pdf))
        con.execute(
            "INSERT INTO public_pdf_receipts VALUES (?,?,?)", (run_id, source_id, pdf_digest)
        )
    exploration = {"runId": run_id, "team": label}
    with ExplorationStore(path).connect() as con:
        con.execute(
            "INSERT INTO research_exploration VALUES (?,?,?)",
            (run_id, sha256_json(exploration), json.dumps(exploration)),
        )
    return run_id, source_id, project_id


def _allow_synthetic_source_storage(client, run_id):
    base = f"/api/research/runs/{run_id}"
    assert client.get(base).status_code == 403
    sources = client.get(base + "/source-metadata").json()["sources"]
    for source in sources:
        response = client.post(
            base + f"/sources/{source['source_id']}/usage-policy",
            json={
                "source_digest": source["source_digest"], "expected_policy_revision": 0,
                "original_storage": "ALLOW", "internal_search": "UNKNOWN",
                "external_ai": "UNKNOWN", "training": "DENY",
                "evidence_reference": "Synthetic temporary test fixture",
                "reason": "Explicit fixture authorization for storage-isolation checks.",
            },
            headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": csrf(client)},
        )
        assert response.status_code == 200, response.text


def _allow_synthetic_pdf_storage(client, run_id):
    base = f"/api/research/runs/{run_id}"
    for source in client.get(base + "/pdf-metadata").json()["sources"]:
        for version in source["cached_versions"]:
            response = client.post(
                base + f"/documents/{source['source_id']}/usage-policy",
                json={"source_digest": source["source_digest"],
                      "pdf_sha256": version["pdf_sha256"], "expected_policy_revision": 0,
                      "original_storage": "ALLOW", "internal_search": "UNKNOWN",
                      "external_ai": "UNKNOWN", "training": "UNKNOWN",
                      "evidence_reference": "Synthetic PDF fixture only",
                      "reason": "Separate PDF_BYTES storage permission for isolation checks."},
                headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": csrf(client)},
            )
            assert response.status_code == 200, response.text


def test_seeded_two_team_resources_are_isolated_across_all_storage_families(tmp_path):
    app, identity_db, storage = make_team_app(
        tmp_path, enable_evidence_scout=True, enable_designs=True, enable_pdf_agent=True
    )
    with sqlite3.connect(identity_db) as con:
        first = con.execute(
            "SELECT password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users"
        ).fetchone()
        team_a = con.execute("SELECT id FROM teams").fetchone()[0]
        user_b, team_b, member_b = str(uuid4()), str(uuid4()), str(uuid4())
        con.execute("INSERT INTO teams VALUES (?,?)", (team_b, "Beta"))
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,0)", (user_b, "beta", *first))
        con.execute(
            "INSERT INTO memberships VALUES (?,?,?,?,1,1)", (member_b, user_b, team_b, "admin")
        )
    resources = {}
    for team, label in ((team_a, "a"), (team_b, "b")):
        directory = storage / team
        directory.mkdir(mode=0o700)
        resources[label] = _seed_team_families(directory / "evidence.sqlite3", label)
    with TestClient(app, base_url=ORIGIN) as alpha:
        assert login(alpha).status_code == 200
        own_run, own_source, own_project = resources["a"]
        other_run, other_source, other_project = resources["b"]
        _allow_synthetic_source_storage(alpha, own_run)
        _allow_synthetic_pdf_storage(alpha, own_run)
        assert [item["query"] for item in alpha.get("/api/evidence-scout/searches").json()] == ["a"]
        assert [item["id"] for item in alpha.get("/api/research/runs").json()] == [own_run]
        assert alpha.get(f"/api/research/runs/{own_run}").status_code == 200
        assert alpha.get(f"/api/projects/{own_project}/1").status_code == 403
        own_policy = alpha.get(f"/api/projects/{own_project}/usage-policy")
        assert own_policy.status_code == 200
        assert own_policy.json()["current"]["original_storage"] == "UNKNOWN"
        assert alpha.get(f"/api/research/runs/{own_run}/automation").json()["team"] == "a"
        assert alpha.get(f"/api/research/runs/{own_run}/exploration").json()["team"] == "a"
        assert (
            alpha.get(
                f"/api/research/runs/{own_run}/documents/{own_source}/cached?sha256={hashlib.sha256(b'%PDF-1.4\nsynthetic\n').hexdigest()}"
            ).status_code
            == 200
        )
        for url in (
            f"/api/research/runs/{other_run}",
            f"/api/research/runs/{other_run}/source-metadata",
            f"/api/research/runs/{other_run}/review-usage",
            f"/api/research/runs/{other_run}/sources/{other_source}/usage-policy",
            f"/api/projects/{other_project}/1",
            f"/api/projects/{other_project}/1/events",
            f"/api/projects/{other_project}/usage-policy",
            f"/api/research/runs/{other_run}/automation",
            f"/api/research/runs/{other_run}/exploration",
            f"/api/research/runs/{other_run}/documents/{other_source}/cached?sha256={'0' * 64}",
        ):
            assert alpha.get(url, headers={"X-Team": team_b, "X-Role": "admin"}).status_code == 404
    with pytest.raises(RuntimeError, match="TEAM_CONTEXT_REQUIRED"):
        TeamDataPath(storage).resolve()


def test_team_reads_and_unrelated_preparation_never_interrupt_live_automation(tmp_path):
    app, identity_db, storage = make_team_app(
        tmp_path, enable_evidence_scout=True, enable_pdf_agent=True
    )
    with sqlite3.connect(identity_db) as con:
        team_id = con.execute("SELECT id FROM teams").fetchone()[0]
    directory = storage / team_id
    directory.mkdir(mode=0o700)
    run_id, _, _ = _seed_team_families(directory / "evidence.sqlite3", "live")
    store = AutomationStore(directory / "evidence.sqlite3")
    store.transition(run_id, "PREPARED", "RUNNING")

    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        _allow_synthetic_source_storage(client, run_id)
        _allow_synthetic_pdf_storage(client, run_id)
        assert client.get(f"/api/research/runs/{run_id}/automation").json()["status"] == "RUNNING"
        response = client.post(
            f"/api/research/runs/{uuid4()}/automation",
            json={"document": {}, "consent": True},
            headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": csrf(client)},
        )
        assert response.status_code == 404  # Missing run is rejected before artifact preparation.
        assert store.get(run_id)["status"] == "RUNNING"

        with sqlite3.connect(identity_db) as con:
            con.execute("UPDATE memberships SET role='viewer'")
        assert client.get(f"/api/research/runs/{run_id}/automation").json()["status"] == "RUNNING"


def test_browser_session_context_fence_rejects_cookie_identity_change(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path)
    with sqlite3.connect(identity_db) as con:
        first = con.execute(
            "SELECT password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users"
        ).fetchone()
        team_b, user_b, member_b = str(uuid4()), str(uuid4()), str(uuid4())
        con.execute("INSERT INTO teams VALUES (?,?)", (team_b, "Beta"))
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,0)", (user_b, "beta", *first))
        con.execute(
            "INSERT INTO memberships VALUES (?,?,?,?,1,1)", (member_b, user_b, team_b, "admin")
        )
    with TestClient(app, base_url=ORIGIN) as client:
        alpha = login(client).json()
        old_context = alpha["session_context"]
        assert client.get(
            "/api/reviews/defaults",
            headers={"X-TrialBoard-Session-Context": old_context},
        ).status_code == 200

        assert login(client, "beta").status_code == 200
        mismatch = client.get(
            "/api/reviews/defaults",
            headers={"X-TrialBoard-Session-Context": old_context},
        )
        assert mismatch.status_code == 409
        assert mismatch.json()["error"]["code"] == "SESSION_CONTEXT_MISMATCH"
        assert mismatch.headers["X-TrialBoard-Error-Code"] == "SESSION_CONTEXT_MISMATCH"


def test_authenticated_non_ascii_session_context_is_mismatch_not_server_error(tmp_path):
    app, _, _ = make_team_app(tmp_path)
    with TestClient(app, base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        del client.headers["X-TrialBoard-Session-Context"]
        response = client.get(
            "/api/reviews/defaults",
            headers=[(b"X-TrialBoard-Session-Context", b"\xff")],
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "SESSION_CONTEXT_MISMATCH"


def test_same_user_reauthentication_keeps_browser_context_valid(tmp_path):
    app, _, _ = make_team_app(tmp_path)
    with TestClient(app, base_url=ORIGIN) as client:
        first = login(client).json()
        second = login(client).json()
        assert second["session_context"] == first["session_context"]
        assert client.get(
            "/api/reviews/defaults",
            headers={"X-TrialBoard-Session-Context": first["session_context"]},
        ).status_code == 200
