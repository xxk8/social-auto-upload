"""PostgreSQL Database abstraction regression tests (post-SQLite-removal).

Covers:
  * ``_translate_placeholders`` regex correctness — converts ``?`` outside
    string literals to ``%s`` for psycopg's positional-param syntax.
  * ``PostgresDatabase`` hygiene: ``__init__`` raises RuntimeError if
    psycopg is not installed.
  * ``PostgresTransactionHandle`` wiring pin: psycopg.UniqueViolation
    bubbling out of a bound-conn ``handle.execute`` surfaces as the
    raw psycopg exception (no translation layer in PG-only world).
  * ``_pool_kwargs_from_env`` operator-tuning + the
    ``_GATED_POOL_KWARG_NAMES`` denial gate.

Note: the prior ``TestPostgresDatabaseBackend``, ``TestSqliteTransaction``,
``TestSqliteSavepoint``, ``TestPsycopgExceptionTranslation`` classes
were removed alongside ``PostgresDatabase`` /
``_translate_psycopg_exception`` in the SQLite→PG cutover. PG-side
exception handling is the route's responsibility now (each route
catches ``psycopg.errors.IntegrityError`` directly).
"""

from __future__ import annotations

import pytest

from web_runner.db import (
    PostgresDatabase,
    _translate_placeholders,
)


# ── Placeholder translator ────────────────────────────────────────────────


class TestPlaceholderTranslator:
    """``?`` outside string literals → ``%s`` for psycopg."""

    def test_single_placeholder(self) -> None:
        assert _translate_placeholders("SELECT * FROM t WHERE id = ?") == "SELECT * FROM t WHERE id = %s"

    def test_multiple_placeholders(self) -> None:
        assert _translate_placeholders("SELECT ?, '?' AS kept, ?") == "SELECT %s, '?' AS kept, %s"

    def test_like_literal_question_mark_preserved(self) -> None:
        # Per the regex contract: LIKE '?' literals must NOT be
        # rewritten to LIKE '%s'.
        sql = "SELECT * FROM t WHERE name LIKE '%foo?'"
        assert _translate_placeholders(sql) == sql

    def test_complex_sql_with_string_literal_and_placeholder(self) -> None:
        sql = "INSERT INTO t (x, y, z) VALUES ('?', ?, 'literal?')"
        assert _translate_placeholders(sql) == "INSERT INTO t (x, y, z) VALUES ('?', %s, 'literal?')"


# ── PostgresDatabase hygiene ─────────────────────────────────────────────


class TestPostgresDatabaseLazyImport:
    def test_init_raises_when_psycopg_missing(self) -> None:
        import importlib

        if importlib.util.find_spec("psycopg") is not None or importlib.util.find_spec("psycopg_pool") is not None:
            pytest.skip("psycopg is installed; missing-driver branch not exercisable")
        with pytest.raises(RuntimeError) as exc_info:
            PostgresDatabase("postgres://fake:fake@localhost:5432/fake")
        assert "psycopg" in str(exc_info.value).lower()


# ── PostgresTransactionHandle wiring pin ─────────────────────────────────


