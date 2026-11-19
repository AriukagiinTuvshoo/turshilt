"""Add family_funds, donations, family_events, and event_registrations tables.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-11-19

"""

import sqlalchemy as sa
from alembic import op

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "family_funds" not in tables:
        op.create_table(
            "family_funds",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("family_id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(180), nullable=False),
            sa.Column("purpose", sa.Text(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("payment_instruction", sa.Text(), nullable=False),
            sa.Column(
                "visibility",
                sa.String(12),
                nullable=False,
                server_default=sa.text("'family'"),
            ),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "visibility IN ('family', 'public')", name="ck_family_fund_visibility"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_family_funds_family_id", "family_funds", ["family_id"])

    if "donations" not in tables:
        op.create_table(
            "donations",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("family_id", sa.Uuid(), nullable=False),
            sa.Column("fund_id", sa.Uuid(), nullable=False),
            sa.Column("donor_user_id", sa.Uuid(), nullable=False),
            sa.Column("amount_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("status", sa.String(12), nullable=False),
            sa.Column("private_donor", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("confirmed_by", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("amount_minor > 0", name="ck_donation_positive_amount"),
            sa.CheckConstraint(
                "status IN ('pledged', 'reported', 'confirmed', 'cancelled')",
                name="ck_donation_status",
            ),
            sa.ForeignKeyConstraint(["confirmed_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["donor_user_id"], ["users.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["fund_id"], ["family_funds.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_donation_family_created", "donations", ["family_id", "created_at"])

    if "family_events" not in tables:
        op.create_table(
            "family_events",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("family_id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(180), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("location", sa.String(300), nullable=False),
            sa.Column("registration_deadline", sa.DateTime(timezone=True), nullable=True),
            sa.Column("capacity", sa.Integer(), nullable=True),
            sa.Column("adult_fee_minor", sa.BigInteger(), nullable=False),
            sa.Column("child_fee_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("payment_instruction", sa.Text(), nullable=False),
            sa.Column("created_by", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "capacity IS NULL OR capacity > 0",
                name="ck_family_event_positive_capacity",
            ),
            sa.CheckConstraint(
                "adult_fee_minor >= 0 AND child_fee_minor >= 0",
                name="ck_family_event_nonnegative_fees",
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_family_events_family_id", "family_events", ["family_id"])

    if "event_registrations" not in tables:
        op.create_table(
            "event_registrations",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("event_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("adult_count", sa.Integer(), nullable=False),
            sa.Column("child_count", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(12), nullable=False),
            sa.Column("payment_status", sa.String(12), nullable=False),
            sa.Column("confirmed_by", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "adult_count >= 0 AND child_count >= 0 AND adult_count + child_count > 0",
                name="ck_event_attendee_counts",
            ),
            sa.CheckConstraint(
                "status IN ('registered', 'cancelled')",
                name="ck_event_registration_status",
            ),
            sa.CheckConstraint(
                "payment_status IN ('unpaid', 'reported', 'confirmed')",
                name="ck_event_payment_status",
            ),
            sa.ForeignKeyConstraint(["confirmed_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["event_id"], ["family_events.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("event_id", "user_id", name="uq_event_registration_user"),
        )
        op.create_index("ix_event_registrations_event_id", "event_registrations", ["event_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "event_registrations" in tables:
        op.drop_table("event_registrations")
    if "family_events" in tables:
        op.drop_table("family_events")
    if "donations" in tables:
        op.drop_table("donations")
    if "family_funds" in tables:
        op.drop_table("family_funds")
