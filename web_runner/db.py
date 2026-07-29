"""PostgreSQL-only database initialization and connection management.

Requires ``DATABASE_URL`` or ``SAU_DATABASE_URL`` (e.g. from ``.env``):

    DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/sau

Call sites may use ``?`` placeholders; this module rewrites them to ``%s``
for psycopg. ``conn.execute(...).fetchall()`` remains supported.

Connections are served from a process-local ``psycopg_pool.ConnectionPool``
when available (optional dep ``psycopg-pool``), falling back to per-call
``psycopg.connect``. The historical global ``db_lock`` is a no-op under
Postgres (each request uses its own connection + transactions).
"""
from __future__ import annotations

import os
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).parent.parent.resolve()

# Kept for call-site compatibility. Under PostgreSQL, concurrent requests
# use separate pooled connections; a process-wide mutex only serialised
# throughput. The lock is therefore a no-op (still a valid context manager).
class _NoOpLock:
    def acquire(self, blocking: bool = True, timeout: float = -1) -> bool:  # noqa: ARG002
        return True

    def release(self) -> None:
        return None

    def __enter__(self) -> _NoOpLock:
        return self

    def __exit__(self, *args: object) -> bool:
        return False


db_lock: Any = _NoOpLock()

_PLACEHOLDER_RE = re.compile(r"'[^']*'|\?")
_DATABASE_URL: str = ""

_pool: Any = None
_pool_lock = threading.Lock()
_pool_failed = False


def _load_dotenv() -> None:
    """Best-effort load of repo-root ``.env`` into ``os.environ`` (no override)."""
    env_path = BASE_DIR / ".env"
    if not env_path.is_file():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip("'").strip('"')
            if key and key not in os.environ:
                os.environ[key] = val
    except OSError:
        pass


def _refresh_url() -> str:
    global _DATABASE_URL
    _load_dotenv()
    url = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("SAU_DATABASE_URL")
        or ""
    ).strip()
    # normalize postgres:// → postgresql:// for psycopg
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    _DATABASE_URL = url
    return _DATABASE_URL


def require_database_url() -> str:
    url = _refresh_url()
    if not url:
        raise RuntimeError(
            "PostgreSQL is required. Set DATABASE_URL or SAU_DATABASE_URL "
            "(e.g. postgresql://user:pass@127.0.0.1:5432/sau). "
            "SQLite is no longer supported."
        )
    return url


def backend_name() -> str:
    return "postgres"


def using_postgres() -> bool:
    return True


def _translate_placeholders(sql: str) -> str:
    # psycopg v3 only allows %s, %b, %t as placeholders. Escape literal %
    # to %% BEFORE ?→%s conversion so LIKE 'upload%' doesn't trigger
    # "only '%s', '%b', '%t' are allowed as placeholders, got '%'" errors.
    sql = sql.replace("%", "%%")
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


def _pool_max_size() -> int:
    raw = os.environ.get("SAU_DB_POOL_SIZE", "16").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 16
    return max(2, min(n, 64))


def _ensure_pool() -> Any | None:
    """Lazily open a ConnectionPool. Returns None if pool is unavailable."""
    global _pool, _pool_failed
    if _pool is not None:
        return _pool
    if _pool_failed:
        return None
    with _pool_lock:
        if _pool is not None:
            return _pool
        if _pool_failed:
            return None
        try:
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool
        except ImportError:
            _pool_failed = True
            return None
        dsn = require_database_url()
        max_size = _pool_max_size()
        min_size = min(2, max_size)
        try:
            _pool = ConnectionPool(
                conninfo=dsn,
                min_size=min_size,
                max_size=max_size,
                kwargs={"row_factory": dict_row},
                open=True,
            )
        except Exception:
            _pool_failed = True
            _pool = None
            return None
        return _pool


def close_pool() -> None:
    """Close the process pool (tests / shutdown). Safe to call repeatedly."""
    global _pool, _pool_failed
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.close()
            except Exception:
                pass
            _pool = None
        _pool_failed = False


