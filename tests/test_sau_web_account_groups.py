"""PostgreSQL-backed account-groups test suite (post-SQLite-removal).

The prior version of this file used ``sqlite3.connect(DB_PATH)`` to
seed test rows against a tmp SQLite file (rebinding ``wr_db.DB_PATH``
to redirect ``PostgresDatabase._connect`` to the tmp path). After the
SQLite cutover the production code is psycopg-only, so the test
fixture routes through ``get_database()`` directly. The local
``_init_temp_db`` helper that bootstrapped a tmp SQLite file is
gone — the test assumes a real PG is reachable via ``DATABASE_URL``,
matching the post-cutover contract documented in
``tests/conftest.py``.
"""
from __future__ import annotations

import json
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest

from web_runner import create_app


@pytest.fixture
def app():
    """Flask test client with isolated temporary cookies dir.

    Post-SQLite-removal: ``create_app()`` calls ``init_db()`` which
    expects a real PG via the host-env ``DATABASE_URL``. The fixture
    just isolates the cookies dir and resets the tables this test
    touches; the schema is created once at session scope (by
    ``tests/conftest.py`` or by the production init_db boot path).
    """
    import web_runner.db as wr_db
    import web_runner.utils as wr_utils

    application = create_app()
    application.config["TESTING"] = True
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)

        # Redirect COOKIES_DIR to temp.
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = tmp / "cookies"
        wr_utils.COOKIES_DIR.mkdir(exist_ok=True)

        # Reset tables this suite touches.
        db = wr_db.get_database()
        db.execute("DELETE FROM account_authorizations")
        db.execute("DELETE FROM account_groups")
        db.execute("DELETE FROM tasks")
        db.execute("DELETE FROM logs")

        try:
            with application.test_client() as client:
                yield client
        finally:
            wr_utils.COOKIES_DIR = orig_cookies_dir


def _create_group(name: str) -> int:
    """Insert a test group via the production psycopg backend and
    return its id (read back from the row).

    The prior version used ``conn.execute("SELECT last_insert_id()")``
    — that was SQLite's specific. PG's ``SERIAL PRIMARY KEY`` is read
    back via a follow-up SELECT, which is what the production
    ``db.insert_returning_id`` helper does. We use the same helper
    here so the test exercises the production id-readback path.
    """
    from web_runner.db import get_database
    return get_database().insert_returning_id(
        "INSERT INTO account_groups (name, created) VALUES (?, ?)",
        (name, datetime.now().isoformat(timespec="seconds")),
    )


def _insert_authorization(group_id: int, platform: str, cookie_file: str) -> None:
    """Insert an existing authorization via the production psycopg
    backend.
    """
    from web_runner.db import get_database
    get_database().execute(
        "INSERT INTO account_authorizations (group_id, platform, cookie_file, created) "
        "VALUES (?, ?, ?, ?)",
        (group_id, platform, cookie_file, datetime.now().isoformat(timespec="seconds")),
    )


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
        import web_runner.utils as wr_utils

        for platform in self.QR_PLATFORMS:
            group_id = _create_group(f"test-{platform[:4]}")

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
        import web_runner.utils as wr_utils

        group_id = _create_group("创作组")
        _, data = _authorize(app, group_id, "douyin")

        expected = str(wr_utils.COOKIES_DIR / "douyin_创作组.json")
        assert data["data"]["cookie_file"] == expected
        assert data["data"]["group_name"] == "创作组"
        assert data["data"]["platform"] == "douyin"

    def test_bilibili_authorize_returns_correct_cookie_path(self, app):
        import web_runner.utils as wr_utils

        group_id = _create_group("B站组")
        _, data = _authorize(app, group_id, "bilibili")

        expected = str(wr_utils.COOKIES_DIR / "bilibili_B站组.json")
        assert data["data"]["cookie_file"] == expected

    def test_tencent_authorize_returns_correct_cookie_path(self, app):
        import web_runner.utils as wr_utils

        group_id = _create_group("视频号组")
        _, data = _authorize(app, group_id, "tencent")

        expected = str(wr_utils.COOKIES_DIR / "tencent_视频号组.json")
        assert data["data"]["cookie_file"] == expected


