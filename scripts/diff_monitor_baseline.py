#!/usr/bin/env python3
"""
diff_monitor_baseline.py — Daily diff helper for TBF-018 cron window.

Reads:
  - .sau-logs/.monitor-baseline-2026-06-29.json (Week 0 baseline)
  - .sau-logs/monitor-cdp-throttling.log (newest hourly cron emission)

Computes delta per counter (current - baseline) and emits JSON verdict suitable for
web_runner banner alert. Run daily in addition to hourly monitor_cdp_throttling.py cron.

Stdlib only (json, argparse, pathlib, datetime, re). Does NOT advance state.json —
pure read-only view. Idempotent and deterministic.

Exit codes (per design from thinker APPROVE):
  0 = CRUISE / WATCHFUL / INFO  (informational only, no admin pager spam)
  1 = STOP-SHIP                  (cdp_throttle delta > 0 = revert trigger per TBF-018)
  2 = System Error               (missing files, malformed JSON, regex parse failure)

Reference: docs/bug-tickets/test-app-bugfix-tickets-2026q3.md TBF-018 body.
Sister artifact: .monitor-baseline-2026-06-29.json + scripts/pre-deploy-dry-run.sh.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT_DEFAULT = "/Users/a123/Notes/02-project/projecke/github/social-auto-upload"
DEFAULT_BASELINE = ".sau-logs/.monitor-baseline-2026-06-29.json"
DEFAULT_RUN_LOG = ".sau-logs/monitor-cdp-throttling.log"

# Regex pattern for parsing the most recent line of monitor-cdp-throttling.log.
# Matches stdout format emitted by scripts/monitor_cdp_throttling.py per TBF-018 design.
SWEEP_LINE_RE = re.compile(
    r"^\[(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] "
    r"monitor sweep: "
    r"files_scanned=(?P<files_scanned>\d+), "
    r"\U0001F6A8cdp_throttle=(?P<cdp_throttle>\d+), "
    r"\u26A0\uFE0Fhttp_errors=(?P<http_errors>\d+), "
    r"\u2139\uFE0Frace_events=(?P<race_events>\d+), "
    r"bytes_scanned=(?P<bytes_scanned>\d+)\s*$"
)


def parse_args():
    p = argparse.ArgumentParser(
        description="Daily TBF-018 baseline-vs-current diff. Emits JSON verdict."
    )
    p.add_argument(
        "--repo-root",
        default=REPO_ROOT_DEFAULT,
        help=f"Repo root for relative path resolution (default: {REPO_ROOT_DEFAULT})",
    )
    p.add_argument(
        "--baseline-path",
        default=None,
        help="Path to Week 0 baseline JSON (default: $REPO_ROOT/.monitor-baseline-2026-06-29.json)",
    )
    p.add_argument(
        "--run-log-path",
        default=None,
        help="Path to hourly cron emission log (default: $REPO_ROOT/monitor-cdp-throttling.log)",
    )
    p.add_argument(
        "--verdict-output",
        default=None,
        help="Path to write JSON verdict (default: stdout)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write to --verdict-output (still prints to stdout)",
    )
    return p.parse_args()


def decide_severity(name, delta, baseline):
    """Per TBF-018 design; thresholds from thinker APPROVE output.

    - cdp_throttle:  delta == 0 -> OK;  delta > 0 -> VIOLATION (STOP-SHIP)
    - http_errors:   delta == 0 -> OK;  0 < delta < ceil(max(5, baseline*1.5)) -> INFO;
                                  delta >= ceil(...) -> WATCHFUL (cross-threshold)
    - race_events:   delta == 0 -> OK;  delta > 0 -> WATCHFUL (trending anomaly)
    """
    if name == "cdp_throttle":
        if delta <= 0:
            return "OK", "Steady state - no throttling events since baseline."
        return (
            "VIOLATION",
            "STOP-SHIP threshold: cdp_throttle delta > 0 means v9 fast-spin polish triggered throttling. "
            "Open new TBF-NNN revert ticket per TBF-018 4-week decisions log.",
        )
    if name == "http_errors":
        if delta <= 0:
            return "OK", "Steady state - no new urlopen failures since baseline."
        threshold_ceil = max(5, int(baseline * 1.5) + 1)
        if delta >= threshold_ceil:
            return (
                "WATCHFUL",
                f"Cross-threshold: http_errors delta={delta} >= 1.5x baseline={baseline} (ceil {threshold_ceil}). "
                "Informational only - NOT a revert trigger. Track across weeks 2-4 per TBF-018.",
            )
        return (
            "INFO",
            f"Soft watch: http_errors delta={delta} (positive but below {threshold_ceil}). "
            "Informational only, NOT a revert trigger. The 3 historical http_errors in Week 0 are pre-v9 incidents; recheck at Week 4.",
        )
    if name == "race_events":
        if delta <= 0:
            return "OK", "Steady state - race-classifier signal at-zero baseline."
        return (
            "WATCHFUL",
            "Trending anomaly: race_events delta > 0 (baseline structurally 0 per TBF-018 + TBF-017). "
            "Supplementary cross-ref only - NOT a revert trigger by itself.",
        )
    return "OK", ""


def emit(verdict, args):
    text = json.dumps(verdict, indent=2, ensure_ascii=False)
    print(text)
    if args.verdict_output and not args.dry_run:
        Path(args.verdict_output).write_text(text + "\n")
        print(f"\n# verdict written to {args.verdict_output}", file=sys.stderr)


def build_missing_verdict(snapshot_at, baseline_path, run_log_path, kind, message):
    return {
        "snapshot_at": snapshot_at,
        "baseline_path": str(baseline_path),
        "run_log_path": str(run_log_path),
        "tool": "diff_monitor_baseline.py",
        "version": 1,
        "overall_verdict": kind,
        "banner": {"severity": "warning", "text": message},
        "counters": {},
        "exit_reason": kind.lower(),
    }


def main():
    args = parse_args()
    repo_root = Path(args.repo_root)
    baseline_path = (
        Path(args.baseline_path) if args.baseline_path else repo_root / DEFAULT_BASELINE
    )
    run_log_path = (
        Path(args.run_log_path) if args.run_log_path else repo_root / DEFAULT_RUN_LOG
    )
    snapshot_at = datetime.now(timezone.utc).isoformat()

    # Read baseline (graceful if missing -> CRUISE_NO_BASELINE)
    if not baseline_path.exists():
        v = build_missing_verdict(
            snapshot_at,
            baseline_path,
            run_log_path,
            "CRUISE_NO_BASELINE",
            "\u26a0\ufe0f Baseline reference missing (.monitor-baseline-2026-06-29.json). "
            "Run scripts/pre-deploy-dry-run.sh or scripts/monitor_cdp_throttling.py once to seed Week 0 baseline.",
        )
        emit(v, args)
        sys.exit(0)

    try:
        baseline = json.loads(baseline_path.read_text())["baseline_counts"]
    except (KeyError, json.JSONDecodeError) as e:
        v = build_missing_verdict(
            snapshot_at,
            baseline_path,
            run_log_path,
            "CRUISE_NO_BASELINE",
            f"\u274c Baseline JSON malformed: {e}. Run scripts/pre-deploy-dry-run.sh to refresh.",
        )
        v["banner"]["severity"] = "error"
        emit(v, args)
        sys.exit(2)  # malformed JSON = system error

    # Read newest run log line (graceful if missing -> CRUISE_NO_DATA)
    if not run_log_path.exists():
        v = build_missing_verdict(
            snapshot_at,
            baseline_path,
            run_log_path,
            "CRUISE_NO_DATA",
            "\u26a0\ufe0f Run log missing (.monitor-cdp-throttling.log). Hourly cron hasn't emitted yet - check cron status.",
        )
        emit(v, args)
        sys.exit(0)

    lines = run_log_path.read_text().strip().splitlines()
    if not lines:
        v = build_missing_verdict(
            snapshot_at,
            baseline_path,
            run_log_path,
            "CRUISE_NO_DATA",
            "\u26a0\ufe0f Run log empty. Hourly cron has not emitted yet.",
        )
        emit(v, args)
        sys.exit(0)

    last_line = lines[-1]
    m = SWEEP_LINE_RE.match(last_line)
    if not m:
        v = {
            "snapshot_at": snapshot_at,
            "baseline_path": str(baseline_path),
            "run_log_path": str(run_log_path),
            "tool": "diff_monitor_baseline.py",
            "version": 1,
            "overall_verdict": "CRUISE_PARSE_ERROR",
            "banner": {
                "severity": "error",
                "text": f"\u274c Could not parse last run-log line: {last_line!r}. "
                "Regex doesn't match the expected format from monitor_cdp_throttling.py stdout.",
            },
            "counters": {},
            "exit_reason": "regex_parse_error",
            "last_log_line": last_line,
        }
        emit(v, args)
        sys.exit(2)  # parse error = system error

    current = {
        k: int(m.group(k))
        for k in ("files_scanned", "cdp_throttle", "http_errors", "race_events", "bytes_scanned")
    }
    deltas = {
        name: current[name] - baseline[name]
        for name in ("cdp_throttle", "http_errors", "race_events")
    }

    counters = {}
    for name in ("cdp_throttle", "http_errors", "race_events"):
        threshold_status, message = decide_severity(name, deltas[name], baseline[name])
        counters[name] = {
            "baseline": baseline[name],
            "current": current[name],
            "delta": deltas[name],
            "threshold_status": threshold_status,
            "message": message,
        }

    if any(c["threshold_status"] == "VIOLATION" for c in counters.values()):
        overall_verdict = "STOP-SHIP"
        banner_severity = "error"
        cdp = counters["cdp_throttle"]
        banner_text = (
            f"\U0001F6A8 STOP-SHIP: per TBF-018 design, cdp_throttle delta>0 is revert trigger. "
            f"Counts: cdp_throttle={cdp['current']} (baseline {cdp['baseline']}, delta {cdp['delta']}). "
            "Revert v9 fast-spin polish via new TBF-NNN ticket per 4-week decisions log."
        )
        exit_code = 1
    elif any(c["threshold_status"] == "WATCHFUL" for c in counters.values()):
        overall_verdict = "WATCHFUL"
        banner_severity = "warning"
        watch_names = [n for n, c in counters.items() if c["threshold_status"] == "WATCHFUL"]
        banner_text = (
            f"\u26a0\ufe0f WATCH: {' + '.join(watch_names)} crossed informational threshold. "
            "Not a revert trigger; track across weeks 2-4 per TBF-018."
        )
        exit_code = 0
    elif any(c["threshold_status"] == "INFO" for c in counters.values()):
        overall_verdict = "WATCHFUL"
        banner_severity = "info"
        info_names = [n for n, c in counters.items() if c["threshold_status"] == "INFO"]
        banner_text = (
            f"\u2139\ufe0f INFO: {' + '.join(info_names)} above zero but below watch threshold. Track trend."
        )
        exit_code = 0
    else:
        overall_verdict = "CRUISE"
        banner_severity = "info"
        banner_text = (
            "\u2705 CRUISE: all counters steady-state vs Week 0 baseline. "
            "TBF-018 monitoring window proceeding normally."
        )
        exit_code = 0

    # ADR: counters holds per-status-family metrics (cdp_throttle, http_errors,
    # race_events) keyed by canonical TBF-019 schema names. current_sweep holds
    # file-level metrics from the most recent hourly emission (timestamp +
    # files_scanned + bytes_scanned). Split is INTENTIONAL: web_runner surfaces
    # counters for banner alert-level rendering; current_sweep is informational
    # metadata for hover/details. Note: `counters.current_*` is the canonical
    # access path; `current_sweep` is metadata-only.
    verdict = {
        "snapshot_at": snapshot_at,
        "baseline_path": str(baseline_path),
        "run_log_path": str(run_log_path),
        "tool": "diff_monitor_baseline.py",
        "version": 1,
        "overall_verdict": overall_verdict,
        "banner": {"severity": banner_severity, "text": banner_text},
        "counters": counters,
        "current_sweep": {
            "timestamp": m.group("ts"),
            "files_scanned": current["files_scanned"],
            "bytes_scanned": current["bytes_scanned"],
        },
    }
    emit(verdict, args)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
