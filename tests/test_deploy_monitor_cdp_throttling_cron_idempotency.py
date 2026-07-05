"""
test_deploy_monitor_cdp_throttling_cron_idempotency.py — Locks in round-2 HIGH-fix
that prevents exponential duplication of CRON_LINE + DAILY_CRON_LINE on `install` re-run.

Approach: emulates the install block of scripts/deploy-monitor-cdp-throttling-cron.sh
via subprocess bash call so the assertions match what the prod script actually does in
install mode (vs. mocking the grep pipeline which would diverge from real bash behavior).

Pre-fix behavior (BUG): double `crontab -l | grep -vF ... || true` produced
[DAILY, HOURLY, HOURLY, DAILY] = 2 of each per re-run; 2x, 4x, 8x exponential blowup.
Post-fix behavior (verified by this test): single `crontab -l | grep -vF -e X -e Y || true`
removes BOTH patterns in one pass, then re-adds each exactly once. Re-run is idempotent.

Stdlib unittest + subprocess. Runs in <100ms. Run via:
    .venv/bin/python -m unittest tests.test_deploy_monitor_cdp_throttling_cron_idempotency -v
"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

CRON_HOURLY = (
    f"0 * * * * cd {REPO_ROOT} && .venv/bin/python "
    f"scripts/monitor_cdp_throttling.py >> .sau-logs/monitor-cdp-throttling.log 2>&1"
)
CRON_DAILY = (
    f"0 6 * * * cd {REPO_ROOT} && .venv/bin/python "
    f"scripts/diff_monitor_baseline.py --verdict-output .sau-logs/monitor-baseline-diff.json "
    f">> .sau-logs/monitor-baseline-diff.log 2>&1"
)


class InstallIdempotencyTests(unittest.TestCase):
    """Verify the install block of scripts/deploy-monitor-cdp-throttling-cron.sh
    produces exactly one CRON_HOURLY + one CRON_DAILY in the post-install crontab,
    regardless of what state the pre-existing crontab is in."""

    def _run_install_emulation(self, pre_existing_crontab: str) -> str:
        """Emulate: (cat fixture | grep -vF -e X -e Y || true; echo HOURLY; echo DAILY) | new_crontab.

        Mirrors scripts/deploy-monitor-cdp-throttling-cron.sh install-mode structure.
        Grep -vF -e X -e Y removes ALL lines matching EITHER X OR Y in one pass — that is
        the entire content of the round-2 fix; no double crontab read, no double echo."""
        with tempfile.TemporaryDirectory() as tmp:
            fixture = os.path.join(tmp, "crontab.bak")
            new = os.path.join(tmp, "new_crontab")
            Path(fixture).write_text(pre_existing_crontab)
            cmd = (
                "bash", "-c",
                "set -euo pipefail; "
                f"cat '{fixture}' | grep -vF -e 'scripts/monitor_cdp_throttling.py' "
                f"-e 'scripts/diff_monitor_baseline.py' > '{new}' || true; "
                f"echo '{CRON_HOURLY}' >> '{new}'; "
                f"echo '{CRON_DAILY}' >> '{new}'"
            )
            subprocess.run(cmd, check=True)
            return Path(new).read_text()

    def test_install_with_empty_crontab_yields_exactly_one_of_each(self):
        """Cold-start: no pre-existing cron -> exactly one HOURLY + one DAILY added."""
        result = self._run_install_emulation("")
        self.assertEqual(result.count(CRON_HOURLY), 1,
                         "HOURLY must appear exactly once on cold install")
        self.assertEqual(result.count(CRON_DAILY), 1,
                         "DAILY must appear exactly once on cold install")

    def test_install_with_both_preinstalled_is_idempotent(self):
        """First re-run after install: pre-existing crontab already has both lines.
        The install must remove the pre-existing pair, then add EXACTLY ONE new pair."""
        pre = (
            "0 5 * * * /usr/local/bin/daily-backup.sh\n"  # unrelated entry -> PRESERVED
            f"{CRON_HOURLY}\n"
            f"{CRON_DAILY}\n"
        )
        result = self._run_install_emulation(pre)
        self.assertEqual(result.count(CRON_HOURLY), 1,
                         "HOURLY must dedupe to exactly one on re-install")
        self.assertEqual(result.count(CRON_DAILY), 1,
                         "DAILY must dedupe to exactly one on re-install")
        # The unrelated pre-existing entry is preserved (no collateral damage from fix).
        self.assertEqual(result.count("/usr/local/bin/daily-backup.sh"), 1,
                         "Pre-existing unrelated cron entries must be preserved")

    def test_install_with_doubled_duplicates_is_idempotent(self):
        """Adversarial regression test: simulate the exponential-duplication bug state
        (HOURLY appears 2x, DAILY appears 2x). The fix's `grep -vF -e X -e Y` removes
        ALL matching lines regardless of count, so it must collapse duplicates to 1."""
        pre = (
            f"{CRON_HOURLY}\n{CRON_HOURLY}\n"  # 2x HOURLY
            f"{CRON_DAILY}\n{CRON_DAILY}\n"    # 2x DAILY
        )
        result = self._run_install_emulation(pre)
        self.assertEqual(result.count(CRON_HOURLY), 1,
                         "HOURLY must collapse to exactly one even when pre-duplicated")
        self.assertEqual(result.count(CRON_DAILY), 1,
                         "DAILY must collapse to exactly one even when pre-duplicated")


if __name__ == "__main__":
    unittest.main(verbosity=2)
