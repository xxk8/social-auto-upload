"""Tests for account health API endpoints."""
from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from web_runner import create_app


@pytest.fixture
def client():
    """Build a Flask test client with an isolated cookies dir and admin session."""
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


@pytest.fixture
def seeded_group_and_auth(client):
    from web_runner.db import get_database

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
        ("api-test-group", datetime.now(timezone.utc).isoformat(timespec="seconds"), owner_id),
    )
    group = db.fetch_one("SELECT * FROM account_groups WHERE name = ?", ("api-test-group",))
    db.execute(
        "INSERT INTO account_authorizations (group_id, platform, cookie_file, created) "
        "VALUES (?, ?, ?, ?)",
        (
            group["id"],
            "douyin",
            "/tmp/douyin_api-test-group.json",
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
        ),
    )
    auth = db.fetch_one("SELECT * FROM account_authorizations WHERE platform = ?", ("douyin",))
    return group, auth


class TestGetAuthorizationHealth:
    def test_get_health_returns_unknown_initially(self, client, seeded_group_and_auth):
        _, auth = seeded_group_and_auth
        resp = client.get(f"/api/account-authorizations/{auth['id']}/health")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["health"] == "unknown"

    def test_get_health_404_for_missing_auth(self, client):
        resp = client.get("/api/account-authorizations/99999/health")
        assert resp.status_code == 404


class TestPostAuthorizationHealthCheck:
    def test_manual_check_returns_202(self, client, seeded_group_and_auth, monkeypatch):
        _, auth = seeded_group_and_auth

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

        resp = client.post(f"/api/account-authorizations/{auth['id']}/health-check")
        assert resp.status_code == 202
        data = resp.get_json()
        assert data["success"] is True
        assert data["message"] == "Health check queued"

    def test_manual_check_404_for_missing_auth(self, client):
        resp = client.post("/api/account-authorizations/99999/health-check")
        assert resp.status_code == 404
