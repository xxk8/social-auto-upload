"""Tests for email authentication routes."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from web_runner import create_app

# Canonical _login_as helper lives at tests/_login_helpers.py (sibling-module
# import avoids pytest conftest double-import foot-gun).
from tests._login_helpers import _login_as  # noqa: E402


@pytest.fixture
def app():
    """Flask test client with isolated temp dir and test SECRET_KEY.

    Mirrors ``tests/test_studio.py::app`` + ``tests/test_admin_oauth.py::app``
    line-by-line so the testing convention is uniform. Forces
    ``SAU_AUTH_ENABLED=true`` so the global auth gate is active even
    when the shell env has it disabled — otherwise tests asserting 401
    from unauthenticated requests see 200 (the synthetic local-user
    branch when ``SAU_AUTH_ENABLED=false``).
    """
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "true"}, clear=False):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
    application.config["TESTING"] = True
    application.config["SECRET_KEY"] = "test-secret-key-for-testing"
    with tempfile.TemporaryDirectory() as tmp_dir:
        import web_runner.utils as wr_utils

        orig = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = Path(tmp_dir)
        with application.test_client() as client:
            yield client
        wr_utils.COOKIES_DIR = orig


@pytest.fixture
def app_no_auth():
    """Flask test client with auth disabled."""
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "false", "FLASK_DEBUG": "1"}):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
        application.config["TESTING"] = True
        application.config["SECRET_KEY"] = "test-secret-key"
        with application.test_client() as client:
            yield client


@pytest.fixture(autouse=True)
def _clean_auth_tables():
    """Clean auth-related tables before each test."""
    from web_runner.db import get_database

    db = get_database()
    try:
        db.execute("DELETE FROM verification_codes")
        db.execute("DELETE FROM users")
    except Exception:
        pass  # tables may not exist yet
    yield




class TestHealth:
    def test_health_accessible_without_auth(self, app):
        resp = app.get("/health")
        assert resp.status_code == 200


class TestSendCode:
    def test_invalid_email(self, app):
        resp = app.post("/api/auth/send-code", json={"email": "bad"})
        assert resp.status_code == 400
        assert "邮箱格式不正确" in resp.get_json()["message"]

    def test_empty_email(self, app):
        resp = app.post("/api/auth/send-code", json={"email": ""})
        assert resp.status_code == 400

    def test_smtp_not_configured(self, app):
        with patch.dict("os.environ", {"SAU_SMTP_HOST": ""}, clear=False):
            resp = app.post("/api/auth/send-code", json={"email": "test@example.com"})
            assert resp.status_code == 500
            assert "邮件服务未配置" in resp.get_json()["message"]

    def test_send_code_success(self, app):
        with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
            resp = app.post("/api/auth/send-code", json={"email": "ok@test.com"})
            assert resp.status_code == 200
            assert resp.get_json()["success"] is True

    def test_send_code_mock_smtp_bypass(self, app):
        """SAU_MOCK_SMTP=true bypasses the real SMTP round-trip and
        writes the rendered email to the backend log instead.

        Useful for E2E testing the login flow without standing up
        MailHog / a real SMTP server. The verification code is still
        persisted to `verification_codes` (send_code INSERT runs
        before the email send), so the test user can read the code
        from the DB or the log line.

        Verifies:
          1. /api/auth/send-code returns 200 (NOT 500) when SMTP is
             not configured AND SAU_MOCK_SMTP=true.
          2. The verification code IS persisted to the DB (so
             /api/auth/login can match it on the next call).
          3. The mock branch does NOT touch SAU_SMTP_HOST (so a
             missing host config doesn't 500 the form).
        """
        import os

        from web_runner.db import get_database

        # Wipe host config so the real-SMTP branch would 500 without
        # the mock flag — the bypass must short-circuit BEFORE the
        # `if not all([host, user, password])` check.
        with patch.dict(
            "os.environ",
            {"SAU_SMTP_HOST": "", "SAU_SMTP_USER": "", "SAU_SMTP_PASS": "",
             "SAU_MOCK_SMTP": "true"},
            clear=False,
        ):
            resp = app.post("/api/auth/send-code", json={"email": "mock-send@test.com"})
            assert resp.status_code == 200
            assert resp.get_json()["success"] is True
            # The success branch in `send_code` returns the hardcoded
            # message "验证码已发送" (NOT the mock-smtp message); the
            # mock branch is observable via the backend log and the
            # persisted DB code below.

        # The code is in the DB (still usable for /api/auth/login).
        db = get_database()
        row = db.fetch_one(
            "SELECT code FROM verification_codes WHERE email = ? "
            "AND purpose = 'login' AND used = 0 ORDER BY created_at DESC LIMIT 1",
            ("mock-send@test.com",),
        )
        assert row is not None, "code not persisted — login flow can't proceed"
        assert len(row["code"]) == 6
        assert row["code"].isdigit()

    def test_rate_limit(self, app):
        with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
            app.post("/api/auth/send-code", json={"email": "rate@test.com"})
            resp = app.post("/api/auth/send-code", json={"email": "rate@test.com"})
            assert resp.status_code == 429

    def test_send_code_html_body_multipart_contract(self, app, monkeypatch):
        """Round-email-html-upgrade: the verification email now sends as
        ``multipart/alternative`` with both text/plain AND text/html parts
        that mirror `/login/auth` (LoginAuthPage) visual language.

        Locks these invariants so the next refactor can't silently
        regress to plain-text-only:
          * `_render_verification_email` returns both bodies (not None)
          * html_body contains: the literal code, the project URL,
            sodium-amber ``#d97706`` accent, brand glyph ``>_``
          * plain body still contains the code + URL (fallback path)
          * 420px max-width (lockstep with the React card)
          * Outlook-mobile guard: brand glyph is single-cell-table
            (NOT span+inline-block — Word rendering engine flakes
            on inline-block); code 30px / letter-spacing 0.2em
            (NOT 36px/0.3em which overflows 320px Gmail viewport)
          * Inbox preheader present (Gmail/Outlook list preview)
        """
        # Pin SAU_PUBLIC_URL to the documented default via the
        # monkeypatch fixture — direct `os.environ.get()` read was
        # brittle to leakage from sibling tests' `patch.dict` calls
        # (none currently set it, but the contract pins the default
        # path explicitly so this test stays robust under future
        # test additions).
        monkeypatch.setenv("SAU_PUBLIC_URL", "http://localhost:5180")

        captured = {}
        def capture(to_email, subject, body, html_body=None):
            captured.update({
                "to": to_email, "subject": subject,
                "body": body, "html_body": html_body,
            })
            return (True, "ok")

        with patch(
            "web_runner.routes.auth._send_smtp_email",
            side_effect=capture,
        ):
            resp = app.post("/api/auth/send-code", json={"email": "html-test@test.com"})
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # Both bodies must be populated. Empty text body would
        # defeat the multipart/alternative RFC 2046 §5.1.4 contract
        # (the plain part is the legacy-gateway fallback).
        assert captured["body"], "plain text body required for multipart fallback"
        assert captured["html_body"], "html_body required after HTML upgrade"

        # Pull the actual code from the DB so we can assert it's
        # substituted into both bodies (code is random per request).
        from web_runner.db import get_database

        db = get_database()
        row = db.fetch_one(
            "SELECT code FROM verification_codes "
            "WHERE email = ? AND purpose = 'login' AND used = FALSE "
            "ORDER BY created_at DESC LIMIT 1",
            ("html-test@test.com",),
        )
        assert row is not None
        code = row["code"]

        # Hardcoded to mirror the value pinned above via
        # `monkeypatch.setenv`. Any drift means `_public_url`'s
        # default or the renderer's URL substitution broke —
        # grep ``localhost:5180`` across the repo to find both sides.
        expected_url = "http://localhost:5180"

        html = captured["html_body"]
        plain = captured["body"]

        for label, body in (("html", html), ("plain", plain)):
            assert code in body, f"{label}: missing verification code {code!r}"
            assert expected_url in body, f"{label}: missing project URL {expected_url!r}"

        # HTML must carry the brand-language tokens (locked by DESIGN.md).
        assert "#d97706" in html, "sodium-amber accent missing in HTML body"
        assert "&gt;_" in html or ">_" in html, "brand glyph missing from HTML body"
        # LoginAuthPage font fallback chain — pinned so a future
        # designer doesn't accidentally drop the mono stack.
        assert "IBM Plex Mono" in html, "mono font stack missing from HTML body"
        # Card width lockstep with React card (= 420px max-width).
        assert "max-width:420px" in html, "card width drifted from React LoginAuthPage"
        # RFC 2046 plain-body MUST be the text fallback (not HTML)
        assert "您的登录验证码是" in plain
        # The hidden inbox preheader must be present so Gmail/Outlook
        # inbox-list preview surfaces the verify narrative instead
        # of an empty gap. mso-hide:all is the Outlook-specific
        # marker; the display:none + max-height:0 combo covers
        # the rest.
        assert "mso-hide:all" in html, "inbox preheader (mso-hide:all) missing"
        assert "max-height:0" in html, "inbox preheader (max-height:0) missing"
        # Pre-fix 36px + 0.3em overflowed 320px Gmail iOS viewport;
        # lockstep back to 30px / 0.2em is required for narrow clients.
        assert "font-size:30px" in html, \
            "code font-size drifted (was 30px; pre-fix 36px overflowed mobile)"
        assert "letter-spacing:0.2em" in html, \
            "code letter-spacing drifted (was 0.2em; pre-fix 0.3em overflowed)"
        # Brand glyph chip MUST NOT use span+inline-block — Outlook
        # 2007-2016 (Word rendering engine) renders that combination
        # inconsistently. Single-cell table is the bullet-proof idiom.
        # Brand glyph chip MUST NOT use span+inline-block in inline
        # style — Outlook 2007-2016 (Word rendering engine) renders
        # that combination inconsistently. We test for the CSS-value
        # form ``display:inline-block;`` (closed by semicolon) so
        # explanatory comments mentioning the banned token don't
        # trip a false-positive.
        assert 'display:inline-block;' not in html, \
            "brand glyph chip uses span+inline-block in inline style — Outlook-incompatible"
        # Outlook preheader padding trick — the trailing invisible
        # ``&nbsp;&zwnj;`` span prevents the visible <table> below
        # from being treated as preheader continuation in Word's
        # renderer (round 2 reviewer finding).
        assert '&zwnj;' in html, \
            "Outlook preheader padding (zwnj) markers missing"


class TestLogin:
    def test_first_user_becomes_admin(self, app):
        user = _login_as(app, "first@test.com")
        assert user["role"] == "admin"

    def test_wrong_code(self, app):
        with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
            app.post("/api/auth/send-code", json={"email": "wrong@test.com"})
        resp = app.post("/api/auth/login", json={"email": "wrong@test.com", "code": "000000"})
        assert resp.status_code == 401

    def test_invalid_email_format(self, app):
        resp = app.post("/api/auth/login", json={"email": "bad", "code": "123456"})
        assert resp.status_code == 400

    def test_invalid_code_format(self, app):
        resp = app.post("/api/auth/login", json={"email": "a@b.com", "code": "abc"})
        assert resp.status_code == 400


class TestMe:
    def test_unauthenticated(self, app):
        resp = app.get("/api/auth/me")
        assert resp.status_code == 401

    def test_authenticated(self, app):
        _login_as(app, "me@test.com")
        resp = app.get("/api/auth/me")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["user"]["email"] == "me@test.com"

    def test_shape_extended_with_profile_contract(self, app):
        """Round 7 — GET /api/auth/me returns {name, avatar, tier}.

        Pins the round-7 extension: ProfilePage reads `name`,
        SettingsPage reads `tier`, UserMenu reads `avatar`. New
        `name` and `avatar` columns default to NULL on fresh rows;
        `tier` falls back to 'legacy' if license_tier is unpopulated.
        """
        _login_as(app, "shape@test.com")
        resp = app.get("/api/auth/me")
        assert resp.status_code == 200
        user = resp.get_json()["data"]["user"]
        for key in ("id", "email", "role", "name", "avatar", "tier",
                    "created_at", "last_login"):
            assert key in user, f"missing key: {key}"
        assert user["name"] is None
        assert user["avatar"] is None
        # license_tier column defaults to 'legacy' — a fresh user
        # never went through the license-activate route so falls
        # back to legacy.
        assert user["tier"] == "legacy"

    def test_auth_disabled_branch_has_universal_shape(self, app_no_auth):
        """The auth-disabled branch (SAU_AUTH_ENABLED=false) returns
        the SAME shape as the auth-enabled branch — frontend never
        branches on `user.tier !== undefined`.

        Synthetic user: id=0, email='local@sau.dev', role='admin',
        name='local', avatar=null, tier='legacy'.
        """
        resp = app_no_auth.get("/api/auth/me")
        assert resp.status_code == 200
        user = resp.get_json()["data"]["user"]
        assert user["id"] == 0
        assert user["email"] == "local@sau.dev"
        assert user["role"] == "admin"
        assert user["name"] == "local"
        assert user["avatar"] is None
        assert user["tier"] == "legacy"


class TestPatchMe:
    """Round 7 — PATCH /api/auth/me partial-update contract.

    Validates the mutation surface against:
      * happy path (name + avatar write)
      * field allow-list (role / tier / id mass-assignment rejected)
      * field validation (name length, avatar URL scheme)
      * clearing via null / empty-string
      * auth gating (401 when unauthenticated)
      * response shape (returns updated user via _serialize_user)
    """

    def test_unauthenticated(self, app):
        resp = app.patch("/api/auth/me", json={"name": "x"})
        assert resp.status_code == 401

    def test_happy_path_name(self, app):
        _login_as(app, "patch_name@test.com")
        resp = app.patch("/api/auth/me", json={"name": "补丁测试"})
        assert resp.status_code == 200
        user = resp.get_json()["data"]["user"]
        assert user["name"] == "补丁测试"
        # Round-trips through GET /api/auth/me
        assert app.get("/api/auth/me").get_json()["data"]["user"]["name"] == "补丁测试"

    def test_happy_path_avatar(self, app):
        _login_as(app, "patch_avatar@test.com")
        url = "https://avatars.githubusercontent.com/u/12345?v=4"
        resp = app.patch("/api/auth/me", json={"avatar": url})
        assert resp.status_code == 200
        user = resp.get_json()["data"]["user"]
        assert user["avatar"] == url

    def test_clear_via_null(self, app):
        _login_as(app, "patch_clear@test.com")
        # Seed values
        app.patch("/api/auth/me", json={"name": "seed", "avatar": "https://x.test/a.png"})
        # Clear both in one call
        resp = app.patch("/api/auth/me", json={"name": None, "avatar": None})
        assert resp.status_code == 200
        user = resp.get_json()["data"]["user"]
        assert user["name"] is None
        assert user["avatar"] is None

    def test_clear_via_empty_string(self, app):
        _login_as(app, "patch_clear2@test.com")
        app.patch("/api/auth/me", json={"name": "seed"})
        resp = app.patch("/api/auth/me", json={"name": "   "})
        # Whitespace-only string maps to NULL (per spec — empty +
        # null both clear the column to NULL).
        assert resp.status_code == 200
        assert resp.get_json()["data"]["user"]["name"] is None

    def test_name_strips_whitespace(self, app):
        _login_as(app, "patch_strip@test.com")
        resp = app.patch("/api/auth/me", json={"name": "  前后空白  "})
        assert resp.status_code == 200
        assert resp.get_json()["data"]["user"]["name"] == "前后空白"

    def test_name_too_long_422(self, app):
        _login_as(app, "patch_long@test.com")
        resp = app.patch("/api/auth/me", json={"name": "x" * 81})
        assert resp.status_code == 422
        assert "长度不能超过" in resp.get_json()["message"]

    def test_name_max_len_accepted(self, app):
        _login_as(app, "patch_maxlen@test.com")
        resp = app.patch("/api/auth/me", json={"name": "x" * 80})
        assert resp.status_code == 200
        assert resp.get_json()["data"]["user"]["name"] == "x" * 80

    def test_name_non_string_422(self, app):
        _login_as(app, "patch_int@test.com")
        resp = app.patch("/api/auth/me", json={"name": 12345})
        assert resp.status_code == 422
        assert "字符串" in resp.get_json()["message"]

    def test_avatar_javascript_scheme_rejected(self, app):
        _login_as(app, "patch_js@test.com")
        resp = app.patch("/api/auth/me", json={"avatar": "javascript:alert(1)"})
        assert resp.status_code == 422
        assert "http://" in resp.get_json()["message"]

    def test_avatar_data_scheme_rejected(self, app):
        _login_as(app, "patch_data@test.com")
        # 64KB base64 inline data URL — sample only.
        b64 = "A" * 100
        resp = app.patch("/api/auth/me", json={"avatar": f"data:image/png;base64,{b64}"})
        assert resp.status_code == 422

    def test_avatar_file_scheme_rejected(self, app):
        _login_as(app, "patch_file@test.com")
        resp = app.patch("/api/auth/me", json={"avatar": "file:///etc/passwd"})
        assert resp.status_code == 422

    def test_avatar_too_long_422(self, app):
        _login_as(app, "patch_longurl@test.com")
        resp = app.patch(
            "/api/auth/me",
            json={"avatar": "https://x.test/" + "a" * 2050},
        )
        assert resp.status_code == 422
        assert "URL 长度" in resp.get_json()["message"]

    def test_role_mass_assignment_422(self, app):
        """Anti-privilege-escalation: PATCH must NOT accept `role`.

        The frontend never sends it (no form-like surface exposes
        the field). A misconfigured client that does must hit a 422
        with an explicit message so the bug surfaces loudly rather
        than silently dropping (which would let the client think
        self-escalation worked).
        """
        _login_as(app, "patch_role@test.com")
        resp = app.patch("/api/auth/me", json={"role": "admin"})
        assert resp.status_code == 422
        body = resp.get_json()
        assert "role" in body["message"]

    def test_tier_mass_assignment_422(self, app):
        """Same anti-escalation guard for `tier` / `license_tier`."""
        _login_as(app, "patch_tier@test.com")
        for forbidden in ("tier", "license_tier"):
            resp = app.patch("/api/auth/me", json={forbidden: "pro"})
            assert resp.status_code == 422, f"{forbidden}: expected 422, got {resp.status_code}"
            assert forbidden in resp.get_json()["message"]

    def test_email_mass_assignment_422(self, app):
        """Identity-bound fields (`email`, `id`) cannot be PATCHed.

        Email-change would require re-verification flow; out of
        scope for round 7. Treat as 422 with explicit message.
        """
        _login_as(app, "patch_email@test.com")
        resp = app.patch("/api/auth/me", json={"email": "evil@test.com"})
        assert resp.status_code == 422
        assert "email" in resp.get_json()["message"]

    def test_empty_payload_400(self, app):
        _login_as(app, "patch_empty@test.com")
        # Empty body — no allowed fields.
        resp = app.patch("/api/auth/me", json={})
        assert resp.status_code == 400
        assert "无更新字段" in resp.get_json()["message"]

    def test_unknown_field_silently_dropped(self, app):
        """Forward-compat: unknown fields are dropped, not 422'd.

        Lets the frontend ship newer clients (e.g. an eventual
        `theme` field) without a synchronous backend deploy —
        additive tolerance is a different contract from
        privilege escalation.
        """
        _login_as(app, "patch_unk@test.com")
        resp = app.patch(
            "/api/auth/me",
            json={"name": "valid", "displayName": "typo"},  # unknown -> drop
        )
        assert resp.status_code == 200
        assert resp.get_json()["data"]["user"]["name"] == "valid"

    def test_notification_preferences_shape(self, app):
        """GET /api/auth/me exposes health notification preferences."""
        _login_as(app, "patch_notify_shape@test.com")
        resp = app.get("/api/auth/me")
        assert resp.status_code == 200
        user = resp.get_json()["data"]["user"]
        assert "notify_health_email" in user
        assert "notify_health_webhook" in user
        assert user["notify_health_email"] is True
        assert user["notify_health_webhook"] is True

    def test_patch_notification_preferences(self, app):
        """PATCH /api/auth/me can toggle health notification channels."""
        _login_as(app, "patch_notify@test.com")
        resp = app.patch(
            "/api/auth/me",
            json={"notify_health_email": False, "notify_health_webhook": False},
        )
        assert resp.status_code == 200
        user = resp.get_json()["data"]["user"]
        assert user["notify_health_email"] is False
        assert user["notify_health_webhook"] is False

        # Round-trip through GET
        resp = app.get("/api/auth/me")
        assert resp.get_json()["data"]["user"]["notify_health_email"] is False
        assert resp.get_json()["data"]["user"]["notify_health_webhook"] is False

    def test_notification_preferences_non_boolean_rejected(self, app):
        """Notification preferences must be booleans."""
        _login_as(app, "patch_notify_bad@test.com")
        resp = app.patch("/api/auth/me", json={"notify_health_email": "yes"})
        assert resp.status_code == 422
        assert "布尔值" in resp.get_json()["message"]

    def test_only_patches_own_row(self, app):
        """PATCH only mutates the session's own uid — no horizontal-priv.

        Login as user A. Confirm user B (created via raw DB insert
        before login) is unchanged after user A PATCHes their own
        name.
        """
        from web_runner.db import get_database
        from web_runner.routes.auth import _now_iso

        # Seed user B BEFORE we log in as user A (first user = admin
        # would be user A, but we manually create user B so user A
        # stays admin-not-the-only-existing-row pattern).
        db = get_database()
        _login_as(app, "patch_priv_admin@test.com")  # admin session for insert path
        db.execute(
            "INSERT INTO users (email, role, created_at) VALUES (?, 'user', ?)",
            ("patch_priv_b@test.com", _now_iso()),
        )
        db.execute(
            "UPDATE users SET name = ? WHERE email = ?",
            ("BEFORE", "patch_priv_b@test.com"),
        )

        # Now login fresh as user B (re-auth flow).
        _login_as(app, "patch_priv_b@test.com")

        resp = app.patch("/api/auth/me", json={"name": "AFTER_MINE"})
        assert resp.status_code == 200
        assert resp.get_json()["data"]["user"]["name"] == "AFTER_MINE"

        # user A's name is unaffected.
        a_row = db.fetch_one("SELECT name FROM users WHERE email = ?", ("patch_priv_admin@test.com",))
        assert a_row is None or a_row["name"] is None  # user A never set a name

        # Sanity: user B's name in DB matches what PATCH reported.
        b_row = db.fetch_one("SELECT name FROM users WHERE email = ?", ("patch_priv_b@test.com",))
        assert b_row["name"] == "AFTER_MINE"


class TestLogout:
    def test_logout(self, app):
        _login_as(app, "logout@test.com")
        resp = app.post("/api/auth/logout")
        assert resp.status_code == 200
        resp = app.get("/api/auth/me")
        assert resp.status_code == 401


class TestProtectedEndpoints:
    def test_accounts_requires_auth(self, app):
        resp = app.get("/api/accounts")
        assert resp.status_code == 401

    def test_auth_endpoints_public(self, app):
        resp = app.get("/api/auth/me")
        assert resp.status_code == 401  # 401 means it reached the handler, not the gate


class TestAdminEndpoints:
    def test_list_users(self, app):
        _login_as(app, "admin@test.com")
        resp = app.get("/api/auth/users")
        assert resp.status_code == 200
        assert len(resp.get_json()["data"]) >= 1

    def test_update_role(self, app):
        # Login as admin (first user = admin)
        admin = _login_as(app, "admin_upd@test.com")
        assert admin["role"] == "admin"
        # Create a second user via direct DB insert
        from web_runner.db import get_database

        db = get_database()
        from web_runner.routes.auth import _now_iso

        db.execute(
            "INSERT INTO users (email, role, created_at) VALUES (?, 'user', ?)",
            ("target@test.com", _now_iso()),
        )
        target = db.fetch_one("SELECT id FROM users WHERE email = 'target@test.com'")
        resp = app.put(f"/api/auth/users/{target['id']}/role", json={"role": "admin"})
        assert resp.status_code == 200


class TestSseToken:
    def test_requires_auth(self, app):
        resp = app.get("/api/auth/sse-token")
        assert resp.status_code == 401

    def test_success(self, app):
        _login_as(app, "sse@test.com")
        resp = app.get("/api/auth/sse-token")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "token" in data["data"]
        assert data["data"]["expires_in"] == 300


class TestAuthDisabled:
    def test_allows_access(self, app_no_auth):
        resp = app_no_auth.get("/api/accounts")
        assert resp.status_code != 401
