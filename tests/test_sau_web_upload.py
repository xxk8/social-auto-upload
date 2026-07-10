from __future__ import annotations

import base64
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

import web_runner.db as wr_db
import web_runner.utils as wr_utils
from web_runner import create_app


@pytest.fixture(autouse=True)
def _clean_tasks():
    """Wipe the tasks table before AND after each test for isolation.

    Autouse so every test starts (and ends) with a clean state. Matches
    the test_studio.py::``_clean_tables`` pattern post-SQLite-removal.
    """
    try:
        wr_db.get_database().execute("DELETE FROM tasks")
    except Exception:
        # Schema not bootstrapped yet; the conftest's _init_pg_schema
        # session fixture runs first, but guard against the race.
        pass
    yield
    try:
        wr_db.get_database().execute("DELETE FROM tasks")
    except Exception:
        pass


@pytest.fixture
def app():
    """Flask test client with isolated cookies/uploads dirs.

    Post-SQLite-removal: no per-test temp DB. Uses the production
    ``get_database()`` against the test PG (``$DATABASE_URL``) and
    relies on the autouse ``_clean_tasks`` fixture for isolation.
    """
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

        try:
            with application.test_client() as client:
                yield client
        finally:
            wr_utils.COOKIES_DIR = orig_cookies_dir
            wr_utils.UPLOADS_DIR = orig_uploads_dir


