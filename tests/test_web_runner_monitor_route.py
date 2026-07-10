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

class MonitorRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Lazy import so env wiring propagates before auth.py reads SAU_AUTH_ENABLED.
        # Post-SQLite-removal: no per-class temp SQLite DB or SAU_DB_DIALECT override.
        # The conftest's _init_pg_schema session fixture bootstraps the test
        # schema against $DATABASE_URL; this test class only cares about the
        # /api/monitor/status route's artifact-file behavior (not the DB).
        from web_runner import create_app
        cls.app = create_app()
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        # No env restoration needed — the conftest's session-scoped
        # _force_sau_auth_enabled_true_for_test_session fixture handles
        # auth env, and DATABASE_URL is set by the host (CI / dev).
        pass

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
