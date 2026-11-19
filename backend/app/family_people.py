"""Family Person CRUD, Directory, Search, Profile, and Guardianship endpoints."""

import json
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import (
    Branch,
    FamilyMember,
    FamilyPerson,
    FamilyTrashRecord,
    Lineage,
    Marriage,
    ParentChildRelationship,
    Person,
    PersonGuardianship,
    PersonLineageAssignment,
    User,
    UserPersonLink,
)
from app.permissions import (
    _assert_person_visible,
    _audit,
    _commit,
    _member,
    _person_in_family,
)
from app.person_search import normalize_search_name
from app.privacy import (
    GUARDIAN_SCOPES,
    active_guardian_scopes,
    has_guardian_scope,
    is_minor,
    person_is_minor,
    redact_minor_profile_fields,
    require_minor_scope,
)

router = APIRouter()


class PersonCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    middle_name: str | None = Field(default=None, max_length=120)
    nickname: str | None = Field(default=None, max_length=120)
    gender: str = Field(default="unknown", pattern="^(female|male|other|unknown)$")
    birth_date: date | None = None
    birth_place: str | None = Field(default=None, max_length=240)
    is_alive: bool = True
    death_date: date | None = None
    death_place: str | None = Field(default=None, max_length=240)
    short_description: str | None = Field(default=None, max_length=1000)
    profile_photo_url: str | None = Field(default=None, max_length=1000)
    visibility: str = Field(default="family", pattern="^(private|family|public)$")

    @field_validator("profile_photo_url")
    @classmethod
    def validate_profile_photo_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        lowered = cleaned.lower()
        if lowered.startswith(("https://", "http://")):
            return cleaned
        if cleaned.startswith("/") and not cleaned.startswith("//"):
            return cleaned
        raise ValueError("Зургийн холбоос нь зөвхөн https://, http:// эсвэл дотоод / зам байх ёстой.")

    @model_validator(mode="after")
    def check_dates(self):
        if self.first_name is not None and not self.first_name.strip():
            raise ValueError("Нэр хоосон байж болохгүй.")
        if self.birth_date and self.birth_date > datetime.now(UTC).date():
            raise ValueError("Төрсөн огноо ирээдүйд байж болохгүй.")
        if self.death_date and self.birth_date and self.death_date < self.birth_date:
            raise ValueError("Нас барсан огноо төрсөн огнооноос өмнө байж болохгүй.")
        if self.is_alive and self.death_date:
            raise ValueError("Амьд хүний нас барсан огноог бөглөж болохгүй.")
        return self


class PersonPatch(PersonCreate):
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, max_length=120)
    gender: str | None = Field(default=None, pattern="^(female|male|other|unknown)$")
    is_alive: bool | None = None
    visibility: str | None = Field(default=None, pattern="^(private|family|public)$")

    @model_validator(mode="after")
    def reject_null_required_fields(self):
        for field in ("first_name", "gender", "is_alive", "visibility"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} талбарыг хоосон болгох боломжгүй.")
        return self


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None
    nickname: str | None
    gender: str
    birth_date: date | None
    birth_place: str | None
    is_alive: bool
    death_date: date | None
    death_place: str | None
    short_description: str | None
    visibility: str
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    can_edit: bool = False
    can_delete: bool = False
    is_minor: bool = False


class ProfileRelationPersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None
    nickname: str | None
    gender: str
    birth_date: date | None
    is_alive: bool
    death_date: date | None
    profile_photo_url: str | None


class PersonProfileOut(PersonOut):
    profile_photo_url: str | None = None
    lineage_id: UUID | None = None
    lineage_name: str | None = None
    branch_id: UUID | None = None
    branch_name: str | None = None
    parents: list[ProfileRelationPersonOut] = Field(default_factory=list)
    children: list[ProfileRelationPersonOut] = Field(default_factory=list)
    spouses: list[ProfileRelationPersonOut] = Field(default_factory=list)


class PersonSearchItem(BaseModel):
    id: UUID
    name: str
    birth_year: int | None


class PersonSearchPage(BaseModel):
    items: list[PersonSearchItem]
    page: int
    page_size: int
    total: int
    has_next: bool