# ===========================================================================
#  NON-QR PLATFORM BRANCH  (tiktok, baijiahao)
# ===========================================================================


class TestAuthorizeNonQrPlatforms:
    NON_QR_PLATFORMS = ["tiktok", "baijiahao"]

    def test_all_non_qr_platforms_return_200(self, app):
        for platform in self.NON_QR_PLATFORMS:
            group_id = _create_group(f"test-{platform[:4]}")

            status, data = _authorize(app, group_id, platform)
            assert status == 200, f"{platform}: expected 200, got {status}"
            assert data["success"] is True, f"{platform}: {data}"
            assert data["data"]["platform"] == platform
            assert data["data"]["group_name"] == f"test-{platform[:4]}"
            assert "cookie_file" in data["data"]
            assert "task_id" not in data["data"], f"{platform}: task_id should not be in response"

    def test_tiktok_authorize_returns_correct_cookie_path(self, app):
        import web_runner.utils as wr_utils

        group_id = _create_group("海外组")
        _, data = _authorize(app, group_id, "tiktok")

        expected = str(wr_utils.COOKIES_DIR / "tiktok_海外组.json")
        assert data["data"]["cookie_file"] == expected

    def test_baijiahao_authorize_returns_correct_cookie_path(self, app):
        import web_runner.utils as wr_utils

        group_id = _create_group("自媒体组")
        _, data = _authorize(app, group_id, "baijiahao")

        expected = str(wr_utils.COOKIES_DIR / "baijiahao_自媒体组.json")
        assert data["data"]["cookie_file"] == expected

    def test_non_qr_branch_does_not_trigger_background_task(self, app):
        """Non-QR authorize must NOT spawn a background task (no _run_sau call)."""
        group_id = _create_group("manual-test")

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
        group_id = _create_group("dup-test")
        _insert_authorization(group_id, "douyin", "/fake/path.json")

        status, data = _authorize(app, group_id, "douyin")

        assert status == 409
        assert data["success"] is False
        assert "already authorized" in data["message"].lower()

    def test_already_authorized_returns_409_for_non_qr_too(self, app):
        group_id = _create_group("dup-nonqr")
        _insert_authorization(group_id, "tiktok", "/fake/tiktok.json")

        status, data = _authorize(app, group_id, "tiktok")

        assert status == 409
        assert data["success"] is False
        assert "already authorized" in data["message"].lower()

    def test_group_still_accepts_different_platforms(self, app):
        """Authorizing one platform does not block another platform on the same group."""
        group_id = _create_group("multi-platform")

        status1, data1 = _authorize(app, group_id, "douyin")
        assert status1 == 200

        status2, data2 = _authorize(app, group_id, "kuaishou")
        assert status2 == 200

        _insert_authorization(group_id, "douyin", "/fake/douyin.json")

        status3, _ = _authorize(app, group_id, "douyin")
        assert status3 == 409


# ===========================================================================
#  EDGE CASES
# ===========================================================================


class TestAuthorizeEdgeCases:
    def test_group_name_with_spaces(self, app):
        import web_runner.utils as wr_utils

        group_id = _create_group("My Test Group")
        _, data = _authorize(app, group_id, "douyin")

        expected = str(wr_utils.COOKIES_DIR / "douyin_My Test Group.json")
        assert data["data"]["cookie_file"] == expected
        assert data["data"]["group_name"] == "My Test Group"

    def test_group_name_with_special_chars(self, app):
        import web_runner.utils as wr_utils

        group_id = _create_group("test_user-01")
        _, data = _authorize(app, group_id, "xiaohongshu")

        expected = str(wr_utils.COOKIES_DIR / "xiaohongshu_test_user-01.json")
        assert data["data"]["cookie_file"] == expected

    def test_multiple_qr_platforms_on_same_group(self, app):
        group_id = _create_group("全能组")
        platforms = ["douyin", "kuaishou", "xiaohongshu", "bilibili", "tencent"]

        for platform in platforms:
            status, data = _authorize(app, group_id, platform)
            assert status == 200, f"{platform}: expected 200, got {status}"
            assert data["data"]["group_name"] == "全能组"

    def test_unlisted_platform_treated_as_non_qr(self, app):
        """A platform not in _QR_LOGIN_PLATFORMS falls through to the non-QR branch (200)."""
        group_id = _create_group("unlisted-plat")
        status, data = _authorize(app, group_id, "weibo")

        assert status == 200
        assert data["data"]["platform"] == "weibo"


