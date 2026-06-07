"""
Load signing and encryption secrets for user auth / vault.

- JWT_SECRET: HS256 signing key (or path via JWT_SECRET_FILE)
- APP_ENCRYPTION_KEY: Fernet URL-safe base64 key (or APP_ENCRYPTION_KEY_FILE)

If unset, stable dev keys are auto-created under <project>/data/ (gitignored).
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from cryptography.fernet import Fernet

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"


def _read_or_create_file_secret(filename: str, generator: str) -> str:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / filename
    if path.is_file():
        return path.read_text().strip()
    raw = generator
    path.write_text(raw, encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return raw


def get_jwt_secret() -> str:
    env = os.getenv("JWT_SECRET", "").strip()
    if env:
        return env
    path = os.getenv("JWT_SECRET_FILE", "").strip()
    if path:
        return Path(path).read_text().strip()
    return _read_or_create_file_secret(
        ".jwt_secret",
        secrets.token_urlsafe(48),
    )


def get_fernet() -> Fernet:
    key = os.getenv("APP_ENCRYPTION_KEY", "").strip()
    if not key:
        p = os.getenv("APP_ENCRYPTION_KEY_FILE", "").strip()
        if p:
            key = Path(p).read_text().strip()
    if not key:
        key = _read_or_create_file_secret(
            ".fernet_key",
            Fernet.generate_key().decode("ascii"),
        )
    return Fernet(key.encode("ascii") if isinstance(key, str) else key)


JWT_ALGORITHM = "HS256"
SESSION_COOKIE_NAME = "ep_session"
# Access token TTL (refresh not implemented — keep modest)
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_MINUTES", "10080"))  # 7 days default
