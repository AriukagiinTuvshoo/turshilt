"""Family Messenger / Real-Time Family Chat endpoints with Server-Sent Events (SSE)."""

import asyncio
import json
import threading
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import (
    ChatMessage,
    FamilyMember,
    FamilyPerson,
    Person,
    User,
    UserPersonLink,
)
from app.permissions import _audit, _member

router = APIRouter()

_subscribers_lock = threading.Lock()
_chat_subscribers: dict[
    UUID, list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]]
] = defaultdict(list)


def publish_chat_event(family_id: UUID, event_payload: dict[str, Any]) -> None:
    """Broadcast a real-time chat notification to active SSE subscribers in this family."""
    with _subscribers_lock:
        targets = list(_chat_subscribers.get(family_id, ()))
    for loop, queue in targets:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event_payload)
        except RuntimeError:
            continue


class ChatMessageInput(BaseModel):
    content: str = Field(max_length=4000)
    recipient_id: UUID | None = None


class ChatMessageOut(BaseModel):
    id: UUID
    family_id: UUID
    sender_id: UUID
    sender_name: str
    sender_role: str
    recipient_id: UUID | None = None
    content: str
    created_at: datetime


class ChatMemberOut(BaseModel):
    user_id: UUID
    display_name: str
    role: str
    person_id: UUID | None = None
    person_name: str | None = None


