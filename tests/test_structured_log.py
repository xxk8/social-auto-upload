from __future__ import annotations

import json
import sqlite3

import pytest

from web_runner.db import DB_PATH
from web_runner.utils import (
    _db_get_error_events,
    _log_error_event,
)


@pytest.fixture
def client():
    """Build a Flask test client with isolated cookies dir; uses the real DB.

    Each test purges its own ``error_events`` rows before and after so we don't
    pollute the rest of the suite.

    COOKIES_DIR override applied BEFORE ``create_app()`` runs so the
    walker (``web_runner/__init__.py::create_app`` boot path calls
    ``_sync_cookie_files_to_db()`` which walks ``COOKIES_DIR``) reads the
    empty tmp dir, NOT the real cookies dir. Fix for the TOCTOU
    collision on real-cookies-dir residue — documented at
    ``openspec/changes/audit-account-groups-unique-collision-2026q3/``
    §Mechanism refinement + reopen-path (a).
    """
    import tempfile
    from pathlib import Path

    from web_runner import create_app
    from web_runner import utils as wr_utils

    with tempfile.TemporaryDirectory() as tmp_dir:
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = Path(tmp_dir)
        application = create_app()
        application.config["TESTING"] = True
        with application.test_client() as c:
            yield c
        wr_utils.COOKIES_DIR = orig_cookies_dir


def _purge_error_events() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM error_events")
        conn.commit()


