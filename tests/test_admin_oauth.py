"""Tests for admin dashboard routes and OAuth social-login callbacks.

Coverage:
  * Admin routes (overview, users, audit logs, system) — auth gating,
    self-demotion prevention, audit-log side effects, pagination.
  * OAuth callbacks (Google / GitHub) — success paths, missing config,
    missing email, authorize failures, email-list edge cases.

Uses the same test-client fixture pattern as tests/test_auth.py.
"""

from __future__ import annotations

import json as _json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from web_runner import create_app


@pytest.fixture
def app():
    """Flask test client with isolated temp dir and test SECRET_KEY.

    Forces SAU_AUTH_ENABLED=true for the whole test so auth gating is
    active even when the shell environment has it disabled.
    """
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "true"}, clear=False):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
        application.config["TESTING"] = True
        application.config["SECRET_KEY"] = "test-secret-key-for-admin-oauth-tests"
        with tempfile.TemporaryDirectory() as tmp_dir:
            import web_runner.utils as wr_utils

            orig = wr_utils.COOKIES_DIR
            wr_utils.COOKIES_DIR = Path(tmp_dir)
            with application.test_client() as client:
                yield client
            wr_utils.COOKIES_DIR = orig


@pytest.fixture(autouse=True)
def _clean_auth_tables():
    """Clean auth-related tables before each test.

    Wipe order matters: child tables that hold FK references to
    ``users`` (here: ``usage_logs`` + ``tasks``) MUST be cleared BEFORE
    ``DELETE FROM users``. Otherwise SQLite fires an FK IntegrityError
    on the users-dep that gets silently swallowed by the
    ``except Exception: pass`` below — leaving stale rows (and stale
    ``sqlite_sequence`` increments) in place. The visible symptom is
    downstream tests that lose the "first-user-becomes-admin" race
    (the backend sees existing users, assigns ``role="user"`` to the
    freshly-logged-in test admin, and the next ``GET /api/admin/*``
    correctly returns **403 Forbidden**), OR inserts into
    ``usage_logs``/``tasks`` from a previous run trip FK constraints.

    Fix scope: this file only. ``test_studio.py`` and
    ``test_auth_session_rotation.py`` carry their own per-file
    fixtures that already wipe the right tables for their tests; this
    fixture covers the admin/oauth context, which is the only one
    whose tests touch both ``usage_logs`` (cross-cutting) and
    ``tasks`` (admin trends).
    """
    from web_runner.db import get_database

    db = get_database()
    try:
        # Child tables first (FK -> users).
        db.execute("DELETE FROM usage_logs")
        db.execute("DELETE FROM tasks")
        # Then parent + auth tables.
        db.execute("DELETE FROM admin_audit_log")
        db.execute("DELETE FROM verification_codes")
        db.execute("DELETE FROM users")
    except Exception:
        pass
    yield


# Canonical _login_as helper lives at tests/_login_helpers.py
from tests._login_helpers import _login_as  # noqa: E402
def _create_user_direct(email, role="user", name=None, avatar=None):
    """Helper: insert a user directly into the DB (bypasses email login)."""
    from web_runner.db import get_database
    from web_runner.routes.auth import _now_iso

    db = get_database()
    db.execute(
        "INSERT INTO users (email, role, created_at, last_login, name, avatar) VALUES (?, ?, ?, ?, ?, ?)",
        (email, role, _now_iso(), _now_iso(), name, avatar),
    )
    return db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))


def _downgrade_and_relogin(client, email):
    """Helper: downgrade user to 'user' role and re-login to refresh session.

    Inserts a verification code directly to bypass the 60-second rate
    limit that would otherwise fire from a second send-code call.
    """
    from web_runner.db import get_database
    from web_runner.routes.auth import _now_iso

    db = get_database()
    db.execute("UPDATE users SET role = 'user' WHERE email = ?", (email,))
    code = "999999"
    expire = "2099-01-01T00:00:00"
    db.execute(
        "INSERT INTO verification_codes (email, code, purpose, expires_at, used, created_at) "
        "VALUES (?, ?, 'login', ?, 0, ?)",
        (email, code, expire, _now_iso()),
    )
    resp = client.post("/api/auth/login", json={"email": email, "code": code})
    assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════
#  Admin routes
# ═══════════════════════════════════════════════════════════════════════


class TestAdminOverview:
    def test_requires_auth(self, app):
        resp = app.get("/api/admin/overview")
        assert resp.status_code == 401

    def test_requires_admin_role(self, app):
        _login_as(app, "user@test.com")  # first user = admin by default
        _downgrade_and_relogin(app, "user@test.com")
        resp = app.get("/api/admin/overview")
        assert resp.status_code == 403
        assert "权限不足" in resp.get_json()["message"]

    def test_success_shape(self, app):
        admin = _login_as(app, "admin_overview@test.com")
        assert admin["role"] == "admin"
        resp = app.get("/api/admin/overview")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert "data" in data
        for key in ("total_users", "active_today", "total_tasks", "task_success_rate", "recent_actions"):
            assert key in data["data"], f"missing key: {key}"
        # Fresh DB: at least the admin user exists
        assert data["data"]["total_users"] >= 1

    def test_date_range_includes_matching_actions(self, app):
        """Overview recent_actions filtered by date range inclusive."""
        from datetime import datetime, timezone, timedelta
        from web_runner.db import get_database
        from web_runner.routes.auth import _now_iso

        admin = _login_as(app, "admin_overview_range@test.com")
        db = get_database()
        db.execute("DELETE FROM usage_logs")

        now = _now_iso()
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        # Use admin["id"] rather than hardcoded `1` — SQLite AUTOINCREMENT
        # does not reset on DELETE FROM users, so by the time later tests
        # in this class run, the freshly-created admin user inherits a
        # higher id. Threading the actual return value keeps this test
        # deterministic across test ordering AND portable to Postgres.
        db.execute(
            "INSERT INTO usage_logs (user_id, action, created_at) VALUES (?, ?, ?)",
            (admin["id"], "publish", now),
        )
        db.execute(
            "INSERT INTO usage_logs (user_id, action, created_at) VALUES (?, ?, ?)",
            (admin["id"], "ai_generate", yesterday),
        )

        resp = app.get(
            "/api/admin/overview",
            query_string={"start_date": now, "end_date": now},
        )
        assert resp.status_code == 200
        actions = resp.get_json()["data"]["recent_actions"]
        assert len(actions) == 1
        assert actions[0]["action"] == "publish"

    def test_date_range_excludes_outside_actions(self, app):
        """Overview recent_actions outside date range are excluded."""
        from datetime import datetime, timezone, timedelta
        from web_runner.db import get_database
        from web_runner.routes.auth import _now_iso

        admin = _login_as(app, "admin_overview_excl@test.com")
        db = get_database()
        db.execute("DELETE FROM usage_logs")

        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        # Use admin["id"] rather than hardcoded `1` — see the parallel test
        # above for the rationale (AUTOINCREMENT non-reset across tests +
        # Postgres portability — sqlite_sequence reset would not be).
        db.execute(
            "INSERT INTO usage_logs (user_id, action, created_at) VALUES (?, ?, ?)",
            (admin["id"], "publish", yesterday),
        )

        now = _now_iso()
        resp = app.get(
            "/api/admin/overview",
            query_string={"start_date": now, "end_date": now},
        )
        assert resp.status_code == 200
        actions = resp.get_json()["data"]["recent_actions"]
        assert len(actions) == 0