# ===========================================================================
#  FS-SAFETY: create + rename endpoint
# ===========================================================================


import os as _test_os  # noqa: E402 - aliased import must follow class def so FS-safety tests can target `_test_os.<attr>` independently of the top-level `os` import


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

        group_id = _create_group("旧名")
        _insert_authorization(
            group_id,
            "douyin",
            str(wr_utils.COOKIES_DIR / "douyin_旧名.json"),
        )
        (wr_utils.COOKIES_DIR / "douyin_旧名.json").write_text('{"cookies":[]}')

        status, body = self._post_rename(app, group_id, "新名")

        assert status == 200
        assert body["success"] is True
        assert body["data"]["name"] == "新名"

        # Verify DB-side rename via the production backend.
        group_row = wr_db.get_database().fetch_one(
            "SELECT name FROM account_groups WHERE id = ?", (group_id,)
        )
        assert group_row["name"] == "新名"
        cookie_row = wr_db.get_database().fetch_one(
            "SELECT cookie_file FROM account_authorizations WHERE group_id = ?",
            (group_id,),
        )
        assert cookie_row["cookie_file"] == str(wr_utils.COOKIES_DIR / "douyin_新名.json")

        assert not (wr_utils.COOKIES_DIR / "douyin_旧名.json").exists()
        assert (wr_utils.COOKIES_DIR / "douyin_新名.json").exists()
        assert (wr_utils.COOKIES_DIR / "douyin_新名.json").read_text() == '{"cookies":[]}'

    def test_rename_rejects_empty_name(self, app):
        group_id = _create_group("stable")
        status, _ = self._post_rename(app, group_id, "   ")
        assert status == 400

    def test_rename_rejects_illegal_chars(self, app):
        group_id = _create_group("stable")
        status, body = self._post_rename(app, group_id, "bad/name")
        assert status == 400
        assert "不允许" in body["message"]

    def test_rename_nonexistent_returns_404(self, app):
        status, body = self._post_rename(app, 99999, "anything")
        assert status == 404
        assert "不存在" in body["message"]

    def test_rename_dup_name_returns_409(self, app):
        _create_group("alpha")
        b = _create_group("beta")
        status, _ = self._post_rename(app, b, "alpha")
        assert status == 409

    def test_rename_idempotent_when_name_unchanged(self, app):
        group_id = _create_group("stable")
        status, body = self._post_rename(app, group_id, "stable")
        assert status == 200
        assert body["data"]["name"] == "stable"

    def test_rename_with_no_authorizations_succeeds(self, app):
        group_id = _create_group("empty")
        status, body = self._post_rename(app, group_id, "renamed")
        assert status == 200
        assert body["data"]["name"] == "renamed"

    def test_rename_disk_failure_rolls_back_earlier_success(self, app):
        """1 platform forward rename works; 2nd platform PermissionError.
        Verify rollback restored the first file and DB row unchanged.
        """
        import web_runner.db as wr_db
        import web_runner.routes.account_groups as ag_route

        group_id = _create_group("原始")
        _insert_authorization(
            group_id,
            "douyin",
            str(ag_route.COOKIES_DIR / "douyin_原始.json"),
        )
        _insert_authorization(
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

        with patch("web_runner.routes.account_groups.os.rename", side_effect=fake_rename):
            status, body = self._post_rename(app, group_id, "新名")

        assert status == 409

        # Verify rollback via the production backend.
        group_row = wr_db.get_database().fetch_one(
            "SELECT name FROM account_groups WHERE id = ?", (group_id,)
        )
        assert group_row["name"] == "原始"

        assert (ag_route.COOKIES_DIR / "douyin_原始.json").exists()
        assert (ag_route.COOKIES_DIR / "kuaishou_原始.json").exists()
        assert not (ag_route.COOKIES_DIR / "douyin_新名.json").exists()
        assert not (ag_route.COOKIES_DIR / "kuaishou_新名.json").exists()
