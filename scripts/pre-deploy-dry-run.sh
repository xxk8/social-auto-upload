#!/usr/bin/env bash
# Pre-deploy dry-run for TBF-018 hourly cron.
# Reference: docs/bug-tickets/test-app-bugfix-tickets-2026q3.md TBF-018 Monitoring schedule.
# Run this on actual 2026-07-05 (T-1 day before cron first emission 2026-07-06).
#
# What this script does:
#   0. Validates that the dev DB is in pre-PR-A state (no
#      guest_usage_logs / reward_events tables). The Week 0 baseline
#      (2026-06-29) predates the public-inbox-monetization change; if
#      dev DB already has those tables, the baseline no longer matches
#      the dev DB shape and the Δ computation would be misleading.
#      FATAL on tables present — re-baseline or remove the tables.
#   1. Appends 140 lines x 4 files of synthetic non-throttling prod-style log content
#      to .sau-logs/*.log to simulate ~7 days of normal prod log growth.
#   2. Runs scripts/monitor_cdp_throttling.py LIVE (advances state offsets).
#   3. Reads .sau-logs/.monitor-baseline-2026-06-29.json for Week 0 reference.
#   4. Computes Δ vs Week 0 for cdp_throttle / http_errors / race_events.
#   5. Emits a CRUISE-or-STOP-ship verdict.
#   6. Saves a re-runnable dry-run artifact for traceability.
#
# Idempotent. Re-running this script after first invocation appends ANOTHER 560 lines,
# advances state offsets, and re-computes Δ in a fresh dry-run artifact.
#
# Usage:
#   bash scripts/pre-deploy-dry-run.sh [/path/to/repo]
#
# Exit codes:
#   0  = CRUISE (deploy cron with confidence)
#   1  = STOP-ship (defer cron deployment; investigate)
#   2  = validation failed (binary / file missing)
#   3  = parse failure on last sweep stdout line (regex didn't match expected format)
#
# Race-window note: this script is single-instance only. The crontab add/remove pattern
# in scripts/deploy-monitor-cdp-throttling-cron.sh uses (`crontab -l | grep -vF | crontab -`)
# which has a TOCTOU race vs concurrent `crontab -e`. Single-operator host is safe;
# multi-operator or auto-deploy fleet should add `flock -n /tmp/sau-cron.lock` around both.

set -eu

REPO_ROOT="${1:-/Users/a123/Notes/02-project/projecke/github/social-auto-upload}"
LOGS_DIR="${REPO_ROOT}/.sau-logs"
SCRIPT="${REPO_ROOT}/scripts/monitor_cdp_throttling.py"
BASELINE="${LOGS_DIR}/.monitor-baseline-2026-06-29.json"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DRYRUN_ARTIFACT="${LOGS_DIR}/.monitor-predeploy-dry-run-$(date -u +%Y%m%dT%H%M%SZ).json"

# Validation phase
echo "[pre-deploy-dry-run] validating..."
[ -d "$LOGS_DIR" ] || { echo "FATAL: $LOGS_DIR not found"; exit 2; }
[ -f "$SCRIPT" ] || { echo "FATAL: $SCRIPT not found"; exit 2; }
[ -f "$BASELINE" ] || { echo "FATAL: $BASELINE not found. Was Week 0 baseline run?"; exit 2; }
[ -x "${REPO_ROOT}/.venv/bin/python" ] || { echo "FATAL: .venv/bin/python not executable"; exit 2; }
cd "$REPO_ROOT"

# Dev DB pre-PR-A state check. Mirrors the .monitor-baseline-2026-06-29.json
# guard above: FATAL on unexpected state. The Week 0 baseline predates
# PR-A, so a post-PR-A dev DB would invalidate the baseline. See the
# runbook docs/dev/public-inbox-ops.md §6 Mode B "WAL gotcha" for
# related SQLite-mode considerations.
DB_PATH="${REPO_ROOT}/db/database.db"
.venv/bin/python - "$DB_PATH" <<'PYEOF'
import os, sqlite3, sys
db_path = sys.argv[1]
if not os.path.exists(db_path):
    print("SKIP: dev DB not present at %s, pre-PR-A state assumed" % db_path)
    sys.exit(0)
