from uuid import UUID, uuid4

from conftest import register_verified

from app.relationships import analyze_kinship_relation


def test_kinship_analysis_siblings():
    father = uuid4()
    mother = uuid4()
    child_1 = uuid4()
    child_2 = uuid4()

    edges = [
        (father, child_1, "male"),
        (mother, child_1, "female"),
        (father, child_2, "male"),
        (mother, child_2, "female"),
    ]

    result = analyze_kinship_relation(child_1, child_2, edges)
    assert result["is_blood_related"] is True
    assert result["relationship_title"] == "Төрсөн ах / эгч / дүү"
    assert result["generations_person_1"] == 1
    assert result["generations_person_2"] == 1
    assert result["coefficient"] == 0.5
    assert result["within_9_generations"] is True


def test_kinship_analysis_first_cousins():
    # Grandfather -> Father1, Father2
    # Father1 -> Child1, Father2 -> Child2
    gf = uuid4()
    f1 = uuid4()
    f2 = uuid4()
    c1 = uuid4()
    c2 = uuid4()

    edges = [
        (gf, f1, "male"),
        (gf, f2, "male"),
        (f1, c1, "male"),
        (f2, c2, "male"),
    ]

    result = analyze_kinship_relation(c1, c2, edges)
    assert result["is_blood_related"] is True
    assert "Үеэл" in result["relationship_title"]
    assert result["lineage_type"] == "paternal"
    assert result["generations_person_1"] == 2
    assert result["generations_person_2"] == 2
    assert result["within_9_generations"] is True


def test_kinship_unrelated():
    p1 = uuid4()
    p2 = uuid4()
    result = analyze_kinship_relation(p1, p2, [])
    assert result["is_blood_related"] is False
    assert result["relationship_type"] == "unrelated"
    assert result["within_9_generations"] is False


def test_family_stats_and_member_admin_api(client, database):
    assert register_verified(client, "admin-family-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Шинжилгээний гэр бүл"}).json()
    family_id = family["id"]

    # Verify family stats endpoint
    stats_res = client.get(f"/api/v1/families/{family_id}/stats")
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert stats["total_persons"] == 0
    assert stats["generation_depth"] == 1
    assert stats["member_count"] == 1

    # Add a person to family
    person_res = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат", "last_name": "Дорж", "gender": "male", "is_alive": True},
    )
    assert person_res.status_code == 201
    person_id = person_res.json()["id"]

    # Check stats after person added
    stats_after = client.get(f"/api/v1/families/{family_id}/stats").json()
    assert stats_after["total_persons"] == 1
    assert stats_after["male_count"] == 1

    # Check kinship with self
    kin_res = client.get(
        f"/api/v1/families/{family_id}/kinship?person_1_id={person_id}&person_2_id={person_id}"
    )
    assert kin_res.status_code == 200
    kin_data = kin_res.json()
    assert kin_data["relationship_type"] == "self"
    assert kin_data["coefficient"] == 1.0

    # Test member admin management
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "member-user@example.com").status_code == 201
    member_user = client.get("/api/v1/auth/me").json()
    member_user_id = member_user["id"]

    # Directly create invitation with known token
    import hashlib
    from datetime import UTC, datetime, timedelta

    from app.models import Invitation, User

    raw_token = "m" * 48
    with database() as db:
        owner_id = db.query(User).filter(User.email == "admin-family-owner@example.com").one().id
        db.add(
            Invitation(
                family_id=UUID(family_id),
                invited_email="member-user@example.com",
                role="member",
                token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
                invited_by=owner_id,
                expires_at=datetime.now(UTC) + timedelta(days=7),
            )
        )
        db.commit()

    # Member accepts
    accept_res = client.post("/api/v1/invitations/accept", json={"token": raw_token})
    assert accept_res.status_code == 200

    # Log in back as owner to manage member
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "admin-family-owner@example.com", "password": "strong-passphrase-123"},
    ).status_code == 200

    # Update member role to editor
    patch_res = client.patch(
        f"/api/v1/families/{family_id}/members/{member_user_id}",
        json={"role": "editor"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["role"] == "editor"

    # Remove member
    del_res = client.delete(f"/api/v1/families/{family_id}/members/{member_user_id}")
    assert del_res.status_code == 204
