"""Shared helpers for the routes."""

from __future__ import annotations

import re
import unicodedata

from fastapi import HTTPException, Request

from ..security import client_key

# Control characters, zero-width characters and the Unicode direction overrides (which can make text read
# differently from what was typed). Written as escapes so the source file itself contains none of them.
_CONTROL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")
EVENT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")
LANGS = ("en", "zh", "ne")


def clean_text(value: str | None, limit: int, multiline: bool = False) -> str:
    """Plain text from a person: normalised, no control or direction-override characters, trimmed to limit."""
    s = unicodedata.normalize("NFC", value or "")
    s = _CONTROL.sub("", s)
    if not multiline:
        s = " ".join(s.split())
    else:
        s = "\n".join(" ".join(line.split()) for line in s.replace("\r\n", "\n").split("\n"))
        s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()[:limit]


def clean_url(value: str | None) -> str:
    s = (value or "").strip()
    if not s:
        return ""
    if not re.match(r"^https?://[^\s/$.?#][^\s]*$", s, re.I) or len(s) > 500:
        raise HTTPException(status_code=422, detail="Links must start with http:// or https://.")
    return s


def lang_of(value: str | None) -> str:
    return value if value in LANGS else "en"


def state(request: Request):
    return request.app.state


def visitor_key(request: Request) -> str:
    """The rate-limit key for whoever sent this request (a keyed hash of their address, never the address)."""
    s = request.app.state.settings
    return client_key(request, s.secret_key, s.trust_proxy, s.trusted_proxy_hops)


def check_event_id(event_id: str) -> str:
    if not EVENT_ID.match(event_id):
        raise HTTPException(status_code=404, detail="No such event.")
    return event_id
