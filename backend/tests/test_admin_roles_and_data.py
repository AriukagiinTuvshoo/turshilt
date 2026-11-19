"""Tests for Super-Admin hierarchy, customizable Sub-Admin roles/permissions, and data refresh."""

from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember, Person, User


def _login(client, email: str):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "strong-passphrase-123"},
    )
    assert res.status_code == 200
    return res


def test_subadmin_granular_permissions_and_data_refresh(client, database):
    assert register_verified(client, "super-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Алтан Ураг"}).json()
    family_id = family["id"]
    assert family["role"] == "owner"
    assert "manage_finance" in family["permissions"]

    # Register helper member and attach as plain member
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "helper-admin@example.com").status_code == 201
    helper_user = client.get("/api/v1/auth/me").json()
    helper_id = helper_user["id"]

    with database() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(helper_id), role="member"))
        db.commit()

    # Plain member cannot view /admin/overview or /audit
    assert client.get(f"/api/v1/families/{family_id}/admin/overview").status_code == 403
    assert client.get(f"/api/v1/families/{family_id}/audit").status_code == 403

    # Owner promotes helper to Sub-Admin with only finance & audit scopes + custom title
    _login(client, "super-owner@example.com")
    promo = client.patch(
        f"/api/v1/families/{family_id}/members/{helper_id}",
        json={
            "role": "admin",
            "admin_title": "Санхүү ба Аудит хариуцагч",
            "permissions": ["manage_finance", "view_audit"],
        },
    )
    assert promo.status_code == 200
    promo_body = promo.json()
    assert promo_body["role"] == "admin"
    assert promo_body["admin_title"] == "Санхүү ба Аудит хариуцагч"
    assert promo_body["permissions"] == ["manage_finance", "view_audit"]
    assert promo_body["email"] == "helper-admin@example.com"

    # Helper logs in: allowed finance & audit work, forbidden people/members/data/settings fail 403
    _login(client, "helper-admin@example.com")
    ov = client.get(f"/api/v1/families/{family_id}/admin/overview")
    assert ov.status_code == 200
    assert ov.json()["my_role"] == "admin"
    assert ov.json()["my_admin_title"] == "Санхүү ба Аудит хариуцагч"
    assert ov.json()["my_permissions"] == ["manage_finance", "view_audit"]

    fund_res = client.post(
        f"/api/v1/families/{family_id}/funds",
        json={
            "title": "Наадмын сан",
            "purpose": "Зуны цугларалт",
            "currency": "MNT",
            "payment_instruction": "Банк 1234",
            "visibility": "family",
        },
    )
    assert fund_res.status_code == 201
    fund_id = fund_res.json()["id"]

    exp_res = client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/expenses",
        json={"title": "Майхан", "amount_minor": 150_000, "note": "Бэлтгэл"},
    )
    assert exp_res.status_code == 201

    audit_res = client.get(f"/api/v1/families/{family_id}/audit")
    assert audit_res.status_code == 200
    assert any(item["actor_name"] for item in audit_res.json())

    # Forbidden scopes
    assert (
        client.post(
            f"/api/v1/families/{family_id}/persons",
            json={"first_name": "Хориотой", "last_name": "Хүн", "gender": "male"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/families/{family_id}/invitations",
            json={"email": "new@example.com", "role": "member"},
        ).status_code
        == 403
    )
    assert client.post(f"/api/v1/families/{family_id}/admin/reindex-data").status_code == 403
    assert (
        client.patch(
            f"/api/v1/families/{family_id}", json={"name": "Солих гээд үзье"}
        ).status_code
        == 403
    )

    # Owner expands helper's permissions to add manage_people + manage_data
    _login(client, "super-owner@example.com")
    upd = client.patch(
        f"/api/v1/families/{family_id}/members/{helper_id}",
        json={
            "role": "admin",
            "admin_title": "Өгөгдөл ба Мод Шинэчлэгч",
            "permissions": ["manage_people", "manage_data", "manage_finance", "view_audit"],
        },
    )
    assert upd.status_code == 200
    assert upd.json()["permissions"] == [
        "manage_people",
        "manage_finance",
        "manage_data",
        "view_audit",
    ]

    # Helper now creates incomplete person with untrimmed whitespace & refreshes data
    _login(client, "helper-admin@example.com")
    created_person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "  Бат  ", "last_name": "  Өлзий  ", "gender": "unknown"},
    )
    assert created_person.status_code == 201
    person_id = UUID(created_person.json()["id"])

    refresh = client.post(f"/api/v1/families/{family_id}/admin/reindex-data")
    assert refresh.status_code == 200
    assert refresh.json()["refreshed_persons"] >= 1

    with database() as db:
        refreshed_person = db.get(Person, person_id)
        assert refreshed_person is not None
        assert refreshed_person.first_name == "Бат"
        assert refreshed_person.last_name == "Өлзий"
        assert refreshed_person.search_first_name == "бат"

    # Verify overview health metrics
    ov2 = client.get(f"/api/v1/families/{family_id}/admin/overview").json()
    assert ov2["total_persons"] == 1
    assert ov2["missing_birth_date_count"] == 1
    assert ov2["missing_gender_count"] == 1
    assert ov2["admin_count"] == 1
    assert ov2["owner_count"] == 1
    assert ov2["total_expenses_minor"] == 150_000
    assert ov2["net_balance_minor"] == -150_000

    # Owner demotes sub-admin back to plain member -> permissions stripped immediately
    _login(client, "super-owner@example.com")
    demote = client.patch(
        f"/api/v1/families/{family_id}/members/{helper_id}",
        json={"role": "member"},
    )
    assert demote.status_code == 200
    assert demote.json()["role"] == "member"
    assert demote.json()["permissions"] == []
    assert demote.json()["admin_title"] is None

    _login(client, "helper-admin@example.com")
    assert client.get(f"/api/v1/families/{family_id}/admin/overview").status_code == 403
    assert client.post(f"/api/v1/families/{family_id}/funds", json={
        "title": "X",
        "purpose": "Y",
        "payment_instruction": "Z",
    }).status_code == 403


