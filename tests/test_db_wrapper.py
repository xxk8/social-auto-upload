"""PR2 Database abstraction regression tests (openspec §2.7).

Covers:
  * `_translate_placeholders` regex correctness (openspec §2.5)
    - '?' outside string literals → '%s'
    - '?' inside single-quoted literals preserved
    - LIKE '?' literal not rewrote to LIKE '%s'
  * `SqliteDatabase` end-to-end on a tmp path
    - execute → fetch_one / fetch_all round-trip
    - last_insert_id() = cur.lastrowid
    - execute_many atomic batch
    - json_dump / json_load canonicalize
  * Factory branching:
    - SAU_DB_DIALECT=sqlite → SqliteDatabase
    - SAU_DB_DIALECT=postgres + psycopg missing → RuntimeError
  * PostgresDatabase hygiene:
    - `__init__` raises RuntimeError if psycopg not installed.

Note: `insert_returning_id` is exercised end-to-end by
`web_runner.utils._sync_cookie_files_to_db` (regression pinned there
implicitly); we don't add a standalone SQLite RETURNING test here
because that path depends on whether the host's libsqlite has
`RETURNING id` support (sqlite >= 3.35), which varies between Python
versions / dev environments. PR3 will add a proper multi-thread test.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from web_runner import db as wr_db
from web_runner.db import (
    PostgresDatabase,
    SqliteDatabase,
    _translate_placeholders,
)

# ── Placeholder translator (openspec §2.5) ───────────────────────────────


class TestPlaceholderTranslator:
    def test_single_placeholder(self) -> None:
        assert _translate_placeholders("SELECT * FROM t WHERE id = ?") == "SELECT * FROM t WHERE id = %s"

    def test_multiple_placeholders(self) -> None:
        assert _translate_placeholders("SELECT ?, '?' AS kept, ?") == "SELECT %s, '?' AS kept, %s"

    def test_like_literal_question_mark_preserved(self) -> None:
        # openspec §Risks warns LIKE '?' literal — current code has zero, but
        # make sure the regex doesn't rewrite a literal inside a string.
        sql = "SELECT * FROM t WHERE name LIKE '%foo?'"
        assert _translate_placeholders(sql) == sql

    def test_complex_sql_with_string_literal_and_placeholder(self) -> None:
        sql = "INSERT INTO t (x, y, z) VALUES ('?', ?, 'literal?')"
        assert _translate_placeholders(sql) == "INSERT INTO t (x, y, z) VALUES ('?', %s, 'literal?')"


# ── SqliteDatabase end-to-end ────────────────────────────────────────────


class TestSqliteDatabaseBackend:
    def test_basic_insert_select_roundtrip(self, tmp_path: Path) -> None:
        # Rebind DB_PATH to a tmp file so this test doesn't share state.
        wr_db.DB_PATH = tmp_path / "test.db"
        wr_db.reset_default_database()
        try:
            backend = wr_db.get_database()
            assert isinstance(backend, SqliteDatabase)
            backend.execute(
                "CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL)",
            )
            backend.execute("INSERT INTO kv (k, v) VALUES (?, ?)", ("alpha", 1))
            backend.execute("INSERT INTO kv (k, v) VALUES (?, ?)", ("beta", 2))

            row = backend.fetch_one("SELECT k, v FROM kv WHERE k = ?", ("alpha",))
            assert row == {"k": "alpha", "v": 1}

            rows = backend.fetch_all("SELECT k, v FROM kv ORDER BY v ASC")
            assert rows == [{"k": "alpha", "v": 1}, {"k": "beta", "v": 2}]
        finally:
            wr_db.DB_PATH = wr_db.DB_DIR / "database.db"
            wr_db.reset_default_database()

    def test_last_insert_id_reflects_last_insert(self, tmp_path: Path) -> None:
        wr_db.DB_PATH = tmp_path / "lid.db"
        wr_db.reset_default_database()
        try:
            backend = wr_db.get_database()
            backend.execute("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT)")
            backend.execute("INSERT INTO t (x) VALUES (?)", ("a",))
            assert backend.last_insert_id() == 1
            backend.execute("INSERT INTO t (x) VALUES (?)", ("b",))
            assert backend.last_insert_id() == 2
        finally:
            wr_db.DB_PATH = wr_db.DB_DIR / "database.db"
            wr_db.reset_default_database()

    def test_execute_many_atomically(self, tmp_path: Path) -> None:
        wr_db.DB_PATH = tmp_path / "batch.db"
        wr_db.reset_default_database()
        try:
            backend = wr_db.get_database()
            backend.execute("CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER NOT NULL)")
            backend.execute_many(
                "INSERT INTO t (k, v) VALUES (?, ?)",
                [(f"k{i}", i) for i in range(20)],
            )
            rows = backend.fetch_all("SELECT count(*) AS c FROM t")
            assert rows == [{"c": 20}]
        finally:
            wr_db.DB_PATH = wr_db.DB_DIR / "database.db"
            wr_db.reset_default_database()

    def test_json_dump_and_load_canonicalize_list(self) -> None:
        backend = SqliteDatabase()
        encoded = backend.json_dump(["a", "b", "c"])
        # Round-trip matters more than the byte-exact encoding: Python's
        # default json.dumps inserts `', '` between items. PR3 (jsonb)
        # will swap the encoding path entirely; here we pin the
        # round-trip contract only.
        assert backend.json_load(encoded) == ["a", "b", "c"]
        assert json.loads(encoded) == ["a", "b", "c"]

    def test_json_dump_returns_none_for_empty_inputs(self) -> None:
        backend = SqliteDatabase()
        for empty in (None, "", [], {}):
            assert backend.json_dump(empty) is None, f"empty input {empty!r} should serialize to None"

    def test_json_load_returns_none_for_empty_inputs(self) -> None:
        backend = SqliteDatabase()
        for empty in (None, "", "   "):
            assert backend.json_load(empty) is None, f"empty input {empty!r} should parse to None"

    def test_json_load_surfaces_malformed_as_raw(self) -> None:
        backend = SqliteDatabase()
        assert backend.json_load("[broken") == "[broken"


# ── Factory branching (env-driven) ──────────────────────────────────────


class TestGetDatabaseFactory:
    def test_sqlite_dialect_returns_sqlite_database(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.setenv("SAU_DB_DIALECT", "sqlite")
        monkeypatch.setenv("DATABASE_URL", "")  # even if leaked, ignored in sqlite
        wr_db.DB_PATH = tmp_path / "factory.db"
        wr_db.reset_default_database()
        try:
            db = wr_db.get_database()
            assert isinstance(db, SqliteDatabase)
        finally:
            wr_db.DB_PATH = wr_db.DB_DIR / "database.db"
            wr_db.reset_default_database()

    def test_postgres_dialect_raises_when_psycopg_missing(self, monkeypatch) -> None:
        # We can't currently install psycopg in CI; emulate "missing" by
        # setting a sentinel module path that's never satisfied.
        monkeypatch.setenv("SAU_DB_DIALECT", "postgres")
        monkeypatch.setenv("DATABASE_URL", "postgres://fake:fake@localhost:5432/fake")
        wr_db.reset_default_database()

        import importlib

        if importlib.util.find_spec("psycopg") is None and importlib.util.find_spec("psycopg_pool") is None:
            with pytest.raises(RuntimeError) as exc_info:
                wr_db.get_database()
            assert "psycopg" in str(exc_info.value).lower()
        else:
            pytest.skip("psycopg is installed; pytest skipped (cannot " "validate the missing-driver branch)")


# ── PostgresDatabase hygiene ─────────────────────────────────────────────


class TestPostgresDatabaseLazyImport:
    def test_init_raises_when_psycopg_missing(self) -> None:
        import importlib

        if importlib.util.find_spec("psycopg") is not None or importlib.util.find_spec("psycopg_pool") is not None:
            pytest.skip("psycopg is installed; missing-driver branch not exercisable")
        with pytest.raises(RuntimeError) as exc_info:
            PostgresDatabase("postgres://fake:fake@localhost:5432/fake")
        assert "psycopg" in str(exc_info.value).lower()


# ── PR3 psycopg → sqlite3 exception translation (unit pinning) ────────────


class TestPsycopgExceptionTranslation:
    """Pin the psycopg → sqlite3 exception translation map.

    Each test directly invokes ``_translate_psycopg_exception`` with a
    real psycopg exception instance and verifies the result is the
    expected sqlite3 class. The class is autouse-skipped entirely if
    psycopg isn't installed (the PG path is opt-in and CI doesn't gate
    on it). When skipped, ``tests/test_db_wrapper.py`` continues to
    exercise the SQLite path that ships in the dev/CI env.

    Pinning the map at unit level (rather than via end-to-end Postgres
    integration tests) keeps the test surface pure-pytest with no
    network deps, while still locking every translation that production
    routes depend on. The full PG-side wrap (``PostgresDatabase._conn``
    routing exceptions through this map) is exercised end-to-end when
    production routes/ai.py handles a duplicate-key insert on
    Postgres.

    Note: the wiring test below drives ``execute`` only — the other
    four public methods (``execute_many``, ``fetch_one``, ``fetch_all``,
    ``insert_returning_id``) share the identical ``with self._conn()``
    template, so cloning this test 5× would yield the same binary
    signal at 5× the maintenance cost. ``execute`` is the canonical
    pick because it's the highest-traffic call site. Resist the urge
    to extend the wiring test here unless the wrap template itself
    differs across methods.
    """

    @pytest.fixture(autouse=True)
    def _require_psycopg(self) -> None:
        pytest.importorskip("psycopg")

    def test_unique_violation_translates_to_sqlite_integrity_error(self) -> None:
        import psycopg.errors

        from web_runner.db import _translate_psycopg_exception

        translated = _translate_psycopg_exception(
            psycopg.errors.UniqueViolation("duplicate key value violates unique constraint " '"api_keys_api_key_key"')
        )
        assert isinstance(translated, sqlite3.IntegrityError)
        # Message is preserved end-to-end so route 409 responses can
        # surface the underlying constraint name.
        assert "duplicate key value" in str(translated)

    def test_fk_violation_translates_to_sqlite_integrity_error(self) -> None:
        import psycopg.errors

        from web_runner.db import _translate_psycopg_exception

        translated = _translate_psycopg_exception(psycopg.errors.ForeignKeyViolation("foreign key constraint violated"))
        assert isinstance(translated, sqlite3.IntegrityError)

    def test_operational_error_translates_to_sqlite_operational_error(self) -> None:
        import psycopg.errors

        from web_runner.db import _translate_psycopg_exception

        translated = _translate_psycopg_exception(psycopg.errors.OperationalError("server closed the connection"))
        assert isinstance(translated, sqlite3.OperationalError)

    def test_programming_error_translates_to_sqlite_programming_error(self) -> None:
        import psycopg.errors

        from web_runner.db import _translate_psycopg_exception

        translated = _translate_psycopg_exception(psycopg.errors.ProgrammingError("syntax error at or near"))
        assert isinstance(translated, sqlite3.ProgrammingError)

    def test_unmapped_exception_passes_through_unchanged(self) -> None:
        from web_runner.db import _translate_psycopg_exception

        # Identity pass-through preserves the original exception class
        # for things the map doesn't know about. This is the safe
        # default — callers can still catch their own exception types.
        original = ValueError("not in any DB exception map")
        translated = _translate_psycopg_exception(original)
        assert translated is original

    def test_postgres_execute_surfaces_integrity_error_via__conn(self) -> None:
        """End-to-end wiring pin: psycopg.UniqueViolation bubbling through
        ``PostgresDatabase.execute`` must surface as
        ``sqlite3.IntegrityError`` — proving ``_conn()`` actually wraps
        the public methods (not just the map being correct in
        isolation).

        Without this, a future refactor could remove ``_conn`` (or
        alias all 5 method call sites back to
        ``self._pool.connection()``) while the unit-level map tests
        still pass and production PK collisions silently stop
        surfacing to ``web_runner/routes/ai.py``. Builds the
        PostgresDatabase stub via ``__new__`` to bypass the real
        ``__init__`` (we want a ``MagicMock`` pool, not a real
        ``ConnectionPool``).
        """
        from unittest.mock import MagicMock

        import psycopg.errors

        fake_pool = MagicMock()
        fake_pool.connection.side_effect = psycopg.errors.UniqueViolation(
            "duplicate key value violates unique constraint"
        )
        db = PostgresDatabase.__new__(PostgresDatabase)
        db._pool = fake_pool
        db._lastrowid = 0
        with pytest.raises(sqlite3.IntegrityError) as exc_info:
            db.execute("SELECT 1", ())
        # The original psycopg exception is preserved via __cause__
        # so a debugger can see the full chain (`raise X from exc`).
        assert isinstance(exc_info.value.__cause__, psycopg.errors.UniqueViolation)


# ── PR2-final transaction() ctx-mgr (SqliteDatabase) ─────────────────────


class TestSqliteTransaction:
    """Pin the multi-statement commit/rollback contract on
    SqliteDatabase.transaction().

    These tests exercise every invariant the
    ``web_runner/routes/account_groups.py`` migration depends on.
    PostgresTransaction coverage is gated separately (see
    TestPostgresTransaction below, when psycopg is installed).
    """

    def _backend(self, tmp_path: Path):
        # Rebind DB_PATH to tmp + reset factory so each test starts cold.
        wr_db.DB_PATH = tmp_path / "tx_test.db"
        wr_db.reset_default_database()
        return wr_db.get_database()

    def test_commit_persists_all_statements(self, tmp_path: Path) -> None:
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
        with db.transaction() as tx:
            tx.execute("INSERT INTO kv (v) VALUES (?)", ("a",))
            tx.execute("INSERT INTO kv (v) VALUES (?)", ("b",))
            tx.execute("INSERT INTO kv (v) VALUES (?)", ("c",))
        rows = db.fetch_all("SELECT v FROM kv ORDER BY id ASC")
        assert [r["v"] for r in rows] == ["a", "b", "c"]

    def test_rollback_reverts_all_statements_on_exception(self, tmp_path: Path) -> None:
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL UNIQUE)")
        with pytest.raises(ValueError, match="caller-supplied"):
            with db.transaction() as tx:
                tx.execute("INSERT INTO kv (v) VALUES (?)", ("a",))
                # Caller-supplied exception inside the block — must roll
                # back the prior write.
                raise ValueError("caller-supplied")
        rows = db.fetch_all("SELECT count(*) AS c FROM kv")
        assert rows[0]["c"] == 0, "INSERT inside the tx block must roll back when the block raises"

    def test_fetch_inside_transaction_sees_uncommitted_write(self, tmp_path: Path) -> None:
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
        with db.transaction() as tx:
            tx.execute("INSERT INTO kv (v) VALUES (?)", ("a",))
            tx.execute("INSERT INTO kv (v) VALUES (?)", ("b",))
            # Read-after-write inside the same tx context — the legacy
            # ``conn.row_factory = sqlite3.Row`` dance is replaced by
            # the handle's per-call row_factory assignment.
            rows = tx.fetch_all("SELECT v FROM kv ORDER BY id ASC")
            assert [r["v"] for r in rows] == ["a", "b"]
        # After commit, post-block reads confirm the writes survived.
        rows = db.fetch_all("SELECT v FROM kv ORDER BY id ASC")
        assert [r["v"] for r in rows] == ["a", "b"]

    def test_duplicate_insert_within_tx_rolls_back_others(self, tmp_path: Path) -> None:
        """Pins the disk+DB rollback scenario from
        ``rename_account_group``: a mid-tx UNIQUE violation must
        revert the prior inserts in the same tx, leaving only the rows
        that existed before the block entered.
        """
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE groups_ (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)")
        db.execute("INSERT INTO groups_ (name) VALUES (?)", ("orig",))
        with pytest.raises(sqlite3.IntegrityError):
            with db.transaction() as tx:
                tx.execute("INSERT INTO groups_ (name) VALUES (?)", ("mid",))
                tx.execute("INSERT INTO groups_ (name) VALUES (?)", ("orig",))  # UNIQUE
                # Never reached:
                tx.execute("INSERT INTO groups_ (name) VALUES (?)", ("tail",))
        rows = db.fetch_all("SELECT name FROM groups_ ORDER BY id ASC")
        names = [r["name"] for r in rows]
        assert names == ["orig"], "Mid-tx UNIQUE violation must roll back to before-tx state"

    def test_insert_returning_id_works_inside_tx(self, tmp_path: Path) -> None:
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
        # Probe the host sqlite for RETURNING-id support (added in 3.35).
        # Older libsqlite instances raise the ``RuntimeError("did not
        # return id")`` guard from insert_returning_id; we treat that as
        # a version-skippable condition so the test stays meaningful
        # where the underlying libsqlite advertises the feature.
        try:
            probe_id = db.insert_returning_id("INSERT INTO kv (v) VALUES (?)", ("probe",))
        except RuntimeError as exc:
            if "did not return id" in str(exc):
                pytest.skip("host libsqlite < 3.35 — RETURNING id not supported")
            raise
        # The probe insert succeeded with a real id — clean it up
        # so the rest of the test starts from a known state. Note:
        # ``id INTEGER PRIMARY KEY`` (without AUTOINCREMENT) doesn't
        # create a ``sqlite_sequence`` row, so we don't (and can't)
        # reset it. The next 2 INSERTs after this cleanup will simply
        # land on rowids 2 and 3, which matches our asserts.
        db.execute("DELETE FROM kv WHERE id = ?", (probe_id,))
        with db.transaction() as tx:
            new_id = tx.insert_returning_id("INSERT INTO kv (v) VALUES (?)", ("a",))
            assert new_id == 1
            new_id_2 = tx.insert_returning_id("INSERT INTO kv (v) VALUES (?)", ("b",))
            assert new_id_2 == 2

    def test_execute_many_inside_tx_inserts_bulk(self, tmp_path: Path) -> None:
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v INTEGER NOT NULL)")
        with db.transaction() as tx:
            tx.execute_many(
                "INSERT INTO kv (v) VALUES (?)",
                [(i,) for i in range(20)],
            )
        rows = db.fetch_all("SELECT count(*) AS c FROM kv")
        assert rows[0]["c"] == 20

    def test_nested_via_transaction_call_is_savepoint(self, tmp_path: Path) -> None:
        """PR4 — ``tx.transaction()`` no longer raises; it returns a
        SAVEPOINT-backed nested ctx-mgr with an auto-generated name
        (``sp_<N>``). Verifies both clean-exit (RELEASE) and
        exception-exit (ROLLBACK TO + RELEASE) paths so a future
        refactor can't silently regress nested calls back to raising.
        """
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
        # (a) clean path: nested commits inner writes to outer tx.
        with db.transaction() as outer:
            outer.execute("INSERT INTO kv (v) VALUES (?)", ("outer_a",))
            with outer.transaction() as inner:  # was: RuntimeError in PR2-final.
                inner.execute("INSERT INTO kv (v) VALUES (?)", ("inner_a",))
            rows = outer.fetch_all("SELECT v FROM kv ORDER BY id ASC")
            assert [r["v"] for r in rows] == [
                "outer_a",
                "inner_a",
            ], "Inner savepoint writes must survive clean block exit (RELEASE)"
        rows = db.fetch_all("SELECT v FROM kv ORDER BY id ASC")
        assert [r["v"] for r in rows] == ["outer_a", "inner_a"], "Outer commit must persist the inner writes"
        # (b) exception path: inner rollback, exception propagates out
        # of outer, outer tx rolls back, NOTHING persisted. Pins the
        # SAVEPOINT-vs-TX-rollback distinction: SAVEPOINT restores
        # inner writes to savepoint state, but the raised exception
        # still propagates to the outer's wrapping ctx-mgr which rolls
        # back the entire outer tx on its __exit__.
        db.execute("DELETE FROM kv")
        with pytest.raises(ValueError, match="inner-raised"):
            with db.transaction() as outer:
                outer.execute("INSERT INTO kv (v) VALUES (?)", ("outer_b",))
                with outer.transaction() as inner:
                    inner.execute("INSERT INTO kv (v) VALUES (?)", ("inner_b",))
                    raise ValueError("inner-raised")
        rows = db.fetch_all("SELECT count(*) AS c FROM kv")
        assert rows[0]["c"] == 0, "Outer tx must roll back when inner savepoint re-raises"


# ── PR2-final PostgresTransactionHandle wiring pin ──────────────────────


# ── PR4 — SAVEPOINT-backed nested transactions on SqliteDatabase ────────────


class TestSqliteSavepoint:
    """PR4 — ``tx.savepoint(name)`` SAVEPOINT contract on the SQLite
    backend.

    Pins the SAVEPOINT-vs-TX-rollback distinction precisely: an inner
    savepoint rollback reverts inner writes while outer tx writes
    survive (when caller catches the inner exception); an inner
    exception that propagates to outer still rolls back everything.
    Also pins the SQL-injection guard for the identifier position so
    a regression that drops the regex check fails fast.

    Postgres-side coverage would mirror this class with PG-specific
    noisy SQL mocks (psycopg.UniqueViolation → sqlite3.IntegrityError
    preserve); deferred to a follow-up unless psycopg is in the test
    env, since the surface is already covered by
    ``TestPostgresTransactionHandle`` for the outer-tx wrap.
    """

    def _backend(self, tmp_path: Path):
        wr_db.DB_PATH = tmp_path / "sp_test.db"
        wr_db.reset_default_database()
        return wr_db.get_database()

    def test_savepoint_commit_persists_inner_writes(self, tmp_path: Path) -> None:
        """User-named savepoint, clean exit: inner writes commit to
        outer tx; outer commit persists everything.
        """
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
        with db.transaction() as outer:
            outer.execute("INSERT INTO kv (v) VALUES (?)", ("pre",))
            with outer.savepoint("phase_a"):
                outer.execute("INSERT INTO kv (v) VALUES (?)", ("in_a",))
            with outer.savepoint("phase_b"):
                outer.execute("INSERT INTO kv (v) VALUES (?)", ("in_b",))
            rows = outer.fetch_all("SELECT v FROM kv ORDER BY id ASC")
            assert [r["v"] for r in rows] == [
                "pre",
                "in_a",
                "in_b",
            ], "Outer reads inside-tx must see all savepoint-RELEASE'd writes"
        rows = db.fetch_all("SELECT v FROM kv ORDER BY id ASC")
        assert [r["v"] for r in rows] == [
            "pre",
            "in_a",
            "in_b",
        ], "Outer commit must persist inner writes from savepoint blocks"

    def test_savepoint_rollback_undoes_inner_only(self, tmp_path: Path) -> None:
        """Inside a try/except that swallows the inner exception,
        inner rollback reverts inner writes while outer's other
        writes survive. Pins the SAVEPOINT-vs-TX-rollback distinction
        precisely (caller catches inner exception → inner rolled back,
        outer continues; caller does not catch → outer rolls back too,
        which the prior test pins).
        """
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL UNIQUE)")
        db.execute("INSERT INTO kv (v) VALUES (?)", ("row0",))
        with db.transaction() as outer:
            outer.execute("INSERT INTO kv (v) VALUES (?)", ("o1",))
            try:
                with outer.savepoint("dup_attempt"):
                    outer.execute("INSERT INTO kv (v) VALUES (?)", ("o2",))
                    outer.execute("INSERT INTO kv (v) VALUES (?)", ("row0",))  # UNIQUE → rollback
            except sqlite3.IntegrityError:
                pass  # Inner rolled back; outer continues silently.
            rows = outer.fetch_all("SELECT v FROM kv ORDER BY id ASC")
            assert [r["v"] for r in rows] == ["row0", "o1"], (
                "Outer o1 must survive inner savepoint rollback when " "caller swallows the inner exception"
            )
        rows = db.fetch_all("SELECT v FROM kv ORDER BY id ASC")
        assert [r["v"] for r in rows] == ["row0", "o1"]

    def test_savepoint_nested_layered(self, tmp_path: Path) -> None:
        """Savepoint-within-savepoint: inner-most ROLLBACK TO reverts
        only its writes; mid-savepoint continues; outer's sibling
        writes are untouched. Pins that SAVEPOINTs stack (not
        flat-pile) and that nested rollback reverts only the deepest
        state.
        """
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
        with db.transaction() as outer:
            outer.execute("INSERT INTO kv (v) VALUES (?)", ("before",))
            with outer.savepoint("mid"):
                outer.execute("INSERT INTO kv (v) VALUES (?)", ("mid_pre",))
                try:
                    with outer.savepoint("leaf"):
                        outer.execute("INSERT INTO kv (v) VALUES (?)", ("leaf_in",))
                        raise ValueError("leaf-rollback")
                except ValueError:
                    pass
                # leaf rolled back; mid_pre survives; we're still in `mid`.
                rows = outer.fetch_all("SELECT v FROM kv ORDER BY id ASC")
                assert [r["v"] for r in rows] == ["before", "mid_pre"]
                outer.execute("INSERT INTO kv (v) VALUES (?)", ("mid_after",))
            rows = outer.fetch_all("SELECT v FROM kv ORDER BY id ASC")
            assert [r["v"] for r in rows] == ["before", "mid_pre", "mid_after"]
        rows = db.fetch_all("SELECT v FROM kv ORDER BY id ASC")
        assert [r["v"] for r in rows] == ["before", "mid_pre", "mid_after"]

    def test_savepoint_rejects_invalid_name(self, tmp_path: Path) -> None:
        """Identifier-position SQL-injection guard — names that don't
        match ``^[a-zA-Z_][a-zA-Z0-9_]*$``, are too long, empty, or
        hit a reserved keyword result in ``ValueError`` BEFORE any SQL
        touches the connection. Pin one representative tuple; deeper
        validation rules live in ``_validate_savepoint_name``.
        """
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY)")
        with db.transaction() as outer:
            for bad in (
                "",  # empty
                "1digit_first",  # starts with digit
                "with space",  # whitespace
                "with-dash",  # hyphen
                "drop;table",  # SQL injection vector
                "x" * 64,  # length cap (1 over PG 63-char limit)
                "savepoint",  # reserved (case-insensitive)
            ):
                # NOTE: @contextmanager defers body to __enter__, so we
                # MUST wrap in `with outer.savepoint(bad): pass` to
                # actually trigger the validation ValueError.
                with pytest.raises(ValueError, match=r"Savepoint name"):
                    with outer.savepoint(bad):
                        pass  # __enter__ raises; body never runs
            # At-cap boundary: 63-char name is at PG's NAMEDATALEN-1 hard
            # limit and must be ACCEPTED. Just verify validation passes;
            # the inner `pass` doesn't enter a SAVEPOINT (would require
            # an outer tx which we already have, so a real SAVEPOINT
            # roundtrip WOULD run — but we use `_x_at_cap` as a no-op
            # body anyway since SQLite supports up to 1k+ savepoints).
            with outer.savepoint("x" * 63):
                pass  # must NOT raise (boundary check)

    def test_savepoint_validation_does_not_leak_connection_state(self, tmp_path: Path) -> None:
        """A failed savepoint name validation (ValueError) must NOT
        leave the connection in an open-SAVEPOINT state. After the
        error, a fresh savepoint with a valid name must still work in
        the same outer tx — proves no savepoint was opened during
        validation rejection (the validate-then-interpolate ordering
        keeps the SAVEPOINT stack clean).
        """
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT)")
        with db.transaction() as outer:
            outer.execute("INSERT INTO kv (v) VALUES (?)", ("anchor",))
            with pytest.raises(ValueError):
                with outer.savepoint("drop;table"):
                    pass  # __enter__ raises ValueError; body never runs.
            with outer.savepoint("valid_after"):
                outer.execute("INSERT INTO kv (v) VALUES (?)", ("in_valid",))
        rows = db.fetch_all("SELECT v FROM kv ORDER BY id ASC")
        assert [r["v"] for r in rows] == ["anchor", "in_valid"]

    def test_savepoint_release_cleans_up_after_rollback(self, tmp_path: Path) -> None:
        """Post-rollback RELEASE cleanup must actually pop the
        savepoint from the stack — otherwise a second savepoint after
        a rollback would either stack indefinitely or hit "savepoint
        already exists" error. Verify by issuing a second savepoint
        after the rollback and confirming it succeeds; also verify
        none of the rolled-back writes remain.
        """
        db = self._backend(tmp_path)
        db.execute("CREATE TABLE kv (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
        with db.transaction() as outer:
            with pytest.raises(ValueError):
                with outer.savepoint("first"):
                    outer.execute("INSERT INTO kv (v) VALUES (?)", ("first_w",))
                    raise ValueError("boom")
            # Savepoint stack should be empty; second savepoint works.
            with outer.savepoint("second"):
                outer.execute("INSERT INTO kv (v) VALUES (?)", ("second_w",))
        rows = db.fetch_all("SELECT v FROM kv ORDER BY id ASC")
        assert [r["v"] for r in rows] == ["second_w"], (
            "Inner rollback must not leave rows; post-rollback RELEASE "
            "must pop savepoint so the second savepoint succeeds cleanly"
        )


# ── PR2-final PostgresTransactionHandle wiring pin ──────────────────────


class TestPostgresTransactionHandle:
    r"""End-to-end wiring pin for the Postgres backend inside a
    ``with db.transaction() as tx:`` block.

    Same pattern as ``test_postgres_execute_surfaces_integrity_error_via__conn``
    but drives through the bound handle connection (the path the
    ``routes/account_groups.py`` migration relies on). Without this
    pin, a future refactor could let the handle bypass ``_conn()\``'s
    psycopg→sqlite3 translation and silently regress PK collisions on
    the Postgres path inside multi-statement transactions.

    Skipped entirely if psycopg isn't installed (the PG path is
    opt-in and CI doesn't gate on it).
    """

    @pytest.fixture(autouse=True)
    def _require_psycopg(self) -> None:
        pytest.importorskip("psycopg")

    def test_handle_bound_conn_raises_translated_integrity_error(self) -> None:
        """A psycopg.UniqueViolation bubbling out of
        ``handle.execute`` (operating on the bound connection inside
        a ``with db.transaction()`` block) must surface as
        ``sqlite3.IntegrityError`` — proving the handle's bound
        connection is wrapped through the same translation path as
        the loose pool-borrow path.
        """
        import psycopg.errors

        # Fake psycopg connection that supports both the outer
        # ``with self._pool.connection() as raw_conn:`` and the inner
        # ``with raw_conn.transaction():`` context-manager surfaces,
        # AND raises UniqueViolation when ``handle.execute`` is invoked.
        class _InnerTxBlock:
            def __enter__(self_inner) -> _InnerTxBlock:
                return self_inner

            def __exit__(self_inner, *args) -> bool:
                return False

        class _FakeConn:
            def __enter__(self) -> _FakeConn:
                return self

            def __exit__(self, *args) -> bool:
                return False

            def transaction(self) -> _InnerTxBlock:
                return _InnerTxBlock()

            def execute(self, sql: str, params: tuple) -> None:
                raise psycopg.errors.UniqueViolation("duplicate key value violates unique constraint")

        from unittest.mock import MagicMock

        fake_pool = MagicMock()
        fake_pool.connection.return_value = _FakeConn()

        db = PostgresDatabase.__new__(PostgresDatabase)
        db._pool = fake_pool
        db._lastrowid = 0

        with pytest.raises(sqlite3.IntegrityError) as exc_info:
            with db.transaction() as tx:
                tx.execute("INSERT INTO x VALUES (1)", ())
        # The original psycopg exception is preserved via __cause__
        # through ``raise translated from exc`` — so a debugger can
        # still see the full Python type.
        assert isinstance(exc_info.value.__cause__, psycopg.errors.UniqueViolation)


# ── PR4-follow-up: SAU_DB_POOL_* env-var surface ──────────────────────────


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
        # Eliminate host-env pollution so each test starts at the
        # factory's documented defaults.
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

        This is the safety net that keeps PR3's psycopg→sqlite3
        exception translation + dict-by-name fetches working across
        backends after the operator discovers the env knob. Tested
        against three forbidden-key combinations (each individually +
        combined) to pin the gate behavior end-to-end.
        """
        from web_runner.db import PostgresDatabase

        for gate_attempt in (
            {"row_factory": "anything-but-dict_row"},
            {"autocommit": False},
            {"row_factory": "x", "autocommit": False},
            # Combined: one forbidden key + one valid key. Proves the
            # gate's set-intersection logic (`& _GATED_POOL_KWARG_NAMES`)
            # fires on dicts with cardinality > 1, not just on
            # single-key dicts. Without this case a regression that
            # accidentally narrows the gate to ``len(extra_kwargs) == 1``
            # would not be caught.
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
        """SAU_DB_POOL_KWARGS must parse to a JSON ``dict``. Reject
        ``null`` (parsed from the literal string ``"null"``), list,
        int, str \u2014 all of which ``json.loads`` would otherwise
        accept silently. The gate here protects against operator
        typos that would otherwise load a pool with no real kwargs.
        """
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
        """Empty string in any of the env vars (\"SAU_DB_POOL_MIN=\" etc.)
        must short-circuit to the documented default rather than
        crashing on ``int(\"\")`` / ``float(\"\")``. This is the path
        operators hit when iterating on env config in a shell.
        """
        from web_runner.db import _pool_kwargs_from_env

        monkeypatch.setenv("SAU_DB_POOL_MIN", "")
        monkeypatch.setenv("SAU_DB_POOL_MAX", "")
        monkeypatch.setenv("SAU_DB_POOL_TIMEOUT", "")
        monkeypatch.setenv("SAU_DB_POOL_KWARGS", "")
        min_size, max_size, timeout, kw = _pool_kwargs_from_env()
        assert (min_size, max_size, timeout) == (2, 15, 30.0)
        assert kw == {}

    def test_pool_gate_reports_specific_forbidden_keys(self) -> None:
        """Tighten the gate-error assertion: when a forbidden key sits
        in ``extra_kwargs`` alongside VALID keys, the gate's
        ``RuntimeError`` must list the specific forbidden key name
        (via ``sorted(forbidden)``) so an operator knows which key to
        drop without diffing against source.

        The for-loop test in
        :meth:`test_pool_user_cannot_override_row_factory_or_autocommit`
        only asserts the message *prefix* (enough to fire on every
        forbidden combination); this dedicated test pins the
        key-name *contents* in the message, closing the regression
        vector where set-intersection produces an empty ``forbidden``
        set silently even with a gating key in the dict.

        No monkeypatch needed: this test does not touch env. The gate
        fires *before* :meth:`PostgresDatabase.__init__` reaches the
        psycopg import, so no psycopg install is required.
        """
        from web_runner.db import PostgresDatabase

        with pytest.raises(
            RuntimeError,
            match=r"abstraction-gated pool keys.*row_factory",
        ):
            PostgresDatabase(
                "postgres://fake:fake@localhost:5432/test",
                extra_kwargs={"row_factory": "x", "application_name": "sau"},
            )