class TestAdminListUsers:
    def test_requires_admin(self, app):
        _login_as(app, "reg_user@test.com")
        _downgrade_and_relogin(app, "reg_user@test.com")
        resp = app.get("/api/admin/users")
        assert resp.status_code == 403

    def test_returns_users_with_tier(self, app):
        _login_as(app, "admin_list@test.com")
        _create_user_direct("u1@test.com", role="user")
        _create_user_direct("u2@test.com", role="admin")
        resp = app.get("/api/admin/users")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert isinstance(data, list)
        emails = {u["email"] for u in data}
        assert "admin_list@test.com" in emails
        assert "u1@test.com" in emails
        assert "u2@test.com" in emails
        # tier defaults to 'legacy' when license_tier is NULL
        for u in data:
            assert "tier" in u
            assert u["tier"] == "legacy"


class TestAdminUpdateRole:
    def test_requires_admin(self, app):
        _login_as(app, "plain_user@test.com")
        _downgrade_and_relogin(app, "plain_user@test.com")
        resp = app.put("/api/admin/users/1/role", json={"role": "user"})
        assert resp.status_code == 403

    def test_self_demotion_blocked(self, app):
        admin = _login_as(app, "self_demote@test.com")
        assert admin["role"] == "admin"
        resp = app.put(f"/api/admin/users/{admin['id']}/role", json={"role": "user"})
        assert resp.status_code == 403
        assert "不能修改自己的角色" in resp.get_json()["message"]

    def test_target_not_found(self, app):
        _login_as(app, "nf_admin@test.com")
        resp = app.put("/api/admin/users/99999/role", json={"role": "user"})
        assert resp.status_code == 404
        assert "用户不存在" in resp.get_json()["message"]

    def test_invalid_role_400(self, app):
        _login_as(app, "bad_role_admin@test.com")
        user = _create_user_direct("bad_role_target@test.com")
        resp = app.put(f"/api/admin/users/{user['id']}/role", json={"role": "superadmin"})
        assert resp.status_code == 400
        assert "admin 或 user" in resp.get_json()["message"]

    def test_same_role_400(self, app):
        _login_as(app, "same_role_admin@test.com")
        user = _create_user_direct("same_role_target@test.com", role="user")
        resp = app.put(f"/api/admin/users/{user['id']}/role", json={"role": "user"})
        assert resp.status_code == 400
        assert "新角色与当前角色相同" in resp.get_json()["message"]

    def test_success_changes_role(self, app):
        _login_as(app, "role_ok_admin@test.com")
        user = _create_user_direct("role_ok_target@test.com", role="user")
        resp = app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["role"] == "admin"
        assert data["data"]["email"] == "role_ok_target@test.com"
        # Verify DB was actually mutated
        from web_runner.db import get_database
        db = get_database()
        row = db.fetch_one("SELECT role FROM users WHERE id = ?", (user["id"],))
        assert row["role"] == "admin"

    def test_success_writes_audit_log(self, app):
        admin = _login_as(app, "audit_admin@test.com")
        user = _create_user_direct("audit_target@test.com", role="user")
        resp = app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})
        assert resp.status_code == 200

        # Verify audit log row exists
        from web_runner.db import get_database

        db = get_database()
        log = db.fetch_one(
            "SELECT * FROM admin_audit_log WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 1",
            (user["id"],),
        )
        assert log is not None
        assert log["admin_user_id"] == admin["id"]
        assert log["action"] == "role_change"
        detail = _json.loads(log["detail"])
        assert detail["old_role"] == "user"
        assert detail["new_role"] == "admin"


