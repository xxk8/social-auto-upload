"""Tests for ``web_runner.routes.crawl`` — Crawler Web API.

OpenSpec ref: ``openspec/changes/mediacrawler-integration/tasks.md §7``.

Coverage (9 endpoint groups):
  1. POST /api/crawl/search     — 202 + Location + Retry-After + validation
  2. POST /api/crawl/detail     — same 202 contract
  3. POST /api/crawl/comments   — same 202 contract
  4. GET  /api/crawl/status     — 200 (found) / 400 (missing task_id) / 404 (not found)
  5. POST /api/crawl/reply-suggest — 200 (suggestion) / 400 (validation)
  6. GET  /api/crawl/data       — 200 (empty + seeded) / 400 (bad limit)
  7. GET  /api/crawl/comments   — 200 (empty + filtered) / 400 (bad limit)
  8. GET  /api/crawl/sentiment-summary — 200 (empty + seeded)
  9. GET  /api/crawl/health     — 200

Auth gating: every endpoint is tested both authenticated (200/202)
and unauthenticated (401).
"""

from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("psycopg")

from web_runner import create_app  # noqa: E402
from web_runner.db import get_database  # noqa: E402
from tests._login_helpers import _login_as  # noqa: E402


# ═══════════════════════════════════════════════════════════════════════
#  Fixtures
# ═══════════════════════════════════════════════════════════════════════


@pytest.fixture
def app():
    """Flask test client with isolated COOKIES_DIR.

    Mirrors ``tests/test_studio.py::app`` exactly so the testing
    convention is uniform.
    """
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "true"}, clear=False):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
        application.config["TESTING"] = True
        application.config["SECRET_KEY"] = "test-secret-key-crawl-api"
        with tempfile.TemporaryDirectory() as tmp_dir:
            import web_runner.utils as wr_utils
            orig = wr_utils.COOKIES_DIR
            wr_utils.COOKIES_DIR = Path(tmp_dir)
            with application.test_client() as client:
                yield client
            wr_utils.COOKIES_DIR = orig


