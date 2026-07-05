"""Database module: dialect-aware Database abstraction (PR2 + PR2-final).

Replaces the legacy module-level `get_connection()` + `db_lock` shims with
a single `get_database()` factory that returns either `SqliteDatabase`
(dev fallback) or `PostgresDatabase` (production). Both backends + their
respective transaction handles share the same interface:

    execute(sql, params)              -> int
    execute_many(sql, seq)            -> None
    fetch_one(sql, params)            -> dict | None
    fetch_all(sql, params)            -> list[dict]
    last_insert_id()                  -> int
    insert_returning_id(sql, params)  -> int    (sqlite 3.35+, pg 9.5+)
    json_dump(value)                  -> str | None  (sqlite) | Any  (pg)
    json_load(value)                  -> Any
    transaction()                     -> ContextManager[Database]

Transaction handles (SqliteTransactionHandle / PostgresTransactionHandle)
bind a single connection for the lifetime of a `with db.transaction() as
tx:` block so multi-statement work shares one connection and
commits-or-rolls-back as one unit. The handles do NOT auto-commit;
the wrapping ctx-mgr is responsible for the lifecycle.

Dialect helpers:
  * `_translate_placeholders(sql)` converts `?` outside string literals
    to `%s` for PostgreSQL positional params (the regex doesn't handle
    `'in-string ?'` escapes — current SQL has none).
  * `_translate_psycopg_exception(exc)` rewraps psycopg errors into
    their sqlite3 counterparts so production routes can keep using
    `except sqlite3.IntegrityError:` blocks across both backends.

Call sites in `web_runner/utils.py` + `web_runner/routes/*` use
`db = get_database()` and `db.execute(...)` directly. Tests rebind
`SAU_DB_DIALECT` to `sqlite` for the legacy in-memory path.
"""
from __future__ import annotations

import functools
import json
import logging
import os
import re
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

# Module-level logger used by helper functions in this file (e.g.
# ``parse_date_param``). The application entrypoint (``web_runner/__init__.py``
# or the WSGI runner) is responsible for attaching handlers — by default
# the root logger propagates these warnings to wherever the operator
# configured the host (journalctl / Cloud Logging / stdout).
_db_logger = logging.getLogger(__name__)


BASE_DIR = Path(__file__).parent.parent.resolve()
DB_DIR = BASE_DIR / "db"
DB_DIR.mkdir(exist_ok=True)
DB_PATH = DB_DIR / "database.db"


# Single-quoted SQL strings + '?' outside string literals — openspec §2.5
# specify-positional translator. Does NOT handle:
#   * 'in-string doubled single-quote' escape (current code never uses it).
#   * double-quoted "..." strings (SQL standard reserves these for
#     identifiers; current code uses single quotes for string literals).
# Per openspec §Risks, current code has no LIKE '?' literal, so the regex
# is sufficient.
_PLACEHOLDER_PATTERN = re.compile(r"'[^']*'|\?")


def _translate_placeholders(sql: str) -> str:
    """Rewrite '?' outside string literals to '%s' (PG positional param)."""
    return _PLACEHOLDER_PATTERN.sub(
        lambda m: "%s" if m.group(0) == "?" else m.group(0),
        sql,
    )


# ── Psycopg → Sqlite3 exception translation (PR3) ─────────────────────────

# The ``Database`` Protocol promises a sqlite3-shaped exception surface:
# production routes (e.g. ``web_runner/routes/ai.py::ai_config_set``) catch
# ``sqlite3.IntegrityError`` to map duplicate-key inserts to HTTP 409. With
# raw psycopg, the same condition surfaces as
# ``psycopg.errors.UniqueViolation`` (a subclass of
# ``psycopg.errors.IntegrityError``); without translation the route
# handler would miss errors on Postgres. ``_translate_psycopg_exception``
# is the boundary: every psycopg exception leaving a
# ``PostgresDatabase`` public method is rewrapped in the matching
# sqlite3 class so callers see one dialect-agnostic contract.