class TestAdminAuditLogs:
    def test_requires_admin(self, app):
        _login_as(app, "audit_user@test.com")
        _downgrade_and_relogin(app, "audit_user@test.com")
        resp = app.get("/api/admin/audit")
        assert resp.status_code == 403

    def test_empty_logs(self, app):
        _login_as(app, "empty_audit_admin@test.com")
        resp = app.get("/api/admin/audit")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["logs"] == []
        assert data["total"] == 0
        assert data["page"] == 1

    def test_pagination(self, app):
        admin = _login_as(app, "paginate_admin@test.com")
        # Create 3 users and promote each to generate audit logs
        for i in range(3):
            user = _create_user_direct(f"paginate_{i}@test.com", role="user")
            app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})

        resp = app.get("/api/admin/audit?per_page=2&page=1")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert len(data["logs"]) == 2
        assert data["total"] == 3
        assert data["per_page"] == 2

        # Page 2 returns the remaining 1 log
        resp = app.get("/api/admin/audit?per_page=2&page=2")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert len(data["logs"]) == 1

    def test_logs_include_emails(self, app):
        admin = _login_as(app, "email_audit_admin@test.com")
        user = _create_user_direct("email_audit_target@test.com", role="user")
        app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})

        resp = app.get("/api/admin/audit")
        assert resp.status_code == 200
        log = resp.get_json()["data"]["logs"][0]
        assert "admin_email" in log
        assert "target_email" in log
        assert log["admin_email"] == "email_audit_admin@test.com"
        assert log["target_email"] == "email_audit_target@test.com"

    def test_per_page_clamped(self, app):
        _login_as(app, "clamp_admin@test.com")
        # per_page > 100 should be clamped to 100
        resp = app.get("/api/admin/audit?per_page=500")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["per_page"] == 100

    def test_page_and_per_page_clamped_to_min_1(self, app):
        _login_as(app, "clamp_min_admin@test.com")
        # page=0 and per_page=0 should both be clamped to 1
        resp = app.get("/api/admin/audit?page=0&per_page=0")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["page"] == 1
        assert data["per_page"] == 1

    def test_date_range_filter(self, app):
        """Audit logs can be filtered by start_date / end_date."""
        admin = _login_as(app, "range_admin@test.com")
        user = _create_user_direct("range_target@test.com", role="user")

        # Generate a role-change audit log with a known timestamp
        app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})

        # Query with a very broad range — should include the log
        from datetime import datetime, timezone, timedelta
        today = datetime.now(timezone.utc)
        start = (today - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
        end = (today + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
        resp = app.get(f"/api/admin/audit?start_date={start}&end_date={end}")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["total"] >= 1

    def test_date_range_filter_excludes_outside(self, app):
        """Logs outside the date range are excluded from results."""
        admin = _login_as(app, "range_excl_admin@test.com")
        user = _create_user_direct("range_excl_target@test.com", role="user")
        app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})

        from datetime import datetime, timezone, timedelta
        today = datetime.now(timezone.utc)
        # Use a range entirely in the past — should exclude the freshly created log
        start = (today - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%S")
        end = (today - timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S")
        resp = app.get(f"/api/admin/audit?start_date={start}&end_date={end}")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["total"] == 0
        assert resp.get_json()["data"]["logs"] == []

    def test_date_range_single_boundary(self, app):
        """start_date alone or end_date alone should not crash."""
        admin = _login_as(app, "range_single_admin@test.com")
        user = _create_user_direct("range_single_target@test.com", role="user")
        app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})

        from datetime import datetime, timezone, timedelta
        today = datetime.now(timezone.utc)
        start = (today - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")

        # Only start_date
        resp = app.get(f"/api/admin/audit?start_date={start}")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["total"] >= 1

        # Only end_date
        end = (today + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
        resp = app.get(f"/api/admin/audit?end_date={end}")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["total"] >= 1

    def test_unacknowledged_count_requires_admin(self, app):
        _login_as(app, "unack_user@test.com")
        _downgrade_and_relogin(app, "unack_user@test.com")
        resp = app.get("/api/admin/audit/unacknowledged-count")
        assert resp.status_code == 403

    def test_unacknowledged_count_returns_zero_when_empty(self, app):
        _login_as(app, "unack_empty_admin@test.com")
        resp = app.get("/api/admin/audit/unacknowledged-count")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["count"] == 0

    def test_unacknowledged_count_increments_after_role_change(self, app):
        admin = _login_as(app, "unack_count_admin@test.com")
        user = _create_user_direct("unack_count_target@test.com", role="user")
        app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})

        resp = app.get("/api/admin/audit/unacknowledged-count")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["count"] == 1

    def test_acknowledge_requires_admin(self, app):
        _login_as(app, "ack_user@test.com")
        _downgrade_and_relogin(app, "ack_user@test.com")
        resp = app.post("/api/admin/audit/acknowledge")
        assert resp.status_code == 403

    def test_acknowledge_resets_count_to_zero(self, app):
        admin = _login_as(app, "ack_admin@test.com")
        user = _create_user_direct("ack_target@test.com", role="user")
        app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})

        # Pre-acknowledge count is 1
        resp = app.get("/api/admin/audit/unacknowledged-count")
        assert resp.get_json()["data"]["count"] == 1

        # Acknowledge
        resp = app.post("/api/admin/audit/acknowledge")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["updated"] == 1

        # Post-acknowledge count is 0
        resp = app.get("/api/admin/audit/unacknowledged-count")
        assert resp.get_json()["data"]["count"] == 0

    def test_acknowledge_is_idempotent(self, app):
        admin = _login_as(app, "ack_idem_admin@test.com")
        user = _create_user_direct("ack_idem_target@test.com", role="user")
        app.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"})

        # First acknowledge
        resp = app.post("/api/admin/audit/acknowledge")
        assert resp.get_json()["data"]["updated"] == 1

        # Second acknowledge — nothing left to update
        resp = app.post("/api/admin/audit/acknowledge")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["updated"] == 0

    def test_acknowledge_only_affects_unacknowledged(self, app):
        """Acknowledge should not touch already-acknowledged rows."""
        admin = _login_as(app, "ack_partial_admin@test.com")
        user1 = _create_user_direct("ack_partial_1@test.com", role="user")
        user2 = _create_user_direct("ack_partial_2@test.com", role="user")
        app.put(f"/api/admin/users/{user1['id']}/role", json={"role": "admin"})
        app.put(f"/api/admin/users/{user2['id']}/role", json={"role": "admin"})

        # Acknowledge once — both should be marked
        resp = app.post("/api/admin/audit/acknowledge")
        assert resp.get_json()["data"]["updated"] == 2

        # Generate a NEW unacknowledged log
        user3 = _create_user_direct("ack_partial_3@test.com", role="user")
        app.put(f"/api/admin/users/{user3['id']}/role", json={"role": "admin"})

        # Count should be 1 (only the new one)
        resp = app.get("/api/admin/audit/unacknowledged-count")
        assert resp.get_json()["data"]["count"] == 1

        # Acknowledge again — only the new one
        resp = app.post("/api/admin/audit/acknowledge")
        assert resp.get_json()["data"]["updated"] == 1


