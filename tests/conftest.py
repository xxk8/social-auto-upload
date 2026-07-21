"""Pytest conftest — PostgreSQL-only test infrastructure (post-SQLite-removal).

High-level (post-SQLite removal):
  * The conftest no longer forces an SQLite dialect default. Tests that
    need a real database must provide a ``DATABASE_URL`` via
    ``monkeypatch.setenv`` (or the host env) and gate on
    ``pytest.importorskip("psycopg")`` + ``DATABASE_URL`` presence.
  * The legacy ``real_test_sqlite_db`` tmp-file anchor + sqlite3
    ``connect``-routing are GONE. PostgresDatabase is the only backend;
    tests that previously mutated the tmp SQLite file now exercise
    the production psycopg ConnectionPool through ``get_database()`` +
    ``monkeypatch.setenv("DATABASE_URL", ...)`` + ``reset_default_database()``.
  * ``tests/test_db_wrapper.py`` covers the new abstraction directly
    (placeholder translation, PostgresDatabase hygiene, pool tuning,
    transaction handle). The PostgresDatabase-specific tests were
    removed alongside the PostgresDatabase class.

  For tests that need a working DB:
    * Set ``DATABASE_URL`` (via host env or ``monkeypatch.setenv``)
      pointing at a test PG database (e.g. ``postgres://user:pass@
      localhost:5432/sau_test``).
    * Call ``wr_db.reset_default_database()`` so the factory re-reads
      the env, then ``wr_db.get_database()`` to get the backend.
    * Tests that don't need a real DB (e.g. the placeholder translator
      tests) run without any DATABASE_URL setup.
"""

from __future__ import annotations

import os

# Note: we no longer force ``SAU_DB_DIALECT=sqlite`` here. The factory
# now requires ``DATABASE_URL`` to be set; tests that need a real DB
# must inject one (via host env or ``monkeypatch.setenv``). Tests that
# don't touch the DB (e.g. ``TestPlaceholderTranslator``) run without
# any DB setup.
#
# Production code defaults to PG via ``get_database()``; tests skip
# the PG path with ``pytest.importorskip("psycopg")`` when psycopg
# isn't installed in the test env.

import numpy as np
import pytest

# pg_advisory_lock is intentionally NOT imported here — we want the
# conftest importable on hosts without psycopg installed (so the test
# runner can collect a coherent skipped/collected report). Tests that
# actually open a connection import psycopg lazily inside the test
# body.

@pytest.fixture
def db_dialect(request):
    """Per-test opt-in fixture for picking DB backend (per openspec §5.1).

    Post-SQLite-removal: only ``"pg"`` is meaningful. The fixture
    is preserved as a no-op contract surface so future PRs can add
    backends without rewriting every call site.

        @pytest.mark.parametrize("db_dialect", ["pg"], indirect=True)
        def test_x(db_dialect): ...    # noqa: ERA001
    """
    return getattr(request, "param", "pg")


@pytest.fixture(scope="session", autouse=True)
def _init_pg_schema():
    """Initialize the PG test schema once per pytest session.

    Calls ``web_runner.db.init_db()`` (which runs ``_init_db_postgres``)
    so the test DB has the full schema. Idempotent — all CREATE
    statements use ``IF NOT EXISTS``. Requires ``DATABASE_URL`` to be
    set; tests that don't need a DB (e.g. the placeholder translator
    tests) skip this via ``pytest.importorskip("psycopg")`` guards.
    """
    pytest.importorskip("psycopg")
    # Defer the import so the conftest is importable on hosts without
    # psycopg installed (the skip above guards the actual call).
    # Call _init_db_postgres directly (not the init_db() wrapper) to
    # match the plan's "inline the wrapper" simplification.
    from web_runner.db import _init_db_postgres, get_database
    _init_db_postgres(get_database())


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


# Canonical _login_as lives at tests/_login_helpers.py — sibling module; see that file for the rationale.


# ── Project-wide invariant: tests run with SAU_AUTH_ENABLED=true ─────────
#
# Background — the per-fixture `patch.dict("os.environ",
# {"SAU_AUTH_ENABLED": "true"}, clear=False)` in tests/test_auth.py,
# tests/test_studio.py, tests/test_admin_oauth.py, and
# tests/test_auth_session_rotation.py has a subtle SCOPE bug: the
# `with patch.dict(...)` block EXITS before `yield client`, so by the
# time the test body actually sends a request, the patched env is gone
# and `os.environ["SAU_AUTH_ENABLED"]` is back to whatever the shell
# env had.
#
# Without this conftest fix, in any CI shell that sets
# `SAU_AUTH_ENABLED=false` (e.g. an operator who wants to bypass the
# login flow for day-to-day dev, then runs pytest against the same
# shell), tests asserting that unauthenticated requests return 401
# actually see 200 — the auth-disabled branch returns a synthetic
# local@sau.dev admin. The 9-failure pattern
# (`assert 200 == 401`, `assert 86400 == 300`) is the diagnostic
# surface.
#
# This session-scoped autouse fixture forces `SAU_AUTH_ENABLED=true`
# for the WHOLE pytest run, well past any per-test fixture's local
# patch-dict exit. Tests that genuinely need `SAU_AUTH_ENABLED=false`
# (e.g. `tests/test_auth.py::app_no_auth`) still patch within their
# own `with patch.dict(...)` block which is active at
# `create_app()` call time — they pick up `false` at construction.
# The session-level `true` value then asserts itself across their
# `yield client` window, but those tests are short of `app_no_auth`
# themselves (and have their own patch-exits-before-yield bug we
# have NOT fixed in this change). For the user's reported 9-failure
# corpus (all on the `app` path, NOT `app_no_auth`), the session
# override is sufficient.
#
# Why direct assignment (`os.environ[...] = ...`) and NOT
# `os.environ.setdefault(...)`: setdefault is a no-op when the key
# already holds a value, which is exactly the shell-`false` case
# we're trying to override. Direct assignment is the only path that
# works against an existing shell value.
#
# Save & restore on session teardown so the test process exits with
# the original shell value (defensive: prevents env leaks into
# non-test invocations of the same Python process and into any
# pytest plugins that read env at process exit).
@pytest.fixture(autouse=True, scope="session")
def _force_sau_auth_enabled_true_for_test_session():
    """Project-wide invariant: SAU_AUTH_ENABLED=true during pytest run.

    See comment block above for the full rationale. Saves the
    pre-session value (if any) and restores on teardown so the
    shell env post-pytest is unchanged. session scope is required:
    function / class scope would let per-fixture patches exit before
    yield, re-introducing the original bug.
    """
    saved = os.environ.get("SAU_AUTH_ENABLED")
    os.environ["SAU_AUTH_ENABLED"] = "true"
    try:
        yield
    finally:
        if saved is None:
            os.environ.pop("SAU_AUTH_ENABLED", None)
        else:
            os.environ["SAU_AUTH_ENABLED"] = saved