@pytest.fixture(autouse=True)
def _clean_tables():
    """Wipe every table the crawl API tests touch, before AND after."""
    db = get_database()
    tables = [
        "crawled_comments",
        "crawled_content",
        "tasks",
        "verification_codes",
        "account_authorizations",
        "account_groups",
        "users",
    ]
    for tbl in tables:
        try:
            db.execute(f"DELETE FROM {tbl}")
        except Exception:
            pass
    yield
    for tbl in tables:
        try:
            db.execute(f"DELETE FROM {tbl}")
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════
#  1. POST /api/crawl/search
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlSearch:
    """POST /api/crawl/search — 202 + Location + Retry-After."""

    def test_search_happy_path_returns_202(self, app):
        """§7.2: valid platform + keyword → 202 + Location + Retry-After."""
        _login_as(app, "crawl_search_happy@test.com")
        resp = app.post(
            "/api/crawl/search",
            json={"platform": "xhs", "keyword": "美食"},
        )
        assert resp.status_code == 202, resp.get_json()
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["status"] == "pending"
        assert data["data"]["task_id"].startswith("crawl-search-")
        assert resp.headers.get("Location", "").startswith("/api/tasks?task_id=")
        assert resp.headers.get("Retry-After") == "2"

    def test_search_supports_platform_aliases(self, app):
        """Long platform aliases (xiaohongshu/douyin/...) are accepted."""
        _login_as(app, "crawl_search_alias@test.com")
        for alias in ("xiaohongshu", "douyin", "bilibili", "weibo"):
            resp = app.post(
                "/api/crawl/search",
                json={"platform": alias, "keyword": "test"},
            )
            assert resp.status_code == 202, f"{alias}: {resp.get_json()}"

    def test_search_missing_platform_400(self, app):
        """Missing platform → 400."""
        _login_as(app, "crawl_search_nop@test.com")
        resp = app.post(
            "/api/crawl/search",
            json={"keyword": "test"},
        )
        assert resp.status_code == 400
        assert resp.get_json()["success"] is False

    def test_search_missing_keyword_400(self, app):
        """Missing keyword → 400."""
        _login_as(app, "crawl_search_nokw@test.com")
        resp = app.post(
            "/api/crawl/search",
            json={"platform": "xhs"},
        )
        assert resp.status_code == 400
        assert resp.get_json()["success"] is False

    def test_search_unknown_platform_still_enqueues_202(self, app):
        """Unknown platform slug is enqueued as a task (validation happens
        at execution time, not at enqueue time). Returns 202."""
        _login_as(app, "crawl_search_unknown@test.com")
        resp = app.post(
            "/api/crawl/search",
            json={"platform": "nonexistent", "keyword": "test"},
        )
        assert resp.status_code == 202, resp.get_json()
        assert resp.get_json()["data"]["task_id"].startswith("crawl-search-")

    def test_search_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.post(
            "/api/crawl/search",
            json={"platform": "xhs", "keyword": "test"},
        )
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════
#  2. POST /api/crawl/detail
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlDetail:
    """POST /api/crawl/detail — 202 + Location + Retry-After."""

    def test_detail_happy_path_returns_202(self, app):
        """§7.3: valid platform + post_id → 202."""
        _login_as(app, "crawl_detail_happy@test.com")
        resp = app.post(
            "/api/crawl/detail",
            json={"platform": "xhs", "post_id": "abc123"},
        )
        assert resp.status_code == 202, resp.get_json()
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["task_id"].startswith("crawl-detail-")
        assert resp.headers.get("Location", "").startswith("/api/tasks?task_id=")

    def test_detail_missing_post_id_400(self, app):
        """Missing post_id → 400."""
        _login_as(app, "crawl_detail_noid@test.com")
        resp = app.post(
            "/api/crawl/detail",
            json={"platform": "xhs"},
        )
        assert resp.status_code == 400

    def test_detail_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.post(
            "/api/crawl/detail",
            json={"platform": "xhs", "post_id": "abc"},
        )
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════
#  3. POST /api/crawl/comments
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlCommentsAction:
    """POST /api/crawl/comments — 202 + Location + Retry-After."""

    def test_comments_happy_path_returns_202(self, app):
        """§7.4: valid platform + post_id → 202."""
        _login_as(app, "crawl_cmts_happy@test.com")
        resp = app.post(
            "/api/crawl/comments",
            json={"platform": "dy", "post_id": "vid456"},
        )
        assert resp.status_code == 202, resp.get_json()
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["task_id"].startswith("crawl-comments-")

    def test_comments_missing_fields_400(self, app):
        """Missing platform or post_id → 400."""
        _login_as(app, "crawl_cmts_nof@test.com")
        resp = app.post(
            "/api/crawl/comments",
            json={"platform": "dy"},
        )
        assert resp.status_code == 400

    def test_comments_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.post(
            "/api/crawl/comments",
            json={"platform": "dy", "post_id": "vid"},
        )
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════
#  4. GET /api/crawl/status
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlStatus:
    """GET /api/crawl/status — poll a crawl task."""

    def test_status_returns_task_row(self, app):
        """Existing task → 200 + task row."""
        _login_as(app, "crawl_status_found@test.com")
        # Create a task first
        create_resp = app.post(
            "/api/crawl/search",
            json={"platform": "xhs", "keyword": "美食"},
        )
        task_id = create_resp.get_json()["data"]["task_id"]

        resp = app.get(f"/api/crawl/status?task_id={task_id}")
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()["data"]
        assert data["task_id"] == task_id
        assert data["status"] == "pending"
        assert data["action"] == "crawl_search"

    def test_status_missing_task_id_400(self, app):
        """No task_id query param → 400."""
        _login_as(app, "crawl_status_notid@test.com")
        resp = app.get("/api/crawl/status")
        assert resp.status_code == 400

    def test_status_not_found_404(self, app):
        """Non-existent task_id → 404."""
        _login_as(app, "crawl_status_404@test.com")
        resp = app.get("/api/crawl/status?task_id=nonexistent-task-id")
        assert resp.status_code == 404

    def test_status_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.get("/api/crawl/status?task_id=some-task")
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════
#  5. POST /api/crawl/reply-suggest
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlReplySuggest:
    """POST /api/crawl/reply-suggest — manual reply suggestion."""

    def test_reply_suggest_happy_path_200(self, app):
        """Valid platform + comment_text → 200 + suggestion."""
        _login_as(app, "crawl_rs_happy@test.com")
        with patch("crawler.ai.reply.generate_reply_suggestion",
                   return_value="谢谢关注！"):
            resp = app.post(
                "/api/crawl/reply-suggest",
                json={"platform": "xhs", "comment_text": "好吃！"},
            )
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()["data"]
        assert data["ai_reply_suggestion"] == "谢谢关注！"

    def test_reply_suggest_missing_fields_400(self, app):
        """Missing platform or comment_text → 400."""
        _login_as(app, "crawl_rs_nof@test.com")
        resp = app.post(
            "/api/crawl/reply-suggest",
            json={"platform": "xhs"},
        )
        assert resp.status_code == 400

    def test_reply_suggest_writes_back_to_db(self, app):
        """comment_id provided → suggestion written to crawled_comments."""
        db = get_database()
        _login_as(app, "crawl_rs_db@test.com")
        # Seed a comment row
        comment_id = db.insert_returning_id(
            "INSERT INTO crawled_comments "
            "(platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            ("xhs", "post123", json.dumps({"text": "好吃！"}), "2026-01-01T00:00:00"),
        )
        with patch("crawler.ai.reply.generate_reply_suggestion",
                   return_value="谢谢！"):
            resp = app.post(
                "/api/crawl/reply-suggest",
                json={
                    "platform": "xhs",
                    "comment_text": "好吃！",
                    "comment_id": comment_id,
                },
            )
        assert resp.status_code == 200
        row = db.fetch_one(
            "SELECT ai_reply_suggestion FROM crawled_comments WHERE id = ?",
            (comment_id,),
        )
        assert row["ai_reply_suggestion"] == "谢谢！"

    def test_reply_suggest_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.post(
            "/api/crawl/reply-suggest",
            json={"platform": "xhs", "comment_text": "test"},
        )
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════
#  6. GET /api/crawl/data
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlData:
    """GET /api/crawl/data — list crawled_content rows."""

    def test_data_empty_returns_empty_array(self, app):
        """No data → 200 + []."""
        _login_as(app, "crawl_data_empty@test.com")
        resp = app.get("/api/crawl/data")
        assert resp.status_code == 200
        assert resp.get_json()["data"] == []

    def test_data_returns_seeded_rows(self, app):
        """Seeded content rows → 200 + rows."""
        db = get_database()
        _login_as(app, "crawl_data_seeded@test.com")
        db.execute(
            "INSERT INTO crawled_content (platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            ("xhs", "note1", json.dumps({"title": "美食"}), "2026-01-01T00:00:00"),
        )
        db.execute(
            "INSERT INTO crawled_content (platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            ("dy", "vid1", json.dumps({"title": "旅行"}), "2026-01-02T00:00:00"),
        )
        resp = app.get("/api/crawl/data")
        assert resp.status_code == 200
        rows = resp.get_json()["data"]
        assert len(rows) == 2

    def test_data_filters_by_platform(self, app):
        """?platform=xhs → only xhs rows returned."""
        db = get_database()
        _login_as(app, "crawl_data_filter@test.com")
        db.execute(
            "INSERT INTO crawled_content (platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            ("xhs", "a", json.dumps({"t": "1"}), "2026-01-01T00:00:00"),
        )
        db.execute(
            "INSERT INTO crawled_content (platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            ("dy", "b", json.dumps({"t": "2"}), "2026-01-01T00:00:00"),
        )
        resp = app.get("/api/crawl/data?platform=xhs")
        assert resp.status_code == 200
        rows = resp.get_json()["data"]
        assert len(rows) == 1
        assert rows[0]["platform"] == "xhs"

    def test_data_bad_limit_400(self, app):
        """Non-integer limit → 400."""
        _login_as(app, "crawl_data_badlimit@test.com")
        resp = app.get("/api/crawl/data?limit=abc")
        assert resp.status_code == 400

    def test_data_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.get("/api/crawl/data")
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════
#  7. GET /api/crawl/comments (read)
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlGetComments:
    """GET /api/crawl/comments — list crawled_comments rows."""

    def test_comments_read_empty_returns_empty_array(self, app):
        """No comments → 200 + []."""
        _login_as(app, "crawl_gc_empty@test.com")
        resp = app.get("/api/crawl/comments")
        assert resp.status_code == 200
        assert resp.get_json()["data"] == []

    def test_comments_read_returns_seeded_rows(self, app):
        """Seeded comments → 200 + rows with sentiment fields."""
        db = get_database()
        _login_as(app, "crawl_gc_seeded@test.com")
        db.execute(
            "INSERT INTO crawled_comments "
            "(platform, post_id, raw_payload, ai_sentiment, "
            " ai_sentiment_confidence, ai_reply_suggestion, crawled_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("xhs", "note1", json.dumps({"text": "好吃"}), "positive", 0.95, "谢谢！", "2026-01-01T00:00:00"),
        )
        db.execute(
            "INSERT INTO crawled_comments "
            "(platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            ("dy", "vid1", json.dumps({"text": "一般"}), "2026-01-02T00:00:00"),
        )
        resp = app.get("/api/crawl/comments")
        assert resp.status_code == 200
        rows = resp.get_json()["data"]
        assert len(rows) == 2
        # Find the xhs row (with positive sentiment) regardless of ORDER BY
        xhs_row = next(r for r in rows if r["platform"] == "xhs")
        assert xhs_row["ai_sentiment"] == "positive"
        assert xhs_row["ai_reply_suggestion"] == "谢谢！"

    def test_comments_read_filters_by_sentiment(self, app):
        """?sentiment=positive → only positive rows."""
        db = get_database()
        _login_as(app, "crawl_gc_sentiment@test.com")
        db.execute(
            "INSERT INTO crawled_comments "
            "(platform, post_id, raw_payload, ai_sentiment, crawled_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("xhs", "a", json.dumps({"t": "1"}), "positive", "2026-01-01T00:00:00"),
        )
        db.execute(
            "INSERT INTO crawled_comments "
            "(platform, post_id, raw_payload, ai_sentiment, crawled_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("xhs", "b", json.dumps({"t": "2"}), "negative", "2026-01-01T00:00:00"),
        )
        resp = app.get("/api/crawl/comments?sentiment=positive")
        assert resp.status_code == 200
        rows = resp.get_json()["data"]
        assert len(rows) == 1
        assert rows[0]["ai_sentiment"] == "positive"

    def test_comments_read_bad_limit_400(self, app):
        """Non-integer limit → 400."""
        _login_as(app, "crawl_gc_badlimit@test.com")
        resp = app.get("/api/crawl/comments?limit=abc")
        assert resp.status_code == 400

    def test_comments_read_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.get("/api/crawl/comments")
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════
#  8. GET /api/crawl/sentiment-summary
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlSentimentSummary:
    """GET /api/crawl/sentiment-summary — bucket counts."""

    def test_summary_empty_returns_all_zeros(self, app):
        """No comments → {positive:0, negative:0, neutral:0, pending:0}."""
        _login_as(app, "crawl_ss_empty@test.com")
        resp = app.get("/api/crawl/sentiment-summary")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data == {"positive": 0, "negative": 0, "neutral": 0, "pending": 0}

    def test_summary_counts_buckets(self, app):
        """Seeded comments with varied sentiments → correct counts."""
        db = get_database()
        _login_as(app, "crawl_ss_count@test.com")
        # Seed: 2 positive, 1 negative, 1 null (pending), 0 neutral
        for platform in ("xhs",):
            for i in range(2):
                db.execute(
                    "INSERT INTO crawled_comments "
                    "(platform, post_id, raw_payload, ai_sentiment, crawled_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (platform, f"p{i}", json.dumps({"t": str(i)}), "positive", "2026-01-01T00:00:00"),
                )
            db.execute(
                "INSERT INTO crawled_comments "
                "(platform, post_id, raw_payload, ai_sentiment, crawled_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (platform, "neg1", json.dumps({"t": "bad"}), "negative", "2026-01-01T00:00:00"),
            )
            db.execute(
                "INSERT INTO crawled_comments "
                "(platform, post_id, raw_payload, crawled_at) "
                "VALUES (?, ?, ?, ?)",
                (platform, "pending1", json.dumps({"t": "?"}), "2026-01-01T00:00:00"),
            )
        resp = app.get("/api/crawl/sentiment-summary?platform=xhs")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["positive"] == 2
        assert data["negative"] == 1
        assert data["neutral"] == 0
        assert data["pending"] == 1

    def test_summary_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.get("/api/crawl/sentiment-summary")
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════
#  10. POST /api/crawl/search-stream (SSE)
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlSearchStream:
    """POST /api/crawl/search-stream — Server-Sent Events streaming."""

    def test_search_stream_emits_platform_result_and_done(self, app):
        """SSE stream yields platform_result rows then a done event."""
        _login_as(app, "crawl_stream_happy@test.com")

        class FakeCrawler:
            def __init__(self, account_file=None):  # route calls CrawlerClass(account_file=...)
                self.account_file = account_file

            def search_stream(self, keyword, *, max_count=20, page_num=1):
                yield {"post_id": "p1", "title": "row 1", "user": "u1"}
                yield {"post_id": "p2", "title": "row 2", "user": "u2"}

        with patch("web_runner.routes.crawl._get_crawler_class",
                   return_value=FakeCrawler), \
             patch("web_runner.routes.crawl._resolve_account_file",
                   return_value="/cookies/dy_test.json"):
            resp = app.post(
                "/api/crawl/search-stream",
                json={"platform": "dy", "keyword": "test", "account": "any-group"},
            )
            assert resp.status_code == 200, resp.get_json()
            assert resp.mimetype == "text/event-stream"
            body = resp.get_data(as_text=True)
            assert "event: platform_result" in body
            assert "event: done" in body
            assert '"post_id": "p1"' in body
            assert '"post_id": "p2"' in body

    def test_search_stream_emits_error_on_crawler_exception(self, app):
        """SSE stream yields an single error event when crawler raises."""
        _login_as(app, "crawl_stream_err@test.com")

        class BadCrawler:
            def __init__(self, account_file=None):
                self.account_file = account_file

            def search_stream(self, keyword, *, max_count=20, page_num=1):
                raise RuntimeError("boom")

        with patch("web_runner.routes.crawl._get_crawler_class",
                   return_value=BadCrawler), \
             patch("web_runner.routes.crawl._resolve_account_file",
                   return_value="/cookies/dy_test.json"):
            resp = app.post(
                "/api/crawl/search-stream",
                json={"platform": "dy", "keyword": "test", "account": "any-group"},
            )
            assert resp.status_code == 200
            body = resp.get_data(as_text=True)
            assert "event: error" in body
            assert "boom" in body

    def test_search_stream_requires_platform_and_keyword(self, app):
        """Missing platform or keyword → 400."""
        _login_as(app, "crawl_stream_400@test.com")
        resp = app.post("/api/crawl/search-stream", json={})
        assert resp.status_code == 400

    def test_search_stream_unknown_platform_400(self, app):
        """Unknown platform → 400."""
        _login_as(app, "crawl_stream_unknown@test.com")
        resp = app.post(
            "/api/crawl/search-stream",
            json={"platform": "nope", "keyword": "test"},
        )
        assert resp.status_code == 400

    def test_search_stream_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.post(
            "/api/crawl/search-stream",
            json={"platform": "dy", "keyword": "test"},
        )
        assert resp.status_code == 401

    def test_search_stream_with_account_passes_account_file(self, app):
        """Passing ``account`` resolves the cookie file and passes it to the crawler."""
        db = get_database()
        _login_as(app, "crawl_stream_account@test.com")
        user = db.fetch_one("SELECT id FROM users WHERE email = ?", ("crawl_stream_account@test.com",))
        user_id = user["id"]
        db.execute(
            "INSERT INTO account_groups (name, created, owner_user_id) VALUES (?, ?, ?)",
            ("my-group", "2026-01-01T00:00:00", user_id),
        )
        group = db.fetch_one("SELECT id FROM account_groups WHERE name = ?", ("my-group",))
        db.execute(
            "INSERT INTO account_authorizations (group_id, platform, cookie_file, created) "
            "VALUES (?, ?, ?, ?)",
            (group["id"], "douyin", "/cookies/douyin_my-group.json", "2026-01-01T00:00:00"),
        )

        captured = {}

        class CapturingCrawler:
            def __init__(self, account_file=None):
                captured["account_file"] = account_file

            def search_stream(self, keyword, *, max_count=20, page_num=1):
                yield {"post_id": "p1", "title": "row 1", "user": "u1"}

        with patch("web_runner.routes.crawl._get_crawler_class",
                   return_value=CapturingCrawler):
            resp = app.post(
                "/api/crawl/search-stream",
                json={"platform": "dy", "keyword": "test", "account": "my-group"},
            )
            assert resp.status_code == 200, resp.get_json()
            body = resp.get_data(as_text=True)
            assert "event: platform_result" in body
            assert "event: done" in body
            assert captured.get("account_file") == "/cookies/douyin_my-group.json"

    def test_search_stream_with_missing_account_returns_400(self, app):
        """Passing ``account`` for a group without the platform auth → 400."""
        _login_as(app, "crawl_stream_missing_account@test.com")
        resp = app.post(
            "/api/crawl/search-stream",
            json={"platform": "dy", "keyword": "test", "account": "no-such-group"},
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["success"] is False
        assert data["code"] == "account_not_found"
        assert data["redirect_url"] == "/app/accounts"
        assert "has no" in data["message"].lower()

    def test_search_stream_persists_rows_to_crawled_content(self, app):
        """Streamed rows are persisted to ``crawled_content``."""
        db = get_database()
        _login_as(app, "crawl_stream_persist@test.com")

        class FakeCrawler:
            def __init__(self, account_file=None):
                self.account_file = account_file

            def search_stream(self, keyword, *, max_count=20, page_num=1):
                yield {"post_id": "p1", "title": "row 1"}
                yield {"post_id": "p2", "title": "row 2"}

        with patch("web_runner.routes.crawl._get_crawler_class",
                   return_value=FakeCrawler), \
             patch("web_runner.routes.crawl._resolve_account_file",
                   return_value="/cookies/dy_test.json"):
            resp = app.post(
                "/api/crawl/search-stream",
                json={"platform": "dy", "keyword": "test", "account": "any-group"},
            )
            assert resp.status_code == 200, resp.get_json()
            # Fully consume the SSE stream so the generator runs to
            # completion and all rows are persisted before we query.
            resp.get_data(as_text=True)

        rows = db.fetch_all(
            "SELECT * FROM crawled_content WHERE platform = ? ORDER BY id",
            ("dy",),
        )
        assert len(rows) == 2
        assert rows[0]["post_id"] == "p1"
        assert rows[1]["post_id"] == "p2"

    def test_search_stream_missing_account_returns_401(self, app):
        """No ``account`` field → 401 + ``code: missing_account`` + ``redirect_url``.

        Regression: the previous behavior was to silently start the
        crawler with ``account_file=None``, which then timed out at
        ``page.wait_for_selector`` (15s wasted) and surfaced a
        confusing "cookie 校验非 race 异常" warning in the dashboard
        task list. The 401 makes the failure mode explicit so the
        Frontend can show "please add an account at /app/accounts"
        instead of waiting 15s for nothing.
        """
        _login_as(app, "crawl_stream_no_account@test.com")
        resp = app.post(
            "/api/crawl/search-stream",
            json={"platform": "dy", "keyword": "test"},  # no account
        )
        assert resp.status_code == 401
        data = resp.get_json()
        assert data["success"] is False
        assert data["code"] == "missing_account"
        assert data["redirect_url"] == "/app/accounts"
        # The message should mention the platform so the user knows
        # which platform's auth to add (important for operators
        # managing 7 platform authorizations).
        assert "'dy'" in data["message"]
        assert "/app/accounts" in data["message"]

    def test_search_stream_concurrency_limit_returns_429(self, app):
        """When the concurrency semaphore is exhausted, new requests get 429."""
        _login_as(app, "crawl_stream_concurrency@test.com")

        class SlowCrawler:
            def __init__(self, account_file=None):
                self.account_file = account_file

            def search_stream(self, keyword, *, max_count=20, page_num=1):
                # Never finishes while the test holds the slot.
                import time
                time.sleep(60)
                yield {"post_id": "x"}

        with patch("web_runner.routes.crawl._get_crawler_class",
                   return_value=SlowCrawler), \
             patch("web_runner.routes.crawl._resolve_account_file",
                   return_value="/cookies/dy_test.json"):
            # Patch the module-level semaphore to a single slot so the
            # test is deterministic regardless of the default value.
            import web_runner.routes.crawl as crawl_mod
            orig_semaphore = crawl_mod._STREAM_SEMAPHORE
            semaphore = threading.Semaphore(1)
            # Pre-acquire the only slot to simulate a busy worker.
            semaphore.acquire()
            crawl_mod._STREAM_SEMAPHORE = semaphore
            try:
                resp = app.post(
                    "/api/crawl/search-stream",
                    json={"platform": "dy", "keyword": "test", "account": "any-group"},
                )
                assert resp.status_code == 429
                assert resp.headers.get("Retry-After") == "5"
            finally:
                crawl_mod._STREAM_SEMAPHORE = orig_semaphore


# ═══════════════════════════════════════════════════════════════════════
#  9. GET /api/crawl/health
# ═══════════════════════════════════════════════════════════════════════


class TestCrawlHealth:
    """GET /api/crawl/health — lightweight health check."""

    def test_health_returns_counts_and_ok(self, app):
        """§7.1: Health endpoint returns ok + row counts."""
        _login_as(app, "crawl_health_happy@test.com")
        resp = app.get("/api/crawl/health")
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()["data"]
        assert data["ok"] is True
        assert isinstance(data["crawled_content_rows"], int)
        assert isinstance(data["crawled_comments_rows"], int)
        assert isinstance(data["now"], str)

    def test_health_reflects_seeded_rows(self, app):
        """Seeded rows → counts reflect seed data."""
        db = get_database()
        _login_as(app, "crawl_health_seeded@test.com")
        db.execute(
            "INSERT INTO crawled_content (platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            ("xhs", "n1", json.dumps({}), "2026-01-01T00:00:00"),
        )
        db.execute(
            "INSERT INTO crawled_comments "
            "(platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            ("xhs", "n1", json.dumps({"text": "ok"}), "2026-01-01T00:00:00"),
        )
        resp = app.get("/api/crawl/health")
        data = resp.get_json()["data"]
        assert data["crawled_content_rows"] >= 1
        assert data["crawled_comments_rows"] >= 1

    def test_health_unauth_returns_401(self, app):
        """Not logged in → 401."""
        resp = app.get("/api/crawl/health")
        assert resp.status_code == 401
