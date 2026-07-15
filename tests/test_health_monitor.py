"""Tests for web_runner.health_monitor."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from web_runner.health_monitor import (
    _can_notify,
    _determine_health,
    _should_notify,
)


class TestDetermineHealth:
    def test_quick_invalid_returns_invalid(self):
        quick = {"valid": False, "reason": "no_file"}
        assert _determine_health(quick, None, None) == "invalid"

    def test_real_valid_fresh_returns_valid(self):
        quick = {"valid": True, "stale": False}
        last_check = datetime.now(timezone.utc)
        assert _determine_health(quick, True, last_check) == "valid"

    def test_real_invalid_returns_invalid(self):
        quick = {"valid": True, "stale": False}
        last_check = datetime.now(timezone.utc)
        assert _determine_health(quick, False, last_check) == "invalid"

    def test_real_valid_but_very_old_check_returns_expiring_soon(self):
        quick = {"valid": True, "stale": False}
        last_check = datetime.now(timezone.utc) - timedelta(days=8)
        assert _determine_health(quick, True, last_check) == "expiring_soon"

    def test_no_last_check_but_valid_quick_returns_valid(self):
        quick = {"valid": True, "stale": False}
        assert _determine_health(quick, None, None) == "valid"


class TestShouldNotify:
    def test_valid_to_invalid_notifies(self):
        assert _should_notify("valid", "invalid") is True

    def test_valid_to_expiring_notifies(self):
        assert _should_notify("valid", "expiring_soon") is True

    def test_invalid_to_valid_does_not_notify(self):
        assert _should_notify("invalid", "valid") is False

    def test_unknown_to_invalid_does_not_notify(self):
        assert _should_notify("unknown", "invalid") is False


class TestSendHealthNotification:
    def test_notification_fires_on_health_degradation(self, monkeypatch):
        from web_runner.health_monitor import _send_health_notification

        emit_calls = []
        smtp_calls = []

        def _fake_emit(event):
            emit_calls.append(event)

        def _fake_send_smtp_email(to, subject, body):
            smtp_calls.append((to, subject, body))

        monkeypatch.setattr("web_runner.notifications.emit_event", _fake_emit)
        monkeypatch.setattr("web_runner.routes.auth._send_smtp_email", _fake_send_smtp_email)
        monkeypatch.setattr("web_runner.health_monitor._get_user_email", lambda uid: "admin@example.com")
        monkeypatch.setattr("web_runner.routes.auth._public_url", lambda: "https://sau.example.com")

        _send_health_notification("test-account", "douyin", "invalid", "valid", 1)

        assert len(emit_calls) == 1
        assert emit_calls[0].event_type == "cookie.expired"
        assert emit_calls[0].platform == "douyin"
        assert emit_calls[0].account == "test-account"
        assert len(smtp_calls) == 1
        assert smtp_calls[0][0] == "admin@example.com"
        assert "已失效" in smtp_calls[0][1]

    def test_email_disabled_skips_smtp(self, monkeypatch):
        from web_runner.health_monitor import _send_health_notification

        emit_calls = []
        smtp_calls = []

        def _fake_emit(event):
            emit_calls.append(event)

        def _fake_send_smtp_email(to, subject, body):
            smtp_calls.append((to, subject, body))

        monkeypatch.setattr("web_runner.notifications.emit_event", _fake_emit)
        monkeypatch.setattr("web_runner.routes.auth._send_smtp_email", _fake_send_smtp_email)
        monkeypatch.setattr("web_runner.health_monitor._get_user_email", lambda uid: "admin@example.com")
        monkeypatch.setattr("web_runner.routes.auth._public_url", lambda: "https://sau.example.com")
        monkeypatch.setattr(
            "web_runner.health_monitor._get_user_notification_prefs",
            lambda uid: {"email": False, "webhook": True},
        )

        _send_health_notification("test-account", "douyin", "invalid", "valid", 1)

        assert len(emit_calls) == 1
        assert len(smtp_calls) == 0

    def test_webhook_disabled_skips_emit(self, monkeypatch):
        from web_runner.health_monitor import _send_health_notification

        emit_calls = []
        smtp_calls = []

        def _fake_emit(event):
            emit_calls.append(event)

        def _fake_send_smtp_email(to, subject, body):
            smtp_calls.append((to, subject, body))

        monkeypatch.setattr("web_runner.notifications.emit_event", _fake_emit)
        monkeypatch.setattr("web_runner.routes.auth._send_smtp_email", _fake_send_smtp_email)
        monkeypatch.setattr("web_runner.health_monitor._get_user_email", lambda uid: "admin@example.com")
        monkeypatch.setattr("web_runner.routes.auth._public_url", lambda: "https://sau.example.com")
        monkeypatch.setattr(
            "web_runner.health_monitor._get_user_notification_prefs",
            lambda uid: {"email": True, "webhook": False},
        )

        _send_health_notification("test-account", "douyin", "invalid", "valid", 1)

        assert len(emit_calls) == 0
        assert len(smtp_calls) == 1

    def test_both_disabled_sends_nothing(self, monkeypatch):
        from web_runner.health_monitor import _send_health_notification

        emit_calls = []
        smtp_calls = []

        def _fake_emit(event):
            emit_calls.append(event)

        def _fake_send_smtp_email(to, subject, body):
            smtp_calls.append((to, subject, body))

        monkeypatch.setattr("web_runner.notifications.emit_event", _fake_emit)
        monkeypatch.setattr("web_runner.routes.auth._send_smtp_email", _fake_send_smtp_email)
        monkeypatch.setattr("web_runner.health_monitor._get_user_email", lambda uid: "admin@example.com")
        monkeypatch.setattr("web_runner.routes.auth._public_url", lambda: "https://sau.example.com")
        monkeypatch.setattr(
            "web_runner.health_monitor._get_user_notification_prefs",
            lambda uid: {"email": False, "webhook": False},
        )

        _send_health_notification("test-account", "douyin", "invalid", "valid", 1)

        assert len(emit_calls) == 0
        assert len(smtp_calls) == 0


class TestGetUserNotificationPrefs:
    def test_prefs_scoped_to_user_id(self, monkeypatch):
        from web_runner.db import get_database
        from web_runner.health_monitor import _get_user_notification_prefs

        db = get_database()
        db.execute("DELETE FROM account_authorizations")
        db.execute("DELETE FROM account_groups")
        db.execute("DELETE FROM users")
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        db.execute(
            "INSERT INTO users (email, notify_health_email, notify_health_webhook, created_at) VALUES (?, ?, ?, ?)",
            ("a@example.com", True, False, now),
        )
        db.execute(
            "INSERT INTO users (email, notify_health_email, notify_health_webhook, created_at) VALUES (?, ?, ?, ?)",
            ("b@example.com", False, True, now),
        )
        user_a = db.fetch_one("SELECT id FROM users WHERE email = ?", ("a@example.com",))
        user_b = db.fetch_one("SELECT id FROM users WHERE email = ?", ("b@example.com",))

        assert _get_user_notification_prefs(user_a["id"]) == {
            "email": True,
            "webhook": False,
        }
        assert _get_user_notification_prefs(user_b["id"]) == {
            "email": False,
            "webhook": True,
        }

    def test_missing_user_falls_back_to_defaults(self, monkeypatch):
        from web_runner.health_monitor import _get_user_notification_prefs

        assert _get_user_notification_prefs(99999) == {"email": True, "webhook": True}


class TestRunMonitorCycle:
    def test_passes_owner_user_id_to_notification(self, monkeypatch):
        from web_runner.db import get_database
        from web_runner.health_monitor import _run_monitor_cycle

        db = get_database()
        db.execute("DELETE FROM account_authorizations")
        db.execute("DELETE FROM account_groups")
        db.execute("DELETE FROM users")

        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        db.execute(
            "INSERT INTO users (email, notify_health_email, notify_health_webhook, created_at) VALUES (?, ?, ?, ?)",
            ("owner-a@example.com", True, True, now),
        )
        db.execute(
            "INSERT INTO users (email, notify_health_email, notify_health_webhook, created_at) VALUES (?, ?, ?, ?)",
            ("owner-b@example.com", True, True, now),
        )
        user_a = db.fetch_one("SELECT id FROM users WHERE email = ?", ("owner-a@example.com",))
        user_b = db.fetch_one("SELECT id FROM users WHERE email = ?", ("owner-b@example.com",))

        db.execute(
            "INSERT INTO account_groups (name, created, owner_user_id) VALUES (?, ?, ?)",
            ("group-a", now, user_a["id"]),
        )
        db.execute(
            "INSERT INTO account_groups (name, created, owner_user_id) VALUES (?, ?, ?)",
            ("group-b", now, user_b["id"]),
        )
        group_a = db.fetch_one("SELECT id FROM account_groups WHERE name = ?", ("group-a",))
        group_b = db.fetch_one("SELECT id FROM account_groups WHERE name = ?", ("group-b",))

        db.execute(
            "INSERT INTO account_authorizations (group_id, platform, cookie_file, created, last_health) "
            "VALUES (?, ?, ?, ?, ?)",
            (group_a["id"], "douyin", "/tmp/douyin_group-a.json", now, "valid"),
        )
        db.execute(
            "INSERT INTO account_authorizations (group_id, platform, cookie_file, created, last_health) "
            "VALUES (?, ?, ?, ?, ?)",
            (group_b["id"], "bilibili", "/tmp/bilibili_group-b.json", now, "valid"),
        )

        notification_calls = []

        def _fake_send_health_notification(account, platform, health, old_health, user_id):
            notification_calls.append({
                "account": account,
                "platform": platform,
                "health": health,
                "old_health": old_health,
                "user_id": user_id,
            })

        monkeypatch.setattr(
            "web_runner.health_monitor._quick_check_cookie",
            lambda platform, account: {"valid": False, "reason": "no_file"},
        )
        monkeypatch.setattr(
            "web_runner.health_monitor._send_health_notification",
            _fake_send_health_notification,
        )

        asyncio.run(_run_monitor_cycle())

        assert len(notification_calls) == 2

        by_platform = {c["platform"]: c for c in notification_calls}
        assert by_platform["douyin"]["user_id"] == user_a["id"]
        assert by_platform["bilibili"]["user_id"] == user_b["id"]


class TestCanNotify:
    def test_no_last_notification_allows(self):
        assert _can_notify(None) is True

    def test_recent_notification_blocks(self):
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert _can_notify(recent) is False

    def test_old_notification_allows(self):
        old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        assert _can_notify(old) is True


@pytest.fixture
def client():
    """Build a Flask test client with an isolated cookies dir and admin session."""
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
            with c.session_transaction() as sess:
                sess["user_id"] = 1
                sess["role"] = "admin"
            yield c
        wr_utils.COOKIES_DIR = orig_cookies_dir


class TestCheckAuthorizationNow:
    def test_raises_for_missing_auth(self):
        from web_runner.health_monitor import check_authorization_now
        with pytest.raises(ValueError, match="Authorization 99999 not found"):
            check_authorization_now(99999)

    def test_manual_check_updates_health(self, monkeypatch):
        from web_runner.db import get_database
        from web_runner.health_monitor import check_authorization_now

        db = get_database()
        db.execute("DELETE FROM account_authorizations")
        db.execute("DELETE FROM account_groups")
        db.execute("DELETE FROM users")
        db.execute(
            "INSERT INTO users (email, role, created_at) VALUES (?, ?, ?)",
            ("test@example.com", "admin", datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
        user = db.fetch_one("SELECT id FROM users WHERE email = ?", ("test@example.com",))
        owner_id = user["id"]
        db.execute(
            "INSERT INTO account_groups (name, created, owner_user_id) VALUES (?, ?, ?)",
            ("test-group", datetime.now(timezone.utc).isoformat(timespec="seconds"), owner_id),
        )
        group = db.fetch_one("SELECT * FROM account_groups WHERE name = ?", ("test-group",))
        db.execute(
            "INSERT INTO account_authorizations (group_id, platform, cookie_file, created) "
            "VALUES (?, ?, ?, ?)",
            (group["id"], "douyin", "/tmp/douyin_test-group.json", datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
        auth = db.fetch_one("SELECT * FROM account_authorizations WHERE platform = ?", ("douyin",))

        # Patch the async platform checker to avoid launching a browser.
        async def _fake_check(platform, account_name):
            return True

        monkeypatch.setattr(
            "web_runner.health_monitor._check_platform_cookie",
            _fake_check,
        )
        monkeypatch.setattr(
            "web_runner.health_monitor._quick_check_cookie",
            lambda platform, account: {"valid": True, "stale": False},
        )

        result = check_authorization_now(auth["id"])
        assert result["health"] == "valid"
