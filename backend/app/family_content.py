"""Family Archives and Stories endpoints."""

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
    Person,
    Story,
    StoryPerson,
    User,
    UserPersonLink,
)
from app.permissions import _assert_person_visible, _audit, _commit, _member, _person_in_family
from app.privacy import active_guardian_scopes, person_is_minor, require_minor_scope

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
    _member(db, family_id, user, {"owner", "editor"})
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
    _member(db, family_id, user, {"owner", "editor"})
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
    _member(db, family_id, user, {"owner", "editor"})
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
    is_admin = member.role in {"owner", "editor"}
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
    _member(db, family_id, user, {"owner", "editor"})
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
    is_admin = member.role in {"owner", "editor"}
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
    if member.role not in {"owner", "editor"} and story.created_by != user.id:
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
    people = _story_people(db, family_id, [story.id], user).get(story.id, [])
    author_name = db.scalar(select(User.display_name).where(User.id == story.created_by)) or "Нэргүй хэрэглэгч"
    is_admin = member.role in {"owner", "editor"}
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
    if member.role not in {"owner", "editor"} and story.created_by != user.id:
        raise HTTPException(status_code=403, detail="Түүх устгах эрхгүй.")
    _audit(db, user, family_id, "story.deleted", "story", story.id)
    db.delete(story)
    db.commit()
    return Response(status_code=204)