class PersonDirectoryItem(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None
    nickname: str | None
    gender: str
    birth_date: date | None
    birth_place: str | None
    is_alive: bool
    death_date: date | None
    death_place: str | None
    short_description: str | None
    visibility: str
    created_at: datetime
    updated_at: datetime
    lineage_id: UUID | None
    lineage_name: str | None
    branch_id: UUID | None
    branch_name: str | None
    created_by: UUID | None = None
    can_edit: bool = False
    can_delete: bool = False
    is_minor: bool = False


class PersonDirectoryPage(BaseModel):
    items: list[PersonDirectoryItem]
    page: int
    page_size: int
    total: int
    has_next: bool


class GuardianshipCreate(BaseModel):
    guardian_user_id: UUID
    scopes: list[str] = Field(min_length=1, max_length=6)
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_grant(self):
        if len(set(self.scopes)) != len(self.scopes):
            raise ValueError("Ижил эрхийг давхар оруулах боломжгүй.")
        if not set(self.scopes).issubset(GUARDIAN_SCOPES):
            raise ValueError("Guardian эрхийн төрөл буруу байна.")
        if self.expires_at is not None:
            if self.expires_at.tzinfo is None:
                raise ValueError("Дуусах хугацаанд цагийн бүс шаардлагатай.")
            if self.expires_at <= datetime.now(UTC):
                raise ValueError("Дуусах хугацаа ирээдүйд байх ёстой.")
        return self


class GuardianshipOut(BaseModel):
    id: UUID
    guardian_user_id: UUID
    guardian_display_name: str
    scope: str
    status: str
    active: bool
    expires_at: datetime | None


def _marriage_order():
    # NULL dates sort last, followed by stable insertion order for ties.
    return (
        Marriage.start_date.is_(None),
        Marriage.start_date,
        Marriage.created_at,
        Marriage.id,
    )


def _escape_like_prefix(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _person_output(db: Session, family_id: UUID, person: Person, user: User) -> PersonOut:
    scopes = active_guardian_scopes(db, user.id, family_id, [person.id]).get(person.id, set())
    result = PersonOut.model_validate(person)

    member_role = db.scalar(
        select(FamilyMember.role).where(
            FamilyMember.family_id == family_id, FamilyMember.user_id == user.id
        )
    )
    is_admin = member_role in {"owner", "editor"}
    is_creator = person.created_by == user.id
    linked_to_user = db.scalar(
        select(UserPersonLink.id).where(
            UserPersonLink.user_id == user.id, UserPersonLink.person_id == person.id
        )
    )
    is_self = linked_to_user is not None
    can_edit = is_admin or is_self or is_creator
    can_delete = is_admin or is_creator

    extra: dict[str, Any] = {
        "created_by": person.created_by,
        "can_edit": can_edit,
        "can_delete": can_delete,
        "is_minor": person_is_minor(person),
    }
    redactions = redact_minor_profile_fields(person, scopes)
    if redactions:
        extra.update(redactions)
    return result.model_copy(update=extra)


def _require_minor_scope(
    db: Session, family_id: UUID, person: Person, user: User, scope: str
) -> bool:
    return require_minor_scope(db, user.id, family_id, person, scope)


def _can_edit_person(db: Session, family_id: UUID, person: Person, user: User) -> bool:
    member, _ = _member(db, family_id, user)
    if member.role in {"owner", "editor"}:
        return True
    return (
        db.scalar(
            select(UserPersonLink.id).where(
                UserPersonLink.user_id == user.id, UserPersonLink.person_id == person.id
            )
        )
        is not None
    )


def _person_profile_output(
    db: Session, family_id: UUID, person: Person, user: User
) -> PersonProfileOut:
    """Build one family-scoped profile payload without inferring genealogy data."""
    scopes = active_guardian_scopes(db, user.id, family_id, [person.id]).get(person.id, set())
    base = _person_output(db, family_id, person, user)
    result = PersonProfileOut(
        **base.model_dump(),
        profile_photo_url=(
            person.profile_photo_url
            if not person_is_minor(person) or "view_profile" in scopes
            else None
        ),
    )
    if person_is_minor(person) and "view_profile" not in scopes:
        return result

    assignment = db.execute(
        select(Lineage.id, Lineage.name, Branch.id, Branch.name)
        .select_from(PersonLineageAssignment)
        .join(Lineage, Lineage.id == PersonLineageAssignment.lineage_id)
        .outerjoin(Branch, Branch.id == PersonLineageAssignment.branch_id)
        .where(
            PersonLineageAssignment.person_id == person.id,
            Lineage.family_id == family_id,
        )
    ).first()
    if assignment is not None:
        result = result.model_copy(
            update={
                "lineage_id": assignment[0],
                "lineage_name": assignment[1],
                "branch_id": assignment[2],
                "branch_name": assignment[3],
            }
        )

    parent_ids = list(
        db.scalars(
            select(ParentChildRelationship.parent_id)
            .where(ParentChildRelationship.child_id == person.id)
            .order_by(ParentChildRelationship.id)
        ).all()
    )
    child_ids = list(
        db.scalars(
            select(ParentChildRelationship.child_id)
            .where(ParentChildRelationship.parent_id == person.id)
            .order_by(ParentChildRelationship.id)
        ).all()
    )
    marriage_rows = db.execute(
        select(Marriage.person_1_id, Marriage.person_2_id)
        .where(
            Marriage.deleted_at.is_(None),
            or_(Marriage.person_1_id == person.id, Marriage.person_2_id == person.id),
        )
        .order_by(*_marriage_order())
    ).all()
    spouse_ids = [
        person_2_id if person_1_id == person.id else person_1_id
        for person_1_id, person_2_id in marriage_rows
    ]
    relation_ids = set(parent_ids) | set(child_ids) | set(spouse_ids)
    if not relation_ids:
        return result

    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    relation_people = list(
        db.scalars(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(
                FamilyPerson.family_id == family_id,
                Person.id.in_(relation_ids),
                or_(
                    Person.visibility != "private",
                    Person.created_by == user.id,
                    Person.id == own_link,
                ),
            )
            .order_by(Person.last_name, Person.first_name, Person.middle_name, Person.id)
        ).all()
    )
    relation_scopes = active_guardian_scopes(
        db, user.id, family_id, [item.id for item in relation_people]
    )
    visible = {
        item.id: item
        for item in relation_people
        if not person_is_minor(item) or "view_profile" in relation_scopes.get(item.id, set())
    }

    def relation_items(ids: list[UUID]) -> list[ProfileRelationPersonOut]:
        return [
            ProfileRelationPersonOut.model_validate(visible[item_id])
            for item_id in ids
            if item_id in visible
        ]

    return result.model_copy(
        update={
            "parents": relation_items(parent_ids),
            "children": relation_items(child_ids),
            "spouses": relation_items(spouse_ids),
        }
    )


@router.post("/{family_id}/persons", response_model=PersonOut, status_code=201)
def create_person(
    family_id: UUID,
    body: PersonCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    data = body.model_dump()
    data["first_name"] = body.first_name.strip()
    data["last_name"] = body.last_name.strip()
    data["search_first_name"] = normalize_search_name(body.first_name)
    data["search_last_name"] = normalize_search_name(body.last_name)
    data["search_middle_name"] = normalize_search_name(body.middle_name)
    person = Person(**data, created_by=user.id)
    db.add(person)
    db.flush()
    db.add(FamilyPerson(family_id=family_id, person_id=person.id, added_by=user.id))
    db.flush()
    _audit(db, user, family_id, "person.created", "person", person.id)
    db.commit()
    db.refresh(person)
    return _person_output(db, family_id, person, user)


@router.get("/{family_id}/persons", response_model=list[PersonOut])
def list_persons(
    family_id: UUID,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    query = (
        select(Person)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id)
    )
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(
                Person.first_name.ilike(pattern),
                Person.last_name.ilike(pattern),
                Person.middle_name.ilike(pattern),
            )
        )
    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    query = query.where(
        or_(Person.visibility != "private", Person.created_by == user.id, Person.id == own_link)
    )
    persons = list(db.scalars(query.order_by(Person.last_name, Person.first_name)).all())
    scopes = active_guardian_scopes(db, user.id, family_id, [person.id for person in persons])
    return [
        PersonOut.model_validate(person).model_copy(
            update={
                "is_minor": person_is_minor(person),
                **redact_minor_profile_fields(person, scopes.get(person.id, set())),
            }
        )
        for person in persons
    ]


@router.get("/{family_id}/people", response_model=PersonDirectoryPage)
def list_people_directory(
    family_id: UUID,
    q: str | None = Query(default=None, max_length=100, description="Хүний нэрээр хайх үг."),
    page: int = Query(default=1, ge=1, description="1-ээс эхлэх үр дүнгийн хуудас."),
    page_size: int = Query(default=24, ge=1, le=100, description="Нэг хуудсанд 1–100 хүн."),
    lineage_id: UUID | None = Query(default=None, description="Тодорхой удам угсаагаар шүүх."),
    branch_id: UUID | None = Query(default=None, description="Тодорхой салаагаар шүүх."),
    gender: str | None = Query(default=None, description="Хүйсээр шүүх (male, female)."),
    is_alive: bool | None = Query(default=None, description="Амьд сэрүүн эсэхээр шүүх."),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a paginated, family-scoped People Directory without loading the genealogy graph."""
    _member(db, family_id, user)

    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    conditions = [
        FamilyPerson.family_id == family_id,
        or_(Person.visibility != "private", Person.created_by == user.id, Person.id == own_link),
    ]

    if q and q.strip():
        tokens = normalize_search_name(q).split()
        for token in tokens:
            prefix = f"{_escape_like_prefix(token)}%"
            conditions.append(
                or_(
                    Person.search_first_name.like(prefix, escape="\\"),
                    Person.search_last_name.like(prefix, escape="\\"),
                    Person.search_middle_name.like(prefix, escape="\\"),
                )
            )

    directory_query = (
        select(
            Person,
            Lineage.id.label("lineage_id"),
            Lineage.name.label("lineage_name"),
            Branch.id.label("branch_id"),
            Branch.name.label("branch_name"),
        )
        .select_from(Person)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .outerjoin(
            PersonLineageAssignment,
            PersonLineageAssignment.person_id == Person.id,
        )
        .outerjoin(
            Lineage,
            and_(
                Lineage.id == PersonLineageAssignment.lineage_id,
                Lineage.family_id == family_id,
            ),
        )
        .outerjoin(
            Branch,
            and_(
                Branch.id == PersonLineageAssignment.branch_id,
                Branch.lineage_id == Lineage.id,
            ),
        )
        .where(*conditions)
    )

    if lineage_id is not None:
        directory_query = directory_query.where(Lineage.id == lineage_id)
    if branch_id is not None:
        directory_query = directory_query.where(Branch.id == branch_id)
    if gender is not None and gender in ("male", "female"):
        directory_query = directory_query.where(Person.gender == gender)
    if is_alive is not None:
        directory_query = directory_query.where(Person.is_alive == is_alive)

    total = db.scalar(
        select(func.count()).select_from(directory_query.order_by(None).subquery())
    ) or 0

    rows = db.execute(
        directory_query
        .order_by(Person.last_name, Person.first_name, Person.middle_name, Person.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    member_role = db.scalar(
        select(FamilyMember.role).where(
            FamilyMember.family_id == family_id, FamilyMember.user_id == user.id
        )
    )
    is_admin = member_role in {"owner", "editor"}
    own_linked_person_id = db.scalar(
        select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id)
    )

    scopes = active_guardian_scopes(
        db,
        user.id,
        family_id,
        [row[0].id for row in rows],
    )
    items = []
    for person, row_lineage_id, row_lineage_name, row_branch_id, row_branch_name in rows:
        result = PersonOut.model_validate(person)
        redactions = redact_minor_profile_fields(person, scopes.get(person.id, set()))
        if redactions:
            result = result.model_copy(update=redactions)
        is_creator = person.created_by == user.id
        is_self = person.id == own_linked_person_id
        can_edit = is_admin or is_self or is_creator
        can_delete = is_admin or is_creator
        dump = result.model_dump()
        dump["created_by"] = person.created_by
        dump["can_edit"] = can_edit
        dump["can_delete"] = can_delete
        items.append(
            PersonDirectoryItem(
                **dump,
                lineage_id=row_lineage_id,
                lineage_name=row_lineage_name,
                branch_id=row_branch_id,
                branch_name=row_branch_name,
            )
        )

    return PersonDirectoryPage(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        has_next=page * page_size < total,
    )


@router.get("/{family_id}/persons/search", response_model=PersonSearchPage)
def search_persons(
    family_id: UUID,
    q: str = Query(min_length=1, max_length=100, description="Нэрийн эхлэлээр хайх үг."),
    page: int = Query(default=1, ge=1, description="1-ээс эхлэх үр дүнгийн хуудас."),
    page_size: int = Query(default=25, ge=1, le=100, description="Нэг хуудсанд 1–100 үр дүн."),
    birth_year: int | None = Query(default=None, ge=1, le=9998, description="Төрсөн он."),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a privacy-filtered page of lightweight family member search results."""
    _member(db, family_id, user)
    tokens = normalize_search_name(q).split()
    if not tokens:
        raise HTTPException(status_code=422, detail="Хайлтын үгээ оруулна уу.")
    if birth_year is not None and birth_year >= datetime.now(UTC).date().year - 18:
        # A year filter must not reveal a protected minor through result counts.
        return PersonSearchPage(items=[], page=page, page_size=page_size, total=0, has_next=False)
    predicates = [
        or_(
            Person.search_first_name.like(f"{_escape_like_prefix(token)}%", escape="\\"),
            Person.search_last_name.like(f"{_escape_like_prefix(token)}%", escape="\\"),
            Person.search_middle_name.like(f"{_escape_like_prefix(token)}%", escape="\\"),
        )
        for token in tokens
    ]
    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    privacy_filter = or_(
        Person.visibility != "private", Person.created_by == user.id, Person.id == own_link
    )
    family_filter = FamilyPerson.family_id == family_id
    conditions = [family_filter, privacy_filter, *predicates]
    if birth_year is not None:
        conditions.extend(
            [
                Person.birth_date >= date(birth_year, 1, 1),
                Person.birth_date < date(birth_year + 1, 1, 1),
            ]
        )
    total = db.scalar(
        select(func.count(Person.id))
        .select_from(Person)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(*conditions)
    ) or 0
    persons = list(
        db.scalars(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(*conditions)
            .order_by(Person.search_last_name, Person.search_first_name, Person.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    scopes = active_guardian_scopes(db, user.id, family_id, [person.id for person in persons])
    items = [
        PersonSearchItem(
            id=person.id,
            name=" ".join(
                part for part in (person.last_name, person.first_name, person.middle_name) if part
            ),
            birth_year=(
                person.birth_date.year
                if person.birth_date is not None
                and (not person_is_minor(person) or "view_profile" in scopes.get(person.id, set()))
                else None
            ),
        )
        for person in persons
    ]
    return PersonSearchPage(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        has_next=page * page_size < total,
    )


@router.get("/{family_id}/persons/{person_id}", response_model=PersonProfileOut)
def get_person(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    return _person_profile_output(db, family_id, person, user)


@router.patch("/{family_id}/persons/{person_id}", response_model=PersonOut)
def update_person(
    family_id: UUID,
    person_id: UUID,
    body: PersonPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    data = body.model_dump(exclude_unset=True)
    candidate_birth = data.get("birth_date", person.birth_date)
    candidate_death = data.get("death_date", person.death_date)
    candidate_alive = data.get("is_alive", person.is_alive)
    is_minor_record = person_is_minor(person) or is_minor(candidate_birth) is True
    linked_to_user = db.scalar(
        select(UserPersonLink.id).where(
            UserPersonLink.user_id == user.id, UserPersonLink.person_id == person.id
        )
    )
    is_admin = member.role in {"owner", "editor"}
    is_self = linked_to_user is not None
    is_creator = person.created_by == user.id
    baseline_edit = is_admin or is_self or is_creator
    has_scoped_edit = (
        has_guardian_scope(db, user.id, family_id, person.id, "edit_profile")
        if is_minor_record
        else False
    )
    if is_minor_record:
        if data and not has_scoped_edit:
            raise HTTPException(status_code=403, detail="Энэ хүний profile засах эрхгүй.")
        if not baseline_edit and not has_scoped_edit:
            raise HTTPException(status_code=403, detail="Profile засах эрхгүй.")
    elif not baseline_edit:
        raise HTTPException(
            status_code=403,
            detail="Зөвхөн админ, өөрийн эсвэл өөрийн нэмсэн хүний profile-г засах эрхтэй.",
        )
    if candidate_birth and candidate_death and candidate_death < candidate_birth:
        raise HTTPException(
            status_code=422, detail="Нас барсан огноо төрсөн огнооноос өмнө байж болохгүй."
        )
    if candidate_alive and candidate_death:
        raise HTTPException(status_code=422, detail="Амьд хүний нас барсан огноог бөглөж болохгүй.")
    for key, value in data.items():
        setattr(
            person, key, value.strip() if key in {"first_name", "last_name"} and value else value
        )
    person.search_first_name = normalize_search_name(person.first_name)
    person.search_last_name = normalize_search_name(person.last_name)
    person.search_middle_name = normalize_search_name(person.middle_name)
    _audit(db, user, family_id, "person.updated", "person", person.id)
    db.commit()
    db.refresh(person)
    return _person_output(db, family_id, person, user)


@router.post(
    "/{family_id}/persons/{person_id}/guardianships",
    response_model=list[GuardianshipOut],
    status_code=201,
)
def create_guardian_grants(
    family_id: UUID,
    person_id: UUID,
    body: GuardianshipCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    _person_in_family(db, family_id, person_id)
    guardian_member = db.scalar(
        select(FamilyMember.id).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == body.guardian_user_id,
        )
    )
    if guardian_member is None:
        raise HTTPException(status_code=404, detail="Гэр бүлийн гишүүн олдсонгүй.")

    if body.guardian_user_id == user.id:
        linked_parent = db.scalar(
            select(UserPersonLink.id)
            .join(
                FamilyPerson,
                FamilyPerson.person_id == UserPersonLink.person_id,
            )
            .join(
                ParentChildRelationship,
                ParentChildRelationship.parent_id == UserPersonLink.person_id,
            )
            .where(
                UserPersonLink.user_id == user.id,
                FamilyPerson.family_id == family_id,
                ParentChildRelationship.child_id == person_id,
            )
        )
        if linked_parent is None:
            raise HTTPException(status_code=403, detail="Өөртөө guardian эрх олгох боломжгүй.")

    guardian = db.get(User, body.guardian_user_id)
    if guardian is None or not guardian.is_active:
        raise HTTPException(status_code=404, detail="Гэр бүлийн гишүүн олдсонгүй.")

    now = datetime.now(UTC)
    grants: list[PersonGuardianship] = []
    for scope in body.scopes:
        previous = db.scalar(
            select(PersonGuardianship).where(
                PersonGuardianship.family_id == family_id,
                PersonGuardianship.person_id == person_id,
                PersonGuardianship.guardian_user_id == body.guardian_user_id,
                PersonGuardianship.scope == scope,
                PersonGuardianship.status == "active",
                PersonGuardianship.revoked_at.is_(None),
            )
        )
        if previous is not None:
            expiry = previous.expires_at
            if expiry is not None and expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=UTC)
            if expiry is None or expiry > now:
                raise HTTPException(status_code=409, detail="Энэ guardian эрх идэвхтэй байна.")
            previous.status = "revoked"
            previous.revoked_at = now
            previous.revoked_by_user_id = user.id
            previous.updated_at = now
            _audit(db, user, family_id, "person.guardianship.expired", "person", person_id)

        grant = PersonGuardianship(
            family_id=family_id,
            person_id=person_id,
            guardian_user_id=body.guardian_user_id,
            scope=scope,
            status="active",
            granted_by_user_id=user.id,
            expires_at=body.expires_at,
        )
        db.add(grant)
        grants.append(grant)

    try:
        db.flush()
        for _ in grants:
            _audit(db, user, family_id, "person.guardianship.granted", "person", person_id)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Guardian эрх давхар үүссэн байна.") from error

    return [
        GuardianshipOut(
            id=grant.id,
            guardian_user_id=guardian.id,
            guardian_display_name=guardian.display_name,
            scope=grant.scope,
            status=grant.status,
            active=True,
            expires_at=grant.expires_at,
        )
        for grant in grants
    ]


@router.get(
    "/{family_id}/persons/{person_id}/guardianships",
    response_model=list[GuardianshipOut],
)
def list_guardian_grants(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    _person_in_family(db, family_id, person_id)
    rows = db.execute(
        select(PersonGuardianship, User.display_name)
        .join(User, User.id == PersonGuardianship.guardian_user_id)
        .where(
            PersonGuardianship.family_id == family_id,
            PersonGuardianship.person_id == person_id,
        )
        .order_by(PersonGuardianship.created_at)
    ).all()
    now = datetime.now(UTC)
    result = []
    for grant, display_name in rows:
        expiry = grant.expires_at
        if expiry is not None and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=UTC)
        result.append(
            GuardianshipOut(
                id=grant.id,
                guardian_user_id=grant.guardian_user_id,
                guardian_display_name=display_name,
                scope=grant.scope,
                status=grant.status,
                active=(
                    grant.status == "active"
                    and grant.revoked_at is None
                    and (expiry is None or expiry > now)
                ),
                expires_at=grant.expires_at,
            )
        )
    return result


@router.delete("/{family_id}/persons/{person_id}/guardianships/{grant_id}", status_code=204)
def revoke_guardian_grant(
    family_id: UUID,
    person_id: UUID,
    grant_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    _person_in_family(db, family_id, person_id)
    grant = db.scalar(
        select(PersonGuardianship).where(
            PersonGuardianship.id == grant_id,
            PersonGuardianship.family_id == family_id,
            PersonGuardianship.person_id == person_id,
        )
    )
    if grant is None:
        raise HTTPException(status_code=404, detail="Guardian эрх олдсонгүй.")
    if grant.status == "active":
        now = datetime.now(UTC)
        grant.status = "revoked"
        grant.revoked_at = now
        grant.revoked_by_user_id = user.id
        grant.updated_at = now
        _audit(db, user, family_id, "person.guardianship.revoked", "person", person_id)
        db.commit()
    return Response(status_code=204)


@router.delete("/{family_id}/persons/{person_id}", status_code=204)
def remove_person_from_family(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detach from this family; preserve the person and relationship history."""
    member, _ = _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    is_admin = member.role in {"owner", "editor"}
    is_creator = person.created_by == user.id
    if not (is_admin or is_creator):
        raise HTTPException(
            status_code=403,
            detail="Устгах эрхгүй. Зөвхөн админ эсвэл уг хүнийг үүсгэсэн хэрэглэгч устгах эрхтэй.",
        )
    association = db.scalar(
        select(FamilyPerson).where(
            FamilyPerson.family_id == family_id, FamilyPerson.person_id == person_id
        )
    )
    assignments = db.scalars(
        select(PersonLineageAssignment)
        .join(Lineage, Lineage.id == PersonLineageAssignment.lineage_id)
        .where(
            PersonLineageAssignment.person_id == person_id,
            Lineage.family_id == family_id,
        )
    ).all()

    p_edges = db.scalars(
        select(ParentChildRelationship).where(
            or_(
                ParentChildRelationship.parent_id == person_id,
                ParentChildRelationship.child_id == person_id,
            )
        )
    ).all()
    edge_snapshots = [
        {"parent_id": str(e.parent_id), "child_id": str(e.child_id), "type": e.relationship_type}
        for e in p_edges
    ]
    m_edges = db.scalars(
        select(Marriage).where(
            or_(
                Marriage.person_1_id == person_id,
                Marriage.person_2_id == person_id,
            )
        )
    ).all()
    marriage_snapshots = [
        {
            "person_1_id": str(m.person_1_id),
            "person_2_id": str(m.person_2_id),
            "start_date": str(m.start_date) if m.start_date else None,
            "end_date": str(m.end_date) if m.end_date else None,
            "status": m.status,
        }
        for m in m_edges
    ]
    snapshot = json.dumps({"edges": edge_snapshots, "marriages": marriage_snapshots})
    p_name = f"{person.last_name + ' ' if person.last_name else ''}{person.first_name}"

    trash_rec = FamilyTrashRecord(
        family_id=family_id,
        person_id=person_id,
        person_name=p_name,
        deleted_by=user.id,
        snapshot_data=snapshot,
    )
    db.add(trash_rec)

    _audit(db, user, family_id, "person.detached", "person", person_id)
    for assignment in assignments:
        _audit(
            db,
            user,
            family_id,
            "person.lineage_assignment.deleted",
            "person",
            person_id,
        )
        db.delete(assignment)
    db.delete(association)
    db.commit()
    return Response(status_code=204)


@router.post("/{family_id}/persons/{person_id}/link-me", status_code=204)
def link_me(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    _person_in_family(db, family_id, person_id)
    if db.scalar(select(UserPersonLink).where(UserPersonLink.user_id == user.id)):
        raise HTTPException(
            status_code=409, detail="Таны бүртгэл хүнтэй аль хэдийн холбогдсон байна."
        )
    if db.scalar(select(UserPersonLink).where(UserPersonLink.person_id == person_id)):
        raise HTTPException(status_code=409, detail="Энэ хүн өөр бүртгэлтэй холбогдсон байна.")
    db.add(UserPersonLink(user_id=user.id, person_id=person_id, linked_by=user.id))
    _commit(db, "Энэ хүн өөр бүртгэлтэй холбогдсон байна.")
    return Response(status_code=204)
