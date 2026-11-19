from conftest import register_verified


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


def test_family_chat_message_delete_and_permissions(client, database):
    assert register_verified(client, "chat-del-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Чат устгах тест"}).json()
    fid = family["id"]

    msg_resp = client.post(
        f"/api/v1/families/{fid}/chat/messages",
        json={"content": "Энэ зурвасыг удахгүй устгана."},
    )
    assert msg_resp.status_code == 200
    msg_id = msg_resp.json()["id"]

    # Verify message is listed
    msgs = client.get(f"/api/v1/families/{fid}/chat/messages").json()
    assert any(m["id"] == msg_id for m in msgs)

    # Delete message
    del_resp = client.delete(f"/api/v1/families/{fid}/chat/messages/{msg_id}")
    assert del_resp.status_code == 204

    # Verify message is gone
    msgs_after = client.get(f"/api/v1/families/{fid}/chat/messages").json()
    assert all(m["id"] != msg_id for m in msgs_after)


def test_namesake_import_not_collapsed(client, database):
    assert register_verified(client, "namesake-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Ижил нэртэн тест"}).json()
    fid = family["id"]

    # Two different generations with identical first_name and last_name but different birth_date
    import_payload = {
        "people": [
            {
                "id": "gen1-bat",
                "first_name": "Бат",
                "last_name": "Боржигон",
                "gender": "male",
                "birth_date": "1945-03-10",
                "is_alive": False,
            },
            {
                "id": "gen3-bat",
                "first_name": "Бат",
                "last_name": "Боржигон",
                "gender": "male",
                "birth_date": "2005-07-22",
                "is_alive": True,
            },
        ],
        "parent_child_relationships": [
            {
                "parent_id": "gen1-bat",
                "child_id": "gen3-bat",
                "relationship_type": "biological",
            }
        ],
        "marriages": [],
    }

    resp = client.post(f"/api/v1/families/{fid}/import", json=import_payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported_people"] == 2
    assert data["imported_relationships"] == 1

    persons = client.get(f"/api/v1/families/{fid}/persons").json()
    bats = [p for p in persons if p["first_name"] == "Бат"]
    assert len(bats) == 2


def test_person_merge_transfers_relationships_and_marriages(client, database):
    assert register_verified(client, "merge-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Нэгтгэх тест гэр бүл"}).json()
    fid = family["id"]

    # Create target person (missing birth_place) and duplicate source person (has birth_place, child, spouse)
    target = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Дорж", "last_name": "Боржигон", "gender": "male", "birth_date": "1970-01-01"},
    ).json()
    source = client.post(
        f"/api/v1/families/{fid}/persons",
        json={
            "first_name": "Дорж",
            "last_name": "Боржигон",
            "gender": "male",
            "birth_date": "1970-01-01",
            "birth_place": "Архангай",
            "short_description": "Ахмад багш",
        },
    ).json()
    spouse = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Сараа", "last_name": "Хөх", "gender": "female", "birth_date": "1972-04-04"},
    ).json()
    child = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Төгөлдөр", "last_name": "Дорж", "gender": "male", "birth_date": "1998-09-01"},
    ).json()

    # Link child and spouse to source (the duplicate)
    assert (
        client.post(
            f"/api/v1/families/{fid}/relationships/parent-child",
            json={"parent_id": source["id"], "child_id": child["id"], "relationship_type": "biological"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/v1/families/{fid}/marriages",
            json={"person_1_id": source["id"], "person_2_id": spouse["id"], "status": "married"},
        ).status_code
        == 201
    )

    # Merge source into target
    merge_resp = client.post(f"/api/v1/families/{fid}/persons/{target['id']}/merge/{source['id']}")
    assert merge_resp.status_code == 200
    mdata = merge_resp.json()
    assert mdata["merged"] is True
    assert mdata["transferred_relationships"] == 1
    assert mdata["transferred_marriages"] == 1

    # Verify target now has birth_place, child, and spouse, and source is no longer in active people
    tree = client.get(f"/api/v1/families/{fid}/tree").json()
    person_ids = [p["id"] for p in tree["persons"]]
    assert target["id"] in person_ids
    assert source["id"] not in person_ids

    target_after = client.get(f"/api/v1/families/{fid}/persons/{target['id']}").json()
    assert target_after["birth_place"] == "Архангай"
    assert target_after["short_description"] == "Ахмад багш"

    assert any(
        e["parent_id"] == target["id"] and e["child_id"] == child["id"]
        for e in tree["parent_child_relationships"]
    )
    assert any(
        target["id"] in (m["person_1_id"], m["person_2_id"])
        and spouse["id"] in (m["person_1_id"], m["person_2_id"])
        for m in tree["marriages"]
    )


def test_person_merge_transfers_user_link_and_lineage(client, database):
    assert register_verified(client, "merge-fk-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "FK Нэгтгэх тест"}).json()
    fid = family["id"]

    target = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Болд", "last_name": "Боржигон", "gender": "male"},
    ).json()
    source = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Болд", "last_name": "Боржигон", "gender": "male"},
    ).json()

    # Link logged-in user to source person
    assert client.post(f"/api/v1/families/{fid}/persons/{source['id']}/link-me").status_code == 204
    assert client.get("/api/v1/auth/me").json()["person_id"] == source["id"]

    # Create lineage and assign it to source person
    lineage = client.post(
        f"/api/v1/families/{fid}/lineages",
        json={"name": "Хиад Боржигон"},
    ).json()
    assign_resp = client.put(
        f"/api/v1/families/{fid}/persons/{source['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"]},
    )
    assert assign_resp.status_code == 200

    # Merge source into target
    merge_resp = client.post(f"/api/v1/families/{fid}/persons/{target['id']}/merge/{source['id']}")
    assert merge_resp.status_code == 200

    # Verify UserPersonLink moved to target
    assert client.get("/api/v1/auth/me").json()["person_id"] == target["id"]

    # Verify PersonLineageAssignment moved to target
    tree = client.get(f"/api/v1/families/{fid}/tree").json()
    target_node = next(p for p in tree["persons"] if p["id"] == target["id"])
    assert target_node["lineage_id"] == lineage["id"]
    assert target_node["lineage_name"] == "Хиад Боржигон"