@router.get("/{family_id}/chat/members", response_model=list[ChatMemberOut])
def list_chat_members(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    rows = db.execute(
        select(
            User.id,
            User.display_name,
            FamilyMember.role,
            UserPersonLink.person_id,
            Person.first_name,
            Person.last_name,
        )
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
        .outerjoin(Person, Person.id == UserPersonLink.person_id)
        .where(FamilyMember.family_id == family_id)
        .order_by(FamilyMember.role, User.display_name)
    ).all()

    result: list[ChatMemberOut] = []
    for r in rows:
        p_name = (
            f"{r.last_name + ' ' if r.last_name else ''}{r.first_name}" if r.first_name else None
        )
        result.append(
            ChatMemberOut(
                user_id=r.id,
                display_name=r.display_name or "Гишүүн",
                role=r.role,
                person_id=r.person_id,
                person_name=p_name,
            )
        )
    return result


@router.get("/{family_id}/chat/messages", response_model=list[ChatMessageOut])
def list_chat_messages(
    family_id: UUID,
    recipient_id: UUID | None = None,
    limit: int = 60,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    capped_limit = max(1, min(limit, 100))

    query = (
        select(ChatMessage, User.display_name, FamilyMember.role)
        .join(User, User.id == ChatMessage.sender_id)
        .outerjoin(
            FamilyMember,
            and_(
                FamilyMember.family_id == ChatMessage.family_id,
                FamilyMember.user_id == ChatMessage.sender_id,
            ),
        )
        .where(ChatMessage.family_id == family_id)
    )

    if recipient_id is None:
        query = query.where(ChatMessage.recipient_id.is_(None))
    else:
        query = query.where(
            or_(
                and_(
                    ChatMessage.sender_id == user.id,
                    ChatMessage.recipient_id == recipient_id,
                ),
                and_(
                    ChatMessage.sender_id == recipient_id,
                    ChatMessage.recipient_id == user.id,
                ),
            )
        )

    rows = db.execute(query.order_by(ChatMessage.created_at.desc()).limit(capped_limit)).all()

    reversed_rows = list(reversed(rows))
    return [
        ChatMessageOut(
            id=msg.id,
            family_id=msg.family_id,
            sender_id=msg.sender_id,
            sender_name=disp or "Гишүүн",
            sender_role=role or "member",
            recipient_id=msg.recipient_id,
            content=msg.content,
            created_at=msg.created_at,
        )
        for msg, disp, role in reversed_rows
    ]


@router.get("/{family_id}/chat/stream")
async def stream_chat_events(
    family_id: UUID,
    request: Request,
    once: bool = Query(default=False, description="Emit initial frame and close (for tests)."),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Server-Sent Events stream notifying family members of new or deleted chat messages."""
    _member(db, family_id, user)
    user_id_str = str(user.id)
    family_id_str = str(family_id)

    async def event_generator():
        initial = json.dumps({"status": "ok", "family_id": family_id_str})
        yield f"event: connected\ndata: {initial}\n\n"
        if once:
            return

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        entry = (loop, queue)
        with _subscribers_lock:
            _chat_subscribers[family_id].append(entry)

        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue

                rec_id = event.get("recipient_id")
                snd_id = event.get("sender_id")
                if rec_id is None or rec_id == user_id_str or snd_id == user_id_str:
                    yield f"event: chat_update\ndata: {json.dumps(event)}\n\n"
        finally:
            with _subscribers_lock:
                subs = _chat_subscribers.get(family_id)
                if subs and entry in subs:
                    subs.remove(entry)
                if subs is not None and not subs:
                    _chat_subscribers.pop(family_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{family_id}/chat/messages", response_model=ChatMessageOut)
def send_chat_message(
    family_id: UUID,
    payload: ChatMessageInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    body = payload.content.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Зурвас хоосон байж болохгүй.")

    cutoff = datetime.now(UTC) - timedelta(seconds=60)
    recent_count = (
        db.scalar(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.family_id == family_id,
                ChatMessage.sender_id == user.id,
                ChatMessage.created_at >= cutoff,
            )
        )
        or 0
    )
    if recent_count >= 30:
        raise HTTPException(
            status_code=429,
            detail="Хэт олон зурвас дараалан илгээсэн байна. Түр хүлээнэ үү.",
        )

    if payload.recipient_id is not None:
        target_member = db.scalar(
            select(FamilyMember).where(
                FamilyMember.family_id == family_id,
                FamilyMember.user_id == payload.recipient_id,
            )
        )
        if target_member is None:
            raise HTTPException(
                status_code=404, detail="Хүлээн авагч энэ гэр бүлийн гишүүн биш байна."
            )

    msg = ChatMessage(
        family_id=family_id,
        sender_id=user.id,
        recipient_id=payload.recipient_id,
        content=body[:4000],
    )
    db.add(msg)
    _audit(db, user, family_id, "chat.message_sent", "chat_message", msg.id)
    db.commit()
    db.refresh(msg)

    publish_chat_event(
        family_id,
        {
            "type": "message_created",
            "message_id": str(msg.id),
            "sender_id": str(user.id),
            "recipient_id": str(msg.recipient_id) if msg.recipient_id else None,
        },
    )

    return ChatMessageOut(
        id=msg.id,
        family_id=msg.family_id,
        sender_id=msg.sender_id,
        sender_name=user.display_name or (user.email or "Би"),
        sender_role=member.role,
        recipient_id=msg.recipient_id,
        content=msg.content,
        created_at=msg.created_at,
    )


@router.delete("/{family_id}/chat/messages/{message_id}", status_code=204)
def delete_chat_message(
    family_id: UUID,
    message_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    msg = db.scalar(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.family_id == family_id,
        )
    )
    if msg is None:
        raise HTTPException(status_code=404, detail="Зурвас олдсонгүй.")

    is_admin = member.role in {"owner", "editor"}
    if msg.sender_id != user.id and not is_admin:
        raise HTTPException(status_code=403, detail="Бусдын зурвасыг устгах эрхгүй.")

    sender_id_str = str(msg.sender_id)
    recipient_id_str = str(msg.recipient_id) if msg.recipient_id else None

    _audit(db, user, family_id, "chat.message_deleted", "chat_message", msg.id)
    db.delete(msg)
    db.commit()

    publish_chat_event(
        family_id,
        {
            "type": "message_deleted",
            "message_id": str(message_id),
            "sender_id": sender_id_str,
            "recipient_id": recipient_id_str,
        },
    )
    return Response(status_code=204)