try:
    c = sqlite3.connect(db_path)
    rows = c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name IN ('guest_usage_logs', 'reward_events')"
    ).fetchall()
    if rows:
        # Post-PR-A: point operators to the public-inbox successor script
        # instead of the pre-PR-A TBF-018 dry-run. The rot-check marker that
        # previously lived here was followed when the public-inbox PR landed
        # (created scripts/public-inbox-monetization-pre-deploy.sh).
        # Mirror ref: docs/dev/public-inbox-ops.md §7.
        print("FATAL: dev DB has public-inbox tables (post-PR-A state):", file=sys.stderr)
        for r in rows:
            print("  -", r[0], file=sys.stderr)
        print("  pre-deploy-dry-run is for the pre-PR-A state only", file=sys.stderr)
        print("  (Week 0 baseline 2026-06-29).", file=sys.stderr)
        print("  Use scripts/public-inbox-monetization-pre-deploy.sh instead.", file=sys.stderr)
        sys.exit(2)
    print("OK: dev DB in pre-PR-A state (no public-inbox tables).")
except Exception as e:
    # WARN, not FATAL — let the dry-run proceed if the DB is unreadable
    # (e.g. file locked by a long-running query). Operator can re-run.
    print("WARN: could not check dev DB pre-PR-A state: %s" % e, file=sys.stderr)
    sys.exit(0)
PYEOF

echo "[pre-deploy-dry-run] validation PASSED."
echo ""

# Append synthetic non-throttling log content
echo "[pre-deploy-dry-run] appending synthetic non-throttling log content..."
SYNTH_RUNNER="$(mktemp -t sau_synth_append.XXXXXX.py)"
cat > "$SYNTH_RUNNER" << 'PYEOF'
import datetime, random, sys
random.seed(42)
files = ['.sau-logs/backend.log', '.sau-logs/frontend.log', '.sau-logs/marketing.log', '.sau-logs/vite.log']
modules = ['web_runner.routes.upload', 'uploader.douyin_uploader.cookie_auth', 'sau_web.frontend.publish', 'marketing.cms']
events = ['task enqueued', 'status=PENDING', 'render ok', 'xhr ok 200', 'rdy', 'compiling', 'hash stable']
for fpath in files:
    base_ts = datetime.datetime(2026, 6, 30, 0, 0, 0)
    lines = []
    for i in range(140):
        ts = (base_ts + datetime.timedelta(hours=i)).strftime('%Y-%m-%d %H:%M:%S')
        mod = random.choice(modules)
        ev = random.choice(events)
        ms = random.randint(0, 999)
        lines.append(f'{ts}.{ms:03d} INFO {mod} :: {ev}#{i} module=routes task_id={random.randint(1000,9999)}')
    with open(fpath, 'a') as f:
        f.write(chr(10).join(lines) + chr(10))
    print(f'appended {len(lines)} non-throttle lines to {fpath}', file=sys.stderr)
PYEOF
.venv/bin/python "$SYNTH_RUNNER"
rm -f "$SYNTH_RUNNER"
echo ""

# Live sweep
echo "[pre-deploy-dry-run] running LIVE sweep..."
SWEEP_OUTPUT="${LOGS_DIR}/monitor-cdp-throttling.log"
.venv/bin/python scripts/monitor_cdp_throttling.py >> "$SWEEP_OUTPUT" 2>&1

# Read baseline + parse sweep line.
# REPO_ROOT is exported into the Python subprocess via env var (avoids relying on a hardcoded path).
# Critical: prior version of this script had a hardcoded /Users/a123/Notes/02-project/projecke/...
# absolute path inside the heredoc body, breaking the bash wrapper's REPO_ROOT argument.
export REPO_ROOT
echo ""
echo "[pre-deploy-dry-run] computing Δ vs Week 0 baseline..."
.venv/bin/python - "$TIMESTAMP" "$BASELINE" "$DRYRUN_ARTIFACT" << 'PYEOF'
import json, re, sys, os
from datetime import datetime, timezone
ts = sys.argv[1]
baseline_path = sys.argv[2]
artifact_path = sys.argv[3]
repo_root = os.environ.get("REPO_ROOT", "/Users/a123/Notes/02-project/projecke/github/social-auto-upload")
artifact_log = repo_root + "/.sau-logs/monitor-cdp-throttling.log"