class TestPostgresTransactionHandle:
    """End-to-end wiring pin for the Postgres backend.

    Drives a unique-violation through the bound-conn handle to verify
    psycopg.UniqueViolation bubbles out of ``handle.execute`` (no
    translation layer anymore — routes catch psycopg directly).

    Skipped entirely if psycopg isn't installed.
    """

    @pytest.fixture(autouse=True)
    def _require_psycopg(self) -> None:
        pytest.importorskip("psycopg")

    def test_handle_bound_conn_raises_psycopg_integrity_error(self) -> None:
        """After SQLite removal, psycopg's native exception class
        surfaces directly (no sqlite3-shaped rewrap). Routes must
        catch ``psycopg.errors.IntegrityError`` instead of the prior
        ``sqlite3.IntegrityError`` contract.
        """
        import psycopg.errors
        from unittest.mock import MagicMock

        # Fake psycopg connection that supports both the outer
        # ``with self._pool.connection() as raw_conn:`` and the inner
        # ``with raw_conn.transaction():`` context-manager surfaces,
        # AND raises UniqueViolation when ``handle.execute`` is invoked.
        class _InnerTxBlock:
            def __enter__(self_inner) -> "_InnerTxBlock":
                return self_inner

            def __exit__(self_inner, *args) -> bool:
                return False

        class _FakeConn:
            def __enter__(self) -> "_FakeConn":
                return self

            def __exit__(self, *args) -> bool:
                return False

            def transaction(self) -> _InnerTxBlock:
                return _InnerTxBlock()

            def execute(self, sql: str, params: tuple) -> None:
                raise psycopg.errors.UniqueViolation("duplicate key value violates unique constraint")

        fake_pool = MagicMock()
        fake_pool.connection.return_value = _FakeConn()

        db = PostgresDatabase.__new__(PostgresDatabase)
        db._pool = fake_pool
        db._lastid = 0

        # The exception now surfaces AS the psycopg class (no
        # sqlite3 rewrap). Routes must catch psycopg.errors.IntegrityError.
        with pytest.raises(psycopg.errors.IntegrityError) as exc_info:
            with db.transaction() as tx:
                tx.execute("INSERT INTO x VALUES (1)", ())
        assert "duplicate key value" in str(exc_info.value)


# ── SAU_DB_POOL_* env-var surface ─────────────────────────────────────────


