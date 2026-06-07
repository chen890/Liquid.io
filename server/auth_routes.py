"""
User registration, JWT session cookie, and per-user encrypted vault (secrets + files).
"""
from __future__ import annotations

import logging
import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import bcrypt
from pydantic import BaseModel, Field

from auth_config import SESSION_COOKIE_NAME, get_fernet
from auth_tokens import cookie_params, decode_access_token, issue_access_token, set_session_cookie
import user_db as db

log = logging.getLogger("equitylens.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])
vault = APIRouter(prefix="/api/vault", tags=["vault"])
bearer = HTTPBearer(auto_error=False)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _init_db() -> None:
    db.init_schema()


def _hash_password(raw: str) -> str:
    if len(raw) < 10:
        raise HTTPException(400, "Password must be at least 10 characters")
    if len(raw) > 256:
        raise HTTPException(400, "Password too long")
    if len(raw.encode("utf-8")) > 72:
        raise HTTPException(400, "Password is too long (max 72 bytes when encoded as UTF-8)")
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(raw.encode("utf-8"), salt).decode("ascii")


def _verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False


def get_current_user_id(
    request: Request,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> int:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token and creds and creds.scheme.lower() == "bearer":
        token = creds.credentials
    if not token:
        raise HTTPException(401, "Not authenticated")
    data = decode_access_token(token)
    try:
        return int(data["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(401, "Invalid session payload") from exc


UserId = Annotated[int, Depends(get_current_user_id)]


class RegisterBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=256)


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/register", status_code=201)
def auth_register(body: RegisterBody, response: Response, request: Request) -> dict[str, Any]:
    _init_db()
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Invalid email address")
    try:
        ph = _hash_password(body.password)
        uid = db.create_user(email, ph)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        if "unique" in str(exc).lower() or "UNIQUE constraint" in str(exc):
            raise HTTPException(409, "An account with this email already exists") from exc
        log.exception("register failed")
        raise HTTPException(500, "Registration failed") from exc
    token = issue_access_token(uid, email)
    set_session_cookie(response, request, token)
    return {"ok": True, "user": {"id": uid, "email": email}}


@router.post("/login")
def auth_login(body: LoginBody, response: Response, request: Request) -> dict[str, Any]:
    _init_db()
    email = body.email.strip().lower()
    row = db.get_user_by_email(email)
    if not row or not _verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = issue_access_token(row["id"], row["email"])
    set_session_cookie(response, request, token)
    return {"ok": True, "user": {"id": row["id"], "email": row["email"]}}


@router.post("/logout")
def auth_logout(response: Response, request: Request) -> dict[str, bool]:
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=cookie_params(request)["secure"],
        samesite="lax",
    )
    return {"ok": True}


@router.get("/me")
def auth_me(request: Request, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> dict[str, Any]:
    _init_db()
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token and creds and creds.scheme.lower() == "bearer":
        token = creds.credentials
    if not token:
        raise HTTPException(401, "Not authenticated")
    data = decode_access_token(token)
    uid = int(data["sub"])
    user = db.get_user_by_id(uid)
    if not user:
        raise HTTPException(401, "User no longer exists")
    return {"ok": True, "user": {"id": user["id"], "email": user["email"], "createdAt": user["created_at"]}}


# --- Vault ---

fernet = get_fernet()


class SecretPutBody(BaseModel):
    value: str = Field(min_length=0, max_length=500_000)


@vault.get("/secrets")
def vault_list_secrets(uid: UserId) -> dict[str, Any]:
    _init_db()
    items = db.list_secrets(uid)
    return {"ok": True, "secrets": items}


@vault.put("/secrets/{name}")
def vault_put_secret(uid: UserId, name: str, body: SecretPutBody) -> dict[str, Any]:
    _init_db()
    try:
        ct = fernet.encrypt(body.value.encode("utf-8"))
        db.upsert_secret(uid, name, ct)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}


@vault.get("/secrets/{name}")
def vault_get_secret(uid: UserId, name: str) -> dict[str, Any]:
    _init_db()
    try:
        row = db.get_secret_row(uid, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not row:
        raise HTTPException(404, "Secret not found")
    try:
        plain = fernet.decrypt(row["ciphertext"]).decode("utf-8")
    except Exception as exc:
        log.error("Secret decrypt failed for user %s", uid)
        raise HTTPException(500, "Could not decrypt secret (wrong server key?)") from exc
    return {"ok": True, "name": name, "value": plain}


@vault.delete("/secrets/{name}")
def vault_delete_secret(uid: UserId, name: str) -> dict[str, Any]:
    _init_db()
    try:
        ok = db.delete_secret(uid, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not ok:
        raise HTTPException(404, "Secret not found")
    return {"ok": True}


@vault.get("/files")
def vault_list_files(uid: UserId) -> dict[str, Any]:
    _init_db()
    return {"ok": True, "files": db.list_files(uid)}


@vault.post("/files")
async def vault_upload(uid: UserId, file: UploadFile = File(...)) -> dict[str, Any]:
    _init_db()
    raw = await file.read()
    if len(raw) > db.MAX_FILE_BYTES:
        raise HTTPException(413, f"File too large (max {db.MAX_FILE_BYTES // (1024 * 1024)} MB)")
    fname = file.filename or "upload.bin"
    try:
        safe_name = db.validate_filename(fname)
        ct = fernet.encrypt(raw)
        fid = db.insert_file(uid, safe_name, file.content_type or "application/octet-stream", ct, len(raw))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "id": fid, "filename": safe_name}


@vault.get("/files/{file_id}/download")
def vault_download(uid: UserId, file_id: int) -> Response:
    _init_db()
    row = db.get_file_row(uid, file_id)
    if not row:
        raise HTTPException(404, "File not found")
    try:
        plain = fernet.decrypt(row["ciphertext"])
    except Exception as exc:
        log.error("File decrypt failed user=%s file=%s", uid, file_id)
        raise HTTPException(500, "Could not decrypt file") from exc
    return Response(
        content=plain,
        media_type=row["mime"],
        headers={"Content-Disposition": f'attachment; filename="{row["filename"]}"'},
    )


@vault.delete("/files/{file_id}")
def vault_delete_file(uid: UserId, file_id: int) -> dict[str, Any]:
    _init_db()
    if not db.delete_file(uid, file_id):
        raise HTTPException(404, "File not found")
    return {"ok": True}


def register(app: Any) -> None:
    """Attach auth + vault routers and ensure schema exists."""
    _init_db()
    app.include_router(router)
    app.include_router(vault)
    from oauth_routes import oauth_router

    app.include_router(oauth_router)
    log.info("User auth and vault routes mounted")