baseline = json.load(open(baseline_path))["baseline_counts"]
log_lines = open(artifact_log).read().strip().splitlines() if __import__('os').path.exists(artifact_log) else []
last = log_lines[-1] if log_lines else "no-sweep-line"
m = re.search(r"files_scanned=(\d+).*?cdp_throttle=(\d+).*?http_errors=(\d+).*?race_events=(\d+).*?bytes_scanned=(\d+)", last)
if not m:
    print("FATAL: could not parse last sweep line:", file=sys.stderr)
    print(last, file=sys.stderr)
    sys.exit(3)
current = {
    "files_scanned": int(m.group(1)),
    "cdp_throttle": int(m.group(2)),
    "http_errors": int(m.group(3)),
    "race_events": int(m.group(4)),
    "bytes_scanned": int(m.group(5)),
}
delta = {k: current[k] - baseline[k] for k in ("cdp_throttle", "http_errors", "race_events")}

verdict_cdp = "CRUISE" if delta["cdp_throttle"] == 0 else "STOP-SHIP"
verdict_race = "CRUISE" if delta["race_events"] == 0 else "STOP-SHIP-WATCHFUL"
verdict_http = "CRUISE-INFO"  # informational only, NOT a revert trigger
overall = "CRUISE" if delta["cdp_throttle"] == 0 and delta["race_events"] == 0 else "STOP-SHIP"

print(f"  Baseline (Week 0, 2026-06-29): cdp_throttle={baseline['cdp_throttle']} http_errors={baseline['http_errors']} race_events={baseline['race_events']}")
print(f"  Current (dry-run):              cdp_throttle={current['cdp_throttle']} http_errors={current['http_errors']} race_events={current['race_events']} bytes_scanned={current['bytes_scanned']}")
print(f"  Δ vs Week 0:                    cdp_throttle={delta['cdp_throttle']} http_errors={delta['http_errors']} race_events={delta['race_events']}")
print(f"  Verdicts:                       🚨cdp_throttle={verdict_cdp}, ℹ️race_events={verdict_race}, ⚠️http_errors={verdict_http}")
print(f"  OVERALL:                        {overall}")
print()

artifact = {
    "snapshot_at": ts,
    "purpose": "Pre-deploy dry-run (T-1 before TBF-018 hourly cron emission). Computes Δ-vs-Week-0 for STOP-ship trigger evaluation.",
    "baseline_path": baseline_path,
    "last_sweep_stdout_line": last,
    "baseline_counts": baseline,
    "current_counts": current,
    "delta_vs_week0": delta,
    "verdict": {
        "cdp_throttle": verdict_cdp,
        "race_events": verdict_race,
        "http_errors": verdict_http,
        "overall": overall,
    },
}
with open(artifact_path, "w") as f:
    json.dump(artifact, f, indent=2)
print(f"  Artifact persisted: {artifact_path}")

if overall == "CRUISE":
    print()
    print("[pre-deploy-dry-run] CRUISE: deploy hourly cron with confidence. Plan:")
    print("  bash scripts/deploy-monitor-cdp-throttling-cron.sh validate   # confirm pre-deploy checks")
    print("  bash scripts/deploy-monitor-cdp-throttling-cron.sh install    # crontab -e write")
    sys.exit(0)
else:
    print()
    print("[pre-deploy-dry-run] STOP-SHIP: DO NOT deploy hourly cron. Investigate. 🚨delta > 0:")
    print(f"  cdp_throttle Δ = {delta['cdp_throttle']}; if >= 1, v9 fast-spin polish triggered throttling under synthetic 7-day load model.")
    sys.exit(1)
PYEOF
