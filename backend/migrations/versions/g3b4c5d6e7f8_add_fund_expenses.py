"""Add fund_expenses ledger table for FamilyFund disbursements.

Revision ID: g3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-11-19

"""

import sqlalchemy as sa
from alembic import op

revision = "g3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "fund_expenses" not in tables:
        op.create_table(
            "fund_expenses",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("family_id", sa.Uuid(), nullable=False),
            sa.Column("fund_id", sa.Uuid(), nullable=False),
            sa.Column("amount_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("title", sa.String(180), nullable=False),
            sa.Column("note", sa.Text(), nullable=False),
            sa.Column("spent_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("recorded_by", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("amount_minor > 0", name="ck_fund_expense_positive_amount"),
            sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["fund_id"], ["family_funds.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["recorded_by"], ["users.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_fund_expenses_family_id", "fund_expenses", ["family_id"])
        op.create_index("ix_fund_expenses_fund_id", "fund_expenses", ["fund_id"])
        op.create_index("ix_fund_expense_fund_spent", "fund_expenses", ["fund_id", "spent_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "fund_expenses" in tables:
        op.drop_index("ix_fund_expense_fund_spent", table_name="fund_expenses")
        op.drop_index("ix_fund_expenses_fund_id", table_name="fund_expenses")
        op.drop_index("ix_fund_expenses_family_id", table_name="fund_expenses")
        op.drop_table("fund_expenses")
