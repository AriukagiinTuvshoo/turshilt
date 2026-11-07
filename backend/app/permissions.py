"""Shared family membership, person lookup, and audit logging helpers."""

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


def _member(db: Session, family_id: UUID, user: User, roles: set[str] | None = None):
    member = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status_code=403, detail="Энэ гэр бүлийн мэдээллийг харах эрхгүй.")
    if roles and member.role not in roles:
        raise HTTPException(status_code=403, detail="Энэ үйлдлийг хийх эрхгүй.")
    family = db.get(Family, family_id)
    if family is None or family.archived_at is not None:
        raise HTTPException(status_code=404, detail="Гэр бүл олдсонгүй.")
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
