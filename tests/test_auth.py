"""Tests for email authentication routes."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from web_runner import create_app


@pytest.fixture
def app():
    """Flask test client with isolated temp dir and test SECRET_KEY."""
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


def _login_as(client, email="admin@test.com"):
    """Helper: send code + login, return user dict. Reuses existing user if already created."""
    from web_runner.db import get_database

    db = get_database()

    # Check if user already exists (from a previous _login_as call in same test)
    existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if existing:
        # Just set the session via login endpoint with a fresh code
        with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
            client.post("/api/auth/send-code", json={"email": email})
        row = db.fetch_one(
            "SELECT code FROM verification_codes WHERE email = ? AND purpose = 'login' AND used = 0 ORDER BY created_at DESC LIMIT 1",
            (email,),
        )
        if row:
            resp = client.post("/api/auth/login", json={"email": email, "code": row["code"]})
            if resp.status_code == 200:
                return resp.get_json()["data"]["user"]
        # If rate-limited or code issue, user exists but we can't re-login
        # Return existing user info
        return {"id": existing["id"], "email": existing["email"], "role": existing["role"]}

    # New user: send code + login
    with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
        resp = client.post("/api/auth/send-code", json={"email": email})

    row = db.fetch_one(
        "SELECT code FROM verification_codes WHERE email = ? AND purpose = 'login' AND used = 0 ORDER BY created_at DESC LIMIT 1",
        (email,),
    )
    assert row is not None, f"No verification code found for {email}. send-code response: {resp.get_json()}"
    resp = client.post("/api/auth/login", json={"email": email, "code": row["code"]})
    assert resp.status_code == 200, f"Login failed: {resp.get_json()}"
    return resp.get_json()["data"]["user"]


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

    def test_rate_limit(self, app):
        with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
            app.post("/api/auth/send-code", json={"email": "rate@test.com"})
            resp = app.post("/api/auth/send-code", json={"email": "rate@test.com"})
            assert resp.status_code == 429


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
