from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember


def test_family_chat_broadcast_and_direct(client, database):
    # Register Owner
    assert register_verified(client, "chat-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Чаттай гэр бүл"}).json()
    family_id = family["id"]
    me_owner = client.get("/api/v1/auth/me").json()

    # Register Member 2
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "chat-member2@example.com").status_code == 201
    me_m2 = client.get("/api/v1/auth/me").json()

    # Add Member 2 to Family
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(me_m2["id"]), role="member"))
        db.commit()

    # 1. Member 2 sends a general broadcast message to the family
    msg1 = client.post(
        f"/api/v1/families/{family_id}/chat/messages",
        json={"content": "Сайн байцгаана уу, гэр бүлийнхээн!"},
    )
    assert msg1.status_code == 200
    msg1_data = msg1.json()
    assert msg1_data["content"] == "Сайн байцгаана уу, гэр бүлийнхээн!"
    assert msg1_data["recipient_id"] is None
    assert msg1_data["sender_id"] == me_m2["id"]

    # 2. Member 2 sends a 1-on-1 direct message to Owner
    msg_dm = client.post(
        f"/api/v1/families/{family_id}/chat/messages",
        json={"content": "Сайн байна уу админаа, хувийн зурвас бичлээ.", "recipient_id": me_owner["id"]},
    )
    assert msg_dm.status_code == 200
    dm_data = msg_dm.json()
    assert dm_data["recipient_id"] == me_owner["id"]

    # 3. Member 2 lists broadcast messages -> should only see broadcast
    b_msgs = client.get(f"/api/v1/families/{family_id}/chat/messages")
    assert b_msgs.status_code == 200
    assert len(b_msgs.json()) == 1
    assert b_msgs.json()[0]["id"] == msg1_data["id"]

    # 4. Member 2 lists direct messages with Owner -> should see dm
    dm_msgs = client.get(f"/api/v1/families/{family_id}/chat/messages?recipient_id={me_owner['id']}")
    assert dm_msgs.status_code == 200
    assert len(dm_msgs.json()) == 1
    assert dm_msgs.json()[0]["id"] == dm_data["id"]

    # 5. Switch to Owner and verify Owner sees both
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "chat-owner@example.com", "password": "strong-passphrase-123"},
    ).status_code == 200

    owner_b = client.get(f"/api/v1/families/{family_id}/chat/messages").json()
    assert len(owner_b) == 1
    assert owner_b[0]["content"] == "Сайн байцгаана уу, гэр бүлийнхээн!"

    owner_dm = client.get(f"/api/v1/families/{family_id}/chat/messages?recipient_id={me_m2['id']}").json()
    assert len(owner_dm) == 1
    assert owner_dm[0]["content"] == "Сайн байна уу админаа, хувийн зурвас бичлээ."

    # 6. Check members list
    res = client.get(f"/api/v1/families/{family_id}/chat/members")
    assert res.status_code == 200
    members = res.json()
    assert len(members) == 2
    user_ids = {m["user_id"] for m in members}
    assert me_owner["id"] in user_ids
    assert me_m2["id"] in user_ids

    # 7. Outsider cannot access or send chat
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "chat-outsider@example.com").status_code == 201
    assert client.get(f"/api/v1/families/{family_id}/chat/messages").status_code == 403
    assert client.post(
        f"/api/v1/families/{family_id}/chat/messages",
        json={"content": "Би хамаагүй хүн"},
    ).status_code == 403


def test_family_chat_sse_stream_auth_and_event_delivery(client):
    assert register_verified(client, "sse-owner@example.com").status_code == 201
    family_id = client.post("/api/v1/families", json={"name": "SSE Чат"}).json()["id"]

    # Authorized member receives event: connected SSE stream
    stream_res = client.get(f"/api/v1/families/{family_id}/chat/stream?once=true")
    assert stream_res.status_code == 200
    assert stream_res.headers["content-type"].startswith("text/event-stream")
    assert "no-cache" in stream_res.headers.get("cache-control", "").lower()
    assert "event: connected" in stream_res.text
    assert family_id in stream_res.text

    # Non-member receives 403
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "sse-stranger@example.com").status_code == 201
    assert client.get(f"/api/v1/families/{family_id}/chat/stream?once=true").status_code == 403

    # Unauthenticated user receives 401
    client.post("/api/v1/auth/logout")
    assert client.get(f"/api/v1/families/{family_id}/chat/stream?once=true").status_code == 401
