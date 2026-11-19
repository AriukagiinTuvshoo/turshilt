"""Shared family membership, granular permission engine, person lookup, and audit logging helpers."""

import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    Family,
    FamilyMember,
    FamilyPerson,
    Person,
    User,
    UserPersonLink,
)
from app.observability import request_id_context

ALL_PERMISSION_SCOPES: tuple[str, ...] = (
    "manage_people",
    "manage_content",
    "manage_members",
    "manage_finance",
    "manage_data",
    "view_audit",
    "manage_settings",
)
VALID_PERMISSION_SET: frozenset[str] = frozenset(ALL_PERMISSION_SCOPES)
DEFAULT_ADMIN_PERMISSIONS: tuple[str, ...] = ALL_PERMISSION_SCOPES
DEFAULT_EDITOR_PERMISSIONS: tuple[str, ...] = (
    "manage_people",
    "manage_content",
    "manage_data",
    "manage_settings",
)


def parse_permissions_json(raw: str | None) -> list[str] | None:
    """Safely parse persisted permission JSON list preserving canonical scope order."""
    if raw is None:
        return None
    try:
        loaded = json.loads(raw)
    except (ValueError, TypeError):
        return []
    if not isinstance(loaded, list):
        return []
    selected = {item for item in loaded if isinstance(item, str) and item in VALID_PERMISSION_SET}
    return [scope for scope in ALL_PERMISSION_SCOPES if scope in selected]


def serialize_permissions(perms: list[str]) -> str:
    """Validate and serialize a permission list in canonical scope order."""
    invalid = [item for item in perms if item not in VALID_PERMISSION_SET]
    if invalid:
        raise ValueError(f"Буруу админ эрхийн төрөл: {', '.join(invalid)}")
    selected = set(perms)
    canonical = [scope for scope in ALL_PERMISSION_SCOPES if scope in selected]
    return json.dumps(canonical, separators=(",", ":"))


def effective_permissions(member: FamilyMember) -> list[str]:
    """Resolve effective granular permissions for a FamilyMember based on role and custom scopes."""
    if member.role == "owner":
        return list(ALL_PERMISSION_SCOPES)
    if member.role == "admin":
        parsed = parse_permissions_json(member.permissions_json)
        return list(DEFAULT_ADMIN_PERMISSIONS) if parsed is None else parsed
    if member.role == "editor":
        return list(DEFAULT_EDITOR_PERMISSIONS)
    return []


def has_permission(member: FamilyMember, permission: str) -> bool:
    """Check whether a FamilyMember holds the requested permission scope."""
    if member.role == "owner":
        return True
    return permission in effective_permissions(member)


def _member(
    db: Session,
    family_id: UUID,
    user: User,
    roles: set[str] | None = None,
    *,
    permission: str | None = None,
):
    member = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status_code=403, detail="Энэ гэр бүлийн мэдээллийг харах эрхгүй.")
    family = db.get(Family, family_id)
    if family is None or family.archived_at is not None:
        raise HTTPException(status_code=404, detail="Гэр бүл олдсонгүй.")
    if permission is not None:
        if not has_permission(member, permission):
            raise HTTPException(status_code=403, detail="Энэ үйлдлийг хийх эрхгүй.")
    elif roles:
        allowed_roles = roles | {"admin"} if roles == {"owner", "editor"} else roles
        if member.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Энэ үйлдлийг хийх эрхгүй.")
    return member, family


def _person_in_family(db: Session, family_id: UUID, person_id: UUID) -> Person:
    person = db.scalar(
        select(Person)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id, Person.id == person_id)
    )
    if person is None:
        raise HTTPException(status_code=404, detail="Хүн олдсонгүй.")
    return person


def _assert_person_visible(db: Session, person: Person, user: User) -> None:
    if person.visibility == "private":
        linked_to_user = db.scalar(
            select(UserPersonLink.id).where(
                UserPersonLink.user_id == user.id, UserPersonLink.person_id == person.id
            )
        )
        if person.created_by != user.id and linked_to_user is None:
            raise HTTPException(status_code=404, detail="Хүн олдсонгүй.")


def _commit(db: Session, message: str):
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail=message) from error


def _audit(
    db: Session,
    user: User,
    family_id: UUID | None,
    action: str,
    target_type: str,
    target_id: UUID | None,
) -> None:
    db.add(
        AuditLog(
            actor_id=user.id,
            family_id=family_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            request_id=request_id_context.get(),
        )
    )
