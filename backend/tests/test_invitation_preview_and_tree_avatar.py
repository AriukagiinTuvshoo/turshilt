"""Tests for recipient-only invitation preview and tree endpoint profile_photo_url privacy."""

from datetime import UTC, datetime
from urllib.parse import urlsplit

from conftest import register_verified


def _extract_invitation_token(email_provider, recipient: str) -> str:
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == recipient.strip().casefold()
        and "гэр бүлд урьж байна" in item.subject
    )
    link = delivery.text.rsplit(" ", 1)[-1]
    return urlsplit(link).fragment.removeprefix("token=")


def test_invitation_preview_requires_recipient_and_sets_no_store(client, email_provider):
    register_verified(client, "preview-owner@example.com")
    family_res = client.post("/api/v1/families", json={"name": "Алтан ураг"})
    assert family_res.status_code == 201
    family_id = family_res.json()["id"]

    invite_res = client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "Invited.Member@example.com", "role": "editor"},
    )
    assert invite_res.status_code == 201
    token = _extract_invitation_token(email_provider, "Invited.Member@example.com")

    # Unauthenticated preview is rejected with 401.
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/invitations/preview", json={"token": token}).status_code == 401

    # Wrong authenticated user receives 403.
    register_verified(client, "stranger@example.com")
    assert client.post("/api/v1/invitations/preview", json={"token": token}).status_code == 403

    # Unknown / invalid token returns 404.
    assert (
        client.post(
            "/api/v1/invitations/preview",
            json={"token": "x" * 40},
        ).status_code
        == 404
    )

    # Matching verified recipient sees family_name, role, expires_at with private, no-store cache control.
    client.post("/api/v1/auth/logout")
    register_verified(client, "invited.member@example.com")
    preview = client.post("/api/v1/invitations/preview", json={"token": token})
    assert preview.status_code == 200
    body = preview.json()
    assert body["family_name"] == "Алтан ураг"
    assert body["role"] == "editor"
    assert body["expires_at"]
    cache_control = preview.headers.get("cache-control", "").lower()
    assert "private" in cache_control
    assert "no-store" in cache_control


def test_family_tree_exposes_adult_photo_and_redacts_minor_photo(client, email_provider):
    register_verified(client, "tree-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Зургийн гэр бүл"}).json()["id"]

    minor_birth = f"{datetime.now(UTC).date().year - 8}-06-15"
    adult = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={
            "first_name": "Эцэг",
            "last_name": "Дорж",
            "birth_date": "1985-05-10",
            "is_alive": True,
            "profile_photo_url": "https://example.com/adult.webp",
        },
    ).json()
    minor = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={
            "first_name": "Хүүхэд",
            "last_name": "Дорж",
            "birth_date": minor_birth,
            "is_alive": True,
            "profile_photo_url": "https://example.com/minor.webp",
        },
    ).json()
    rel = client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": adult["id"], "child_id": minor["id"]},
    )
    assert rel.status_code == 201

    # Invite a designated guardian member and a regular non-guardian member.
    assert (
        client.post(
            f"/api/v1/families/{family_id}/invitations",
            json={"email": "tree-guardian@example.com", "role": "member"},
        ).status_code
        == 201
    )
    guardian_token = _extract_invitation_token(email_provider, "tree-guardian@example.com")
    assert (
        client.post(
            f"/api/v1/families/{family_id}/invitations",
            json={"email": "tree-member@example.com", "role": "member"},
        ).status_code
        == 201
    )
    member_token = _extract_invitation_token(email_provider, "tree-member@example.com")

    # Without guardian scope, adult photo is shown while minor is omitted from traversal
    # and querying the minor directly redacts profile_photo_url and birth_date.
    unscoped_tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={adult['id']}")
    assert unscoped_tree.status_code == 200
    unscoped_by_id = {p["id"]: p for p in unscoped_tree.json()["persons"]}
    assert unscoped_by_id[adult["id"]]["profile_photo_url"] == "https://example.com/adult.webp"
    assert minor["id"] not in unscoped_by_id

    minor_root_unscoped = client.get(f"/api/v1/families/{family_id}/tree?person_id={minor['id']}")
    assert minor_root_unscoped.status_code == 200
    minor_root_by_id = {p["id"]: p for p in minor_root_unscoped.json()["persons"]}
    assert minor_root_by_id[minor["id"]]["profile_photo_url"] is None
    assert minor_root_by_id[minor["id"]]["birth_date"] is None

    # Regular non-guardian member joins and inspects tree: adult photo visible, minor hidden/redacted.
    client.post("/api/v1/auth/logout")
    register_verified(client, "tree-member@example.com")
    assert client.post("/api/v1/invitations/accept", json={"token": member_token}).status_code == 200

    member_tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={adult['id']}")
    assert member_tree.status_code == 200
    member_by_id = {p["id"]: p for p in member_tree.json()["persons"]}
    assert member_by_id[adult["id"]]["profile_photo_url"] == "https://example.com/adult.webp"
    assert minor["id"] not in member_by_id

    member_minor_root = client.get(f"/api/v1/families/{family_id}/tree?person_id={minor['id']}")
    assert member_minor_root.status_code == 200
    member_minor_by_id = {p["id"]: p for p in member_minor_root.json()["persons"]}
    assert member_minor_by_id[minor["id"]]["profile_photo_url"] is None
    assert member_minor_by_id[minor["id"]]["birth_date"] is None

    # Designated guardian joins; owner grants view_profile -> guardian sees minor's photo in tree.
    client.post("/api/v1/auth/logout")
    register_verified(client, "tree-guardian@example.com")
    guardian = client.get("/api/v1/auth/me").json()
    assert client.post("/api/v1/invitations/accept", json={"token": guardian_token}).status_code == 200

    client.post("/api/v1/auth/logout")
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "tree-owner@example.com", "password": "strong-passphrase-123"},
        ).status_code
        == 200
    )
    grant_res = client.post(
        f"/api/v1/families/{family_id}/persons/{minor['id']}/guardianships",
        json={"guardian_user_id": guardian["id"], "scopes": ["view_profile"]},
    )
    assert grant_res.status_code == 201

    client.post("/api/v1/auth/logout")
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "tree-guardian@example.com", "password": "strong-passphrase-123"},
        ).status_code
        == 200
    )
    guardian_tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={adult['id']}")
    assert guardian_tree.status_code == 200
    guardian_by_id = {p["id"]: p for p in guardian_tree.json()["persons"]}
    assert guardian_by_id[adult["id"]]["profile_photo_url"] == "https://example.com/adult.webp"
    assert guardian_by_id[minor["id"]]["profile_photo_url"] == "https://example.com/minor.webp"