def test_subadmin_invitation_and_admin_removal_boundaries(client, database):
    assert register_verified(client, "root-owner@example.com").status_code == 201
    family_id = client.post("/api/v1/families", json={"name": "Хамгаалалт Гэр Бүл"}).json()["id"]

    # Invite new admin directly by owner
    inv_admin = client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "invited-subadmin@example.com", "role": "admin"},
    )
    assert inv_admin.status_code == 201
    invite_token = inv_admin.json()["invite_url"].split("#token=")[-1]

    # Invitee registers, accepts, gets admin role with full default permissions
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "invited-subadmin@example.com").status_code == 201
    acc = client.post("/api/v1/invitations/accept", json={"token": invite_token})
    assert acc.status_code == 200
    assert acc.json()["role"] == "admin"

    # Also register a plain member + another sub-admin
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "second-subadmin@example.com").status_code == 201
    second_id = client.get("/api/v1/auth/me").json()["id"]
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "plain-joe@example.com").status_code == 201
    joe_id = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        owner_id = db.query(User).filter(User.email == "root-owner@example.com").one().id
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(second_id), role="admin"))
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(joe_id), role="member"))
        db.commit()

    # Sub-admin has manage_members by default -> can invite 'member' and remove plain 'member',
    # but CANNOT invite 'admin' and CANNOT remove 'owner' or another 'admin'
    _login(client, "invited-subadmin@example.com")
    assert (
        client.post(
            f"/api/v1/families/{family_id}/invitations",
            json={"email": "cannot-be-admin@example.com", "role": "admin"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/families/{family_id}/invitations",
            json={"email": "regular-friend@example.com", "role": "member"},
        ).status_code
        == 201
    )
    assert client.delete(f"/api/v1/families/{family_id}/members/{owner_id}").status_code == 403
    assert client.delete(f"/api/v1/families/{family_id}/members/{second_id}").status_code == 403
    assert client.delete(f"/api/v1/families/{family_id}/members/{joe_id}").status_code == 204

    # Members email privacy: plain member sees null email, admin with manage_members sees emails
    _login(client, "root-owner@example.com")
    owner_members = client.get(f"/api/v1/families/{family_id}/members").json()
    assert all(m["email"] is not None for m in owner_members)
