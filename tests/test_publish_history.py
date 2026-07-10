"""`GET /api/publish/history` endpoint test (round-OPT-3G, post-SQLite-removal).

Mirrors the test fixtures in `tests/test_sau_web_upload.py` /
`tests/test_web_shell.py` so the operator AboutTab Timeline's backend
contract is locked in lockstep with the React frontend. Inserts tasks
directly via the production ``get_database()`` abstraction (rather
than going through `/api/upload/video`) so this test stays focused
on the read-side reducer + filter logic without bouncing through the
executor / subprocess machinery.

Post-SQLite-removal: the prior ``wr_db.DB_PATH`` rebind +
``sqlite3.connect``-based fixture is gone; tests now route through
the same production psycopg ConnectionPool every other test uses.
A reachable ``DATABASE_URL`` is required.
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

    Post-SQLite-removal: ``create_app()`` calls ``init_db()`` which
    expects a real PG via the host-env ``DATABASE_URL``. The fixture
    just isolates the cookies/uploads dirs and resets the tables
    relevant to this test; the schema is created once at session
    scope by ``tests/conftest.py`` (or by the production init_db
    boot path when running against a real PG).
    """
    import web_runner.db as wr_db
    import web_runner.utils as wr_utils

    application = create_app()
    application.config["TESTING"] = True
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        orig_cookies_dir = wr_utils.COOKIES_DIR
        orig_uploads_dir = wr_utils.UPLOADS_DIR
        wr_utils.COOKIES_DIR = tmp / "cookies"
        wr_utils.COOKIES_DIR.mkdir(exist_ok=True)
        wr_utils.UPLOADS_DIR = tmp / "uploads"
        wr_utils.UPLOADS_DIR.mkdir(exist_ok=True)
        # Reset just the tables this test touches.
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
    result: str | None = None,
    error: str | None = None,
) -> None:
    """Insert a task row directly via the production ``get_database()``
    abstraction.

    The ``argv`` column is stored as a JSON string (legacy schema) and
    ``db.json_dump`` is the identity passthrough on PG, so we
    pre-serialize via ``json.dumps`` and pass the string through.
    ``_parse_stored_argv`` on the route side collapses the JSON
    string back into a list[str].
    """
    import web_runner.db as wr_db

    argv_payload = json.dumps(argv or [])
    db = wr_db.get_database()
    db.execute(
        "INSERT INTO tasks "
        "(task_id, status, platform, action, account, created, "
        " argv, result, error) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            task_id,
            status,
            platform,
            action,
            account,
            created,
            argv_payload,
            result,
            error,
        ),
    )


def _get_history(app, limit: int | None = None) -> list[dict]:
    """GET /api/publish/history, returning the inner ``data`` array.

    Always forwards ``limit`` as a query string param INCLUDING FALSY
    VALUES (0 / negative). Skipping the param on falsy ``limit`` would
    silently fall back to the server default (20) and mask the
    floor-at-1 contract test; this helper sends ``?limit=0`` /
    ``?limit=-5`` through verbatim so the reducer's ``max(1, min(...))``
    clamp is what we actually measure.
    """
    if limit is None:
        resp = app.get("/api/publish/history")
    else:
        resp = app.get("/api/publish/history", query_string={"limit": limit})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["success"] is True, body
    assert isinstance(body["data"], list)
    return body["data"]


# ============================================================================
#  shape + filter contract
# ============================================================================


