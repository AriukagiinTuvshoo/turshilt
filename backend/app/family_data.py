"""Family Trash Bin, Soft Restore, and Data Export/Import endpoints."""

import json
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import (
    AuditLog,
    Family,
    FamilyMember,
    FamilyPerson,
    FamilyTrashRecord,
    Marriage,
    ParentChildRelationship,
    Person,
    User,
)
from app.observability import request_id_context
from app.person_search import normalize_search_name
from app.relationships import (
    RelationshipError,
    assert_parent_child_is_acyclic,
    canonical_pair,
)

router = APIRouter()


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


class FamilyTrashOut(BaseModel):
    id: UUID
    person_id: UUID
    person_name: str
    deleted_at: datetime
    deleted_by_name: str


@router.get("/{family_id}/trash", response_model=list[FamilyTrashOut])
def list_family_trash(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})

    # Auto-prune trash records older than 30 days
    cutoff = datetime.now(UTC) - timedelta(days=30)
    db.execute(
        delete(FamilyTrashRecord).where(
            FamilyTrashRecord.family_id == family_id,
            FamilyTrashRecord.deleted_at < cutoff,
        )
    )
    db.commit()

    rows = db.execute(
        select(FamilyTrashRecord, User.display_name)
        .join(User, User.id == FamilyTrashRecord.deleted_by)
        .where(FamilyTrashRecord.family_id == family_id)
        .order_by(FamilyTrashRecord.deleted_at.desc())
    ).all()

    return [
        FamilyTrashOut(
            id=t.id,
            person_id=t.person_id,
            person_name=t.person_name,
            deleted_at=t.deleted_at,
            deleted_by_name=disp or "Админ",
        )
        for t, disp in rows
    ]


