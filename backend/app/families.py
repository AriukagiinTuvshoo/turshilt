"""Authenticated family, person and relationship APIs."""

import hashlib
import json
import secrets
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import _consume_otp_rate, _normalized_ip, get_current_user
from app.config import get_settings
from app.db import get_db
from app.email import EmailDeliveryError, EmailProvider, get_email_provider
from app.identity import normalize_email
from app.models import (
    Archive,
    AuditLog,
    Biography,
    Branch,
    Family,
    FamilyMember,
    FamilyPerson,
    FamilyTrashRecord,
    Invitation,
    LifeEvent,
    Lineage,
    LoginIdentity,
    Marriage,
    Memory,
    ParentChildRelationship,
    Person,
    PersonGuardianship,
    PersonLineageAssignment,
    Story,
    User,
    UserPersonLink,
)
from app.oral_history import parse_oral_narrative
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
from app.relationships import (
    RelationshipError,
    analyze_kinship_relation,
    assert_date_order,
    assert_parent_child_is_acyclic,
    canonical_pair,
)

router = APIRouter(prefix="/families", tags=["families"])
invitations_router = APIRouter(prefix="/invitations", tags=["invitations"])
lineages_router = APIRouter(prefix="/lineages", tags=["lineages"])


class FamilyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def check_name(self):
        if not self.name.strip():
            raise ValueError("Гэр бүлийн нэр хоосон байж болохгүй.")
        return self


class FamilyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def check_name(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Гэр бүлийн нэр хоосон байж болохгүй.")
        if self.name is not None and not self.name.strip():
            raise ValueError("Гэр бүлийн нэр хоосон байж болохгүй.")
        return self


class FamilyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str | None
    created_at: datetime
    role: str


class LineageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def check_name(self):
        if not self.name.strip():
            raise ValueError("Удам угсааны нэр хоосон байж болохгүй.")
        return self


class LineageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    family_id: UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class BranchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def check_name(self):
        if not self.name.strip():
            raise ValueError("Салааны нэр хоосон байж болохгүй.")
        return self


class BranchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    lineage_id: UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class PersonLineageAssignmentInput(BaseModel):
    lineage_id: UUID
    branch_id: UUID | None = None


class PersonLineageAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    person_id: UUID
    lineage_id: UUID
    branch_id: UUID | None


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


class TreePersonOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None
    gender: str = "unknown"
    birth_date: date | None
    is_alive: bool
    death_date: date | None
    lineage_id: UUID | None = None
    lineage_name: str | None = None
    branch_id: UUID | None = None
    branch_name: str | None = None
    profile_photo_url: str | None = None


class KinshipOut(BaseModel):
    relationship_type: str
    relationship_title: str
    lineage_type: str
    lineage_label: str | None = None
    degree: int | None = None
    generations_person_1: int | None = None
    generations_person_2: int | None = None
    coefficient: float
    is_blood_related: bool
    within_9_generations: bool
    common_ancestor_ids: list[UUID]
    description: str
    inbreeding_warning: str | None = None


class FamilyStatsOut(BaseModel):
    total_persons: int
    male_count: int
    female_count: int
    living_count: int
    deceased_count: int
    marriage_count: int
    parent_child_count: int
    generation_depth: int
    total_stories: int
    total_archives: int
    total_memories: int
    member_count: int


class MemberRoleUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in {"owner", "editor", "member"}:
            raise ValueError("Role must be 'owner', 'editor', or 'member'")
        return v


class TreeParentChildOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    parent_id: UUID
    child_id: UUID
    relationship_type: str


class TreeOut(BaseModel):
    root_person_id: UUID | None
    persons: list[TreePersonOut]
    parent_child_relationships: list[TreeParentChildOut]
    marriages: list["MarriageOut"]
    meta: dict[str, int | bool]


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


class ParentChildCreate(BaseModel):
    parent_id: UUID
    child_id: UUID
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive)$")


class MarriageCreate(BaseModel):
    person_1_id: UUID
    person_2_id: UUID
    status: str = Field(default="married", pattern="^(married|divorced|widowed)$")
    start_date: date | None = None
    end_date: date | None = None
    location: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def valid_dates(self):
        assert_date_order(self.start_date, self.end_date)
        if self.status == "married" and self.end_date is not None:
            raise ValueError("Идэвхтэй гэрлэлтийн дууссан огноо байх ёсгүй.")
        return self


class MarriagePatch(BaseModel):
    status: str | None = Field(default=None, pattern="^(married|divorced|widowed)$")
    start_date: date | None = None
    end_date: date | None = None
    location: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def validate_update(self):
        if not self.model_fields_set:
            raise ValueError("Өөрчлөх мэдээллээ оруулна уу.")
        assert_date_order(self.start_date, self.end_date)
        return self


class MarriageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    person_1_id: UUID
    person_2_id: UUID
    status: str
    start_date: date | None
    end_date: date | None
    location: str | None
    description: str | None
    created_at: datetime


def _marriage_person_access(db: Session, family_id: UUID, marriage: Marriage, user: User):
    people = [
        _person_in_family(db, family_id, marriage.person_1_id),
        _person_in_family(db, family_id, marriage.person_2_id),
    ]
    for person in people:
        _assert_person_visible(db, person, user)
    minor_ids = [person.id for person in people if person_is_minor(person)]
    if minor_ids:
        scopes = active_guardian_scopes(db, user.id, family_id, minor_ids)
        if any("view_profile" not in scopes.get(person_id, set()) for person_id in minor_ids):
            raise HTTPException(status_code=404, detail="Гэрлэлтийн мэдээлэл олдсонгүй.")
    return people


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


class MemberOut(BaseModel):
    user_id: UUID
    display_name: str
    role: str
    person_id: UUID | None = None


class MemberLinkPersonInput(BaseModel):
    person_id: UUID


class InvitationCreate(BaseModel):
    email: EmailStr
    role: str = Field(pattern="^(editor|member)$")


class InvitationOut(BaseModel):
    id: UUID
    email: str
    role: str
    expires_at: datetime
    created_at: datetime
    status: str = "pending"


class InvitationAccept(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class BiographyInput(BaseModel):
    content: str = Field(max_length=50000)


class LifeEventInput(BaseModel):
    event_type: str = Field(
        pattern="^(birth|school|work|marriage|divorce|move|child_birth|death|award|other)$"
    )
    title: str = Field(min_length=1, max_length=180)
    event_date: date | None = None
    date_note: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def check_title(self):
        if not self.title.strip():
            raise ValueError("Үйл явдлын гарчиг хоосон байж болохгүй.")
        return self


class ExtractedEventDraft(BaseModel):
    event_type: str = Field(
        pattern="^(birth|school|work|marriage|divorce|move|child_birth|death|award|other)$"
    )
    title: str = Field(min_length=1, max_length=180)
    event_date: date | None = None
    date_note: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=10000)


