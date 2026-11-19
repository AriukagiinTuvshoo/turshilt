"""Add parent_family_id link on families for connecting household branches to the main clan.

Revision ID: i5d6e7f8a9b0
Revises: h4c5d6e7f8a9
Create Date: 2026-11-19

"""

import sqlalchemy as sa
from alembic import op

revision = "i5d6e7f8a9b0"
down_revision = "h4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    family_cols = {col["name"] for col in inspector.get_columns("families")}
    family_indexes = {idx["name"] for idx in inspector.get_indexes("families")}

    with op.batch_alter_table("families", schema=None) as batch_op:
        if "parent_family_id" not in family_cols:
            batch_op.add_column(sa.Column("parent_family_id", sa.Uuid(), nullable=True))
            batch_op.create_foreign_key(
                "fk_families_parent_family_id",
                "families",
                ["parent_family_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "ix_families_parent_family_id" not in family_indexes:
            batch_op.create_index("ix_families_parent_family_id", ["parent_family_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("families", schema=None) as batch_op:
        batch_op.drop_index("ix_families_parent_family_id")
        batch_op.drop_constraint("fk_families_parent_family_id", type_="foreignkey")
        batch_op.drop_column("parent_family_id")