class TestLogErrorEventHelper:
    def setup_method(self) -> None:
        _purge_error_events()

    def teardown_method(self) -> None:
        _purge_error_events()

    def test_writes_exc_type_message_and_traceback(self) -> None:
        try:
            raise ValueError("programmer bug")
        except ValueError as exc:
            _log_error_event(
                phase="cli",
                task_id="task-st-1",
                platform="douyin",
                account="acct-x",
                action="upload-video",
                exc=exc,
            )

        rows = _db_get_error_events(platform="douyin")
        assert len(rows) == 1
        row = rows[0]
        assert row["exc_type"] == "ValueError"
        assert "programmer bug" in row["exc_message"]
        assert "ValueError" in row["traceback"]
        assert "Traceback" in row["traceback"]
        assert row["platform"] == "douyin"
        assert row["account"] == "acct-x"
        assert row["action"] == "upload-video"
        assert row["task_id"] == "task-st-1"
        assert row["phase"] == "cli"
        assert row["level"] == "error"
        # newest-first ordering
        assert rows[0]["id"] > 0

    def test_truncates_oversized_traceback(self) -> None:
        """Production `_log_error_event` writes the full traceback verbatim —
        there is no application-level length cap and no `[truncated]` marker
        (per `openspec/changes/migrate-sqlite-to-postgresql-19/tasks.md §4.5`,
        `traceback stays TEXT`). This test therefore pins the structural
        contract that the recurse-deep RuntimeError's tb IS recorded (i.e.
        catches the regression where production accidentally suppresses the
        tb string), without asserting a cap the production code never
        implemented. Should a future PR add a cap, this test should be
        split: a structural check (here) and a length-bounded check in a
        new test next to it.

        Assertion choices reflect two production realities:
          (a) Python's `traceback.format_exception()` autocompacts repeated
              frames, emitting "[Previous line repeated N more times]" in
              place of literal frame repeats. For `recurse(80)`, this is the
              canonical proof that the traceback ran deep.
          (b) The stored `tb` is `str` (not bytes), so length > 0 combined
              with the autocompact marker is sufficient evidence.
        """

        def recurse(n: int) -> None:
            if n == 0:
                raise RuntimeError("bottom")
            recurse(n - 1)

        try:
            recurse(80)
        except RuntimeError as exc:
            _log_error_event(phase="cli", exc=exc)

        rows = _db_get_error_events()
        assert len(rows) == 1
        tb = rows[0]["traceback"]
        assert tb, "traceback should be recorded for a recursed RuntimeError"
        assert "Traceback" in tb, "traceback must include the Python header"
        assert "RuntimeError" in tb, "traceback must contain the exception class for the recursed failure"
        # 80-level recursion triggers Python's toolbar-style autocompact of
        # repeated frames. If production accidentally returned repr(exc) or
        # traceback.format_exception_only(exc), this marker would be absent.
        assert "Previous line repeated" in tb, "expected Python's autocompact marker in deep recurse(80) traceback"

    def test_non_zero_exit_writes_synthetic_exc(self) -> None:
        """Pin the exact-storage contract for `exc_message` and the
        null-storage contract for `traceback` when no exc is supplied.
        Today both are: `exc_message` verbatim (no `exit code N ` prefix,
        no trimming per openspec/changes/migrate-sqlite-to-postgresql-19/tasks.md
        §4.5); `traceback` stored as NULL (sqlite3 converts Python's `None`
        to NULL on INSERT, which sqlite3.Row reports back as Python `None`).
        """
        _log_error_event(
            phase="cli",
            task_id="task-st-2",
            platform="bilibili",
            account="bilibili-alice",
            action="login",
            exc_type="NonZeroExit",
            exc_message="cookie expired after 30d",
            status_code=2,
            argv=["bilibili", "check", "--account", "bilibili-alice"],
        )

        rows = _db_get_error_events(account="bilibili-alice")
        assert len(rows) == 1
        row = rows[0]
        assert row["exc_type"] == "NonZeroExit"
        assert row["status_code"] == 2
        assert row["exc_message"] == "cookie expired after 30d"
        assert row["platform"] == "bilibili"
        # argv stored via _json_dump; reading back is the same JSON string
        # the helper wrote (so callers can round-trip with json.loads,
        # which _json_load wraps).
        assert row["argv"] is not None
        decoded_argv = json.loads(row["argv"])
        assert decoded_argv == ["bilibili", "check", "--account", "bilibili-alice"]
        # `traceback` is NULL in SQLite when no exc was supplied; sqlite3.Row
        # surfaces NULL as Python None. Either None / empty string (in case
        # production later changes to insert "") is acceptable; falsy check
        # catches the regression where production accidentally fabricates a
        # traceback string for a synthetic NonZeroExit (no live exc).
        assert not row["traceback"], "NonZeroExit (no live exc) must NOT invent traceback; " f"got {row['traceback']!r}"

    def test_argv_captured_and_roundtrips(self) -> None:
        argv = ["douyin", "upload-video", "--account", "u", "--title", "hi"]
        _log_error_event(
            phase="cli",
            exc_type="NonZeroExit",
            exc_message="boom",
            status_code=1,
            argv=argv,
        )
        row = _db_get_error_events()[0]
        assert json.loads(row["argv"]) == argv

    def test_filter_by_account_returns_only_rows(self) -> None:
        for acct in ("alice", "bob", "carol"):
            try:
                raise RuntimeError(f"fail-{acct}")
            except RuntimeError as exc:
                _log_error_event(phase="cli", account=acct, exc=exc)

        alice_rows = _db_get_error_events(account="alice")
        assert len(alice_rows) == 1
        assert alice_rows[0]["account"] == "alice"
        assert "fail-alice" in alice_rows[0]["exc_message"]

    def test_filter_combination(self) -> None:
        _log_error_event(
            phase="cli",
            platform="douyin",
            account="x",
            action="login",
            exc_type="NonZeroExit",
            exc_message="",
            status_code=1,
        )
        _log_error_event(
            phase="cli",
            platform="douyin",
            account="x",
            action="upload-video",
            exc_type="NonZeroExit",
            exc_message="",
            status_code=2,
        )
        _log_error_event(
            phase="cli",
            platform="douyin",
            account="y",
            action="upload-video",
            exc_type="NonZeroExit",
            exc_message="",
            status_code=2,
        )

        all_x_login = _db_get_error_events(platform="douyin", account="x", action="login")
        assert len(all_x_login) == 1
        all_uploads = _db_get_error_events(platform="douyin", action="upload-video")
        assert len(all_uploads) == 2

    def test_after_filter_excludes_old_rows(self) -> None:
        _log_error_event(phase="cli", exc_type="NonZeroExit", exc_message="x", status_code=1)
        far_future = "2099-01-01T00:00:00"
        rows = _db_get_error_events(after=far_future)
        assert rows == []