@functools.lru_cache(maxsize=1)
def _psycopg_exception_map() -> dict:
    """Lazy build the psycopg → sqlite3 exception translation table.

    Returns ``{}`` if psycopg is not installed, in which case
    ``_translate_psycopg_exception`` is the identity function. The
    Postgres backend is opt-in via ``SAU_DB_DIALECT=postgres`` and the
    factory already refuses to construct ``PostgresDatabase`` without
    psycopg installed, so the empty-map branch is only reachable when
    callers bypass the factory and inject a fake psycopg exception for
    testing — in that case translation naturally degrades to identity.
    """
    try:
        import psycopg.errors
    except ImportError:
        return {}
    return {
        # psycopg.IntegrityError is the parent of UniqueViolation,
        # ForeignKeyViolation, NotNullViolation, CheckViolation, and
        # RestrictViolation — all PK / UNIQUE / FK / CHECK / NOT NULL
        # constraints surface as this single Python type, so the
        # sqlite3 side collapses to one class too.
        psycopg.errors.IntegrityError: sqlite3.IntegrityError,
        psycopg.errors.OperationalError: sqlite3.OperationalError,
        psycopg.errors.ProgrammingError: sqlite3.ProgrammingError,
        psycopg.errors.DataError: sqlite3.DataError,
        psycopg.errors.InterfaceError: sqlite3.InterfaceError,
    }


def _translate_psycopg_exception(exc: BaseException) -> BaseException:
    """Re-wrap a psycopg exception in its sqlite3 equivalent.

    Returns the input unchanged when the exception is not in the
    translation map (e.g. the caller passed a plain ``ValueError`` or a
    sqlite3 exception that originated on the SQLite path and never
    crossed through this layer). The identity branch keeps the
    function safe to call from test-code on either backend.

    Pytest note: the result is always ``raise X from orig`` at the
    call site (see ``PostgresDatabase._conn``), which preserves the
    original psycopg exception in ``__cause__`` for debugging while
    delivering a sqlite3-flavored exception to higher layers.
    """
    for pg_cls, sqlite_cls in _psycopg_exception_map().items():
        if isinstance(exc, pg_cls):
            return sqlite_cls(str(exc))
    return exc


# ── SAVEPOINT-backed nested transactions (PR4) ───────────────────────────

