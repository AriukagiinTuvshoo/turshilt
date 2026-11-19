"""Add sub-admin role, custom admin title, and granular permissions to family members.

Revision ID: h4c5d6e7f8a9
Revises: g3b4c5d6e7f8
Create Date: 2026-11-19

"""

import sqlalchemy as sa
from alembic import op

revision = "h4c5d6e7f8a9"
down_revision = "g3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    member_cols = {col["name"] for col in inspector.get_columns("family_members")}

    with op.batch_alter_table("family_members", schema=None) as batch_op:
        if "admin_title" not in member_cols:
            batch_op.add_column(sa.Column("admin_title", sa.String(length=80), nullable=True))
        if "permissions_json" not in member_cols:
            batch_op.add_column(sa.Column("permissions_json", sa.Text(), nullable=True))
        batch_op.drop_constraint("ck_family_member_role", type_="check")
        batch_op.create_check_constraint(
            "ck_family_member_role",
            "role IN ('owner', 'admin', 'editor', 'member')",
        )

    with op.batch_alter_table("invitations", schema=None) as batch_op:
        batch_op.drop_constraint("ck_invitation_role", type_="check")
        batch_op.create_check_constraint(
            "ck_invitation_role",
            "role IN ('admin', 'editor', 'member')",
        )


def downgrade() -> None:
    op.execute("UPDATE family_members SET role = 'editor' WHERE role = 'admin'")
    op.execute("UPDATE invitations SET role = 'editor' WHERE role = 'admin'")

    with op.batch_alter_table("invitations", schema=None) as batch_op:
        batch_op.drop_constraint("ck_invitation_role", type_="check")
        batch_op.create_check_constraint(
            "ck_invitation_role",
            "role IN ('editor', 'member')",
        )

    with op.batch_alter_table("family_members", schema=None) as batch_op:
        batch_op.drop_constraint("ck_family_member_role", type_="check")
        batch_op.create_check_constraint(
            "ck_family_member_role",
            "role IN ('owner', 'editor', 'member')",
        )
        batch_op.drop_column("permissions_json")
        batch_op.drop_column("admin_title")
