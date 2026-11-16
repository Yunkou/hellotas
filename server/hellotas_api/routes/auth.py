"""Signing in with a one-time link sent by email (no passwords)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from ..db import utcnow
from ..mail import Message, text
from ..models import LoginLink, Session, User
from ..security import (create_session, current_user, default_name, email_allowed, get_db,
                        hash_token, new_token, normalise_email)
from .common import lang_of, state, visitor_key
from .me import user_out

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class LinkRequest(BaseModel):
    email: str = Field(max_length=254)
    lang: str = "en"


class Verify(BaseModel):
    token: str = Field(min_length=20, max_length=100)


@router.post("/request", status_code=202)
def request_link(body: LinkRequest, request: Request, db=Depends(get_db)):
    app = state(request)
    s = app.settings
    email = normalise_email(body.email)
    if not email_allowed(email, s.allowed_email_domains):
        domains = ", ".join(s.allowed_email_domains)
        raise HTTPException(status_code=422, detail=f"Use your university email address ({domains}).")
    app.limiter.hit("login_ip", visitor_key(request))
    app.limiter.hit("login", email)
    token = new_token()
    lang = lang_of(body.lang)
    db.add(LoginLink(email=email, token_hash=hash_token(token), lang=lang,
                     expires_at=utcnow() + timedelta(minutes=s.login_link_minutes)))
    db.commit()
    prefix = "" if lang == "en" else f"{lang}/"
    # The token travels in the fragment (#), which browsers never send to servers or put in logs
    link = f"{s.site_url}{prefix}account/#signin={token}"
    sent = app.mailer.send(Message(to=email, subject=text(lang, "login_subject"),
                                   text=text(lang, "login", link=link, minutes=s.login_link_minutes)))
    if not sent:
        raise HTTPException(status_code=503, detail="The sign-in email couldn't be sent just now. Try again soon.")
    return {"sent": True}


@router.post("/verify")
def verify(body: Verify, request: Request, db=Depends(get_db)):
    s = state(request).settings
    now = utcnow()
    link = db.scalar(select(LoginLink).where(LoginLink.token_hash == hash_token(body.token)))
    # Claim the link in one statement, so two requests arriving together can't both sign in with it
    claimed = link is not None and db.execute(
        update(LoginLink).where(LoginLink.id == link.id, LoginLink.used_at.is_(None), LoginLink.expires_at >= now)
        .values(used_at=now)).rowcount == 1
    if not claimed:
        db.rollback()
        raise HTTPException(status_code=400, detail="That sign-in link has expired or was already used. "
                                                    "Ask for a new one.")
    user = db.scalar(select(User).where(User.email == link.email))
    if user is None:
        user = User(email=link.email, display_name=default_name(link.email), lang=link.lang)
        db.add(user)
        db.flush()
    if user.email in s.admin_emails and user.role != "admin":
        user.role = "admin"
    token = create_session(db, user, s.session_days)
    db.commit()
    return {"token": token, "user": user_out(user)}


@router.post("/logout")
def logout(request: Request, user: User = Depends(current_user), db=Depends(get_db)):
    token = request.headers.get("authorization", "")[7:].strip()
    session = db.scalar(select(Session).where(Session.token_hash == hash_token(token)))
    if session:
        db.delete(session)
        db.commit()
    return {"signed_out": True}