# ``tx.savepoint(name)`` and the back-compat ``tx.transaction()`` shortcut
# both want a SQL identifier as the savepoint name. SQL identifiers
# can't be bound as parameters, so the only safe path is
# validate-then-interpolate. Rules tuned to the union of SQLite + PG
# identifier naming rules:
#   * matched by ``^[a-zA-Z_][a-zA-Z0-9_]*$`` (no digits at the start
#     — avoids SQL syntactic ambiguity where ``"1sp"`` could be parsed
#     as a numeric literal in some contexts).
#   * length cap of 64 chars (PG identifier limit is 63; SQLite has no
#     hard cap but symmetric cap keeps the floor clean).
#   * reserved-word deny-list catches SQL keywords that would lead to
#     parse errors at the BACKEND (``SAVEPOINT savepoint`` is malformed
#     on PG; ``SAVEPOINT begin`` would shadow begin etc.).
#
# Validation runs BEFORE the SAVEPOINT SQL touches the connection, so
# a rejected name leaves the savepoint stack clean (no leaked
# ``SAVEPOINT`` entry half-opened).
_SAVEPOINT_NAME_RE: re.Pattern[str] = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_SAVEPOINT_NAME_MAX_LEN: int = 63  # PG identifier hard limit (NAMEDATALEN - 1).
_RESERVED_SAVEPOINT_NAMES: frozenset = frozenset({
    # SQL keywords that would parse-error at the BACKEND when used as
    # a savepoint identifier (the most-likely-mis-named subset; the
    # full SQLite + PG reserved-word lists are extensive). The
    # identifier regex blocks numeric-literal-lookalikes and SQL
    # injection vectors already; this deny-list adds the keyword
    # callers are most likely to reach for without quoting. PG + SQLite
    # both reject these with backend-level parse errors instead of
    # surfacing as a clean pre-flight ValueError.
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

    Both SQLite and PostgreSQL accept matching identifiers verbatim in
    ``SAVEPOINT`` / ``RELEASE`` / ``ROLLBACK TO`` statements without
    any quoting, so once validation passes we can interpolate the
    identifier directly.
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


# ── Psycopg ConnectionPool tuning (PR4-follow-up) ────────────────────────

# Names of psycopg.connect() kwargs that PostgresDatabase enforces
# regardless of what the operator puts in SAU_DB_POOL_KWARGS. We gate
# them explicitly (raise rather than silently overwrite) because
# failing silent on infra config is a debugging nightmare:
#   * row_factory — must stay ``dict_row`` so ``fetch_one`` /
#     ``fetch_all`` return dict-by-name; tuple-row would break every
#     ``row["..."]`` index in routes/* callers (the abstraction's
#     whole "dialect-agnostic dict result contract").
#   * autocommit — must stay ``True`` so PR3's
#     ``_translate_psycopg_exception`` wrap, applied at the
#     public-method boundary, has a predictable baseline to layer on
#     top of.
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
    """Dialect-aware abstract Database (openspec §2.2)."""

    def execute(self, sql: str, params: tuple = ()) -> int: ...
    def execute_many(self, sql: str, seq_of_params: list) -> None: ...
    def fetch_one(self, sql: str, params: tuple = ()) -> dict | None: ...
    def fetch_all(self, sql: str, params: tuple = ()) -> list: ...
    def last_insert_id(self) -> int: ...
    def json_dump(self, value: Any) -> Any: ...
    def json_load(self, value: Any) -> Any: ...
    def transaction(self) -> AbstractContextManager[Database]: ...


class SqliteTransactionHandle:
    """Binds a single ``sqlite3.Connection`` for the lifetime of a
    ``with db.transaction() as tx`` block.

    Mirrors the :class:`Database` Protocol but delegates every method
    to **one** bound connection so:

      * Multi-statement calls share one connection — no per-call
        ``_connect()`` setup/teardown overhead, matching the legacy
        ``with get_connection() as conn:`` semantics.
      * Reads see the in-flight transaction before commit (no
        read-uncommitted snapshot dance).
      * ``row_factory = sqlite3.Row`` is set once per block instead
        of once per call.

    The handle does NOT auto-commit. The wrapping context manager
    commits on clean block exit and rolls back on raised exception.
    Calling ``commit()``/``rollback()`` is intentionally not exposed
    on the handle — the caller is expected to let the
    ``with db.transaction()`` block handle transaction lifetime.
    """

    def __init__(self, conn: sqlite3.Connection, parent: SqliteDatabase) -> None:
        self._conn = conn
        self._parent = parent
        # Monotonic counter for auto-generated savepoint names used by
        # ``tx.transaction()`` (PR4 back-compat shortcut). Per-handle so
        # independent handles (different outer-tx life-cycles) stay
        # isolated — two outer-tx handles never share their auto-naming
        # counter.
        self._savepoint_seq: int = 0

    def execute(self, sql: str, params: tuple = ()) -> int:
        cur = self._conn.execute(sql, params)
        # NO conn.commit() — the with-block's exit handles it.
        self._lastrowid_local = cur.lastrowid or 0
        return cur.rowcount

    def execute_many(self, sql: str, seq_of_params: list) -> None:
        self._conn.executemany(sql, seq_of_params)

    def fetch_one(self, sql: str, params: tuple = ()) -> dict | None:
        self._conn.row_factory = sqlite3.Row
        row = self._conn.execute(sql, params).fetchone()
        return dict(row) if row else None

    def fetch_all(self, sql: str, params: tuple = ()) -> list:
        self._conn.row_factory = sqlite3.Row
        rows = self._conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def last_insert_id(self) -> int:
        return getattr(self, "_lastrowid_local", 0)

    def insert_returning_id(self, sql: str, params: tuple) -> int:
        sql_with_returning = sql.rstrip().rstrip(";").strip() + " RETURNING id"
        # Set row_factory per-call so the fetched row is indexed by
        # column name. ``fetch_one`` / ``fetch_all`` do this implicitly
        # because they always need dict-shaped output; ``insert_returning_id``
        # also needs it because we read the row index-by-name to extract
        # ``id``. Without this, fetchone() returns a tuple and the
        # ``"id" not in row`` guard fires spuriously.
        self._conn.row_factory = sqlite3.Row
        row = self._conn.execute(sql_with_returning, params).fetchone()
        if not row or "id" not in row:
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
        collide on savepoint stack entries. Per-handle counter (not
        module-level) so independent handles stay isolated.
        """
        self._savepoint_seq += 1
        return f"sp_{self._savepoint_seq}"

    @contextmanager
    def savepoint(self, name: str) -> Iterator[Database]:
        """Open a SAVEPOINT-backed nested transaction (PR4).

        On entry: ``SAVEPOINT <name>``. ``name`` is validated as a
        SQL identifier via :func:`_validate_savepoint_name` BEFORE any
        SQL touches the connection — a rejected name leaves the
        savepoint stack clean.

        Yields: this handle (``self``), so callers can use the
        :class:`Database` Protocol surface (``tx.execute`` etc.)
        inside the nested block.

        On clean block exit: ``RELEASE <name>`` — inner writes commit
        to the surrounding transaction (still inside the outer tx;
        the outer tx must COMMIT for them to persist).

        On raised exception inside the block: ``ROLLBACK TO <name>``
        (revert inner writes) + ``RELEASE <name>`` (pop the savepoint
        from the stack), then re-raise the original exception.
        Both cleanup steps are best-effort — a SQL failure during
        cleanup is swallowed so the original exception is never
        obscured by cleanup noise.

        SQL-specific (SQLite): uses short-form ``RELEASE {name}``
        (SQLite's grammar; PG disambiguates savepoint-release from
        advisory-lock-release by requiring ``RELEASE SAVEPOINT`` — see
        :meth:`PostgresTransactionHandle.savepoint` for the PG form).
        """
        _validate_savepoint_name(name)
        self._conn.execute(f"SAVEPOINT {name}")
        try:
            yield self
        except Exception:
            try:
                self._conn.execute(f"ROLLBACK TO {name}")
            except sqlite3.Error:
                # Cleanup is best-effort; original exception still
                # propagates below via the re-raise.
                pass
            try:
                self._conn.execute(f"RELEASE {name}")
            except sqlite3.Error:
                pass
            raise
        else:
            self._conn.execute(f"RELEASE {name}")

    def transaction(self) -> AbstractContextManager[Database]:
        """Backward-compat shortcut: open a savepoint with auto-name.

        Identical to ``self.savepoint(self._next_savepoint_name())`` —
        callers used to the PR2-final ``tx.transaction()`` API keep
        working unchanged. Auto-naming via ``sp_<N>`` so successive
        calls in the same outer tx don't collide on savepoint entries.

        Prefer :meth:`savepoint` with a user-supplied name when you
        want explicit checkpoint naming (e.g., debugging which sub-
        block raised).
        """
        return self.savepoint(self._next_savepoint_name())


class SqliteDatabase:
    """SQLite single-file backend (openspec §2.3).

    Lazy-reads `DB_PATH` on every `_connect()` so test fixtures that rebind
    `DB_PATH` to a tmp path (test_sau_web_upload.py /
    test_sau_web_account_groups.py) see the override instead of a stale
    cache.
    """

    def __init__(self) -> None:
        self._lastrowid: int = 0

    def _connect(self) -> sqlite3.Connection:
        # Read DB_PATH at call time (not __init__ time) so tests can rebind.
        path = str(DB_PATH)
        if path == ":memory:":
            conn = sqlite3.connect(":memory:", check_same_thread=False)
        else:
            conn = sqlite3.connect(path, check_same_thread=False)
        # Multi-thread safety paths (openspec §D4 / PR4.3):
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def execute(self, sql: str, params: tuple = ()) -> int:
        with self._connect() as conn:
            cur = conn.execute(sql, params)
            conn.commit()
            self._lastrowid = cur.lastrowid or 0
            return cur.rowcount

    def execute_many(self, sql: str, seq_of_params: list) -> None:
        with self._connect() as conn:
            conn.executemany(sql, seq_of_params)
            conn.commit()

    def fetch_one(self, sql: str, params: tuple = ()) -> dict | None:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None

    def fetch_all(self, sql: str, params: tuple = ()) -> list:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]

    def last_insert_id(self) -> int:
        """DEPRECATED: racy under concurrent INSERTs from multiple threads
        because the cursor rowid lives on the singleton. Prefer
        ``insert_returning_id`` for callers that need an id immediately
        after INSERT.
        """
        return self._lastrowid

    def insert_returning_id(self, sql: str, params: tuple) -> int:
        """INSERT with ``RETURNING id`` (sqlite 3.35+, postgres).

        Thread-safe vs. ``last_insert_id``: this helper reads the id
        directly from the INSERT result, never via cached instance state.
        Use it anywhere cross-thread INSERT-write+read sequences could
        interleave (e.g. production routes spawning from the worker pool).

        The SQL must NOT include a trailing ``;`` or any existing
        ``RETURNING`` clause; we append ``RETURNING id`` after stripping
        whitespace and a single trailing semicolon.
        """
        sql_with_returning = (
            sql.rstrip().rstrip(";").strip() + " RETURNING id"
        )
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(sql_with_returning, params).fetchone()
            conn.commit()
            self._lastrowid = int(row["id"]) if row and "id" in row else 0
            if not row or "id" not in row:
                raise RuntimeError(f"INSERT did not return id: {sql!r}")
            return self._lastrowid

    def json_dump(self, value: Any) -> str | None:
        """Serialize to JSON-encoded string for storage in a TEXT column.

        Try-parse-then-dump: parse strings first, re-emit canonical form.
        Encode non-strings directly via json.dumps(s, default=str). Empty
        / None inputs short-circuit to None so the column stores NULL.
        """
        import json as _json
        if value is None or value == "" or value == [] or value == {}:
            return None
        if isinstance(value, str):
            try:
                parsed = _json.loads(value)
            except (_json.JSONDecodeError, ValueError):
                return _json.dumps(value, ensure_ascii=False)
            return _json.dumps(parsed, ensure_ascii=False, default=str)
        return _json.dumps(value, ensure_ascii=False, default=str)

    def json_load(self, value: Any) -> Any:
        """Parse a JSON-encoded column back to its native Python form.

        Returns None for None / empty inputs; surfaces malformed JSON by
        returning the raw string (so the bug is visible at the call site
        instead of silently swallowed).
        """
        import json as _json
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return _json.loads(value)
        except (_json.JSONDecodeError, TypeError):
            return value

    @contextmanager
    def transaction(self) -> Iterator[Database]:
        """Wrap multi-statement work in a SQLite transaction.

        Yields a :class:`SqliteTransactionHandle` bound to a single
        ``sqlite3.Connection`` (with WAL + busy_timeout +
        check_same_thread=False already applied via ``_connect()``).
        Commits on clean block exit; rolls back on raised exception.

        Single-statement INSERTs that need ``RETURNING id`` should use
        ``insert_returning_id`` directly (no transaction needed). This
        ctx-mgr is meant for routes where several statements must
        commit-or-rollback as one unit, e.g. the
        ``account_groups.rename`` endpoint that moves on-disk cookie
        files and then writes the group + authorizations rows
        atomically.
        """
        conn = self._connect()
        try:
            yield SqliteTransactionHandle(conn, self)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


class PostgresTransactionHandle:
    """Binds a single ``psycopg.Connection`` for the lifetime of a
    ``with db.transaction() as tx`` block.

    Mirrors the :class:`Database` Protocol but delegates every method
    to **one** bound connection. Reads see the in-flight transaction
    before COMMIT (Postgres READ COMMITTED default).

    Like :class:`SqliteTransactionHandle`, this handle does NOT
    auto-commit; the wrapping context manager handles
    COMMIT/ROLLBACK via psycopg's native ``conn.transaction()``
    context manager (auto-flips autocommit off and restores it after).
    """

    def __init__(self, conn: Any, parent: PostgresDatabase) -> None:
        self._conn = conn
        self._parent = parent
        # See SqliteTransactionHandle.__init__ for the rationale on
        # per-handle savepoint counter (PR4 back-compat for nested
        # ``tx.transaction()`` calls).
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
        if not row or "id" not in row:
            raise RuntimeError(f"INSERT did not return id: {sql!r}")
        return int(row["id"])

    def json_dump(self, value: Any) -> Any:
        return self._parent.json_dump(value)

    def json_load(self, value: Any) -> Any:
        return self._parent.json_load(value)

    def _next_savepoint_name(self) -> str:
        """Auto-name ``sp_<N>`` from a per-handle monotonic counter.

        See :meth:`SqliteTransactionHandle._next_savepoint_name` —
        identical rationale, PG form.
        """
        self._savepoint_seq += 1
        return f"sp_{self._savepoint_seq}"

    @contextmanager
    def savepoint(self, name: str) -> Iterator[Database]:
        """Open a SAVEPOINT-backed nested transaction on Postgres (PR4).

        Behaviour mirrors
        :meth:`SqliteTransactionHandle.savepoint`, with PG-specific SQL
        form:

          * ``SAVEPOINT <name>``            (entry)
          * ``ROLLBACK TO SAVEPOINT <name>`` (inner-rollback cleanup)            * ``RELEASE SAVEPOINT <name>``    (clean exit OR post-rollback cleanup)

        TODO(PR4-follow-up): add ``TestPostgresSavepoint`` mock-pool wiring
        pin in ``tests/test_db_wrapper.py`` mirroring
        :class:`TestSqliteSavepoint` so PG-side savepoint regressions get
        caught in CI without a live PG dependency. Until that's in,
        a regression in the PG-specific SQL forms below (e.g.
        accidentally emitting ``RELEASE <name>`` instead of
        ``RELEASE SAVEPOINT <name>``) wouldn't be caught by tests.
        The PG verbose form (``SAVEPOINT`` keyword in ``RELEASE`` /
        ``ROLLBACK TO``) is required to disambiguate savepoint-release
        from PG's bare ``RELEASE`` command (which releases an advisory
        lock, not a savepoint). Sending a bare ``RELEASE <name>`` to PG
        when ``<name>`` is a savepoint could be mis-parsed by future
        PG versions or by tooling that doesn't know our context.

        Exception contract (PR3): the SAVEPOINT SQL itself doesn't
        raise psycopg exceptions on the inner block — but a query
        inside the savepoint (e.g. an INSERT that violates a UNIQUE
        constraint) does. That psycopg exception bubbles out of this
        context manager's ``except`` clause; it propagates out of the
        outer :meth:`PostgresDatabase.transaction` block and is caught
        by :meth:`PostgresDatabase._conn`'s
        ``_translate_psycopg_exception`` wrap → ``sqlite3.IntegrityError``
        surfaces to the route handler. Same contract as the outer
        transaction block; SAVEPOINT adds a sub-checkpoint without
        disrupting how callers catch exceptions.
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

        See :meth:`SqliteTransactionHandle.transaction` for rationale —
        identical back-compat shape, PG-specific savepoint SQL.
        """
        return self.savepoint(self._next_savepoint_name())


class PostgresDatabase:
    """PostgreSQL backend with ConnectionPool (openspec §2.4).

    Lazy-imports psycopg + psycopg_pool (raises RuntimeError if missing).
    Caller must set DATABASE_URL + SAU_DB_DIALECT=postgres, OR rely on the
    default (SAU_DB_DIALECT='postgres', DATABASE_URL required).

    psycopg's `dict_row` row_factory already decodes JSONB columns to dict
    on SELECT, so Json helpers are identity here. The Application still
    has the symmetric `json_dump`/`json_load` API so call sites don't
    branch on dialect — openspec §2.8 call-site migration is mechanical.

    Exception contract (PR3): every public method (``execute``,
    ``execute_many``, ``fetch_one``, ``fetch_all``, ``insert_returning_id``)
    routes its underlying psycopg exception through
    ``_translate_psycopg_exception`` so callers see
    ``sqlite3.IntegrityError`` for PK/UNIQUE/FK/CHECK/NOT-NULL
    collisions instead of ``psycopg.errors.UniqueViolation`` and
    siblings. The translation happens inside ``_conn()`` (a
    ``ConnectionPool.connection`` wrapper) so the wrap is consistent
    across all entry points — there is no path that escapes
    untranslated. This is what keeps production routes dialect-agnostic:
    the same ``except sqlite3.IntegrityError:`` block matches whether
    the runtime is SQLite or Postgres.
    """

    def __init__(
        self,
        conninfo: str,
        min_size: int = 2,
        max_size: int = 15,
        timeout: float = 30.0,
        extra_kwargs: dict | None = None,
    ) -> None:
        """PostgresDatabase with env-tunable ConnectionPool sizing (PR4).

        Operators tune via ``SAU_DB_POOL_MIN`` / ``SAU_DB_POOL_MAX`` /
        ``SAU_DB_POOL_TIMEOUT`` / ``SAU_DB_POOL_KWARGS`` env vars; see
        :func:`_pool_kwargs_from_env` for parsing + validation. The
        factory (:func:`get_database`) reads them at call time, so
        ``monkeypatch.setenv`` + ``reset_default_database()`` swap a
        test's pool config in-process.

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
                f"these are managed by web_runner/db.py to preserve "
                f"PR3's psycopg→sqlite3 exception contract. Drop them "
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
                "`uv pip install -e \".[web-pg]\"`."
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
        self._lastrowid: int = 0

    @contextmanager
    def _conn(self) -> Iterator:
        """Wrap ``ConnectionPool.connection()`` and translate any psycopg
        exception into the matching sqlite3 exception.

        All public methods route through this context manager so the
        exception contract on top of ``PostgresDatabase`` is
        dialect-agnostic by construction. The original psycopg
        exception is preserved via ``raise ... from exc`` so
        ``__cause__`` keeps the full Python type for debugging, while
        the raised class itself is sqlite3-shaped for production
        ``except`` blocks.

        The ``Exception`` (not ``BaseException``) filter deliberately
        excludes ``KeyboardInterrupt`` / ``SystemExit`` / ``GeneratorExit``
        from translation: those are control-flow signals and must
        propagate unchanged.
        """
        try:
            with self._pool.connection() as conn:
                yield conn
        except Exception as exc:
            translated = _translate_psycopg_exception(exc)
            if translated is not exc:
                raise translated from exc
            raise

    def execute(self, sql: str, params: tuple = ()) -> int:
        sql_pg = _translate_placeholders(sql)
        with self._conn() as conn:
            cur = conn.execute(sql_pg, params)
            self._lastrowid = getattr(cur, "lastrowid", 0) or 0
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
        """DEPRECATED: see SqliteDatabase.last_insert_id."""
        return self._lastrowid

    def insert_returning_id(self, sql: str, params: tuple) -> int:
        """INSERT with ``RETURNING id`` (always supported in PG).

        See SqliteDatabase.insert_returning_id for thread-safety rationale.
        """
        sql_pg = _translate_placeholders(sql)
        sql_with_returning = (
            sql_pg.rstrip().rstrip(";").strip() + " RETURNING id"
        )
        with self._conn() as conn:
            row = conn.execute(sql_with_returning, params).fetchone()
            self._lastrowid = int(row["id"]) if row and "id" in row else 0
            return self._lastrowid

    def json_dump(self, value: Any) -> Any:
        # psycopg auto-encodes Python dicts to JSONB when the column
        # type is JSONB. We hand the value through unchanged so callers
        # see consistent semantics with the Sqlite backend.
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
        ``psycopg.Connection`` for the duration. The PR3
        ``_translate_psycopg_exception`` wrap is preserved on the
        outer pool-borrow level so any psycopg error surfaces as the
        matching sqlite3 class.
        """
        with self._conn() as raw_conn:
            try:
                with raw_conn.transaction():
                    yield PostgresTransactionHandle(raw_conn, self)
            except Exception as exc:
                # _conn() already translated; the inner psycopg
                # transaction block re-raises post-translation; we
                # re-translate just to be defensive against any
                # exception that bypassed the outer wrapper.
                translated = _translate_psycopg_exception(exc)
                if translated is not exc:
                    raise translated from exc
                raise


_default_database: Database | None = None
_default_lock = threading.Lock()


def get_database() -> Database:
    """Factory (openspec §2.6). Caches one Database instance per process.

    Pool sizing env vars (``SAU_DB_POOL_MIN`` / ``SAU_DB_POOL_MAX`` /
    ``SAU_DB_POOL_TIMEOUT`` / ``SAU_DB_POOL_KWARGS``) are read at this
    same first-call moment via :func:`_pool_kwargs_from_env`.
    Supported operator tuning loop: change-env-then-restart. Mid-process
    env changes do NOT re-trigger this resolution — the factory caches
    the singleton unconditionally. Call
    :func:`reset_default_database` to force a re-read (used by tests
    that swap env via ``monkeypatch.setenv``).

    Selection matrix:
      * SAU_DB_DIALECT=sqlite -> SqliteDatabase (dev fallback).
      * SAU_DB_DIALECT=postgres (or unset; psycopg present) ->
        PostgresDatabase using DATABASE_URL.
      * SAU_DB_DIALECT=postgres + psycopg missing -> RuntimeError.

    The default `postgres` is loud by design: leaves a clear failure
    surface in production if a build forgot to install the binary
    (openspec §D4 strategy).
    """
    global _default_database
    if _default_database is not None:
        return _default_database
    with _default_lock:
        if _default_database is not None:
            return _default_database
        dialect = os.environ.get("SAU_DB_DIALECT", "postgres").lower()
        if dialect == "sqlite":
            _default_database = SqliteDatabase()
        elif dialect == "postgres":
            conninfo = os.environ.get("DATABASE_URL", "")
            if not conninfo:
                raise RuntimeError(
                    "SAU_DB_DIALECT=postgres but DATABASE_URL env not set. "
                    "Provide a Postgres connection string "
                    "(e.g. postgres://user:pass@host:5432/sau)."
                )
            # PR4-follow-up: read pool sizing + extra psycopg.connect()
            # kwargs from env so operators can tune without redeploy.
            # Validation lives in _pool_kwargs_from_env; PR3 exception
            # contract is enforced via _GATED_POOL_KWARG_NAMES next to
            # the merge site in PostgresDatabase.__init__.
            min_size, max_size, timeout, extra_kwargs = _pool_kwargs_from_env()
            _default_database = PostgresDatabase(
                conninfo,
                min_size=min_size,
                max_size=max_size,
                timeout=timeout,
                extra_kwargs=extra_kwargs,
            )
        else:
            raise RuntimeError(
                f"Unknown SAU_DB_DIALECT={dialect!r}; expected 'postgres' or 'sqlite'."
            )
        return _default_database


def reset_default_database() -> None:
    """Test hook: clear the cached Database instance so the next
    `get_database()` call re-resolves the factory.

    Used by tests that swap `SAU_DB_DIALECT` mid-session (currently in
    `tests/test_db_wrapper.py::test_get_database_respects_dialect_switch`).
    """
    global _default_database
    with _default_lock:
        _default_database = None


def init_db() -> None:
    """Create all 7 tables + indexes if they don't exist.

    Both SQLite and Postgres paths run CREATE TABLE IF NOT EXISTS so
    a fresh database is ready without manual migration steps.
    """
    db = get_database()
    if isinstance(db, PostgresDatabase):
        _init_db_postgres(db)
    else:
        _init_db_sqlite(db)


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
        """CREATE TABLE IF NOT EXISTS usage_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            action TEXT NOT NULL CHECK(action IN ('publish','ai_generate','account_add')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS publish_templates (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('video','note')),
            snapshot TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
    ]
    index_statements = [
        "CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts)",
        "CREATE INDEX IF NOT EXISTS idx_logs_message ON logs (message)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks (created)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_ts ON error_events (ts)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_platform ON error_events (platform)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_account ON error_events (account)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_exc_type ON error_events (exc_type)",
        "CREATE INDEX IF NOT EXISTS idx_auth_group_id ON account_authorizations (group_id)",
        "CREATE INDEX IF NOT EXISTS idx_verification_email ON verification_codes (email)",
        "CREATE INDEX IF NOT EXISTS idx_usage_user_action ON usage_logs (user_id, action, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_analytics ON tasks (platform, status, created)",
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
        # /api/auth/me. No default fill-in: we don't want a cosmetic
        # backfill that hides fact from the frontend (ProfilePage's
        # 显示名 row is explicitly designed to surface the
        # user-hasn't-set-this state).
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT",
    ]
    with db._conn() as conn:
        for stmt in statements + index_statements:
            conn.execute(stmt)
        for stmt in alteration_statements:
            conn.execute(stmt)
        # Partial index for scheduled task lookup (PG-only syntax)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_pending_scheduled "
            "ON tasks (status, scheduled_at) "
            "WHERE status = 'pending' AND scheduled_at IS NOT NULL"
        )


