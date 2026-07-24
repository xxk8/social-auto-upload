"""Database initialization and connection management.

Default backend is SQLite (local shell). When ``DATABASE_URL`` or
``SAU_DATABASE_URL`` is set to a ``postgresql://…`` DSN, connections
use PostgreSQL via psycopg with a thin sqlite3-compatible wrapper so
existing ``?`` placeholders and ``conn.execute(...).fetchall()`` call
sites keep working.
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).parent.parent.resolve()
DB_DIR = BASE_DIR / "db"
DB_DIR.mkdir(exist_ok=True)
DB_PATH = DB_DIR / "database.db"

db_lock = threading.Lock()

_DATABASE_URL = (os.environ.get("DATABASE_URL") or os.environ.get("SAU_DATABASE_URL") or "").strip()
_PLACEHOLDER_RE = re.compile(r"'[^']*'|\?")


def backend_name() -> str:
    return "postgres" if _DATABASE_URL else "sqlite"


def using_postgres() -> bool:
    return bool(_DATABASE_URL)


def _translate_placeholders(sql: str) -> str:
    return _PLACEHOLDER_RE.sub(lambda m: "%s" if m.group(0) == "?" else m.group(0), sql)


def _sqlite_ddl_to_pg(sql: str) -> str:
    sql = re.sub(
        r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT",
        "SERIAL PRIMARY KEY",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(r"\bAUTOINCREMENT\b", "", sql, flags=re.IGNORECASE)
    return sql


class _PgCursor:
    def __init__(self, conn: "_PostgresCompat", sql: str | None = None, params: tuple = ()):
        self._conn = conn
        self._rows: list[Any] = []
        self._description = None
        self.lastrowid = None
        if sql is not None:
            self.execute(sql, params)

    def execute(self, sql: str, params: tuple | list | None = None):
        params = tuple(params or ())
        sql_pg = _translate_placeholders(sql)
        if using_postgres() and sql.strip().upper().startswith("CREATE"):
            sql_pg = _sqlite_ddl_to_pg(sql_pg)
        cur = self._conn._raw.cursor()
        cur.execute(sql_pg, params)
        self._description = cur.description
        try:
            self._rows = cur.fetchall()
        except Exception:
            self._rows = []
        # best-effort lastrowid for SERIAL inserts
        try:
            if cur.description is None and sql.strip().upper().startswith("INSERT"):
                id_cur = self._conn._raw.cursor()
                id_cur.execute("SELECT lastval()")
                row = id_cur.fetchone()
                self.lastrowid = row[0] if row else None
                id_cur.close()
        except Exception:
            self.lastrowid = None
        cur.close()
        return self

    def fetchone(self):
        if not self._rows:
            return None
        row = self._rows.pop(0)
        return self._conn._map_row(row, self._description)

    def fetchall(self):
        rows = [self._conn._map_row(r, self._description) for r in self._rows]
        self._rows = []
        return rows


class _PostgresCompat:
    """Minimal sqlite3.Connection-shaped wrapper over psycopg Connection."""

    def __init__(self, dsn: str):
        import psycopg
        from psycopg.rows import dict_row

        self._raw = psycopg.connect(dsn, row_factory=dict_row)
        self.row_factory = None

    def _map_row(self, row, description):
        if row is None:
            return None
        # dict_row already returns mappings; honour sqlite-style factories
        # when callers set row_factory for column rename / filtering.
        if isinstance(row, dict) and self.row_factory is None:
            return row
        if self.row_factory is None:
            return row

        class _FakeCursor:
            def __init__(self, desc):
                self.description = desc

        try:
            return self.row_factory(_FakeCursor(description), row)  # type: ignore[misc]
        except TypeError:
            return self.row_factory(self, row)  # type: ignore[misc]

    def execute(self, sql: str, params: tuple | list | None = None):
        return _PgCursor(self, sql, tuple(params or ()))

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            try:
                self.commit()
            except Exception:
                self.rollback()
        else:
            try:
                self.rollback()
            except Exception:
                pass
        self.close()
        return False


def get_connection():
    """Return a DB connection (SQLite by default, Postgres when DATABASE_URL set).

    Reads module-level ``DB_PATH`` / ``_DATABASE_URL`` at call time so tests
    can rebind them.
    """
    url = (os.environ.get("DATABASE_URL") or os.environ.get("SAU_DATABASE_URL") or _DATABASE_URL or "").strip()
    if url:
        return _PostgresCompat(url)
    return sqlite3.connect(DB_PATH)


def init_db() -> None:
    """Create all tables and indexes if they don't exist."""
    # Refresh URL each boot so env changes apply without import reload.
    global _DATABASE_URL
    _DATABASE_URL = (os.environ.get("DATABASE_URL") or os.environ.get("SAU_DATABASE_URL") or "").strip()

    def _ignore_dup(exc: BaseException) -> bool:
        msg = str(exc).lower()
        return (
            isinstance(exc, sqlite3.OperationalError)
            or "already exists" in msg
            or "duplicate column" in msg
        )

    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'pending',
                platform TEXT,
                action TEXT,
                account TEXT,
                created TEXT,
                code INTEGER,
                error TEXT,
                argv TEXT,
                result TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                ts TEXT NOT NULL,
                message TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS account_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS account_authorizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                platform TEXT NOT NULL,
                cookie_file TEXT NOT NULL,
                created TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (group_id) REFERENCES account_groups(id) ON DELETE CASCADE,
                UNIQUE(group_id, platform)
            )
        """)
        conn.commit()
        for col in ("argv", "result", "publish_detail"):
            try:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {col} TEXT")
            except Exception as exc:
                if not _ignore_dup(exc):
                    raise
        try:
            conn.execute("ALTER TABLE account_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except Exception as exc:
            if not _ignore_dup(exc):
                raise
        try:
            conn.execute("ALTER TABLE account_authorizations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except Exception as exc:
            if not _ignore_dup(exc):
                raise
        conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_message ON logs (message)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks (created)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                api_key TEXT NOT NULL UNIQUE,
                masked TEXT NOT NULL,
                created TEXT NOT NULL,
                rate_limited_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS error_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                task_id TEXT,
                level TEXT NOT NULL DEFAULT 'error',
                phase TEXT NOT NULL,
                platform TEXT,
                account TEXT,
                action TEXT,
                exc_type TEXT,
                exc_message TEXT,
                traceback TEXT,
                argv TEXT,
                attempt_no INTEGER,
                retry_count INTEGER,
                status_code INTEGER
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_error_events_ts ON error_events (ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_error_events_platform ON error_events (platform)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_error_events_account ON error_events (account)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_error_events_exc_type ON error_events (exc_type)")
        # Auth tables (minimal session login for the SPA AuthGuard).
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL DEFAULT 'user',
                name TEXT,
                avatar TEXT,
                password_hash TEXT,
                license_tier TEXT DEFAULT 'legacy',
                is_founder INTEGER NOT NULL DEFAULT 0,
                notify_health_email INTEGER NOT NULL DEFAULT 0,
                notify_health_webhook INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                last_login TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS verification_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_verification_codes_email "
            "ON verification_codes (email)"
        )
        for col, decl in (
            ("name", "TEXT"),
            ("avatar", "TEXT"),
            ("password_hash", "TEXT"),
            ("license_tier", "TEXT DEFAULT 'legacy'"),
            ("is_founder", "INTEGER NOT NULL DEFAULT 0"),
            ("notify_health_email", "INTEGER NOT NULL DEFAULT 0"),
            ("notify_health_webhook", "INTEGER NOT NULL DEFAULT 0"),
            ("last_login", "TEXT"),
        ):
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} {decl}")
            except Exception as exc:
                if not _ignore_dup(exc):
                    raise
        # Task schedule column for calendar / reschedule / copy.
        for col, decl in (
            ("scheduled_at", "TEXT"),
            ("title", "TEXT"),
        ):
            try:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {col} {decl}")
            except Exception as exc:
                if not _ignore_dup(exc):
                    raise
        # Content templates (publish templates store).
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'video',
                snapshot TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        # Studio (script studio) minimal tables — SQLite local shell.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS studio_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_user_id INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                synopsis TEXT NOT NULL DEFAULT '',
                style TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS studio_episodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                episode_no INTEGER NOT NULL,
                act TEXT,
                title TEXT,
                content TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE CASCADE,
                UNIQUE(project_id, episode_no)
            )
            """
        )
        # Crawl results (local cache; crawler worker optional).
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS crawled_content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT,
                post_id TEXT,
                title TEXT,
                author TEXT,
                url TEXT,
                payload TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS crawled_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT,
                post_id TEXT,
                comment_id TEXT,
                content TEXT,
                sentiment TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS crawl_tasks (
                task_id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                platform TEXT,
                payload TEXT,
                result TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