class TestPublishHistoryShape:
    def test_data_is_array(self, app):
        """Empty DB → empty array (NOT null / NOT undefined)."""
        assert _get_history(app) == []

    def test_response_envelope_matches_project_convention(self, app):
        """`{'success': True, 'data': ...}` matches `/api/tasks` and
        `/api/tasks/scheduled` envelope shape.
        """
        resp = app.get("/api/publish/history")
        body = resp.get_json()
        assert set(body.keys()) == {"success", "data"}
        assert body["success"] is True

    def test_filter_excludes_non_publish_actions(self, app):
        """Only `upload-video` + `upload-note` actions surface in the
        timeline. Login / cookie-validation tasks MUST NOT pollute
        the operator's 发布历史.
        """
        _insert_task(
            task_id="vid-1",
            action="upload-video",
            status="success",
        )
        _insert_task(
            task_id="note-1",
            action="upload-note",
            status="success",
            platform="xiaohongshu",
        )
        _insert_task(task_id="login-1", action="login", status="success")
        _insert_task(task_id="check-1", action="check", status="success")
        items = _get_history(app)
        ids = [it["id"] for it in items]
        assert "vid-1" in ids
        assert "note-1" in ids
        assert "login-1" not in ids
        assert "check-1" not in ids

    def test_order_is_newest_first(self, app):
        _insert_task(task_id="old-1", created="2026-01-01T00:00:00")
        _insert_task(task_id="new-1", created="2026-07-01T00:00:00")
        _insert_task(task_id="mid-1", created="2026-04-01T00:00:00")
        ids = [it["id"] for it in _get_history(app)]
        assert ids == ["new-1", "mid-1", "old-1"]


# ============================================================================
#  title extraction chain (--title → --file stem → placeholder)
# ============================================================================


class TestPublishHistoryTitle:
    def test_title_from_argv_title_flag(self, app):
        _insert_task(task_id="vk-1", argv=["douyin", "upload-video",
                                            "--title", "周末探店 Vlog",
                                            "--file", "/tmp/a.mp4"])
        items = _get_history(app)
        assert items[0]["title"] == "周末探店 Vlog"

    def test_title_falls_back_to_file_stem(self, app):
        """When `--title` is absent, the title source is the
        recognizable filename stem.
        """
        _insert_task(
            task_id="vk-2",
            argv=["douyin", "upload-video",
                  "--file", "/tmp/我的周末探店.mp4"],
        )
        items = _get_history(app)
        assert items[0]["title"] == "我的周末探店"

    def test_title_placeholder_when_no_title_or_file(self, app):
        """Last-resort: `<action>#<short task_id>`."""
        _insert_task(task_id="abcdef1234567", action="upload-note")
        items = _get_history(app)
        assert items[0]["title"] == "upload-note#234567"

    def test_trailing_title_flag_does_not_indexerror(self, app):
        """`--title` as the LAST argv element (no following value) is
        a known bug source. The 3-step chain must fall through silently.
        """
        _insert_task(task_id="vk-3", argv=["douyin", "upload-video", "--title"])
        items = _get_history(app)
        assert items[0]["title"] == "upload-video#vk-3"


# ============================================================================
#  URL extraction argv → result JSON fallback
# ============================================================================


class TestPublishHistoryUrl:
    def test_argv_url_flag_wins(self, app):
        """`--url` (older CLI flag) is preferred when both argv and
        result JSON supply a URL.
        """
        _insert_task(
            task_id="vid-url-1",
            argv=["tencent", "upload-video", "--title", "测试",
                  "--url", "https://example.com/argv"],
            result=json.dumps({"url": "https://example.com/result"}),
        )
        items = _get_history(app)
        assert items[0]["url"] == "https://example.com/argv"

    def test_url_from_result_json_when_argv_absent(self, app):
        """Modern path: `_store_result` writes
        `tasks.result` JSON from `[UPLOAD_RESULT]<json>` stdout line.
        """
        _insert_task(
            task_id="vid-url-2",
            argv=["bilibili", "upload-video", "--title", "测试"],
            result=json.dumps({"url": "https://www.bilibili.com/video/BV1xx"}),
        )
        items = _get_history(app)
        assert items[0]["url"] == "https://www.bilibili.com/video/BV1xx"

    def test_url_from_share_url_when_url_absent(self, app):
        _insert_task(
            task_id="vid-url-3",
            result=json.dumps({"share_url": "https://example.com/share"}),
        )
        items = _get_history(app)
        assert items[0]["url"] == "https://example.com/share"

    def test_url_null_when_no_source(self, app):
        """No `--url` argv and no `result` JSON → `url: null`."""
        _insert_task(task_id="vid-url-4", argv=["douyin", "upload-video"])
        items = _get_history(app)
        assert items[0]["url"] is None

    def test_url_null_for_malformed_result(self, app):
        """Malformed `result` blob (non-JSON) must NOT crash."""
        _insert_task(
            task_id="vid-url-5",
            result="not-json-{[",
        )
        items = _get_history(app)
        assert items[0]["url"] is None

    def test_url_null_for_non_dict_result(self, app):
        """`result` is a JSON array (not dict)."""
        _insert_task(
            task_id="vid-url-6",
            result=json.dumps(["https://example.com/array"]),
        )
        items = _get_history(app)
        assert items[0]["url"] is None


