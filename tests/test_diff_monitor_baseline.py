"""
test_diff_monitor_baseline.py — Regression tests for scripts/diff_monitor_baseline.py.

Stdlib unittest, no external deps. Covers 6 threshold math edge cases:
- STOP-SHIP at the boundary (cdp_throttle delta=1)
- WATCHFUL at the threshold boundary (http_errors delta == max(5, baseline*1.5)+1)
- INFO below threshold (http_errors delta 0 < x < threshold)
- OK steady-state (all deltas == 0)
- race_events delta>0 -> WATCHFUL (any positive = trending anomaly per TBF-018)
- decide_severity isolated unit tests for all 3 counters

Designed to fail loudly if future refactors break the cross-threshold math silently.
Diff is runnable via: .venv/bin/python -m pytest tests/test_diff_monitor_baseline.py -v
or: .venv/bin/python tests/test_diff_monitor_baseline.py
"""

import sys
import unittest
from pathlib import Path

# Ensure repo root is on sys.path so scripts/ import resolves
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.diff_monitor_baseline import decide_severity  # noqa: E402


class ThresholdMathTests(unittest.TestCase):
    """Threshold math decisions per design from thinker APPROVE output."""

    def test_cdp_throttle_zero_delta_is_OK(self):
        status, msg = decide_severity("cdp_throttle", 0, 0)
        self.assertEqual(status, "OK")
        self.assertIn("Steady state", msg)

    def test_cdp_throttle_positive_delta_is_VIOLATION(self):
        status, msg = decide_severity("cdp_throttle", 1, 0)
        self.assertEqual(status, "VIOLATION")
        self.assertIn("STOP-SHIP", msg)

    def test_http_errors_zero_delta_is_OK(self):
        status, msg = decide_severity("http_errors", 0, 3)
        self.assertEqual(status, "OK")

    def test_http_errors_below_threshold_is_INFO(self):
        # baseline=3 => threshold_ceil = max(5, int(3*1.5)+1) = max(5, 5) = 5
        # delta=4 is below 5 -> INFO
        status, msg = decide_severity("http_errors", 4, 3)
        self.assertEqual(status, "INFO")
        self.assertIn("Informational only", msg)

    def test_http_errors_at_threshold_is_WATCHFUL(self):
        # baseline=3 => threshold_ceil = 5
        # delta=5 is at/above threshold -> WATCHFUL (cross-threshold)
        status, msg = decide_severity("http_errors", 5, 3)
        self.assertEqual(status, "WATCHFUL")
        self.assertIn("Cross-threshold", msg)

    def test_race_events_positive_delta_is_WATCHFUL(self):
        # baseline=0; any positive delta is trending anomaly
        status, msg = decide_severity("race_events", 1, 0)
        self.assertEqual(status, "WATCHFUL")
        self.assertIn("Trending anomaly", msg)

    def test_race_events_zero_delta_is_OK(self):
        status, msg = decide_severity("race_events", 0, 0)
        self.assertEqual(status, "OK")

    def test_http_errors_high_baseline_threshold_uses_baseline_multiplier(self):
        # baseline=10 => threshold_ceil = max(5, int(10*1.5)+1) = max(5, 16) = 16
        # delta=15 is below 16 -> INFO
        status, _ = decide_severity("http_errors", 15, 10)
        self.assertEqual(status, "INFO")
        # delta=16 exactly at threshold -> WATCHFUL
        status, _ = decide_severity("http_errors", 16, 10)
        self.assertEqual(status, "WATCHFUL")


if __name__ == "__main__":
    unittest.main(verbosity=2)