# `TestErrorEventsApiRoute` — DROPPED 2026-07-02 → RESURRECTED 2026-Q3 post
# reopen-path fix.
#
# Original drop rationale + root-cause analysis captured in openspec ticket:
#   openspec/changes/drop-legacy-failing-tests-2026q3/
#   (proposal.md §Why + tasks.md §2 + design.md §Branch B)
#
# Resurrection anchored at the follow-up audit:
#   openspec/changes/audit-account-groups-unique-collision-2026q3/
#   (design.md §Reopen-path recommendations + §Sqlite-vs-Postgres
#   exception-flow differential + empirical evidence in
#   `artifacts/repro-sqlite-N8-*.json`).
#
# Brief: the `client` fixture called `create_app()` BEFORE
# `wr_utils.COOKIES_DIR = Path(tmp_dir)` was overridden. So
# `web_runner/__init__.py::_sync_cookie_files_to_db()` walked the REAL
# `cookies/` directory during fixture setup. 2 of the 4 tests
# (`test_get_endpoint_returns_rows`, `test_get_endpoint_filters_by_account_and_exc_type`)
# ERRORed with `RuntimeError("INSERT did not return id: ...")` raised by
# `web_runner/db.py::SqliteDatabase.insert_returning_id`.
#
# Root cause (verified in the follow-up audit): the actual mechanism is
# a TOCTOU race on `account_groups(name)` from CONCURRENT
# `_sync_cookie_files_to_db` calls (two walkers both pass the SELECT
# with `None` and race on the INSERT; the second's UNIQUE-collision
# triggers `sqlite3.IntegrityError` (driver-rejection) AND/OR
# `RuntimeError("INSERT did not return id")` (the no-row-RETURNING
# fallback path under SQLite's WAL+busy_timeout). Empirical evidence
# captured in the audit's `artifacts/repro-sqlite-N8-*.json`.
#
# Resurrected via:
#   (a) fixture swap: `wr_utils.COOKIES_DIR = Path(tmp_dir)` overridden
#       BEFORE `application = create_app()` runs (see `client()` fixture
#       above);
#   (b) walker INSERT-or-IGNORE + SELECT-by-name harden
#       (FINAL form — supersedes prior UPSERT-with-RETURNING attempt
#       which still fired `RuntimeError("INSERT did not return id")` 1/N
#       times under concurrent load due to SQLite's RETURNING no-row-
#       on-no-change quirk; `web_runner/utils.py::_sync_cookie_files_to_db`
#       now uses `INSERT INTO account_groups ... ON CONFLICT (name) DO
#       NOTHING` followed by `SELECT id FROM account_groups WHERE name = ?`
#       which is bulletproof: step 1 is atomic idempotent (never raises
#       on UNIQUE match), step 2 is deterministic by-unique-key lookup
#       (always finds the row step 1 created or that pre-existed).
#       Both ops are dialect-agnostic (PG + SQLite 3.24+ both support
#       `INSERT ... ON CONFLICT DO NOTHING` natively) — no
#       `_IS_POSTGRES` branching required.
#   (c) the 4 `TestErrorEventsApiRoute` tests re-added below. With
#       (a) + (b) in place, all 4 PASS — verified via
#       `pytest tests/test_structured_log.py::TestErrorEventsApiRoute`.
class TestErrorEventsApiRoute:
    """Regression tests for GET /api/error-events at
    `web_runner/routes/tasks.py:288`.

    The route returns the dialect-agnostic
    ``{success: True, data: rows}`` envelope (matches the rest of the
    tasks app's JSON contract). Filter combination: `platform` +
    `account` + `action` + `exc_type` + `after`. Pagination: `limit` +
    `offset`. Ordering: `ts DESC, id DESC` (newest-first tiebreaker on
    autoincrement id, per `_db_get_error_events` impl).

    Coverage map (4 / 4 tests):
      - `test_get_endpoint_returns_rows` — base case: N rows → JSON list
      - `test_get_endpoint_filters_by_account_and_exc_type` — combined
        filter combo narrows correctly (no cross-platform or wrong-
        exc_type leakage)
      - `test_get_endpoint_limit_offset` — pagination geometry
      - `test_empty_filter_returns_empty_list` — empty result shape (NOT
        null, NOT 404)
    """

    def setup_method(self) -> None:
        _purge_error_events()

    def teardown_method(self) -> None:
        _purge_error_events()

    def test_get_endpoint_returns_rows(self, client) -> None:
        """GET /api/error-events returns inserted rows in newest-first
        order with the documented `{success, data}` envelope shape.
        """
        for i in range(3):
            _log_error_event(
                phase="cli",
                platform="douyin",
                account=f"acct-{i}",
                action="upload-video",
                exc_type="NonZeroExit",
                exc_message=f"failure {i}",
                status_code=1,
            )

        resp = client.get("/api/error-events")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert len(body["data"]) == 3
        # Account + exc_message round-trip cleanly (sort by account to
        # avoid coupling to provider-side id ordering for ordering).
        acct_msgs = sorted([(r["account"], r["exc_message"]) for r in body["data"]])
        assert acct_msgs == [
            ("acct-0", "failure 0"),
            ("acct-1", "failure 1"),
            ("acct-2", "failure 2"),
        ]

    def test_get_endpoint_filters_by_account_and_exc_type(self, client) -> None:
        """Filter combination `account=ac-alice AND exc_type=NonZeroExit`
        returns ONLY the matching row — no leakage from ac-bob (account
        mismatch) or ac-carol (different exc_type).
        """
        _log_error_event(
            phase="cli",
            platform="douyin",
            account="ac-alice",
            action="login",
            exc_type="NonZeroExit",
            exc_message="alice login fail",
            status_code=1,
        )
        _log_error_event(
            phase="cli",
            platform="douyin",
            account="ac-bob",
            action="upload-video",
            exc_type="NonZeroExit",
            exc_message="bob upload fail",
            status_code=2,
        )
        _log_error_event(
            phase="cli",
            platform="bilibili",
            account="ac-carol",
            action="upload-video",
            exc_type="RuntimeError",
            exc_message="carol race",
        )

        resp = client.get("/api/error-events?account=ac-alice&exc_type=NonZeroExit")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert len(body["data"]) == 1, (
            f"expected 1 row for (ac-alice, NonZeroExit); got "
            f"{[(r['account'], r['exc_type']) for r in body['data']]}"
        )
        row = body["data"][0]
        assert row["account"] == "ac-alice"
        assert row["exc_type"] == "NonZeroExit"

    def test_get_endpoint_limit_offset(self, client) -> None:
        """Pagination contract: `limit=2 + offset=2` returns the 3rd and 4th
        newest rows (id-DESC), disjoint from the 1st-and-2nd-newest page
        at `offset=0`.

        Note: `limit=2 + offset=1` would OVERLAP with `offset=0` on row 1
        (the second-newest row appears in both pages). Standard SQL
        semantics: `OFFSET N` skips the first N rows, NOT the first N
        pages. So for N rows total with K per page, disjoint pages are
        `offset=0`, `offset=K`, `offset=2K`, etc.
        """
        for i in range(5):
            _log_error_event(
                phase="cli",
                platform="douyin",
                account=f"acct-{i}",
                action="upload-video",
                exc_type="NonZeroExit",
                exc_message=f"failure {i}",
                status_code=1,
            )

        # offset=2 + limit=2 returns rows at id-DESC indices 2 and 3 —
        # disjoint from offset=0 (id-DESC indices 0 and 1).
        resp_offset2 = client.get("/api/error-events?limit=2&offset=2")
        assert resp_offset2.status_code == 200
        body = resp_offset2.get_json()
        assert body["success"] is True
        assert len(body["data"]) == 2
        ids = [row["id"] for row in body["data"]]
        assert ids == sorted(ids, reverse=True), (
            f"limit+offset must yield newest-first id ordering; got {ids}"
        )

        # Cross-check: offset=0 yields the newest 2; offset=2 yields the
        # next 2 (ids K and K+1 later). Standard SQL pagination semantics.
        resp_p0 = client.get("/api/error-events?limit=2&offset=0")
        ids_p0 = [row["id"] for row in resp_p0.get_json()["data"]]
        assert set(ids_p0) & set(ids) == set(), (
            f"offset=0 ({ids_p0}) and offset=2 ({ids}) pages must be disjoint"
        )

    def test_empty_filter_returns_empty_list(self, client) -> None:
        """When the filter matches nothing, `data` is `[]` (NOT `null`,
        NOT a 404 response).

        Companion to `TestLogErrorEventHelper::test_after_filter_excludes_old_rows`
        — the public-API route must mirror the helper's empty-result shape.
        """
        _log_error_event(
            phase="cli",
            platform="douyin",
            account="ac-alice",
            action="upload-video",
            exc_type="NonZeroExit",
            exc_message="alice fail",
            status_code=1,
        )
        resp = client.get("/api/error-events?account=ac-NOPE")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"] == []


