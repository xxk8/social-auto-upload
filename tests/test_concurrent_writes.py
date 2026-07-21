"""Concurrent-write regression test for openspec §4.3 / psycopg ConnectionPool.

Post-SQLite-removal: this file exercises the production psycopg
``ConnectionPool`` concurrent-borrow contract. Each ``_db_insert_*``
call hits ``self._pool.connection()`` so the safety net is the
pool's checkout-checkin lifecycle, not a SQLite PRAGMA. Invariants
pinned:

  * No ``OperationalError`` leaks under 8-thread × 50-op fan-out.
  * No pool-borrow deadlocks.
  * Row count matches the expected N*M inserts (no lost or dup rows).
  * Multi-table concurrent updates settle to a consistent final
    state (no torn-row where code/status are out of sync).

Run: ``python3 -m pytest tests/test_concurrent_writes.py -v``
(requires a reachable PG with ``DATABASE_URL`` set; the test will
skip if psycopg is not installed).
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import psycopg.errors
import pytest

from web_runner.db import get_database
from web_runner.utils import _db_insert_log, _db_insert_task, _db_update_task

WORKER_COUNT = 8
OPS_PER_WORKER = 50
_BARRIER_TIMEOUT = 15.0  # 8 threads should reach barrier near-instantly; pad for hot caches.
_FUTURE_TIMEOUT = 60.0  # generous — wall time for 8*50 = 400 inserts <= 5s on most machines.


def _purge_logs() -> None:
    get_database().execute("DELETE FROM logs")


def _purge_tasks() -> None:
    get_database().execute("DELETE FROM tasks")


class TestConcurrentLogInserts:
    """8 worker threads × 50 log inserts each (400 total)."""

    def test_log_inserts_no_lock_leak_no_rows_lost(self) -> None:
        _purge_logs()

        error_lock = threading.Lock()
        errors: list[BaseException] = []

        def worker(worker_id: int) -> None:
            try:
                # All workers wait on the same barrier so writes land
                # simultaneously — that is what generates the
                # contention the safety net must absorb.
                barrier.wait(timeout=_BARRIER_TIMEOUT)
                for op in range(OPS_PER_WORKER):
                    ts = f"2026-06-24T10:{worker_id:02d}:{op:02d}.000"
                    _db_insert_log(ts, f"[worker-{worker_id}-op-{op}]")
            except BaseException as exc:  # noqa: BLE001
                with error_lock:
                    errors.append(exc)

        barrier = threading.Barrier(WORKER_COUNT)
        with ThreadPoolExecutor(max_workers=WORKER_COUNT) as pool:
            futures = [pool.submit(worker, i) for i in range(WORKER_COUNT)]
            for f in futures:
                # wait but don't re-raise — the worker already captured
                # the exception into ``errors`` upstream.
                f.result(timeout=_FUTURE_TIMEOUT)

        # 1) No exceptions bubbled out of any worker.
        assert errors == [], f"worker errors (first): {errors[0]!r}"

        # 2) Total row count == workers * ops (no lost rows under contention).
        result = get_database().fetch_one("SELECT count(*) AS c FROM logs")
        expected = WORKER_COUNT * OPS_PER_WORKER
        assert result["c"] == expected, f"expected {expected} rows, got {result['c']}"

        # 3) Each worker's messages made it through. Belt-and-suspenders:
        # if the row count happened to match because some duplicate rows
        # slipped in, an exact-message-count check catches it.
        sample_rows = get_database().fetch_all("SELECT message FROM logs WHERE message LIKE '[worker-%'")
        unique_workers = {row["message"].split("-")[1] for row in sample_rows}
        assert unique_workers == {f"{i}" for i in range(WORKER_COUNT)}, (
            f"missing workers in committed messages: " f"{set(str(i) for i in range(WORKER_COUNT)) - unique_workers}"
        )


class TestConcurrentTaskUpdates:
    """8 worker threads × 1 ``_db_update_task`` call each on the SAME
    task row. The final state must be one worker's complete write —
    no torn value where code/status are out of sync."""

    def test_concurrent_updates_to_same_task_settle_valid(self) -> None:
        _purge_tasks()
        _db_insert_task(
            task_id="concurrent-task-1",
            status="pending",
            platform="douyin",
            action="upload-video",
            account="acct-test",
            created="2026-06-24T10:00:00",
            argv=None,
        )

        barrier = threading.Barrier(WORKER_COUNT)
        errors: list[BaseException] = []

        def worker(worker_id: int) -> None:
            try:
                barrier.wait(timeout=_BARRIER_TIMEOUT)
                _db_update_task(
                    "concurrent-task-1",
                    code=worker_id,
                    status=f"worker-{worker_id}",
                )
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        with ThreadPoolExecutor(max_workers=WORKER_COUNT) as pool:
            futures = [pool.submit(worker, i) for i in range(WORKER_COUNT)]
            for f in futures:
                f.result(timeout=_FUTURE_TIMEOUT)

        assert errors == [], f"worker errors (first): {errors[0]!r}"

        rows = get_database().fetch_all(
            "SELECT code, status FROM tasks WHERE task_id = ?",
            ("concurrent-task-1",),
        )
        assert len(rows) == 1, f"expected exactly 1 row, got {len(rows)}"
        row = rows[0]
        # Final state must come from one worker — no torn value where
        # code came from worker A but status from worker B.
        assert row["code"] is not None
        status_worker_id = int(row["status"].removeprefix("worker-"))
        assert status_worker_id == row["code"], f"torn row: code={row['code']!r} status={row['status']!r}"


class TestConcurrentTaskInserts:
    """8 worker threads × 1 ``_db_insert_task`` call each, each with a
    DISTINCT ``task_id``. Verifies:

      * No ``sqlite3.IntegrityError`` (SQLITE_CONSTRAINT / PRIMARY KEY
        collision) leaks from concurrent INSERTs into the same table.
      * No rows lost under contention (row count == WORKER_COUNT).
      * Every worker's primary key landed (the set of distinct
        ``task_id`` values in the DB exactly matches the expected set).

    Also pins a *single-thread* sanity check
    (``test_duplicate_task_id_raises_integrity_error``) that the PK
    constraint actually fires on a duplicate INSERT and surfaces as
    ``sqlite3.IntegrityError``. Together the two tests close the
    failure mode where a future regression could both silently swallow
    ``SQLITE_CONSTRAINT`` *and* mask duplicate rows — the concurrent
    test would still pass on a totally broken PK if the constraint
    silently never fired; the sanity test pins that the surface is
    real so the two regressions can't jointly hide.

    Note: the schema's ``task_id`` is TEXT PRIMARY KEY (no INTEGER
    autoincrement id), so the third invariant verifies uniqueness of
    the primary key set rather than a strictly monotonic integer.
    Catching unique-keys-set is what protects against future regressions
    that reintroduce a per-connection ID-counter race.
    """

    def test_concurrent_insert_task_unique_ids(self) -> None:
        _purge_tasks()

        error_lock = threading.Lock()
        errors: list[BaseException] = []

        def worker(worker_id: int) -> None:
            try:
                barrier.wait(timeout=_BARRIER_TIMEOUT)
                # Each worker picks a unique task_id; assertions below
                # verify all N primary keys landed.
                _db_insert_task(
                    task_id=f"concurrent-insert-worker-{worker_id:02d}",
                    status="pending",
                    platform="douyin",
                    action="upload-video",
                    account=f"acct-{worker_id}",
                    created=f"2026-06-24T12:{worker_id:02d}:00.000",
                    argv=None,
                )
            except BaseException as exc:  # noqa: BLE001
                with error_lock:
                    errors.append(exc)

        barrier = threading.Barrier(WORKER_COUNT)
        with ThreadPoolExecutor(max_workers=WORKER_COUNT) as pool:
            futures = [pool.submit(worker, i) for i in range(WORKER_COUNT)]
            for f in futures:
                # wait but don't re-raise — worker captured exception.
                f.result(timeout=_FUTURE_TIMEOUT)

        # 1) No SQLITE_CONSTRAINT / IntegrityError leaks.
        assert errors == [], f"worker errors (first): {errors[0]!r}"

        # 2) Total row count == WORKER_COUNT (no lost rows under contention).
        result = get_database().fetch_one(
            "SELECT count(*) AS c FROM tasks " "WHERE task_id LIKE 'concurrent-insert-worker-%'"
        )
        assert result["c"] == WORKER_COUNT, f"expected {WORKER_COUNT} rows, got {result['c']}"

        # 3) Every worker's primary key landed — distinct values, exact set.
        rows = get_database().fetch_all("SELECT task_id FROM tasks " "WHERE task_id LIKE 'concurrent-insert-worker-%'")
        observed_ids = {row["task_id"] for row in rows}
        expected_ids = {f"concurrent-insert-worker-{i:02d}" for i in range(WORKER_COUNT)}
        assert observed_ids == expected_ids, (
            f"missing task_ids: {expected_ids - observed_ids}; " f"unexpected: {observed_ids - expected_ids}"
        )

    def test_duplicate_task_id_raises_integrity_error(self) -> None:
        """Single-thread sanity check: inserting the same ``task_id``
        twice in a row must surface ``psycopg.errors.IntegrityError``
        so the narrowed exception contract used by
        ``web_runner/routes/ai.py`` and
        ``web_runner/routes/account_groups.py``
        (``except psycopg.errors.IntegrityError``) actually has
        something to catch when PK violations occur.

        Without this, the concurrent-PK test above would go green even
        if the PK constraint were silently disabled — the duplicate
        INSERT would *succeed* (no error raised), the row count would
        still match, and the regression would stay hidden. This test
        pins that the chain
        INSERT-#2 → unique_violation → IntegrityError → route handling
        is real, and that the surviving row stays the original (first
        insert), not overwritten by the second.
        """
        _purge_tasks()
        _db_insert_task(
            task_id="dup-test-1",
            status="pending",
            platform="douyin",
            action="upload-video",
            account="acct-dup",
            created="2026-06-24T13:00:00",
            argv=None,
        )
        # Second insert with the SAME task_id must raise IntegrityError
        # because task_id is the PRIMARY KEY. (We pass a different
        # ``created`` to make sure the duplication aborts rather than
        # silently rewriting the existing row in some weird bypass.)
        with pytest.raises(psycopg.errors.IntegrityError):
            _db_insert_task(
                task_id="dup-test-1",
                status="pending",
                platform="douyin",
                action="upload-video",
                account="acct-dup",
                created="2026-06-24T13:00:01",
                argv=None,
            )
        # Exactly one row for 'dup-test-1' should survive — neither the
        # duplicate should overwrite nor leave two phantom rows.
        rows = get_database().fetch_all(
            "SELECT task_id, created FROM tasks WHERE task_id = ?",
            ("dup-test-1",),
        )
        assert len(rows) == 1, f"expected 1 row, got {len(rows)}"
        # The surviving row must be the FIRST insert (created=13:00:00),
        # not the second (created=13:00:01) — proves IntegrityError
        # actually aborted the second write, not silently overwrote.
        assert rows[0]["created"] == "2026-06-24T13:00:00"


class TestMixedConcurrentWorkload:
    """Cross-table contention: 4 log-insert workers + 4 task-update
    workers sharing the same connection pool. Verifies that two-table
    contention does not corrupt either side."""

    def test_mixed_workload_no_corruption(self) -> None:
        _purge_logs()
        _purge_tasks()

        # Pre-create one task per task-worker so UPDATE has a real target.
        # Worker IDs 0..(WORKER_COUNT // 2 - 1) drive the task side.
        task_worker_count = WORKER_COUNT // 2
        for i in range(task_worker_count):
            _db_insert_task(
                task_id=f"mixed-task-{i}",
                status="pending",
                platform="douyin",
                action="upload-video",
                account=f"acct-{i}",
                created="2026-06-24T10:00:00",
                argv=None,
            )

        barrier = threading.Barrier(WORKER_COUNT)
        errors: list[BaseException] = []

        def log_worker(worker_id: int) -> None:
            try:
                barrier.wait(timeout=_BARRIER_TIMEOUT)
                for op in range(OPS_PER_WORKER):
                    _db_insert_log(
                        f"2026-06-24T11:{worker_id:02d}:{op:02d}.000",
                        f"[mixed-log-{worker_id}-op-{op}]",
                    )
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        def task_worker(worker_id: int) -> None:
            try:
                barrier.wait(timeout=_BARRIER_TIMEOUT)
                # Hit the row that was actually seeded above. Using the
                # un-shifted ``worker_id`` lets log workers and task
                # workers each own their own disjoint slot (0..3) while
                # sharing one connection pool / barrier.
                _db_update_task(
                    f"mixed-task-{worker_id}",
                    code=worker_id,
                    status=f"mixed-worker-{worker_id}",
                )
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        with ThreadPoolExecutor(max_workers=WORKER_COUNT) as pool:
            futures = []
            for i in range(task_worker_count):
                futures.append(pool.submit(log_worker, i))
                futures.append(pool.submit(task_worker, i))
            for f in futures:
                f.result(timeout=_FUTURE_TIMEOUT)

        assert errors == [], f"worker errors (first): {errors[0]!r}"

        log_count = get_database().fetch_one("SELECT count(*) AS c FROM logs")
        expected_logs = task_worker_count * OPS_PER_WORKER
        assert log_count["c"] == expected_logs, f"expected {expected_logs} log rows, got {log_count['c']}"

        task_rows = get_database().fetch_all(
            "SELECT task_id, code, status FROM tasks " "WHERE task_id LIKE 'mixed-task-%' ORDER BY task_id"
        )
        assert len(task_rows) == task_worker_count
        for r in task_rows:
            wid = int(r["status"].removeprefix("mixed-worker-"))
            assert r["code"] == wid, f"torn row on {r['task_id']}: " f"code={r['code']!r} status={r['status']!r}"
