"""Family Kinship, Parent-Child Relationships, Marriages, Biographies, Life Events, and Oral History."""

from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.family_people import (
    _can_edit_person,
    _marriage_order,
    _person_output,
    _require_minor_scope,
)
from app.models import (
    Biography,
    Family,
    FamilyPerson,
    LifeEvent,
    Marriage,
    ParentChildRelationship,
    Person,
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
    active_guardian_scopes,
    person_is_minor,
)
from app.relationships import (
    RelationshipError,
    analyze_kinship_relation,
    assert_date_order,
    assert_parent_child_is_acyclic,
    canonical_pair,
)

router = APIRouter()


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


class ParentChildCreate(BaseModel):
    parent_id: UUID
    child_id: UUID
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive)$")


class ParentChildOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    parent_id: UUID
    child_id: UUID
    relationship_type: str
    created_at: datetime


class SmartConnectInput(BaseModel):
    anchor_person_id: UUID
    target_person_id: UUID
    role: str = Field(pattern="^(father|mother|spouse|son|daughter|sibling)$")
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive)$")
    co_parent_id: UUID | None = None
    auto_marry_coparent: bool = True
    apply_to_siblings: bool = True
    create_shared_parent_first_name: str | None = Field(default=None, max_length=120)
    create_shared_parent_last_name: str | None = Field(default=None, max_length=120)
    create_shared_parent_gender: str = Field(default="male", pattern="^(male|female)$")
    marriage_start_date: date | None = None


class SmartConnectOut(BaseModel):
    created_parent_child_edges: int = 0
    created_marriages: int = 0
    created_shared_parent_id: UUID | None = None
    summary: str



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

    person_ids = db.scalars(
        select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    ).all()
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


