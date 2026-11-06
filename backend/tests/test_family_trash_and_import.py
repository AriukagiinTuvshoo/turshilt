from uuid import UUID
from conftest import register_verified
from app.models import FamilyMember


def test_family_trash_lifecycle_and_restore(client, database):
    # Register Owner
    assert register_verified(client, "trash-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Хогийн сав тест гэр бүл"}).json()
    family_id = family["id"]

    # 1. Create parent and child
    parent = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Батболд", "last_name": "Боржигон", "gender": "male", "birth_date": "1970-01-01"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Тэмүүлэн", "last_name": "Батболд", "gender": "male", "birth_date": "2000-05-15"},
    ).json()

    # 2. Link parent-child
    rel = client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": child["id"], "relationship_type": "biological"},
    )
    assert rel.status_code == 201

    # 3. Soft-delete child
    del_resp = client.delete(f"/api/v1/families/{family_id}/persons/{child['id']}")
    assert del_resp.status_code == 204

    # 4. Verify child is removed from family persons list
    persons_after = client.get(f"/api/v1/families/{family_id}/persons").json()
    assert all(p["id"] != child["id"] for p in persons_after)

    # 5. List trash
    trash_list = client.get(f"/api/v1/families/{family_id}/trash").json()
    assert len(trash_list) >= 1
    trash_item = next(t for t in trash_list if t["person_id"] == child["id"])
    assert "Батболд Тэмүүлэн" in trash_item["person_name"]
    assert trash_item["deleted_by_name"] is not None

    # 6. Restore child from trash
    restore_resp = client.post(f"/api/v1/families/{family_id}/trash/{trash_item['id']}/restore")
    assert restore_resp.status_code == 200
    assert restore_resp.json()["restored"] is True

    # 7. Verify child is back in persons
    persons_restored = client.get(f"/api/v1/families/{family_id}/persons").json()
    assert any(p["id"] == child["id"] for p in persons_restored)

    # 8. Verify tree relationship was also restored
    tree = client.get(f"/api/v1/families/{family_id}/tree").json()
    edges = tree["parent_child_relationships"]
    assert any(e["parent_id"] == parent["id"] and e["child_id"] == child["id"] for e in edges)

    # 9. Delete child again and purge
    client.delete(f"/api/v1/families/{family_id}/persons/{child['id']}")
    trash_list2 = client.get(f"/api/v1/families/{family_id}/trash").json()
    trash_item2 = next(t for t in trash_list2 if t["person_id"] == child["id"])

    # Purge single
    purge_resp = client.delete(f"/api/v1/families/{family_id}/trash/{trash_item2['id']}")
    assert purge_resp.status_code == 204

    trash_list3 = client.get(f"/api/v1/families/{family_id}/trash").json()
    assert all(t["id"] != trash_item2["id"] for t in trash_list3)


