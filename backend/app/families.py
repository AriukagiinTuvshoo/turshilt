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
from app.maintenance import prune_expired_trash
from app.models import (
    Archive,
    AuditLog,
    Branch,
    Donation,
    Family,
    FamilyEvent,
    FamilyFund,
    FamilyMember,
    FamilyPerson,
    FamilyTrashRecord,
    FundExpense,
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
    DEFAULT_ADMIN_PERMISSIONS,
    VALID_PERMISSION_SET,
    _assert_person_visible,
    _audit,
    _commit,
    _member,
    _person_in_family,
    effective_permissions,
    has_permission,
    serialize_permissions,
)
from app.person_search import normalize_search_name
from app.privacy import (
    active_guardian_scopes,
    person_is_minor,
)
from app.relationships import (
    RelationshipError,
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
    permissions: list[str] = Field(default_factory=list)
    admin_title: str | None = None
    parent_family_id: UUID | None = None
    parent_family_name: str | None = None


class ConnectHouseholdInput(BaseModel):
    target_family_id: UUID
    household_person_id: UUID
    target_anchor_person_id: UUID
    relation: str = Field(pattern="^(child_of|parent_of|spouse_of|same_person)$")


class ConnectHouseholdOut(BaseModel):
    household_family_id: UUID
    target_family_id: UUID
    target_family_name: str
    linked_persons_count: int
    bridge_relation: str
    summary: str


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
    permissions: list[str] | None = None
    admin_title: str | None = Field(default=None, max_length=80)

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in {"owner", "admin", "editor", "member"}:
            raise ValueError("Role must be 'owner', 'admin', 'editor', or 'member'")
        return v

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        invalid = [item for item in v if item not in VALID_PERMISSION_SET]
        if invalid:
            raise ValueError(f"Буруу админ эрх: {', '.join(invalid)}")
        return v

    @field_validator("admin_title")
    @classmethod
    def validate_admin_title(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


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
    email: str | None = None
    permissions: list[str] = Field(default_factory=list)
    admin_title: str | None = None
    joined_at: datetime | None = None


class FamilyAdminOverviewOut(BaseModel):
    family_id: UUID
    family_name: str
    my_role: str
    my_admin_title: str | None = None
    my_permissions: list[str]
    total_persons: int
    living_count: int
    deceased_count: int
    generation_depth: int
    marriage_count: int
    parent_child_count: int
    total_stories: int
    total_memories: int
    total_archives: int
    lineages_count: int
    member_count: int
    owner_count: int
    admin_count: int
    editor_count: int
    regular_member_count: int
    pending_invitations_count: int
    unlinked_members_count: int
    trash_count: int
    missing_birth_date_count: int
    missing_gender_count: int
    isolated_persons_count: int
    active_funds_count: int
    upcoming_events_count: int
    confirmed_income_minor: int
    total_expenses_minor: int
    net_balance_minor: int


class AdminDataRefreshOut(BaseModel):
    refreshed_persons: int
    pruned_trash: int
    refreshed_at: datetime


class MemberLinkPersonInput(BaseModel):
    person_id: UUID


class InvitationCreate(BaseModel):
    email: EmailStr
    role: str = Field(pattern="^(admin|editor|member)$")


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


def _family_out(
    family: Family,
    member: FamilyMember,
    parent_names: dict[UUID, str] | None = None,
) -> FamilyOut:
    parent_name = (
        parent_names.get(family.parent_family_id)
        if parent_names and family.parent_family_id is not None
        else None
    )
    return FamilyOut(
        id=family.id,
        name=family.name,
        description=family.description,
        created_at=family.created_at,
        role=member.role,
        permissions=effective_permissions(member),
        admin_title=member.admin_title,
        parent_family_id=family.parent_family_id,
        parent_family_name=parent_name,
    )


def _single_parent_name(db: Session, family: Family) -> dict[UUID, str]:
    if family.parent_family_id is None:
        return {}
    parent_name = db.scalar(select(Family.name).where(Family.id == family.parent_family_id))
    return {family.parent_family_id: parent_name} if parent_name is not None else {}


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
    return _family_out(family, member)


@router.get("", response_model=list[FamilyOut])
def list_families(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Family, FamilyMember)
        .join(FamilyMember, FamilyMember.family_id == Family.id)
        .where(FamilyMember.user_id == user.id, Family.archived_at.is_(None))
        .order_by(Family.created_at)
    ).all()
    parent_ids = {f.parent_family_id for f, _ in rows if f.parent_family_id is not None}
    parent_names: dict[UUID, str] = {}
    if parent_ids:
        parent_names = {
            pid: pname
            for pid, pname in db.execute(
                select(Family.id, Family.name).where(Family.id.in_(parent_ids))
            ).all()
        }
    return [_family_out(f, m, parent_names) for f, m in rows]


@router.get("/{family_id}", response_model=FamilyOut)
def get_family(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    member, family = _member(db, family_id, user)
    return _family_out(family, member, _single_parent_name(db, family))


@router.patch("/{family_id}", response_model=FamilyOut)
def update_family(
    family_id: UUID,
    body: FamilyPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, family = _member(db, family_id, user, permission="manage_settings")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(family, key, value.strip() if key == "name" and value else value)
    _audit(db, user, family_id, "family.updated", "family", family.id)
    db.commit()
    db.refresh(family)
    return _family_out(family, member, _single_parent_name(db, family))


@router.post("/{family_id}/connect-to-clan", response_model=ConnectHouseholdOut)
def connect_household_to_clan(
    family_id: UUID,
    body: ConnectHouseholdInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Connect a personal household family branch onto a chosen anchor person in the main clan."""
    if family_id == body.target_family_id:
        raise HTTPException(status_code=400, detail="Ижил гэр бүлийг өөртэй нь холбох боломжгүй.")

    _, household_family = _member(db, family_id, user, permission="manage_people")
    target_member, target_family = _member(db, body.target_family_id, user)

    ancestor_id = target_family.parent_family_id
    visited_families: set[UUID] = {target_family.id}
    while ancestor_id is not None:
        if ancestor_id == family_id:
            raise HTTPException(
                status_code=409,
                detail="Өрх болон их ургийн мод хоорондоо тойрог холбоос үүсгэх боломжгүй.",
            )
        if ancestor_id in visited_families:
            break
        visited_families.add(ancestor_id)
        ancestor_id = db.scalar(select(Family.parent_family_id).where(Family.id == ancestor_id))

    household_person = _person_in_family(db, family_id, body.household_person_id)
    target_anchor = _person_in_family(db, target_family.id, body.target_anchor_person_id)

    household_person_ids = set(
        db.scalars(select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)).all()
    )
    target_person_ids = set(
        db.scalars(
            select(FamilyPerson.person_id).where(FamilyPerson.family_id == target_family.id)
        ).all()
    )

    newly_attached = 0

    if body.relation == "same_person":
        own_linked_person_id = db.scalar(
            select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id)
        )
        if not (
            has_permission(target_member, "manage_people")
            or target_anchor.id == own_linked_person_id
        ):
            raise HTTPException(
                status_code=403,
                detail="Бусдын бүртгэлтэй хүнийг ижил хүн болгож нэгтгэх эрхгүй байна.",
            )

        if household_person.id != target_anchor.id:
            combined_ids = household_person_ids | target_person_ids
            existing_pc_rows = list(
                db.scalars(
                    select(ParentChildRelationship).where(
                        ParentChildRelationship.parent_id.in_(combined_ids),
                        ParentChildRelationship.child_id.in_(combined_ids),
                    )
                ).all()
            )
            existing_pc_pairs: set[tuple[UUID, UUID]] = {
                (row.parent_id, row.child_id) for row in existing_pc_rows
            }
            for pc in existing_pc_rows:
                touches_household = (
                    (pc.parent_id == household_person.id and pc.child_id in household_person_ids)
                    or (pc.child_id == household_person.id and pc.parent_id in household_person_ids)
                )
                if not touches_household:
                    continue
                new_parent = target_anchor.id if pc.parent_id == household_person.id else pc.parent_id
                new_child = target_anchor.id if pc.child_id == household_person.id else pc.child_id
                if new_parent == new_child or (new_parent, new_child) in existing_pc_pairs:
                    existing_pc_pairs.discard((pc.parent_id, pc.child_id))
                    db.delete(pc)
                    db.flush()
                    continue
                other_edges = [
                    pair for pair in existing_pc_pairs if pair != (pc.parent_id, pc.child_id)
                ]
                try:
                    assert_parent_child_is_acyclic(other_edges, new_parent, new_child)
                except RelationshipError as exc:
                    raise HTTPException(status_code=409, detail=str(exc)) from exc
                existing_pc_pairs.discard((pc.parent_id, pc.child_id))
                existing_pc_pairs.add((new_parent, new_child))
                pc.parent_id = new_parent
                pc.child_id = new_child
                db.flush()

            household_marriages = list(
                db.scalars(
                    select(Marriage).where(
                        Marriage.deleted_at.is_(None),
                        Marriage.person_1_id.in_(household_person_ids),
                        Marriage.person_2_id.in_(household_person_ids),
                    )
                ).all()
            )
            target_active_marriages = {
                (m.person_1_id, m.person_2_id)
                for m in db.scalars(
                    select(Marriage).where(
                        Marriage.deleted_at.is_(None),
                        Marriage.status == "married",
                        or_(
                            Marriage.person_1_id == target_anchor.id,
                            Marriage.person_2_id == target_anchor.id,
                        ),
                    )
                ).all()
            }
            for m in household_marriages:
                if household_person.id not in (m.person_1_id, m.person_2_id):
                    continue
                other_id = m.person_2_id if m.person_1_id == household_person.id else m.person_1_id
                if other_id == target_anchor.id:
                    db.delete(m)
                    db.flush()
                    continue
                p1, p2 = canonical_pair(target_anchor.id, other_id)
                if m.status == "married" and (p1, p2) in target_active_marriages:
                    db.delete(m)
                    db.flush()
                    continue
                m.person_1_id = p1
                m.person_2_id = p2
                db.flush()
                if m.status == "married":
                    target_active_marriages.add((p1, p2))

            household_link = db.scalar(
                select(UserPersonLink).where(UserPersonLink.person_id == household_person.id)
            )
            target_link = db.scalar(
                select(UserPersonLink).where(UserPersonLink.person_id == target_anchor.id)
            )
            if household_link is not None and (
                household_link.user_id == user.id or has_permission(target_member, "manage_members")
            ):
                if target_link is None:
                    household_link.person_id = target_anchor.id
                else:
                    db.delete(household_link)
                db.flush()

            if target_anchor.id not in household_person_ids:
                db.add(FamilyPerson(family_id=family_id, person_id=target_anchor.id, added_by=user.id))
                db.flush()
            old_fp = db.scalar(
                select(FamilyPerson).where(
                    FamilyPerson.family_id == family_id,
                    FamilyPerson.person_id == household_person.id,
                )
            )
            if old_fp is not None:
                db.delete(old_fp)
                db.flush()

            for pid in household_person_ids:
                if pid == household_person.id:
                    continue
                if pid not in target_person_ids:
                    db.add(FamilyPerson(family_id=target_family.id, person_id=pid, added_by=user.id))
                    target_person_ids.add(pid)
                    newly_attached += 1
    else:
        for pid in household_person_ids:
            if pid not in target_person_ids:
                db.add(FamilyPerson(family_id=target_family.id, person_id=pid, added_by=user.id))
                target_person_ids.add(pid)
                newly_attached += 1

        combined_ids = household_person_ids | target_person_ids
        combined_edges = [
            (row[0], row[1])
            for row in db.execute(
                select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
                    ParentChildRelationship.parent_id.in_(combined_ids),
                    ParentChildRelationship.child_id.in_(combined_ids),
                )
            ).all()
        ]

        if body.relation in {"child_of", "parent_of"}:
            parent_id, child_id = (
                (target_anchor.id, household_person.id)
                if body.relation == "child_of"
                else (household_person.id, target_anchor.id)
            )
            try:
                assert_parent_child_is_acyclic(combined_edges, parent_id, child_id)
            except RelationshipError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            if (parent_id, child_id) not in set(combined_edges):
                db.add(
                    ParentChildRelationship(
                        parent_id=parent_id,
                        child_id=child_id,
                        relationship_type="biological",
                        created_by=user.id,
                    )
                )
        else:
            try:
                p1, p2 = canonical_pair(household_person.id, target_anchor.id)
            except RelationshipError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            existing_marriage = db.scalar(
                select(Marriage).where(
                    Marriage.person_1_id == p1,
                    Marriage.person_2_id == p2,
                    Marriage.status == "married",
                    Marriage.deleted_at.is_(None),
                )
            )
            if existing_marriage is None:
                db.add(
                    Marriage(
                        person_1_id=p1,
                        person_2_id=p2,
                        status="married",
                        created_by=user.id,
                    )
                )

    household_family.parent_family_id = target_family.id
    _audit(db, user, family_id, "household.connected_to_clan", "family", target_family.id)
    _audit(db, user, target_family.id, "household.connected_to_clan", "family", family_id)
    _commit(db, "Өрх гэр бүлийг их ургийн модтой холбох үед зөрчил гарлаа.")

    relation_labels = {
        "child_of": f"«{household_person.first_name}» -> «{target_anchor.first_name}»-ийн үр хүүхэд",
        "parent_of": f"«{household_person.first_name}» -> «{target_anchor.first_name}»-ийн эцэг/эх",
        "spouse_of": f"«{household_person.first_name}» болон «{target_anchor.first_name}» гэрлэлт",
        "same_person": f"«{household_person.first_name}» болон «{target_anchor.first_name}» ижил хүн",
    }
    return ConnectHouseholdOut(
        household_family_id=household_family.id,
        target_family_id=target_family.id,
        target_family_name=target_family.name,
        linked_persons_count=newly_attached,
        bridge_relation=body.relation,
        summary=f"«{household_family.name}» өрхийг «{target_family.name}» модтой холболоо ({relation_labels[body.relation]}, шинээр {newly_attached} хүн нэмэгдлээ).",
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
    caller_member, _ = _member(db, family_id, user)
    can_see_email = has_permission(caller_member, "manage_members")
    rows = db.execute(
        select(User.id, User.display_name, User.email, FamilyMember, UserPersonLink.person_id)
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
    ).all()
    role_order = {"owner": 0, "admin": 1, "editor": 2, "member": 3}
    sorted_rows = sorted(
        rows,
        key=lambda r: (role_order.get(r[3].role, 9), (r.display_name or "").casefold()),
    )
    return [
        MemberOut(
            user_id=r.id,
            display_name=r.display_name,
            role=fm.role,
            person_id=person_id,
            email=r.email if can_see_email else None,
            permissions=effective_permissions(fm),
            admin_title=fm.admin_title,
            joined_at=fm.joined_at,
        )
        for r in sorted_rows
        for fm, person_id in [(r[3], r[4])]
    ]


@router.patch("/{family_id}/members/{target_user_id}", response_model=MemberOut)
def update_member_role(
    family_id: UUID,
    target_user_id: UUID,
    payload: MemberRoleUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Super-admin endpoint: owner can assign/configure sub-admin, change role, or transfer ownership."""
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
        current_membership.role = "admin"
        current_membership.permissions_json = serialize_permissions(list(DEFAULT_ADMIN_PERMISSIONS))
        target_membership.role = "owner"
        target_membership.permissions_json = None
        target_membership.admin_title = None
        _audit(db, user, family_id, "family.owner_transferred", "user", target_user_id)
    else:
        if target_membership.role == "owner":
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

        if payload.role == "admin":
            was_admin = target_membership.role == "admin"
            target_membership.role = "admin"
            if payload.permissions is not None:
                target_membership.permissions_json = serialize_permissions(payload.permissions)
            elif not was_admin:
                target_membership.permissions_json = None
            if "admin_title" in payload.model_fields_set:
                target_membership.admin_title = payload.admin_title
            _audit(
                db,
                user,
                family_id,
                "family_member.admin_updated" if was_admin else "family_member.admin_assigned",
                "user",
                target_user_id,
            )
        else:
            target_membership.role = payload.role
            target_membership.permissions_json = None
            target_membership.admin_title = None
            _audit(db, user, family_id, "family_member.role_updated", "user", target_user_id)

    target_person_id = db.scalar(
        select(UserPersonLink.person_id)
        .join(FamilyPerson, FamilyPerson.person_id == UserPersonLink.person_id)
        .where(
            UserPersonLink.user_id == target_user_id,
            FamilyPerson.family_id == family_id,
        )
    )
    db.commit()
    return MemberOut(
        user_id=target_user.id,
        display_name=target_user.display_name,
        role=target_membership.role,
        person_id=target_person_id,
        email=target_user.email,
        permissions=effective_permissions(target_membership),
        admin_title=target_membership.admin_title,
        joined_at=target_membership.joined_at,
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
        caller_membership, _ = _member(db, family_id, user, permission="manage_members")
    else:
        caller_membership, _ = _member(db, family_id, user)

    target_membership = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == target_user_id,
        )
    )
    if not target_membership:
        raise HTTPException(status_code=404, detail="Гишүүн олдсонгүй.")

    if not is_self and caller_membership.role != "owner" and target_membership.role in {"owner", "admin"}:
        raise HTTPException(
            status_code=403, detail="Зөвхөн ерөнхий админ өөр админыг хасах эрхтэй."
        )

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
    caller_member, _ = _member(db, family_id, user)
    if not (has_permission(caller_member, "manage_members") or caller_member.role == "editor"):
        raise HTTPException(status_code=403, detail="Энэ үйлдлийг хийх эрхгүй.")
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
        email=target_user.email if has_permission(caller_member, "manage_members") else None,
        permissions=effective_permissions(target_membership),
        admin_title=target_membership.admin_title,
        joined_at=target_membership.joined_at,
    )


@router.delete("/{family_id}/members/{target_user_id}/unlink-person", status_code=204)
def unlink_member_person(
    family_id: UUID,
    target_user_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin endpoint: unlink a family member account from their tree Person record."""
    caller_member, _ = _member(db, family_id, user)
    if not (has_permission(caller_member, "manage_members") or caller_member.role == "editor"):
        raise HTTPException(status_code=403, detail="Энэ үйлдлийг хийх эрхгүй.")
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


def _compute_generation_depth(
    person_ids: list[UUID], parent_rows: list[tuple[UUID, UUID]]
) -> int:
    if not person_ids:
        return 1
    child_to_parents: dict[UUID, list[UUID]] = defaultdict(list)
    parent_to_children: dict[UUID, list[UUID]] = defaultdict(list)
    for p, c in parent_rows:
        child_to_parents[c].append(p)
        parent_to_children[p].append(c)

    roots = [pid for pid in person_ids if pid not in child_to_parents]
    if not roots:
        return 1
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
    return min(max_depth, 20)


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

        parent_rows = [
            (p, c)
            for p, c in db.execute(
                select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
                    ParentChildRelationship.parent_id.in_(person_ids),
                    ParentChildRelationship.child_id.in_(person_ids),
                )
            ).all()
        ]
        generation_depth = _compute_generation_depth(person_ids, parent_rows)

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
    _member(db, family_id, user, permission="manage_people")
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
    _member(db, lineage.family_id, user, permission="manage_people")
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
    _member(db, family_id, user, permission="manage_people")
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
    _member(db, family_id, user, permission="manage_people")
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


@router.get("/{family_id}/admin/overview", response_model=FamilyAdminOverviewOut)
def get_family_admin_overview(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Comprehensive admin cockpit overview: governance, tree health, finance, and activity counts."""
    member, family = _member(db, family_id, user, {"owner", "admin", "editor"})
    now = datetime.now(UTC)

    person_ids = list(
        db.scalars(select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)).all()
    )
    total_persons = len(person_ids)
    living_count = 0
    deceased_count = 0
    missing_birth_date_count = 0
    missing_gender_count = 0
    marriage_count = 0
    parent_child_count = 0
    generation_depth = 1
    isolated_persons_count = 0

    if total_persons > 0:
        people_rows = db.execute(
            select(Person.id, Person.is_alive, Person.birth_date, Person.gender).where(
                Person.id.in_(person_ids)
            )
        ).all()
        for _pid, is_alive, birth_date, gender in people_rows:
            if is_alive:
                living_count += 1
            else:
                deceased_count += 1
            if birth_date is None:
                missing_birth_date_count += 1
            if gender not in {"male", "female"}:
                missing_gender_count += 1

        parent_rows = [
            (p, c)
            for p, c in db.execute(
                select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
                    ParentChildRelationship.parent_id.in_(person_ids),
                    ParentChildRelationship.child_id.in_(person_ids),
                )
            ).all()
        ]
        parent_child_count = len(parent_rows)
        generation_depth = _compute_generation_depth(person_ids, parent_rows)

        marriage_rows = db.execute(
            select(Marriage.person_1_id, Marriage.person_2_id).where(
                Marriage.deleted_at.is_(None),
                Marriage.person_1_id.in_(person_ids),
                Marriage.person_2_id.in_(person_ids),
            )
        ).all()
        marriage_count = len(marriage_rows)

        if total_persons > 1:
            connected_ids = {endpoint for pair in parent_rows for endpoint in pair} | {
                endpoint for pair in marriage_rows for endpoint in pair
            }
            isolated_persons_count = sum(1 for pid in person_ids if pid not in connected_ids)

    member_rows = db.execute(
        select(FamilyMember.user_id, FamilyMember.role).where(FamilyMember.family_id == family_id)
    ).all()
    owner_count = sum(1 for _, role in member_rows if role == "owner")
    admin_count = sum(1 for _, role in member_rows if role == "admin")
    editor_count = sum(1 for _, role in member_rows if role == "editor")
    regular_member_count = sum(1 for _, role in member_rows if role == "member")

    linked_user_ids = (
        set(
            db.scalars(
                select(UserPersonLink.user_id).where(
                    UserPersonLink.person_id.in_(person_ids),
                )
            ).all()
        )
        if person_ids
        else set()
    )
    unlinked_members_count = sum(1 for uid, _ in member_rows if uid not in linked_user_ids)

    pending_invitations_count = (
        db.scalar(
            select(func.count(Invitation.id)).where(
                Invitation.family_id == family_id,
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
                Invitation.expires_at > now,
            )
        )
        or 0
    )
    total_stories = db.scalar(select(func.count(Story.id)).where(Story.family_id == family_id)) or 0
    total_memories = (
        db.scalar(select(func.count(Memory.id)).where(Memory.family_id == family_id)) or 0
    )
    total_archives = (
        db.scalar(select(func.count(Archive.id)).where(Archive.family_id == family_id)) or 0
    )
    lineages_count = (
        db.scalar(select(func.count(Lineage.id)).where(Lineage.family_id == family_id)) or 0
    )
    trash_count = (
        db.scalar(
            select(func.count(FamilyTrashRecord.id)).where(
                FamilyTrashRecord.family_id == family_id
            )
        )
        or 0
    )
    active_funds_count = (
        db.scalar(
            select(func.count(FamilyFund.id)).where(
                FamilyFund.family_id == family_id,
                FamilyFund.is_active.is_(True),
            )
        )
        or 0
    )
    upcoming_events_count = (
        db.scalar(
            select(func.count(FamilyEvent.id)).where(
                FamilyEvent.family_id == family_id,
                FamilyEvent.starts_at >= now,
            )
        )
        or 0
    )
    confirmed_income_minor = int(
        db.scalar(
            select(func.coalesce(func.sum(Donation.amount_minor), 0)).where(
                Donation.family_id == family_id,
                Donation.status == "confirmed",
            )
        )
        or 0
    )
    total_expenses_minor = int(
        db.scalar(
            select(func.coalesce(func.sum(FundExpense.amount_minor), 0)).where(
                FundExpense.family_id == family_id
            )
        )
        or 0
    )

    return FamilyAdminOverviewOut(
        family_id=family.id,
        family_name=family.name,
        my_role=member.role,
        my_admin_title=member.admin_title,
        my_permissions=effective_permissions(member),
        total_persons=total_persons,
        living_count=living_count,
        deceased_count=deceased_count,
        generation_depth=generation_depth,
        marriage_count=marriage_count,
        parent_child_count=parent_child_count,
        total_stories=total_stories,
        total_memories=total_memories,
        total_archives=total_archives,
        lineages_count=lineages_count,
        member_count=len(member_rows),
        owner_count=owner_count,
        admin_count=admin_count,
        editor_count=editor_count,
        regular_member_count=regular_member_count,
        pending_invitations_count=pending_invitations_count,
        unlinked_members_count=unlinked_members_count,
        trash_count=trash_count,
        missing_birth_date_count=missing_birth_date_count,
        missing_gender_count=missing_gender_count,
        isolated_persons_count=isolated_persons_count,
        active_funds_count=active_funds_count,
        upcoming_events_count=upcoming_events_count,
        confirmed_income_minor=confirmed_income_minor,
        total_expenses_minor=total_expenses_minor,
        net_balance_minor=confirmed_income_minor - total_expenses_minor,
    )


@router.post("/{family_id}/admin/reindex-data", response_model=AdminDataRefreshOut)
def reindex_family_data(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Normalize names, rebuild search prefixes, and prune expired trash records for this family."""
    _member(db, family_id, user, permission="manage_data")
    people = list(
        db.scalars(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(FamilyPerson.family_id == family_id)
        ).all()
    )
    for person in people:
        person.first_name = (person.first_name or "").strip() or person.first_name
        person.last_name = (person.last_name or "").strip()
        if person.middle_name is not None:
            person.middle_name = person.middle_name.strip() or None
        if person.nickname is not None:
            person.nickname = person.nickname.strip() or None
        person.search_first_name = normalize_search_name(person.first_name)
        person.search_last_name = normalize_search_name(person.last_name)
        person.search_middle_name = normalize_search_name(person.middle_name)

    pruned_trash, _pruned_orphans = prune_expired_trash(
        db,
        family_id=family_id,
        retention_days=get_settings().trash_retention_days,
    )
    _audit(db, user, family_id, "family.data_refreshed", "family", family_id)
    db.commit()
    return AdminDataRefreshOut(
        refreshed_persons=len(people),
        pruned_trash=pruned_trash,
        refreshed_at=datetime.now(UTC),
    )


@router.get("/{family_id}/audit")
def family_audit(
    family_id: UUID,
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, permission="view_audit")
    rows = db.execute(
        select(AuditLog, User.display_name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.family_id == family_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": entry.id,
            "actor_id": entry.actor_id,
            "actor_name": actor_name,
            "action": entry.action,
            "target_type": entry.target_type,
            "target_id": entry.target_id,
            "created_at": entry.created_at,
        }
        for entry, actor_name in rows
    ]


@router.get("/{family_id}/invitations", response_model=list[InvitationOut])
def list_pending_invitations(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return only pending invitations for an authorized family admin without exposing token material."""
    _member(db, family_id, user, permission="manage_members")
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
    caller_member, _ = _member(db, family_id, user, permission="manage_members")
    if body.role == "admin" and caller_member.role != "owner":
        raise HTTPException(status_code=403, detail="Зөвхөн ерөнхий админ туслах админ урих эрхтэй.")
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
    _member(db, family_id, user, permission="manage_members")
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
    "AdminDataRefreshOut",
    "BiographyInput",
    "BranchCreate",
    "BranchOut",
    "ConnectHouseholdInput",
    "ConnectHouseholdOut",
    "ExtractedEventDraft",
    "FamilyAdminOverviewOut",
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