class _PgCursor:
    def __init__(self, conn: "_PostgresCompat", sql: str | None = None, params: tuple = ()):
        self._conn = conn
        self._rows: list[Any] = []
        self._description = None
        self.lastrowid = None
        self.rowcount = -1
        if sql is not None:
            self.execute(sql, params)

    def execute(self, sql: str, params: tuple | list | None = None):
        params = tuple(params or ())
        sql_pg = _translate_placeholders(sql)
        stripped = sql.strip().upper()
        if stripped.startswith("CREATE") or stripped.startswith("ALTER"):
            sql_pg = _sqlite_ddl_to_pg(sql_pg)
        cur = self._conn._raw.cursor()
        try:
            cur.execute(sql_pg, params)
            self._description = cur.description
            self.rowcount = getattr(cur, "rowcount", -1)
            # Only materialise rows for statements that return a result set.
            if cur.description is not None:
                try:
                    self._rows = list(cur.fetchall() or [])
                except Exception:
                    self._rows = []
            else:
                self._rows = []
            # Do NOT call lastval() here: inserts with explicit UUID PKs have
            # no sequence, and a failed lastval() aborts the whole PG transaction.
            self.lastrowid = None
            if stripped.startswith("INSERT") and "RETURNING" in stripped:
                # RETURNING rows already in self._rows
                if self._rows:
                    first = self._rows[0]
                    if isinstance(first, dict):
                        self.lastrowid = first.get("id") or next(iter(first.values()), None)
                    elif first:
                        self.lastrowid = first[0]
        except Exception:
            # PG aborts the whole txn on error; clear so later statements can run.
            try:
                self._conn._raw.rollback()
            except Exception:
                pass
            raise
        finally:
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
    """sqlite3.Connection-shaped wrapper over a psycopg connection."""

    def __init__(self, dsn: str | None = None, *, raw: Any = None, pool: Any = None):
        self._pool = pool
        self.row_factory = None
        if raw is not None:
            self._raw = raw
            return
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError(
                "psycopg is required for PostgreSQL. Install with: "
                "uv pip install -e '.[web-pg]'  or  pip install 'psycopg[binary]'"
            ) from exc

        if not dsn:
            raise RuntimeError("dsn is required when raw connection is not provided")
        self._raw = psycopg.connect(dsn, row_factory=dict_row)

    def _map_row(self, row, description):
        if row is None:
            return None
        # dict_row already returns mappings — enough for almost all call sites.
        if isinstance(row, dict):
            # PostgreSQL UUID / timestamp columns deserialise as
            # uuid.UUID / datetime objects, which break json.dumps and
            # Flask jsonify. Convert common non-serialisable types to str.
            # Use .isoformat() for datetimes so format matches the rest of
            # the codebase (T separator vs space from str()).
            def _json_safe(val: object) -> object:
                if isinstance(val, uuid.UUID):
                    return str(val)
                if isinstance(val, datetime):
                    return val.isoformat()
                return val

            return {k: _json_safe(v) for k, v in row.items()}
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
        if self._pool is not None:
            try:
                self._pool.putconn(self._raw)
            except Exception:
                try:
                    self._raw.close()
                except Exception:
                    pass
            return
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


def get_connection() -> _PostgresCompat:
    """Return a pooled PostgreSQL connection (falls back to a fresh connect)."""
    dsn = require_database_url()
    pool = _ensure_pool()
    if pool is not None:
        try:
            raw = pool.getconn()
            return _PostgresCompat(raw=raw, pool=pool)
        except Exception:
            # Pool exhausted / closed mid-flight — fall through to direct connect.
            pass
    return _PostgresCompat(dsn=dsn)