class OralHistoryExtractInput(BaseModel):
    narrative_text: str = Field(min_length=10, max_length=50000)
    auto_create_events: bool = False
    update_biography: bool = False


class OralHistoryExtractOut(BaseModel):
    suggested_biography: str
    extracted_events: list[ExtractedEventDraft]
    created_events_count: int = 0
    biography_updated: bool = False



def _lineage_in_member_family(db: Session, lineage_id: UUID, user: User) -> Lineage:
    lineage = db.scalar(
        select(Lineage)
        .join(FamilyMember, FamilyMember.family_id == Lineage.family_id)
        .join(Family, Family.id == Lineage.family_id)
        .where(
            Lineage.id == lineage_id,
            FamilyMember.user_id == user.id,
            Family.archived_at.is_(None),
        )
    )
    if lineage is None:
        raise HTTPException(status_code=404, detail="Удам угсаа олдсонгүй.")
    return lineage


def _person_output(db: Session, family_id: UUID, person: Person, user: User) -> PersonOut:
    scopes = active_guardian_scopes(db, user.id, family_id, [person.id]).get(person.id, set())
    result = PersonOut.model_validate(person)

    member_role = db.scalar(
        select(FamilyMember.role).where(
            FamilyMember.family_id == family_id, FamilyMember.user_id == user.id
        )
    )
    is_admin = member_role in {"owner", "editor"}
    is_creator = (person.created_by == user.id)
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


@router.post("", response_model=FamilyOut, status_code=201)
def create_family(
    body: FamilyCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    family = Family(name=body.name.strip(), description=body.description, created_by=user.id)
    db.add(family)
    db.flush()
    member = FamilyMember(family_id=family.id, user_id=user.id, role="owner")
    db.add(member)
    db.flush()
    _audit(db, user, family.id, "family.created", "family", family.id)
    db.commit()
    db.refresh(family)
    return FamilyOut(
        id=family.id,
        name=family.name,
        description=family.description,
        created_at=family.created_at,
        role=member.role,
    )


@router.get("", response_model=list[FamilyOut])
def list_families(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Family, FamilyMember.role)
        .join(FamilyMember, FamilyMember.family_id == Family.id)
        .where(FamilyMember.user_id == user.id, Family.archived_at.is_(None))
        .order_by(Family.created_at)
    ).all()
    return [
        FamilyOut(
            id=f.id, name=f.name, description=f.description, created_at=f.created_at, role=role
        )
        for f, role in rows
    ]


