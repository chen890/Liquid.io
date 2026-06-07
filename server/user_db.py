"""
SQLite persistence: users, encrypted secrets, encrypted file blobs.
All vault rows are scoped by user_id — queries always filter on the authenticated user.
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from auth_config import DATA_DIR

DB_PATH = Path(os.environ.get("USER_DB_PATH", str(DATA_DIR / "users.db")))

_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    with _lock:
        c = _connect()
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()


def init_schema() -> None:
    with get_conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS user_secrets (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                ciphertext  BLOB NOT NULL,
                updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, name)
            );
            CREATE INDEX IF NOT EXISTS idx_secrets_user ON user_secrets(user_id);

            CREATE TABLE IF NOT EXISTS user_files (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                filename    TEXT NOT NULL,
                mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
                ciphertext  BLOB NOT NULL,
                size_plain  INTEGER NOT NULL,
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_files_user ON user_files(user_id);
            """
        )


_NAME_RE = re.compile(r"^[a-zA-Z0-9._-]{1,128}$")


def validate_secret_name(name: str) -> str:
    name = name.strip()
    if not _NAME_RE.match(name):
        raise ValueError("Invalid secret name (use letters, digits, ._- only, max 128 chars)")
    return name


def validate_filename(name: str) -> str:
    base = Path(name).name.strip()
    if not base or len(base) > 255 or ".." in name:
        raise ValueError("Invalid filename")
    return base


# --- Users ---

def create_user(email: str, password_hash: str) -> int:
    email = email.strip().lower()
    if not email or "@" not in email:
        raise ValueError("Invalid email")
    with get_conn() as c:
        cur = c.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (email, password_hash),
        )
        return int(cur.lastrowid)


def get_user_by_email(email: str) -> dict[str, Any] | None:
    email = email.strip().lower()
    with get_conn() as c:
        row = c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(uid: int) -> dict[str, Any] | None:
    with get_conn() as c:
        row = c.execute(
            "SELECT id, email, created_at FROM users WHERE id = ?",
            (uid,),
        ).fetchone()
        return dict(row) if row else None


def get_user_with_hash(uid: int) -> dict[str, Any] | None:
    with get_conn() as c:
        row = c.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        return dict(row) if row else None


# --- Secrets (caller encrypts / decrypts blobs) ---

def upsert_secret(user_id: int, name: str, ciphertext: bytes) -> None:
    name = validate_secret_name(name)
    with get_conn() as c:
        c.execute(
            """
            INSERT INTO user_secrets (user_id, name, ciphertext)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, name) DO UPDATE SET
                ciphertext = excluded.ciphertext,
                updated_at = datetime('now')
            """,
            (user_id, name, ciphertext),
        )


def list_secrets(user_id: int) -> list[dict[str, Any]]:
    with get_conn() as c:
        rows = c.execute(
            "SELECT name, updated_at FROM user_secrets WHERE user_id = ? ORDER BY name",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_secret_row(user_id: int, name: str) -> dict[str, Any] | None:
    name = validate_secret_name(name)
    with get_conn() as c:
        row = c.execute(
            "SELECT id, ciphertext FROM user_secrets WHERE user_id = ? AND name = ?",
            (user_id, name),
        ).fetchone()
        return dict(row) if row else None


def delete_secret(user_id: int, name: str) -> bool:
    name = validate_secret_name(name)
    with get_conn() as c:
        cur = c.execute(
            "DELETE FROM user_secrets WHERE user_id = ? AND name = ?",
            (user_id, name),
        )
        return cur.rowcount > 0


# --- Files ---

MAX_FILE_BYTES = int(os.environ.get("VAULT_MAX_FILE_MB", "25")) * 1024 * 1024


def insert_file(user_id: int, filename: str, mime: str, ciphertext: bytes, size_plain: int) -> int:
    filename = validate_filename(filename)
    with get_conn() as c:
        cur = c.execute(
            """
            INSERT INTO user_files (user_id, filename, mime, ciphertext, size_plain)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, filename, mime or "application/octet-stream", ciphertext, size_plain),
        )
        return int(cur.lastrowid)


def list_files(user_id: int) -> list[dict[str, Any]]:
    with get_conn() as c:
        rows = c.execute(
            """
            SELECT id, filename, mime, size_plain, updated_at
            FROM user_files WHERE user_id = ? ORDER BY updated_at DESC
            """,
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_file_row(user_id: int, file_id: int) -> dict[str, Any] | None:
    with get_conn() as c:
        row = c.execute(
            """
            SELECT id, filename, mime, ciphertext, size_plain
            FROM user_files WHERE user_id = ? AND id = ?
            """,
            (user_id, file_id),
        ).fetchone()
        return dict(row) if row else None


def delete_file(user_id: int, file_id: int) -> bool:
    with get_conn() as c:
        cur = c.execute("DELETE FROM user_files WHERE user_id = ? AND id = ?", (user_id, file_id))
        return cur.rowcount > 0
