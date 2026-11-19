"""Tests for Family Funds, Donations, Family Events, and Event Registrations (RSVP)."""

from datetime import UTC, datetime, timedelta

from conftest import register_verified


def test_family_fund_creation_public_listing_and_donation_lifecycle(client):
    register_verified(client, "fund-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Өвийн Сан Гэр Бүл"}).json()["id"]

    # Create a public family fund
    fund_res = client.post(
        f"/api/v1/families/{family_id}/funds",
        json={
            "title": "Ургийн наадам 2026 сан",
            "purpose": "Зуны ургийн баярын зохион байгуулалт",
            "currency": "MNT",
            "payment_instruction": "Хаан Банк 5000123456",
            "visibility": "public",
        },
    )
    assert fund_res.status_code == 201
    fund_id = fund_res.json()["id"]
    assert fund_res.json()["is_active"] is True

    # Listed in public funds
    pub_funds = client.get("/api/v1/public/funds").json()
    assert any(f["id"] == fund_id and f["family_name"] == "Өвийн Сан Гэр Бүл" for f in pub_funds)

    # Pledge a donation
    don_res = client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/donations",
        json={"amount_minor": 5_000_000, "private_donor": False},
    )
    assert don_res.status_code == 201
    don_id = don_res.json()["id"]
    assert don_res.json()["status"] == "pledged"

    # Report payment
    rep_res = client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/donations/{don_id}/report"
    )
    assert rep_res.status_code == 200
    assert rep_res.json()["status"] == "reported"

    # Owner confirms payment
    conf_res = client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/donations/{don_id}/confirm"
    )
    assert conf_res.status_code == 200
    assert conf_res.json()["status"] == "confirmed"

    # Deactivate fund
    deact_res = client.patch(
        f"/api/v1/families/{family_id}/funds/{fund_id}/status?is_active=false"
    )
    assert deact_res.status_code == 200
    assert deact_res.json()["is_active"] is False


def test_family_event_creation_rsvp_registration_and_payment_confirmation(client):
    register_verified(client, "event-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Уулзалтын Гэр Бүл"}).json()["id"]

    starts_at = (datetime.now(UTC) + timedelta(days=20)).isoformat()
    deadline = (datetime.now(UTC) + timedelta(days=10)).isoformat()

    ev_res = client.post(
        f"/api/v1/families/{family_id}/events",
        json={
            "title": "Цагаан сарын нэгдсэн золголт",
            "description": "Ахмад настнууддаа хүндэтгэл үзүүлэх уулзалт",
            "starts_at": starts_at,
            "location": "Улаанбаатар",
            "registration_deadline": deadline,
            "capacity": 50,
            "adult_fee_minor": 2_000_000,
            "child_fee_minor": 500_000,
            "currency": "MNT",
            "payment_instruction": "Голомт банк 1100000000",
        },
    )
    assert ev_res.status_code == 201
    event_id = ev_res.json()["id"]

    # Register RSVP (2 adults, 1 child)
    reg_res = client.post(
        f"/api/v1/families/{family_id}/events/{event_id}/registrations",
        json={"adult_count": 2, "child_count": 1},
    )
    assert reg_res.status_code == 201
    reg_id = reg_res.json()["id"]
    assert reg_res.json()["status"] == "registered"
    assert reg_res.json()["payment_status"] == "unpaid"

    # Check my registration
    me_reg = client.get(
        f"/api/v1/families/{family_id}/events/{event_id}/registrations/me"
    )
    assert me_reg.status_code == 200
    assert me_reg.json()["adult_count"] == 2

    # Report payment
    rep_pay = client.post(
        f"/api/v1/families/{family_id}/events/{event_id}/registrations/me/report-payment"
    )
    assert rep_pay.status_code == 200
    assert rep_pay.json()["payment_status"] == "reported"

    # Confirm payment
    conf_pay = client.post(
        f"/api/v1/families/{family_id}/events/{event_id}/registrations/{reg_id}/confirm-payment"
    )
    assert conf_pay.status_code == 200
    assert conf_pay.json()["payment_status"] == "confirmed"