def test_profile_photo_url_validation(client, database):
    assert register_verified(client, "photo-url-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Зураг URL тест"}).json()
    fid = family["id"]

    # Malicious / unsupported URL schemes must be rejected with 422
    for bad_url in (
        "javascript:alert(1)",
        "data:image/svg+xml,<svg onload=alert(1)>",
        "//evil.example.com/pixel.png",
        "ftp://example.com/a.jpg",
    ):
        resp = client.post(
            f"/api/v1/families/{fid}/persons",
            json={"first_name": "Тест", "last_name": "Хүн", "profile_photo_url": bad_url},
        )
        assert resp.status_code == 422, f"Expected 422 for {bad_url}, got {resp.status_code}"

    # Valid https and relative / paths must be accepted
    p_ok = client.post(
        f"/api/v1/families/{fid}/persons",
        json={
            "first_name": "Зөв",
            "last_name": "Хүн",
            "profile_photo_url": "https://example.com/avatar.jpg",
        },
    )
    assert p_ok.status_code == 201
    pid = p_ok.json()["id"]
    profile_1 = client.get(f"/api/v1/families/{fid}/persons/{pid}").json()
    assert profile_1["profile_photo_url"] == "https://example.com/avatar.jpg"

    patch_ok = client.patch(
        f"/api/v1/families/{fid}/persons/{pid}",
        json={"profile_photo_url": "/uploads/avatar.webp"},
    )
    assert patch_ok.status_code == 200
    profile_2 = client.get(f"/api/v1/families/{fid}/persons/{pid}").json()
    assert profile_2["profile_photo_url"] == "/uploads/avatar.webp"

    # PATCH must also reject javascript: URLs
    patch_bad = client.patch(
        f"/api/v1/families/{fid}/persons/{pid}",
        json={"profile_photo_url": "javascript:void(0)"},
    )
    assert patch_bad.status_code == 422




