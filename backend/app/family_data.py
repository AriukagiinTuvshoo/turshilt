"""Family Trash Bin, Soft Restore, and Data Export/Import endpoints."""

import json
import logging
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import get_db
from app.maintenance import prune_expired_trash
from app.models import (
    ArchivePerson,
    Biography,
    FamilyPerson,
    FamilyTrashRecord,
    LifeEvent,
    Marriage,
    MemoryPersonTag,
    ParentChildRelationship,
    Person,
    PersonGuardianship,
    PersonLineageAssignment,
    PhotoPersonTag,
    StoryPerson,
    User,
    UserPersonLink,
)
from app.permissions import _audit, _member, _person_in_family
from app.person_search import normalize_search_name
from app.relationships import (
    RelationshipError,
    assert_parent_child_is_acyclic,
    canonical_pair,
)

router = APIRouter()


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

    prune_expired_trash(
        db,
        family_id=family_id,
        retention_days=get_settings().trash_retention_days,
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
        incoming_birth = _parse_iso_date(p_data.birth_date)
        incoming_gender = (
            p_data.gender
            if p_data.gender in {"male", "female", "other", "unknown"}
            else "male"
        )

        # 1. Exact UUID match in family (re-importing a previously exported backup)
        existing: Person | None = None
        if raw_old_id:
            try:
                old_uuid = UUID(raw_old_id)
                existing = db.scalar(
                    select(Person)
                    .join(FamilyPerson, FamilyPerson.person_id == Person.id)
                    .where(
                        FamilyPerson.family_id == family_id,
                        Person.id == old_uuid,
                    )
                )
            except ValueError:
                existing = None

        # 2. Smart name + birth_date / gender matching (prevents collapsing namesakes across generations)
        if existing is None:
            candidates = list(
                db.scalars(
                    select(Person)
                    .join(FamilyPerson, FamilyPerson.person_id == Person.id)
                    .where(
                        FamilyPerson.family_id == family_id,
                        Person.first_name == first_name,
                        Person.last_name == last_name,
                    )
                ).all()
            )
            for cand in candidates:
                if cand.gender != incoming_gender and cand.gender != "unknown" and incoming_gender != "unknown":
                    continue
                if cand.birth_date and incoming_birth and cand.birth_date != incoming_birth:
                    # Different birth dates -> different generation / namesake, do not collapse
                    continue
                existing = cand
                break

        if existing:
            if raw_old_id:
                id_map[raw_old_id] = existing.id
            continue

        new_person = Person(
            id=uuid4(),
            first_name=first_name,
            last_name=last_name,
            middle_name=p_data.middle_name,
            nickname=p_data.nickname,
            gender=incoming_gender,
            birth_date=incoming_birth,
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


class PersonMergeOut(BaseModel):
    merged: bool
    target_id: UUID
    source_id: UUID
    transferred_relationships: int
    transferred_marriages: int


@router.post(
    "/{family_id}/persons/{target_id}/merge/{source_id}",
    response_model=PersonMergeOut,
)
def merge_duplicate_persons(
    family_id: UUID,
    target_id: UUID,
    source_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    if target_id == source_id:
        raise HTTPException(
            status_code=400, detail="Ижил хүнийг өөртэй нь нэгтгэх боломжгүй."
        )

    target = _person_in_family(db, family_id, target_id)
    source = _person_in_family(db, family_id, source_id)

    # 1. Fill missing profile fields on target from source
    for attr in (
        "middle_name",
        "nickname",
        "birth_date",
        "birth_place",
        "death_date",
        "death_place",
        "short_description",
        "profile_photo_url",
    ):
        if getattr(target, attr) is None and getattr(source, attr) is not None:
            setattr(target, attr, getattr(source, attr))

    # 2. Snapshot source into FamilyTrashRecord so merge is reversible from Trash Bin
    source_edges = list(
        db.scalars(
            select(ParentChildRelationship).where(
                or_(
                    ParentChildRelationship.parent_id == source_id,
                    ParentChildRelationship.child_id == source_id,
                )
            )
        ).all()
    )
    source_marriages = list(
        db.scalars(
            select(Marriage).where(
                or_(
                    Marriage.person_1_id == source_id,
                    Marriage.person_2_id == source_id,
                )
            )
        ).all()
    )
    snapshot = {
        "merged_into": str(target_id),
        "edges": [
            {
                "parent_id": str(e.parent_id),
                "child_id": str(e.child_id),
                "type": e.relationship_type,
            }
            for e in source_edges
        ],
        "marriages": [
            {
                "person_1_id": str(m.person_1_id),
                "person_2_id": str(m.person_2_id),
                "status": m.status,
                "start_date": m.start_date.isoformat() if m.start_date else None,
                "end_date": m.end_date.isoformat() if m.end_date else None,
            }
            for m in source_marriages
        ],
    }
    db.add(
        FamilyTrashRecord(
            family_id=family_id,
            person_id=source.id,
            person_name=f"{source.last_name} {source.first_name}".strip(),
            deleted_by=user.id,
            snapshot_data=json.dumps(snapshot),
        )
    )

    # 3. Transfer parent-child relationships
    family_person_ids = select(FamilyPerson.person_id).where(
        FamilyPerson.family_id == family_id
    )
    current_edges = [
        (p, c)
        for p, c in db.execute(
            select(
                ParentChildRelationship.parent_id,
                ParentChildRelationship.child_id,
            ).where(
                ParentChildRelationship.parent_id.in_(family_person_ids),
                ParentChildRelationship.child_id.in_(family_person_ids),
            )
        ).all()
        if p != source_id and c != source_id
    ]

    transferred_rels = 0
    for edge in source_edges:
        new_parent = target_id if edge.parent_id == source_id else edge.parent_id
        new_child = target_id if edge.child_id == source_id else edge.child_id
        db.delete(edge)
        if new_parent == new_child:
            continue
        if any(p == new_parent and c == new_child for p, c in current_edges):
            continue
        try:
            assert_parent_child_is_acyclic(current_edges, new_parent, new_child)
            current_edges.append((new_parent, new_child))
            db.add(
                ParentChildRelationship(
                    parent_id=new_parent,
                    child_id=new_child,
                    relationship_type=edge.relationship_type,
                    created_by=user.id,
                )
            )
            transferred_rels += 1
        except RelationshipError:
            pass

    db.flush()

    # 4. Transfer marriages
    transferred_marriages = 0
    for m in source_marriages:
        other_spouse = m.person_2_id if m.person_1_id == source_id else m.person_1_id
        status_val = m.status
        start_val = m.start_date
        end_val = m.end_date
        db.delete(m)
        db.flush()
        if other_spouse == target_id:
            continue
        p1, p2 = canonical_pair(target_id, other_spouse)
        existing_m = db.scalar(
            select(Marriage).where(
                Marriage.person_1_id == p1,
                Marriage.person_2_id == p2,
            )
        )
        if existing_m is None:
            db.add(
                Marriage(
                    person_1_id=p1,
                    person_2_id=p2,
                    status=status_val,
                    start_date=start_val,
                    end_date=end_val,
                    created_by=user.id,
                )
            )
            transferred_marriages += 1

    # 5. Transfer content tags, life events, and biography
    for sp in db.scalars(select(StoryPerson).where(StoryPerson.person_id == source_id)).all():
        exists = db.scalar(
            select(StoryPerson).where(
                StoryPerson.story_id == sp.story_id,
                StoryPerson.person_id == target_id,
            )
        )
        if exists:
            db.delete(sp)
        else:
            sp.person_id = target_id

    for ap in db.scalars(select(ArchivePerson).where(ArchivePerson.person_id == source_id)).all():
        exists = db.scalar(
            select(ArchivePerson).where(
                ArchivePerson.archive_id == ap.archive_id,
                ArchivePerson.person_id == target_id,
            )
        )
        if exists:
            db.delete(ap)
        else:
            ap.person_id = target_id

    for mp in db.scalars(select(MemoryPersonTag).where(MemoryPersonTag.person_id == source_id)).all():
        exists = db.scalar(
            select(MemoryPersonTag).where(
                MemoryPersonTag.memory_id == mp.memory_id,
                MemoryPersonTag.person_id == target_id,
            )
        )
        if exists:
            db.delete(mp)
        else:
            mp.person_id = target_id

    for pp in db.scalars(select(PhotoPersonTag).where(PhotoPersonTag.person_id == source_id)).all():
        exists = db.scalar(
            select(PhotoPersonTag).where(
                PhotoPersonTag.photo_id == pp.photo_id,
                PhotoPersonTag.person_id == target_id,
            )
        )
        if exists:
            db.delete(pp)
        else:
            pp.person_id = target_id

    for le in db.scalars(select(LifeEvent).where(LifeEvent.person_id == source_id)).all():
        le.person_id = target_id

    source_bio = db.scalar(select(Biography).where(Biography.person_id == source_id))
    if source_bio and source_bio.body.strip():
        target_bio = db.scalar(select(Biography).where(Biography.person_id == target_id))
        if target_bio:
            if source_bio.body.strip() not in target_bio.body:
                target_bio.body = f"{target_bio.body.rstrip()}\n\n{source_bio.body.strip()}".strip()
        else:
            db.add(
                Biography(
                    person_id=target_id,
                    body=source_bio.body,
                    updated_by=user.id,
                )
            )

    # 5b. Transfer account link, lineage assignment, and active guardianships
    source_user_link = db.scalar(
        select(UserPersonLink).where(UserPersonLink.person_id == source_id)
    )
    if source_user_link:
        target_user_link = db.scalar(
            select(UserPersonLink).where(UserPersonLink.person_id == target_id)
        )
        if target_user_link is None:
            source_user_link.person_id = target_id
        else:
            db.delete(source_user_link)

    source_lineage = db.scalar(
        select(PersonLineageAssignment).where(PersonLineageAssignment.person_id == source_id)
    )
    if source_lineage:
        target_lineage = db.scalar(
            select(PersonLineageAssignment).where(PersonLineageAssignment.person_id == target_id)
        )
        if target_lineage is None:
            source_lineage.person_id = target_id
        else:
            db.delete(source_lineage)

    for g in db.scalars(
        select(PersonGuardianship).where(
            PersonGuardianship.family_id == family_id,
            PersonGuardianship.person_id == source_id,
            PersonGuardianship.status == "active",
            PersonGuardianship.revoked_at.is_(None),
        )
    ).all():
        exists = db.scalar(
            select(PersonGuardianship).where(
                PersonGuardianship.family_id == family_id,
                PersonGuardianship.person_id == target_id,
                PersonGuardianship.guardian_user_id == g.guardian_user_id,
                PersonGuardianship.scope == g.scope,
                PersonGuardianship.status == "active",
                PersonGuardianship.revoked_at.is_(None),
            )
        )
        if exists:
            db.delete(g)
        else:
            g.person_id = target_id

    db.flush()

    # 6. Detach source from family
    fp = db.scalar(
        select(FamilyPerson).where(
            FamilyPerson.family_id == family_id,
            FamilyPerson.person_id == source_id,
        )
    )
    if fp:
        db.delete(fp)

    _audit(db, user, family_id, "person.merged", "person", target_id)
    db.commit()

    return PersonMergeOut(
        merged=True,
        target_id=target_id,
        source_id=source_id,
        transferred_relationships=transferred_rels,
        transferred_marriages=transferred_marriages,
    )

