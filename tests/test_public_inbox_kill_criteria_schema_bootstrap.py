"""
Locks the property that the script's verdict is byte-equivalent across the
pre-PR-A (no public-inbox tables in the DB) and post-PR-A (tables exist
but empty) boundary. The in-memory schema bootstrap in
``scripts/public_inbox_kill_criteria.py::_open_db`` is a deliberate
fallback; the per-metric statuses, sample_size, value, and overall
verdict must NOT differ when crossing the boundary — otherwise a
deployment that lands PR-A would silently flip the dashboard banner.

Background
----------
- Pre-PR-A: ``db/database.db`` has no ``guest_usage_logs`` or
  ``reward_events`` tables. ``_open_db`` falls back to an in-memory
  connection with the schema bootstrapped. All 4 wired metrics
  → INSUFFICIENT (sample_size=0); the 2 unwired metrics
  (``affiliate_ctr``, ``platform_failure_rate``, both flagged
  ``implemented=False`` in THRESHOLDS) → NOT_IMPLEMENTED.
- Post-PR-A: those tables exist but are empty. ``_open_db`` uses the
  real read-only connection. The query result is identical to the
  in-memory case because the queries filter on
  ``created_at >= (now - 30 days)`` (or 90 days for monthly_uv_avg),
  and 0 rows match regardless of which connection serves them.

This test enforces the byte-equivalence so any future change to
``_open_db``, ``_compute_metrics``, the THRESHOLDS table, or the
schema bootstrap will fail loudly here instead of silently
corrupting the dashboard banner.

Teardown
--------
The ``real_db_with_empty_tables`` fixture explicitly drops the test
tables AND runs ``PRAGMA wal_checkpoint(TRUNCATE)`` before pytest
removes the tmp_path. This mirrors the WAL gotcha documented in
``docs/dev/public-inbox-ops.md`` §6 Mode B — a plain ``rm`` of the
.db file without checkpointing can leave ghost data in ``-wal`` /
``-shm`` that bleeds into the next test that reuses the same
tmp_path.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

import public_inbox_kill_criteria as kc  # noqa: E402

# Schema DDL mirrors scripts/public_inbox_kill_criteria.py::_SCHEMA_BOOTSTRAP
# and (post-PR-A) web_runner/db.py::init_db(). Three-way lockstep rule
# (mirrors the runbook §6 Mode B "Three-way lockstep"): if you change
# one, change all three.
_SCHEMA_DDL = """
    CREATE TABLE guest_usage_logs (
        id INTEGER PRIMARY KEY,
        guest_uuid TEXT NOT NULL,
        ip TEXT,
        action TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE reward_events (
        id INTEGER PRIMARY KEY,
        guest_uuid TEXT NOT NULL,
        ip TEXT,
        event TEXT NOT NULL,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
    );
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
"""


# Expected per-metric status pattern for BOTH pre-PR-A and post-PR-A.
# Captured as a module-level constant so the test class can reference it
# without duplicating the assertion across tests.
_EXPECTED_PRE_POST_PR_A_STATUSES = {
    "reward_button_ctr": kc.STATUS_INSUFFICIENT,
    "reward_abandon_rate": kc.STATUS_INSUFFICIENT,
    "affiliate_ctr": kc.STATUS_NOT_IMPLEMENTED,
    "registration_conversion": kc.STATUS_INSUFFICIENT,
    "monthly_uv_avg": kc.STATUS_INSUFFICIENT,
    "platform_failure_rate": kc.STATUS_NOT_IMPLEMENTED,
}


def _statuses(metrics_block: dict) -> dict:
    """Reduce the metric block to ``{metric_name: status}`` for compact asserts."""
    return {name: v["status"] for name, v in metrics_block["metrics"].items()}


# ── Fixtures ─────────────────────────────────────────────────────




# ── Test isolation: clean public-inbox tables per-test ──────────────────


@pytest.fixture(autouse=True)
def _clean_kc_tables():
    """Wipe the public-inbox tables before AND after each test.

    Post-SQLite-removal: replaces the prior in-memory sqlite fixture.
    Tests use the production PG via ``get_database()`` and rely on
    per-test cleanup for isolation.
    """
    from web_runner.db import get_database
    db = get_database()
    for sql in (
        "DELETE FROM guest_usage_logs",
        "DELETE FROM reward_events",
        "DELETE FROM users",
    ):
        try:
            db.execute(sql)
        except Exception:
            pass
    yield
    for sql in (
        "DELETE FROM guest_usage_logs",
        "DELETE FROM reward_events",
        "DELETE FROM users",
    ):
        try:
            db.execute(sql)
        except Exception:
            pass


@pytest.fixture
def real_db_with_empty_tables(tmp_path) -> Path:
    """A tmp SQLite file with the public-inbox schema but zero rows.

    Simulates the post-PR-A state (tables exist, no data yet).

    Teardown: explicitly drops all tables AND runs
    ``PRAGMA wal_checkpoint(TRUNCATE)`` to flush the WAL so the test
    doesn't leave ghost data for the next test that reuses tmp_path.
    (See runbook §6 Mode B "WAL gotcha".)
    """
    db_path = tmp_path / "smoke.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(_SCHEMA_DDL)
    conn.commit()
    conn.close()
    yield db_path

    # Teardown: drop + WAL checkpoint (don't trust pytest tmp_path cleanup
    # alone — see WAL gotcha in docs/dev/public-inbox-ops.md §6 Mode B).
    teardown_conn = sqlite3.connect(db_path)
    try:
        for tbl in ("guest_usage_logs", "reward_events", "users"):
            teardown_conn.execute(f"DROP TABLE IF EXISTS {tbl}")
        teardown_conn.commit()
        teardown_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        teardown_conn.close()


@pytest.fixture
def absent_db_path(tmp_path) -> Path:
    """A path that does not point to any SQLite file.

    Simulates the pre-PR-A state (no DB file at all). ``_open_db``
    should fall through to the in-memory bootstrap path.
    """
    return tmp_path / "absent.db"


# ── Direct unit tests (fast, focused on _open_db + _compute_metrics) ─


class TestSchemaBootstrapByteEquivalence:
    """Lock the byte-equivalence of in-memory fallback vs real-DB-with-empty-tables."""

    def test_pre_pr_a_no_db_file_uses_in_memory_bootstrap(self, absent_db_path):
        """When the DB file does not exist, ``_open_db`` falls back to in-memory.

        Per-metric statuses follow the expected pattern (4 INSUFFICIENT + 2
        NOT_IMPLEMENTED). All sample_sizes are 0.
        """
        conn = kc._open_db(absent_db_path)
        try:
            result = kc._compute_metrics(conn)
        finally:
            conn.close()

        assert _statuses(result) == _EXPECTED_PRE_POST_PR_A_STATUSES
        for name, metric in result["metrics"].items():
            assert metric["sample_size"] == 0, f"{name}.sample_size != 0"

    def test_post_pr_a_empty_tables_uses_real_connection(self, real_db_with_empty_tables):
        """When the DB file exists with the public-inbox tables present, ``_open_db``
        uses the real read-only connection (does NOT fall back to in-memory).

        Per-metric statuses must match the expected pattern, and the
        connection must be the real file (not in-memory) — verified by
        checking that a row inserted via a separate connection is visible.
        """
        # Insert a sentinel row via a separate writer connection (WAL allows this).
        writer = sqlite3.connect(real_db_with_empty_tables)
        writer.execute(
            "INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at) "
            "VALUES (?, ?, ?, ?)",
            ("sentinel", "1.2.3.4", "download", "2020-01-01T00:00:00+00:00"),
        )
        writer.commit()
        writer.close()

        conn = kc._open_db(real_db_with_empty_tables)
        try:
            # If _open_db fell back to in-memory, the sentinel row would be invisible.
            # In-memory SQLite's row count is 0.
            sentinel_visible = conn.execute(
                "SELECT COUNT(*) FROM guest_usage_logs WHERE guest_uuid = 'sentinel'"
            ).fetchone()[0]
            result = kc._compute_metrics(conn)
        finally:
            conn.close()

        assert sentinel_visible == 1, (
            "_open_db fell back to in-memory when the real DB had the tables; "
            "sentinel row was NOT visible. Probe logic may be broken."
        )
        # The sentinel is dated 2020, so it's outside both the 30d and 90d
        # windows; sample_size should still be 0 for all metrics.
        assert _statuses(result) == _EXPECTED_PRE_POST_PR_A_STATUSES
        for name, metric in result["metrics"].items():
            assert metric["sample_size"] == 0, f"{name}.sample_size != 0"

    def test_byte_equivalence_pre_vs_post_verdict(self, absent_db_path, real_db_with_empty_tables):
        """The full verdict block (per-metric status + value + sample_size + cascade
        + banner) is byte-equivalent across the pre/post-PR-A boundary.
        """
        pre_conn = kc._open_db(absent_db_path)
        try:
            pre_metrics = kc._compute_metrics(pre_conn)
            pre_overall = kc._cascade_overall(pre_metrics["metrics"])
            pre_banner = kc._build_banner(pre_overall, pre_metrics["metrics"])
        finally:
            pre_conn.close()

        post_conn = kc._open_db(real_db_with_empty_tables)
        try:
            post_metrics = kc._compute_metrics(post_conn)
            post_overall = kc._cascade_overall(post_metrics["metrics"])
            post_banner = kc._build_banner(post_overall, post_metrics["metrics"])
        finally:
            post_conn.close()

        # Overall verdict + banner match
        assert pre_overall == post_overall == kc.VERDICT_INSUFFICIENT
        assert pre_banner == post_banner
        # Per-metric block is identical (status, value, sample_size, threshold,
        # operator, trigger_action).
        assert pre_metrics == post_metrics, (
            f"pre_metrics != post_metrics\n"
            f"pre:  {json.dumps(pre_metrics, sort_keys=True)}\n"
            f"post: {json.dumps(post_metrics, sort_keys=True)}"
        )

    def test_open_db_does_not_crash_on_empty_tables(self, real_db_with_empty_tables):
        """Regression: pre-fix ``_open_db`` would either fail with "no such table"
        or fall through to in-memory when the public-inbox tables were missing.
        Post-fix, it must handle both states (tables present or absent) without
        raising.
        """
        # Should not raise
        conn = kc._open_db(real_db_with_empty_tables)
        try:
            # And the connection should support the script's queries
            result = kc._compute_metrics(conn)
            assert "metrics" in result
            assert set(result["metrics"].keys()) == set(_EXPECTED_PRE_POST_PR_A_STATUSES.keys())
        finally:
            conn.close()


# ── End-to-end subprocess test (locks the byte-equivalence at the CLI boundary) ─


class TestSubprocessSchemaBootstrap:
    """End-to-end byte-equivalence via the actual CLI (``--db-path``)."""

    def test_subprocess_byte_equivalent_pre_vs_post(
        self, absent_db_path, real_db_with_empty_tables, tmp_path,
    ):
        """Run the script against both pre-PR-A and post-PR-A paths; the
        emitted verdict JSON (modulo ``snapshot_at``) must be byte-identical.
        """
        logs_dir = tmp_path / "logs"
        logs_dir.mkdir()

        script_path = _REPO_ROOT / "scripts" / "public_inbox_kill_criteria.py"

        def run_script(db_path: Path) -> dict:
            result = subprocess.run(
                [
                    sys.executable,
                    str(script_path),
                    "--db-path", str(db_path),
                    "--logs-dir", str(logs_dir),
                    "--no-webhook",
                ],
                capture_output=True, text=True, timeout=30,
            )
            assert result.returncode == 0, (
                f"script exited {result.returncode}\n"
                f"stdout: {result.stdout}\nstderr: {result.stderr}"
            )
            verdict_path = logs_dir / kc.OUT_FILE_NAME
            assert verdict_path.exists(), f"verdict JSON not written: {verdict_path}"
            return json.loads(verdict_path.read_text(encoding="utf-8"))

        pre = run_script(absent_db_path)
        post = run_script(real_db_with_empty_tables)

        # Drop snapshot_at (different per run); keep tool/version/banner/metrics
        # so the diff highlights any structural drift.
        pre.pop("snapshot_at", None)
        post.pop("snapshot_at", None)

        assert pre == post, (
            f"pre != post\n"
            f"pre:  {json.dumps(pre, sort_keys=True)}\n"
            f"post: {json.dumps(post, sort_keys=True)}"
        )
        assert pre["overall_verdict"] == kc.VERDICT_INSUFFICIENT
        assert post["overall_verdict"] == kc.VERDICT_INSUFFICIENT
        # Sanity: the banner text matches the "数据不足" hint the runbook §6
        # documents as the pre-PR-A banner shape.
        assert "数据不足" in pre["banner"]["text"]
        assert "数据不足" in post["banner"]["text"]
