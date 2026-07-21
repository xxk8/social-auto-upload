"""`GET /api/calendar/tasks` endpoint test.

Mirrors the contract coverage pattern in
``tests/test_publish_history.py`` (insert via production
``get_database()`` so the test stays focused on the read-side
reducer; avoid executor / subprocess machinery). Targets:

* Date-range filter (effective_date semantics)
* Platform CSV filter
* Account CSV filter
* Combined filters
* Summary aggregation (total / by_platform / by_status)
* Title extraction chain
* Effective_date pin (scheduled_at wins over created)
* Validation 400s (missing/malformed start/end)

Post-SQLite-removal: routes through the production psycopg
ConnectionPool via ``get_database()``; requires reachable
``DATABASE_URL`` (the session-scoped ``_init_pg_schema`` autouse
fixture in ``conftest.py`` migrates schema at pytest boot).
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from web_runner import create_app


@pytest.fixture
def app():
    """Flask test client with isolated cookies/uploads dirs.

    Mirrors the fixture in ``tests/test_publish_history.py``.
    """
    import web_runner.db as wr_db
    import web_runner.utils as wr_utils

    application = create_app()
    application.config["TESTING"] = True
    with tempfile.TemporaryDirectory() as tdp:
        tmp = Path(tdp)
        orig_cookies_dir = wr_utils.COOKIES_DIR
        orig_uploads_dir = wr_utils.UPLOADS_DIR
        wr_utils.COOKIES_DIR = tmp / "cookies"
        wr_utils.COOKIES_DIR.mkdir(exist_ok=True)
        wr_utils.UPLOADS_DIR = tmp / "uploads"
        wr_utils.UPLOADS_DIR.mkdir(exist_ok=True)
        wr_db.get_database().execute("DELETE FROM tasks")
        try:
            with application.test_client() as client:
                yield client
        finally:
            wr_utils.COOKIES_DIR = orig_cookies_dir
            wr_utils.UPLOADS_DIR = orig_uploads_dir
            wr_db.get_database().execute("DELETE FROM tasks")


def _insert_task(
    *,
    task_id: str,
    platform: str = "douyin",
    account: str = "operator",
    action: str = "upload-video",
    status: str = "success",
    created: str = "2026-07-04T14:30:00",
    argv: list[str] | None = None,
    scheduled_at: str | None = None,
) -> None:
    """Insert a task row with optional ``scheduled_at`` ISO timestamp.

    Uses direct ``get_database()`` writes (mirrors
    ``tests/test_publish_history.py::_insert_task``). ``scheduled_at``
    column was added via ``ALTER TABLE tasks ADD COLUMN IF NOT
    EXISTS scheduled_at TIMESTAMP`` (per ``web_runner/db.py``) — PG
    accepts an ISO string at the driver level, and the
    COALESCE(scheduled_at, created) filter in ``routes/calendar.py``
    handles the cast uniformly.
    """
    import web_runner.db as wr_db

    argv_payload = json.dumps(argv or [])
    db = wr_db.get_database()
    db.execute(
        "INSERT INTO tasks "
        "(task_id, status, platform, action, account, created, "
        " argv, scheduled_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?::timestamp)",
        (task_id, status, platform, action, account, created,
         argv_payload, scheduled_at),
    )


def _get_calendar(client, **params) -> dict:
    """GET /api/calendar/tasks with the given query params.

    Returns the inner ``data`` dict (``{tasks, summary}``) on 200.
    On 4xx, returns the raw ``get_json()`` body so the assertion
    catches the message field.
    """
    resp = client.get("/api/calendar/tasks", query_string=params)
    body = resp.get_json()
    if resp.status_code != 200:
        return {"_status": resp.status_code, "_body": body}
    assert body["success"] is True, body
    return body["data"]


# ============================================================================
#  validation
# ============================================================================


class TestCalendarValidation:
    def test_missing_start_returns_400(self, app):
        body = _get_calendar(app, end="2026-08-01")
        assert body["_status"] == 400
        assert "start" in body["_body"]["message"]

    def test_missing_end_returns_400(self, app):
        body = _get_calendar(app, start="2026-07-01")
        assert body["_status"] == 400
        assert "end" in body["_body"]["message"]

    def test_malformed_start_returns_400(self, app):
        body = _get_calendar(app, start="07-01-2026", end="2026-08-01")
        assert body["_status"] == 400

    def test_malformed_end_returns_400(self, app):
        body = _get_calendar(app, start="2026-07-01", end="2026/08/01")
        assert body["_status"] == 400

    def test_valid_query_returns_200_with_data_envelope(self, app):
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        assert "tasks" in body
        assert "summary" in body
        assert isinstance(body["tasks"], list)


# ============================================================================
#  date-range filter
# ============================================================================


class TestCalendarDateRange:
    def test_window_excludes_before(self, app):
        """Tasks with created < start are excluded."""
        _insert_task(task_id="before", created="2026-06-30T23:59:00")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        assert all(t["task_id"] != "before" for t in body["tasks"])

    def test_window_excludes_at_end(self, app):
        """End is exclusive — task with effective_date == end is NOT in set."""
        _insert_task(task_id="on-end", created="2026-08-01T00:00:00")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        assert all(t["task_id"] != "on-end" for t in body["tasks"])

    def test_window_includes_at_start(self, app):
        """Start is inclusive."""
        _insert_task(task_id="on-start", created="2026-07-01T00:00:00")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        ids = [t["task_id"] for t in body["tasks"]]
        assert "on-start" in ids

    def test_window_includes_middle(self, app):
        _insert_task(task_id="mid", created="2026-07-15T12:00:00")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        assert any(t["task_id"] == "mid" for t in body["tasks"])

    def test_empty_window_returns_empty_array(self, app):
        _insert_task(task_id="dec", created="2026-12-15T00:00:00")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        assert body["tasks"] == []
        assert body["summary"]["total"] == 0

    def test_paginated_windows_no_overlap(self, app):
        """Half-open semantics: paging July then August has no overlap."""
        _insert_task(task_id="july-end", created="2026-07-31T23:59:00")
        _insert_task(task_id="aug-start", created="2026-08-01T00:00:00")
        july = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        aug = _get_calendar(app, start="2026-08-01", end="2026-09-01")
        july_ids = {t["task_id"] for t in july["tasks"]}
        aug_ids = {t["task_id"] for t in aug["tasks"]}
        assert "july-end" in july_ids
        assert "july-end" not in aug_ids
        assert "aug-start" not in july_ids
        assert "aug-start" in aug_ids


# ============================================================================
#  effective_date pinning
# ============================================================================


class TestCalendarEffectiveDate:
    def test_scheduled_at_wins_over_created(self, app):
        """A task with ``scheduled_at`` later than ``created`` pins to scheduled_at."""
        _insert_task(
            task_id="sched",
            created="2026-07-01T10:00:00",
            scheduled_at="2026-07-20T14:00:00",
        )
        # Window covering ONLY the scheduled date — created is in
        # an earlier window, so the only way this row is matched is
        # via scheduled_at.
        body = _get_calendar(app, start="2026-07-15", end="2026-07-31")
        ids = [t["task_id"] for t in body["tasks"]]
        assert "sched" in ids
        assert ids[0] if ids else None  # noqa: B015 — guard against false-positive empty

    def test_unscheduled_pin_to_created(self, app):
        """Tasks without ``scheduled_at`` pin to ``created``."""
        _insert_task(task_id="oneshot", created="2026-07-04T14:30:00")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        oneshot = next((t for t in body["tasks"] if t["task_id"] == "oneshot"), None)
        assert oneshot is not None
        assert oneshot["effective_date"] == "2026-07-04"

    def test_scheduled_effective_date_uses_scheduled(self, app):
        _insert_task(
            task_id="sched2",
            created="2026-07-01T10:00:00",
            scheduled_at="2026-07-20T14:00:00",
        )
        body = _get_calendar(app, start="2026-07-15", end="2026-07-31")
        s2 = next(t for t in body["tasks"] if t["task_id"] == "sched2")
        assert s2["effective_date"] == "2026-07-20"


# ============================================================================
#  platform / account filters
# ============================================================================


class TestCalendarFilters:
    def test_platform_csv_filter(self, app):
        _insert_task(task_id="douyin-1", platform="douyin")
        _insert_task(task_id="bili-1", platform="bilibili")
        _insert_task(task_id="kuaishou-1", platform="kuaishou")
        body = _get_calendar(
            app, start="2026-07-01", end="2026-08-01",
            platform="douyin,bilibili",
        )
        ids = {t["task_id"] for t in body["tasks"]}
        assert "douyin-1" in ids
        assert "bili-1" in ids
        assert "kuaishou-1" not in ids

    def test_account_csv_filter(self, app):
        _insert_task(task_id="acc-a", account="work1")
        _insert_task(task_id="acc-b", account="work2")
        body = _get_calendar(
            app, start="2026-07-01", end="2026-08-01", account="work1",
        )
        ids = {t["task_id"] for t in body["tasks"]}
        assert "acc-a" in ids
        assert "acc-b" not in ids

    def test_combined_platform_and_account(self, app):
        _insert_task(task_id="combo-1", platform="douyin", account="work1")
        _insert_task(task_id="combo-2", platform="douyin", account="work2")
        _insert_task(task_id="combo-3", platform="bilibili", account="work1")
        body = _get_calendar(
            app, start="2026-07-01", end="2026-08-01",
            platform="douyin", account="work1",
        )
        ids = {t["task_id"] for t in body["tasks"]}
        assert "combo-1" in ids
        assert "combo-2" not in ids
        assert "combo-3" not in ids

    def test_empty_filter_string_means_no_filter(self, app):
        """``?platform=`` (empty) must NOT IN-match against ``('')
        single-row; treat as no filter."""
        _insert_task(task_id="all-1", platform="douyin")
        _insert_task(task_id="all-2", platform="bilibili")
        body = _get_calendar(
            app, start="2026-07-01", end="2026-08-01", platform="",
        )
        ids = {t["task_id"] for t in body["tasks"]}
        assert {"all-1", "all-2"}.issubset(ids)


# ============================================================================
#  summary aggregation
# ============================================================================


class TestCalendarSummary:
    def test_total_matches_tasks_length(self, app):
        for i in range(7):
            _insert_task(task_id=f"sum-{i:02d}")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        assert body["summary"]["total"] == len(body["tasks"]) == 7

    def test_by_platform_aggregation(self, app):
        _insert_task(task_id="d-1", platform="douyin")
        _insert_task(task_id="d-2", platform="douyin")
        _insert_task(task_id="b-1", platform="bilibili")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        s = body["summary"]
        assert s["by_platform"]["douyin"] == 2
        assert s["by_platform"]["bilibili"] == 1

    def test_by_status_aggregation(self, app):
        _insert_task(task_id="ok-1", status="success")
        _insert_task(task_id="ok-2", status="success")
        _insert_task(task_id="err-1", status="failed")
        _insert_task(task_id="pending-1", status="pending")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        s = body["summary"]
        assert s["by_status"]["success"] == 2
        assert s["by_status"]["failed"] == 1
        assert s["by_status"]["pending"] == 1

    def test_summary_after_filter_reflects_filtered_set(self, app):
        """Aggregation counts must reflect the FILTERED task set,
        not the unfiltered SQL — otherwise the dashboard summary is
        misleading on what the operator actually sees."""
        _insert_task(task_id="k-1", platform="kuaishou")
        _insert_task(task_id="d-1", platform="douyin")
        _insert_task(task_id="d-2", platform="douyin")
        body = _get_calendar(
            app, start="2026-07-01", end="2026-08-01", platform="douyin",
        )
        assert body["summary"]["total"] == 2
        assert body["summary"]["by_platform"] == {"douyin": 2}


# ============================================================================
#  title extraction chain
# ============================================================================


class TestCalendarTitle:
    def test_title_from_argv_dash_dash_title(self, app):
        _insert_task(
            task_id="vt-1",
            argv=["douyin", "upload-video", "--title", "周末探店", "--file", "/tmp/a.mp4"],
        )
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        t = next(t for t in body["tasks"] if t["task_id"] == "vt-1")
        assert t["title"] == "周末探店"

    def test_title_empty_when_no_argv(self, app):
        _insert_task(task_id="vt-2")
        body = _get_calendar(app, start="2026-07-01", end="2026-08-01")
        t = next(t for t in body["tasks"] if t["task_id"] == "vt-2")
        # No argv → empty title (frontend shows task_id as envelope)
        assert t["title"] == ""