def _init_db_sqlite(db: SqliteDatabase) -> None:
    """Create tables + indexes for SQLite."""
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
            result TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS logs (
            ts TEXT NOT NULL,
            message TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS account_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS account_authorizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            api_key TEXT NOT NULL UNIQUE,
            masked TEXT NOT NULL,
            created TEXT NOT NULL,
            rate_limited_at TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS error_events (
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
        )""",
        """CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL,
            last_login TEXT,
            login_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS verification_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'login',
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            action TEXT NOT NULL CHECK(action IN ('publish','ai_generate','account_add')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS publish_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('video','note')),
            snapshot TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
    ]
    index_statements = [
        "CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts)",
        "CREATE INDEX IF NOT EXISTS idx_logs_message ON logs (message)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks (created)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_ts ON error_events (ts)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_platform ON error_events (platform)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_account ON error_events (account)",
        "CREATE INDEX IF NOT EXISTS idx_error_events_exc_type ON error_events (exc_type)",
        "CREATE INDEX IF NOT EXISTS idx_auth_group_id ON account_authorizations (group_id)",
        "CREATE INDEX IF NOT EXISTS idx_verification_email ON verification_codes (email)",
        "CREATE INDEX IF NOT EXISTS idx_usage_user_action ON usage_logs (user_id, action, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_analytics ON tasks (platform, status, created)",
    ]
    alterations = [
        "ALTER TABLE tasks ADD COLUMN argv TEXT",
        "ALTER TABLE tasks ADD COLUMN result TEXT",
        "ALTER TABLE tasks ADD COLUMN publish_detail TEXT",
        "ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0",
        "ALTER TABLE tasks ADD COLUMN scheduled_at TIMESTAMP",
        "ALTER TABLE account_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE account_authorizations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN license_tier TEXT DEFAULT 'legacy'",
        "ALTER TABLE users ADD COLUMN license_key TEXT",
        "ALTER TABLE users ADD COLUMN license_activated_at TIMESTAMP",
        # SQLite ALTER TABLE has no IF NOT EXISTS pre-3.35; the
        # try/except OperationalError swallow in the loop below
        # (existing pattern from prior license_* columns) keeps these
        # idempotent on subsequent init_db() calls.
        "ALTER TABLE users ADD COLUMN name TEXT",
        "ALTER TABLE users ADD COLUMN avatar TEXT",
    ]
    with db._connect() as conn:  # noqa: SLF001 — internal init hook
        for stmt in statements + index_statements:
            conn.execute(stmt)
        for stmt in alterations:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass
        conn.commit()


# Back-compat: tests still import `DB_PATH` (legacy fixtures rebind it) so
# we keep the symbol exported. New code should not touch this directly —
# use `get_database()`.
def get_connection() -> sqlite3.Connection:
    """Back-compat shim: a raw sqlite3.Connection. New code should use
    `get_database().execute()` etc to stay dialect-agnostic.
    """
    return SqliteDatabase()._connect()


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