def test_family_data_import(client, database):
    assert register_verified(client, "import-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Импорт тест гэр бүл"}).json()
    family_id = family["id"]

    import_payload = {
        "people": [
            {
                "id": "old-p1",
                "first_name": "Өвөө",
                "last_name": "Хөх",
                "gender": "male",
                "birth_date": "1940-01-01",
                "is_alive": False,
            },
            {
                "id": "old-p2",
                "first_name": "Хүү",
                "last_name": "Хөх",
                "gender": "male",
                "birth_date": "1970-02-02",
                "is_alive": True,
            },
        ],
        "parent_child_relationships": [
            {
                "parent_id": "old-p1",
                "child_id": "old-p2",
                "relationship_type": "biological",
            }
        ],
        "marriages": [],
    }

    resp = client.post(f"/api/v1/families/{family_id}/import", json=import_payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["imported_people"] == 2
    assert data["imported_relationships"] == 1

    # Verify people exist in family
    people = client.get(f"/api/v1/families/{family_id}/persons").json()
    names = [f"{p['last_name']} {p['first_name']}" for p in people]
    assert "Хөх Өвөө" in names
    assert "Хөх Хүү" in names


def test_family_export_and_import_roundtrip(client, database):
    assert register_verified(client, "roundtrip-owner@example.com").status_code == 201

    # 1. Create Family A
    family_a = client.post("/api/v1/families", json={"name": "Эх гэр бүл"}).json()
    fam_a_id = family_a["id"]

    # 2. Add father, mother, child
    p_father = client.post(
        f"/api/v1/families/{fam_a_id}/persons",
        json={"first_name": "Болд", "last_name": "Боржигон", "gender": "male", "birth_date": "1975-01-01"},
    ).json()
    p_mother = client.post(
        f"/api/v1/families/{fam_a_id}/persons",
        json={"first_name": "Цэцэг", "last_name": "Хөх", "gender": "female", "birth_date": "1978-05-12"},
    ).json()
    p_child = client.post(
        f"/api/v1/families/{fam_a_id}/persons",
        json={"first_name": "Мөнх", "last_name": "Болд", "gender": "male", "birth_date": "2005-09-20"},
    ).json()

    # 3. Add marriage & parent-child relationships
    m_resp = client.post(
        f"/api/v1/families/{fam_a_id}/marriages",
        json={"person_1_id": p_father["id"], "person_2_id": p_mother["id"], "status": "married"},
    )
    assert m_resp.status_code == 201

    r1 = client.post(
        f"/api/v1/families/{fam_a_id}/relationships/parent-child",
        json={"parent_id": p_father["id"], "child_id": p_child["id"], "relationship_type": "biological"},
    )
    assert r1.status_code == 201

    r2 = client.post(
        f"/api/v1/families/{fam_a_id}/relationships/parent-child",
        json={"parent_id": p_mother["id"], "child_id": p_child["id"], "relationship_type": "biological"},
    )
    assert r2.status_code == 201

    # 4. Export Family A
    export_resp = client.get(f"/api/v1/families/{fam_a_id}/export")
    assert export_resp.status_code == 200
    export_data = export_resp.json()
    assert export_data["schema_version"] == 1
    assert len(export_data["people"]) == 3
    assert len(export_data["parent_child_relationships"]) == 2
    assert len(export_data["marriages"]) == 1

    # 5. Create Family B and import into it
    family_b = client.post("/api/v1/families", json={"name": "Хүлээн авагч гэр бүл"}).json()
    fam_b_id = family_b["id"]

    import_resp = client.post(f"/api/v1/families/{fam_b_id}/import", json=export_data)
    assert import_resp.status_code == 200
    res_b = import_resp.json()
    assert res_b["success"] is True
    assert res_b["imported_people"] == 3
    assert res_b["imported_relationships"] == 2
    assert res_b["imported_marriages"] == 1

    # 6. Verify tree in Family B
    tree_b = client.get(f"/api/v1/families/{fam_b_id}/tree").json()
    assert len(tree_b["persons"]) == 3
    assert len(tree_b["parent_child_relationships"]) == 2
    assert len(tree_b["marriages"]) == 1


def test_person_minor_flag(client, database):
    assert register_verified(client, "minor-check-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Насанд хүрээгүй шалгалт"}).json()
    fid = family["id"]

    # Adult
    p_adult = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Эрдэнэ", "last_name": "Бат", "gender": "male", "birth_date": "1980-01-01", "is_alive": True},
    ).json()
    assert p_adult["is_minor"] is False

    # Minor (born 2 years ago)
    p_minor = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Бяцхан", "last_name": "Бат", "gender": "female", "birth_date": "2023-01-01", "is_alive": True},
    ).json()
    assert p_minor["is_minor"] is True

    # Person with unknown birth date -> is_minor is False
    p_unknown = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Тодорхойгүй", "last_name": "Бат", "gender": "male", "birth_date": None, "is_alive": True},
    ).json()
    assert p_unknown["is_minor"] is False

