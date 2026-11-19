"""Authenticated family, membership, lineage, invitation, and tree APIs."""

import hashlib
import secrets
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
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
from app.family_chat import router as family_chat_router
from app.family_content import router as family_content_router
from app.family_data import router as family_data_router
from app.family_people import (
    GuardianshipCreate,
    GuardianshipOut,
    PersonCreate,
    PersonDirectoryItem,
    PersonDirectoryPage,
    PersonOut,
    PersonPatch,
    PersonProfileOut,
    PersonSearchItem,
    PersonSearchPage,
    ProfileRelationPersonOut,
    _can_edit_person,
    _escape_like_prefix,
    _marriage_order,
    _person_output,
    _person_profile_output,
    _require_minor_scope,
)
from app.family_people import router as family_people_router
from app.family_relationships import (
    BiographyInput,
    ExtractedEventDraft,
    KinshipOut,
    LifeEventInput,
    MarriageCreate,
    MarriageOut,
    MarriagePatch,
    OralHistoryExtractInput,
    OralHistoryExtractOut,
    ParentChildCreate,
    ParentChildOut,
    SmartConnectInput,
    SmartConnectOut,
    _marriage_person_access,
)
from app.family_relationships import router as family_relationships_router
from app.identity import normalize_email
from app.models import (
    Archive,
    AuditLog,
    Branch,
    Family,
    FamilyMember,
    FamilyPerson,
    Invitation,
    Lineage,
    LoginIdentity,
    Marriage,
    Memory,
    ParentChildRelationship,
    Person,
    PersonLineageAssignment,
    Story,
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
from app.privacy import (
    active_guardian_scopes,
    person_is_minor,
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
    marriages: list[MarriageOut]
    meta: dict[str, int | bool]


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
        current_membership.role = "editor"
        target_membership.role = "owner"
        _audit(db, user, family_id, "family.owner_transferred", "user", target_user_id)
    else:
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
    return MemberOut(
        user_id=target_user.id, display_name=target_user.display_name, role=target_membership.role
    )


@router.delete("/{family_id}/members/{target_user_id}", status_code=204)
def remove_member(
    family_id: UUID,
    target_user_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin endpoint: Remove a member from the family, or member leaves voluntarily."""
    is_self = user.id == target_user_id
    if not is_self:
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
        owner_count = (
            db.scalar(
                select(func.count(FamilyMember.id)).where(
                    FamilyMember.family_id == family_id,
                    FamilyMember.role == "owner",
                )
            )
            or 0
        )
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

    existing_person_link = db.scalar(
        select(UserPersonLink).where(UserPersonLink.person_id == payload.person_id)
    )
    if existing_person_link and existing_person_link.user_id != target_user_id:
        raise HTTPException(
            status_code=409, detail="Энэ хүн өөр хэрэглэгчийн бүртгэлтэй холбогдсон байна."
        )

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

    link = db.scalar(select(UserPersonLink).where(UserPersonLink.user_id == target_user_id))
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

    marriage_count = 0
    parent_child_count = 0
    generation_depth = 1

    if total_persons > 0:
        marriage_count = (
            db.scalar(
                select(func.count(Marriage.id)).where(
                    Marriage.deleted_at.is_(None),
                    or_(Marriage.person_1_id.in_(person_ids), Marriage.person_2_id.in_(person_ids)),
                )
            )
            or 0
        )

        parent_child_count = (
            db.scalar(
                select(func.count(ParentChildRelationship.id)).where(
                    or_(
                        ParentChildRelationship.parent_id.in_(person_ids),
                        ParentChildRelationship.child_id.in_(person_ids),
                    )
                )
            )
            or 0
        )

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

    total_stories = db.scalar(select(func.count(Story.id)).where(Story.family_id == family_id)) or 0
    total_archives = (
        db.scalar(select(func.count(Archive.id)).where(Archive.family_id == family_id)) or 0
    )
    total_memories = (
        db.scalar(select(func.count(Memory.id)).where(Memory.family_id == family_id)) or 0
    )
    member_count = (
        db.scalar(select(func.count(FamilyMember.id)).where(FamilyMember.family_id == family_id))
        or 0
    )

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
        select(PersonLineageAssignment).where(PersonLineageAssignment.person_id == person.id)
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
        select(Invitation.id).where(
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
        if (
            constraint_name != "uq_invitation_active_family_email"
            and "uq_invitation_active_family_email" not in str(error.orig)
        ):
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
    if family is None:
        raise HTTPException(status_code=404, detail="Гэр бүлийн орчин олдсонгүй.")
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
    own_person_id = db.scalar(
        select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id)
    )

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
            endpoint for edge in parent_rows for endpoint in (edge.parent_id, edge.child_id)
        } | {
            endpoint
            for marriage in marriage_rows
            for endpoint in (marriage.person_1_id, marriage.person_2_id)
        }
        candidate_ids -= people.keys()
        candidate_rows = (
            list(
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
            )
            if candidate_ids
            else []
        )
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


router.include_router(family_people_router)
router.include_router(family_relationships_router)
router.include_router(family_chat_router)
router.include_router(family_content_router)
router.include_router(family_data_router)

__all__ = [
    "BiographyInput",
    "BranchCreate",
    "BranchOut",
    "ExtractedEventDraft",
    "FamilyCreate",
    "FamilyOut",
    "FamilyPatch",
    "FamilyStatsOut",
    "GuardianshipCreate",
    "GuardianshipOut",
    "InvitationAccept",
    "InvitationCreate",
    "InvitationOut",
    "KinshipOut",
    "LifeEventInput",
    "LineageCreate",
    "LineageOut",
    "MarriageCreate",
    "MarriageOut",
    "MarriagePatch",
    "MemberLinkPersonInput",
    "MemberOut",
    "MemberRoleUpdate",
    "OralHistoryExtractInput",
    "OralHistoryExtractOut",
    "ParentChildCreate",
    "ParentChildOut",
    "PersonCreate",
    "PersonDirectoryItem",
    "PersonDirectoryPage",
    "PersonLineageAssignmentInput",
    "PersonLineageAssignmentOut",
    "PersonOut",
    "PersonPatch",
    "PersonProfileOut",
    "PersonSearchItem",
    "PersonSearchPage",
    "ProfileRelationPersonOut",
    "SmartConnectInput",
    "SmartConnectOut",
    "TreeOut",
    "TreeParentChildOut",
    "TreePersonOut",
    "_can_edit_person",
    "_escape_like_prefix",
    "_marriage_order",
    "_marriage_person_access",
    "_person_output",
    "_person_profile_output",
    "_require_minor_scope",
    "invitations_router",
    "lineages_router",
    "router",
]
