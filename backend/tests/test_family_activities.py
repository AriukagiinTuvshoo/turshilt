"""Tests for Family Funds, Donations, Fund Expenses, Family Events, and Event Registrations."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember


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


def test_fund_expenses_net_balance_and_transparent_confirmed_donations(client, database):
    register_verified(client, "funds-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Тайлантай Сан"}).json()["id"]

    register_verified(client, "funds-member1@example.com")
    m1_id = client.get("/api/v1/auth/me").json()["id"]

    register_verified(client, "funds-member2@example.com")
    m2_id = client.get("/api/v1/auth/me").json()["id"]

    with database() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(m1_id), role="member"))
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(m2_id), role="member"))
        db.commit()

    # Owner creates a primary fund and an empty secondary fund
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "funds-owner@example.com", "password": "strong-passphrase-123"},
        ).status_code
        == 200
    )
    fund = client.post(
        f"/api/v1/families/{family_id}/funds",
        json={
            "title": "Ургийн номын сан",
            "purpose": "Номын хэвлэл",
            "currency": "MNT",
            "payment_instruction": "Хаан Банк 5000001111",
            "visibility": "family",
        },
    ).json()
    fund_id = fund["id"]
    empty_fund_id = client.post(
        f"/api/v1/families/{family_id}/funds",
        json={
            "title": "Түр санал сан",
            "purpose": "Туршилт",
            "currency": "MNT",
            "payment_instruction": "Хаан Банк 5000002222",
        },
    ).json()["id"]

    # Empty fund can be deleted cleanly by owner
    assert client.delete(f"/api/v1/families/{family_id}/funds/{empty_fund_id}").status_code == 204

    # Member 1 pledges private donation (reported + confirmed) and Member 2 pledges public + unconfirmed pledge
    client.post(
        "/api/v1/auth/login",
        json={"email": "funds-member1@example.com", "password": "strong-passphrase-123"},
    )
    d1 = client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/donations",
        json={"amount_minor": 10_000_000, "private_donor": True},
    ).json()
    assert d1["is_mine"] is True
    assert client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/donations/{d1['id']}/report"
    ).status_code == 200

    client.post(
        "/api/v1/auth/login",
        json={"email": "funds-member2@example.com", "password": "strong-passphrase-123"},
    )
    d2 = client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/donations",
        json={"amount_minor": 5_000_000, "private_donor": False},
    ).json()
    assert (
        client.post(
            f"/api/v1/families/{family_id}/funds/{fund_id}/donations/{d2['id']}/report"
        ).status_code
        == 200
    )
    d2_pledge = client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/donations",
        json={"amount_minor": 2_000_000, "private_donor": False},
    ).json()

    # Owner confirms d1 and d2 (leaves d2_pledge unconfirmed)
    client.post(
        "/api/v1/auth/login",
        json={"email": "funds-owner@example.com", "password": "strong-passphrase-123"},
    )
    assert (
        client.post(
            f"/api/v1/families/{family_id}/funds/{fund_id}/donations/{d1['id']}/confirm"
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/families/{family_id}/funds/{fund_id}/donations/{d2['id']}/confirm"
        ).status_code
        == 200
    )

    # Owner edits fund metadata
    patched_fund = client.patch(
        f"/api/v1/families/{family_id}/funds/{fund_id}",
        json={"title": "Ургийн ном хэвлэлийн сан", "visibility": "public"},
    )
    assert patched_fund.status_code == 200
    assert patched_fund.json()["title"] == "Ургийн ном хэвлэлийн сан"
    assert patched_fund.json()["confirmed_income_minor"] == 15_000_000

    # Owner records an expense
    exp = client.post(
        f"/api/v1/families/{family_id}/funds/{fund_id}/expenses",
        json={
            "title": "Эх бэлтгэл",
            "amount_minor": 3_500_000,
            "note": "Дизайнерын төлбөр",
        },
    )
    assert exp.status_code == 201
    exp_id = exp.json()["id"]

    # Non-empty fund deletion is rejected with 409 Conflict
    assert client.delete(f"/api/v1/families/{family_id}/funds/{fund_id}").status_code == 409

    # Member 1 sees net balance, expenses, both confirmed donations (d1 redacted, d2 named), NOT d2_pledge
    client.post(
        "/api/v1/auth/login",
        json={"email": "funds-member1@example.com", "password": "strong-passphrase-123"},
    )
    m1_funds = client.get(f"/api/v1/families/{family_id}/funds").json()
    assert len(m1_funds) == 1
    assert m1_funds[0]["confirmed_income_minor"] == 15_000_000
    assert m1_funds[0]["total_expenses_minor"] == 3_500_000
    assert m1_funds[0]["net_balance_minor"] == 11_500_000

    m1_donations = client.get(f"/api/v1/families/{family_id}/funds/{fund_id}/donations").json()
    m1_donation_ids = {item["id"] for item in m1_donations}
    assert d1["id"] in m1_donation_ids
    assert d2["id"] in m1_donation_ids
    assert d2_pledge["id"] not in m1_donation_ids
    d1_view = next(item for item in m1_donations if item["id"] == d1["id"])
    assert d1_view["donor_name"] is None
    assert d1_view["is_mine"] is True
    d2_view = next(item for item in m1_donations if item["id"] == d2["id"])
    assert d2_view["is_mine"] is False
    assert d2_view["status"] == "confirmed"

    m1_expenses = client.get(f"/api/v1/families/{family_id}/funds/{fund_id}/expenses").json()
    assert len(m1_expenses) == 1
    assert m1_expenses[0]["title"] == "Эх бэлтгэл"

    # Member cannot create or delete expense
    assert (
        client.post(
            f"/api/v1/families/{family_id}/funds/{fund_id}/expenses",
            json={"title": "Зөвшөөрөлгүй", "amount_minor": 100_000},
        ).status_code
        == 403
    )
    assert (
        client.delete(f"/api/v1/families/{family_id}/funds/{fund_id}/expenses/{exp_id}").status_code
        == 403
    )

    # Owner deletes expense and net balance resets cleanly
    client.post(
        "/api/v1/auth/login",
        json={"email": "funds-owner@example.com", "password": "strong-passphrase-123"},
    )
    assert (
        client.delete(f"/api/v1/families/{family_id}/funds/{fund_id}/expenses/{exp_id}").status_code
        == 204
    )
    after_del = client.get(f"/api/v1/families/{family_id}/funds").json()[0]
    assert after_del["total_expenses_minor"] == 0
    assert after_del["net_balance_minor"] == 15_000_000


def test_event_update_capacity_guard_and_delete_protection(client):
    register_verified(client, "ev-crud-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Эвент CRUD"}).json()["id"]

    starts_at = (datetime.now(UTC) + timedelta(days=30)).isoformat()
    ev = client.post(
        f"/api/v1/families/{family_id}/events",
        json={
            "title": "Намрын уулзалт",
            "description": "Анхны төлөвлөгөө",
            "starts_at": starts_at,
            "location": "Тэрэлж",
            "capacity": 10,
            "adult_fee_minor": 1_000_000,
            "child_fee_minor": 0,
        },
    ).json()
    ev_id = ev["id"]

    # Register 3 seats
    assert (
        client.post(
            f"/api/v1/families/{family_id}/events/{ev_id}/registrations",
            json={"adult_count": 2, "child_count": 1},
        ).status_code
        == 201
    )

    # Shrinking capacity below 3 fails with 409
    assert (
        client.patch(
            f"/api/v1/families/{family_id}/events/{ev_id}",
            json={"capacity": 2},
        ).status_code
        == 409
    )

    # Deadline after starts_at fails with 422
    bad_deadline = (datetime.now(UTC) + timedelta(days=35)).isoformat()
    assert (
        client.patch(
            f"/api/v1/families/{family_id}/events/{ev_id}",
            json={"registration_deadline": bad_deadline},
        ).status_code
        == 422
    )

    # Valid update succeeds
    updated = client.patch(
        f"/api/v1/families/{family_id}/events/{ev_id}",
        json={"title": "Намрын их уулзалт", "capacity": 5, "registration_deadline": None},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Намрын их уулзалт"
    assert updated.json()["capacity"] == 5
    assert updated.json()["registration_deadline"] is None

    # After reporting payment, event deletion is protected (409)
    assert (
        client.post(
            f"/api/v1/families/{family_id}/events/{ev_id}/registrations/me/report-payment"
        ).status_code
        == 200
    )
    assert client.delete(f"/api/v1/families/{family_id}/events/{ev_id}").status_code == 409

    # A separate event without paid/reported registrations can be deleted cleanly
    ev2_id = client.post(
        f"/api/v1/families/{family_id}/events",
        json={
            "title": "Цуцалж болох уулзалт",
            "starts_at": starts_at,
            "location": "Сэлбэ",
        },
    ).json()["id"]
    assert client.delete(f"/api/v1/families/{family_id}/events/{ev2_id}").status_code == 204