@router.get("/{family_id}", response_model=FamilyOut)
def get_family(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    member, family = _member(db, family_id, user)
    return FamilyOut(
        id=family.id,
        name=family.name,
        description=family.description,
        created_at=family.created_at,
        role=member.role,
    )


@router.patch("/{family_id}", response_model=FamilyOut)
def update_family(
    family_id: UUID,
    body: FamilyPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, family = _member(db, family_id, user, {"owner", "editor"})
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(family, key, value.strip() if key == "name" and value else value)
    _audit(db, user, family_id, "family.updated", "family", family.id)
    db.commit()
    db.refresh(family)
    return FamilyOut(
        id=family.id,
        name=family.name,
        description=family.description,
        created_at=family.created_at,
        role=member.role,
    )


@router.delete("/{family_id}", status_code=204)
def archive_family(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    _, family = _member(db, family_id, user, {"owner"})
    family.archived_at = datetime.now(UTC)
    _audit(db, user, family_id, "family.archived", "family", family.id)
    db.commit()
    return Response(status_code=204)


@router.get("/{family_id}/members", response_model=list[MemberOut])
def list_members(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    _member(db, family_id, user)
    rows = db.execute(
        select(User.id, User.display_name, FamilyMember.role, UserPersonLink.person_id)
        .join(FamilyMember, FamilyMember.user_id == User.id)
        .outerjoin(
            UserPersonLink,
            and_(
                UserPersonLink.user_id == User.id,
                UserPersonLink.person_id.in_(
                    select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
                ),
            ),
        )
        .where(FamilyMember.family_id == family_id)
        .order_by(FamilyMember.role, User.display_name)
    ).all()
    return [
        MemberOut(
            user_id=r.id,
            display_name=r.display_name,
            role=r.role,
            person_id=r.person_id,
        )
        for r in rows
    ]


@router.patch("/{family_id}/members/{target_user_id}", response_model=MemberOut)
def update_member_role(
    family_id: UUID,
    target_user_id: UUID,
    payload: MemberRoleUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin endpoint: Family owner can change a member's role or transfer ownership."""
    current_membership, _ = _member(db, family_id, user, {"owner"})
    target_membership = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == target_user_id,
        )
    )
    if not target_membership:
        raise HTTPException(status_code=404, detail="Гишүүн олдсонгүй.")

    target_user = db.scalar(select(User).where(User.id == target_user_id))
    if not target_user:
        raise HTTPException(status_code=404, detail="Хэрэглэгч олдсонгүй.")

    if payload.role == "owner":
        # Transfer ownership: current user becomes editor
        current_membership.role = "editor"
        target_membership.role = "owner"
        _audit(db, user, family_id, "family.owner_transferred", "user", target_user_id)
    else:
        # If target is owner and trying to downgrade, ensure there is another owner
        if target_membership.role == "owner" and payload.role != "owner":
            other_owner = db.scalar(
                select(FamilyMember).where(
                    FamilyMember.family_id == family_id,
                    FamilyMember.user_id != target_user_id,
                    FamilyMember.role == "owner",
                )
            )
            if not other_owner:
                raise HTTPException(
                    status_code=409,
                    detail="Гэр бүлийн цорын ганц эзэмшигчийн эрхийг бууруулах боломжгүй. Өөр хүнд эзэмшигчийн эрх шилжүүлнэ үү.",
                )
        target_membership.role = payload.role
        _audit(db, user, family_id, "family_member.role_updated", "user", target_user_id)

    db.commit()
    return MemberOut(user_id=target_user.id, display_name=target_user.display_name, role=target_membership.role)


@router.delete("/{family_id}/members/{target_user_id}", status_code=204)
def remove_member(
    family_id: UUID,
    target_user_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin endpoint: Remove a member from the family, or member leaves voluntarily."""
    is_self = (user.id == target_user_id)
    if not is_self:
        # Must be owner to remove other members
        _member(db, family_id, user, {"owner"})
    else:
        _member(db, family_id, user)

    target_membership = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == target_user_id,
        )
    )
    if not target_membership:
        raise HTTPException(status_code=404, detail="Гишүүн олдсонгүй.")

    if target_membership.role == "owner":
        # Cannot delete the only owner
        owner_count = db.scalar(
            select(func.count(FamilyMember.id)).where(
                FamilyMember.family_id == family_id,
                FamilyMember.role == "owner",
            )
        ) or 0
        if owner_count <= 1:
            raise HTTPException(
                status_code=409,
                detail="Гэр бүлийн цорын ганц эзэмшигч гэр бүлээс гарах боломжгүй. Өөр гишүүнд эзэмшигчийн эрхийг шилжүүлнэ үү.",
            )

    db.delete(target_membership)
    _audit(
        db,
        user,
        family_id,
        "family_member.left" if is_self else "family_member.removed",
        "user",
        target_user_id,
    )
    db.commit()
    return Response(status_code=204)


@router.post("/{family_id}/members/{target_user_id}/link-person", response_model=MemberOut)
def link_member_person(
    family_id: UUID,
    target_user_id: UUID,
    payload: MemberLinkPersonInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin endpoint: link a family member account to a specific tree Person record."""
    _member(db, family_id, user, {"owner", "editor"})
    target_membership = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == target_user_id,
        )
    )
    if not target_membership:
        raise HTTPException(status_code=404, detail="Гишүүн олдсонгүй.")

    target_user = db.scalar(select(User).where(User.id == target_user_id))
    if not target_user:
        raise HTTPException(status_code=404, detail="Хэрэглэгч олдсонгүй.")

    _person_in_family(db, family_id, payload.person_id)

    # Check if target person is already linked to another user
    existing_person_link = db.scalar(
        select(UserPersonLink).where(UserPersonLink.person_id == payload.person_id)
    )
    if existing_person_link and existing_person_link.user_id != target_user_id:
        raise HTTPException(status_code=409, detail="Энэ хүн өөр хэрэглэгчийн бүртгэлтэй холбогдсон байна.")

    existing_user_link = db.scalar(
        select(UserPersonLink).where(UserPersonLink.user_id == target_user_id)
    )
    if existing_user_link:
        existing_user_link.person_id = payload.person_id
        existing_user_link.linked_by = user.id
    else:
        db.add(
            UserPersonLink(
                user_id=target_user_id,
                person_id=payload.person_id,
                linked_by=user.id,
            )
        )

    _audit(db, user, family_id, "family_member.person_linked", "user", target_user_id)
    db.commit()
    return MemberOut(
        user_id=target_user.id,
        display_name=target_user.display_name,
        role=target_membership.role,
        person_id=payload.person_id,
    )


@router.delete("/{family_id}/members/{target_user_id}/unlink-person", status_code=204)
def unlink_member_person(
    family_id: UUID,
    target_user_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin endpoint: unlink a family member account from their tree Person record."""
    _member(db, family_id, user, {"owner", "editor"})
    target_membership = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == target_user_id,
        )
    )
    if not target_membership:
        raise HTTPException(status_code=404, detail="Гишүүн олдсонгүй.")

    link = db.scalar(
        select(UserPersonLink).where(UserPersonLink.user_id == target_user_id)
    )
    if link:
        db.delete(link)
        _audit(db, user, family_id, "family_member.person_unlinked", "user", target_user_id)
        db.commit()

    return Response(status_code=204)


@router.get("/{family_id}/stats", response_model=FamilyStatsOut)
def get_family_stats(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin/Overview endpoint: Comprehensive genealogical statistics for the family."""
    _member(db, family_id, user)

    # Person stats
    person_ids_query = select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    person_ids = list(db.scalars(person_ids_query).all())
    total_persons = len(person_ids)

    male_count = 0
    female_count = 0
    living_count = 0
    deceased_count = 0

    if total_persons > 0:
        gender_stats = db.execute(
            select(Person.gender, func.count(Person.id))
            .where(Person.id.in_(person_ids))
            .group_by(Person.gender)
        ).all()
        for g, count in gender_stats:
            if g == "male":
                male_count = count
            elif g == "female":
                female_count = count

        alive_stats = db.execute(
            select(Person.is_alive, func.count(Person.id))
            .where(Person.id.in_(person_ids))
            .group_by(Person.is_alive)
        ).all()
        for is_al, count in alive_stats:
            if is_al:
                living_count = count
            else:
                deceased_count = count

    # Marriages
    marriage_count = 0
    parent_child_count = 0
    generation_depth = 1

    if total_persons > 0:
        marriage_count = db.scalar(
            select(func.count(Marriage.id)).where(
                Marriage.deleted_at.is_(None),
                or_(Marriage.person_1_id.in_(person_ids), Marriage.person_2_id.in_(person_ids)),
            )
        ) or 0

        parent_child_count = db.scalar(
            select(func.count(ParentChildRelationship.id)).where(
                or_(
                    ParentChildRelationship.parent_id.in_(person_ids),
                    ParentChildRelationship.child_id.in_(person_ids),
                )
            )
        ) or 0

        # Calculate generation depth via BFS from roots
        parent_rows = db.execute(
            select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
                ParentChildRelationship.parent_id.in_(person_ids),
                ParentChildRelationship.child_id.in_(person_ids),
            )
        ).all()
        child_to_parents: dict[UUID, list[UUID]] = defaultdict(list)
        parent_to_children: dict[UUID, list[UUID]] = defaultdict(list)
        for p, c in parent_rows:
            child_to_parents[c].append(p)
            parent_to_children[p].append(c)

        roots = [pid for pid in person_ids if pid not in child_to_parents]
        if roots:
            max_depth = 1
            queue: list[tuple[UUID, int]] = [(r, 1) for r in roots]
            visited: set[UUID] = set()
            while queue:
                curr, depth = queue.pop(0)
                max_depth = max(max_depth, depth)
                if curr in visited:
                    continue
                visited.add(curr)
                for ch in parent_to_children.get(curr, []):
                    queue.append((ch, depth + 1))
            generation_depth = min(max_depth, 20)

    # Content counts
    total_stories = db.scalar(
        select(func.count(Story.id)).where(Story.family_id == family_id)
    ) or 0

    total_archives = db.scalar(
        select(func.count(Archive.id)).where(Archive.family_id == family_id)
    ) or 0

    total_memories = db.scalar(
        select(func.count(Memory.id)).where(Memory.family_id == family_id)
    ) or 0

    member_count = db.scalar(
        select(func.count(FamilyMember.id)).where(FamilyMember.family_id == family_id)
    ) or 0

    return FamilyStatsOut(
        total_persons=total_persons,
        male_count=male_count,
        female_count=female_count,
        living_count=living_count,
        deceased_count=deceased_count,
        marriage_count=marriage_count,
        parent_child_count=parent_child_count,
        generation_depth=generation_depth,
        total_stories=total_stories,
        total_archives=total_archives,
        total_memories=total_memories,
        member_count=member_count,
    )


@router.get("/{family_id}/kinship", response_model=KinshipOut)
def calculate_family_kinship(
    family_id: UUID,
    person_1_id: UUID = Query(description="Эхний хүн"),
    person_2_id: UUID = Query(description="Хоёр дахь хүн"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Calculate traditional Mongolian kinship relation (Ясан/Цусан төрөл, 9 үеийн шалгуур) between 2 persons."""
    _member(db, family_id, user)
    p1 = _person_in_family(db, family_id, person_1_id)
    p2 = _person_in_family(db, family_id, person_2_id)
    _assert_person_visible(db, p1, user)
    _assert_person_visible(db, p2, user)

    # Fetch family's parent-child edges with parent genders
    person_ids = db.scalars(select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)).all()
    edge_rows = db.execute(
        select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id, Person.gender)
        .join(Person, Person.id == ParentChildRelationship.parent_id)
        .where(
            ParentChildRelationship.parent_id.in_(person_ids),
            ParentChildRelationship.child_id.in_(person_ids),
        )
    ).all()
    parent_edges = [(r[0], r[1], r[2]) for r in edge_rows]

    marriage_rows = db.execute(
        select(Marriage.person_1_id, Marriage.person_2_id).where(
            Marriage.deleted_at.is_(None),
            Marriage.person_1_id.in_(person_ids),
            Marriage.person_2_id.in_(person_ids),
        )
    ).all()
    marriage_pairs = [(r[0], r[1]) for r in marriage_rows]

    analysis = analyze_kinship_relation(
        person_1_id=person_1_id,
        person_2_id=person_2_id,
        parent_edges=parent_edges,
        marriage_pairs=marriage_pairs,
    )

    return KinshipOut(
        relationship_type=analysis["relationship_type"],
        relationship_title=analysis["relationship_title"],
        lineage_type=analysis.get("lineage_type", "unrelated"),
        lineage_label=analysis.get("lineage_label"),
        degree=analysis.get("degree"),
        generations_person_1=analysis.get("generations_person_1"),
        generations_person_2=analysis.get("generations_person_2"),
        coefficient=analysis["coefficient"],
        is_blood_related=analysis["is_blood_related"],
        within_9_generations=analysis["within_9_generations"],
        common_ancestor_ids=[UUID(cid) for cid in analysis["common_ancestor_ids"]],
        description=analysis["description"],
        inbreeding_warning=analysis.get("inbreeding_warning"),
    )


@router.get("/{family_id}/lineages", response_model=list[LineageOut])
def list_lineages(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    lineages = db.scalars(
        select(Lineage)
        .where(Lineage.family_id == family_id)
        .order_by(Lineage.name, Lineage.created_at, Lineage.id)
    ).all()
    return list(lineages)


@router.post("/{family_id}/lineages", response_model=LineageOut, status_code=201)
def create_lineage(
    family_id: UUID,
    body: LineageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    lineage = Lineage(
        family_id=family_id,
        name=body.name.strip(),
        description=body.description,
    )
    db.add(lineage)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Энэ гэр бүлд ижил нэртэй удам угсаа аль хэдийн бүртгэгдсэн байна.",
        ) from error
    _audit(db, user, family_id, "lineage.created", "lineage", lineage.id)
    _commit(db, "Удам угсааг хадгалах үед зөрчил гарлаа.")
    db.refresh(lineage)
    return lineage


@lineages_router.get("/{lineage_id}/branches", response_model=list[BranchOut])
def list_branches(
    lineage_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lineage = _lineage_in_member_family(db, lineage_id, user)
    branches = db.scalars(
        select(Branch)
        .where(Branch.lineage_id == lineage.id)
        .order_by(Branch.name, Branch.created_at, Branch.id)
    ).all()
    return list(branches)


@lineages_router.post("/{lineage_id}/branches", response_model=BranchOut, status_code=201)
def create_branch(
    lineage_id: UUID,
    body: BranchCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lineage = _lineage_in_member_family(db, lineage_id, user)
    _member(db, lineage.family_id, user, {"owner", "editor"})
    branch = Branch(
        lineage_id=lineage.id,
        name=body.name.strip(),
        description=body.description,
    )
    db.add(branch)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Энэ удам угсаанд ижил нэртэй салаа аль хэдийн бүртгэгдсэн байна.",
        ) from error
    _audit(db, user, lineage.family_id, "branch.created", "branch", branch.id)
    _commit(db, "Салааг хадгалах үед зөрчил гарлаа.")
    db.refresh(branch)
    return branch



@router.get(
    "/{family_id}/persons/{person_id}/lineage-assignment",
    response_model=PersonLineageAssignmentOut,
)
def get_person_lineage_assignment(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    assignment = db.scalar(
        select(PersonLineageAssignment).where(PersonLineageAssignment.person_id == person.id)
    )
    if assignment is None:
        raise HTTPException(status_code=404, detail="Удам угсааны assignment олдсонгүй.")
    return PersonLineageAssignmentOut(
        person_id=assignment.person_id,
        lineage_id=assignment.lineage_id,
        branch_id=assignment.branch_id,
    )


@router.put(
    "/{family_id}/persons/{person_id}/lineage-assignment",
    response_model=PersonLineageAssignmentOut,
)
def upsert_person_lineage_assignment(
    family_id: UUID,
    person_id: UUID,
    body: PersonLineageAssignmentInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)

    lineage = db.scalar(
        select(Lineage).where(
            Lineage.id == body.lineage_id,
            Lineage.family_id == family_id,
        )
    )
    if lineage is None:
        raise HTTPException(status_code=404, detail="Удам угсаа олдсонгүй.")

    if body.branch_id is not None:
        branch = db.scalar(
            select(Branch).where(
                Branch.id == body.branch_id,
                Branch.lineage_id == lineage.id,
            )
        )
        if branch is None:
            raise HTTPException(status_code=404, detail="Салаа олдсонгүй.")

    assignment = db.scalar(
        select(PersonLineageAssignment).where(
            PersonLineageAssignment.person_id == person.id
        )
    )
    action = (
        "person.lineage_assignment.updated"
        if assignment is not None
        else "person.lineage_assignment.created"
    )
    if assignment is None:
        assignment = PersonLineageAssignment(
            person_id=person.id,
            lineage_id=lineage.id,
            branch_id=body.branch_id,
        )
        db.add(assignment)
    else:
        assignment.lineage_id = lineage.id
        assignment.branch_id = body.branch_id
        assignment.updated_at = datetime.now(UTC)

    try:
        db.flush()
        _audit(db, user, family_id, action, "person", person.id)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Хүний удам угсааны assignment давхар үүссэн байна.",
        ) from error

    db.refresh(assignment)
    return PersonLineageAssignmentOut(
        person_id=assignment.person_id,
        lineage_id=assignment.lineage_id,
        branch_id=assignment.branch_id,
    )


@router.delete(
    "/{family_id}/persons/{person_id}/lineage-assignment",
    status_code=204,
)
def delete_person_lineage_assignment(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    assignment = db.scalar(
        select(PersonLineageAssignment).where(PersonLineageAssignment.person_id == person.id)
    )
    if assignment is None:
        raise HTTPException(status_code=404, detail="Удам угсааны assignment олдсонгүй.")

    _audit(db, user, family_id, "person.lineage_assignment.deleted", "person", person.id)
    db.delete(assignment)
    db.commit()
    return Response(status_code=204)


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
        is_creator = (person.created_by == user.id)
        is_self = (person.id == own_linked_person_id)
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


def _person_profile_output(db: Session, family_id: UUID, person: Person, user: User) -> PersonProfileOut:
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

    # An owner may grant themselves access only when a parent edge exists for
    # their linked Person. The edge is eligibility context; the explicit grant
    # below remains mandatory for every protected operation.
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


@router.post("/{family_id}/relationships/parent-child", status_code=201)
def add_parent_child(
    family_id: UUID,
    body: ParentChildCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    _person_in_family(db, family_id, body.parent_id)
    _person_in_family(db, family_id, body.child_id)
    _assert_person_visible(db, _person_in_family(db, family_id, body.parent_id), user)
    _assert_person_visible(db, _person_in_family(db, family_id, body.child_id), user)
    # Serialize ancestry writes on PostgreSQL to avoid concurrent inverse edges.
    db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
    family_person_ids = select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    edges = db.execute(
        select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
            ParentChildRelationship.parent_id.in_(family_person_ids),
            ParentChildRelationship.child_id.in_(family_person_ids),
        )
    ).all()
    try:
        assert_parent_child_is_acyclic(edges, body.parent_id, body.child_id)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    edge = ParentChildRelationship(
        parent_id=body.parent_id,
        child_id=body.child_id,
        relationship_type=body.relationship_type,
        created_by=user.id,
    )
    db.add(edge)
    db.flush()
    _audit(db, user, family_id, "relationship.parent_child.created", "parent_child", edge.id)
    _commit(db, "Энэ эцэг эх-хүүхдийн холбоо өмнө нь бүртгэгдсэн байна.")
    return {
        "id": edge.id,
        "parent_id": edge.parent_id,
        "child_id": edge.child_id,
        "relationship_type": edge.relationship_type,
    }


@router.post("/{family_id}/marriages", status_code=201)
def create_marriage(
    family_id: UUID,
    body: MarriageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    _person_in_family(db, family_id, body.person_1_id)
    _person_in_family(db, family_id, body.person_2_id)
    _assert_person_visible(db, _person_in_family(db, family_id, body.person_1_id), user)
    _assert_person_visible(db, _person_in_family(db, family_id, body.person_2_id), user)
    try:
        first, second = canonical_pair(body.person_1_id, body.person_2_id)
        assert_date_order(body.start_date, body.end_date)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    marriage = Marriage(
        person_1_id=first,
        person_2_id=second,
        status=body.status,
        start_date=body.start_date,
        end_date=body.end_date,
        location=body.location,
        description=body.description,
        created_by=user.id,
    )
    db.add(marriage)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Ижил хосын идэвхтэй гэрлэлт өмнө нь бүртгэгдсэн байна."
        ) from error
    _audit(db, user, family_id, "marriage.created", "marriage", marriage.id)
    _commit(db, "Энэ хоёр хүний гэрлэлтийн холбоо өмнө нь бүртгэгдсэн байна.")
    return MarriageOut.model_validate(marriage)


@router.get("/{family_id}/marriages", response_model=list[MarriageOut])
def list_marriages(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    _member(db, family_id, user)
    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    family_person_rows = list(
        db.scalars(
            select(Person)
            .join(FamilyPerson)
            .where(
                FamilyPerson.family_id == family_id,
                or_(
                    Person.visibility != "private",
                    Person.created_by == user.id,
                    Person.id == own_link,
                ),
            )
        ).all()
    )
    person_ids = [person.id for person in family_person_rows]
    scopes = active_guardian_scopes(db, user.id, family_id, person_ids)
    relationship_visible = {
        person.id
        for person in family_person_rows
        if not person_is_minor(person) or "view_profile" in scopes.get(person.id, set())
    }
    marriages = list(
        db.execute(
            select(Marriage).where(
                Marriage.person_1_id.in_(person_ids),
                Marriage.person_2_id.in_(person_ids),
                Marriage.deleted_at.is_(None),
            )
            .order_by(*_marriage_order())
        )
        .scalars()
        .all()
    )
    return [
        marriage
        for marriage in marriages
        if marriage.person_1_id in relationship_visible
        and marriage.person_2_id in relationship_visible
    ]


@router.get("/{family_id}/persons/{person_id}/marriages")
def list_person_marriages(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    if person_is_minor(person):
        _require_minor_scope(db, family_id, person, user, "view_profile")
    family_person_ids = set(
        db.scalars(select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)).all()
    )
    statements = select(Marriage).where(
        or_(Marriage.person_1_id == person_id, Marriage.person_2_id == person_id),
        Marriage.deleted_at.is_(None),
    )
    marriages = db.scalars(statements.order_by(*_marriage_order())).all()
    visible = []
    for marriage in marriages:
        if marriage.person_1_id not in family_person_ids or marriage.person_2_id not in family_person_ids:
            continue
        people = _marriage_person_access(db, family_id, marriage, user)
        other = people[1] if people[0].id == person_id else people[0]
        visible.append(
            {
                **MarriageOut.model_validate(marriage).model_dump(),
                "other_person": _person_output(db, family_id, other, user),
            }
        )
    return visible


@router.get("/{family_id}/marriages/{marriage_id}", response_model=MarriageOut)
def get_marriage(
    family_id: UUID,
    marriage_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    marriage = db.get(Marriage, marriage_id)
    if marriage is None or marriage.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Гэрлэлтийн мэдээлэл олдсонгүй.")
    _marriage_person_access(db, family_id, marriage, user)
    return marriage


@router.patch("/{family_id}/marriages/{marriage_id}")
def update_marriage(
    family_id: UUID,
    marriage_id: UUID,
    body: MarriagePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    marriage = db.get(Marriage, marriage_id)
    if marriage is None or marriage.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Гэрлэлтийн мэдээлэл олдсонгүй.")
    _marriage_person_access(db, family_id, marriage, user)
    updates = body.model_dump(exclude_unset=True)
    next_start = updates.get("start_date", marriage.start_date)
    next_end = updates.get("end_date", marriage.end_date)
    try:
        assert_date_order(next_start, next_end)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    next_status = updates.get("status", marriage.status)
    if next_status == "married" and next_end is not None:
        raise HTTPException(status_code=422, detail="Идэвхтэй гэрлэлтийн дууссан огноо байх ёсгүй.")
    for field, value in updates.items():
        setattr(marriage, field, value)
    _audit(
        db,
        user,
        family_id,
        "marriage.divorced" if next_status == "divorced" else "marriage.updated",
        "marriage",
        marriage.id,
    )
    _commit(db, "Ижил хосын идэвхтэй гэрлэлт өмнө нь бүртгэгдсэн байна.")
    return MarriageOut.model_validate(marriage)


@router.delete("/{family_id}/marriages/{marriage_id}", status_code=204)
def remove_marriage(
    family_id: UUID,
    marriage_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    marriage = db.get(Marriage, marriage_id)
    if marriage is None or marriage.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Гэрлэлтийн мэдээлэл олдсонгүй.")
    _person_in_family(db, family_id, marriage.person_1_id)
    _person_in_family(db, family_id, marriage.person_2_id)
    marriage.deleted_at = datetime.now(UTC)
    _audit(db, user, family_id, "marriage.archived", "marriage", marriage.id)
    db.commit()
    return Response(status_code=204)


@router.get("/{family_id}/persons/{person_id}/biography")
def get_biography(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _require_minor_scope(db, family_id, person, user, "manage_biography")
    biography = db.scalar(select(Biography).where(Biography.person_id == person_id))
    return {
        "content": biography.body if biography else "",
        "updated_at": biography.updated_at if biography else None,
    }


@router.put("/{family_id}/persons/{person_id}/biography")
def save_biography(
    family_id: UUID,
    person_id: UUID,
    body: BiographyInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    is_minor_record = _require_minor_scope(db, family_id, person, user, "manage_biography")
    if not is_minor_record and not _can_edit_person(db, family_id, person, user):
        raise HTTPException(status_code=403, detail="Намтар засах эрхгүй.")
    biography = db.scalar(select(Biography).where(Biography.person_id == person_id))
    if biography is None:
        biography = Biography(person_id=person_id, body=body.content, updated_by=user.id)
        db.add(biography)
    else:
        biography.body = body.content
        biography.updated_by = user.id
    db.flush()
    _audit(db, user, family_id, "biography.updated", "person", person_id)
    db.commit()
    return {"content": biography.body, "updated_at": biography.updated_at}


@router.get("/{family_id}/persons/{person_id}/events")
def list_life_events(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _require_minor_scope(db, family_id, person, user, "manage_events")
    return list(
        db.scalars(
            select(LifeEvent).where(LifeEvent.person_id == person_id).order_by(LifeEvent.event_date)
        ).all()
    )


@router.post("/{family_id}/persons/{person_id}/events", status_code=201)
def create_life_event(
    family_id: UUID,
    person_id: UUID,
    body: LifeEventInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    is_minor_record = _require_minor_scope(db, family_id, person, user, "manage_events")
    if not is_minor_record and not _can_edit_person(db, family_id, person, user):
        raise HTTPException(status_code=403, detail="Амьдралын үйл явдал нэмэх эрхгүй.")
    event = LifeEvent(person_id=person_id, created_by=user.id, **body.model_dump())
    db.add(event)
    db.flush()
    _audit(db, user, family_id, "life_event.created", "life_event", event.id)
    db.commit()
    return event


@router.patch("/{family_id}/persons/{person_id}/events/{event_id}")
def update_life_event(
    family_id: UUID,
    person_id: UUID,
    event_id: UUID,
    body: LifeEventInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    is_minor_record = _require_minor_scope(db, family_id, person, user, "manage_events")
    if not is_minor_record and not _can_edit_person(db, family_id, person, user):
        raise HTTPException(status_code=403, detail="Амьдралын үйл явдал засах эрхгүй.")
    event = db.scalar(
        select(LifeEvent).where(LifeEvent.id == event_id, LifeEvent.person_id == person_id)
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Үйл явдал олдсонгүй.")
    for key, value in body.model_dump().items():
        setattr(event, key, value)
    _audit(db, user, family_id, "life_event.updated", "life_event", event.id)
    db.commit()
    return event


@router.delete("/{family_id}/persons/{person_id}/events/{event_id}", status_code=204)
def delete_life_event(
    family_id: UUID,
    person_id: UUID,
    event_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    is_minor_record = _require_minor_scope(db, family_id, person, user, "manage_events")
    if not is_minor_record and not _can_edit_person(db, family_id, person, user):
        raise HTTPException(status_code=403, detail="Амьдралын үйл явдал устгах эрхгүй.")
    event = db.scalar(
        select(LifeEvent).where(LifeEvent.id == event_id, LifeEvent.person_id == person_id)
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Үйл явдал олдсонгүй.")
    _audit(db, user, family_id, "life_event.deleted", "life_event", event.id)
    db.delete(event)
    db.commit()
    return Response(status_code=204)


@router.post(
    "/{family_id}/persons/{person_id}/oral-history/extract",
    response_model=OralHistoryExtractOut,
)
def extract_person_oral_history(
    family_id: UUID,
    person_id: UUID,
    body: OralHistoryExtractInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _require_minor_scope(db, family_id, person, user, "manage_biography")

    full_name = f"{person.first_name} {person.last_name or ''}".strip() or None
    suggested_bio, milestones = parse_oral_narrative(body.narrative_text, person_name=full_name)

    created_count = 0
    bio_updated = False

    can_edit = _can_edit_person(db, family_id, person, user)

    if body.auto_create_events:
        if not can_edit:
            raise HTTPException(status_code=403, detail="Үйл явдал автоматаар үүсгэх эрхгүй.")
        for m in milestones:
            event = LifeEvent(
                person_id=person_id,
                event_type=m.event_type,
                title=m.title,
                event_date=m.event_date,
                date_note=m.date_note,
                location=m.location,
                description=m.description,
                created_by=user.id,
            )
            db.add(event)
            db.flush()
            _audit(db, user, family_id, "life_event.created", "life_event", event.id)
            created_count += 1

    if body.update_biography:
        if not can_edit:
            raise HTTPException(status_code=403, detail="Намтар шинэчлэх эрхгүй.")
        bio = db.scalar(select(Biography).where(Biography.person_id == person_id))
        if bio is None:
            bio = Biography(person_id=person_id, body=suggested_bio, updated_by=user.id)
            db.add(bio)
        else:
            bio.body = suggested_bio
            bio.updated_by = user.id
        db.flush()
        _audit(db, user, family_id, "biography.updated", "person", person_id)
        bio_updated = True

    if created_count > 0 or bio_updated:
        db.commit()

    return OralHistoryExtractOut(
        suggested_biography=suggested_bio,
        extracted_events=[
            ExtractedEventDraft(
                event_type=m.event_type,
                title=m.title,
                event_date=m.event_date,
                date_note=m.date_note,
                location=m.location,
                description=m.description,
            )
            for m in milestones
        ],
        created_events_count=created_count,
        biography_updated=bio_updated,
    )




@router.get("/{family_id}/audit")
def family_audit(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    entries = db.scalars(
        select(AuditLog)
        .where(AuditLog.family_id == family_id)
        .order_by(AuditLog.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": entry.id,
            "actor_id": entry.actor_id,
            "action": entry.action,
            "target_type": entry.target_type,
            "target_id": entry.target_id,
            "created_at": entry.created_at,
        }
        for entry in entries
    ]


@router.get("/{family_id}/invitations", response_model=list[InvitationOut])
def list_pending_invitations(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return only pending invitations for an authorized family owner without exposing token material."""
    _member(db, family_id, user, {"owner"})
    now = datetime.now(UTC)
    invitations = db.scalars(
        select(Invitation)
        .where(
            Invitation.family_id == family_id,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
            Invitation.expires_at > now,
        )
        .order_by(Invitation.created_at.desc(), Invitation.id)
    ).all()
    return [
        InvitationOut(
            id=invitation.id,
            email=invitation.invited_email,
            role=invitation.role,
            expires_at=invitation.expires_at,
            created_at=invitation.created_at,
        )
        for invitation in invitations
    ]


@router.post("/{family_id}/invitations", status_code=201)
def create_invitation(
    family_id: UUID,
    body: InvitationCreate,
    request: Request,
    email_provider: EmailProvider = Depends(get_email_provider),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    email = normalize_email(str(body.email))
    if not _consume_otp_rate(db, "invitation-recipient", email, 5):
        raise HTTPException(
            status_code=429, detail="Хэт олон урилга илгээлээ. Түр хүлээгээд дахин оролдоно уу."
        )
    if not _consume_otp_rate(db, "invitation-owner", str(user.id), 10):
        raise HTTPException(
            status_code=429, detail="Хэт олон урилга илгээлээ. Түр хүлээгээд дахин оролдоно уу."
        )
    if not _consume_otp_rate(db, "invitation-ip", _normalized_ip(request), 20):
        raise HTTPException(
            status_code=429, detail="Хэт олон урилга илгээлээ. Түр хүлээгээд дахин оролдоно уу."
        )
    now = datetime.now(UTC)
    pending = db.scalar(
        select(Invitation.id)
        .where(
            Invitation.family_id == family_id,
            Invitation.invited_email == email,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
            Invitation.expires_at > now,
        )
    )
    if pending is not None:
        raise HTTPException(status_code=409, detail="Энэ хаяг руу идэвхтэй урилга аль хэдийн байна.")

    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user and db.scalar(
        select(FamilyMember.id).where(
            FamilyMember.family_id == family_id, FamilyMember.user_id == existing_user.id
        )
    ):
        raise HTTPException(status_code=409, detail="Энэ хэрэглэгч гэр бүлийн гишүүн байна.")
    raw_token = secrets.token_urlsafe(32)
    invitation = Invitation(
        family_id=family_id,
        invited_email=email,
        role=body.role,
        token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
        invited_by=user.id,
        expires_at=now + timedelta(days=7),
    )
    db.add(invitation)
    try:
        db.flush()
    except IntegrityError as error:
        constraint_name = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        if constraint_name != "uq_invitation_active_family_email" and "uq_invitation_active_family_email" not in str(error.orig):
            db.rollback()
            raise
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Энэ хаяг руу идэвхтэй урилга аль хэдийн байна.",
        ) from error
    _audit(db, user, family_id, "invitation.created", "invitation", invitation.id)
    db.commit()
    family = db.get(Family, family_id)
    settings = get_settings()
    link = f"{settings.email_public_base_url.rstrip('/')}/invite#token={raw_token}"
    try:
        email_provider.send_invitation_email(invitation.invited_email, family.name, link)
    except EmailDeliveryError as error:
        invitation.revoked_at = datetime.now(UTC)
        _audit(db, user, family_id, "invitation.email_failed", "invitation", invitation.id)
        db.commit()
        raise HTTPException(
            status_code=503, detail="Урилгын имэйл илгээж чадсангүй. Дахин оролдоно уу."
        ) from error
    _audit(db, user, family_id, "invitation.sent", "invitation", invitation.id)
    db.commit()
    return {
        "id": invitation.id,
        "email": invitation.invited_email,
        "role": invitation.role,
        "expires_at": invitation.expires_at,
        "delivery": "sent",
        "invite_url": link,
    }


@router.delete("/{family_id}/invitations/{invitation_id}", status_code=204)
def revoke_invitation(
    family_id: UUID,
    invitation_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    invitation = db.scalar(
        select(Invitation)
        .where(Invitation.id == invitation_id, Invitation.family_id == family_id)
        .with_for_update()
    )
    if (
        invitation is None
        or invitation.accepted_at is not None
        or invitation.revoked_at is not None
    ):
        raise HTTPException(status_code=404, detail="Урилга олдсонгүй.")
    invitation.revoked_at = datetime.now(UTC)
    _audit(db, user, family_id, "invitation.revoked", "invitation", invitation.id)
    db.commit()
    return Response(status_code=204)


@invitations_router.post("/accept")
def accept_invitation(
    body: InvitationAccept,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    invitation = db.scalar(
        select(Invitation)
        .where(
            Invitation.token_hash == token_hash,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
            Invitation.expires_at > datetime.now(UTC),
        )
        .with_for_update()
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Урилга хүчингүй эсвэл хугацаа дууссан байна.")
    if not user.email or normalize_email(user.email) != invitation.invited_email:
        raise HTTPException(status_code=403, detail="Энэ урилга өөр имэйл хаягт зориулагдсан.")
    verified_identity = db.scalar(
        select(LoginIdentity.id).where(
            LoginIdentity.user_id == user.id,
            LoginIdentity.provider == "email",
            LoginIdentity.normalized_identifier == invitation.invited_email,
            LoginIdentity.verified_at.is_not(None),
            LoginIdentity.disabled_at.is_(None),
        )
    )
    if user.email_verified_at is None and verified_identity is None:
        raise HTTPException(
            status_code=403, detail="Урилгыг авахын өмнө имэйлээ баталгаажуулна уу."
        )
    if db.scalar(
        select(FamilyMember.id).where(
            FamilyMember.family_id == invitation.family_id, FamilyMember.user_id == user.id
        )
    ):
        raise HTTPException(status_code=409, detail="Та энэ гэр бүлийн гишүүн байна.")
    invitation.accepted_at = datetime.now(UTC)
    db.add(FamilyMember(family_id=invitation.family_id, user_id=user.id, role=invitation.role))
    _audit(db, user, invitation.family_id, "invitation.accepted", "invitation", invitation.id)
    _commit(db, "Урилгыг ашиглах боломжгүй байна.")
    return {"family_id": invitation.family_id, "role": invitation.role}


@router.get("/{family_id}/tree", response_model=TreeOut)
def family_tree(
    family_id: UUID,
    person_id: UUID | None = Query(default=None, description="Контекстийн гол хүн."),
    depth: int = Query(default=2, ge=0, le=5, description="Холбооны гүн, хамгийн ихдээ 5."),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a family-authorized tree neighborhood capped at 300 people and 1,200 edges."""
    _member(db, family_id, user)
    if person_id is None:
        linked_person_id = db.scalar(
            select(UserPersonLink.person_id)
            .join(FamilyPerson, FamilyPerson.person_id == UserPersonLink.person_id)
            .where(UserPersonLink.user_id == user.id, FamilyPerson.family_id == family_id)
        )
        person_id = linked_person_id or db.scalar(
            select(Person.id)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(
                FamilyPerson.family_id == family_id,
                or_(Person.visibility != "private", Person.created_by == user.id),
            )
            .order_by(Person.search_last_name, Person.search_first_name, Person.id)
            .limit(1)
        )
    if person_id is None:
        return {
            "root_person_id": None,
            "persons": [],
            "parent_child_relationships": [],
            "marriages": [],
            "meta": {"depth": depth, "node_count": 0, "node_limit": 300, "truncated": False},
        }

    root = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, root, user)
    people: dict[UUID, Person] = {root.id: root}
    parent_edges: dict[UUID, ParentChildRelationship] = {}
    marriages: dict[UUID, Marriage] = {}
    scopes = active_guardian_scopes(db, user.id, family_id, [root.id])
    own_person_id = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    def can_traverse(person: Person) -> bool:
        return not person_is_minor(person) or "view_profile" in scopes.get(person.id, set())

    frontier = {root.id} if can_traverse(root) else set()
    truncated = False
    node_limit = 300
    edge_limit = 1200

    for _level in range(depth):
        if not frontier:
            break
        parent_rows = list(
            db.scalars(
                select(ParentChildRelationship)
                .where(
                    or_(
                        ParentChildRelationship.parent_id.in_(frontier),
                        ParentChildRelationship.child_id.in_(frontier),
                    )
                )
                .order_by(ParentChildRelationship.id)
                .limit(edge_limit + 1)
            ).all()
        )
        marriage_rows = list(
            db.scalars(
                select(Marriage)
                .where(
                    Marriage.deleted_at.is_(None),
                    or_(Marriage.person_1_id.in_(frontier), Marriage.person_2_id.in_(frontier)),
                )
                .order_by(*_marriage_order())
                .limit(edge_limit + 1)
            ).all()
        )
        if len(parent_rows) > edge_limit or len(marriage_rows) > edge_limit:
            truncated = True
        parent_rows = parent_rows[:edge_limit]
        marriage_rows = marriage_rows[:edge_limit]
        candidate_ids = {
            endpoint
            for edge in parent_rows
            for endpoint in (edge.parent_id, edge.child_id)
        } | {
            endpoint
            for marriage in marriage_rows
            for endpoint in (marriage.person_1_id, marriage.person_2_id)
        }
        candidate_ids -= people.keys()
        candidate_rows = list(
            db.scalars(
                select(Person)
                .join(FamilyPerson, FamilyPerson.person_id == Person.id)
                .where(
                    FamilyPerson.family_id == family_id,
                    Person.id.in_(candidate_ids),
                    or_(
                        Person.visibility != "private",
                        Person.created_by == user.id,
                        Person.id == own_person_id,
                    ),
                )
                .order_by(Person.id)
                .limit(node_limit + 1)
            ).all()
        ) if candidate_ids else []
        if len(candidate_rows) > node_limit:
            truncated = True
            candidate_rows = candidate_rows[:node_limit]
        candidate_scopes = active_guardian_scopes(
            db, user.id, family_id, [person.id for person in candidate_rows]
        )
        scopes.update(candidate_scopes)
        visible_candidates = {
            person.id: person
            for person in candidate_rows
            if not person_is_minor(person)
            or "view_profile" in candidate_scopes.get(person.id, set())
        }
        next_frontier: set[UUID] = set()

        def admit(
            person_id: UUID,
            allowed: dict[UUID, Person],
            next_ids: set[UUID],
        ) -> bool:
            nonlocal truncated
            if person_id in people:
                return True
            person = allowed.get(person_id)
            if person is None:
                return False
            if len(people) >= node_limit:
                truncated = True
                return False
            people[person_id] = person
            next_ids.add(person_id)
            return True

        for edge in parent_rows:
            if not (edge.parent_id in frontier or edge.child_id in frontier):
                continue
            if admit(edge.parent_id, visible_candidates, next_frontier) and admit(
                edge.child_id, visible_candidates, next_frontier
            ):
                parent_edges[edge.id] = edge
            if len(parent_edges) + len(marriages) >= edge_limit:
                truncated = True
                break
        if len(parent_edges) + len(marriages) < edge_limit:
            for marriage in marriage_rows:
                if not (marriage.person_1_id in frontier or marriage.person_2_id in frontier):
                    continue
                if admit(marriage.person_1_id, visible_candidates, next_frontier) and admit(
                    marriage.person_2_id, visible_candidates, next_frontier
                ):
                    marriages[marriage.id] = marriage
                if len(parent_edges) + len(marriages) >= edge_limit:
                    truncated = True
                    break
        frontier = next_frontier

    final_scopes = active_guardian_scopes(db, user.id, family_id, list(people))
    assignment_rows = db.execute(
        select(PersonLineageAssignment, Lineage, Branch)
        .join(Lineage, Lineage.id == PersonLineageAssignment.lineage_id)
        .outerjoin(Branch, Branch.id == PersonLineageAssignment.branch_id)
        .where(
            PersonLineageAssignment.person_id.in_(list(people)),
            Lineage.family_id == family_id,
        )
        .order_by(PersonLineageAssignment.person_id)
    ).all()
    assignment_by_person = {
        assignment.person_id: (lineage, branch)
        for assignment, lineage, branch in assignment_rows
    }

    tree_persons: list[TreePersonOut] = []
    for person in people.values():
        restricted = (
            person_is_minor(person)
            and "view_profile" not in final_scopes.get(person.id, set())
        )
        assignment = assignment_by_person.get(person.id)
        lineage = assignment[0] if assignment else None
        branch = assignment[1] if assignment else None
        tree_persons.append(
            TreePersonOut(
                id=person.id,
                first_name=person.first_name,
                last_name=person.last_name,
                middle_name=person.middle_name,
                gender=person.gender,
                birth_date=None if restricted else person.birth_date,
                is_alive=person.is_alive,
                death_date=None if restricted else person.death_date,
                lineage_id=None if restricted or lineage is None else lineage.id,
                lineage_name=None if restricted or lineage is None else lineage.name,
                branch_id=None if restricted or branch is None else branch.id,
                branch_name=None if restricted or branch is None else branch.name,
                profile_photo_url=None if restricted else person.profile_photo_url,
            )
        )

    return {
        "persons": tree_persons,
        "root_person_id": root.id,
        "parent_child_relationships": list(parent_edges.values()),
        "marriages": list(marriages.values()),
        "meta": {
            "depth": depth,
            "node_count": len(people),
            "node_limit": node_limit,
            "truncated": truncated,
        },
    }


from app.family_chat import router as family_chat_router
from app.family_content import router as family_content_router
from app.family_data import router as family_data_router

router.include_router(family_chat_router)
router.include_router(family_content_router)
router.include_router(family_data_router)