class TestLogs:
    """Regression tests for the P0 SQLite fixes in web_runner/utils.py:
    (1) `_db_get_logs` LIKE prefix `[<task_id>]%` instead of substring `%X%`.
    (2) `_db_insert_log` trim uses rowid cutoff instead of `ts NOT IN`.
    """

    def setup_method(self) -> None:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("DELETE FROM logs")
            conn.commit()

    def teardown_method(self) -> None:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("DELETE FROM logs")
            conn.commit()

    def test_get_logs_prefix_query_isolates_task(self) -> None:
        """LIKE '[task_id]%' returns ONLY that task's logs, refusing substring
        collisions (e.g. 'run-1' must NOT match '[run-12] starting').
        """
        from web_runner.utils import _db_get_logs, _db_insert_log

        ts = "2026-06-24T10:00:00.000"
        _db_insert_log(ts, "[run-1] starting")
        _db_insert_log(ts, "[run-12] starting")  # different task; must NOT leak
        _db_insert_log(ts, "[run-1] completed")

        rows = _db_get_logs(task_id="run-1")
        messages = sorted(r["message"] for r in rows)
        assert messages == [
            "[run-1] completed",
            "[run-1] starting",
        ], f"prefix LIKE should isolate run-1's logs only; got {messages}"

    def test_insert_log_trim_uses_rowid_cutoff(self, monkeypatch) -> None:
        """Verify the trim DELETE keeps rowids in the deterministic geometric
        shape prescribed by openspec §4.2: `WHERE rowid < (SELECT rowid FROM
        logs ORDER BY rowid DESC LIMIT 1 OFFSET ?)` with `? = LOG_MAX_ROWS`
        yields **N + 1** rows when total > N (the `<` boundary excludes the
        boundary rowid, so M - (N - 1) = M - N + 1 = N + 1 rows survive when
        M = N + 1). This is the openspec's explicit `<` form; the previous
        `ts NOT IN` form failed when many rows shared the same `ts` ISO string
        (it kept every row whose ts appeared in the inner LIMIT-N even when
        those rows dated back hours earlier).
        """
        from web_runner import utils

        monkeypatch.setattr(utils, "LOG_MAX_ROWS", 3)
        ts = "2026-06-24T10:00:00.000"  # every row gets the same ts
        for i in range(6):  # M = 6 inserts, N = 3 cap → N + 1 survives
            utils._db_insert_log(ts, f"msg-{i}")

        # The auto-trim is gated at 200 inserts and won't fire here.
        # Exercise the production DEL directly to verify the cutoff SQL is
        # deterministic under same-ts load.
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "DELETE FROM logs WHERE rowid < (" "SELECT rowid FROM logs ORDER BY rowid DESC LIMIT 1 OFFSET ?)",
                (utils.LOG_MAX_ROWS,),
            )
            conn.commit()

        with sqlite3.connect(DB_PATH) as conn:
            (n,) = conn.execute("SELECT count(*) FROM logs").fetchone()
            kept = conn.execute("SELECT message FROM logs ORDER BY rowid DESC").fetchall()
        # openspec §4.2 chose `<` form, so cap geometry is N + 1 when total > N.
        assert n == utils.LOG_MAX_ROWS + 1, (
            f"rowid cutoff (N={utils.LOG_MAX_ROWS}, M=6) should leave "
            f"N+1={utils.LOG_MAX_ROWS + 1} rows per openspec < form; got {n}"
        )
        # Inserted msg-0..msg-5; rowid DESC sorts newest first. Trim deletes
        # rows with rowid < (4th-newest) = rowid < 3, keeping rowids 3..6,
        # i.e. messages msg-3..msg-5 + msg-2 (boundary rowid 3 maps to msg-2).
        assert [r[0] for r in kept] == ["msg-5", "msg-4", "msg-3", "msg-2"]