class TestAdminSystem:
    def test_requires_admin(self, app):
        _login_as(app, "sys_user@test.com")
        _downgrade_and_relogin(app, "sys_user@test.com")
        resp = app.get("/api/admin/system")
        assert resp.status_code == 403

    def test_success_shape(self, app):
        _login_as(app, "sys_admin@test.com")
        resp = app.get("/api/admin/system")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        for key in ("tasks_by_status", "tasks_by_platform", "errors_by_type"):
            assert key in data, f"missing key: {key}"
        assert isinstance(data["tasks_by_status"], dict)
        assert isinstance(data["tasks_by_platform"], dict)
        assert isinstance(data["errors_by_type"], dict)


class TestAdminTrends:
    """Tests for GET /api/admin/trends?metric=X&days=N.

    Coverage:
      * Auth gating (401 unauth, 403 non-admin).
      * Metric validation (400 on unknown metric, 200 on each of the 4).
      * Days clamping (raw_days is silently clamped to 1..90).
      * Success shape (series length always exactly ``days``).
      * Cumulative / windowed semantics (cumulative metrics grow
        monotonically, point metric reflects windowed count).
    """

    def test_requires_auth(self, app):
        resp = app.get("/api/admin/trends?metric=total_users&days=14")
        assert resp.status_code == 401

    def test_requires_admin_role(self, app):
        _login_as(app, "trends_user@test.com")
        _downgrade_and_relogin(app, "trends_user@test.com")
        resp = app.get("/api/admin/trends?metric=total_users&days=14")
        assert resp.status_code == 403
        assert "权限不足" in resp.get_json()["message"]

    def test_invalid_metric_returns_400(self, app):
        _login_as(app, "trends_admin@test.com")
        resp = app.get("/api/admin/trends?metric=not_a_real_metric&days=14")
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["success"] is False
        # Allow-list is reflected back in the error message so callers
        # know which metric keys are valid. (Asserting on a real metric
        # name catches a future regression that returns a generic
        # "invalid" string instead of echoing the allow-list.)
        assert "total_users" in data["message"]

    def test_days_clamped_to_max_90(self, app):
        """days=999 should be silently clamped to 90, not 500."""
        _login_as(app, "trends_clamp_admin@test.com")
        resp = app.get("/api/admin/trends?metric=total_users&days=999")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["days"] == 90
        # Series length is always exactly `days`.
        assert len(data["points"]) == 90

    def test_days_clamped_to_min_1(self, app):
        """days=0 AND days=-5 should be silently clamped to 1, not 500."""
        _login_as(app, "trends_clamp_min_admin@test.com")
        for bad_days in ("0", "-5"):
            resp = app.get(f"/api/admin/trends?metric=active_today&days={bad_days}")
            assert resp.status_code == 200, f"days={bad_days} returned {resp.status_code}"
            data = resp.get_json()["data"]
            assert data["days"] == 1
            assert len(data["points"]) == 1

    def test_default_days_is_14(self, app):
        """Omitting `days` returns a 14-point series."""
        _login_as(app, "trends_default_admin@test.com")
        resp = app.get("/api/admin/trends?metric=total_users")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["days"] == 14
        assert len(data["points"]) == 14

    def test_success_shape_for_all_four_metrics(self, app):
        """All 4 allow-listed metrics return a valid series shape."""
        _login_as(app, "trends_all_admin@test.com")
        for metric in ("total_users", "active_today", "total_tasks", "task_success_rate"):
            resp = app.get(f"/api/admin/trends?metric={metric}&days=7")
            assert resp.status_code == 200, f"{metric} returned {resp.status_code}"
            data = resp.get_json()["data"]
            assert data["metric"] == metric
            assert data["days"] == 7
            assert len(data["points"]) == 7
            # All entries are numbers (cumulative / point / rate can be
            # int or float — type stability is the contract).
            for v in data["points"]:
                assert isinstance(v, (int, float))

    def test_cumulative_total_users_grows_monotonically(self, app):
        """`total_users` is cumulative — series should be non-decreasing."""
        from web_runner.db import get_database

        _login_as(app, "trends_cum_admin@test.com")
        db = get_database()
        # Seed 2 users so the cumulative is non-zero.
        from web_runner.routes.auth import _now_iso
        now = _now_iso()
        # No try/except: if the insert fails (e.g. FK / uniqueness
        # violation from leftover rows the autouse fixture didn't
        # catch), the test should fail loudly with a clear error
        # rather than silently passing with `points[-1] == 2` instead
        # of the expected 3.
        db.execute(
            "INSERT INTO users (email, role, created_at) VALUES (?, ?, ?)",
            ("seed_a@test.com", "user", now),
        )
        db.execute(
            "INSERT INTO users (email, role, created_at) VALUES (?, ?, ?)",
            ("seed_b@test.com", "user", now),
        )

        resp = app.get("/api/admin/trends?metric=total_users&days=14")
        assert resp.status_code == 200
        points = resp.get_json()["data"]["points"]
        # Cumulative: each point ≥ previous (no dip).
        for i in range(1, len(points)):
            assert points[i] >= points[i - 1], (
                f"cumulative metric dropped at index {i}: {points[i-1]} → {points[i]}"
            )
        # Last point is EXACTLY 3: 1 admin (created by the login) + 2
        # seeds, all stamped at "now" so they all fall on day 1. Using
        # `==` (not `>=`) catches over-counting regressions — e.g. a
        # future refactor that double-counts the seed insert or
        # re-runs the cumulative walk twice.
        assert points[-1] == 3

    def test_task_success_rate_returns_zero_when_no_tasks(self, app):
        """Zero-division path: with 0 tasks, every point in the rate series
        is 0.0 (not NaN, not crash, not a 500)."""
        from web_runner.db import get_database

        _login_as(app, "rate_zero_admin@test.com")
        db = get_database()
        # Clear any tasks from prior tests so the zero-division path
        # is the only one exercised.
        try:
            db.execute("DELETE FROM tasks")
        except Exception:
            pass

        resp = app.get("/api/admin/trends?metric=task_success_rate&days=14")
        assert resp.status_code == 200
        points = resp.get_json()["data"]["points"]
        assert len(points) == 14
        # 0/0 is guarded — every point is 0.0 (a number, not None / NaN).
        for v in points:
            assert v == 0.0
            assert isinstance(v, float)

    def test_task_success_rate_all_success_on_today(self, app):
        """All-success seed on today: the most recent 7-day rolling window
        is 100% (3 successes / 3 total). Older windows have 0 tasks so
        they hit the zero-division path (0.0%)."""
        from web_runner.db import get_database
        from datetime import datetime, timezone, timedelta

        _login_as(app, "rate_all_admin@test.com")
        db = get_database()
        try:
            db.execute("DELETE FROM tasks")
        except Exception:
            pass

        # Seed 3 successful tasks on the 3 most recent days.
        now = datetime.now(timezone.utc)
        for i in range(3):
            ts = (now - timedelta(days=i)).isoformat()
            db.execute(
                "INSERT INTO tasks (status, created) VALUES (?, ?)",
                ("success", ts),
            )

        resp = app.get("/api/admin/trends?metric=task_success_rate&days=14")
        assert resp.status_code == 200
        points = resp.get_json()["data"]["points"]
        # The last 3 points each have a 7-day window containing the
        # 3 successful tasks — every window is 3/3 = 100.0%.
        for v in points[-3:]:
            assert v == 100.0

    def test_task_success_rate_mixed_on_today(self, app):
        """Mixed seed on today: 1 success + 1 fail on today → 50% for the
        most-recent 7-day rolling window. Older windows have 0 tasks so
        they hit the zero-division path (0.0%)."""
        from web_runner.db import get_database
        from datetime import datetime, timezone

        _login_as(app, "rate_mix_admin@test.com")
        db = get_database()
        # No try/except around the DELETE — the tasks table is part of
        # the standard schema; a failure here means the test environment
        # is broken, not that the test should silently pass.
        db.execute("DELETE FROM tasks")

        now_iso = datetime.now(timezone.utc).isoformat()
        db.execute(
            "INSERT INTO tasks (status, created) VALUES (?, ?)",
            ("success", now_iso),
        )
        db.execute(
            "INSERT INTO tasks (status, created) VALUES (?, ?)",
            ("fail", now_iso),
        )

        resp = app.get("/api/admin/trends?metric=task_success_rate&days=14")
        assert resp.status_code == 200
        points = resp.get_json()["data"]["points"]
        # 7-day rolling window ending at index 13 (today): 1 success + 1
        # fail → 1/2 = 50.0%. Older windows have 0 tasks → 0.0% (the
        # zero-division guard, NOT a NaN or skip).
        assert points[-1] == 50.0
        # All older points hit zero-division (no tasks in window).
        for v in points[:-1]:
            assert v == 0.0

    def test_task_success_rate_warmup_window_excludes_old_data(self, app):
        """Locks the warm-up behavior: data on day 14 (oldest) is excluded
        from the 7-day window of the last 3 days, so it does NOT inflate
        the most-recent rate. This protects against a future refactor
        that accidentally widens the window to the entire series.
        """
        from web_runner.db import get_database
        from datetime import datetime, timezone, timedelta

        _login_as(app, "rate_warmup_admin@test.com")
        db = get_database()
        db.execute("DELETE FROM tasks")

        # 1 SUCCESS on day 14 (oldest, 13 days ago) + 1 FAIL on day 1
        # (newest, today). 7-day window at index 13 covers indices
        # 7..13 — which includes day 1 (the fail) but NOT day 14
        # (the success, which is at index 0). So the last point's
        # rate is 0.0%, NOT 50.0% (a window that included the entire
        # series would land at 50.0%).
        now = datetime.now(timezone.utc)
        day_14 = (now - timedelta(days=13)).isoformat()
        day_1 = now.isoformat()
        db.execute(
            "INSERT INTO tasks (status, created) VALUES (?, ?)",
            ("success", day_14),
        )
        db.execute(
            "INSERT INTO tasks (status, created) VALUES (?, ?)",
            ("fail", day_1),
        )

        resp = app.get("/api/admin/trends?metric=task_success_rate&days=14")
        assert resp.status_code == 200
        points = resp.get_json()["data"]["points"]
        # Last point's 7-day window is [7, 13] — day 14 (index 0) is
        # excluded, so only the fail (index 13) is in the window →
        # 0% success rate, not 50%.
        assert points[-1] == 0.0
        # First point's window is [0, 0] — day 14 (index 0) IS in the
        # window, so 100% success rate (1 success / 1 total).
        assert points[0] == 100.0


