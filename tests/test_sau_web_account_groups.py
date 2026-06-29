from __future__ import annotations

import json
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest

from web_runner import create_app


@pytest.fixture
def app():
    """Flask test client with isolated temporary cookies dir and DB."""
    import web_runner.db as wr_db
    import web_runner.utils as wr_utils

    application = create_app()
    application.config["TESTING"] = True
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)

        # Redirect COOKIES_DIR to temp
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = tmp / "cookies"
        wr_utils.COOKIES_DIR.mkdir(exist_ok=True)

        # Redirect DB to temp
        orig_db_path = wr_db.DB_PATH
        db_path = tmp / "test.db"
        wr_db.DB_PATH = db_path

        # Re-initialise DB tables in the temp DB
        _init_temp_db(db_path)

        try:
            with application.test_client() as client:
                yield client
        finally:
            wr_utils.COOKIES_DIR = orig_cookies_dir
            wr_db.DB_PATH = orig_db_path


def _init_temp_db(db_path: Path) -> None:
    """Create all required tables in a temp DB (prevents watchdog noise on tasks/logs)."""
    with sqlite3.connect(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS account_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS account_authorizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                platform TEXT NOT NULL,
                cookie_file TEXT NOT NULL,
                created TEXT NOT NULL,
                FOREIGN KEY (group_id) REFERENCES account_groups(id) ON DELETE CASCADE,
                UNIQUE(group_id, platform)
            )
        """)
        # Also create tasks/logs tables so the orphan watchdog daemon doesn't error
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY, status TEXT, platform TEXT,
                action TEXT, account TEXT, created TEXT, code INTEGER,
                error TEXT, argv TEXT, result TEXT, publish_detail TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                ts TEXT NOT NULL, message TEXT NOT NULL
            )
        """)
        conn.commit()


