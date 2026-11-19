"""Tests for listing, deleting, and smart-connecting parent-child, marriage, and sibling relationships."""

from conftest import register_verified


def test_list_and_delete_parent_child_relationships(client):
    register_verified(client, "rel-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Ургийн Холбоос Гэр Бүл"}).json()["id"]

    father = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат", "last_name": "Дорж", "gender": "male"},
    ).json()
    child1 = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Тэмүүлэн", "last_name": "Бат", "gender": "male"},
    ).json()
    child2 = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Анударь", "last_name": "Бат", "gender": "female"},
    ).json()

    edge1 = client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": father["id"], "child_id": child1["id"], "relationship_type": "biological"},
    )
    assert edge1.status_code == 201
    edge1_id = edge1.json()["id"]

    edge2 = client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": father["id"], "child_id": child2["id"], "relationship_type": "biological"},
    )
    assert edge2.status_code == 201

    listed = client.get(f"/api/v1/families/{family_id}/relationships/parent-child")
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    # Delete edge1 by relationship_id
    del_by_id = client.delete(f"/api/v1/families/{family_id}/relationships/parent-child/{edge1_id}")
    assert del_by_id.status_code == 204

    listed_after_1 = client.get(f"/api/v1/families/{family_id}/relationships/parent-child").json()
    assert len(listed_after_1) == 1
    assert listed_after_1[0]["child_id"] == child2["id"]

    # Delete edge2 by parent_id + child_id query params
    del_by_pair = client.delete(
        f"/api/v1/families/{family_id}/relationships/parent-child"
        f"?parent_id={father['id']}&child_id={child2['id']}"
    )
    assert del_by_pair.status_code == 204
    assert client.get(f"/api/v1/families/{family_id}/relationships/parent-child").json() == []


def test_smart_connect_parent_auto_marries_coparent_and_wires_siblings(client):
    register_verified(client, "smart-connect@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Ухаалаг Ураг"}).json()["id"]

    father = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Эрдэнэ", "last_name": "Боржигон", "gender": "male"},
    ).json()
    son = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Төгөлдөр", "last_name": "Эрдэнэ", "gender": "male"},
    ).json()
    daughter = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Сарангуа", "last_name": "Эрдэнэ", "gender": "female"},
    ).json()

    # Connect father -> son and father -> daughter
    assert (
        client.post(
            f"/api/v1/families/{family_id}/relationships/parent-child",
            json={"parent_id": father["id"], "child_id": son["id"]},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/v1/families/{family_id}/relationships/parent-child",
            json={"parent_id": father["id"], "child_id": daughter["id"]},
        ).status_code
        == 201
    )

    # Create mother and smart-connect as mother of son -> should auto-marry father & wire daughter
    mother = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Оюун", "last_name": "Сартуул", "gender": "female"},
    ).json()

    res = client.post(
        f"/api/v1/families/{family_id}/relationships/smart-connect",
        json={
            "anchor_person_id": son["id"],
            "target_person_id": mother["id"],
            "role": "mother",
            "auto_marry_coparent": True,
            "apply_to_siblings": True,
        },
    )
    assert res.status_code == 201
    data = res.json()
    assert data["created_parent_child_edges"] == 2
    assert data["created_marriages"] == 1

    # Verify daughter also has mother as parent
    daughter_profile = client.get(f"/api/v1/families/{family_id}/persons/{daughter['id']}").json()
    parent_ids = {p["id"] for p in daughter_profile["parents"]}
    assert parent_ids == {father["id"], mother["id"]}

    # Verify marriage exists between father and mother
    marriages = client.get(f"/api/v1/families/{family_id}/marriages").json()
    assert len(marriages) == 1


def test_smart_connect_sibling_without_existing_parents_creates_shared_parent(client):
    register_verified(client, "sibling-connect@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Ах Дүүс"}).json()["id"]

    brother1 = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Амар", "last_name": "Ганболд", "gender": "male"},
    ).json()
    brother2 = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Түвшин", "last_name": "Ганболд", "gender": "male"},
    ).json()

    res = client.post(
        f"/api/v1/families/{family_id}/relationships/smart-connect",
        json={
            "anchor_person_id": brother1["id"],
            "target_person_id": brother2["id"],
            "role": "sibling",
            "create_shared_parent_first_name": "Ганболд",
            "create_shared_parent_last_name": "Дорж",
            "create_shared_parent_gender": "male",
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["created_parent_child_edges"] == 2
    assert body["created_shared_parent_id"] is not None

    kinship = client.get(
        f"/api/v1/families/{family_id}/kinship"
        f"?person_1_id={brother1['id']}&person_2_id={brother2['id']}"
    )
    assert kinship.status_code == 200
    assert kinship.json()["relationship_title"] == "Төрсөн ах / эгч / дүү"
