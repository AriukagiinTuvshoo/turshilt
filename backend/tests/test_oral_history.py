"""Tests for Mongolian Oral History NLP and Life Events extraction."""

from app.oral_history import parse_oral_narrative
from tests.conftest import register_verified


def test_parse_oral_narrative_nlp():
    narrative = (
        "Би 1954 оны 5-р сард Завхан аймгийн Тосонцэнгэл суманд төрсөн. "
        "1972 онд 10 жилийн сургууль төгссөн. "
        "1978 онд МУИС төгсөөд багшаар ажилласан. "
        "1980 онд гэрлэсэн бөгөөд 1982 онд том хүү төрсөн. "
        "1990 онд Алтан гадас одон хүртсэн."
    )
    bio, milestones = parse_oral_narrative(narrative, person_name="Доржийн Бат")

    assert len(milestones) >= 5
    types = [m.event_type for m in milestones]
    assert "birth" in types
    assert "school" in types
    assert "work" in types
    assert "marriage" in types
    assert "award" in types

    # Check that birth is first
    assert milestones[0].event_type == "birth"
    assert milestones[0].event_date.year == 1954
    assert milestones[0].event_date.month == 5
    assert milestones[0].location is not None

    # Check biography mentions milestones
    assert "Доржийн Бат" in bio
    assert "1954 он" in bio


def test_oral_history_api_flow(client):
    register_verified(client, "oral-history-owner@example.com")

    # Create family
    fam_resp = client.post("/api/v1/families", json={"name": "Дашийнхан"})
    assert fam_resp.status_code == 201
    family_id = fam_resp.json()["id"]

    # Create person
    person_resp = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат", "last_name": "Даш", "gender": "male"},
    )
    assert person_resp.status_code == 201
    person_id = person_resp.json()["id"]

    narrative = (
        "Манай аав 1945 онд Архангай аймгийн Эрдэнэбулган суманд төрсөн. "
        "1968 онд ХААИС-ийг малын их эмч мэргэжлээр төгссөн. "
        "1970 онд гэр бүл болсон. "
        "1985 онд Хөдөлмөрийн гавьяаны улаан тугийн одон хүртсэн."
    )

    # 1. Preview extraction without auto-creating events
    resp = client.post(
        f"/api/v1/families/{family_id}/persons/{person_id}/oral-history/extract",
        json={
            "narrative_text": narrative,
            "auto_create_events": False,
            "update_biography": False,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["created_events_count"] == 0
    assert data["biography_updated"] is False
    assert len(data["extracted_events"]) >= 4

    # 2. Auto-create events & update biography
    resp2 = client.post(
        f"/api/v1/families/{family_id}/persons/{person_id}/oral-history/extract",
        json={
            "narrative_text": narrative,
            "auto_create_events": True,
            "update_biography": True,
        },
    )
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["created_events_count"] >= 4
    assert data2["biography_updated"] is True

    # 3. Verify events are returned in list_life_events
    events_resp = client.get(f"/api/v1/families/{family_id}/persons/{person_id}/events")
    assert events_resp.status_code == 200
    events = events_resp.json()
    assert len(events) >= 4
    event_types = [e["event_type"] for e in events]
    assert "birth" in event_types
    assert "school" in event_types

    # 4. Verify biography was updated
    bio_resp = client.get(f"/api/v1/families/{family_id}/persons/{person_id}/biography")
    assert bio_resp.status_code == 200
    assert "1945 он" in bio_resp.json()["content"]
