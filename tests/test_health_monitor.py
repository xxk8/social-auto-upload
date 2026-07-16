"""Tests for web_runner.health_monitor."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

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

    def test_stale_cookie_with_real_valid_returns_expiring_soon(self):
        """Branch (1) from the round-OPT-stale-env follow-up:
        quick={"valid": True, "stale": True}, real_valid=True.

        Lock-in rationale: an old cookie file (>24h since refresh
        by default) whose platform session is still alive must
        collapse to ``expiring_soon``, not ``valid``. The stale
        short-circuit runs BEFORE the ``last_check_at`` age check,
        so even a brand-new real check yields expiring_soon whenever
        the file is stale. This is the soft-fail tier: notify the
        user, don't auto-disconnect — the platform isn't blocking
        them yet but a refresh is recommended before the file goes
        truly invalid on the next cookie rotation.
        """
        quick = {"valid": True, "stale": True}
        last_check = datetime.now(timezone.utc)
        assert _determine_health(quick, True, last_check) == "expiring_soon"

    def test_stale_cookie_with_real_invalid_returns_invalid(self):
        """Branch (2) from the round-OPT-stale-env follow-up:
        quick={"valid": True, "stale": True}, real_valid=False.

        Lock-in rationale: a real cookie_auth failure dominates the
        stale state. ``invalid`` short-circuits at the second ``if``
        (``real_valid is False``) BEFORE the stale check is even
        evaluated. Important property: real failure wins regardless
        of quick state. So a stale-but-otherwise-valid cookie whose
        server session got killed still goes to invalid — the
        operator never sees a misleading "expired but you can still
        upload" state.
        """
        quick = {"valid": True, "stale": True}
        last_check = datetime.now(timezone.utc)
        assert _determine_health(quick, False, last_check) == "invalid"

    def test_non_stale_fresh_with_no_history_returns_valid(self):
        """Branch (3) from the round-OPT-stale-env follow-up:
        quick={"valid": True, "stale": False}, last_check_at=None.

        Lock-in rationale: a freshly-added authorization whose quick
        check passes but for which we have NEVER recorded a real
        check yet (``last_check_at`` is NULL on the row) must default
        to ``valid`` — NOT ``expiring_soon``. Crucially, that
        last_check_at=None branch is the "first time we're looking
        at this" sentinel; if we collapsed to expiring_soon here,
        every new cookie that hasn't yet been Chromium-verified would
        show the wrong color on first render. The expiring_soon tier
        kicks in only AFTER SAU_HEALTH_EXPIRING_DAYS (default 7d) of
        accumulated history — at which point it overrides valid even
        when stale=False.
        """
        quick = {"valid": True, "stale": False}
        assert _determine_health(quick, True, None) == "valid"

    def test_stale_cookie_with_no_real_check_returns_expiring_soon(self):
        """Branch (4) — pinned by reviewer round-1 follow-up:
        quick={"valid": True, "stale": True}, real_valid=None,
        last_check_at=None.

        Lock-in rationale: a freshly-registered authorization whose
        cookie file already exceeds the stale threshold — e.g. an
        operator restored a backup cookie that was older than 24h
        at import time, OR a long-lived cookie aged out between
        schedule-monitor cycles — must NOT silently show ``valid``
        just because no real check has run. The schedule-monitor
        path (``_check_authorization`` with ``force_real_check=False``)
        leaves ``real_valid`` as ``None``, and the stale short-circuit
        must still fire. This complements branch (1) by exercising
        the ``real_valid=None`` variant specifically — which is
        common for the 6h background cycle where ``_needs_real_check``
        returns False for most rows, so ``_check_authorization``
        short-circuits before calling ``_check_with_retry`` and
        ``real_valid`` stays None. Note the retry budget
        (``SAU_HEALTH_RETRIES``) is decoupled from this None-branch:
        it only applies when ``force_real_check=True``; the
        schedule-monitor None-path doesn't enter ``_check_with_retry``
        at all, so ``_HEALTH_RETRIES`` is irrelevant here.
        Companion: ``test_no_last_check_but_valid_quick_returns_valid``
        covers the ``stale=False + real_valid=None`` mirror.
        """
        quick = {"valid": True, "stale": True}
        assert _determine_health(quick, None, None) == "expiring_soon"


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

    def test_manual_check_quick_pass_real_fail_returns_invalid(self, monkeypatch):
        """The 'cookie file looks fine but platform session expired' scenario.

        Lock-in rationale (round-OPT-3F-e2e follow-up):
          * With ``force_real_check=True`` (the new manual default),
            ``_determine_health`` must collapse to ``'invalid'`` when
            ``_quick_check_cookie`` says valid but
            ``cli.platforms.<plat>.check`` returns False. This is the
            canonical "cookie fresh on disk, server session killed" mode.
          * Pre-fix this branch was effectively unreachable when the
            manual endpoint defaulted to force_real_check=False, so a
            stale-but-then-server-expired cookie would have been
            misreported as ``valid`` — a UX lie that paired with the
            "立即检查" button copy. The flipped default and "立即完整验证"
            label are the two halves of the same fix; reverting one
            without the other silently regresses UX.
          * The flip is the kind of behavior change that's easy to
            accidentally roll back when someone tweaks the default
            back to False "to be safe" — this test pins the contract
            so such a flip would manifest as a test failure rather
            than a silent regression in production.
        """
        from web_runner.db import get_database
        from web_runner.health_monitor import check_authorization_now

        db = get_database()
        db.execute("DELETE FROM account_authorizations")
        db.execute("DELETE FROM account_groups")
        db.execute("DELETE FROM users")
        db.execute(
            "INSERT INTO users (email, role, created_at) VALUES (?, ?, ?)",
            (
                "manualcheck-rfail@example.com",
                "admin",
                datetime.now(timezone.utc).isoformat(timespec="seconds"),
            ),
        )
        user = db.fetch_one(
            "SELECT id FROM users WHERE email = ?", ("manualcheck-rfail@example.com",)
        )
        db.execute(
            "INSERT INTO account_groups (name, created, owner_user_id) VALUES (?, ?, ?)",
            (
                "manual-rfail-group",
                datetime.now(timezone.utc).isoformat(timespec="seconds"),
                user["id"],
            ),
        )
        group = db.fetch_one(
            "SELECT * FROM account_groups WHERE name = ?", ("manual-rfail-group",)
        )
        db.execute(
            "INSERT INTO account_authorizations (group_id, platform, cookie_file, created) "
            "VALUES (?, ?, ?, ?)",
            (
                group["id"],
                "douyin",
                "/tmp/douyin_manual-rfail-group.json",
                datetime.now(timezone.utc).isoformat(timespec="seconds"),
            ),
        )
        auth = db.fetch_one(
            "SELECT * FROM account_authorizations WHERE platform = ?", ("douyin",)
        )

        # Cookie file is intact: quick check passes.
        monkeypatch.setattr(
            "web_runner.health_monitor._quick_check_cookie",
            lambda platform, account: {"valid": True, "stale": False},
        )
        # …but the platform session has been killed server-side.
        async def _fake_check_cookie_auth_fails(platform, account_name):
            return False

        monkeypatch.setattr(
            "web_runner.health_monitor._check_platform_cookie",
            _fake_check_cookie_auth_fails,
        )

        # Default invocation — force_real_check=True is now the manual default,
        # so the real branch actually runs in this profile and can flip health
        # to 'invalid' even when quick passes.
        result = check_authorization_now(auth["id"])
        assert result["health"] == "invalid"


class TestCookieStaleHoursEnvVar:
    """``SAU_COOKIE_STALE_HOURS`` env wiring for ``_quick_check_cookie``.

    Lock-in rationale (round-OPT-stale-env follow-up): the constant is
    module-level; tests monkeypatch ``web_runner.utils._COOKIE_STALE_HOURS``
    directly rather than reload the module. Reloading is brittle in
    pytest (import caching + side-effect-order dependencies) so the
    monkeypatch pattern is the project's de-facto test seam for
    module-level SAU_* env vars.
    """

    def test_default_constant_is_24(self):
        """Lock-in the default — any silent change to 24 is intentional."""
        from web_runner import utils as wr_utils
        # The constant is captured at module import; assert it directly.
        assert wr_utils._COOKIE_STALE_HOURS == 24

    def test_env_override_lowering_threshold_marks_cookie_stale(
        self, monkeypatch, tmp_path
    ):
        """Set ``_COOKIE_STALE_HOURS=1``, backdate cookie mtime by 2h, expect ``stale=True``.

        Pins the override behavior so deployments can tune the
        threshold without code changes. Default is 24h; CI/staging
        often want 1h to surface refresh churn immediately.
        Operational note: if ``_COOKIE_STALE_HOURS`` is lowered
        without also bumping ``SAU_HEALTH_EXPIRING_DAYS``, the
        ``age_days >= _EXPIRING_DAYS`` branch in ``_determine_health``
        still drives a separate expiring_soon path for very old
        ``last_check_at`` timestamps — the two knobs compose.
        """
        import os
        import time

        from web_runner import utils as wr_utils

        monkeypatch.setattr(wr_utils, "_COOKIE_STALE_HOURS", 1)
        monkeypatch.setattr(wr_utils, "COOKIES_DIR", tmp_path)

        cookie_file = tmp_path / "douyin_testuser.json"
        cookie_file.write_text(
            '{"cookies":[{"name":"sess","value":"x","domain":".example.com"}],"origins":[]}',
            encoding="utf-8",
        )
        # Backdate mtime by 2 hours — exceeds the 1-hour override.
        past = time.time() - 2 * 3600
        os.utime(cookie_file, (past, past))

        result = wr_utils._quick_check_cookie("douyin", "testuser")
        assert result["valid"] is True
        assert result["stale"] is True
        assert result["reason"] == "stale"


class TestHealthRetriesEnvVar:
    """``SAU_HEALTH_RETRIES`` env wiring + clamp semantics.

    Lock-in rationale (round-OPT-stale-env follow-up): the env var is
    read at module-import time and clamped to [0, 3] by
    ``_clamp_health_retries``. The clamp helper is the testable
    surface — the constant itself is just ``_clamp(int(env))`` at
    load. Pinning the clamp bounds means a future "let's bump the
    cap to 5" PR would manifest as a test failure rather than a
    silent regression in retry-budget behavior.
    """

    def test_clamp_helper_bounds_zero_to_three(self):
        from web_runner.health_monitor import _clamp_health_retries

        # Lower bound: negative input clamps to 0 (disable retries).
        assert _clamp_health_retries(-1) == 0
        assert _clamp_health_retries(-100) == 0
        # Identity range: 0–3 passes through unchanged.
        assert _clamp_health_retries(0) == 0
        assert _clamp_health_retries(1) == 1
        assert _clamp_health_retries(2) == 2
        assert _clamp_health_retries(3) == 3
        # Upper bound: anything >3 clamps to 3 (Chromium-storm cap).
        assert _clamp_health_retries(4) == 3
        assert _clamp_health_retries(100) == 3

    def test_default_constant_is_1(self):
        """Lock-in the default — any silent change to 1 retry is intentional.

        The default 1 retry × 30s timeout = 60s wall-clock budget per
        real check is documented in ``check_authorization_now`` and
        in the Web Shell button ``title`` attr on
        ``SortableAuthorizationItem``. A change here must propagate
        to those copy sources or the user expects a 30s ceiling when
        the actual ceiling is now N*30s.
        """
        from web_runner import health_monitor as hm
        assert hm._HEALTH_RETRIES == 1