class TestAdminTrendsExport:
    """Tests for GET /api/admin/trends/export (streaming CSV).

    Coverage:
      * Auth gating (401 unauth, 403 non-admin).
      * Metric validation (400 on unknown metric).
      * Default (no metric) returns 5-column CSV with UTF-8 BOM,
        content-disposition attachment, and a 14-row body.
      * With `metric` returns 2-column CSV.
      * Audit log entry is written for every export (action
        ``export_trends`` with detail JSON {metric, days, row_count,
        file_format}). This satisfies the design doc §16.3
        "导出操作需记录到 admin_audit_log" contract.
    """

    def test_requires_auth(self, app):
        resp = app.get("/api/admin/trends/export")
        assert resp.status_code == 401

    def test_requires_admin_role(self, app):
        _login_as(app, "exp_user@test.com")
        _downgrade_and_relogin(app, "exp_user@test.com")
        resp = app.get("/api/admin/trends/export")
        assert resp.status_code == 403

    def test_invalid_metric_returns_400(self, app):
        _login_as(app, "exp_bad_admin@test.com")
        resp = app.get("/api/admin/trends/export?metric=not_a_real_metric")
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["success"] is False
        # Allow-list is reflected back in the error message.
        assert "total_users" in data["message"]

    def test_default_returns_5_column_csv_with_bom_and_audit_log(self, app):
        admin = _login_as(app, "exp_5col_admin@test.com")
        resp = app.get("/api/admin/trends/export?days=5")
        assert resp.status_code == 200

        # Content-Type starts with text/csv (charset suffix allowed).
        ct = resp.headers["Content-Type"]
        assert ct.startswith("text/csv"), f"unexpected Content-Type: {ct}"

        # Content-Disposition is an attachment with the days-in-filename.
        cd = resp.headers["Content-Disposition"]
        assert "attachment" in cd
        assert "sau-trends-all-5d-" in cd

        # UTF-8 BOM is the FIRST byte of the body, followed by the
        # 5-column header. The BOM is what lets Excel-CN auto-detect
        # the encoding without the "Data → From Text/CSV" wizard.
        body = resp.get_data(as_text=True)
        assert body.startswith("\ufeff"), "missing UTF-8 BOM"
        lines = body.lstrip("\ufeff").strip().split("\n")
        assert len(lines) == 6  # 1 header + 5 data rows
        assert (
            lines[0]
            == "date,total_users,active_today,total_tasks,task_success_rate"
        )
        # Every data row has exactly 5 columns.
        for row in lines[1:]:
            cols = row.split(",")
            assert len(cols) == 5, f"row should have 5 cols: {row!r}"
            # Date col is ISO YYYY-MM-DD.
            assert len(cols[0]) == 10 and cols[0][4] == "-" and cols[0][7] == "-"
            # Value cols are numeric.
            for v in cols[1:]:
                float(v)  # raises if not numeric

        # Audit log entry was written BEFORE the stream returned so
        # even a client-aborted download is durably recorded.
        from web_runner.db import get_database

        db = get_database()
        log = db.fetch_one(
            "SELECT * FROM admin_audit_log WHERE action = 'export_trends' "
            "ORDER BY id DESC LIMIT 1"
        )
        assert log is not None
        assert log["admin_user_id"] == admin["id"]
        # target_user_id is NULL (no user is targeted by a trends export).
        assert log["target_user_id"] is None
        detail = _json.loads(log["detail"])
        assert detail["metric"] == "all"
        assert detail["days"] == 5
        assert detail["row_count"] == 5
        assert detail["file_format"] == "csv"

    def test_with_metric_returns_2_column_csv(self, app):
        _login_as(app, "exp_2col_admin@test.com")
        resp = app.get("/api/admin/trends/export?metric=total_users&days=3")
        assert resp.status_code == 200
        ct = resp.headers["Content-Type"]
        assert ct.startswith("text/csv")
        cd = resp.headers["Content-Disposition"]
        # Filename includes the per-metric scope, not "all".
        assert "sau-trends-total_users-3d-" in cd

        body = resp.get_data(as_text=True)
        assert body.startswith("\ufeff")
        lines = body.lstrip("\ufeff").strip().split("\n")
        assert len(lines) == 4  # 1 header + 3 data rows
        assert lines[0] == "date,value"
        for row in lines[1:]:
            cols = row.split(",")
            assert len(cols) == 2, f"row should have 2 cols: {row!r}"

        # Per-metric export also writes an audit log row (same
        # `export_trends` action, scope carried via the detail
        # JSON's `metric` field). The 5-col test pins the same
        # contract for the all-metrics scope; this one locks the
        # per-metric path so a future refactor can't drop the
        # audit row for the "single column" code path.
        from web_runner.db import get_database

        db = get_database()
        log = db.fetch_one(
            "SELECT * FROM admin_audit_log WHERE action = 'export_trends' "
            "ORDER BY id DESC LIMIT 1"
        )
        assert log is not None
        # Capture the admin's id BEFORE the next call so the
        # assert can compare to the audit log row's admin_user_id
        # without depending on `_login_as` returning the same shape
        # across versions of the helper.
        admin_id_for_assert = log["admin_user_id"]
        assert admin_id_for_assert is not None
        detail = _json.loads(log["detail"])
        assert detail["metric"] == "total_users"
        assert detail["days"] == 3
        assert detail["row_count"] == 3
        assert detail["file_format"] == "csv"


