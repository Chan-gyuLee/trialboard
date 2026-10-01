"""Immutable TEAM PDF source chains using only synthetic documents and databases."""

import base64
import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from test_project_acl import headers
from test_team_auth import ORIGIN, collaboration_payload, login, make_team_app

from trialboard.api.team_members import add_member, change_member


def clean_payload(label: str, marker: bytes):
    body = collaboration_payload()
    pdf = b"%PDF-SYNTHETIC-SOURCE-VERSION-" + marker
    digest = hashlib.sha256(pdf).hexdigest()
    bundle = json.loads(body["bundle_json"])
    bundle["source"].update(name=f"{label}.pdf", sha256=digest, byteLength=len(pdf))
    review = json.loads(bundle["reviewRaw"])
    review.update(
        sourceDigest=digest,
        sourceName=f"{label}.pdf",
        rows=[],
        modelFindings=[],
        origin={"kind": "manual", "runId": None, "reportDigest": None, "mode": None},
    )
    bundle.update(
        notes=[],
        reviewRaw=json.dumps(review),
        draftRaw=json.dumps({"schema_version": "design-draft/1", "source_digest": digest}),
        meetingRaw=None,
        agentRaw=None,
        context=None,
    )
    return {
        **body,
        "title": label,
        "pdf_base64": base64.b64encode(pdf).decode(),
        "bundle_json": json.dumps(bundle),
    }


def source_body(payload, parent, *, expected=0):
    return {
        **{k: v for k, v in payload.items() if k not in {"sharing_scope", "access_members"}},
        "confirmation": True,
        "predecessor_project_id": parent["project_id"],
        "predecessor_review_revision": parent["revision"],
        "expected_series_head_revision": expected,
    }


def test_source_version_requires_json_true_without_boolean_coercion(tmp_path):
    app, _, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        first_payload = clean_payload("strict-source-one", b"STRICT-ONE")
        parent_response = client.post(
            "/api/projects",
            json={**first_payload, "sharing_scope": "team_wide"},
            headers=headers(client),
        )
        assert parent_response.status_code == 200, parent_response.text
        body = source_body(
            clean_payload("strict-source-two", b"STRICT-TWO"), parent_response.json()
        )
        non_true_values = [1, 1.0, "true", "1", False, 0, 0.0, "false", "0", [], {}]
        for field in ("consent", "public_authorized_non_sensitive", "confirmation"):
            for value in non_true_values:
                assert client.post(
                    "/api/projects/source-versions",
                    json={**body, field: value},
                    headers=headers(client),
                ).status_code == 422

        created = client.post(
            "/api/projects/source-versions", json=body, headers=headers(client)
        )
        assert created.status_code == 200, created.text


