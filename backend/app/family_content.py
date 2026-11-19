"""Family Archives and Stories endpoints."""

from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import (
    Archive,
    ArchivePerson,
    FamilyPerson,
    Memory,
    MemoryComment,
    MemoryLike,
    MemoryPersonTag,
    Person,
    Photo,
    PhotoPersonTag,
    Story,
    StoryPerson,
    User,
    UserPersonLink,
)
from app.permissions import (
    _assert_person_visible,
    _audit,
    _commit,
    _member,
    _person_in_family,
    has_permission,
)
from app.privacy import active_guardian_scopes, is_minor, person_is_minor, require_minor_scope
from app.storage import ObjectStorage, get_storage

router = APIRouter()


class ArchiveInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=20000)
    document_date: date | None = None
    place: str | None = Field(default=None, max_length=240)
    visibility: str = Field(default="family", pattern="^(private|family|public)$")
    person_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_content(self):
        if not self.title.strip():
            raise ValueError("Архивийн гарчиг хоосон байж болохгүй.")
        if len(set(self.person_ids)) != len(self.person_ids):
            raise ValueError("Холбоотой хүмүүс давхардаж болохгүй.")
        return self


class ArchivePersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None


class ArchiveListItem(BaseModel):
    id: UUID
    title: str
    description: str | None
    document_date: date | None
    place: str | None
    visibility: str
    author_id: UUID
    author_name: str
    related_people_count: int
    created_at: datetime
    updated_at: datetime


class ArchiveListPage(BaseModel):
    items: list[ArchiveListItem]
    page: int
    page_size: int
    total: int
    has_next: bool


class ArchiveOut(ArchiveListItem):
    related_people: list[ArchivePersonOut] = Field(default_factory=list)


class StoryInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=100000)
    event_date: date | None = None
    place: str | None = Field(default=None, max_length=240)
    visibility: str = Field(default="family", pattern="^(private|family|public)$")
    person_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_content(self):
        if not self.title.strip():
            raise ValueError("Түүхийн гарчиг хоосон байж болохгүй.")
        if not self.body.strip():
            raise ValueError("Түүхийн агуулга хоосон байж болохгүй.")
        if len(set(self.person_ids)) != len(self.person_ids):
            raise ValueError("Холбоотой хүмүүс давхардаж болохгүй.")
        return self


class StoryPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    body: str | None = Field(default=None, min_length=1, max_length=100000)
    event_date: date | None = None
    place: str | None = Field(default=None, max_length=240)
    visibility: str | None = Field(default=None, pattern="^(private|family|public)$")
    person_ids: list[UUID] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def validate_content(self):
        if self.title is not None and not self.title.strip():
            raise ValueError("Түүхийн гарчиг хоосон байж болохгүй.")
        if self.body is not None and not self.body.strip():
            raise ValueError("Түүхийн агуулга хоосон байж болохгүй.")
        if self.person_ids is not None and len(set(self.person_ids)) != len(self.person_ids):
            raise ValueError("Холбоотой хүмүүс давхардаж болохгүй.")
        return self


class StoryPersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None


class StoryListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    excerpt: str
    event_date: date | None
    place: str | None
    visibility: str
    author_id: UUID
    author_name: str
    related_people_count: int
    created_at: datetime
    updated_at: datetime
    can_edit: bool = False
    can_delete: bool = False
    is_minor: bool = False


class StoryListPage(BaseModel):
    items: list[StoryListItem]
    page: int
    page_size: int
    total: int
    has_next: bool


class StoryOut(StoryListItem):
    body: str
    related_people: list[StoryPersonOut] = Field(default_factory=list)



def _story_visible(db: Session, story: Story, user: User) -> bool:
    if story.visibility != "private":
        return True
    return story.created_by == user.id


def _story_people(
    db: Session,
    family_id: UUID,
    story_ids: list[UUID],
    user: User,
) -> dict[UUID, list[StoryPersonOut]]:
    if not story_ids:
        return {}
    rows = db.execute(
        select(StoryPerson.story_id, Person)
        .join(Person, Person.id == StoryPerson.person_id)
        .where(
            StoryPerson.family_id == family_id,
            StoryPerson.story_id.in_(story_ids),
        )
        .order_by(Person.last_name, Person.first_name, Person.id)
    ).all()
    person_ids = [person.id for _, person in rows]
    scopes = active_guardian_scopes(db, user.id, family_id, person_ids)
    result: dict[UUID, list[StoryPersonOut]] = {}
    for story_id, person in rows:
        _assert_person_visible(db, person, user)
        if person_is_minor(person) and "view_profile" not in scopes.get(person.id, set()):
            continue
        result.setdefault(story_id, []).append(
            StoryPersonOut.model_validate(person)
        )
    return result


def _validate_story_people(
    db: Session,
    family_id: UUID,
    person_ids: list[UUID],
    user: User,
) -> list[Person]:
    people = []
    for person_id in person_ids:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        if person_is_minor(person):
            require_minor_scope(db, user.id, family_id, person, "view_profile")
        people.append(person)
    return people


def _story_excerpt(body: str) -> str:
    normalized = " ".join(body.split())
    return normalized if len(normalized) <= 220 else normalized[:217].rstrip() + "..."