def _data_uri_png() -> str:
    """Minimal 1x1 red PNG as data URI for testing — padded to exceed MIN_UPLOAD_BYTES."""
    raw = (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
        b"\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
        b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    raw = raw + b"\x00" * 10240
    return f"data:image/png;base64,{base64.b64encode(raw).decode()}"


def _read_task_argv(task_id: str) -> list[str]:
    """Read the stored argv for a task from the production PG.

    Uses ``get_database()`` (PG-only) with ``?`` placeholders — the
    production ``fetch_one`` internally translates them to ``%s``
    for psycopg via ``_translate_placeholders``.
    """
    row = wr_db.get_database().fetch_one(
        "SELECT argv FROM tasks WHERE task_id = ?", (task_id,)
    )
    assert row is not None, f"task not found: {task_id}"
    return json.loads(row["argv"])


def _read_task_status(task_id: str) -> str:
    """Read the stored status for a task from the production PG."""
    row = wr_db.get_database().fetch_one(
        "SELECT status FROM tasks WHERE task_id = ?", (task_id,)
    )
    assert row is not None, f"task not found: {task_id}"
    return row["status"]


def _post_upload(app, **fields) -> tuple[dict, list[str]]:
    """Submit a video upload, patch _run_sau, return (json_data, argv_list)."""
    with (
        patch("web_runner.utils._run_sau"),
        patch("web_runner.utils.task_executor.submit"),
        patch("web_runner.utils.MIN_UPLOAD_BYTES", 0),
    ):
        # Always include file_data unless 'file' is explicitly set
        if "file_data" not in fields and "file" not in fields:
            fields["file_data"] = _data_uri_png()

        resp = app.post("/api/upload/video", data=fields)
        data = resp.get_json()
        assert data["success"] is True, f"upload failed: {data}"
        task_id = data["data"]["task_id"]
        argv = _read_task_argv(task_id)
        return data, argv


# ===========================================================================
#  BILIBILI  —  --desc always, NO --headless, --tid default=233
# ===========================================================================


class TestBilibiliUploadVideo:
    def test_desc_always_passed(self, app):
        """Bilibili requires --desc; even empty string must be passed."""
        _, argv = _post_upload(
            app,
            platform="bilibili",
            account="up",
            title="B站视频",
            desc="",
        )
        assert "bilibili" == argv[0]
        assert "upload-video" == argv[1]
        assert "--desc" in argv
        desc_idx = argv.index("--desc")
        assert argv[desc_idx + 1] == ""  # empty string passed

    def test_headless_not_passed(self, app):
        """Bilibili upload-video uses biliup CLI, not a browser; --headless must NOT appear."""
        _, argv = _post_upload(
            app,
            platform="bilibili",
            account="up",
            title="B站视频",
            headless="true",
        )
        assert "--headless" not in argv
        assert "--headed" not in argv

    def test_tid_default_233(self, app):
        """When tid is not provided, default to 233."""
        _, argv = _post_upload(
            app,
            platform="bilibili",
            account="up",
            title="B站视频",
            desc="desc",
        )
        assert "--tid" in argv
        tid_idx = argv.index("--tid")
        assert argv[tid_idx + 1] == "233"

    def test_tid_explicit(self, app):
        _, argv = _post_upload(
            app,
            platform="bilibili",
            account="up",
            title="B站视频",
            desc="desc",
            tid="17",
        )
        tid_idx = argv.index("--tid")
        assert argv[tid_idx + 1] == "17"

    def test_basic_with_tags_and_explicit_tid(self, app):
        _, argv = _post_upload(
            app,
            platform="bilibili",
            account="up",
            title="B站视频标题",
            desc="详细描述",
            tags="tag1,tag2",
            tid="171",
        )
        assert "--account" in argv and "up" in argv
        assert "--title" in argv and "B站视频标题" in argv
        assert "--desc" in argv and "详细描述" in argv
        assert "--tags" in argv and "tag1,tag2" in argv
        assert "--tid" in argv and "171" in argv
        assert "--headless" not in argv

    def test_schedule_status(self, app):
        """Scheduled bilibili upload should have status 'scheduled'."""
        with (
            patch("web_runner.utils._run_sau"),
            patch("web_runner.utils.task_executor.submit"),
            patch("web_runner.utils.MIN_UPLOAD_BYTES", 0),
            patch("web_runner.utils._schedule_task"),
        ):
            resp = app.post(
                "/api/upload/video",
                data={
                    "platform": "bilibili",
                    "account": "up",
                    "title": "B站视频",
                    "desc": "desc",
                    "schedule": "2099-12-31T23:59",
                    "file_data": _data_uri_png(),
                },
            )
        data = resp.get_json()
        assert data["success"] is True
        task_id = data["data"]["task_id"]
        status = _read_task_status(task_id)
        assert status == "scheduled"

    def test_schedule_argv_has_no_schedule_flag(self, app):
        """Scheduled task argv must NOT include --schedule."""
        with (
            patch("web_runner.utils._run_sau"),
            patch("web_runner.utils.task_executor.submit"),
            patch("web_runner.utils.MIN_UPLOAD_BYTES", 0),
            patch("web_runner.utils._schedule_task"),
        ):
            resp = app.post(
                "/api/upload/video",
                data={
                    "platform": "bilibili",
                    "account": "up",
                    "title": "B站视频",
                    "desc": "desc",
                    "schedule": "2099-12-31T23:59",
                    "file_data": _data_uri_png(),
                },
            )
        task_id = resp.get_json()["data"]["task_id"]
        argv = _read_task_argv(task_id)
        assert "--schedule" not in argv


# ===========================================================================
#  TENCENT (视频号) — extras, draft, thumbnails
# ===========================================================================


class TestTencentUploadVideo:
    def test_baseline(self, app):
        _, argv = _post_upload(
            app,
            platform="tencent",
            account="creator",
            title="视频号标题",
            desc="描述",
            headless="true",
        )
        assert argv[0] == "tencent"
        assert "--desc" in argv and "描述" in argv
        assert "--headless" in argv
        assert "--draft" not in argv

    def test_with_all_extras(self, app):
        _, argv = _post_upload(
            app,
            platform="tencent",
            account="creator",
            title="视频号标题",
            desc="描述",
            short_title="短标题",
            category="科技",
            is_draft="true",
        )
        assert "--short-title" in argv and "短标题" in argv
        assert "--category" in argv and "科技" in argv
        assert "--draft" in argv

    def test_without_extras(self, app):
        _, argv = _post_upload(
            app,
            platform="tencent",
            account="creator",
            title="视频号标题",
            desc="描述",
            short_title="",
            category="",
            is_draft="",
        )
        assert "--short-title" not in argv
        assert "--category" not in argv
        assert "--draft" not in argv

    def test_draft_true_variants(self, app):
        for draft_val in ("true", "1"):
            _, argv = _post_upload(
                app,
                platform="tencent",
                account="creator",
                title="视频号标题",
                desc="描述",
                is_draft=draft_val,
            )
            assert "--draft" in argv, f"draft not added for is_draft={draft_val!r}"

    def test_draft_false_values(self, app):
        for draft_val in ("false", "0", ""):
            _, argv = _post_upload(
                app,
                platform="tencent",
                account="creator",
                title="视频号标题",
                desc="描述",
                is_draft=draft_val,
            )
            assert "--draft" not in argv, f"draft incorrectly added for is_draft={draft_val!r}"

    def test_schedule_status(self, app):
        with (
            patch("web_runner.utils._run_sau"),
            patch("web_runner.utils.task_executor.submit"),
            patch("web_runner.utils.MIN_UPLOAD_BYTES", 0),
            patch("web_runner.utils._schedule_task"),
        ):
            resp = app.post(
                "/api/upload/video",
                data={
                    "platform": "tencent",
                    "account": "creator",
                    "title": "视频号标题",
                    "desc": "desc",
                    "schedule": "2099-12-31T23:59",
                    "file_data": _data_uri_png(),
                },
            )
        data = resp.get_json()
        assert data["success"] is True
        status = _read_task_status(data["data"]["task_id"])
        assert status == "scheduled"


# ===========================================================================
#  CROSS-PLATFORM  — headless behavior, desc behavior
# ===========================================================================


class TestCrossPlatform:
    PLATFORMS_WITH_HEADLESS = ["douyin", "kuaishou", "xiaohongshu", "tencent", "tiktok", "baijiahao"]
    PLATFORMS_WITHOUT_HEADLESS = ["bilibili"]

    def test_headless_passed_for_browser_platforms(self, app):
        for platform in self.PLATFORMS_WITH_HEADLESS:
            _, argv = _post_upload(
                app,
                platform=platform,
                account="test",
                title="test",
                headless="true",
            )
            assert "--headless" in argv, f"{platform} should have --headless"

    def test_headed_flag(self, app):
        for platform in self.PLATFORMS_WITH_HEADLESS:
            _, argv = _post_upload(
                app,
                platform=platform,
                account="test",
                title="test",
                headless="false",
            )
            assert "--headed" in argv, f"{platform} should have --headed"
            assert "--headless" not in argv, f"{platform} should NOT have --headless"

    def test_headless_absent_for_bilibili(self, app):
        _, argv = _post_upload(
            app,
            platform="bilibili",
            account="up",
            title="test",
            desc="desc",
            headless="true",
        )
        assert "--headless" not in argv
        assert "--headed" not in argv

    def test_headless_absent_when_not_sent(self, app):
        with (
            patch("web_runner.utils._run_sau"),
            patch("web_runner.utils.task_executor.submit"),
            patch("web_runner.utils.MIN_UPLOAD_BYTES", 0),
        ):
            resp = app.post(
                "/api/upload/video",
                data={
                    "platform": "douyin",
                    "account": "test",
                    "title": "test",
                    "file_data": _data_uri_png(),
                },
            )
        task_id = resp.get_json()["data"]["task_id"]
        argv = _read_task_argv(task_id)
        assert "--headless" not in argv
        assert "--headed" not in argv

    def test_desc_in_desc_platforms(self, app):
        desc_platforms = ["douyin", "kuaishou", "xiaohongshu", "bilibili", "tencent"]
        for platform in desc_platforms:
            _, argv = _post_upload(
                app,
                platform=platform,
                account="test",
                title="test",
                desc="hello",
            )
            assert "--desc" in argv, f"{platform} should have --desc"

    def test_no_desc_in_non_desc_platforms(self, app):
        non_desc = ["tiktok", "baijiahao"]
        for platform in non_desc:
            _, argv = _post_upload(
                app,
                platform=platform,
                account="test",
                title="test",
                desc="should_not_appear",
            )
            assert "--desc" not in argv, f"{platform} should NOT have --desc"


# ===========================================================================
#  PLATFORM-SPECIFIC  — douyin, other extras
# ===========================================================================


class TestDouyinUploadVideo:
    def test_product_link_and_title(self, app):
        _, argv = _post_upload(
            app,
            platform="douyin",
            account="test",
            title="抖音视频",
            product_link="https://example.com/product",
            product_title="好物推荐",
        )
        assert "--product-link" in argv and "https://example.com/product" in argv
        assert "--product-title" in argv and "好物推荐" in argv

    def test_product_fields_omitted_when_empty(self, app):
        _, argv = _post_upload(
            app,
            platform="douyin",
            account="test",
            title="抖音视频",
            product_link="",
            product_title="",
        )
        assert "--product-link" not in argv
        assert "--product-title" not in argv

    def test_headless_passed(self, app):
        _, argv = _post_upload(
            app,
            platform="douyin",
            account="test",
            title="抖音视频",
            headless="true",
        )
        assert "--headless" in argv


# ===========================================================================
#  THUMBNAIL TESTS
# ===========================================================================


class TestThumbnailUploadVideo:
    def test_thumbnail_in_thumbnail_platform(self, app):
        for platform in ("douyin", "kuaishou", "xiaohongshu", "tencent"):
            _, argv = _post_upload(
                app,
                platform=platform,
                account="test",
                title="test",
                thumbnail=_data_uri_png(),
            )
            assert "--thumbnail" in argv, f"{platform} should have --thumbnail"

    def test_no_thumbnail_in_non_thumbnail_platform(self, app):
        for platform in ("bilibili", "tiktok", "baijiahao"):
            _, argv = _post_upload(
                app,
                platform=platform,
                account="test",
                title="test",
                thumbnail=_data_uri_png(),
            )
            assert "--thumbnail" not in argv, f"{platform} should NOT have --thumbnail"

    def test_dual_thumbnails_for_douyin(self, app):
        _, argv = _post_upload(
            app,
            platform="douyin",
            account="test",
            title="test",
            thumbnail_landscape=_data_uri_png(),
            thumbnail_portrait=_data_uri_png(),
        )
        assert "--thumbnail-landscape" in argv
        assert "--thumbnail-portrait" in argv

    def test_dual_thumbnails_for_tencent(self, app):
        _, argv = _post_upload(
            app,
            platform="tencent",
            account="test",
            title="test",
            desc="desc",
            thumbnail_landscape=_data_uri_png(),
            thumbnail_portrait=_data_uri_png(),
        )
        assert "--thumbnail-landscape" in argv
        assert "--thumbnail-portrait" in argv

    def test_no_dual_thumbnails_for_kuaishou(self, app):
        _, argv = _post_upload(
            app,
            platform="kuaishou",
            account="test",
            title="test",
            thumbnail_landscape=_data_uri_png(),
            thumbnail_portrait=_data_uri_png(),
        )
        assert "--thumbnail-landscape" not in argv
        assert "--thumbnail-portrait" not in argv

    def test_empty_thumbnail_not_passed(self, app):
        _, argv = _post_upload(
            app,
            platform="douyin",
            account="test",
            title="test",
            thumbnail="",
        )
        assert "--thumbnail" not in argv


# ===========================================================================
#  BOUNDARY / ERROR TESTS
# ===========================================================================


class TestUploadVideoErrors:
    def test_missing_platform(self, app):
        resp = app.post("/api/upload/video", data={"account": "test", "title": "test"})
        assert resp.status_code == 400

    def test_missing_account(self, app):
        resp = app.post("/api/upload/video", data={"platform": "douyin", "title": "test"})
        assert resp.status_code == 400

    def test_missing_title(self, app):
        resp = app.post("/api/upload/video", data={"platform": "douyin", "account": "test"})
        assert resp.status_code == 400

    def test_missing_file(self, app):
        with patch("web_runner.utils.MIN_UPLOAD_BYTES", 0):
            resp = app.post(
                "/api/upload/video",
                data={"platform": "douyin", "account": "test", "title": "test"},
            )
        assert resp.status_code == 400

    def test_bilibili_without_headless_works(self, app):
        _, argv = _post_upload(
            app,
            platform="bilibili",
            account="up",
            title="B站视频",
            desc="desc",
        )
        assert "--headless" not in argv
        assert "--headed" not in argv

    def test_schedule_passed_time_already_passed_runs_immediately(self, app):
        with (
            patch("web_runner.utils._run_sau"),
            patch("web_runner.utils.task_executor.submit"),
            patch("web_runner.utils.MIN_UPLOAD_BYTES", 0),
        ):
            resp = app.post(
                "/api/upload/video",
                data={
                    "platform": "douyin",
                    "account": "test",
                    "title": "test",
                    "schedule": "2000-01-01T00:00",
                    "file_data": _data_uri_png(),
                },
            )
        data = resp.get_json()
        assert data["success"] is True
        status = _read_task_status(data["data"]["task_id"])
        # Schedule in the past → _schedule_task submits _run_sau immediately
        # but since we patch task_executor.submit, status stays "pending"
        # because _run_sau never actually updates it to "running"
        assert status == "pending"