def test_different_pdfs_are_atomic_versions_and_review_revisions_stay_separate(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        first_payload = clean_payload("source-one", b"ONE")
        first = client.post(
            "/api/projects",
            json={**first_payload, "sharing_scope": "team_wide"},
            headers=headers(client),
        ).json()
        second_review = client.post(
            "/api/projects",
            json={**first_payload, "project_id": first["project_id"], "expected_revision": 1,
                  "sharing_scope": None},
            headers=headers(client),
        )
        assert second_review.status_code == 200
        parent = second_review.json()
        note = client.post(
            f"/api/projects/{first['project_id']}/2/events",
            json={"expected_revision": 0, "kind": "note", "text": "old source note",
                  "base_document_revision": 2},
            headers=headers(client),
        )
        assert note.status_code == 200

        second_payload = clean_payload("source-two", b"TWO")
        assert client.post(
            "/api/projects/source-versions", json=source_body(second_payload, parent)
        ).status_code == 403
        assert client.post(
            "/api/projects/source-versions",
            json=source_body(second_payload, parent),
            headers={**headers(client), "Origin": "https://evil.example"},
        ).status_code == 403
        dirty_payload = dict(second_payload)
        dirty_bundle = json.loads(dirty_payload["bundle_json"])
        dirty_review = json.loads(collaboration_payload()["bundle_json"])
        dirty_review = json.loads(dirty_review["reviewRaw"])
        dirty_review.update(
            sourceDigest=dirty_bundle["source"]["sha256"],
            sourceName=dirty_bundle["source"]["name"],
        )
        dirty_bundle["reviewRaw"] = json.dumps(dirty_review)
        dirty_payload["bundle_json"] = json.dumps(dirty_bundle)
        carried = client.post(
            "/api/projects/source-versions",
            json=source_body(dirty_payload, parent),
            headers=headers(client),
        )
        assert carried.status_code == 422
        assert carried.json()["detail"] == "SOURCE_VERSION_REQUIRES_CLEAN_BUNDLE"
        created = client.post(
            "/api/projects/source-versions",
            json=source_body(second_payload, parent),
            headers=headers(client),
        )
        assert created.status_code == 200, created.text
        child = created.json()
        assert child["project_id"] != first["project_id"]
        assert child["source_version"]["predecessor_project_id"] == first["project_id"]
        assert child["source_version"]["predecessor_review_revision"] == 2
        assert 1 <= child["source_version"]["series_head_revision"] <= 2_147_483_647

        old_one = client.get(f"/api/projects/{first['project_id']}/1").json()
        old_two = client.get(f"/api/projects/{first['project_id']}/2").json()
        new_one = client.get(f"/api/projects/{child['project_id']}/1").json()
        assert base64.b64decode(old_one["pdf_base64"]) == base64.b64decode(
            first_payload["pdf_base64"]
        )
        assert old_one["pdf_base64"] == old_two["pdf_base64"]
        assert base64.b64decode(new_one["pdf_base64"]) == base64.b64decode(
            second_payload["pdf_base64"]
        )
        assert json.loads(new_one["bundle_json"])["notes"] == []
        assert client.get(f"/api/projects/{first['project_id']}/2/events").json()["events"]
        assert client.get(f"/api/projects/{child['project_id']}/1/events").json()["events"] == []

        duplicate = client.post(
            "/api/projects/source-versions",
            json=source_body(
                second_payload, child, expected=child["source_version"]["series_head_revision"]
            ),
            headers=headers(client),
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["detail"] == "SOURCE_PDF_ALREADY_VERSIONED"
        stale_ancestor = client.post(
            "/api/projects/source-versions",
            json=source_body(
                clean_payload("source-three", b"THREE"),
                parent,
                expected=child["source_version"]["series_head_revision"],
            ),
            headers=headers(client),
        )
        assert stale_ancestor.status_code == 409
        assert stale_ancestor.json()["detail"] == "SOURCE_SERIES_HEAD_CONFLICT"

        team_id = client.get("/api/teams/current").json()["id"]
        with sqlite3.connect(storage / team_id / "evidence.sqlite3") as con:
            assert con.execute("SELECT COUNT(*) FROM document_source_versions").fetchone()[0] == 2
            assert con.execute("SELECT COUNT(*) FROM project_checkpoints").fetchone()[0] == 3


def test_concurrent_source_heads_create_one_child_without_orphan(tmp_path):
    app, _, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        parent_payload = clean_payload("parent", b"PARENT")
        parent = client.post(
            "/api/projects",
            json={**parent_payload, "sharing_scope": "team_wide"},
            headers=headers(client),
        ).json()
        candidates = [clean_payload("candidate-a", b"A"), clean_payload("candidate-b", b"B")]

        def create(payload):
            return client.post(
                "/api/projects/source-versions",
                json=source_body(payload, parent),
                headers=headers(client),
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(create, candidates)) == [200, 409]
        team_id = client.get("/api/teams/current").json()["id"]
        with sqlite3.connect(storage / team_id / "evidence.sqlite3") as con:
            assert con.execute("SELECT COUNT(*) FROM team_project_registry").fetchone()[0] == 2
            assert con.execute("SELECT COUNT(*) FROM project_pdfs").fetchone()[0] == 2
            assert con.execute("SELECT COUNT(*) FROM document_source_versions").fetchone()[0] == 2
            assert con.execute(
                "SELECT COUNT(*) FROM project_usage_policy_versions"
            ).fetchone()[0] == 2
            assert con.execute(
                "SELECT COUNT(*) FROM project_usage_policy_heads"
            ).fetchone()[0] == 2


def test_source_version_requires_manager_and_inherits_restricted_acl(tmp_path):
    app, identity_db, _ = make_team_app(tmp_path, enable_evidence_scout=True)
    bob_id = add_member(identity_db, username="bob", password="test-only-password", role="reviewer")
    carol_id = add_member(
        identity_db, username="carol", password="test-only-password", role="reviewer"
    )
    parent_payload = clean_payload("restricted-parent", b"RESTRICTED")
    child_payload = clean_payload("restricted-child", b"CHANGED")
    with TestClient(app, base_url=ORIGIN) as owner:
        login(owner)
        parent = owner.post(
            "/api/projects",
            json={
                **parent_payload,
                "sharing_scope": "restricted",
                "access_members": [
                    {"subject_id": bob_id, "access": "write"},
                    {"subject_id": carol_id, "access": "read"},
                ],
            },
            headers=headers(owner),
        ).json()

    for username in ("bob", "carol"):
        with TestClient(app, base_url=ORIGIN) as member:
            login(member, username)
            denied = member.post(
                "/api/projects/source-versions",
                json=source_body(child_payload, parent),
                headers=headers(member),
            )
            assert denied.status_code == 404

    with TestClient(app, base_url=ORIGIN) as owner:
        login(owner)
        child_response = owner.post(
            "/api/projects/source-versions",
            json=source_body(child_payload, parent),
            headers=headers(owner),
        )
        assert child_response.status_code == 200
        child = child_response.json()
        assert child["sharing_scope"] == "restricted"
        access = owner.get(f"/api/projects/{child['project_id']}/access").json()
        assert {(row["username"], row["access"]) for row in access["members"]} == {
            ("admin", "owner"), ("bob", "write"), ("carol", "read")
        }
        admin_owner = next(row for row in access["members"] if row["username"] == "admin")
        narrowed = owner.post(
            f"/api/projects/{child['project_id']}/access",
            json={
                "expected_acl_revision": access["acl_revision"],
                "sharing_scope": "restricted",
                "members": [{"subject_id": admin_owner["subject_id"], "access": "owner"}],
            },
            headers=headers(owner),
        )
        assert narrowed.status_code == 200

    with TestClient(app, base_url=ORIGIN) as bob:
        login(bob, "bob")
        listing = bob.get("/api/projects").json()
        parent_rows = [row for row in listing if row["project_id"] == parent["project_id"]]
        assert parent_rows and all("source_version" not in row for row in parent_rows)
        assert child["project_id"] not in json.dumps(listing)
        assert bob.get(f"/api/projects/{child['project_id']}/1").status_code == 404


def test_inactive_inherited_acl_is_rejected_without_partial_creation(tmp_path):
    app, identity_db, storage = make_team_app(tmp_path, enable_evidence_scout=True)
    bob_id = add_member(identity_db, username="bob", password="test-only-password", role="reviewer")
    with TestClient(app, base_url=ORIGIN) as owner:
        login(owner)
        parent_payload = clean_payload("parent", b"ROOT")
        parent = owner.post(
            "/api/projects",
            json={
                **parent_payload,
                "sharing_scope": "restricted",
                "access_members": [{"subject_id": bob_id, "access": "write"}],
            },
            headers=headers(owner),
        ).json()
        change_member(identity_db, username="bob", role=None, revoke=True)
        blocked = owner.post(
            "/api/projects/source-versions",
            json=source_body(clean_payload("blocked", b"BLOCKED"), parent),
            headers=headers(owner),
        )
        assert blocked.status_code == 422
        assert blocked.json()["detail"] == "SOURCE_VERSION_ACL_INACTIVE"
        team_id = owner.get("/api/teams/current").json()["id"]
        with sqlite3.connect(storage / team_id / "evidence.sqlite3") as con:
            assert con.execute("SELECT COUNT(*) FROM team_project_registry").fetchone()[0] == 1
            assert con.execute("SELECT COUNT(*) FROM project_pdfs").fetchone()[0] == 1
            assert con.execute("SELECT COUNT(*) FROM project_checkpoints").fetchone()[0] == 1
            assert con.execute(
                "SELECT COUNT(*) FROM project_usage_policy_versions"
            ).fetchone()[0] == 1
            assert con.execute(
                "SELECT COUNT(*) FROM project_usage_policy_heads"
            ).fetchone()[0] == 1
