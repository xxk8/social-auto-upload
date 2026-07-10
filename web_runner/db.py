"""Database module: PostgreSQL-only `Database` abstraction (post-SQLite-removal).

Single, dialect-locked backend (``PostgresDatabase``); the legacy
SQLite branch (``PostgresDatabase``) and its supporting classes were
removed in the SQLite→PG cutover. Both ``PostgresDatabase`` and its
``PostgresTransactionHandle`` implement the same interface:

    execute(sql, params)              -> int
    execute_many(sql, seq)            -> None
    fetch_one(sql, params)            -> dict | None
    fetch_all(sql, params)            -> list[dict]
    last_insert_id()                  -> int
    insert_returning_id(sql, params)  -> int
    json_dump(value)                  -> Any
    json_load(value)                  -> Any
    transaction()                     -> ContextManager[Database]

Transaction handles (``PostgresTransactionHandle``) bind a single
``psycopg.Connection`` for the lifetime of a ``with db.transaction() as
tx:`` block so multi-statement work shares one connection and
commits-or-rolls-back as one unit. The handle does NOT auto-commit;
the wrapping ctx-mgr is responsible for the lifecycle.

Dialect helper:
  * ``_translate_placeholders(sql)`` converts ``?`` outside string literals
    to ``%s`` for psycopg's positional-param syntax. SQL call sites in
    ``web_runner/utils.py`` and ``web_runner/routes/*`` keep using
    ``?`` for dialect-lock-in / readability; this is the single
    boundary where the translation happens.

Call sites in ``web_runner/utils.py`` + ``web_runner/routes/*`` use
``db = get_database()`` and ``db.execute(...)`` directly. Tests use
``monkeypatch.setenv`` + ``reset_default_database()`` to swap
``DATABASE_URL`` mid-session.

Public-API exclusions:
  * ``conninfo`` requires a non-empty ``DATABASE_URL`` set in the env
    (failure surfaces a clear RuntimeError at factory-call time).
  * psycopg + psycopg-pool must be installed; absent either, the
    PostgresDatabase.__init__ raises with install-instruction text.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol, runtime_checkable

# Module-level logger used by helper functions in this file (e.g.
# ``parse_date_param``). The application entrypoint (``web_runner/__init__.py``
# or the WSGI runner) is responsible for attaching handlers — by default
# the root logger propagates these warnings to wherever the operator
# configured the host (journalctl / Cloud Logging / stdout).
_db_logger = logging.getLogger(__name__)


# Back-compat path constants (`DB_DIR` / `BASE_DIR`) were removed in
# the SQLite→PG cutover + secret-key migration: the ``db/`` directory
# is now empty (SQLite files + ``createTable.py`` deleted) and the
# Flask session key moved to ``.sau_secret_key`` at the repo root.
# The web_runner/__init__.py module-local ``Path(__file__).parent.parent``
# derives the root path directly without depending on a module-level
# constant exported here.


# Single-quoted SQL strings + '?' outside string literals — psycopg uses
# %s for positional params, so we rewrite SQLite-style '?' (used by every
# call site in the codebase) to '%s' before handing the SQL to psycopg.
# Does NOT handle:
#   * 'in-string doubled single-quote' escape (current code never uses it).
#   * double-quoted "..." strings (SQL standard reserves these for
#     identifiers; current code uses single quotes for string literals).
# The regex pattern is sufficient for the live codebase.
_PLACEHOLDER_PATTERN = re.compile(r"'[^']*'|\?")


def _translate_placeholders(sql: str) -> str:
    """Rewrite '?' outside string literals to '%s' (PG positional param)."""
    return _PLACEHOLDER_PATTERN.sub(
        lambda m: "%s" if m.group(0) == "?" else m.group(0),
        sql,
    )


# ── SAVEPOINT-backed nested transactions ─────────────────────────────────
#
# ``tx.savepoint(name)`` and the back-compat ``tx.transaction()`` shortcut
# both want a SQL identifier as the savepoint name. SQL identifiers
# can't be bound as parameters, so the only safe path is
# validate-then-interpolate. Rules tuned to PG identifier naming:
#   * matched by ``^[a-zA-Z_][a-zA-Z0-9_]*$`` (no digits at the start
#     — avoids SQL syntactic ambiguity where ``"1sp"`` could be parsed
#     as a numeric literal in some contexts).
#   * length cap of 63 chars (PG identifier NAMEDATALEN-1 hard limit).
#   * reserved-word deny-list catches SQL keywords that would lead to
#     parse errors at the BACKEND.
#
# Validation runs BEFORE the SAVEPOINT SQL touches the connection, so
# a rejected name leaves the savepoint stack clean (no leaked
# ``SAVEPOINT`` entry half-opened).
_SAVEPOINT_NAME_RE: re.Pattern[str] = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_SAVEPOINT_NAME_MAX_LEN: int = 63  # PG identifier NAMEDATALEN-1.
_RESERVED_SAVEPOINT_NAMES: frozenset = frozenset({
    # SQL keywords that would parse-error at the BACKEND when used as
    # a savepoint identifier. Identifier regex blocks numeric-literal
    # lookalikes and SQL injection vectors already; this deny-list
    # adds the keyword callers are most likely to reach for without
    # quoting.
    "savepoint", "transaction", "release", "rollback", "begin", "commit", "end",
    "select", "insert", "update", "delete", "drop", "create", "alter",
    "table", "into", "values", "from", "where",
    "primary", "foreign", "key", "unique", "check",
})


def _validate_savepoint_name(name: str) -> None:
    """Reject invalid savepoint identifiers (SQL injection guard).

    Raises ``ValueError`` if the name fails any of:
      * not a ``str``,
      * empty,
      * longer than :data:`_SAVEPOINT_NAME_MAX_LEN`,
      * doesn't match :data:`_SAVEPOINT_NAME_RE`,
      * matches a reserved keyword (case-insensitive).

    PG accepts matching identifiers verbatim in ``SAVEPOINT`` /
    ``RELEASE SAVEPOINT`` / ``ROLLBACK TO SAVEPOINT`` statements
    without any quoting, so once validation passes we can interpolate
    the identifier directly.
    """
    if not isinstance(name, str):
        raise ValueError(
            f"Savepoint name must be str, got {type(name).__name__}"
        )
    if not name:
        raise ValueError("Savepoint name must be non-empty")
    if len(name) > _SAVEPOINT_NAME_MAX_LEN:
        raise ValueError(
            f"Savepoint name too long ({len(name)} chars; "
            f"max is {_SAVEPOINT_NAME_MAX_LEN})"
        )
    if not _SAVEPOINT_NAME_RE.match(name):
        raise ValueError(
            f"Savepoint name {name!r} must match SQL identifier pattern "
            f"^[a-zA-Z_][a-zA-Z0-9_]*$ (SQL injection guard)"
        )
    if name.lower() in _RESERVED_SAVEPOINT_NAMES:
        raise ValueError(
            f"Savepoint name {name!r} is a reserved SQL keyword "
            f"(case-insensitive)"
        )


# ── psycopg ConnectionPool tuning ────────────────────────────────────────
#
# Names of psycopg.connect() kwargs that PostgresDatabase enforces
# regardless of what the operator puts in SAU_DB_POOL_KWARGS. We gate
# them explicitly (raise rather than silently overwrite) because
# failing silent on infra config is a debugging nightmare:
#   * row_factory — must stay ``dict_row`` so ``fetch_one`` /
#     ``fetch_all`` return dict-by-name; tuple-row would break every
#     ``row["..."]`` index in routes/* callers (the abstraction's
#     whole "dialect-agnostic dict result contract").
#   * autocommit — must stay ``True`` so the wrapping
#     ``conn.transaction()`` ctx-mgr can correctly flip it off for
#     the duration of a tx block and restore it on return.
_GATED_POOL_KWARG_NAMES: frozenset = frozenset({"row_factory", "autocommit"})


def _pool_kwargs_from_env() -> tuple[int, int, float, dict]:
    """Read ``SAU_DB_POOL_MIN/MAX/TIMEOUT/KWARGS`` with validation.

    Returns ``(min_size, max_size, timeout, extra_kwargs)``. All four
    values are validated; invalid input raises ``RuntimeError`` with
    the offending env-var name + raw value so operators can spot a
    misconfig without a half-broken pool at first request.

    Defaults — sane for a small social-media CLI with bursty upload
    traffic (quiet most of the day, burst during publish windows):
      * ``min_size=2``   — keep 2 warm conns, avoid TCP+TLS handshake
        on the first request after idle.
      * ``max_size=15``  — cap concurrent borrows so traffic spikes
        don't blow Postgres' ``max_connections`` budget.
      * ``timeout=30.0`` — seconds to wait for a free conn before
        ``psycopg_pool.PoolTimeout`` raises; matches psycopg_pool's
        own default (made explicit here so operators don't have to
        dig into psycopg docs).
      * ``extra_kwargs={}`` — no overrides; operators add
        ``application_name`` / ``connect_timeout`` etc. via
        ``SAU_DB_POOL_KWARGS`` if they want.

    Validation rules — fail loud (infra config; silent
    under-provisioning is debug-nightmare material):
      * ``MIN``/``MAX``/``TIMEOUT`` int/float parse cleanly; reject
        negatives and zero.
      * ``MAX >= MIN`` (a ``max<min`` pool is structurally broken).
      * ``SAU_DB_POOL_KWARGS`` parses to a JSON ``dict`` (not
        ``null``/list/int/str).
      * Empty string ("SAU_DB_POOL_MIN=") → use the default; never
        raise ``ValueError("invalid literal for int() with base 10: '')``.

    Forbidden-key checks (``row_factory`` / ``autocommit`` in
    ``SAU_DB_POOL_KWARGS``) live in
    :meth:`PostgresDatabase.__init__` next to the merge logic, not
    here, so the rule stays close to the enforcement.

    Read on each factory call (after ``reset_default_database()``
    clears the cache) so test runs using ``monkeypatch.setenv`` /
    ``delenv`` see a fresh env without module-import caching.
    """
    def _env_int(name: str, default: int) -> int:
        raw = os.environ.get(name, "").strip()
        if not raw:
            return default
        try:
            v = int(raw)
        except ValueError as exc:
            raise RuntimeError(
                f"Env var {name}={raw!r} is not a valid integer "
                f"(ValueError: {exc})."
            ) from exc
        if v <= 0:
            raise RuntimeError(
                f"Env var {name}={v} must be > 0 (got non-positive value)."
            )
        return v

    def _env_float(name: str, default: float) -> float:
        raw = os.environ.get(name, "").strip()
        if not raw:
            return default
        try:
            v = float(raw)
        except ValueError as exc:
            raise RuntimeError(
                f"Env var {name}={raw!r} is not a valid float "
                f"(ValueError: {exc})."
            ) from exc
        if v <= 0:
            raise RuntimeError(
                f"Env var {name}={v} must be > 0 (got non-positive value)."
            )
        return v

    min_size = _env_int("SAU_DB_POOL_MIN", 2)
    max_size = _env_int("SAU_DB_POOL_MAX", 15)
    timeout = _env_float("SAU_DB_POOL_TIMEOUT", 30.0)
    if max_size < min_size:
        raise RuntimeError(
            f"SAU_DB_POOL_MAX ({max_size}) must be >= SAU_DB_POOL_MIN "
            f"({min_size}); refusing to construct an under-provisioned "
            f"pool."
        )

    extra_kwargs: dict = {}
    raw_kwargs = os.environ.get("SAU_DB_POOL_KWARGS", "").strip()
    if not raw_kwargs:
        return min_size, max_size, timeout, extra_kwargs

    try:
        parsed = json.loads(raw_kwargs)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError(
            f"SAU_DB_POOL_KWARGS={raw_kwargs!r} is not valid JSON: "
            f"{exc}. Use a JSON dict, e.g. "
            f"'{{\"application_name\":\"sau\"}}'."
        ) from exc
    if not isinstance(parsed, dict):
        raise RuntimeError(
            f"SAU_DB_POOL_KWARGS={raw_kwargs!r} must parse to a JSON "
            f"dict, got {type(parsed).__name__}."
        )
    # Forbidden-key gating lives in PostgresDatabase.__init__ next
    # to the merge site; we just pass the parsed dict through.
    extra_kwargs = parsed
    return min_size, max_size, timeout, extra_kwargs


@runtime_checkable
class Database(Protocol):
    """PostgreSQL-only Database abstraction.

    All public methods map directly to psycopg's connection surface;
    call sites can use ``db.execute(...)`` without branching on the
    underlying driver because there's only one driver now.
    """

    def execute(self, sql: str, params: tuple = ()) -> int: ...
    def execute_many(self, sql: str, seq_of_params: list) -> None: ...
    def fetch_one(self, sql: str, params: tuple = ()) -> dict | None: ...
    def fetch_all(self, sql: str, params: tuple = ()) -> list: ...
    def last_insert_id(self) -> int: ...
    def json_dump(self, value: Any) -> Any: ...
    def json_load(self, value: Any) -> Any: ...
    def transaction(self) -> AbstractContextManager[Database]: ...


class PostgresTransactionHandle:
    """Binds a single ``psycopg.Connection`` for the lifetime of a
    ``with db.transaction() as tx`` block.

    Mirrors the :class:`Database` Protocol but delegates every method
    to **one** bound connection. Reads see the in-flight transaction
    before COMMIT (Postgres READ COMMITTED default).

    Like the prior PostgresDatabase, this handle does NOT
    auto-commit; the wrapping context manager handles COMMIT/ROLLBACK
    via psycopg's native ``conn.transaction()`` context manager
    (auto-flips autocommit off and restores it after).
    """

    def __init__(self, conn: Any, parent: PostgresDatabase) -> None:
        self._conn = conn
        self._parent = parent
        # Per-handle savepoint counter (PR4 back-compat for nested
        # ``tx.transaction()`` calls). Independent handles have their
        # own counter so two outer-tx life-cycles don't collide.
        self._savepoint_seq: int = 0

    def execute(self, sql: str, params: tuple = ()) -> int:
        sql_pg = _translate_placeholders(sql)
        cur = self._conn.execute(sql_pg, params)
        return cur.rowcount

    def execute_many(self, sql: str, seq_of_params: list) -> None:
        sql_pg = _translate_placeholders(sql)
        self._conn.executemany(sql_pg, seq_of_params)

    def fetch_one(self, sql: str, params: tuple = ()) -> dict | None:
        sql_pg = _translate_placeholders(sql)
        row = self._conn.execute(sql_pg, params).fetchone()
        return row

    def fetch_all(self, sql: str, params: tuple = ()) -> list:
        sql_pg = _translate_placeholders(sql)
        rows = self._conn.execute(sql_pg, params).fetchall()
        return list(rows)

    def last_insert_id(self) -> int:
        return 0  # Postgres has no equivalent; use insert_returning_id.

    def insert_returning_id(self, sql: str, params: tuple) -> int:
        sql_pg = _translate_placeholders(sql)
        sql_with_returning = sql_pg.rstrip().rstrip(";").strip() + " RETURNING id"
        row = self._conn.execute(sql_with_returning, params).fetchone()
        if not row or "id" not in row.keys():
            raise RuntimeError(f"INSERT did not return id: {sql!r}")
        return int(row["id"])

    def json_dump(self, value: Any) -> Any:
        return self._parent.json_dump(value)

    def json_load(self, value: Any) -> Any:
        return self._parent.json_load(value)

    def _next_savepoint_name(self) -> str:
        """Auto-name ``sp_<N>`` from a per-handle monotonic counter.

        Used by :meth:`transaction` (back-compat shortcut) so successive
        nested ``tx.transaction()`` calls in the same outer tx don't
        collide on savepoint stack entries.
        """
        self._savepoint_seq += 1
        return f"sp_{self._savepoint_seq}"

    @contextmanager
    def savepoint(self, name: str) -> Iterator[Database]:
        """Open a SAVEPOINT-backed nested transaction on Postgres.

        Behaviour:
          * ``SAVEPOINT <name>``            (entry)
          * ``ROLLBACK TO SAVEPOINT <name>`` (inner-rollback cleanup)
          * ``RELEASE SAVEPOINT <name>``    (clean exit OR post-rollback cleanup)

        ``name`` is validated as a SQL identifier via
        :func:`_validate_savepoint_name` BEFORE any SQL touches the
        connection — a rejected name leaves the savepoint stack clean.

        On raised exception inside the block: ``ROLLBACK TO SAVEPOINT
        <name>`` (revert inner writes) + ``RELEASE SAVEPOINT <name>``
        (pop the savepoint from the stack), then re-raise the original
        exception. Both cleanup steps are best-effort — a SQL failure
        during cleanup is swallowed so the original exception is never
        obscured.

        The PG verbose ``SAVEPOINT`` keyword form in ``RELEASE`` /
        ``ROLLBACK TO`` is required to disambiguate savepoint-release
        from advisory-lock-release.
        """
        _validate_savepoint_name(name)
        self._conn.execute(f"SAVEPOINT {name}")
        try:
            yield self
        except Exception:
            try:
                self._conn.execute(f"ROLLBACK TO SAVEPOINT {name}")
            except Exception:
                # PG cleanup may itself raise (e.g. savepoint didn't
                # exist). Best-effort — original exception still
                # propagates below via the re-raise.
                pass
            try:
                self._conn.execute(f"RELEASE SAVEPOINT {name}")
            except Exception:
                pass
            raise
        else:
            self._conn.execute(f"RELEASE SAVEPOINT {name}")

    def transaction(self) -> AbstractContextManager[Database]:
        """Backward-compat shortcut: open a PG savepoint with auto-name.

        Identical to ``self.savepoint(self._next_savepoint_name())`` —
        callers used to the prior ``tx.transaction()`` API keep
        working unchanged.
        """
        return self.savepoint(self._next_savepoint_name())


class PostgresDatabase:
    """PostgreSQL backend with ConnectionPool.

    Lazy-imports psycopg + psycopg_pool (raises RuntimeError if missing).
    Caller must set DATABASE_URL.

    psycopg's ``dict_row`` row_factory already decodes JSONB columns to
    dict on SELECT, so the Json helpers are identity here. The
    Application still has the symmetric ``json_dump``/``json_load``
    API so call sites don't branch on dialect — historical openspec
    PR3 contract preservation.
    """

    def __init__(
        self,
        conninfo: str,
        min_size: int = 2,
        max_size: int = 15,
        timeout: float = 30.0,
        extra_kwargs: dict | None = None,
    ) -> None:
        """PostgresDatabase with env-tunable ConnectionPool sizing.

        Operators tune via ``SAU_DB_POOL_MIN`` / ``SAU_DB_POOL_MAX`` /
        ``SAU_DB_POOL_TIMEOUT`` / ``SAU_DB_POOL_KWARGS`` env vars; see
        :func:`_pool_kwargs_from_env` for parsing + validation.

        ``row_factory`` + ``autocommit`` are negotiation-gated (see
        ``_GATED_POOL_KWARG_NAMES``) — passing either in
        ``extra_kwargs`` raises ``RuntimeError`` rather than
        silently clobbering the abstraction contract.
        """
        # Validate gated kwargs BEFORE importing psycopg so the
        # operator-facing error message is uniform whether or not
        # psycopg is installed in the host environment.
        user_kwargs = dict(extra_kwargs or {})
        forbidden = set(user_kwargs) & _GATED_POOL_KWARG_NAMES
        if forbidden:
            raise RuntimeError(
                f"PostgresDatabase extra_kwargs cannot override "
                f"abstraction-gated pool keys {sorted(forbidden)}; "
                f"these are managed by web_runner/db.py. Drop them "
                f"from SAU_DB_POOL_KWARGS."
            )
        try:
            import psycopg  # noqa: F401 — keep import side effect for connection registration
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool
        except ImportError as exc:
            raise RuntimeError(
                "PostgresDatabase requires psycopg[binary]>=3.2 and "
                "psycopg-pool>=3.2. Install via "
                "`uv pip install -e \\\".[web-pg]\\\"`."
            ) from exc
        merged_kwargs = {
            **user_kwargs,
            "autocommit": True,
            "row_factory": dict_row,
        }
        self._pool = ConnectionPool(
            conninfo=conninfo,
            min_size=min_size,
            max_size=max_size,
            timeout=timeout,
            kwargs=merged_kwargs,
        )
        self._lastid: int = 0

    @contextmanager
    def _conn(self) -> Iterator:
        """Wrap ``ConnectionPool.connection()``.

        All public methods route through this context manager so
        a single fail point catches + re-raises psycopg's native
        ``IntegrityError`` / ``UniqueViolation`` / etc. directly to
        the caller. After SQLite removal the caller now uses
        ``except psycopg.errors.IntegrityError`` (the parent of
        UniqueViolation/ForeignKeyViolation/NotNullViolation).
        """
        try:
            with self._pool.connection() as conn:
                yield conn
        except Exception:
            # Re-raise unchanged — psycopg's exception hierarchy is
            # the public contract now (PR3 translation layer
            # removed alongside PostgresDatabase).
            raise

    def execute(self, sql: str, params: tuple = ()) -> int:
        sql_pg = _translate_placeholders(sql)
        with self._conn() as conn:
            cur = conn.execute(sql_pg, params)
            self._lastid = getattr(cur, "lastid", 0) or 0
            return cur.rowcount

    def execute_many(self, sql: str, seq_of_params: list) -> None:
        sql_pg = _translate_placeholders(sql)
        with self._conn() as conn:
            conn.executemany(sql_pg, seq_of_params)

    def fetch_one(self, sql: str, params: tuple = ()) -> dict | None:
        sql_pg = _translate_placeholders(sql)
        with self._conn() as conn:
            row = conn.execute(sql_pg, params).fetchone()
            return row

    def fetch_all(self, sql: str, params: tuple = ()) -> list:
        sql_pg = _translate_placeholders(sql)
        with self._conn() as conn:
            rows = conn.execute(sql_pg, params).fetchall()
            return list(rows)

    def last_insert_id(self) -> int:
        """DEPRECATED: racy across concurrent workers — use
        ``insert_returning_id`` for any caller that needs an id
        immediately after INSERT.
        """
        return self._lastid

    def insert_returning_id(self, sql: str, params: tuple) -> int:
        """INSERT with ``RETURNING id`` (always supported in PG).

        Thread-safe vs. ``last_insert_id``: this helper reads the id
        directly from the INSERT result, never via cached instance
        state. Use it anywhere cross-thread INSERT-write+read
        sequences could interleave.

        The SQL must NOT include a trailing ``;`` or any existing
        ``RETURNING`` clause; we append ``RETURNING id`` after
        stripping whitespace and a single trailing semicolon.
        """
        sql_pg = _translate_placeholders(sql)
        sql_with_returning = (
            sql_pg.rstrip().rstrip(";").strip() + " RETURNING id"
        )
        with self._conn() as conn:
            row = conn.execute(sql_with_returning, params).fetchone()
            self._lastid = int(row["id"]) if row and "id" in row.keys() else 0
            return self._lastid

    def json_dump(self, value: Any) -> Any:
        # psycopg auto-encodes Python dicts to JSONB when the column
        # type is JSONB. We hand the value through unchanged so callers
        # see consistent semantics across the abstraction.
        return value

    def json_load(self, value: Any) -> Any:
        # psycopg row_factory=dict_row already decodes JSONB columns to
        # dict on SELECT — helper is identity.
        return value

    @contextmanager
    def transaction(self) -> Iterator[Database]:
        """Wrap multi-statement work in a Postgres transaction.

        Uses psycopg's native ``conn.transaction()`` context manager
        (psycopg >= 3.1) to issue ``BEGIN`` / ``COMMIT`` / ``ROLLBACK``
        while correctly flipping ``autocommit=True`` off for the
        duration of the block and restoring it before returning the
        connection to the pool. Crucially, concurrent borrowers of
        the pool don't observe a transient autocommit-false state.

        Yields a :class:`PostgresTransactionHandle` bound to a single
        ``psycopg.Connection`` for the duration.
        """
        with self._conn() as raw_conn:
            with raw_conn.transaction():
                yield PostgresTransactionHandle(raw_conn, self)


_default_database: Database | None = None
_default_lock = threading.Lock()


def get_database() -> Database:
    """PostgreSQL-only factory. Caches one Database instance per process.

    Pool sizing env vars (``SAU_DB_POOL_MIN`` / ``SAU_DB_POOL_MAX`` /
    ``SAU_DB_POOL_TIMEOUT`` / ``SAU_DB_POOL_KWARGS``) are read at this
    same first-call moment via :func:`_pool_kwargs_from_env`.
    Supported operator tuning loop: change-env-then-restart. Mid-process
    env changes do NOT re-trigger this resolution — the factory caches
    the singleton unconditionally. Call :func:`reset_default_database`
    to force a re-read (used by tests that swap env via
    ``monkeypatch.setenv``).

    Selection matrix (post-SQLite-removal):
      * DATABASE_URL set + psycopg installed ->
        ``PostgresDatabase`` via ``DATABASE_URL``.
      * DATABASE_URL unset -> RuntimeError (required env var missing).
      * DATABASE_URL set + psycopg missing -> RuntimeError.
    """
    global _default_database
    if _default_database is not None:
        return _default_database
    with _default_lock:
        if _default_database is not None:
            return _default_database
        conninfo = os.environ.get("DATABASE_URL", "")
        if not conninfo:
            raise RuntimeError(
                "DATABASE_URL env not set. "
                "Provide a Postgres connection string "
                "(e.g. postgres://user:pass@host:5432/sau)."
            )
        # Read pool sizing + extra psycopg.connect() kwargs from env
        # so operators can tune without redeploy. Validation lives in
        # _pool_kwargs_from_env; the abstraction contract is enforced
        # via _GATED_POOL_KWARG_NAMES next to the merge site in
        # PostgresDatabase.__init__.
        min_size, max_size, timeout, extra_kwargs = _pool_kwargs_from_env()
        _default_database = PostgresDatabase(
            conninfo,
            min_size=min_size,
            max_size=max_size,
            timeout=timeout,
            extra_kwargs=extra_kwargs,
        )
        return _default_database


def reset_default_database() -> None:
    """Test hook: clear the cached Database instance so the next
    ``get_database()`` call re-resolves the factory.

    Used by tests that swap ``DATABASE_URL`` mid-session via
    ``monkeypatch.setenv``.
    """
    global _default_database
    with _default_lock:
        _default_database = None


# `init_db()` wrapper was inlined post-SQLite-removal — the trivial
# one-liner `_init_db_postgres(get_database())` is now called
# directly from `web_runner/__init__.py::create_app()`. The wrapper
# added no value over the direct call.


def _init_db_postgres(db: PostgresDatabase) -> None:
    """Create tables + indexes for PostgreSQL."""
    statements = [
        """CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'pending',
            platform TEXT,
            action TEXT,
            account TEXT,
            created TEXT,
            code INTEGER,
            error TEXT,
            argv TEXT,
            result TEXT,
            publish_detail TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS logs (
            id SERIAL PRIMARY KEY,
            ts TEXT NOT NULL,
            message TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS account_groups (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS account_authorizations (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            platform TEXT NOT NULL,
            cookie_file TEXT NOT NULL,
            created TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (group_id) REFERENCES account_groups(id) ON DELETE CASCADE,
            UNIQUE(group_id, platform)
        )""",
        """CREATE TABLE IF NOT EXISTS ai_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS ai_api_keys (
            id SERIAL PRIMARY KEY,
            api_key TEXT NOT NULL UNIQUE,
            masked TEXT NOT NULL,
            created TEXT NOT NULL,
            rate_limited_at TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS error_events (
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
        )""",
        """CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL,
            last_login TEXT,
            login_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS verification_codes (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'login',
            expires_at TEXT NOT NULL,
            used BOOLEAN NOT NULL DEFAULT false,
            created_at TEXT NOT NULL
        )""",
        # round-OPT-MONETIZE-v1 — widen the action whitelist to
        # include 'studio_render'. Original (pre-this-round) limit
        # was the 3 verbs needed for upload/AI/account metering;
        # Studio render soft-paywall adds the 4th verb. The paired
        # ``ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT``
        # block above migrates pre-existing rows; this CREATE
        # carries the new whitelist so fresh deploys do NOT trip
        # the ALTER path (which would fail on the ADD CONSTRAINT
        # step).
        """CREATE TABLE IF NOT EXISTS usage_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            action TEXT NOT NULL CHECK(action IN ('publish','ai_generate','account_add','studio_render')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS publish_templates (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('video','note')),
            snapshot TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",        """CREATE TABLE IF NOT EXISTS admin_audit_log (
            id SERIAL PRIMARY KEY,
            admin_user_id INTEGER NOT NULL REFERENCES users(id),
            target_user_id INTEGER REFERENCES users(id),
            action TEXT NOT NULL,
            detail TEXT,
            created_at TEXT NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0
        )""",
        # ── Webhook notifications (openspec/changes/webhook-notifications) ──
        """CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            task_id TEXT,
            platform TEXT,
            account TEXT,
            title TEXT,
            status TEXT,
            error_msg TEXT,
            payload JSONB,
            webhook_url TEXT,
            delivered INTEGER NOT NULL DEFAULT 0,
            final_failed INTEGER NOT NULL DEFAULT 0,
            retry_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delivered_at TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS webhooks_config (
            id SERIAL PRIMARY KEY,
            platform TEXT,
            account TEXT,
            url TEXT NOT NULL,
            secret TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, account, url)
        )""",
        # ── Script Studio (openspec/changes/script-studio) ─────────────
        # Episode / asset tables use ON DELETE CASCADE so a `DELETE FROM
        # studio_projects` atomically nukes all dependent rows.
        """CREATE TABLE IF NOT EXISTS studio_projects (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            synopsis TEXT NOT NULL,
            style TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            owner_user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS studio_episodes (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
            episode_no INTEGER NOT NULL,
            act TEXT NOT NULL,
            title TEXT NOT NULL,
            scenes_json JSONB,
            dialogues_json JSONB,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL,
            UNIQUE (project_id, episode_no)
        )""",
        """CREATE TABLE IF NOT EXISTS studio_assets (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            prompt TEXT NOT NULL,
            ref_image_url TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (project_id, kind, code)
        )""",
    ]
    index_statements = [
        "CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts)",
        "CREATE INDEX IF NOT EXISTS idx_logs_message ON logs (message)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks (created)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)",
        # Composite DESC covering the default tasks-list query
        # (`web_runner/utils.py::list_tasks`: ``SELECT * FROM tasks ORDER BY
        # created DESC, task_id DESC``). Without this the planner does a
        # full sort on every page render. ``task_id`` is included as the
        # tie-breaker so the secondary sort is index-backed too.
        "CREATE INDEX IF NOT EXISTS idx_tasks_list_desc ON tasks (created DESC, task_id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_ts ON error_events (ts)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_platform ON error_events (platform)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_account ON error_events (account)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_exc_type ON error_events (exc_type)",
        # Reverse-lookup: "show me all error_events for this task_id".
        # ``error_events.task_id`` is an application-level FK (no PG
        # constraint, since task rows are churned aggressively) and
        # without this index every error-attribution scan goes seq-scan
        # once the table is past ~10k rows. Trailing ``ts DESC`` covers
        # the typical "latest errors first" attribution view so the
        # planner can walk the index in order without a separate sort
        # node. One extra btree column (8 bytes/row) for the
        # no-sort guarantee on the common path.
        "CREATE INDEX IF NOT EXISTS idx_error_events_task_id "
        "ON error_events (task_id, ts DESC)",
        "CREATE INDEX IF NOT EXISTS idx_auth_group_id ON account_authorizations (group_id)",
        "CREATE INDEX IF NOT EXISTS idx_verification_email ON verification_codes (email)",
        # Partial index for the login hot path
        # (``web_runner/routes/auth.py::login`` line 315:
        # ``WHERE email = ? AND purpose = 'login' AND used = 0
        # AND expires_at > ? ORDER BY created_at DESC LIMIT 1``).
        # Partial predicate ``used = false AND purpose = 'login'``
        # keeps the index small (only the active login codes; used
        # codes + SSE tokens are excluded), so the planner can
        # answer the lookup from a tiny index alone. Immutable, so
        # the partial condition is allowed; do NOT add ``now()`` or
        # any volatile function to the WHERE — PG would reject the
        # index definition. ``expires_at > ?`` is applied
        # post-index, which is cheap because the partial result set
        # is already tiny.
        #
        # Trailing ``created_at DESC`` matches the query's
        # ``ORDER BY created_at DESC LIMIT 1``: the planner walks
        # the index in order and returns the first matching row
        # without a sort node. ``code = ?`` is a single-row
        # post-index check; if the latest code doesn't match, the
        # planner advances to the next index entry. In practice
        # login attempts are sequential so this walks at most a
        # handful of entries before the LIMIT 1 short-circuits.
        "CREATE INDEX IF NOT EXISTS idx_verification_login_active "
        "ON verification_codes (email, created_at DESC) "
        "WHERE used = false AND purpose = 'login'",
        "CREATE INDEX IF NOT EXISTS idx_usage_user_action ON usage_logs (user_id, action, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_analytics ON tasks (platform, status, created)",
        "CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at)",
        "CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log (admin_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_studio_projects_owner ON studio_projects (owner_user_id, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_studio_episodes_project ON studio_episodes (project_id, episode_no)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_task ON notifications (task_id)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_event_type ON notifications (event_type)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (delivered, final_failed)",
        "CREATE INDEX IF NOT EXISTS idx_webhooks_config_route ON webhooks_config (platform, account)",
    ]
    alteration_statements = [
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS license_tier TEXT DEFAULT 'legacy'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS license_key TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS license_activated_at TIMESTAMP",
        # Profile contract (extended auth user shape): ProfilePage +
        # SettingsPage + UserMenu now read `name` / `avatar` from the
        # users row via GET /api/auth/me. Both columns are nullable —
        # existing rows keep NULL until the user sets them via PATCH
        # /api/auth/me.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT",
        # Founder identity (ai-api-keys-founder feature):
        # users.is_founder is the single source of truth for
        # "manages AI API keys" privilege. Strictly narrower than
        # role='admin' — a deployment MAY have many admins but only
        # ONE founder at a time, enforced by the partial-unique
        # index below + the atomic-swap transaction in
        # web_runner/routes/founder.py::transfer_founder.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_founder BOOLEAN NOT NULL DEFAULT FALSE",
        # At most one founder at a time (PG partial UNIQUE).
        "CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_one_founder "
        "ON users (is_founder) WHERE is_founder = TRUE",
        # Password authentication: bcrypt hash of user-set password.
        # NULL means the user has only used email-code / OAuth login
        # and has not yet set a password. When set, enables password
        # login via POST /api/auth/login-by-password.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT",
        # Index for reset-password code lookups (mirrors
        # idx_verification_login_active for the 'reset_password'
        # purpose).
        "CREATE INDEX IF NOT EXISTS idx_verification_reset_active "
        "ON verification_codes (email, created_at DESC) "
        "WHERE used = false AND purpose = 'reset_password'",
        # Studio whiteboard canvas data (openspec/changes/studio-whiteboard). PG JSONB.
        "ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS canvas_data JSONB",
        # Phase 2 image-overlay opacity (Pexels background on
        # /dashboard/studio/{id}). Range 0..1; 0 = no overlay
        # (background image is unobscured), 1 = full black overlay
        # (text on top is opaque). Default 0.5 — strong enough to
        # guarantee the `#ebebf0` body / `#6366f1` accent stay
        # legible regardless of Pexels output brightness without
        # making the background look like a black rectangle. NOT
        # NULL so legacy rows still have a sane value.
        "ALTER TABLE studio_projects "
        "ADD COLUMN IF NOT EXISTS overlay_opacity REAL NOT NULL DEFAULT 0.5",
        # ── Visual Style Presets (round-OPT-presets-v1) ─────────────
        # Catalyst for this column: ship 3 named visual presets
        # (Noir / Vibrant / Minimalist) selectable from a dropdown
        # beside the "渲染成片" button. Catalogue IDs are
        # case-sensitive strings defined in `sau_web/frontend/
        # remotion_studio/presets.ts`; the Python side is a pure
        # pass-through (no whitelist validation). See the openspec
        # at `openspec/changes/studio-visual-presets/specs/
        # visual-presets/spec.md` §"Catalog location" for the
        # single-TS-source-of-truth rationale.
        #
        # Schema: PG JSONB with nullable payload — legacy rows stay
        # NULL (default-render with the Classic tokens). Cross-
        # scene preset shipping is a future PR (per-renderer fields
        # like motion curve / custom font URL) that can live as
        # additional sibling JSONB keys without an ALTER round.
        #
        # Field shape is `{preset: "<id>"}` with `{version: 1}`
        # appended on writes so future migrations have a forward-
        # compat hook. Reads are version-tolerant (UI falls back to
        # Classic on any non-1 version once we ship v2).
        "ALTER TABLE studio_projects "
        "ADD COLUMN IF NOT EXISTS render_config JSONB",
        # round-OPT-MONETIZE-v1 — widen the `usage_logs.action`
        # CHECK whitelist to include 'studio_render'. The original
        # whitelist ('publish','ai_generate','account_add') was
        # scoped to the original metering surface; this round
        # introduces a per-tier daily quota on the Studio render
        # endpoint so the row-level constraint has to accept the
        # new action verb.
        #
        # Idempotent: PG auto-names the inline CHECK as
        # ``usage_logs_action_check`` (single CHECK on the column
        # ⇒ no _1 / _2 suffix risk). DROP IF EXISTS swallows the
        # "old schema, no constraint" case; ADD without IF NOT
        # GUARDED is OK because DROP just succeeded in the same
        # transaction. Re-running on a fresh DB hits CREATE TABLE
        # IF NOT EXISTS first (which carries the new whitelist
        # verbatim via the schema below) so this ALTER is a
        # no-op for clean deploys.
        "ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_action_check",
        "ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_action_check "
        "CHECK(action IN ('publish','ai_generate','account_add','studio_render'))",

        # ── Autovacuum tuning for high-churn tables ──
        # Per docs/perf-indexes.md §4.2: default PG autovacuum
        # (autovacuum_vacuum_scale_factor=0.2 = 20% dead rows) is too
        # lazy for these 4 high-churn tables. Lower scale factor →
        # more frequent VACUUM → bloat stays small, planner stats
        # stay fresh, dead-row-ratio cost in seq-scan plans stays low.
        # ALTER TABLE ... SET (...) is idempotent (setting the same
        # option to the same value is a no-op) so re-runs are safe.
        # Verified against perf-baseline re-run: no query regressed
        # (all 11 captured queries within 0.9×–1.1× warm-cache noise;
        # the 3 new round-7 indexes still measure Q1 5.9× / Q2 57×
        # / Q3 0.9× speedups — see scripts/perf_baseline_capture.py).
        #
        # Locked-down PG roles (RDS, Cloud SQL, etc.): if the app
        # role lacks ALTER privilege on these 4 tables, init_db()
        # aborts mid-loop on the first ALTER TABLE and the first
        # request 500s. Operators on managed PG should run the 4
        # ALTER TABLE statements manually as a one-time migration
        # using a role with sufficient privilege (e.g.
        # rds_superuser on RDS), then redeploy.
        "ALTER TABLE logs SET (autovacuum_vacuum_scale_factor = 0.05)",
        "ALTER TABLE error_events SET (autovacuum_vacuum_scale_factor = 0.05)",
        "ALTER TABLE usage_logs SET (autovacuum_vacuum_scale_factor = 0.05)",
        # verification_codes is the only one of the 4 that never trims
        # (logs / error_events / usage_logs are capped at 10k by
        # _log_trim_counter). Aggressive 0.02 scale factor from day 1
        # so the table doesn't fill with used/expired codes that the
        # partial idx_verification_login_active index would otherwise
        # have to filter through.
        "ALTER TABLE verification_codes SET ("
        "autovacuum_vacuum_scale_factor = 0.02, "
        "autovacuum_vacuum_cost_limit = 2000"
        ")",
    ]
    # Founder back-fill (PG branch — ai-api-keys-founder).
    # Idempotent: if any row already has is_founder=TRUE, the NOT
    # EXISTS + ORDER BY id ASC LIMIT 1 subquery evaluates to NULL
    # and the WHERE id = NULL matches zero rows. Re-running on a
    # deployment that already has a founder is a safe no-op.
    founder_backfill_sql = (
        "UPDATE users SET is_founder = TRUE WHERE id = ("
        "  SELECT id FROM users ORDER BY id ASC LIMIT 1"
        ") AND NOT EXISTS (SELECT 1 FROM users WHERE is_founder = TRUE) "
        "AND EXISTS (SELECT 1 FROM users)"
    )
    with db._conn() as conn:
        for stmt in statements + index_statements:
            conn.execute(stmt)
        for stmt in alteration_statements:
            conn.execute(stmt)
        try:
            conn.execute(founder_backfill_sql)
        except Exception:
            # Defensive — partial-unique-index above may already
            # have blocked the UPDATE if a stale row violated
            # uniqueness; surface the side-effect only via the
            # operator's logs (the python logger at INFO level),
            # not via a 500 to the caller. The init_db() flow is
            # a side channel — callers don't read this return
            # value.
            pass
        # Partial index for scheduled task lookup (PG-only syntax)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_pending_scheduled "
            "ON tasks (status, scheduled_at) "
            "WHERE status = 'pending' AND scheduled_at IS NOT NULL"
        )


def parse_date_param(
    s: str | None,
    default_days_ago: int = 30,
) -> str:
    """鲁棒日期参数解析 (跨路由共用的 helper,在 ``db.py`` 集中维护)。

    接受 ``YYYY-MM-DD`` 或 ISO-8601 datetime 字符串 (e.g.
    ``2026-06-21T02:37:54.362Z``);后者被截断到日期部分。返回值永远
    是 ``YYYY-MM-DD`` 形式的合法 SQL date literal。

    安全契约 (PR 兜底): 函数**对外绝不抛异常**。两层 try 分别覆盖
    两类故障:
      1. **内层 ``except (ValueError, TypeError)``**: 吞掉"格式不对"
         的预期输入 (e.g. ``?from=not-a-date``)——避免日志噪音。
      2. **顶层 ``except Exception``**: 接住"异常形态"的输入
         (e.g. ``?from=`` 解析成非 ``str`` 类型,导致 ``s.replace``
         抛 ``AttributeError``)。这一类信号本来**不该发生**,必须有
         日志告警,方便运维定位前端 bug 或异常探测。把这一层兜底
         删掉会回到 PR 之前的"500 直传路由"故障;故 tests 必须
         锁定 invariant。

    失败输入通过 :data:`logging` 在 ``web_runner.db`` logger 输出
    WARNING,带可识别的 marker ("parse_date_param") 方便 grep。

    :param s: 待解析的字符串 (``str | None``,运行时容忍任意类型)
    :param default_days_ago: 解析失败或输入为 ``None`` 时的回退天数;
        默认 30 兼容旧 analytics 路由的 30 天窗口语义。
    :returns: ``YYYY-MM-DD`` 字符串。
    """
    try:
        if s:
            # 1. Exact YYYY-MM-DD
            try:
                datetime.strptime(s, "%Y-%m-%d")
                return s
            except (ValueError, TypeError):
                # Expected user-side parse error — silently fall
                # through to the ISO branch and (ultimately) the
                # default. We do NOT log here to avoid spam from
                # routine bad-format URLs.
                pass
            # 2. ISO-8601 datetime — truncate to date. ``s.replace``
            #    accepts bytes / str alike; ``datetime.fromisoformat``
            #    will reject non-str by raising ``TypeError`` which
            #    the inner except catches.
            try:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
                return dt.strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                pass
    except Exception as exc:
        # Top-level safety net: capture any exception that escapes
        # the inner except blocks (e.g. ``AttributeError`` on
        # ``s.replace`` for non-str types without that method).
        # MUST NOT propagate — analytics endpoints rely on this
        # function to never 500. Failing input is logged so an
        # operator can chase it down via:
        #
        #   rg "parse_date_param" .sau-logs/
        #
        # rather than learning about it from a 500 traceback.
        _db_logger.warning(
            "parse_date_param: malformed input %r (%s: %s); "
            "falling back to default offset",
            s, type(exc).__name__, exc,
        )
    return (datetime.now(timezone.utc) - timedelta(days=default_days_ago)).strftime("%Y-%m-%d")