# ═══════════════════════════════════════════════════════════════════════
#  OAuth — Google
# ═══════════════════════════════════════════════════════════════════════


class TestOAuthGoogleLogin:
    def test_redirects_when_not_configured(self, app):
        """When GOOGLE_CLIENT_ID is missing, login redirects with error param."""
        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "", "GOOGLE_CLIENT_SECRET": ""}, clear=False):
            # Re-create app so oauth register() sees empty env
            with patch("web_runner.utils._sync_cookie_files_to_db"):
                application = create_app()
            application.config["TESTING"] = True
            with application.test_client() as client:
                resp = client.get("/api/auth/google/login", follow_redirects=False)
                assert resp.status_code == 302
                assert "/login?error=oauth_not_configured" in resp.headers["Location"]

    def test_oauth_callback_redirect_uses_frontend_origin(self, app):
        """Pin the v2 fix: callback redirects target the FRONTEND origin, not the backend.

        Without `_frontend_url`, the redirect would be a relative path
        like '/login?error=oauth_not_configured' that the browser resolves
        against the backend (since the OAuth callback returns to :6001),
        causing a 404 (the original bug). This test pins the absolute
        URL form so a future refactor that drops `_frontend_url` is
        caught by CI rather than re-introducing the 404 in production.

        Same assertion for github's not-configured branch — both clients
        must route the error through `_frontend_url`.
        """
        # Google: client not configured branch
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=None):
            resp = app.get("/api/auth/google/callback", follow_redirects=False)
            assert resp.status_code == 302
            loc = resp.headers["Location"]
            # Must be an ABSOLUTE URL on the frontend origin (not relative).
            assert loc.startswith("http://localhost:5180/"), f"expected absolute frontend URL, got {loc!r}"
            # And not the relative-path form (the bug we're guarding against).
            assert not loc.startswith("/login"), f"relative path would hit backend 404: {loc!r}"
            assert "/login?error=oauth_not_configured" in loc

        # GitHub: same contract for the not-configured branch.
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=None):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            loc = resp.headers["Location"]
            assert loc.startswith("http://localhost:5180/"), f"expected absolute frontend URL, got {loc!r}"
            assert not loc.startswith("/login"), f"relative path would hit backend 404: {loc!r}"