@router.get(
    "/{family_id}/relationships/parent-child",
    response_model=list[ParentChildOut],
)
def list_parent_child_relationships(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    edges = list(
        db.scalars(
            select(ParentChildRelationship)
            .where(
                ParentChildRelationship.parent_id.in_(person_ids),
                ParentChildRelationship.child_id.in_(person_ids),
            )
            .order_by(ParentChildRelationship.created_at, ParentChildRelationship.id)
        ).all()
    )
    return [
        edge
        for edge in edges
        if edge.parent_id in relationship_visible and edge.child_id in relationship_visible
    ]


@router.delete("/{family_id}/relationships/parent-child", status_code=204)
def remove_parent_child_by_pair(
    family_id: UUID,
    parent_id: UUID = Query(description="Эцэг эсвэл эхийн ID"),
    child_id: UUID = Query(description="Хүүхдийн ID"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    p = _person_in_family(db, family_id, parent_id)
    c = _person_in_family(db, family_id, child_id)
    _assert_person_visible(db, p, user)
    _assert_person_visible(db, c, user)
    edge = db.scalar(
        select(ParentChildRelationship).where(
            ParentChildRelationship.parent_id == parent_id,
            ParentChildRelationship.child_id == child_id,
        )
    )
    if edge is None:
        raise HTTPException(status_code=404, detail="Эцэг эх-хүүхдийн холбоос олдсонгүй.")
    edge_id = edge.id
    db.delete(edge)
    _audit(db, user, family_id, "relationship.parent_child.deleted", "parent_child", edge_id)
    db.commit()
    return Response(status_code=204)


@router.delete("/{family_id}/relationships/parent-child/{relationship_id}", status_code=204)
def remove_parent_child_by_id(
    family_id: UUID,
    relationship_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    edge = db.get(ParentChildRelationship, relationship_id)
    if edge is None:
        raise HTTPException(status_code=404, detail="Эцэг эх-хүүхдийн холбоос олдсонгүй.")
    p = _person_in_family(db, family_id, edge.parent_id)
    c = _person_in_family(db, family_id, edge.child_id)
    _assert_person_visible(db, p, user)
    _assert_person_visible(db, c, user)
    db.delete(edge)
    _audit(
        db,
        user,
        family_id,
        "relationship.parent_child.deleted",
        "parent_child",
        relationship_id,
    )
    db.commit()
    return Response(status_code=204)


@router.post("/{family_id}/relationships/smart-connect", response_model=SmartConnectOut, status_code=201)
def smart_connect_relatives(
    family_id: UUID,
    body: SmartConnectInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Atomically connect two family persons (parent, child, spouse, or sibling) with automatic co-parent marriage and sibling wiring."""
    _member(db, family_id, user, {"owner", "editor"})
    if body.anchor_person_id == body.target_person_id:
        raise HTTPException(status_code=422, detail="Хүн өөрөө өөртэйгөө ураг холбох боломжгүй.")

    anchor = _person_in_family(db, family_id, body.anchor_person_id)
    target = _person_in_family(db, family_id, body.target_person_id)
    _assert_person_visible(db, anchor, user)
    _assert_person_visible(db, target, user)

    db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
    family_person_ids = select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    current_edges = [
        (r[0], r[1])
        for r in db.execute(
            select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
                ParentChildRelationship.parent_id.in_(family_person_ids),
                ParentChildRelationship.child_id.in_(family_person_ids),
            )
        ).all()
    ]

    created_edges = 0
    created_marriages = 0
    created_shared_parent_id: UUID | None = None

    def _ensure_parent_child(p_id: UUID, c_id: UUID) -> bool:
        nonlocal created_edges
        if p_id == c_id:
            return False
        if any(ep == p_id and ec == c_id for ep, ec in current_edges):
            return False
        try:
            assert_parent_child_is_acyclic(current_edges, p_id, c_id)
        except RelationshipError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        edge = ParentChildRelationship(
            parent_id=p_id,
            child_id=c_id,
            relationship_type=body.relationship_type,
            created_by=user.id,
        )
        db.add(edge)
        db.flush()
        current_edges.append((p_id, c_id))
        _audit(db, user, family_id, "relationship.parent_child.created", "parent_child", edge.id)
        created_edges += 1
        return True

    def _ensure_marriage(person_a: UUID, person_b: UUID) -> bool:
        nonlocal created_marriages
        if person_a == person_b:
            return False
        first, second = canonical_pair(person_a, person_b)
        existing = db.scalar(
            select(Marriage).where(
                Marriage.person_1_id == first,
                Marriage.person_2_id == second,
                Marriage.deleted_at.is_(None),
            )
        )
        if existing is not None:
            return False
        marriage = Marriage(
            person_1_id=first,
            person_2_id=second,
            status="married",
            start_date=body.marriage_start_date,
            created_by=user.id,
        )
        db.add(marriage)
        db.flush()
        _audit(db, user, family_id, "marriage.created", "marriage", marriage.id)
        created_marriages += 1
        return True

    anchor_name = f"{anchor.last_name} {anchor.first_name}".strip()
    target_name = f"{target.last_name} {target.first_name}".strip()

    if body.role in {"father", "mother"}:
        # Existing parents of anchor BEFORE adding target
        existing_parent_ids = [ep for ep, ec in current_edges if ec == anchor.id and ep != target.id]
        _ensure_parent_child(target.id, anchor.id)

        co_parent_to_use = body.co_parent_id
        if co_parent_to_use is None and len(existing_parent_ids) == 1:
            co_parent_to_use = existing_parent_ids[0]

        if co_parent_to_use is not None and co_parent_to_use != target.id:
            co_parent = _person_in_family(db, family_id, co_parent_to_use)
            _assert_person_visible(db, co_parent, user)
            if body.auto_marry_coparent:
                _ensure_marriage(target.id, co_parent.id)
            if body.apply_to_siblings:
                sibling_ids = [
                    ec
                    for ep, ec in list(current_edges)
                    if ep == co_parent.id and ec != anchor.id and ec != target.id
                ]
                for sib_id in sibling_ids:
                    try:
                        _ensure_parent_child(target.id, sib_id)
                    except HTTPException:
                        pass

        role_label = "эцэг" if body.role == "father" else "эх"
        summary = f"“{target_name}” нь “{anchor_name}”-ийн {role_label}-ээр амжилттай зангидагдлаа."

    elif body.role == "spouse":
        _ensure_marriage(anchor.id, target.id)
        summary = f"“{anchor_name}” болон “{target_name}” нарын гэрлэлтийн холбоос бүртгэгдлээ."

    elif body.role in {"son", "daughter"}:
        _ensure_parent_child(anchor.id, target.id)
        if body.co_parent_id and body.co_parent_id != anchor.id and body.co_parent_id != target.id:
            co_parent = _person_in_family(db, family_id, body.co_parent_id)
            _assert_person_visible(db, co_parent, user)
            _ensure_parent_child(co_parent.id, target.id)
            if body.auto_marry_coparent:
                _ensure_marriage(anchor.id, co_parent.id)
        role_label = "хүү" if body.role == "son" else "охин"
        summary = f"“{target_name}” нь “{anchor_name}”-ийн {role_label}-өөр модонд зангидагдлаа."

    else:  # sibling
        anchor_parents = [ep for ep, ec in current_edges if ec == anchor.id and ep != target.id]
        target_parents = [ep for ep, ec in current_edges if ec == target.id and ep != anchor.id]

        shared_parents = list(dict.fromkeys(anchor_parents or target_parents))
        if not shared_parents:
            first_name = (body.create_shared_parent_first_name or "").strip()
            last_name = (body.create_shared_parent_last_name or anchor.last_name or target.last_name or "").strip()
            if not first_name:
                first_name = f"{anchor.last_name or anchor.first_name}-ийн эцэг/эх"
            shared_parent = Person(
                first_name=first_name,
                last_name=last_name,
                gender=body.create_shared_parent_gender,
                is_alive=False,
                visibility="family",
                search_first_name=normalize_search_name(first_name),
                search_last_name=normalize_search_name(last_name),
                search_middle_name="",
                created_by=user.id,
            )
            db.add(shared_parent)
            db.flush()
            db.add(FamilyPerson(family_id=family_id, person_id=shared_parent.id, added_by=user.id))
            db.flush()
            _audit(db, user, family_id, "person.created", "person", shared_parent.id)
            created_shared_parent_id = shared_parent.id
            shared_parents = [shared_parent.id]

        for p_id in shared_parents:
            _ensure_parent_child(p_id, anchor.id)
            _ensure_parent_child(p_id, target.id)

        summary = f"“{target_name}” болон “{anchor_name}” нар ах/дүүсийн холбоосоор эцэг эхдээ зангидагдлаа."

    db.commit()
    return SmartConnectOut(
        created_parent_child_edges=created_edges,
        created_marriages=created_marriages,
        created_shared_parent_id=created_shared_parent_id,
        summary=summary,
    )


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
            select(Marriage)
            .where(
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
        if (
            marriage.person_1_id not in family_person_ids
            or marriage.person_2_id not in family_person_ids
        ):
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
