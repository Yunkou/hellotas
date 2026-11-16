"""Moderation: the queue of posts and reports; roles; usage numbers."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..db import utcnow
from ..models import BuddyIntro, BuddyListing, EventMark, Post, Report, Subscriber, User
from ..security import admin, get_db, moderator
from .posts import post_out

router = APIRouter(prefix="/v1/mod", tags=["moderation"])


class Decision(BaseModel):
    action: str = Field(pattern="^(approve|reject|hide)$")


class Role(BaseModel):
    role: str = Field(pattern="^(member|moderator|admin)$")


@router.get("/queue")
def queue(user: User = Depends(moderator), db=Depends(get_db)):
    pending = [post_out(p, full=True) for p in db.scalars(select(Post).where(Post.status == "pending")
                                                          .order_by(Post.created_at))]
    reports = []
    for r in db.scalars(select(Report).where(Report.resolved.is_(False)).order_by(Report.created_at)):
        post = db.get(Post, r.post_id)
        if post:
            reports.append({"id": r.id, "reason": r.reason, "post": post_out(post, full=True)})
    return {"posts": pending, "reports": reports}


@router.post("/posts/{post_id}")
def decide(post_id: int, body: Decision, user: User = Depends(moderator), db=Depends(get_db)):
    post = db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="No such post.")
    post.status = {"approve": "approved", "reject": "rejected", "hide": "hidden"}[body.action]
    post.moderated_at, post.moderated_by = utcnow(), user.id
    for r in db.scalars(select(Report).where(Report.post_id == post_id)):
        r.resolved = True
    db.commit()
    return post_out(post, full=True)


@router.post("/reports/{report_id}/dismiss")
def dismiss(report_id: int, user: User = Depends(moderator), db=Depends(get_db)):
    r = db.get(Report, report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="No such report.")
    r.resolved = True
    db.commit()
    return {"dismissed": True}


@router.get("/stats")
def stats(user: User = Depends(moderator), db=Depends(get_db)):
    """The numbers that say whether the community features are used."""
    def count(model, *where):
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0
    month = utcnow() - timedelta(days=30)
    return {
        "users": count(User), "users_new_30_days": count(User, User.created_at >= month),
        "users_active_30_days": count(User, User.last_seen_at >= month),
        "event_marks": count(EventMark), "going": count(EventMark, EventMark.status == "going"),
        "buddy_listings": count(BuddyListing), "buddy_requests": count(BuddyIntro),
        "buddy_requests_accepted": count(BuddyIntro, BuddyIntro.status == "accepted"),
        "posts_approved": count(Post, Post.status == "approved"),
        "posts_pending": count(Post, Post.status == "pending"),
        "digest_subscribers": count(Subscriber, Subscriber.status == "active"),
    }


@router.get("/users")
def users(q: str = "", user: User = Depends(admin), db=Depends(get_db)):
    query = select(User).order_by(User.created_at.desc()).limit(50)
    if q:
        query = query.where(User.email.contains(q.lower(), autoescape=True))
    return {"users": [{"id": u.id, "email": u.email, "display_name": u.display_name, "role": u.role}
                      for u in db.scalars(query)]}


@router.post("/users/{user_id}/role")
def set_role(user_id: int, body: Role, user: User = Depends(admin), db=Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="No such user.")
    if target.id == user.id and body.role != "admin":
        raise HTTPException(status_code=400, detail="Ask another admin to change your own role.")
    target.role = body.role
    db.commit()
    return {"id": target.id, "role": target.role}