def _archive_visible(archive: Archive, user: User) -> bool:
    return archive.visibility != "private" or archive.created_by == user.id


def _archive_people(
    db: Session,
    family_id: UUID,
    archive_ids: list[UUID],
    user: User,
) -> dict[UUID, list[ArchivePersonOut]]:
    if not archive_ids:
        return {}
    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    rows = db.execute(
        select(ArchivePerson.archive_id, Person)
        .join(Person, Person.id == ArchivePerson.person_id)
        .where(
            ArchivePerson.family_id == family_id,
            ArchivePerson.archive_id.in_(archive_ids),
            or_(
                Person.visibility != "private",
                Person.created_by == user.id,
                Person.id == own_link,
            ),
        )
        .order_by(Person.last_name, Person.first_name, Person.id)
    ).all()
    person_ids = [person.id for _, person in rows]
    scopes = active_guardian_scopes(db, user.id, family_id, person_ids)
    result: dict[UUID, list[ArchivePersonOut]] = {}
    for archive_id, person in rows:
        if person_is_minor(person) and "view_profile" not in scopes.get(person.id, set()):
            continue
        result.setdefault(archive_id, []).append(ArchivePersonOut.model_validate(person))
    return result


def _validate_archive_people(
    db: Session,
    family_id: UUID,
    person_ids: list[UUID],
    user: User,
) -> list[Person]:
    people: list[Person] = []
    for person_id in dict.fromkeys(person_ids):
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        if person_is_minor(person):
            require_minor_scope(db, user.id, family_id, person, "view_profile")
        people.append(person)
    return people


def _archive_out(
    db: Session,
    family_id: UUID,
    archive: Archive,
    user: User,
) -> ArchiveOut:
    people = _archive_people(db, family_id, [archive.id], user).get(archive.id, [])
    author_name = db.scalar(select(User.display_name).where(User.id == archive.created_by))
    return ArchiveOut(
        id=archive.id,
        title=archive.title,
        description=archive.description,
        document_date=archive.document_date,
        place=archive.place,
        visibility=archive.visibility,
        author_id=archive.created_by,
        author_name=author_name or "Нэргүй хэрэглэгч",
        related_people_count=len(people),
        related_people=people,
        created_at=archive.created_at,
        updated_at=archive.updated_at,
    )


