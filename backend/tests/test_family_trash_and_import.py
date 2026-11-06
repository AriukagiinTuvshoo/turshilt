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