def test_frontend_url_handles_empty_env_var():
    """Pin the v2 fix: SAU_FRONTEND_URL='' must fall back to the dev default.

    Without the `or` short-circuit on `os.environ.get`, an empty value
    in .env (e.g. user commented out the line by setting it to empty)
    silently re-introduces the original 404 bug: the relative path
    `redirect('/dashboard')` would resolve to the backend origin and 404.

    `FRONTEND_URL` is computed at module import, so this test must
    `importlib.reload` the module under the patched env to re-evaluate
    the module-level constant. The reload is contained in this single
    test (no other test depends on the post-patch module state).
    """
    import importlib

    from web_runner.routes import oauth as oauth_routes

    with patch.dict("os.environ", {"SAU_FRONTEND_URL": ""}, clear=False):
        importlib.reload(oauth_routes)
        try:
            # After reload, FRONTEND_URL must equal the dev default
            # (NOT the empty string the env-var would otherwise return).
            assert oauth_routes.FRONTEND_URL == "http://localhost:5180", (
                f"empty SAU_FRONTEND_URL should fall back to dev default, "
                f"got {oauth_routes.FRONTEND_URL!r}"
            )
            # The helper must produce an absolute URL (NOT a relative path
            # that the browser would resolve against the backend origin).
            assert oauth_routes._frontend_url("/dashboard") == "http://localhost:5180/dashboard"
            # Trailing-slash path with query string — the contract covers
            # all the redirect call sites' arg shapes.
            assert oauth_routes._frontend_url("/login?error=google_failed") == (
                "http://localhost:5180/login?error=google_failed"
            )
        finally:
            # Restore the module to its pre-test state so other tests
            # (e.g. the `app` fixture, which calls create_app() and
            # registers oauth_routes.bp) see the original env-driven
            # FRONTEND_URL. Without this, a test that runs AFTER this
            # one would inherit the empty-env reload.
            importlib.reload(oauth_routes)

    def test_authorize_redirect_when_configured(self, app):
        """When configured, Google login calls authorize_redirect on the client."""
        mock_client = MagicMock()
        mock_client.authorize_redirect.return_value = "redirected"
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            with patch.dict(
                "os.environ",
                {"GOOGLE_CLIENT_ID": "g_id", "GOOGLE_CLIENT_SECRET": "g_secret"},
                clear=False,
            ):
                with patch("web_runner.utils._sync_cookie_files_to_db"):
                    application = create_app()
                application.config["TESTING"] = True
                with application.test_client() as client:
                    # Flask test client doesn't follow redirects by default,
                    # but authorize_redirect returns a Response object in authlib.
                    # We mock it to return a plain string which the test client
                    # wraps into a 200 response.
                    resp = client.get("/api/auth/google/login")
                    mock_client.authorize_redirect.assert_called_once()


def _mock_github_client(profile, emails):
    """Build a mock GitHub OAuth client that returns the given profile + emails."""
    mock_client = MagicMock()
    mock_client.authorize_access_token.return_value = {"access_token": "tok"}
    user_resp = MagicMock()
    user_resp.json.return_value = profile
    email_resp = MagicMock()
    email_resp.json.return_value = emails
    mock_client.get.side_effect = lambda url, token=None: (
        user_resp if url == "user" else email_resp
    )
    return mock_client


class TestOAuthGoogleCallback:
    def test_not_configured_redirect(self, app):
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=None):
            resp = app.get("/api/auth/google/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert "/login?error=oauth_not_configured" in resp.headers["Location"]

    def test_success_new_user(self, app):
        mock_client = MagicMock()
        mock_client.authorize_access_token.return_value = {
            "userinfo": {
                "email": "google_new@test.com",
                "name": "Google User",
                "picture": "https://example.com/pic.png",
            }
        }
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/google/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert resp.headers["Location"].endswith("/dashboard")
            # Verify user was created
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("google_new@test.com",))
            assert user is not None
            assert user["name"] == "Google User"
            assert user["avatar"] == "https://example.com/pic.png"
            # Verify session is active
            me_resp = app.get("/api/auth/me")
            assert me_resp.status_code == 200
            assert me_resp.get_json()["data"]["user"]["email"] == "google_new@test.com"

    def test_success_existing_user(self, app):
        """Existing user logs in via Google — updates last_login, preserves data."""
        _create_user_direct("google_existing@test.com", name="Old Name", avatar="https://old.png")
        mock_client = MagicMock()
        mock_client.authorize_access_token.return_value = {
            "userinfo": {
                "email": "google_existing@test.com",
                "name": "New Name",
                "picture": "https://new.png",
            }
        }
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/google/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert resp.headers["Location"].endswith("/dashboard")
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("google_existing@test.com",))
            assert user["name"] == "New Name"
            assert user["avatar"] == "https://new.png"
            assert user["last_login"] is not None

    def test_no_email_redirect(self, app):
        mock_client = MagicMock()
        mock_client.authorize_access_token.return_value = {"userinfo": {}}
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/google/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert "/login?error=no_email" in resp.headers["Location"]

    def test_authorize_access_token_failure(self, app):
        mock_client = MagicMock()
        mock_client.authorize_access_token.side_effect = Exception("token_error")
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            with patch("utils.log.logger.warning") as mock_log:
                resp = app.get("/api/auth/google/callback", follow_redirects=False)
                assert resp.status_code == 302
                assert "/login?error=google_failed" in resp.headers["Location"]
                mock_log.assert_called_once()
                assert "Google callback failed" in str(mock_log.call_args)


# ═══════════════════════════════════════════════════════════════════════
#  OAuth — GitHub
# ═══════════════════════════════════════════════════════════════════════


