"""Database initialization and connection management."""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
DB_DIR = BASE_DIR / "db"
DB_DIR.mkdir(exist_ok=True)
DB_PATH = DB_DIR / "database.db"

db_lock = threading.Lock()


def get_connection() -> sqlite3.Connection:
    """Return a new SQLite connection to the project database.

    Reads module-level ``DB_PATH`` at call time so tests can rebind
    ``web_runner.db.DB_PATH`` to a temporary file.
    """
    return sqlite3.connect(DB_PATH)


def init_db() -> None:
    """Create all tables and indexes if they don't exist."""
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
            except sqlite3.OperationalError:
                pass
        try:
            conn.execute("ALTER TABLE account_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE account_authorizations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
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
            except sqlite3.OperationalError:
                pass
        # Task schedule column for calendar / reschedule / copy.
        for col, decl in (
            ("scheduled_at", "TEXT"),
            ("title", "TEXT"),
        ):
            try:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError:
                pass
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