class TestPostgresPoolTuning:
    """Pin ``_pool_kwargs_from_env`` + ``PostgresDatabase.__init__`` pool-knob
    surface for the operator env-tunable path.

    Strategy notes:

    * Tests use ``monkeypatch.setenv/delenv`` (function-scoped) so each
      test sees an independent env; the autouse ``_clear_pool_env``
      fixture wipes any host-env pollution so cases start from the
      documented defaults.
    * Only the env-parsing helper + the explicit-denial gate on
      ``PostgresDatabase.__init__`` are exercised here. The
      ``ConnectionPool(...)`` instantiation itself is NOT invoked (the
      real ``__init__`` would require psycopg + a reachable PG); gating
      that path is already covered by the autouse
      ``test_init_raises_when_psycopg_missing`` test in
      :class:`TestPostgresDatabaseLazyImport`.
    * Gated-kwargs denial tests intentionally don't import psycopg —
      the gate fires *before* the psycopg import (defensive ordering
      so the operator-facing error message is uniform whether psycopg
      is installed in the host env or not), which means the
      explicit-denial signal is reachable in any environment.
    """

    @pytest.fixture(autouse=True)
    def _clear_pool_env(self, monkeypatch) -> None:
        for var in (
            "SAU_DB_POOL_MIN",
            "SAU_DB_POOL_MAX",
            "SAU_DB_POOL_TIMEOUT",
            "SAU_DB_POOL_KWARGS",
        ):
            monkeypatch.delenv(var, raising=False)

    def test_pool_defaults_applied_when_env_unset(self) -> None:
        from web_runner.db import _pool_kwargs_from_env

        min_size, max_size, timeout, extra_kwargs = _pool_kwargs_from_env()
        assert min_size == 2
        assert max_size == 15
        assert timeout == 30.0
        assert extra_kwargs == {}

    def test_pool_min_max_overrides_via_env(self, monkeypatch) -> None:
        from web_runner.db import _pool_kwargs_from_env

        monkeypatch.setenv("SAU_DB_POOL_MIN", "4")
        monkeypatch.setenv("SAU_DB_POOL_MAX", "20")
        min_size, max_size, _, _ = _pool_kwargs_from_env()
        assert (min_size, max_size) == (4, 20)

    def test_pool_timeout_default_and_override(self, monkeypatch) -> None:
        from web_runner.db import _pool_kwargs_from_env

        _, _, t, _ = _pool_kwargs_from_env()
        assert t == 30.0
        monkeypatch.setenv("SAU_DB_POOL_TIMEOUT", "15.5")
        _, _, t2, _ = _pool_kwargs_from_env()
        assert t2 == 15.5

    def test_pool_max_must_be_gte_min(self, monkeypatch) -> None:
        from web_runner.db import _pool_kwargs_from_env

        monkeypatch.setenv("SAU_DB_POOL_MIN", "10")
        monkeypatch.setenv("SAU_DB_POOL_MAX", "4")
        with pytest.raises(RuntimeError, match=r"SAU_DB_POOL_MAX.*must be >=.*SAU_DB_POOL_MIN"):
            _pool_kwargs_from_env()

    def test_pool_min_max_must_be_positive(self, monkeypatch) -> None:
        from web_runner.db import _pool_kwargs_from_env

        monkeypatch.setenv("SAU_DB_POOL_MIN", "0")
        with pytest.raises(RuntimeError, match=r"must be > 0"):
            _pool_kwargs_from_env()
        monkeypatch.setenv("SAU_DB_POOL_MIN", "-3")
        with pytest.raises(RuntimeError, match=r"must be > 0"):
            _pool_kwargs_from_env()

    def test_pool_kwargs_json_merged_through(self, monkeypatch) -> None:
        from web_runner.db import _pool_kwargs_from_env

        monkeypatch.setenv(
            "SAU_DB_POOL_KWARGS",
            '{"application_name":"sau","connect_timeout":10}',
        )
        _, _, _, kw = _pool_kwargs_from_env()
        assert kw == {"application_name": "sau", "connect_timeout": 10}

    def test_pool_user_cannot_override_row_factory_or_autocommit(self, monkeypatch) -> None:
        """Explicit-denial gate: an operator who tries to clobber
        ``row_factory`` / ``autocommit`` via ``SAU_DB_POOL_KWARGS`` gets
        a ``RuntimeError`` rather than a silently-overridden
        abstraction contract.
        """
        for gate_attempt in (
            {"row_factory": "anything-but-dict_row"},
            {"autocommit": False},
            {"row_factory": "x", "autocommit": False},
            {"row_factory": "x", "application_name": "sau"},
        ):
            with pytest.raises(
                RuntimeError,
                match=r"cannot override abstraction-gated pool keys",
            ):
                PostgresDatabase(
                    "postgres://fake:fake@localhost:5432/test",
                    extra_kwargs=gate_attempt,
                )

    def test_pool_kwargs_must_be_dict(self, monkeypatch) -> None:
        from web_runner.db import _pool_kwargs_from_env

        for bad in ("null", "[]", "42", '"a string"'):
            monkeypatch.setenv("SAU_DB_POOL_KWARGS", bad)
            with pytest.raises(RuntimeError, match=r"must parse to a JSON dict"):
                _pool_kwargs_from_env()

    def test_pool_kwargs_malformed_raises_clear_error(self, monkeypatch) -> None:
        from web_runner.db import _pool_kwargs_from_env

        monkeypatch.setenv("SAU_DB_POOL_KWARGS", "{not-json")
        with pytest.raises(RuntimeError, match=r"is not valid JSON"):
            _pool_kwargs_from_env()

    def test_pool_empty_string_treated_as_unset(self, monkeypatch) -> None:
        from web_runner.db import _pool_kwargs_from_env

        monkeypatch.setenv("SAU_DB_POOL_MIN", "")
        monkeypatch.setenv("SAU_DB_POOL_MAX", "")
        monkeypatch.setenv("SAU_DB_POOL_TIMEOUT", "")
        monkeypatch.setenv("SAU_DB_POOL_KWARGS", "")
        min_size, max_size, timeout, kw = _pool_kwargs_from_env()
        assert (min_size, max_size, timeout) == (2, 15, 30.0)
        assert kw == {}

    def test_pool_gate_reports_specific_forbidden_keys(self) -> None:
        from web_runner.db import PostgresDatabase

        with pytest.raises(
            RuntimeError,
            match=r"abstraction-gated pool keys.*row_factory",
        ):
            PostgresDatabase(
                "postgres://fake:fake@localhost:5432/test",
                extra_kwargs={"row_factory": "x", "application_name": "sau"},
            )
