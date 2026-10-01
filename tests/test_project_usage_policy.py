"""Synthetic TEAM project usage-policy storage and byte-gate tests."""

import sqlite3

import pytest
from fastapi.testclient import TestClient
from test_project_acl import headers, members
from test_team_auth import (
    ORIGIN,
    PASSWORD,
    collaboration_payload,
    contextual_import_payload,
    login,
    make_team_app,
)

from trialboard.api.team_members import add_member


def asserted(storage="ALLOW", *, external_ai="UNKNOWN"):
    return {
        "original_storage": storage,
        "internal_search": "UNKNOWN",
        "external_ai": external_ai,
        "training": "UNKNOWN",
        "evidence_reference": "synthetic policy evidence",
        "reason": "Synthetic test assertion; not a legal determination.",
    }


def test_new_team_project_requires_explicit_allow_without_orphans(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        base = collaboration_payload()
        for policy in (None, asserted("UNKNOWN"), asserted("DENY")):
            body = {k: v for k, v in base.items() if k != "usage_policy"}
            if policy is not None:
                body["usage_policy"] = policy
            response = client.post("/api/projects", json=body, headers=headers(client))
            assert response.status_code == 422
        team_id = client.get("/api/teams/current").json()["id"]
        with sqlite3.connect(storage / team_id / "evidence.sqlite3") as con:
            for table in (
                "project_pdfs", "project_checkpoints", "team_project_registry",
                "project_usage_policy_versions", "project_usage_policy_heads",
            ):
                assert con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_policy_history_cas_binding_and_storage_read_gate(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        body = collaboration_payload()
        saved = client.post("/api/projects", json=body, headers=headers(client)).json()
        pid, digest = saved["project_id"], saved["pdf_digest"]
        policy_url = f"/api/projects/{pid}/usage-policy"
        initial = client.get(policy_url).json()
        assert initial["current"]["original_storage"] == "ALLOW"
        assert initial["current"]["external_ai"] == "UNKNOWN"
        assert initial["current"]["training_capability"] == "CAPABILITY_ABSENT"

        tampered = client.post(
            policy_url,
            json={**asserted("DENY"), "expected_policy_revision": 1,
                  "pdf_digest": "f" * 64},
            headers=headers(client),
        )
        assert tampered.status_code == 422
        denied = client.post(
            policy_url,
            json={**asserted("DENY"), "expected_policy_revision": 1,
                  "pdf_digest": digest},
            headers=headers(client),
        )
        assert denied.status_code == 200
        stale = client.post(
            policy_url,
            json={**asserted("ALLOW"), "expected_policy_revision": 1,
                  "pdf_digest": digest},
            headers=headers(client),
        )
        assert stale.status_code == 409
        assert client.get(f"/api/projects/{pid}/1").status_code == 403
        assert client.get(f"/api/projects/{pid}/1/provenance").status_code == 403
        assert any(row["project_id"] == pid for row in client.get("/api/projects").json())
        assert client.get(policy_url).status_code == 200
        blocked_save = client.post(
            "/api/projects",
            json={**body, "project_id": pid, "expected_revision": 1},
            headers=headers(client),
        )
        assert blocked_save.status_code == 422

        restored = client.post(
            policy_url,
            json={**asserted("ALLOW"), "expected_policy_revision": 2,
                  "pdf_digest": digest},
            headers=headers(client),
        )
        assert restored.status_code == 200
        history = restored.json()["history"]
        assert [row["policy_revision"] for row in history] == [3, 2, 1]
        assert client.get(f"/api/projects/{pid}/1").status_code == 200
        revised = client.post(
            "/api/projects",
            json={**{k: v for k, v in body.items() if k not in {"sharing_scope"}},
                  "project_id": pid, "expected_revision": 1},
            headers=headers(client),
        )
        assert revised.status_code == 200

        team_id = client.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"
        with sqlite3.connect(database) as con:
            assert con.execute(
                "SELECT COUNT(*) FROM project_usage_policy_versions WHERE project_id=?", (pid,)
            ).fetchone()[0] == 3
            try:
                con.execute(
                    "UPDATE project_usage_policy_versions SET reason='changed' "
                    "WHERE project_id=? AND policy_revision=1", (pid,)
                )
            except sqlite3.IntegrityError as error:
                assert "IMMUTABLE_USAGE_POLICY" in str(error)
            else:
                raise AssertionError("immutable usage policy unexpectedly changed")


def test_viewer_can_view_policy_but_cannot_update_and_projects_are_exactly_bound(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    add_member(identity_db, username="viewer", password=PASSWORD, role="viewer")
    with TestClient(app, base_url=ORIGIN) as owner:
        login(owner)
        first = owner.post(
            "/api/projects", json=collaboration_payload(), headers=headers(owner)
        ).json()
        second_body = {**collaboration_payload(), "title": "same bytes second project"}
        second = owner.post("/api/projects", json=second_body, headers=headers(owner)).json()
        owner.post(
            f"/api/projects/{first['project_id']}/usage-policy",
            json={**asserted("DENY"), "expected_policy_revision": 1,
                  "pdf_digest": first["pdf_digest"]},
            headers=headers(owner),
        )
        assert owner.get(f"/api/projects/{first['project_id']}/1").status_code == 403
        assert owner.get(f"/api/projects/{second['project_id']}/1").status_code == 200

    with TestClient(app, base_url=ORIGIN) as viewer:
        login(viewer, "viewer")
        viewed = viewer.get(f"/api/projects/{first['project_id']}/usage-policy")
        assert viewed.status_code == 200
        assert viewed.json()["current"]["can_manage"] is False
        changed = viewer.post(
            f"/api/projects/{first['project_id']}/usage-policy",
            json={**asserted("ALLOW"), "expected_policy_revision": 2,
                  "pdf_digest": first["pdf_digest"]},
            headers=headers(viewer),
        )
        assert changed.status_code == 403


def test_policy_lookup_does_not_create_missing_team_database(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        team_id = client.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"
        assert not database.exists()
        assert client.get(
            "/api/projects/12345678-1234-4234-8234-123456789012/usage-policy"
        ).status_code == 404
        assert not database.exists()


def test_policy_update_is_owner_or_admin_only_for_restricted_grants(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    for username, role in (
        ("owner", "reviewer"), ("writer", "reviewer"),
        ("reader", "reviewer"), ("viewer", "viewer"),
    ):
        add_member(identity_db, username=username, password=PASSWORD, role=role)

    with TestClient(app, base_url=ORIGIN) as creator:
        login(creator)
        directory = members(creator)
        body = {
            **collaboration_payload(),
            "sharing_scope": "restricted",
            "access_members": [
                {"subject_id": directory["owner"]["id"], "access": "owner"},
                {"subject_id": directory["writer"]["id"], "access": "write"},
                {"subject_id": directory["reader"]["id"], "access": "read"},
                {"subject_id": directory["viewer"]["id"], "access": "read"},
            ],
        }
        saved = creator.post("/api/projects", json=body, headers=headers(creator)).json()
        pid, digest = saved["project_id"], saved["pdf_digest"]
        url = f"/api/projects/{pid}/usage-policy"

        with TestClient(app, base_url=ORIGIN) as owner:
            login(owner, "owner")
            assert owner.get(url).json()["current"]["can_manage"] is True
            assert owner.post(
                url,
                json={**asserted("ALLOW", external_ai="DENY"),
                      "expected_policy_revision": 1, "pdf_digest": digest},
                headers=headers(owner),
            ).status_code == 200

        assert creator.post(
            url,
            json={**asserted("ALLOW"), "expected_policy_revision": 2,
                  "pdf_digest": digest},
            headers=headers(creator),
        ).status_code == 200

    for username, expected_status in (("writer", 404), ("reader", 404), ("viewer", 403)):
        with TestClient(app, base_url=ORIGIN) as denied:
            login(denied, username)
            viewed = denied.get(url)
            assert viewed.status_code == 200
            assert viewed.json()["current"]["can_manage"] is False
            changed = denied.post(
                url,
                json={**asserted("DENY"), "expected_policy_revision": 3,
                      "pdf_digest": digest},
                headers=headers(denied),
            )
            assert changed.status_code == expected_status


def test_existing_project_without_policy_keeps_bytes_until_owner_allows(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        body = collaboration_payload()
        saved = client.post("/api/projects", json=body, headers=headers(client)).json()
        pid, digest = saved["project_id"], saved["pdf_digest"]
        team_id = client.get("/api/teams/current").json()["id"]
        database = storage / team_id / "evidence.sqlite3"
        with sqlite3.connect(database) as con:
            original = con.execute(
                "SELECT content FROM project_pdfs WHERE digest=?", (digest,)
            ).fetchone()[0]
            con.execute("DROP TRIGGER project_usage_policy_versions_no_delete")
            con.execute("DELETE FROM project_usage_policy_heads WHERE project_id=?", (pid,))
            con.execute("DELETE FROM project_usage_policy_versions WHERE project_id=?", (pid,))

        policy_url = f"/api/projects/{pid}/usage-policy"
        unknown = client.get(policy_url)
        assert unknown.status_code == 200
        assert unknown.json()["current"]["policy_revision"] == 0
        assert unknown.json()["current"]["original_storage"] == "UNKNOWN"
        assert unknown.json()["history"] == []
        listed = next(row for row in client.get("/api/projects").json()
                      if row["project_id"] == pid)
        assert listed["usage_policy"]["original_storage"] == "UNKNOWN"
        assert listed["usage_policy"]["can_manage"] is True
        assert client.get(f"/api/projects/{pid}/1").status_code == 403

        with sqlite3.connect(database) as con:
            assert con.execute(
                "SELECT content FROM project_pdfs WHERE digest=?", (digest,)
            ).fetchone()[0] == original

        allowed = client.post(
            policy_url,
            json={**asserted("ALLOW"), "expected_policy_revision": 0,
                  "pdf_digest": digest},
            headers=headers(client),
        )
        assert allowed.status_code == 200
        restored = client.get(f"/api/projects/{pid}/1")
        assert restored.status_code == 200
        with sqlite3.connect(database) as con:
            assert con.execute(
                "SELECT content FROM project_pdfs WHERE digest=?", (digest,)
            ).fetchone()[0] == original


@pytest.mark.parametrize("detached", [False, True])
def test_import_preview_and_commit_bind_selected_policy(tmp_path, detached):
    app, _, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    body = contextual_import_payload() if detached else collaboration_payload()
    if detached:
        body = {**body, "context_detachment_acknowledged": True}
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        preview = client.post(
            "/api/projects/import/preview", json=body, headers=headers(client)
        )
        assert preview.status_code == 200
        preview_digest = preview.json()["import_preview_digest"]
        changed = {
            **body,
            "usage_policy": {**body["usage_policy"], "external_ai": "ALLOW"},
            "confirmation": True,
            "import_preview_digest": preview_digest,
        }
        rebound = client.post(
            "/api/projects/import/commit", json=changed, headers=headers(client)
        )
        assert rebound.status_code == 422
        assert rebound.json()["detail"] == "IMPORT_PREVIEW_REQUIRED"
        committed = client.post(
            "/api/projects/import/commit",
            json={**body, "confirmation": True, "import_preview_digest": preview_digest},
            headers=headers(client),
        )
        assert committed.status_code == 200
        pid = committed.json()["project_id"]
        current = client.get(f"/api/projects/{pid}/usage-policy").json()["current"]
        for key, value in body["usage_policy"].items():
            assert current[key] == value