def _create_group(db_path: Path, name: str) -> int:
    """Insert a test group and return its ID."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO account_groups (name, created) VALUES (?, ?)",
            (name, datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def _insert_authorization(db_path: Path, group_id: int, platform: str, cookie_file: str) -> None:
    """Insert an existing authorization for a group."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO account_authorizations (group_id, platform, cookie_file, created) VALUES (?, ?, ?, ?)",
            (group_id, platform, cookie_file, datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()


def _authorize(app, group_id: int, platform: str) -> tuple[int, dict]:
    """POST /api/account-groups/<id>/authorize and return (status_code, json_body)."""
    resp = app.post(
        f"/api/account-groups/{group_id}/authorize",
        data=json.dumps({"platform": platform}),
        content_type="application/json",
    )
    return resp.status_code, resp.get_json()


# ===========================================================================
#  QR PLATFORM BRANCH
# ===========================================================================


class TestAuthorizeQrPlatforms:
    """QR platforms (douyin, kuaishou, xiaohongshu, tencent, bilibili) return 200."""

    QR_PLATFORMS = ["douyin", "kuaishou", "xiaohongshu", "tencent", "bilibili"]

    def test_all_qr_platforms_return_200(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        for platform in self.QR_PLATFORMS:
            group_id = _create_group(wr_db.DB_PATH, f"test-{platform[:4]}")

            status, data = _authorize(app, group_id, platform)
            assert status == 200, f"{platform}: expected 200, got {status}"
            assert data["success"] is True, f"{platform}: {data}"
            assert data["data"]["platform"] == platform
            assert data["data"]["group_name"] == f"test-{platform[:4]}"
            assert "cookie_file" in data["data"]

            expected_cookie = str(wr_utils.COOKIES_DIR / f"{platform}_test-{platform[:4]}.json")
            assert data["data"]["cookie_file"] == expected_cookie

            assert "task_id" not in data["data"], f"{platform}: task_id should not be in response"

    def test_douyin_authorize_returns_correct_cookie_path(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        group_id = _create_group(wr_db.DB_PATH, "创作组")
        _, data = _authorize(app, group_id, "douyin")

        expected = str(wr_utils.COOKIES_DIR / "douyin_创作组.json")
        assert data["data"]["cookie_file"] == expected
        assert data["data"]["group_name"] == "创作组"
        assert data["data"]["platform"] == "douyin"

    def test_bilibili_authorize_returns_correct_cookie_path(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        group_id = _create_group(wr_db.DB_PATH, "B站组")
        _, data = _authorize(app, group_id, "bilibili")

        expected = str(wr_utils.COOKIES_DIR / "bilibili_B站组.json")
        assert data["data"]["cookie_file"] == expected

    def test_tencent_authorize_returns_correct_cookie_path(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        group_id = _create_group(wr_db.DB_PATH, "视频号组")
        _, data = _authorize(app, group_id, "tencent")

        expected = str(wr_utils.COOKIES_DIR / "tencent_视频号组.json")
        assert data["data"]["cookie_file"] == expected


# ===========================================================================
#  NON-QR PLATFORM BRANCH  (tiktok, baijiahao)
# ===========================================================================


class TestAuthorizeNonQrPlatforms:
    NON_QR_PLATFORMS = ["tiktok", "baijiahao"]

    def test_all_non_qr_platforms_return_200(self, app):
        import web_runner.db as wr_db

        for platform in self.NON_QR_PLATFORMS:
            group_id = _create_group(wr_db.DB_PATH, f"test-{platform[:4]}")

            status, data = _authorize(app, group_id, platform)
            assert status == 200, f"{platform}: expected 200, got {status}"
            assert data["success"] is True, f"{platform}: {data}"
            assert data["data"]["platform"] == platform
            assert data["data"]["group_name"] == f"test-{platform[:4]}"
            assert "cookie_file" in data["data"]
            assert "task_id" not in data["data"], f"{platform}: task_id should not be in response"

    def test_tiktok_authorize_returns_correct_cookie_path(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        group_id = _create_group(wr_db.DB_PATH, "海外组")
        _, data = _authorize(app, group_id, "tiktok")

        expected = str(wr_utils.COOKIES_DIR / "tiktok_海外组.json")
        assert data["data"]["cookie_file"] == expected

    def test_baijiahao_authorize_returns_correct_cookie_path(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        group_id = _create_group(wr_db.DB_PATH, "自媒体组")
        _, data = _authorize(app, group_id, "baijiahao")

        expected = str(wr_utils.COOKIES_DIR / "baijiahao_自媒体组.json")
        assert data["data"]["cookie_file"] == expected

    def test_non_qr_branch_does_not_trigger_background_task(self, app):
        """Non-QR authorize must NOT spawn a background task (no _run_sau call)."""
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "manual-test")

        with patch("web_runner.utils._run_sau") as mock_run:
            status, data = _authorize(app, group_id, "tiktok")

        assert status == 200
        mock_run.assert_not_called(), "_run_sau should NOT be called for non-QR platforms"


# ===========================================================================
#  ERROR CASES
# ===========================================================================


class TestAuthorizeErrors:
    def test_missing_platform_returns_400(self, app):
        resp = app.post(
            "/api/account-groups/1/authorize",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["success"] is False
        assert "platform" in data["message"].lower()

    def test_nonexistent_group_returns_404(self, app):
        status, data = _authorize(app, 99999, "douyin")
        assert status == 404
        assert data["success"] is False
        assert "not found" in data["message"].lower()

    def test_already_authorized_returns_409(self, app):
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "dup-test")
        _insert_authorization(wr_db.DB_PATH, group_id, "douyin", "/fake/path.json")

        status, data = _authorize(app, group_id, "douyin")

        assert status == 409
        assert data["success"] is False
        assert "already authorized" in data["message"].lower()

    def test_already_authorized_returns_409_for_non_qr_too(self, app):
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "dup-nonqr")
        _insert_authorization(wr_db.DB_PATH, group_id, "tiktok", "/fake/tiktok.json")

        status, data = _authorize(app, group_id, "tiktok")

        assert status == 409
        assert data["success"] is False
        assert "already authorized" in data["message"].lower()

    def test_group_still_accepts_different_platforms(self, app):
        """Authorizing one platform does not block another platform on the same group."""
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "multi-platform")

        # Authorize douyin (returns 200 but does not insert into DB)
        status1, data1 = _authorize(app, group_id, "douyin")
        assert status1 == 200

        # Still can authorize kuaishou
        status2, data2 = _authorize(app, group_id, "kuaishou")
        assert status2 == 200

        # Persist douyin manually
        _insert_authorization(wr_db.DB_PATH, group_id, "douyin", "/fake/douyin.json")

        # Now douyin again is 409
        status3, _ = _authorize(app, group_id, "douyin")
        assert status3 == 409


# ===========================================================================
#  EDGE CASES
# ===========================================================================


class TestAuthorizeEdgeCases:
    def test_group_name_with_spaces(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        group_id = _create_group(wr_db.DB_PATH, "My Test Group")
        _, data = _authorize(app, group_id, "douyin")

        expected = str(wr_utils.COOKIES_DIR / "douyin_My Test Group.json")
        assert data["data"]["cookie_file"] == expected
        assert data["data"]["group_name"] == "My Test Group"

    def test_group_name_with_special_chars(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        group_id = _create_group(wr_db.DB_PATH, "test_user-01")
        _, data = _authorize(app, group_id, "xiaohongshu")

        expected = str(wr_utils.COOKIES_DIR / "xiaohongshu_test_user-01.json")
        assert data["data"]["cookie_file"] == expected

    def test_multiple_qr_platforms_on_same_group(self, app):
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "全能组")
        platforms = ["douyin", "kuaishou", "xiaohongshu", "bilibili", "tencent"]

        for platform in platforms:
            status, data = _authorize(app, group_id, platform)
            assert status == 200, f"{platform}: expected 200, got {status}"
            assert data["data"]["group_name"] == "全能组"

    def test_unlisted_platform_treated_as_non_qr(self, app):
        """A platform not in _QR_LOGIN_PLATFORMS falls through to the non-QR branch (200)."""
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "unlisted-plat")
        status, data = _authorize(app, group_id, "weibo")

        assert status == 200
        assert data["data"]["platform"] == "weibo"


# ===========================================================================
#  FS-SAFETY: create + rename endpoint
# ===========================================================================


import os as _test_os  # noqa: E402 - used only in TestAccountGroupFsSafety.disk-failure paths; aliased import must follow class def so FS-safety tests can target `_test_os.<attr>` independently of the top-level `os` import


class TestAccountGroupFsSafety:
    """Mirrors the frontend `validateGroupName` and backend `_validate_group_name`."""

    FORBIDDEN_CHARS = ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\x00", "\n"]

    def test_create_rejects_empty_name(self, app):
        resp = app.post(
            "/api/account-groups",
            data=json.dumps({"name": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 400
        body = resp.get_json()
        assert body["success"] is False
        assert "为空" in body["message"]

    def test_create_rejects_whitespace_only(self, app):
        resp = app.post(
            "/api/account-groups",
            data=json.dumps({"name": "   "}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_create_rejects_too_long_name(self, app):
        resp = app.post(
            "/api/account-groups",
            data=json.dumps({"name": "x" * 65}),
            content_type="application/json",
        )
        assert resp.status_code == 400
        body = resp.get_json()
        assert "64" in body["message"]

    def test_create_rejects_illegal_chars(self, app):
        for ch in self.FORBIDDEN_CHARS:
            resp = app.post(
                "/api/account-groups",
                data=json.dumps({"name": f"bad{ch}name"}),
                content_type="application/json",
            )
            assert resp.status_code == 400, f"char {ch!r} not rejected"
            assert "不允许" in resp.get_json()["message"]

    def test_create_accepts_valid_chinese(self, app):
        resp = app.post(
            "/api/account-groups",
            data=json.dumps({"name": "全能组"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["data"]["name"] == "全能组"

    def test_create_strips_whitespace(self, app):
        resp = app.post(
            "/api/account-groups",
            data=json.dumps({"name": "  spaced-group  "}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["data"]["name"] == "spaced-group"

    @staticmethod
    def _post_rename(client, group_id, name):
        resp = client.post(
            f"/api/account-groups/{group_id}/rename",
            data=json.dumps({"name": name}),
            content_type="application/json",
        )
        return resp.status_code, resp.get_json()

    def test_rename_happy_path_updates_db_and_disk(self, app):
        import web_runner.db as wr_db
        import web_runner.utils as wr_utils

        group_id = _create_group(wr_db.DB_PATH, "旧名")
        _insert_authorization(
            wr_db.DB_PATH,
            group_id,
            "douyin",
            str(wr_utils.COOKIES_DIR / "douyin_旧名.json"),
        )
        (wr_utils.COOKIES_DIR / "douyin_旧名.json").write_text('{"cookies":[]}')

        status, body = self._post_rename(app, group_id, "新名")

        assert status == 200
        assert body["success"] is True
        assert body["data"]["name"] == "新名"

        with sqlite3.connect(wr_db.DB_PATH) as conn:
            assert conn.execute("SELECT name FROM account_groups WHERE id = ?", (group_id,)).fetchone()[0] == "新名"
            cookie_row = conn.execute(
                "SELECT cookie_file FROM account_authorizations WHERE group_id = ?",
                (group_id,),
            ).fetchone()
            assert cookie_row[0] == str(wr_utils.COOKIES_DIR / "douyin_新名.json")

        assert not (wr_utils.COOKIES_DIR / "douyin_旧名.json").exists()
        assert (wr_utils.COOKIES_DIR / "douyin_新名.json").exists()
        assert (wr_utils.COOKIES_DIR / "douyin_新名.json").read_text() == '{"cookies":[]}'

    def test_rename_rejects_empty_name(self, app):
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "stable")
        status, _ = self._post_rename(app, group_id, "   ")
        assert status == 400

    def test_rename_rejects_illegal_chars(self, app):
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "stable")
        status, body = self._post_rename(app, group_id, "bad/name")
        assert status == 400
        assert "不允许" in body["message"]

    def test_rename_nonexistent_returns_404(self, app):
        status, body = self._post_rename(app, 99999, "anything")
        assert status == 404
        assert "不存在" in body["message"]

    def test_rename_dup_name_returns_409(self, app):
        import web_runner.db as wr_db

        _create_group(wr_db.DB_PATH, "alpha")
        b = _create_group(wr_db.DB_PATH, "beta")
        status, _ = self._post_rename(app, b, "alpha")
        assert status == 409

    def test_rename_idempotent_when_name_unchanged(self, app):
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "stable")
        status, body = self._post_rename(app, group_id, "stable")
        assert status == 200
        assert body["data"]["name"] == "stable"

    def test_rename_with_no_authorizations_succeeds(self, app):
        import web_runner.db as wr_db

        group_id = _create_group(wr_db.DB_PATH, "empty")
        status, body = self._post_rename(app, group_id, "renamed")
        assert status == 200
        assert body["data"]["name"] == "renamed"

    def test_rename_disk_failure_rolls_back_earlier_success(self, app):
        """1 platform forward rename works; 2nd platform PermissionError.
        Verify rollback restored the first file and DB row unchanged."""
        import web_runner.db as wr_db
        import web_runner.routes.account_groups as ag_route

        group_id = _create_group(wr_db.DB_PATH, "原始")
        _insert_authorization(
            wr_db.DB_PATH,
            group_id,
            "douyin",
            str(ag_route.COOKIES_DIR / "douyin_原始.json"),
        )
        _insert_authorization(
            wr_db.DB_PATH,
            group_id,
            "kuaishou",
            str(ag_route.COOKIES_DIR / "kuaishou_原始.json"),
        )
        (ag_route.COOKIES_DIR / "douyin_原始.json").write_text("d")
        (ag_route.COOKIES_DIR / "kuaishou_原始.json").write_text("k")

        real_rename = _test_os.rename
        counter = {"n": 0}

        def fake_rename(src, dst):
            counter["n"] += 1
            if counter["n"] == 2:
                raise PermissionError("simulated file lock")
            return real_rename(src, dst)

        with patch.object(ag_route, "os") as fake_os_module:
            fake_os_module.rename.side_effect = fake_rename
            # Note: `os.rename` is bound by `from os import rename`-like reference;
            # easiest is patch.object on the module-level `os` import.
            # ag_route does `import os` then `os.rename(...)`, so patching
            # `web_runner.routes.account_groups.os.rename` is the correct path.
            with patch("web_runner.routes.account_groups.os.rename", side_effect=fake_rename):
                status, body = self._post_rename(app, group_id, "新名")

        assert status == 409

        with sqlite3.connect(wr_db.DB_PATH) as conn:
            assert conn.execute("SELECT name FROM account_groups WHERE id = ?", (group_id,)).fetchone()[0] == "原始"

        assert (ag_route.COOKIES_DIR / "douyin_原始.json").exists()
        assert (ag_route.COOKIES_DIR / "kuaishou_原始.json").exists()
        assert not (ag_route.COOKIES_DIR / "douyin_新名.json").exists()
        assert not (ag_route.COOKIES_DIR / "kuaishou_新名.json").exists()
