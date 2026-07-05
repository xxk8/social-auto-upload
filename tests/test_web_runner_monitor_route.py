"""
test_web_runner_monitor_route.py — Unit tests for GET /api/monitor/status.

Cover 3 scenarios:
1. Missing artifact -> synthetic CRUISE_NO_BASELINE 200 (cron hasn't emitted yet; banner shows).
2. Valid artifact -> 200 passthrough + Cache-Control: max-age=300 header.
3. Corrupted JSON   -> synthetic CRUISE_PARSE_ERROR 500 + safe banner.

Auth gate: bypassed via session_transaction injecting admin role + SAU_AUTH_ENABLED
env var unset so the _check_auth before_request hook allows /api/* through.

Env-var isolation: setUpClass snapshots os.environ and tearDownClass restores it
so DATABASE_URL mutations don't bleed into sibling test files' create_app() calls.
"""
import atexit
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Module-level placeholders — populated lazily by _setup_test_env() on first call.
_TEST_DB_DIR: str | None = None
_ORIGINAL_ENV: dict[str, str] | None = None


def _setup_test_env():
    """Configure env vars deterministically BEFORE create_app() reads them.
    Direct assignment (NOT setdefault) so conftest.py / sibling-test overrides of
    SAU_DB_DIALECT don't silently propagate as postgres (which would then need a
    DATABASE_URL definition that pytest fixtures don't always provide)."""
    global _TEST_DB_DIR
    if _TEST_DB_DIR is None:
        _TEST_DB_DIR = tempfile.mkdtemp(prefix="sau-web-runner-monitor-test-")
        # Clean up the tempdir at process exit; cross-session /tmp/ hygiene.
        atexit.register(shutil.rmtree, _TEST_DB_DIR, ignore_errors=True)
    # Use sqlite in tests; override any prior dialect set by conftest.
    os.environ["SAU_DB_DIALECT"] = "sqlite"
    # Tempfile-based DB path: CWD-independent, zero collision risk across pytest runs.
    # NOTE: sqlite:///:memory: is incompatible with the project's
    # web_runner/db.py::insert_returning_id() pattern (cursor.lastrowid returns None
    # on some :memory:-backed INSERTs); tempfile.mkdtemp()-backed sqlite file works.
    os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_DIR}/monitor-test.db"
    # Disable auth so /api/* requests are accepted without a real session.
    os.environ.pop("SAU_AUTH_ENABLED", None)


def _capture_env():
    """Snapshot os.environ for restoration in tearDownClass."""
    global _ORIGINAL_ENV
    _ORIGINAL_ENV = os.environ.copy()


def _restore_env():
    """Restore os.environ from snapshot captured in setUpClass. Prevents
    DATABASE_URL / SAU_DB_DIALECT mutations from bleeding into sibling tests' create_app()
    calls (which previously triggered INSERT-didn't-return-Id failures on their seeds)."""
    global _ORIGINAL_ENV
    if _ORIGINAL_ENV is None:
        return
    extra_keys = set(os.environ.keys()) - set(_ORIGINAL_ENV.keys())
    for k in extra_keys:
        os.environ.pop(k, None)
    for k, v in _ORIGINAL_ENV.items():
        os.environ[k] = v
    _ORIGINAL_ENV = None


class MonitorRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # CRITICAL: snapshot env FIRST (before any mutations), THEN call _setup_test_env().
        # Per round-6 HIGH bug: prior order called _setup_test_env() at module-load, then
        # _capture_env() snapshots already-polluted env, so _restore_env() restored the
        # polluted state instead of the original. Sibling tests inherited the pollution._capture_env()
