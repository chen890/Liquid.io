"""JWT access tokens and session cookie helpers (shared by password + OAuth flows)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import HTTPException, Request, Response

from auth_config import ACCESS_TOKEN_EXPIRE_MINUTES, JWT_ALGORITHM, SESSION_COOKIE_NAME, get_jwt_secret


def issue_access_token(user_id: int, email: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(401, "Session expired — please sign in again") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(401, "Invalid session") from exc


def cookie_params(request: Request) -> dict[str, Any]:
    forwarded = (request.headers.get("x-forwarded-proto") or "").lower()
    secure = request.url.scheme == "https" or forwarded == "https"
    return {
        "httponly": True,
        "secure": secure,
        "samesite": "lax",
        "path": "/",
        "max_age": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(SESSION_COOKIE_NAME, token, **cookie_params(request))


def issue_oauth_state(provider: str) -> str:
    """Short-lived signed state for OAuth CSRF protection."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=10)
    return jwt.encode(
        {"p": provider, "iat": int(now.timestamp()), "exp": int(exp.timestamp())},
        get_jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )


def verify_oauth_state(token: str, provider: str) -> None:
    try:
        data = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError as exc:
        raise HTTPException(400, "Invalid or expired OAuth state — try signing in again") from exc
    if data.get("p") != provider:
        raise HTTPException(400, "OAuth state mismatch")