def init_db() -> None:
    """Create all tables and indexes if they don't exist (PostgreSQL)."""
    require_database_url()
    # Warm the pool early so the first request doesn't pay connect latency.
    _ensure_pool()

    def _ignore_dup(exc: BaseException) -> bool:
        msg = str(exc).lower()
        return (
            "already exists" in msg
            or "duplicate column" in msg
            or "duplicate_column" in msg
        )

    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                task_id UUID PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'pending',
                platform TEXT,
                action TEXT,
                account TEXT,
                created TEXT,
                code INTEGER,
                error TEXT,
                argv TEXT,
                result TEXT,
                priority INTEGER
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
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS account_authorizations (
                id SERIAL PRIMARY KEY,
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

        def _try_alter(sql: str) -> None:
            try:
                conn.execute(sql)
                conn.commit()
            except Exception as exc:
                try:
                    conn.rollback()
                except Exception:
                    pass
                if not _ignore_dup(exc):
                    raise

        for col in ("argv", "result", "publish_detail"):
            _try_alter(f"ALTER TABLE tasks ADD COLUMN {col} TEXT")
        _try_alter(
            "ALTER TABLE account_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
        )
        _try_alter(
            "ALTER TABLE account_authorizations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
        )
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
                id SERIAL PRIMARY KEY,
                api_key TEXT NOT NULL UNIQUE,
                masked TEXT NOT NULL,
                created TEXT NOT NULL,
                rate_limited_at TEXT
            )
        """)
        # Older installs created ai_api_keys without rate_limited_at.
        _try_alter("ALTER TABLE ai_api_keys ADD COLUMN rate_limited_at TEXT")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS error_events (
                id SERIAL PRIMARY KEY,
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
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_error_events_platform ON error_events (platform)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_error_events_account ON error_events (account)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_error_events_exc_type ON error_events (exc_type)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
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
                id SERIAL PRIMARY KEY,
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
            _try_alter(f"ALTER TABLE users ADD COLUMN {col} {decl}")
        for col, decl in (
            ("scheduled_at", "timestamp"),
            ("title", "TEXT"),
            ("priority", "INTEGER"),
        ):
            _try_alter(f"ALTER TABLE tasks ADD COLUMN {col} {decl}")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_templates (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'video',
                snapshot TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS studio_projects (
                id SERIAL PRIMARY KEY,
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
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                episode_no INTEGER NOT NULL,
                act TEXT,
                title TEXT,
                scenes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                dialogues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE CASCADE,
                UNIQUE(project_id, episode_no)
            )
            """
        )
        # Live DBs may predate scenes_json / may still have legacy ``content``.
        # Additive ALTERs keep both fresh CREATE and older rows workable.
        for ddl in (
            "ALTER TABLE studio_episodes ADD COLUMN IF NOT EXISTS scenes_json JSONB NOT NULL DEFAULT '[]'::jsonb",
            "ALTER TABLE studio_episodes ADD COLUMN IF NOT EXISTS dialogues_json JSONB NOT NULL DEFAULT '[]'::jsonb",
            "ALTER TABLE studio_episodes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'",
            "ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS render_config JSONB",
            """
            CREATE TABLE IF NOT EXISTS studio_assets (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'prop',
                code TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                prompt TEXT NOT NULL DEFAULT '',
                ref_image_url TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE CASCADE
            )
            """,
        ):
            try:
                conn.execute(ddl)
            except Exception:
                pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS crawled_content (
                id SERIAL PRIMARY KEY,
                platform TEXT,
                post_id TEXT,
                raw_payload JSONB,
                crawled_at TEXT,
                title TEXT,
                author TEXT,
                url TEXT,
                payload TEXT,
                created_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS crawled_comments (
                id SERIAL PRIMARY KEY,
                platform TEXT,
                post_id TEXT,
                raw_payload JSONB,
                ai_sentiment TEXT,
                ai_sentiment_confidence REAL,
                ai_reply_suggestion TEXT,
                crawled_at TEXT,
                comment_id TEXT,
                content TEXT,
                sentiment TEXT,
                created_at TEXT
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
        # Bring older mediacrawler / scaffold schemas forward without wipe.
        for ddl in (
            "ALTER TABLE crawled_content ADD COLUMN IF NOT EXISTS raw_payload JSONB",
            "ALTER TABLE crawled_content ADD COLUMN IF NOT EXISTS crawled_at TEXT",
            "ALTER TABLE crawled_content ADD COLUMN IF NOT EXISTS title TEXT",
            "ALTER TABLE crawled_content ADD COLUMN IF NOT EXISTS author TEXT",
            "ALTER TABLE crawled_content ADD COLUMN IF NOT EXISTS url TEXT",
            "ALTER TABLE crawled_content ADD COLUMN IF NOT EXISTS payload TEXT",
            "ALTER TABLE crawled_content ADD COLUMN IF NOT EXISTS created_at TEXT",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS raw_payload JSONB",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS ai_sentiment TEXT",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS ai_sentiment_confidence REAL",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS ai_reply_suggestion TEXT",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS crawled_at TEXT",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS comment_id TEXT",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS content TEXT",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS sentiment TEXT",
            "ALTER TABLE crawled_comments ADD COLUMN IF NOT EXISTS created_at TEXT",
        ):
            try:
                conn.execute(ddl)
            except Exception:
                pass
        conn.commit()


# Load .env as soon as this module is imported so create_app()/tests see DATABASE_URL.
_refresh_url()
