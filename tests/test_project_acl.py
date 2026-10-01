"""Synthetic TEAM project ACL boundary tests; no actual identity or user data."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi.testclient import TestClient
from test_team_auth import (
    ORIGIN,
    PASSWORD,
    collaboration_payload,
    contextual_import_payload,
    csrf,
    login,
    make_team_app,
)

from trialboard.api.team_auth import SESSION_COOKIE
from trialboard.api.team_members import add_member, change_member


def headers(client):
    return {"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": csrf(client)}


def members(client):
    response = client.get("/api/teams/current/members")
    assert response.status_code == 200
    return {member["username"]: member for member in response.json()["members"]}


def create_restricted(client, grants=()):
    directory = members(client)
    body = {
        **collaboration_payload(),
        "title": "Restricted synthetic document",
        "sharing_scope": "restricted",
        "access_members": [
            {"subject_id": directory[username]["id"], "access": access}
            for username, access in grants
        ],
    }
    response = client.post("/api/projects", json=body, headers=headers(client))
    assert response.status_code == 200, response.text
    return response.json(), body


def test_restricted_acl_enforces_list_blob_events_save_role_ceiling_and_revoke(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    add_member(identity_db, username="bob", password=PASSWORD, role="reviewer")
    add_member(identity_db, username="viewer", password=PASSWORD, role="viewer")
    add_member(identity_db, username="outsider", password=PASSWORD, role="reviewer")
    add_member(identity_db, username="admin2", password=PASSWORD, role="admin")

    with TestClient(app, base_url=ORIGIN) as alice:
        alice_session = login(alice).json()
        saved, body = create_restricted(alice, (("bob", "write"), ("viewer", "write")))
        pid = saved["project_id"]
        access = alice.get(f"/api/projects/{pid}/access").json()
        assert access["management_source"] == "team_admin_override"
        assert access["download_revoke_limitation"] is True
        assert {row["username"] for row in access["members"]} == {"admin", "bob", "viewer"}

    with TestClient(app, base_url=ORIGIN) as bob:
        bob_session = login(bob, "bob").json()
        assert any(row["project_id"] == pid for row in bob.get("/api/projects").json())
        record = bob.get(f"/api/projects/{pid}/1")
        assert record.status_code == 200
        assert record.json()["sharing_scope"] == "restricted"
        assert "pdf_base64" in record.json() and "bundle_json" in record.json()
        assert bob.get(f"/api/projects/{pid}/1/events").status_code == 200
        revision_body = {
            key: value
            for key, value in body.items()
            if key not in {"sharing_scope", "access_members"}
        }
        revised = bob.post(
            "/api/projects",
            json={**revision_body, "project_id": pid, "expected_revision": 1},
            headers=headers(bob),
        )
        assert revised.status_code == 200
        event = bob.post(
            f"/api/projects/{pid}/2/events",
            json={
                "expected_revision": 0,
                "kind": "note",
                "text": "Bob review",
                "base_document_revision": 2,
            },
            headers=headers(bob),
        )
        assert event.status_code == 200
        bob_cookie = bob.cookies.get(SESSION_COOKIE)

    with TestClient(app, base_url=ORIGIN) as viewer:
        login(viewer, "viewer")
        assert viewer.get(f"/api/projects/{pid}/2").status_code == 200
        assert viewer.post(
            f"/api/projects/{pid}/2/events",
            json={
                "expected_revision": 1,
                "kind": "note",
                "text": "forged write",
                "base_document_revision": 2,
            },
            headers=headers(viewer),
        ).status_code == 403

    with TestClient(app, base_url=ORIGIN) as outsider:
        login(outsider, "outsider")
        assert all(row["project_id"] != pid for row in outsider.get("/api/projects").json())
        assert outsider.get(f"/api/projects/{pid}/2").status_code == 404
        assert outsider.get(f"/api/projects/{pid}/2/events").status_code == 404
        preview = outsider.post(
            "/api/projects/import/preview",
            json={**collaboration_payload(), "sharing_scope": "team_wide"},
            headers=headers(outsider),
        )
        assert preview.status_code == 200
        assert preview.json()["duplicate"] is None
        assert preview.json()["duplicate_conflict"] is True
        assert pid not in preview.text and saved["title"] not in preview.text
        assert outsider.post(
            "/api/projects/import/commit",
            json={
                    **collaboration_payload(),
                    "sharing_scope": "team_wide",
                    "confirmation": True,
                    "import_preview_digest": preview.json()["import_preview_digest"],
                },
            headers=headers(outsider),
        ).status_code == 409
        assert outsider.post(
            f"/api/projects/{pid}/access",
            json={"expected_acl_revision": 1, "sharing_scope": "team_wide", "members": []},
            headers=headers(outsider),
        ).status_code == 404

    with TestClient(app, base_url=ORIGIN) as admin2:
        login(admin2, "admin2")
        assert admin2.get(f"/api/projects/{pid}/2").json()["access_source"] == "team_admin_override"
        current = admin2.get(f"/api/projects/{pid}/access").json()
        owner_row = next(
            row
            for row in current["members"]
            if row["subject_id"] == alice_session["subject"]["id"]
        )
        owner = {"subject_id": owner_row["subject_id"], "access": "owner"}
        update = admin2.post(
            f"/api/projects/{pid}/access",
            json={
                "expected_acl_revision": current["acl_revision"],
                "sharing_scope": "restricted",
                "members": [owner],
            },
            headers=headers(admin2),
        )
        assert update.status_code == 200

    with TestClient(app, base_url=ORIGIN) as bob:
        bob.cookies.set(SESSION_COOKIE, bob_cookie)
        bob.headers["X-TrialBoard-Session-Context"] = bob_session["session_context"]
        assert bob.get(f"/api/projects/{pid}/2").status_code == 404
        assert bob.get(f"/api/projects/{pid}/2/events").status_code == 404


def test_acl_validation_concurrency_last_owner_fork_and_legacy_teamwide(tmp_path):
    app, identity_db, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    add_member(identity_db, username="bob", password=PASSWORD, role="reviewer")
    with TestClient(app, base_url=ORIGIN) as alice:
        login(alice)
        saved, body = create_restricted(alice, (("bob", "write"),))
        pid = saved["project_id"]
        current = alice.get(f"/api/projects/{pid}/access").json()
        owner_row = next(row for row in current["members"] if row["access"] == "owner")
        owner = {"subject_id": owner_row["subject_id"], "access": "owner"}
        bad_subject = str(uuid4())
        invalid = alice.post(
            f"/api/projects/{pid}/access",
            json={
                "expected_acl_revision": 1,
                "sharing_scope": "restricted",
                "members": [{"subject_id": bad_subject, "access": "owner"}],
            },
            headers=headers(alice),
        )
        assert invalid.status_code == 422
        no_owner = alice.post(
            f"/api/projects/{pid}/access",
            json={
                "expected_acl_revision": 1,
                "sharing_scope": "restricted",
                    "members": [{**owner, "access": "read"}],
            },
            headers=headers(alice),
        )
        assert no_owner.status_code == 422

        payload = {
            "expected_acl_revision": 1,
            "sharing_scope": "restricted",
            "members": [owner],
        }

        def update(_):
            return alice.post(
                f"/api/projects/{pid}/access", json=payload, headers=headers(alice)
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(update, range(2))) == [200, 409]

        team_id = alice.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"
        with sqlite3.connect(database) as con:
            assert con.execute(
                "SELECT COUNT(*) FROM project_access_audit WHERE project_id=?", (pid,)
            ).fetchone()[0] == 2
            try:
                con.execute("DELETE FROM project_access_audit WHERE project_id=?", (pid,))
            except sqlite3.IntegrityError as error:
                assert "APPEND_ONLY_AUDIT" in str(error)
            else:
                raise AssertionError("ACL audit delete unexpectedly succeeded")

        missing_scope_body = {
            key: value
            for key, value in body.items()
            if key not in {"sharing_scope", "access_members"}
        }
        missing_scope = alice.post(
            "/api/projects",
            json={**missing_scope_body, "project_id": None, "expected_revision": 0},
            headers=headers(alice),
        )
        assert missing_scope.status_code == 422
        explicit_share = alice.post(
            "/api/projects",
            json={
                **body,
                "project_id": None,
                "expected_revision": 0,
                "sharing_scope": "team_wide",
                "access_members": [],
                "title": "Explicit team-wide fork",
            },
            headers=headers(alice),
        )
        assert explicit_share.status_code == 200

        legacy_pid = explicit_share.json()["project_id"]
        with sqlite3.connect(database) as con:
            con.execute("DELETE FROM project_access_members WHERE project_id=?", (legacy_pid,))
            con.execute("DELETE FROM project_access_policies WHERE project_id=?", (legacy_pid,))
        assert alice.get(f"/api/projects/{legacy_pid}/1").json()["sharing_scope"] == "team_wide"

    with TestClient(app, base_url=ORIGIN) as bob:
        login(bob, "bob")
        assert bob.get(f"/api/projects/{legacy_pid}/1").status_code == 200


def test_restricted_owner_must_be_current_active_writable_team_member(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    reviewer_id = add_member(
        identity_db, username="reviewer", password=PASSWORD, role="reviewer"
    )
    viewer_id = add_member(identity_db, username="viewer", password=PASSWORD, role="viewer")
    inactive_id = add_member(
        identity_db, username="inactive", password=PASSWORD, role="reviewer"
    )
    change_member(identity_db, username="inactive", role=None, revoke=True)

    with TestClient(app, base_url=ORIGIN) as admin:
        login(admin)
        bad_creation = admin.post(
            "/api/projects",
            json={
                **collaboration_payload(),
                "sharing_scope": "restricted",
                "access_members": [{"subject_id": viewer_id, "access": "owner"}],
            },
            headers=headers(admin),
        )
        assert bad_creation.status_code == 422

        saved, _ = create_restricted(admin)
        pid = saved["project_id"]

        def transfer(subject_id):
            return admin.post(
                f"/api/projects/{pid}/access",
                json={
                    "expected_acl_revision": 1,
                    "sharing_scope": "restricted",
                    "members": [{"subject_id": subject_id, "access": "owner"}],
                },
                headers=headers(admin),
            )

        viewer_only = transfer(viewer_id)
        assert viewer_only.status_code == 422
        assert viewer_only.json()["detail"] == "INVALID_PROJECT_OWNER"
        assert admin.get(f"/api/projects/{pid}/access").json()["acl_revision"] == 1
        assert admin.get(f"/api/projects/{pid}/1").status_code == 200

        inactive_only = transfer(inactive_id)
        assert inactive_only.status_code == 422
        assert inactive_only.json()["detail"] == "INVALID_PROJECT_MEMBER"

        change_member(identity_db, username="reviewer", role="viewer", revoke=False)
        role_changed = transfer(reviewer_id)
        assert role_changed.status_code == 422
        assert role_changed.json()["detail"] == "INVALID_PROJECT_OWNER"

        change_member(identity_db, username="reviewer", role="reviewer", revoke=False)
        legitimate = transfer(reviewer_id)
        assert legitimate.status_code == 200
        assert legitimate.json()["acl_revision"] == 2


def test_cross_team_valid_project_uuid_is_opaque(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as alpha:
        login(alpha)
        saved = alpha.post(
            "/api/projects",
            json={**collaboration_payload(), "sharing_scope": "restricted"},
            headers=headers(alpha),
        ).json()
    with sqlite3.connect(identity_db) as con:
        auth = con.execute(
            "SELECT password_hash,salt,scrypt_n,scrypt_r,scrypt_p FROM users LIMIT 1"
        ).fetchone()
        user_id, team_id, membership_id = str(uuid4()), str(uuid4()), str(uuid4())
        con.execute("INSERT INTO teams VALUES (?,?)", (team_id, "Beta"))
        con.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,0)", (user_id, "beta", *auth))
        con.execute(
            "INSERT INTO memberships VALUES (?,?,?,?,1,1)",
            (membership_id, user_id, team_id, "admin"),
        )
    with TestClient(app, base_url=ORIGIN) as beta:
        login(beta, "beta")
        assert beta.get(f"/api/projects/{saved['project_id']}/1").status_code == 404
        assert beta.get(f"/api/projects/{saved['project_id']}/access").status_code == 404
        assert beta.get(
            f"/api/projects/{saved['project_id']}/1/provenance"
        ).status_code == 404


def test_detached_provenance_obeys_project_acl_and_viewer_cannot_import(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    add_member(identity_db, username="reader", password=PASSWORD, role="reviewer")
    add_member(identity_db, username="outsider", password=PASSWORD, role="reviewer")
    add_member(identity_db, username="viewer", password=PASSWORD, role="viewer")
    with TestClient(app, base_url=ORIGIN) as owner:
        login(owner)
        directory = members(owner)
        body = {
            **contextual_import_payload(),
            "sharing_scope": "restricted",
            "access_members": [
                {"subject_id": directory["reader"]["id"], "access": "read"},
                {"subject_id": directory["viewer"]["id"], "access": "read"},
            ],
            "context_detachment_acknowledged": True,
        }
        preview = owner.post(
            "/api/projects/import/preview", json=body, headers=headers(owner)
        ).json()
        saved = owner.post(
            "/api/projects/import/commit",
            json={
                **body,
                "confirmation": True,
                "import_preview_digest": preview["import_preview_digest"],
            },
            headers=headers(owner),
        ).json()
        pid = saved["project_id"]
        assert owner.get(f"/api/projects/{pid}/1/provenance").status_code == 200

    with TestClient(app, base_url=ORIGIN) as reader:
        login(reader, "reader")
        assert reader.get(f"/api/projects/{pid}/1/provenance").status_code == 200
        assert reader.post(
            f"/api/projects/{pid}/1/provenance", json={}, headers=headers(reader)
        ).status_code == 403
        assert reader.post(
            "/api/projects/import/commit",
            json={
                **body,
                "confirmation": True,
                "import_preview_digest": preview["import_preview_digest"],
            },
            headers=headers(reader),
        ).status_code == 409

    with TestClient(app, base_url=ORIGIN) as outsider:
        login(outsider, "outsider")
        hidden = outsider.get(f"/api/projects/{pid}/1/provenance")
        assert hidden.status_code == 404
        assert "foreign-legacy" not in hidden.text

    with TestClient(app, base_url=ORIGIN) as viewer:
        login(viewer, "viewer")
        assert viewer.get(f"/api/projects/{pid}/1/provenance").status_code == 200
        assert viewer.post(
            f"/api/projects/{pid}/1/provenance", json={}, headers=headers(viewer)
        ).status_code == 403
        assert viewer.post(
            "/api/projects/import/preview", json=body, headers=headers(viewer)
        ).status_code == 403
        assert viewer.post(
            "/api/projects/import/commit",
            json={
                **body,
                "confirmation": True,
                "import_preview_digest": preview["import_preview_digest"],
            },
            headers=headers(viewer),
        ).status_code == 403


def test_non_admin_creator_transfer_is_authoritative_and_source_copy_cannot_widen(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    alice_id = add_member(identity_db, username="alice", password=PASSWORD, role="reviewer")
    bob_id = add_member(identity_db, username="bob", password=PASSWORD, role="reviewer")
    with TestClient(app, base_url=ORIGIN) as alice, TestClient(
        app, base_url=ORIGIN
    ) as bob:
        assert login(alice, "alice").status_code == 200
        assert login(bob, "bob").status_code == 200
        saved, body = create_restricted(alice)
        pid = saved["project_id"]
        transfer = alice.post(
            f"/api/projects/{pid}/access",
            json={
                "expected_acl_revision": 1,
                "sharing_scope": "restricted",
                "members": [{"subject_id": bob_id, "access": "owner"}],
            },
            headers=headers(alice),
        )
        assert transfer.status_code == 200
        assert transfer.json() == {
            "project_id": pid,
            "sharing_scope": "restricted",
            "acl_revision": 2,
            "access_revoked": True,
        }
        assert alice.get(f"/api/projects/{pid}/1").status_code == 404
        assert alice.get(f"/api/projects/{pid}/1/events").status_code == 404
        assert alice.get(f"/api/projects/{pid}/access").status_code == 404
        assert all(row["project_id"] != pid for row in alice.get("/api/projects").json())
        revoked_write = alice.post(
            "/api/projects",
            json={
                **{k: v for k, v in body.items() if k not in {"sharing_scope", "access_members"}},
                "project_id": pid,
                "expected_revision": 1,
            },
            headers=headers(alice),
        )
        assert revoked_write.status_code == 404
        revoked_fork = alice.post(
            "/api/projects",
            json={
                **body,
                "project_id": None,
                "expected_revision": 0,
                "sharing_scope": "team_wide",
                "access_members": [],
                "source_project_id": pid,
                "source_project_revision": 1,
            },
            headers=headers(alice),
        )
        assert revoked_fork.status_code == 404
        assert bob.get(f"/api/projects/{pid}/1").status_code == 200
        with sqlite3.connect(identity_db) as con:
            con.execute(
                "UPDATE memberships SET role='viewer',permission_epoch=permission_epoch+1 "
                "WHERE user_id=?",
                (bob_id,),
            )
        assert bob.get(f"/api/projects/{pid}/1").status_code == 200
        assert bob.get(f"/api/projects/{pid}/access").status_code == 404
        assert bob.post(
            f"/api/projects/{pid}/1/events",
            json={
                "expected_revision": 0,
                "base_document_revision": 1,
                "kind": "note",
                "text": "blocked after same-session role change",
            },
            headers=headers(bob),
        ).status_code == 403
        with sqlite3.connect(identity_db) as con:
            con.execute(
                "UPDATE memberships SET role='reviewer',permission_epoch=permission_epoch+1 "
                "WHERE user_id=?",
                (bob_id,),
            )
        assert bob.get(f"/api/projects/{pid}/access").status_code == 200
        assert alice_id != bob_id


def test_restricted_writer_cannot_widen_source_bound_or_known_digest_copy(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    add_member(identity_db, username="bob", password=PASSWORD, role="reviewer")
    with TestClient(app, base_url=ORIGIN) as owner:
        login(owner)
        saved, body = create_restricted(owner, (("bob", "write"),))
    with TestClient(app, base_url=ORIGIN) as bob:
        login(bob, "bob")
        base = {
            **body,
            "project_id": None,
            "expected_revision": 0,
            "sharing_scope": "team_wide",
            "access_members": [],
        }
        bound = bob.post(
            "/api/projects",
            json={
                **base,
                "source_project_id": saved["project_id"],
                "source_project_revision": 1,
            },
            headers=headers(bob),
        )
        assert bound.status_code == 422
        assert bound.json()["detail"] == "SOURCE_PROJECT_WIDEN_FORBIDDEN"
        exact_digest = bob.post("/api/projects", json=base, headers=headers(bob))
        assert exact_digest.status_code == 422
        assert exact_digest.json()["detail"] == "SOURCE_PROJECT_WIDEN_FORBIDDEN"
        restricted_copy = bob.post(
            "/api/projects",
            json={
                **base,
                "sharing_scope": "restricted",
                "source_project_id": saved["project_id"],
                "source_project_revision": 1,
            },
            headers=headers(bob),
        )
        assert restricted_copy.status_code == 200


def test_known_restricted_digest_blocks_actual_derived_routes_before_execution(
    tmp_path, monkeypatch
):
    from test_design_api import payload as design_payload
    from test_pdf_agent_api import payload as agent_payload

    from trialboard.agent import runtime

    def forbidden_provider(*_args, **_kwargs):
        raise AssertionError("restricted project content must not reach a model provider")

    monkeypatch.setattr(runtime, "runtime_provider", forbidden_provider)
    app, _, _ = make_team_app(
        tmp_path,
        enable_evidence_scout=True,
        enable_designs=True,
        enable_pdf_agent=True,
    )
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        saved, _ = create_restricted(client)
        fixture, design = design_payload()
        assert fixture["source"]["source"]["sha256"] == saved["pdf_digest"]
        assert client.post(
            "/api/design-comparisons", json=design, headers=headers(client)
        ).status_code == 403
        agent = agent_payload()
        for span in agent["input"]["spans"]:
            span["source_digest"] = saved["pdf_digest"]
        assert client.post(
            "/api/pdf-agent/run", json=agent, headers=headers(client)
        ).status_code == 403
        proposal = {
            key: value for key, value in design.items() if key not in {"brief", "ai_json"}
        }
        proposal.update(
            consent=True,
            constraints={"objective": "synthetic comparison", "max_per_arm": 80},
        )
        assert client.post(
            "/api/design-proposals", json=proposal, headers=headers(client)
        ).status_code == 403