@router.get("/{family_id}/archives", response_model=ArchiveListPage)
def list_archives(
    family_id: UUID,
    q: str | None = Query(default=None, max_length=120),
    document_date: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    conditions = [
        Archive.family_id == family_id,
        or_(Archive.visibility != "private", Archive.created_by == user.id),
    ]
    query = q.strip() if q else ""
    if query:
        pattern = f"%{query}%"
        conditions.append(or_(Archive.title.ilike(pattern), Archive.description.ilike(pattern)))
    if document_date is not None:
        conditions.append(Archive.document_date == document_date)

    total = db.scalar(select(func.count()).select_from(Archive).where(*conditions)) or 0
    archives = list(
        db.scalars(
            select(Archive)
            .where(*conditions)
            .order_by(
                Archive.document_date.desc().nullslast(),
                Archive.created_at.desc(),
                Archive.id,
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    author_ids = [item.created_by for item in archives]
    authors = (
        {
            user_id: name
            for user_id, name in db.execute(
                select(User.id, User.display_name).where(User.id.in_(author_ids))
            ).all()
        }
        if author_ids
        else {}
    )
    people = _archive_people(db, family_id, [item.id for item in archives], user)
    items = [
        ArchiveListItem(
            id=item.id,
            title=item.title,
            description=item.description,
            document_date=item.document_date,
            place=item.place,
            visibility=item.visibility,
            author_id=item.created_by,
            author_name=authors.get(item.created_by, "Нэргүй хэрэглэгч"),
            related_people_count=len(people.get(item.id, [])),
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in archives
    ]
    return ArchiveListPage(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        has_next=(page * page_size) < total,
    )


@router.post("/{family_id}/archives", response_model=ArchiveOut, status_code=201)
def create_archive(
    family_id: UUID,
    body: ArchiveInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, permission="manage_content")
    people = _validate_archive_people(db, family_id, body.person_ids, user)
    archive = Archive(
        family_id=family_id,
        title=body.title.strip(),
        description=body.description.strip() if body.description else None,
        document_date=body.document_date,
        place=body.place.strip() if body.place else None,
        visibility=body.visibility,
        created_by=user.id,
    )
    db.add(archive)
    db.flush()
    for person in people:
        db.add(ArchivePerson(archive_id=archive.id, family_id=family_id, person_id=person.id))
    _audit(db, user, family_id, "archive.created", "archive", archive.id)
    _commit(db, "Ижил архивийн холбоос давхар үүссэн байна.")
    return _archive_out(db, family_id, archive, user)


@router.get("/{family_id}/archives/{archive_id}", response_model=ArchiveOut)
def get_archive(
    family_id: UUID,
    archive_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    archive = db.scalar(
        select(Archive).where(Archive.id == archive_id, Archive.family_id == family_id)
    )
    if archive is None or not _archive_visible(archive, user):
        raise HTTPException(status_code=404, detail="Архив олдсонгүй.")
    return _archive_out(db, family_id, archive, user)


@router.put("/{family_id}/archives/{archive_id}", response_model=ArchiveOut)
def update_archive(
    family_id: UUID,
    archive_id: UUID,
    body: ArchiveInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, permission="manage_content")
    archive = db.scalar(
        select(Archive).where(Archive.id == archive_id, Archive.family_id == family_id)
    )
    if archive is None or not _archive_visible(archive, user):
        raise HTTPException(status_code=404, detail="Архив олдсонгүй.")
    people = _validate_archive_people(db, family_id, body.person_ids, user)
    archive.title = body.title.strip()
    archive.description = body.description.strip() if body.description else None
    archive.document_date = body.document_date
    archive.place = body.place.strip() if body.place else None
    archive.visibility = body.visibility
    archive.updated_at = datetime.now(UTC)
    db.execute(delete(ArchivePerson).where(ArchivePerson.archive_id == archive.id))
    for person in people:
        db.add(ArchivePerson(archive_id=archive.id, family_id=family_id, person_id=person.id))
    _audit(db, user, family_id, "archive.updated", "archive", archive.id)
    _commit(db, "Ижил архивийн холбоос давхар үүссэн байна.")
    return _archive_out(db, family_id, archive, user)


@router.delete("/{family_id}/archives/{archive_id}", status_code=204)
def delete_archive(
    family_id: UUID,
    archive_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, permission="manage_content")
    archive = db.scalar(
        select(Archive).where(Archive.id == archive_id, Archive.family_id == family_id)
    )
    if archive is None or not _archive_visible(archive, user):
        raise HTTPException(status_code=404, detail="Архив олдсонгүй.")
    _audit(db, user, family_id, "archive.deleted", "archive", archive.id)
    db.delete(archive)
    db.commit()
    return Response(status_code=204)


@router.get("/{family_id}/persons/{person_id}/archives", response_model=ArchiveListPage)
def list_person_archives(
    family_id: UUID,
    person_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=5, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    if person_is_minor(person):
        require_minor_scope(db, user.id, family_id, person, "view_profile")
    archive_ids = select(ArchivePerson.archive_id).where(
        ArchivePerson.family_id == family_id,
        ArchivePerson.person_id == person_id,
    )
    conditions = [
        Archive.family_id == family_id,
        Archive.id.in_(archive_ids),
        or_(Archive.visibility != "private", Archive.created_by == user.id),
    ]
    total = db.scalar(select(func.count()).select_from(Archive).where(*conditions)) or 0
    archives = list(
        db.scalars(
            select(Archive)
            .where(*conditions)
            .order_by(Archive.document_date.desc().nullslast(), Archive.created_at.desc(), Archive.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    author_ids = [item.created_by for item in archives]
    authors = (
        {
            user_id: name
            for user_id, name in db.execute(
                select(User.id, User.display_name).where(User.id.in_(author_ids))
            ).all()
        }
        if author_ids
        else {}
    )
    people = _archive_people(db, family_id, [item.id for item in archives], user)
    return ArchiveListPage(
        items=[
            ArchiveListItem(
                id=item.id,
                title=item.title,
                description=item.description,
                document_date=item.document_date,
                place=item.place,
                visibility=item.visibility,
                author_id=item.created_by,
                author_name=authors.get(item.created_by, "Нэргүй хэрэглэгч"),
                related_people_count=len(people.get(item.id, [])),
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
            for item in archives
        ],
        page=page,
        page_size=page_size,
        total=total,
        has_next=(page * page_size) < total,
    )


@router.get("/{family_id}/stories", response_model=StoryListPage)
def list_stories(
    family_id: UUID,
    q: str | None = Query(default=None, max_length=120),
    person_id: UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    is_admin = has_permission(member, "manage_content")
    conditions = [
        Story.family_id == family_id,
        or_(Story.visibility != "private", Story.created_by == user.id),
    ]
    query = q.strip() if q else ""
    if query:
        pattern = f"%{query}%"
        conditions.append(or_(Story.title.ilike(pattern), Story.body.ilike(pattern)))
    if person_id is not None:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        if person_is_minor(person):
            require_minor_scope(db, user.id, family_id, person, "view_profile")
        conditions.append(
            Story.id.in_(
                select(StoryPerson.story_id).where(
                    StoryPerson.family_id == family_id,
                    StoryPerson.person_id == person_id,
                )
            )
        )
    total = db.scalar(select(func.count()).select_from(Story).where(*conditions)) or 0
    stories = list(
        db.scalars(
            select(Story)
            .where(*conditions)
            .order_by(Story.event_date.desc().nullslast(), Story.created_at.desc(), Story.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    author_ids = [story.created_by for story in stories]
    authors = {
        user_id: name
        for user_id, name in db.execute(
            select(User.id, User.display_name).where(User.id.in_(author_ids))
        ).all()
    } if author_ids else {}
    people = _story_people(db, family_id, [story.id for story in stories], user)
    items = [
        StoryListItem(
            id=story.id,
            title=story.title,
            excerpt=_story_excerpt(story.body),
            event_date=story.event_date,
            place=story.place,
            visibility=story.visibility,
            author_id=story.created_by,
            author_name=authors.get(story.created_by, "Нэргүй хэрэглэгч"),
            related_people_count=len(people.get(story.id, [])),
            created_at=story.created_at,
            updated_at=story.updated_at,
            can_edit=is_admin or (story.created_by == user.id),
            can_delete=is_admin or (story.created_by == user.id),
        )
        for story in stories
    ]
    return StoryListPage(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        has_next=(page * page_size) < total,
    )


@router.post("/{family_id}/stories", response_model=StoryOut, status_code=201)
def create_story(
    family_id: UUID,
    body: StoryInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, permission="manage_content")
    people = _validate_story_people(db, family_id, body.person_ids, user)
    story = Story(
        family_id=family_id,
        title=body.title.strip(),
        body=body.body.strip(),
        event_date=body.event_date,
        place=body.place.strip() if body.place else None,
        visibility=body.visibility,
        created_by=user.id,
    )
    db.add(story)
    db.flush()
    for person in people:
        db.add(StoryPerson(story_id=story.id, family_id=family_id, person_id=person.id))
    _audit(db, user, family_id, "story.created", "story", story.id)
    _commit(db, "Ижил түүхийн холбоос давхар үүссэн байна.")
    return StoryOut(
        id=story.id,
        title=story.title,
        excerpt=_story_excerpt(story.body),
        body=story.body,
        event_date=story.event_date,
        place=story.place,
        visibility=story.visibility,
        author_id=story.created_by,
        author_name=user.display_name,
        related_people_count=len(people),
        related_people=[StoryPersonOut.model_validate(person) for person in people],
        created_at=story.created_at,
        updated_at=story.updated_at,
        can_edit=True,
        can_delete=True,
    )


@router.get("/{family_id}/stories/{story_id}", response_model=StoryOut)
def get_story(
    family_id: UUID,
    story_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    is_admin = has_permission(member, "manage_content")
    story = db.scalar(select(Story).where(Story.id == story_id, Story.family_id == family_id))
    if story is None or not _story_visible(db, story, user):
        raise HTTPException(status_code=404, detail="Түүх олдсонгүй.")
    people = _story_people(db, family_id, [story.id], user).get(story.id, [])
    author_name = db.scalar(select(User.display_name).where(User.id == story.created_by)) or "Нэргүй хэрэглэгч"
    can_mutate = is_admin or (story.created_by == user.id)
    return StoryOut(
        id=story.id,
        title=story.title,
        excerpt=_story_excerpt(story.body),
        body=story.body,
        event_date=story.event_date,
        place=story.place,
        visibility=story.visibility,
        author_id=story.created_by,
        author_name=author_name,
        related_people_count=len(people),
        related_people=people,
        created_at=story.created_at,
        updated_at=story.updated_at,
        can_edit=can_mutate,
        can_delete=can_mutate,
    )


@router.put("/{family_id}/stories/{story_id}", response_model=StoryOut)
def update_story(
    family_id: UUID,
    story_id: UUID,
    body: StoryPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    story = db.scalar(select(Story).where(Story.id == story_id, Story.family_id == family_id))
    if story is None or not _story_visible(db, story, user):
        raise HTTPException(status_code=404, detail="Түүх олдсонгүй.")
    if not has_permission(member, "manage_content") and story.created_by != user.id:
        raise HTTPException(status_code=403, detail="Түүх засах эрхгүй.")
    updates = body.model_dump(exclude_unset=True, exclude={"person_ids"})
    if "title" in updates and updates["title"] is not None:
        updates["title"] = updates["title"].strip()
    if "body" in updates and updates["body"] is not None:
        updates["body"] = updates["body"].strip()
    if updates.get("place"):
        updates["place"] = updates["place"].strip()
    for field, value in updates.items():
        setattr(story, field, value)
    if body.person_ids is not None:
        people = _validate_story_people(db, family_id, body.person_ids, user)
        db.execute(delete(StoryPerson).where(StoryPerson.story_id == story.id))
        for person in people:
            db.add(StoryPerson(story_id=story.id, family_id=family_id, person_id=person.id))
    story.updated_at = datetime.now(UTC)
    _audit(db, user, family_id, "story.updated", "story", story.id)
    _commit(db, "Ижил түүхийн холбоос давхар үүссэн байна.")
    story_people_out = _story_people(db, family_id, [story.id], user).get(story.id, [])
    author_name = db.scalar(select(User.display_name).where(User.id == story.created_by)) or "Нэргүй хэрэглэгч"
    is_admin = has_permission(member, "manage_content")
    can_mutate = is_admin or (story.created_by == user.id)
    return StoryOut(
        id=story.id,
        title=story.title,
        excerpt=_story_excerpt(story.body),
        body=story.body,
        event_date=story.event_date,
        place=story.place,
        visibility=story.visibility,
        author_id=story.created_by,
        author_name=author_name,
        related_people_count=len(story_people_out),
        related_people=story_people_out,
        created_at=story.created_at,
        updated_at=story.updated_at,
        can_edit=can_mutate,
        can_delete=can_mutate,
    )


@router.delete("/{family_id}/stories/{story_id}", status_code=204)
def delete_story(
    family_id: UUID,
    story_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    story = db.scalar(select(Story).where(Story.id == story_id, Story.family_id == family_id))
    if story is None or not _story_visible(db, story, user):
        raise HTTPException(status_code=404, detail="Түүх олдсонгүй.")
    if not has_permission(member, "manage_content") and story.created_by != user.id:
        raise HTTPException(status_code=403, detail="Түүх устгах эрхгүй.")
    _audit(db, user, family_id, "story.deleted", "story", story.id)
    db.delete(story)
    db.commit()
    return Response(status_code=204)


class MemoryInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=20000)
    memory_date: date | None = None
    visibility: str = Field(default="family", pattern="^(private|family|public)$")
    person_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def check_title(self):
        if not self.title.strip():
            raise ValueError("Дурсамжийн гарчиг хоосон байж болохгүй.")
        return self




def _assert_memory_minor_scopes(
    db: Session, family_id: UUID, user: User, person_ids: Sequence[UUID]
) -> None:
    for person_id in set(person_ids):
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        require_minor_scope(db, user.id, family_id, person, "manage_memories")


def _memory_visible_to_member(
    db: Session, family_id: UUID, user: User, memory_ids: list[UUID]
) -> set[UUID]:
    if not memory_ids:
        return set()
    tagged = db.execute(
        select(MemoryPersonTag.memory_id, Person.id, Person.birth_date)
        .join(Person, Person.id == MemoryPersonTag.person_id)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(
            MemoryPersonTag.memory_id.in_(memory_ids),
            FamilyPerson.family_id == family_id,
        )
    ).all()
    person_ids = [person_id for _, person_id, _ in tagged]
    scopes = active_guardian_scopes(db, user.id, family_id, person_ids)
    visible = set(memory_ids)
    for memory_id, person_id, birth_date in tagged:
        if is_minor(birth_date) is True and "manage_memories" not in scopes.get(person_id, set()):
            visible.discard(memory_id)
    return visible


class MemoryCommentInput(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_comment_id: UUID | None = None

    @model_validator(mode="after")
    def validate_body(self):
        if not self.body.strip():
            raise ValueError("Сэтгэгдлийн агуулга хоосон байж болохгүй.")
        return self


class MemoryCommentPatch(BaseModel):
    body: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def validate_body(self):
        if not self.body.strip():
            raise ValueError("Сэтгэгдлийн агуулга хоосон байж болохгүй.")
        return self


class MemoryCommentOut(BaseModel):
    id: UUID
    memory_id: UUID
    user_id: UUID
    author_name: str
    parent_comment_id: UUID | None = None
    body: str
    created_at: datetime
    updated_at: datetime
    can_edit: bool = False
    can_delete: bool = False


class MemoryLikeOut(BaseModel):
    memory_id: UUID
    liked_by_me: bool
    like_count: int
    liked_by_names: list[str] = Field(default_factory=list)


def _memory_engagement_batch(
    db: Session,
    memory_ids: list[UUID],
    user_id: UUID,
) -> tuple[dict[UUID, int], set[UUID], dict[UUID, list[str]], dict[UUID, int]]:
    """Return (like_counts, liked_by_me_ids, liked_by_names, comment_counts) for memory_ids."""
    if not memory_ids:
        return {}, set(), {}, {}

    like_rows = db.execute(
        select(MemoryLike.memory_id, MemoryLike.user_id, User.display_name)
        .join(User, User.id == MemoryLike.user_id)
        .where(MemoryLike.memory_id.in_(memory_ids))
        .order_by(MemoryLike.created_at.asc())
    ).all()

    like_counts: dict[UUID, int] = defaultdict(int)
    liked_by_me_ids: set[UUID] = set()
    liked_names: dict[UUID, list[str]] = defaultdict(list)

    for mem_id, liker_id, display_name in like_rows:
        like_counts[mem_id] += 1
        if liker_id == user_id:
            liked_by_me_ids.add(mem_id)
        if display_name and len(liked_names[mem_id]) < 10:
            liked_names[mem_id].append(display_name)

    comment_rows = db.execute(
        select(MemoryComment.memory_id, func.count(MemoryComment.id))
        .where(MemoryComment.memory_id.in_(memory_ids))
        .group_by(MemoryComment.memory_id)
    ).all()
    comment_counts = {mem_id: count for mem_id, count in comment_rows}

    return like_counts, liked_by_me_ids, liked_names, comment_counts




@router.post("/{family_id}/memories", status_code=201)
def create_memory(
    family_id: UUID,
    body: MemoryInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    for person_id in body.person_ids:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        require_minor_scope(db, user.id, family_id, person, "manage_memories")
    memory = Memory(
        family_id=family_id,
        title=body.title.strip(),
        description=body.description,
        memory_date=body.memory_date,
        visibility=body.visibility,
        created_by=user.id,
    )
    db.add(memory)
    db.flush()
    for person_id in set(body.person_ids):
        db.add(MemoryPersonTag(memory_id=memory.id, person_id=person_id))
    _audit(db, user, family_id, "memory.created", "memory", memory.id)
    db.commit()
    return {
        "id": memory.id,
        "title": memory.title,
        "description": memory.description,
        "memory_date": memory.memory_date,
        "visibility": memory.visibility,
        "person_ids": list(set(body.person_ids)),
        "created_at": memory.created_at,
        "like_count": 0,
        "liked_by_me": False,
        "liked_by_names": [],
        "comment_count": 0,
    }


@router.get("/{family_id}/persons/{person_id}/memories")
def list_person_memories(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the existing family Memory list contract scoped to one visible Person."""
    member, _ = _member(db, family_id, user)
    is_admin = has_permission(member, "manage_content")
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    if person_is_minor(person):
        require_minor_scope(db, user.id, family_id, person, "manage_memories")

    memory_ids = select(MemoryPersonTag.memory_id).where(
        MemoryPersonTag.person_id == person_id,
    )
    memories = list(
        db.scalars(
            select(Memory)
            .where(
                Memory.family_id == family_id,
                Memory.id.in_(memory_ids),
                or_(Memory.visibility != "private", Memory.created_by == user.id),
            )
            .order_by(Memory.memory_date.desc())
        ).all()
    )
    visible_ids = _memory_visible_to_member(
        db, family_id, user, [item.id for item in memories]
    )
    visible_memories = [item for item in memories if item.id in visible_ids]
    visible_memory_ids = [item.id for item in visible_memories]
    own_link = db.scalar(
        select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id)
    )
    tagged = (
        db.execute(
            select(
                MemoryPersonTag.memory_id,
                MemoryPersonTag.person_id,
                Person.first_name,
                Person.last_name,
                Person.middle_name,
            )
            .join(Person, Person.id == MemoryPersonTag.person_id)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(
                MemoryPersonTag.memory_id.in_(visible_memory_ids),
                FamilyPerson.family_id == family_id,
                or_(
                    Person.visibility != "private",
                    Person.created_by == user.id,
                    Person.id == own_link,
                ),
            )
            .order_by(MemoryPersonTag.memory_id, Person.last_name, Person.first_name)
        ).all()
        if visible_memory_ids
        else []
    )
    names_by_memory: dict[UUID, list[str]] = {}
    ids_by_memory: dict[UUID, list[UUID]] = {}
    for memory_id, tagged_person_id, first_name, last_name, middle_name in tagged:
        ids_by_memory.setdefault(memory_id, []).append(tagged_person_id)
        names_by_memory.setdefault(memory_id, []).append(
            " ".join(part for part in (last_name, first_name, middle_name) if part)
        )
    like_counts, liked_by_me_ids, liked_names, comment_counts = _memory_engagement_batch(
        db, visible_memory_ids, user.id
    )

    return [
        {
            "id": item.id,
            "title": item.title,
            "description": item.description,
            "memory_date": item.memory_date,
            "visibility": item.visibility,
            "person_ids": ids_by_memory.get(item.id, []),
            "person_names": names_by_memory.get(item.id, []),
            "created_at": item.created_at,
            "created_by": str(item.created_by) if item.created_by else None,
            "can_edit": is_admin or (item.created_by == user.id),
            "can_delete": is_admin or (item.created_by == user.id),
            "like_count": like_counts.get(item.id, 0),
            "liked_by_me": item.id in liked_by_me_ids,
            "liked_by_names": liked_names.get(item.id, []),
            "comment_count": comment_counts.get(item.id, 0),
        }
        for item in visible_memories
    ]



@router.get("/{family_id}/memories/{memory_id}")
def get_memory(
    family_id: UUID,
    memory_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    is_admin = has_permission(member, "manage_content")
    memory = db.scalar(select(Memory).where(Memory.id == memory_id, Memory.family_id == family_id))
    if memory is None or (memory.visibility == "private" and memory.created_by != user.id):
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    can_mutate = is_admin or (memory.created_by == user.id)
    tag_ids = list(
        db.scalars(
            select(MemoryPersonTag.person_id).where(MemoryPersonTag.memory_id == memory_id)
        ).all()
    )
    try:
        _assert_memory_minor_scopes(db, family_id, user, tag_ids)
    except HTTPException as error:
        if error.status_code == 403:
            raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.") from error
        raise
    from app.memory_photos import _photo_payload, _tagged_photo_visibility, _visible_people_query

    photos = db.scalars(
        select(Photo).where(
            Photo.family_id == family_id, Photo.memory_id == memory_id,
            Photo.storage_status == "ready",
        )
        .order_by(Photo.created_at.desc()).limit(50)
    ).all()
    visible_photo_ids = _tagged_photo_visibility(db, family_id, user, photos)
    photo_ids = [photo.id for photo in photos if photo.id in visible_photo_ids]

    tags_by_photo = defaultdict(list)
    people_by_photo = defaultdict(list)
    if photo_ids:
        tag_rows = db.execute(
            select(
                PhotoPersonTag.photo_id,
                Person.id,
                Person.first_name,
                Person.last_name,
                Person.middle_name,
            )
            .join(Person, Person.id == PhotoPersonTag.person_id)
            .where(
                PhotoPersonTag.photo_id.in_(photo_ids),
                PhotoPersonTag.person_id.in_(_visible_people_query(user, family_id)),
            )
        ).all()
        for p_id, p_person_id, p_first, p_last, p_mid in tag_rows:
            tags_by_photo[p_id].append(p_person_id)
            full_name = " ".join(part for part in (p_last, p_first, p_mid) if part) or p_first
            people_by_photo[p_id].append({"id": str(p_person_id), "name": full_name})

    memory_tagged_people = []
    if tag_ids:
        mem_people = db.scalars(select(Person).where(Person.id.in_(tag_ids))).all()
        for p in mem_people:
            full_name = " ".join(part for part in (p.last_name, p.first_name, p.middle_name) if part) or p.first_name
            memory_tagged_people.append({"id": str(p.id), "name": full_name})

    like_counts, liked_by_me_ids, liked_names, comment_counts = _memory_engagement_batch(
        db, [memory.id], user.id
    )

    return {
        "id": memory.id,
        "title": memory.title,
        "description": memory.description,
        "memory_date": memory.memory_date,
        "visibility": memory.visibility,
        "person_ids": tag_ids,
        "tagged_people": memory_tagged_people,
        "created_at": memory.created_at,
        "created_by": str(memory.created_by) if memory.created_by else None,
        "can_edit": can_mutate,
        "can_delete": can_mutate,
        "like_count": like_counts.get(memory.id, 0),
        "liked_by_me": memory.id in liked_by_me_ids,
        "liked_by_names": liked_names.get(memory.id, []),
        "comment_count": comment_counts.get(memory.id, 0),
        "photos": [
            _photo_payload(
                photo,
                tags_by_photo.get(photo.id, []),
                people_by_photo.get(photo.id, []),
            )
            for photo in photos if photo.id in visible_photo_ids
        ],
    }


@router.patch("/{family_id}/memories/{memory_id}")
def update_memory(
    family_id: UUID,
    memory_id: UUID,
    body: MemoryInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    memory = db.scalar(select(Memory).where(Memory.id == memory_id, Memory.family_id == family_id))
    if memory is None:
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    if memory.visibility == "private" and memory.created_by != user.id:
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    if not has_permission(member, "manage_content") and memory.created_by != user.id:
        raise HTTPException(status_code=403, detail="Дурсамж засах эрхгүй.")
    existing_person_ids = list(
        db.scalars(
            select(MemoryPersonTag.person_id).where(MemoryPersonTag.memory_id == memory_id)
        ).all()
    )
    _assert_memory_minor_scopes(db, family_id, user, existing_person_ids)
    for person_id in body.person_ids:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        require_minor_scope(db, user.id, family_id, person, "manage_memories")
    for key in ("title", "description", "memory_date", "visibility"):
        setattr(memory, key, getattr(body, key))
    db.execute(delete(MemoryPersonTag).where(MemoryPersonTag.memory_id == memory_id))
    db.add_all(
        MemoryPersonTag(memory_id=memory_id, person_id=person_id)
        for person_id in set(body.person_ids)
    )
    _audit(db, user, family_id, "memory.updated", "memory", memory_id)
    db.commit()
    return get_memory(family_id, memory_id, user, db)


@router.delete("/{family_id}/memories/{memory_id}", status_code=204)
def delete_memory(
    family_id: UUID,
    memory_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    from app.memory_photos import delete_memory_photos
    member, _ = _member(db, family_id, user)
    memory = db.scalar(select(Memory).where(Memory.id == memory_id, Memory.family_id == family_id))
    if memory is None:
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    if memory.visibility == "private" and memory.created_by != user.id:
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    if not has_permission(member, "manage_content") and memory.created_by != user.id:
        raise HTTPException(status_code=403, detail="Дурсамж устгах эрхгүй.")
    tag_ids = list(
        db.scalars(
            select(MemoryPersonTag.person_id).where(MemoryPersonTag.memory_id == memory_id)
        ).all()
    )
    _assert_memory_minor_scopes(db, family_id, user, tag_ids)
    delete_memory_photos(db, storage, family_id, memory_id, user)
    _audit(db, user, family_id, "memory.deleted", "memory", memory_id)
    db.delete(memory)
    db.commit()
    return Response(status_code=204)


def _assert_visible_memory_for_interaction(
    db: Session,
    family_id: UUID,
    memory_id: UUID,
    user: User,
) -> Memory:
    memory = db.scalar(
        select(Memory).where(Memory.id == memory_id, Memory.family_id == family_id)
    )
    if memory is None or (memory.visibility == "private" and memory.created_by != user.id):
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    tag_ids = list(
        db.scalars(
            select(MemoryPersonTag.person_id).where(MemoryPersonTag.memory_id == memory_id)
        ).all()
    )
    try:
        _assert_memory_minor_scopes(db, family_id, user, tag_ids)
    except HTTPException as error:
        if error.status_code == 403:
            raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.") from error
        raise
    return memory


@router.post("/{family_id}/memories/{memory_id}/like", response_model=MemoryLikeOut)
def toggle_memory_like(
    family_id: UUID,
    memory_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle a single heart (❤️) like on a family memory."""
    _member(db, family_id, user)
    _assert_visible_memory_for_interaction(db, family_id, memory_id, user)

    existing = db.scalar(
        select(MemoryLike).where(
            MemoryLike.memory_id == memory_id,
            MemoryLike.user_id == user.id,
        )
    )
    if existing is not None:
        db.delete(existing)
    else:
        db.add(MemoryLike(memory_id=memory_id, user_id=user.id))
    db.commit()

    like_counts, liked_by_me_ids, liked_names, _ = _memory_engagement_batch(
        db, [memory_id], user.id
    )
    return MemoryLikeOut(
        memory_id=memory_id,
        liked_by_me=memory_id in liked_by_me_ids,
        like_count=like_counts.get(memory_id, 0),
        liked_by_names=liked_names.get(memory_id, []),
    )


@router.get("/{family_id}/memories/{memory_id}/comments", response_model=list[MemoryCommentOut])
def list_memory_comments(
    family_id: UUID,
    memory_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    is_admin = has_permission(member, "manage_content")
    _assert_visible_memory_for_interaction(db, family_id, memory_id, user)

    rows = db.execute(
        select(MemoryComment, User.display_name)
        .join(User, User.id == MemoryComment.user_id)
        .where(MemoryComment.memory_id == memory_id)
        .order_by(MemoryComment.created_at.asc(), MemoryComment.id.asc())
    ).all()

    return [
        MemoryCommentOut(
            id=comment.id,
            memory_id=comment.memory_id,
            user_id=comment.user_id,
            author_name=display_name or "Гишүүн",
            parent_comment_id=comment.parent_comment_id,
            body=comment.body,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            can_edit=(comment.user_id == user.id),
            can_delete=(is_admin or comment.user_id == user.id),
        )
        for comment, display_name in rows
    ]


@router.post(
    "/{family_id}/memories/{memory_id}/comments",
    response_model=MemoryCommentOut,
    status_code=201,
)
def create_memory_comment(
    family_id: UUID,
    memory_id: UUID,
    body: MemoryCommentInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    is_admin = has_permission(member, "manage_content")
    _assert_visible_memory_for_interaction(db, family_id, memory_id, user)

    if body.parent_comment_id is not None:
        parent = db.scalar(
            select(MemoryComment).where(
                MemoryComment.id == body.parent_comment_id,
                MemoryComment.memory_id == memory_id,
            )
        )
        if parent is None:
            raise HTTPException(status_code=404, detail="Хариулах сэтгэгдэл олдсонгүй.")

    comment = MemoryComment(
        memory_id=memory_id,
        user_id=user.id,
        parent_comment_id=body.parent_comment_id,
        body=body.body.strip(),
    )
    db.add(comment)
    db.flush()
    _audit(db, user, family_id, "memory.comment_created", "memory_comment", comment.id)
    db.commit()
    db.refresh(comment)

    return MemoryCommentOut(
        id=comment.id,
        memory_id=comment.memory_id,
        user_id=comment.user_id,
        author_name=user.display_name or "Гишүүн",
        parent_comment_id=comment.parent_comment_id,
        body=comment.body,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        can_edit=True,
        can_delete=(is_admin or True),
    )


@router.patch(
    "/{family_id}/memories/{memory_id}/comments/{comment_id}",
    response_model=MemoryCommentOut,
)
def update_memory_comment(
    family_id: UUID,
    memory_id: UUID,
    comment_id: UUID,
    body: MemoryCommentPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    is_admin = has_permission(member, "manage_content")
    _assert_visible_memory_for_interaction(db, family_id, memory_id, user)

    comment = db.scalar(
        select(MemoryComment).where(
            MemoryComment.id == comment_id,
            MemoryComment.memory_id == memory_id,
        )
    )
    if comment is None:
        raise HTTPException(status_code=404, detail="Сэтгэгдэл олдсонгүй.")
    if comment.user_id != user.id:
        raise HTTPException(status_code=403, detail="Зөвхөн өөрийн сэтгэгдлийг засах боломжтой.")

    comment.body = body.body.strip()
    comment.updated_at = datetime.now(UTC)
    _audit(db, user, family_id, "memory.comment_updated", "memory_comment", comment.id)
    db.commit()
    db.refresh(comment)

    return MemoryCommentOut(
        id=comment.id,
        memory_id=comment.memory_id,
        user_id=comment.user_id,
        author_name=user.display_name or "Гишүүн",
        parent_comment_id=comment.parent_comment_id,
        body=comment.body,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        can_edit=True,
        can_delete=(is_admin or True),
    )


@router.delete(
    "/{family_id}/memories/{memory_id}/comments/{comment_id}",
    status_code=204,
)
def delete_memory_comment(
    family_id: UUID,
    memory_id: UUID,
    comment_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    is_admin = has_permission(member, "manage_content")
    _assert_visible_memory_for_interaction(db, family_id, memory_id, user)

    comment = db.scalar(
        select(MemoryComment).where(
            MemoryComment.id == comment_id,
            MemoryComment.memory_id == memory_id,
        )
    )
    if comment is None:
        raise HTTPException(status_code=404, detail="Сэтгэгдэл олдсонгүй.")
    if not (is_admin or comment.user_id == user.id):
        raise HTTPException(status_code=403, detail="Сэтгэгдэл устгах эрхгүй.")

    _audit(db, user, family_id, "memory.comment_deleted", "memory_comment", comment.id)
    db.delete(comment)
    db.commit()
    return Response(status_code=204)


