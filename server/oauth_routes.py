"""
OAuth2 sign-in (Google, GitHub). Callback URLs must use the same public origin as the SPA
(e.g. http://localhost:5173/api/.../callback) so session cookies are set on the Vite dev origin.
"""
from __future__ import annotations

import logging
import os
import urllib.parse
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from auth_tokens import issue_access_token, issue_oauth_state, set_session_cookie, verify_oauth_state
import user_db as db

log = logging.getLogger("equitylens.oauth")

oauth_router = APIRouter(prefix="/api/auth/oauth", tags=["oauth"])

FRONTEND_PUBLIC_URL = os.getenv("FRONTEND_PUBLIC_URL", "http://localhost:5173").rstrip("/")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "").strip()
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "").strip()


def _init_db() -> None:
    db.init_schema()


def _callback_url(provider: str) -> str:
    return f"{FRONTEND_PUBLIC_URL}/api/auth/oauth/{provider}/callback"


def _sign_in_redirect(reason: str) -> RedirectResponse:
    q = urllib.parse.quote(reason, safe="")
    return RedirectResponse(f"{FRONTEND_PUBLIC_URL}/sign-in?oauth_error={q}", status_code=302)


@oauth_router.get("/providers")
def oauth_providers() -> dict[str, Any]:
    _init_db()
    return {
        "google": bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET),
        "github": bool(GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET),
        "apple": False,
    }


@oauth_router.get("/google/start")
def google_start() -> RedirectResponse:
    _init_db()
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET):
        raise HTTPException(503, "Google sign-in is not configured")
    state = issue_oauth_state("google")
    q = urllib.parse.urlencode(
        {
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": _callback_url("google"),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
            "prompt": "select_account",
        }
    )
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{q}")


@oauth_router.get("/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = "") -> RedirectResponse:
    _init_db()
    if error:
        log.info("Google OAuth denied: %s", error)
        return _sign_in_redirect("google_denied")
    if not code or not state:
        return _sign_in_redirect("google_missing_params")
    try:
        verify_oauth_state(state, "google")
    except Exception:
        return _sign_in_redirect("invalid_state")

    try:
        with httpx.Client(timeout=30) as client:
            tok = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "redirect_uri": _callback_url("google"),
                    "grant_type": "authorization_code",
                },
            )
            if tok.status_code != 200:
                log.warning("Google token %s: %s", tok.status_code, tok.text[:200])
                return _sign_in_redirect("google_token")
            at = tok.json().get("access_token", "")
            ui = client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {at}"},
            )
            ui.raise_for_status()
            info = ui.json()
    except Exception:
        log.exception("Google OAuth exchange")
        return _sign_in_redirect("google_failed")

    sub = str(info.get("sub") or "")
    email = (info.get("email") or "").strip().lower()
    if not sub or not email:
        return _sign_in_redirect("google_no_email")

    try:
        uid = db.ensure_oauth_login(email, "google", sub)
    except ValueError as exc:
        if str(exc) == "EMAIL_PASSWORD_CONFLICT":
            return _sign_in_redirect("email_exists")
        log.warning("OAuth user create: %s", exc)
        return _sign_in_redirect("google_failed")

    token = issue_access_token(uid, email)
    resp = RedirectResponse(f"{FRONTEND_PUBLIC_URL}/", status_code=302)
    set_session_cookie(resp, request, token)
    return resp


@oauth_router.get("/github/start")
def github_start() -> RedirectResponse:
    _init_db()
    if not (GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET):
        raise HTTPException(503, "GitHub sign-in is not configured")
    state = issue_oauth_state("github")
    q = urllib.parse.urlencode(
        {
            "client_id": GITHUB_CLIENT_ID,
            "redirect_uri": _callback_url("github"),
            "scope": "read:user user:email",
            "state": state,
        }
    )
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{q}")


def _github_primary_email(client: httpx.Client, access_token: str) -> tuple[str, str]:
    r = client.get(
        "https://api.github.com/user",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "EquityLens-OAuth",
        },
    )
    r.raise_for_status()
    data = r.json()
    sub = str(data.get("id") or "")
    email = (data.get("email") or "").strip().lower()
    if email and sub:
        return sub, email
    if not sub:
        return "", ""
    er = client.get(
        "https://api.github.com/user/emails",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "EquityLens-OAuth",
        },
    )
    er.raise_for_status()
    for row in er.json():
        if isinstance(row, dict) and row.get("primary") and row.get("verified"):
            e = (row.get("email") or "").strip().lower()
            if e:
                return sub, e
    for row in er.json():
        if isinstance(row, dict) and row.get("verified"):
            e = (row.get("email") or "").strip().lower()
            if e:
                return sub, e
    return sub, ""


@oauth_router.get("/github/callback")
def github_callback(request: Request, code: str = "", state: str = "", error: str = "") -> RedirectResponse:
    _init_db()
    if error:
        return _sign_in_redirect("github_denied")
    if not code or not state:
        return _sign_in_redirect("github_missing_params")
    try:
        verify_oauth_state(state, "github")
    except Exception:
        return _sign_in_redirect("invalid_state")

    try:
        with httpx.Client(timeout=30) as client:
            tok = client.post(
                "https://github.com/login/oauth/access_token",
                headers={"Accept": "application/json"},
                data={
                    "client_id": GITHUB_CLIENT_ID,
                    "client_secret": GITHUB_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": _callback_url("github"),
                },
            )
            if tok.status_code != 200:
                return _sign_in_redirect("github_token")
            body = tok.json()
            if body.get("error"):
                log.warning("GitHub token error: %s", body)
                return _sign_in_redirect("github_token")
            access = body.get("access_token", "")
            if not access:
                return _sign_in_redirect("github_token")
            sub, email = _github_primary_email(client, access)
    except Exception:
        log.exception("GitHub OAuth exchange")
        return _sign_in_redirect("github_failed")

    if not sub or not email:
        return _sign_in_redirect("github_no_email")

    try:
        uid = db.ensure_oauth_login(email, "github", sub)
    except ValueError as exc:
        if str(exc) == "EMAIL_PASSWORD_CONFLICT":
            return _sign_in_redirect("email_exists")
        return _sign_in_redirect("github_failed")

    token = issue_access_token(uid, email)
    resp = RedirectResponse(f"{FRONTEND_PUBLIC_URL}/", status_code=302)
    set_session_cookie(resp, request, token)
    return resp
