"""Pytest conftest — PR2 Database abstraction + tmp-file SQLite.

High-level:
  * At conftest import time, force ``SAU_DB_DIALECT=sqlite`` so the new
    ``web_runner.db.get_database()`` factory resolves to ``SqliteDatabase``
    (the dev-fallback path). Any test that wants the Postgres backend can
    ``monkeypatch.setenv("SAU_DB_DIALECT", "postgres")``.
  * Session-scoped autouse fixture opens a real (temporary) SQLite file
    under ``tmp_path_factory`` and routes any ``sqlite3.connect(...)``
    call that targets the legacy ``DB_PATH`` (or the tmp file itself)
    through to that file. ``init_db()`` runs against the same file so
    production code's reads/writes round-trip normally.
  * Every connection opened via the route — including the anchor and
    any ``SqliteDatabase._connect()`` call from production code — gets
    ``PRAGMA journal_mode=WAL`` + ``PRAGMA busy_timeout=5000`` applied,
    matching the production SqliteDatabase knob setup. This is the
    safety net for the concurrent-write regression in
    ``tests/test_concurrent_writes.py``.
  * ``tests/test_db_wrapper.py`` covers the new abstraction directly
    (placeholder translation, json_dump/json_load, factory dialect
    selection, postgres backend ImportError surface).

Why tmp-file instead of ``file::memory:?cache=shared``?
-------------------------------------------------------
The earlier conftest used the shared-memory URI for cross-connection
persistence within the session. That works fine for readers/writers
that don't fan out concurrently — but under real concurrent-write
fan-out (8 worker-thread inserts landing near-simultaneously), the
shared-cache mode raised ``sqlalchemy.exc.OperationalError:
database table is locked`` (Python's text for SQLite's
``SQLITE_LOCKED``). ``PRAGMA busy_timeout`` only protects against
``SQLITE_BUSY`` (retryable); it does **not** protect against
``SQLITE_LOCKED`` (raised immediately on table-level contention in
shared-cache mode). Switching to a real tmp file restores standard
file-mode SQLite locking + WAL semantics, which are rock-solid for
the same fan-out: ``busy_timeout=5000`` lets contending writers wait
5 s, ``journal_mode=WAL`` allows concurrent readers with one writer,
and ``check_same_thread=False`` lets connections move between threads.
The full behavior is pinned by ``tests/test_concurrent_writes.py``.

The tmp file is created by pytest's ``tmp_path_factory`` so it is
auto-cleaned at session end; ``_ANCHOR_CONN`` is kept alive for the
session to make sure the file isn't vacuumed mid-test.
"""

from __future__ import annotations

import os

# Force the PR2 dialect-selection default for the entire test session.
# Production code still defaults to "postgres"; tests skip the Postgres
# branch by setting this explicitly (since psycopg may not be installed
# in the test env).
os.environ.setdefault("SAU_DB_DIALECT", "sqlite")

import sqlite3
from unittest.mock import patch

import numpy as np
import pytest

from web_runner import db as wr_db

# Hold a strong reference to the anchor connection. The tmp file may be
# reclaimed by the FS layer if no connection has it open; the anchor
# keeps it alive for the whole session and prevents that teardown.
_ANCHOR_CONN: sqlite3.Connection | None = None


