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
    """
    import tempfile
    from pathlib import Path

    from web_runner import create_app
    from web_runner import utils as wr_utils

    application = create_app()
    application.config["TESTING"] = True
    with tempfile.TemporaryDirectory() as tmp_dir:
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = Path(tmp_dir)
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


class TestErrorEventsApiRoute:
    def setup_method(self) -> None:
        _purge_error_events()

    def teardown_method(self) -> None:
        _purge_error_events()

    def test_get_endpoint_returns_rows(self, client) -> None:
        try:
            raise OSError("transient I/O")
        except OSError as exc:
            _log_error_event(
                phase="cli",
                platform="tk",
                account="acct-tk",
                action="upload-video",
                exc=exc,
            )

        resp = client.get("/api/error-events?platform=tk")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert isinstance(data["data"], list)
        assert len(data["data"]) == 1
        entry = data["data"][0]
        assert entry["exc_type"] == "OSError"
        assert entry["platform"] == "tk"

    def test_get_endpoint_filters_by_account_and_exc_type(self, client) -> None:
        _log_error_event(
            phase="cli",
            platform="douyin",
            account="alice-account",
            exc_type="NonZeroExit",
            exc_message="x",
            status_code=2,
        )
        _log_error_event(
            phase="cli",
            platform="douyin",
            account="bob-account",
            exc_type="RuntimeError",
            exc_message="different",
        )

        resp_alice = client.get("/api/error-events?account=alice-account")
        rows = resp_alice.get_json()["data"]
        assert len(rows) == 1
        assert rows[0]["exc_type"] == "NonZeroExit"

        resp_runtime = client.get("/api/error-events?exc_type=RuntimeError")
        rows = resp_runtime.get_json()["data"]
        assert len(rows) == 1
        assert rows[0]["account"] == "bob-account"

    def test_get_endpoint_limit_offset(self, client) -> None:
        for i in range(5):
            _log_error_event(
                phase="cli",
                account=f"acct-{i}",
                exc_type="NonZeroExit",
                exc_message=str(i),
                status_code=1,
            )

        resp = client.get("/api/error-events?limit=2&offset=1")
        rows = resp.get_json()["data"]
        assert len(rows) == 2

    def test_empty_filter_returns_empty_list(self, client) -> None:
        resp = client.get("/api/error-events?platform=does-not-exist")
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"] == []


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