# Note: _setup_test_env() is intentionally NOT called at module-load. It runs in
# setUpClass AFTER _capture_env() so _restore_env() restores the truly-original
# pre-test env state (not the post-mutation state). Per round-6 HIGH bug fix.
        # Lazy import so env wiring propagates before auth.py reads SAU_AUTH_ENABLED.
        from web_runner import create_app
        cls.app = create_app()
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        _restore_env()

    def _login_as_admin(self):
        """Bypass auth: inject admin session into flask session_transaction."""
        with self.client.session_transaction() as sess:
            sess["user_id"] = 1
            sess["role"] = "admin"

    def test_monitor_status_missing_artifact_returns_synthetic_200(self):
        """When the daily cron hasn't emitted .sau-logs/monitor-baseline-diff.json yet,
        the route should return a synthetic CRUISE_NO_BASELINE 200 with full JSON shape,
        so the frontend banner template can render without 404 branch logic."""
        with tempfile.TemporaryDirectory() as tmp:
            with patch("web_runner.routes.monitor.ARTIFACT_PATH", Path(tmp) / "monitor-baseline-diff.json"):
                self._login_as_admin()
                resp = self.client.get("/api/monitor/status")
                self.assertEqual(resp.status_code, 200,
                                 "missing artifact must return 200 (not 404) for banner compat")
                data = resp.get_json()
                self.assertEqual(data["overall_verdict"], "CRUISE_NO_BASELINE")
                self.assertEqual(data["banner"]["severity"], "warning")
                self.assertIn("Daily monitoring artifact missing", data["banner"]["text"])
                self.assertTrue(data.get("_synthetic"), "synthetic verdicts must be flagged")

    def test_monitor_status_valid_artifact_passes_through_with_cache_header(self):
        """When the artifact exists and parses cleanly, the route should:
        - return 200
        - pass through the JSON as-is (banner text preserved verbatim)
        - set Cache-Control: public, max-age=300 (5-minute freshness heuristic)"""
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "monitor-baseline-diff.json"
            payload = {
                "snapshot_at": "2026-07-06T12:00:00Z",
                "tool": "diff_monitor_baseline.py",
                "version": 1,
                "overall_verdict": "STOP-SHIP",
                "banner": {
                    "severity": "error",
                    "text": "🚨 STOP-SHIP: cdp_throttle spike detected.",
                },
                "counters": {
                    "cdp_throttle": {
                        "baseline": 0, "current": 5, "delta": 5,
                        "threshold_status": "VIOLATION",
                        "message": "STOP-SHIP threshold exceeded.",
                    },
                },
                "current_sweep": {"timestamp": "2026-07-06 12:00:00", "files_scanned": 4, "bytes_scanned": 150},
            }
            artifact.write_text(json.dumps(payload), encoding="utf-8")
            with patch("web_runner.routes.monitor.ARTIFACT_PATH", artifact):
                self._login_as_admin()
                resp = self.client.get("/api/monitor/status")
                self.assertEqual(resp.status_code, 200)
                data = resp.get_json()
                # Verbatim passthrough
                self.assertEqual(data["overall_verdict"], "STOP-SHIP")
                self.assertEqual(data["banner"]["severity"], "error")
                self.assertEqual(data["counters"]["cdp_throttle"]["delta"], 5)
                self.assertNotIn("_synthetic", data,
                                 "valid artifact must NOT be flagged as synthetic")
                # Cache header
                cache = resp.headers.get("Cache-Control", "")
                self.assertIn("public", cache)
                self.assertIn("max-age=300", cache)

    def test_monitor_status_corrupted_json_returns_500_with_safe_banner(self):
        """When the artifact exists but is malformed JSON, the route should:
        - return 500 (signaling operational alert)
        - return a synthetic CRUISE_PARSE_ERROR JSON so the frontend can still render
          a banner explaining the artifact is corrupted"""
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "monitor-baseline-diff.json"
            artifact.write_text("{ this is not valid json syntax ", encoding="utf-8")
            with patch("web_runner.routes.monitor.ARTIFACT_PATH", artifact):
                self._login_as_admin()
                resp = self.client.get("/api/monitor/status")
                self.assertEqual(resp.status_code, 500)
                data = resp.get_json()
                self.assertEqual(data["overall_verdict"], "CRUISE_PARSE_ERROR")
                self.assertEqual(data["banner"]["severity"], "error")
                self.assertIn("malformed", data["banner"]["text"].lower())
                self.assertTrue(data.get("_synthetic"))

    def test_monitor_status_non_admin_returns_403_or_401(self):
        """Auth-gate regression: @admin_required decorator should reject non-admin roles.
        Without this regression test, an accidental decorator removal would silently pass
        all 3 test cases since they inject admin role. Per round-6 MEDIUM coverage gap."""
        with tempfile.TemporaryDirectory() as _:
            # Inject NON-admin session
            with self.client.session_transaction() as sess:
                sess["user_id"] = 1
                sess["role"] = "user"  # NOT admin
            resp = self.client.get("/api/monitor/status")
            # Expected: 403 Forbidden (admin gate) OR 401 Unauthorized (auth gate).
            # Either is acceptable; the key invariant is rejection, not 200 OK.
            self.assertIn(resp.status_code, (401, 403),
                          f"non-admin must be rejected with 401/403, got {resp.status_code}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
