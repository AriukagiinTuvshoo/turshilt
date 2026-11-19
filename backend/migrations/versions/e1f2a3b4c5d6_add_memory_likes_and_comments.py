"""Add memory_likes and memory_comments tables for heart likes and threaded comments.

Revision ID: e1f2a3b4c5d6
Revises: d8a2b3c4d5e6
Create Date: 2026-11-19

"""

import sqlalchemy as sa
from alembic import op

revision = "e1f2a3b4c5d6"
down_revision = "d8a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "memory_likes" not in tables:
        op.create_table(
            "memory_likes",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("memory_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("memory_id", "user_id", name="uq_memory_like_user"),
        )
        op.create_index("ix_memory_likes_memory_id", "memory_likes", ["memory_id"])
        op.create_index("ix_memory_likes_user_id", "memory_likes", ["user_id"])

    if "memory_comments" not in tables:
        op.create_table(
            "memory_comments",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("memory_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("parent_comment_id", sa.Uuid(), nullable=True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["parent_comment_id"], ["memory_comments.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_memory_comments_memory_created",
            "memory_comments",
            ["memory_id", "created_at"],
        )
        op.create_index("ix_memory_comments_parent_id", "memory_comments", ["parent_comment_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "memory_comments" in tables:
        op.drop_table("memory_comments")
    if "memory_likes" in tables:
        op.drop_table("memory_likes")