@router.post("/{family_id}/trash/{trash_id}/restore")
def restore_trash_person(
    family_id: UUID,
    trash_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    trash = db.scalar(
        select(FamilyTrashRecord).where(
            FamilyTrashRecord.id == trash_id,
            FamilyTrashRecord.family_id == family_id,
        )
    )
    if trash is None:
        raise HTTPException(status_code=404, detail="Хогийн саванд уг бүртгэл олдсонгүй.")

    person = db.get(Person, trash.person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="Уг хүний өгөгдөл олдсонгүй.")

    existing_fp = db.scalar(
        select(FamilyPerson).where(
            FamilyPerson.family_id == family_id,
            FamilyPerson.person_id == person.id,
        )
    )
    if existing_fp is None:
        db.add(FamilyPerson(family_id=family_id, person_id=person.id, added_by=user.id))

    if trash.snapshot_data:
        try:
            snap = json.loads(trash.snapshot_data)
            edges = snap.get("edges", [])
            for e in edges:
                try:
                    p_id = UUID(e["parent_id"])
                    c_id = UUID(e["child_id"])
                    p_in_fam = db.scalar(
                        select(FamilyPerson).where(
                            FamilyPerson.family_id == family_id,
                            FamilyPerson.person_id == p_id,
                        )
                    )
                    c_in_fam = db.scalar(
                        select(FamilyPerson).where(
                            FamilyPerson.family_id == family_id,
                            FamilyPerson.person_id == c_id,
                        )
                    )
                    if p_in_fam and c_in_fam:
                        edge_exists = db.scalar(
                            select(ParentChildRelationship).where(
                                ParentChildRelationship.parent_id == p_id,
                                ParentChildRelationship.child_id == c_id,
                            )
                        )
                        if not edge_exists:
                            family_person_ids = select(FamilyPerson.person_id).where(
                                FamilyPerson.family_id == family_id
                            )
                            existing_edges = db.execute(
                                select(
                                    ParentChildRelationship.parent_id,
                                    ParentChildRelationship.child_id,
                                ).where(
                                    ParentChildRelationship.parent_id.in_(family_person_ids),
                                    ParentChildRelationship.child_id.in_(family_person_ids),
                                )
                            ).all()
                            assert_parent_child_is_acyclic(existing_edges, p_id, c_id)
                            db.add(
                                ParentChildRelationship(
                                    parent_id=p_id,
                                    child_id=c_id,
                                    relationship_type=e.get("type", "biological"),
                                    created_by=user.id,
                                )
                            )
                except (ValueError, KeyError, TypeError, RelationshipError) as err:
                    logging.getLogger("guulingiinhan.api").warning("Edge restoration skipped: %s", err)

            marriages = snap.get("marriages", [])
            for m in marriages:
                try:
                    p1_raw = m.get("person_1_id") or m.get("spouse1_id")
                    p2_raw = m.get("person_2_id") or m.get("spouse2_id")
                    if p1_raw and p2_raw:
                        p1_id, p2_id = canonical_pair(UUID(p1_raw), UUID(p2_raw))
                        p1_in = db.scalar(
                            select(FamilyPerson).where(
                                FamilyPerson.family_id == family_id,
                                FamilyPerson.person_id == p1_id,
                            )
                        )
                        p2_in = db.scalar(
                            select(FamilyPerson).where(
                                FamilyPerson.family_id == family_id,
                                FamilyPerson.person_id == p2_id,
                            )
                        )
                        if p1_in and p2_in:
                            m_exists = db.scalar(
                                select(Marriage).where(
                                    Marriage.person_1_id == p1_id,
                                    Marriage.person_2_id == p2_id,
                                )
                            )
                            if not m_exists:
                                db.add(
                                    Marriage(
                                        person_1_id=p1_id,
                                        person_2_id=p2_id,
                                        status=m.get("status") or "married",
                                        start_date=date.fromisoformat(m["start_date"].split("T")[0]) if m.get("start_date") else None,
                                        end_date=date.fromisoformat(m["end_date"].split("T")[0]) if m.get("end_date") else None,
                                        created_by=user.id,
                                    )
                                )
                except (ValueError, KeyError, TypeError) as err:
                    logging.getLogger("guulingiinhan.api").warning("Marriage restoration skipped: %s", err)
        except (ValueError, KeyError, TypeError) as err:
            logging.getLogger("guulingiinhan.api").warning("Trash snapshot parse error: %s", err)

    _audit(db, user, family_id, "person.restored", "person", person.id)
    db.delete(trash)
    db.commit()
    return {"restored": True, "person_id": str(person.id), "person_name": trash.person_name}


@router.delete("/{family_id}/trash/{trash_id}", status_code=204)
def purge_trash_person(
    family_id: UUID,
    trash_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    trash = db.scalar(
        select(FamilyTrashRecord).where(
            FamilyTrashRecord.id == trash_id,
            FamilyTrashRecord.family_id == family_id,
        )
    )
    if trash:
        _audit(db, user, family_id, "trash.purged", "person", trash.person_id)
        db.delete(trash)
        db.commit()
    return Response(status_code=204)


@router.post("/{family_id}/trash/empty", status_code=204)
def empty_family_trash(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    records = db.scalars(
        select(FamilyTrashRecord).where(FamilyTrashRecord.family_id == family_id)
    ).all()
    for rec in records:
        db.delete(rec)
    _audit(db, user, family_id, "trash.emptied", "family", family_id)
    db.commit()
    return Response(status_code=204)


class FamilyExportOut(BaseModel):
    schema_version: int = 1
    family: dict[str, Any]
    exported_at: datetime
    people: list[dict[str, Any]]
    parent_child_relationships: list[dict[str, Any]]
    marriages: list[dict[str, Any]]


@router.get("/{family_id}/export", response_model=FamilyExportOut)
def export_family_backup_data(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _, family = _member(db, family_id, user, {"owner", "editor"})

    persons = list(
        db.scalars(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(FamilyPerson.family_id == family_id)
            .order_by(Person.created_at.asc())
        ).all()
    )

    person_ids = [p.id for p in persons]

    edges = (
        list(
            db.scalars(
                select(ParentChildRelationship).where(
                    ParentChildRelationship.parent_id.in_(person_ids),
                    ParentChildRelationship.child_id.in_(person_ids),
                )
            ).all()
        )
        if person_ids
        else []
    )

    marriages = (
        list(
            db.scalars(
                select(Marriage).where(
                    Marriage.person_1_id.in_(person_ids),
                    Marriage.person_2_id.in_(person_ids),
                    Marriage.deleted_at.is_(None),
                )
            ).all()
        )
        if person_ids
        else []
    )

    sanitized_people = [
        {
            "id": str(p.id),
            "first_name": p.first_name,
            "last_name": p.last_name,
            "middle_name": p.middle_name,
            "nickname": p.nickname,
            "gender": p.gender,
            "birth_date": p.birth_date.isoformat() if p.birth_date else None,
            "birth_place": p.birth_place,
            "is_alive": p.is_alive,
            "death_date": p.death_date.isoformat() if p.death_date else None,
            "death_place": p.death_place,
            "short_description": p.short_description,
            "visibility": p.visibility,
        }
        for p in persons
    ]

    sanitized_edges = [
        {
            "id": str(e.id),
            "parent_id": str(e.parent_id),
            "child_id": str(e.child_id),
            "relationship_type": e.relationship_type,
        }
        for e in edges
    ]

    sanitized_marriages = [
        {
            "id": str(m.id),
            "person_1_id": str(m.person_1_id),
            "person_2_id": str(m.person_2_id),
            "status": m.status,
            "start_date": m.start_date.isoformat() if m.start_date else None,
            "end_date": m.end_date.isoformat() if m.end_date else None,
        }
        for m in marriages
    ]

    _audit(db, user, family_id, "data.exported", "family", family_id)

    return FamilyExportOut(
        schema_version=1,
        family={"id": str(family.id), "name": family.name, "description": family.description},
        exported_at=datetime.now(UTC),
        people=sanitized_people,
        parent_child_relationships=sanitized_edges,
        marriages=sanitized_marriages,
    )


class ImportedPerson(BaseModel):
    id: str | None = None
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    middle_name: str | None = Field(default=None, max_length=120)
    nickname: str | None = Field(default=None, max_length=120)
    gender: str = Field(default="male")
    birth_date: date | str | None = None
    birth_place: str | None = Field(default=None, max_length=240)
    is_alive: bool = True
    death_date: date | str | None = None
    death_place: str | None = Field(default=None, max_length=240)
    short_description: str | None = Field(default=None, max_length=1000)
    visibility: str = Field(default="family")


class ImportedParentChild(BaseModel):
    parent_id: str
    child_id: str
    relationship_type: str = Field(default="biological")


class ImportedMarriage(BaseModel):
    person_1_id: str | None = None
    person_2_id: str | None = None
    spouse1_id: str | None = None
    spouse2_id: str | None = None
    status: str = Field(default="married")
    start_date: date | str | None = None
    end_date: date | str | None = None


class FamilyImportInput(BaseModel):
    schema_version: int = 1
    people: list[ImportedPerson] = Field(default_factory=list, max_length=5000)
    parent_child_relationships: list[ImportedParentChild] = Field(default_factory=list, max_length=10000)
    marriages: list[ImportedMarriage] = Field(default_factory=list, max_length=5000)
    dry_run: bool = False


class FamilyImportResultOut(BaseModel):
    success: bool
    dry_run: bool
    imported_people: int
    imported_relationships: int
    imported_marriages: int
    warnings: list[str] = []


@router.post("/{family_id}/import", response_model=FamilyImportResultOut)
def import_family_backup_data(
    family_id: UUID,
    payload: FamilyImportInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})

    def _parse_iso_date(val: object) -> date | None:
        if not val:
            return None
        if isinstance(val, date):
            return val
        try:
            return date.fromisoformat(str(val).split("T")[0])
        except (ValueError, TypeError):
            return None

    id_map: dict[str, UUID] = {}
    imported_people_count = 0
    imported_edges_count = 0
    imported_marriages_count = 0
    warnings: list[str] = []

    for p_data in payload.people:
        first_name = p_data.first_name.strip()
        last_name = p_data.last_name.strip()
        if not first_name:
            continue

        raw_old_id = str(p_data.id or "")
        existing = db.scalar(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(
                FamilyPerson.family_id == family_id,
                Person.first_name == first_name,
                Person.last_name == last_name,
            )
        )
        if existing:
            if raw_old_id:
                id_map[raw_old_id] = existing.id
            continue

        new_person = Person(
            first_name=first_name,
            last_name=last_name,
            middle_name=p_data.middle_name,
            nickname=p_data.nickname,
            gender=p_data.gender if p_data.gender in {"male", "female", "other", "unknown"} else "male",
            birth_date=_parse_iso_date(p_data.birth_date),
            birth_place=p_data.birth_place,
            is_alive=bool(p_data.is_alive),
            death_date=_parse_iso_date(p_data.death_date),
            death_place=p_data.death_place,
            short_description=p_data.short_description,
            visibility=p_data.visibility if p_data.visibility in {"private", "family", "public"} else "family",
            search_first_name=normalize_search_name(first_name),
            search_last_name=normalize_search_name(last_name),
            search_middle_name=normalize_search_name(p_data.middle_name),
            created_by=user.id,
        )
        if not payload.dry_run:
            db.add(new_person)
            db.flush()
            db.add(FamilyPerson(family_id=family_id, person_id=new_person.id, added_by=user.id))
        imported_people_count += 1
        if raw_old_id:
            id_map[raw_old_id] = new_person.id

    family_person_ids = select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    simulated_edges = list(
        db.execute(
            select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
                ParentChildRelationship.parent_id.in_(family_person_ids),
                ParentChildRelationship.child_id.in_(family_person_ids),
            )
        ).all()
    )

    for rel in payload.parent_child_relationships:
        raw_p = str(rel.parent_id or "")
        raw_c = str(rel.child_id or "")
        try:
            p_id = id_map.get(raw_p) or (UUID(raw_p) if raw_p else None)
            c_id = id_map.get(raw_c) or (UUID(raw_c) if raw_c else None)
        except ValueError:
            warnings.append(f"Invalid UUID in relationship: {raw_p} -> {raw_c}")
            continue

        if p_id and c_id and p_id != c_id:
            exists = any(parent == p_id and child == c_id for parent, child in simulated_edges)
            if not exists:
                try:
                    assert_parent_child_is_acyclic(simulated_edges, p_id, c_id)
                    simulated_edges.append((p_id, c_id))
                    if not payload.dry_run:
                        db.add(
                            ParentChildRelationship(
                                parent_id=p_id,
                                child_id=c_id,
                                relationship_type=rel.relationship_type if rel.relationship_type in {"biological", "adoptive"} else "biological",
                                created_by=user.id,
                            )
                        )
                    imported_edges_count += 1
                except RelationshipError as err:
                    warnings.append(f"Cycle prevented for edge {p_id} -> {c_id}: {err}")

    for m in payload.marriages:
        raw_s1 = str(m.person_1_id or m.spouse1_id or "")
        raw_s2 = str(m.person_2_id or m.spouse2_id or "")
        try:
            s1_id = id_map.get(raw_s1) or (UUID(raw_s1) if raw_s1 else None)
            s2_id = id_map.get(raw_s2) or (UUID(raw_s2) if raw_s2 else None)
        except ValueError:
            warnings.append(f"Invalid UUID in marriage: {raw_s1} <-> {raw_s2}")
            continue

        if s1_id and s2_id and s1_id != s2_id:
            p1, p2 = canonical_pair(s1_id, s2_id)
            exists = db.scalar(
                select(Marriage).where(
                    Marriage.person_1_id == p1,
                    Marriage.person_2_id == p2,
                )
            )
            if not exists:
                if not payload.dry_run:
                    db.add(
                        Marriage(
                            person_1_id=p1,
                            person_2_id=p2,
                            status=m.status if m.status in {"married", "divorced", "widowed"} else "married",
                            start_date=_parse_iso_date(m.start_date),
                            end_date=_parse_iso_date(m.end_date),
                            created_by=user.id,
                        )
                    )
                imported_marriages_count += 1

    if not payload.dry_run:
        _audit(db, user, family_id, "data.imported", "family", family_id)
        db.commit()

    return FamilyImportResultOut(
        success=True,
        dry_run=payload.dry_run,
        imported_people=imported_people_count,
        imported_relationships=imported_edges_count,
        imported_marriages=imported_marriages_count,
        warnings=warnings,
    )