@pytest.fixture(scope="session", autouse=True)
def real_test_sqlite_db(tmp_path_factory):
    """Session-scoped real tmp-file SQLite.

    Steps:
      1. Allocate a session-lifetime tmp directory + tmp DB file via
         pytest's ``tmp_path_factory`` (auto-cleaned at session end).
      2. Open the anchor connection on the tmp DB with the production
         SqliteDatabase PRAGMAs applied.
      3. Monkeypatch ``sqlite3.connect`` so any call against the
         default ``DB_PATH`` (or the tmp DB path itself) routes to the
         same file with ``journal_mode=WAL`` + ``busy_timeout=5000``
         applied — i.e. every test connection that comes through the
         route participates in the safety net on equal footing with
         the anchor.
      4. Run real ``init_db()`` to populate the schema.
      5. Yield the anchor connection so individual tests can introspect it.
    """
    global _ANCHOR_CONN
    tmp_dir = tmp_path_factory.mktemp("sau_test_db")
    tmp_db_path = tmp_dir / "sau_test.db"
    default_db_str = str(wr_db.DB_DIR / "database.db")
    tmp_db_str = str(tmp_db_path)

    # 1. Open the anchor connection that holds the tmp-file DB alive
    #    for the whole session AND applies the same WAL+busy_timeout
    #    safety net as production SqliteDatabase._connect(). The
    #    anchor participates in concurrent-write tests on equal
    #    footing with any routed test connection — otherwise it
    #    raised SQLITE_BUSY against any writer that routed through
    #    this fixture (``tests/test_concurrent_writes.py``).
    _ANCHOR_CONN = sqlite3.connect(tmp_db_str)
    _ANCHOR_CONN.execute("PRAGMA journal_mode=WAL")
    _ANCHOR_CONN.execute("PRAGMA busy_timeout=5000")
    _ANCHOR_CONN.execute("PRAGMA foreign_keys=ON")

    orig_connect = sqlite3.connect

    def _route_connect(database, *args, **kwargs):
        # Default DB path or our explicit tmp DB → route to the
        # session tmp file; the route also applies the safety PRAGMAs
        # so every test connection has the same WAL+busy_timeout
        # as production SqliteDatabase._connect().
        db_str = str(database) if database is not None else ""
        if db_str == default_db_str or db_str == tmp_db_str:
            conn = orig_connect(tmp_db_str, *args, **kwargs)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            return conn
        # Anything else (e.g. tmp-path overrides from test fixtures
        # that deliberately want a *separate* test DB) passes through
        # with whatever its caller passed.
        return orig_connect(database, *args, **kwargs)

    with patch("sqlite3.connect", side_effect=_route_connect):
        # 2-3. Route the init_db() call through our patched connect,
        # so the schema is created in the same tmp DB the rest of the
        # tests will read/write. (init_db() in PR2 is a no-op when
        # SAU_DB_DIALECT=postgres; conftest forces sqlite above, so
        # the SqliteDatabase branch runs.)
        wr_db.init_db()
        yield _ANCHOR_CONN
        # (no teardown — _ANCHOR_CONN holds the tmp-file alive)


@pytest.fixture
def db_dialect(request):
    """Per-test opt-in fixture for picking DB backend (per openspec §5.1).

    Currently only ``"sqlite"`` is supported (matches pre-PR2 behavior).
    Future PRs add ``"pg"`` integration tests; selection via:

        @pytest.mark.parametrize("db_dialect", ["sqlite", "pg"], indirect=True)
        def test_x(db_dialect): ...    # noqa: ERA001
    """
    return getattr(request, "param", "sqlite")


@pytest.fixture(scope="session", autouse=True)
def qr_zeros_array():
    """Session-wide shared BGR ndarray for QR-decoder test mocks (lifted
    from the prior function-scoped ``fake_qr_ndarray`` fixture in
    ``tests/test_login_qrcode.py``).

    Demonstrates the ``python-testing`` skill's
    ``@pytest.fixture(autouse=True)`` pattern at session scope —
    every test requests this fixture implicitly. The single
    ``np.zeros((10, 10, 3), dtype=np.uint8)`` allocation runs ONCE
    at session start instead of ONCE per test (8 tests in the current
    suite).

    Why scope="session" is safe here:
      * Pure computation: zero side effects, no monkeypatch, no I/O
        → no per-test teardown required.
      * The ndarray is read-only at call sites (returned from the
        ``cv2.imread`` mock, never mutated by tests). Reuse across
        tests cannot cause cross-test pollution.
      * Function-scoped ``mock_cv2`` (still in
        ``tests/test_login_qrcode.py``) consumes this session-scoped
        fixture via dependency injection; pytest caches the session
        instance, so every test in the session gets the SAME ndarray
        — even with the session→function scope nesting.

    Amortized vs. the prior function-scoped alternative:
    ``import numpy`` paid ONCE per session; ``np.zeros(10×10×3)``
    allocated ONCE per session vs. ONCE per test × 8 arrays.
    Per-test lookup after first invocation is dict-cache-hit (≈ 0 ns).
    """
    return np.zeros((10, 10, 3), dtype=np.uint8)