class TestOAuthGitHubLogin:
    def test_redirects_when_not_configured(self, app):
        with patch.dict("os.environ", {"GITHUB_CLIENT_ID": "", "GITHUB_CLIENT_SECRET": ""}, clear=False):
            with patch("web_runner.utils._sync_cookie_files_to_db"):
                application = create_app()
            application.config["TESTING"] = True
            with application.test_client() as client:
                resp = client.get("/api/auth/github/login", follow_redirects=False)
                assert resp.status_code == 302
                assert "/login?error=oauth_not_configured" in resp.headers["Location"]

    def test_authorize_redirect_when_configured(self, app):
        mock_client = MagicMock()
        mock_client.authorize_redirect.return_value = "redirected"
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            with patch.dict(
                "os.environ",
                {"GITHUB_CLIENT_ID": "gh_id", "GITHUB_CLIENT_SECRET": "gh_secret"},
                clear=False,
            ):
                with patch("web_runner.utils._sync_cookie_files_to_db"):
                    application = create_app()
                application.config["TESTING"] = True
                with application.test_client() as client:
                    resp = client.get("/api/auth/github/login")
                    mock_client.authorize_redirect.assert_called_once()


class TestOAuthGitHubCallback:
    def test_not_configured_redirect(self, app):
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=None):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert "/login?error=oauth_not_configured" in resp.headers["Location"]

    def test_success_new_user(self, app):
        mock_client = _mock_github_client(
            profile={"login": "ghuser", "name": "Git Hub", "avatar_url": "https://gh.png"},
            emails=[{"email": "gh_new@test.com", "primary": True, "verified": True}],
        )
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert resp.headers["Location"].endswith("/dashboard")
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("gh_new@test.com",))
            assert user is not None
            assert user["name"] == "Git Hub"
            assert user["avatar"] == "https://gh.png"

    def test_success_existing_user(self, app):
        _create_user_direct("gh_existing@test.com", name="Old", avatar="https://old.png")
        mock_client = _mock_github_client(
            profile={"login": "ghuser2", "name": "Updated", "avatar_url": "https://new.png"},
            emails=[{"email": "gh_existing@test.com", "primary": True, "verified": True}],
        )
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("gh_existing@test.com",))
            assert user["name"] == "Updated"
            assert user["avatar"] == "https://new.png"

    def test_no_email_redirect(self, app):
        mock_client = _mock_github_client(
            profile={"login": "ghuser"},
            emails=[],
        )
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert "/login?error=no_email" in resp.headers["Location"]

    def test_uses_verified_email_when_not_primary(self, app):
        """If no primary email, use first verified email."""
        mock_client = _mock_github_client(
            profile={"login": "ghuser"},
            emails=[
                {"email": "secondary@test.com", "primary": False, "verified": True},
            ],
        )
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert resp.headers["Location"].endswith("/dashboard")
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("secondary@test.com",))
            assert user is not None

    def test_falls_back_to_first_email_when_no_verified(self, app):
        """If no verified email either, use the first email in the list."""
        mock_client = _mock_github_client(
            profile={"login": "ghuser"},
            emails=[
                {"email": "fallback@test.com", "primary": False, "verified": False},
            ],
        )
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert resp.headers["Location"].endswith("/dashboard")
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("fallback@test.com",))
            assert user is not None

    def test_emails_not_list_treats_as_no_email(self, app):
        """If GitHub returns emails as a non-list (unexpected), redirect with no_email."""
        mock_client = _mock_github_client(
            profile={"login": "ghuser"},
            emails="unexpected_string",
        )
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            assert "/login?error=no_email" in resp.headers["Location"]

    def test_authorize_access_token_failure(self, app):
        mock_client = MagicMock()
        mock_client.authorize_access_token.side_effect = Exception("github_token_error")
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            with patch("utils.log.logger.warning") as mock_log:
                resp = app.get("/api/auth/github/callback", follow_redirects=False)
                assert resp.status_code == 302
                assert "/login?error=github_failed" in resp.headers["Location"]
                mock_log.assert_called_once()
                assert "GitHub callback failed" in str(mock_log.call_args)

    def test_name_fallback_to_login(self, app):
        """When GitHub profile has no 'name', fall back to 'login'."""
        mock_client = _mock_github_client(
            profile={"login": "ghlogin", "name": None, "avatar_url": None},
            emails=[{"email": "name_fb@test.com", "primary": True, "verified": True}],
        )
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("name_fb@test.com",))
            assert user["name"] == "ghlogin"


# ═══════════════════════════════════════════════════════════════════════
#  OAuth — first-user-becomes-admin via social login
# ═══════════════════════════════════════════════════════════════════════


class TestOAuthFirstUserAdmin:
    def test_google_first_user_is_admin(self, app):
        """When the users table is empty, the first Google login creates an admin."""
        mock_client = MagicMock()
        mock_client.authorize_access_token.return_value = {
            "userinfo": {"email": "first_google@test.com", "name": "First", "picture": None}
        }
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/google/callback", follow_redirects=False)
            assert resp.status_code == 302
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("first_google@test.com",))
            assert user["role"] == "admin"

    def test_github_first_user_is_admin(self, app):
        """When the users table is empty, the first GitHub login creates an admin."""
        mock_client = MagicMock()
        mock_client.authorize_access_token.return_value = {"access_token": "tok"}
        user_resp = MagicMock()
        user_resp.json.return_value = {"login": "first_gh"}
        email_resp = MagicMock()
        email_resp.json.return_value = [
            {"email": "first_gh@test.com", "primary": True, "verified": True}
        ]
        mock_client.get.side_effect = lambda url, token=None: (
            user_resp if url == "user" else email_resp
        )
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/github/callback", follow_redirects=False)
            assert resp.status_code == 302
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("first_gh@test.com",))
            assert user["role"] == "admin"

    def test_google_second_user_is_regular(self, app):
        """After the first user exists, subsequent Google logins create regular users."""
        _create_user_direct("existing@test.com", role="admin")
        mock_client = MagicMock()
        mock_client.authorize_access_token.return_value = {
            "userinfo": {"email": "second_google@test.com", "name": "Second", "picture": None}
        }
        with patch("web_runner.routes.oauth.oauth.create_client", return_value=mock_client):
            resp = app.get("/api/auth/google/callback", follow_redirects=False)
            assert resp.status_code == 302
            from web_runner.db import get_database

            db = get_database()
            user = db.fetch_one("SELECT * FROM users WHERE email = ?", ("second_google@test.com",))
            assert user["role"] == "user"
