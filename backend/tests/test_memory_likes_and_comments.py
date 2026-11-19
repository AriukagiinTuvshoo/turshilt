"""Tests for family memory heart likes (❤️) and threaded comments."""

from conftest import register_verified


def test_memory_heart_like_toggle_and_counts(client):
    register_verified(client, "memory-like@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Дурсамжийн Зүрх"}).json()["id"]

    mem_res = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={
            "title": "Наадмын дурсамж",
            "description": "Хүй долоон худагт",
            "memory_date": "2024-07-11",
            "visibility": "family",
            "person_ids": [],
        },
    )
    assert mem_res.status_code == 201
    memory_id = mem_res.json()["id"]

    # Initially 0 likes
    detail_0 = client.get(f"/api/v1/families/{family_id}/memories/{memory_id}").json()
    assert detail_0["like_count"] == 0
    assert detail_0["liked_by_me"] is False

    # First tap -> like
    like_1 = client.post(f"/api/v1/families/{family_id}/memories/{memory_id}/like")
    assert like_1.status_code == 200
    assert like_1.json()["liked_by_me"] is True
    assert like_1.json()["like_count"] == 1
    assert len(like_1.json()["liked_by_names"]) == 1

    # Paginated list also reflects like_count and liked_by_me
    page_1 = client.get(f"/api/v1/families/{family_id}/memories").json()
    item_1 = next(i for i in page_1["items"] if i["id"] == memory_id)
    assert item_1["like_count"] == 1
    assert item_1["liked_by_me"] is True

    # Second tap -> unlike
    like_2 = client.post(f"/api/v1/families/{family_id}/memories/{memory_id}/like")
    assert like_2.status_code == 200
    assert like_2.json()["liked_by_me"] is False
    assert like_2.json()["like_count"] == 0


def test_memory_comments_create_reply_edit_and_delete(client):
    register_verified(client, "memory-comment@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Сэтгэгдлийн Гэр Бүл"}).json()["id"]

    mem_id = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={
            "title": "Цагаан сарын золголт",
            "description": "Ахмадуудтайгаа золгов",
            "memory_date": "2025-02-01",
            "visibility": "family",
            "person_ids": [],
        },
    ).json()["id"]

    # Create root comment
    c1 = client.post(
        f"/api/v1/families/{family_id}/memories/{mem_id}/comments",
        json={"body": "Ямар сайхан дурсамж вэ!"},
    )
    assert c1.status_code == 201
    c1_id = c1.json()["id"]
    assert c1.json()["body"] == "Ямар сайхан дурсамж вэ!"
    assert c1.json()["can_edit"] is True

    # Reply to root comment
    c2 = client.post(
        f"/api/v1/families/{family_id}/memories/{mem_id}/comments",
        json={"body": "Тийм шүү, маш дулаахан өдөр байсан.", "parent_comment_id": c1_id},
    )
    assert c2.status_code == 201
    c2_id = c2.json()["id"]
    assert c2.json()["parent_comment_id"] == c1_id

    # Edit root comment
    patched = client.patch(
        f"/api/v1/families/{family_id}/memories/{mem_id}/comments/{c1_id}",
        json={"body": "Ямар сайхан дурсамж вэ! Баярлалаа."},
    )
    assert patched.status_code == 200
    assert patched.json()["body"] == "Ямар сайхан дурсамж вэ! Баярлалаа."

    # List comments
    comments = client.get(f"/api/v1/families/{family_id}/memories/{mem_id}/comments").json()
    assert len(comments) == 2

    # Check comment_count on memory detail
    detail = client.get(f"/api/v1/families/{family_id}/memories/{mem_id}").json()
    assert detail["comment_count"] == 2

    # Delete reply comment
    deleted = client.delete(f"/api/v1/families/{family_id}/memories/{mem_id}/comments/{c2_id}")
    assert deleted.status_code == 204
    assert len(client.get(f"/api/v1/families/{family_id}/memories/{mem_id}/comments").json()) == 1
