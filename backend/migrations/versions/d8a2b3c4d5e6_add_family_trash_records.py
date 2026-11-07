"""Add family_trash_records table for trash bin and soft restore.

Revision ID: d8a2b3c4d5e6
Revises: c7f1a2b3d4e5
Create Date: 2026-11-06

"""

import sqlalchemy as sa
from alembic import op

revision = "d8a2b3c4d5e6"
down_revision = "c7f1a2b3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "family_trash_records" not in tables:
        op.create_table(
            "family_trash_records",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("family_id", sa.Uuid(), nullable=False),
            sa.Column("person_id", sa.Uuid(), nullable=False),
            sa.Column("person_name", sa.String(200), nullable=False),
            sa.Column("deleted_by", sa.Uuid(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("snapshot_data", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["person_id"], ["persons.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["deleted_by"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_family_trash_records_family_id", "family_trash_records", ["family_id"])
        op.create_index("ix_family_trash_records_person_id", "family_trash_records", ["person_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "family_trash_records" in tables:
        op.drop_table("family_trash_records")