# ============================================================================
#  status lifecycle → Timeline 3-state mapping
# ============================================================================


class TestPublishHistoryStatus:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("success", "success"),
            ("failed", "failed"),
            ("error", "failed"),
            ("pending", "pending"),
            ("scheduled", "pending"),
            ("running", "pending"),
            ("cookie_valid", "success"),
            ("cookie_invalid", "failed"),
            ("unknown-drift", "pending"),
        ],
    )
    def test_status_mapping(self, app, raw, expected):
        _insert_task(task_id=f"status-{raw}", status=raw)
        items = _get_history(app)
        assert items[0]["status"] == expected


# ============================================================================
#  date format
# ============================================================================


class TestPublishHistoryDate:
    def test_date_rendered_in_mock_format(self, app):
        """ISO datetime → `YYYY-MM-DD HH:MM`."""
        _insert_task(task_id="d-1", created="2026-07-04T14:30:00")
        items = _get_history(app)
        assert items[0]["date"] == "2026-07-04 14:30"

    def test_date_empty_when_created_absent(self, app):
        """Edge: legacy rows that pre-date the `created` column."""
        _insert_task(task_id="d-2", created="legacy-no-timestamp")
        items = _get_history(app)
        # _format_timeline_date only does iso[:16] str slice; legacy
        # string passes through unchanged.
        assert items[0]["date"] == "legacy-no-timest"


# ============================================================================
#  description shape
# ============================================================================


class TestPublishHistoryDescription:
    def test_success_description_credits_account(self, app):
        _insert_task(task_id="desc-1", account="主号", status="success")
        items = _get_history(app)
        assert items[0]["description"] == "账号: 主号"

    def test_failed_description_includes_error_snippet(self, app):
        _insert_task(
            task_id="desc-2",
            account="主号",
            status="failed",
            error="Network timeout",
        )
        items = _get_history(app)
        assert "账号: 主号" in items[0]["description"]
        assert "Network timeout" in items[0]["description"]

    def test_pending_description_says_waiting(self, app):
        _insert_task(task_id="desc-3", account="主号", status="pending")
        items = _get_history(app)
        assert "账号: 主号" in items[0]["description"]
        assert "等待执行" in items[0]["description"]

    def test_description_empty_when_account_empty_and_status_pending(self, app):
        _insert_task(task_id="desc-4", account="", status="success")
        items = _get_history(app)
        assert items[0]["description"] == ""


# ============================================================================
#  limit param clamping
# ============================================================================


class TestPublishHistoryLimit:
    def test_default_limit_returns_all_when_below(self, app):
        for i in range(5):
            _insert_task(task_id=f"l-{i:02d}")
        assert len(_get_history(app)) == 5

    def test_explicit_limit(self, app):
        for i in range(10):
            _insert_task(task_id=f"l-{i:02d}")
        items = _get_history(app, limit=3)
        assert len(items) == 3

    def test_limit_clamped_to_max_100(self, app):
        """Stray `?limit=999999` could OOM the worker if uncapped."""
        for i in range(150):
            _insert_task(task_id=f"cap-{i:03d}")
        items = _get_history(app, limit=999_999)
        assert len(items) == 100

    def test_limit_floor_at_1_when_zero_or_negative(self, app):
        """`?limit=0` or `?limit=-5` should clamp UP to 1."""
        _insert_task(task_id="floor-1")
        _insert_task(task_id="floor-2")
        items = _get_history(app, limit=0)
        assert len(items) == 1
        items = _get_history(app, limit=-5)
        assert len(items) == 1
