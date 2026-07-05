#!/usr/bin/env bash
# Pre-deploy dry-run for public-inbox-monetization daily cron.
# Reference: openspec/changes/public-inbox-monetization/design.md §Kill Criteria
# + docs/dev/public-inbox-ops.md (operator runbook).
#
# Post-PR-A successor to scripts/pre-deploy-dry-run.sh (TBF-018). The TBF-018
# pre-deploy is for the pre-PR-A state only (Week 0 baseline 2026-06-29);
# once PR-A merges, deploy the public-inbox daily cron with THIS script.
#
# What this script does:
#   0. Validates that the dev DB is in post-PR-A state
#      (guest_usage_logs + reward_events + users tables all exist).
#      The kill-criteria script needs these tables to compute metrics;
#      if they're missing, the verdict is INSUFFICIENT_DATA — fine for
#      the daily cron (no alert), but the pre-deploy dry-run is meant
#      to verify the POST-DEPLOY state, so the tables MUST exist.
#      FATAL on tables missing — wait for PR-A, or run the pre-PR-A
#      sibling scripts/pre-deploy-dry-run.sh instead.
#   1. Runs scripts/public_inbox_kill_criteria.py LIVE (--no-webhook) with
#      --db-path and --logs-dir pointing to a temp dir (to avoid clobbering
#      the live daily emission). Computes the 6-metric verdict cascade.
#   2. Reads the verdict JSON. Maps the 4-level cascade to deploy readiness:
#         CRUISE / WATCHFUL / INSUFFICIENT_DATA  → exit 0 (deploy daily cron)
#         STOP-SHIP                              → exit 1 (DO NOT deploy; investigate)
#   3. Saves a re-runnable dry-run artifact for traceability (named
#      .public-inbox-predeploy-dry-run-<timestamp>.json in .sau-logs/).
#
# Idempotent. Re-running this script after first invocation re-computes
# the verdict and writes a fresh dry-run artifact. The live daily emission
# (.sau-logs/public-inbox-kill-criteria.json) is NEVER clobbered by this
# dry-run — the dry-run uses its own temp logs dir.
#
# Usage:
#   bash scripts/public-inbox-monetization-pre-deploy.sh [/path/to/repo]
#
# Env vars (all optional, for test/CI use):
#   SAU_DB_PATH_OVERRIDE=/path/to/test.db   Override the dev DB path.
#   SAU_LOGS_DIR_OVERRIDE=/path/to/logs     Override the .sau-logs/ dir.
#
# Exit codes:
#   0  = CRUISE / WATCHFUL / INSUFFICIENT_DATA (deploy daily cron with confidence)
#   1  = STOP-SHIP (defer daily cron deployment; investigate killswitch metric)
#   2  = validation failed (binary / file / schema missing)
#   3  = parse failure on verdict JSON (script bug or DB issue)
#
# Sibling script: scripts/pre-deploy-dry-run.sh (TBF-018, pre-PR-A only).
# Cron deploy:    scripts/deploy-public-inbox-kill-criteria-cron.sh
#                 (already exists; mirrors deploy-monitor-cdp-throttling-cron.sh shape).

set -eu

REPO_ROOT="${1:-/Users/a123/Notes/02-project/projecke/github/social-auto-upload}"
LOGS_DIR="${SAU_LOGS_DIR_OVERRIDE:-${REPO_ROOT}/.sau-logs}"
SCRIPT="${REPO_ROOT}/scripts/public_inbox_kill_criteria.py"
DB_PATH="${SAU_DB_PATH_OVERRIDE:-${REPO_ROOT}/db/database.db}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Validation phase
echo "[public-inbox-predeploy-dry-run] validating..."
[ -d "$LOGS_DIR" ] || { echo "FATAL: $LOGS_DIR not found" >&2; exit 2; }
[ -f "$SCRIPT" ] || { echo "FATAL: $SCRIPT not found" >&2; exit 2; }
[ -x "${REPO_ROOT}/.venv/bin/python" ] || { echo "FATAL: .venv/bin/python not executable" >&2; exit 2; }
[ -f "$DB_PATH" ] || { echo "FATAL: $DB_PATH not found (post-PR-A expected: dev DB must exist with public-inbox tables)" >&2; exit 2; }
cd "$REPO_ROOT"

# Dev DB post-PR-A state check (inverse of TBF-018 pre-deploy's pre-PR-A check).
# The public-inbox kill-criteria script requires guest_usage_logs + reward_events
# + users tables to exist. If any are missing, the dry-run is meaningless.
.venv/bin/python - "$DB_PATH" <<'PYEOF'
import os, sqlite3, sys
db_path = sys.argv[1]
try:
    c = sqlite3.connect(db_path)
    present = {
        r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name IN ('guest_usage_logs', 'reward_events', 'users')"
        )
    }
    missing = {"guest_usage_logs", "reward_events", "users"} - present
    if missing:
        print("FATAL: dev DB missing public-inbox tables (pre-PR-A state):", file=sys.stderr)
        for m in missing:
            print("  -", m, file=sys.stderr)
        print("  public-inbox-monetization-pre-deploy requires the post-PR-A schema.", file=sys.stderr)
        print("  Wait for PR-A to merge, or run scripts/pre-deploy-dry-run.sh", file=sys.stderr)
        print("  (the pre-PR-A sibling) until PR-A lands.", file=sys.stderr)
        sys.exit(2)
    print("OK: dev DB in post-PR-A state (public-inbox tables present).")
except Exception as e:
    print("FATAL: could not check dev DB post-PR-A state: %s" % e, file=sys.stderr)
    sys.exit(2)
PYEOF

echo "[public-inbox-predeploy-dry-run] validation PASSED."
echo ""

# Pre-deploy dry-run: invoke kill-criteria script LIVE (no --dry-run, --no-webhook only)
# in a temp logs dir so we don't clobber the live daily emission.
DRYRUN_LOGS_DIR="${LOGS_DIR}/.predeploy-dry-run-tmp"
rm -rf "$DRYRUN_LOGS_DIR" && mkdir -p "$DRYRUN_LOGS_DIR"

echo "[public-inbox-predeploy-dry-run] running kill-criteria LIVE in temp logs dir..."
SWEEP_OUTPUT="${LOGS_DIR}/public-inbox-kill-criteria.log"
# Note: do NOT use `|| { exit 3; }` here — the kill-criteria script LEGITIMATELY
# exits 1 on STOP-SHIP (per its own exit semantics). Capture the exit code
# instead, then check whether the verdict JSON was materialized. If the JSON
# exists, the kill-criteria script did its job; the verdict cascade drives
# our exit code, not the kill-criteria script's raw exit.
set +e
.venv/bin/python "${SCRIPT}" --no-webhook \
    --db-path "${DB_PATH}" \
    --logs-dir "${DRYRUN_LOGS_DIR}" \
    >> "${SWEEP_OUTPUT}" 2>&1
KILL_CRITERIA_EXIT=$?
set -e

DRYRUN_VERDICT="${DRYRUN_LOGS_DIR}/public-inbox-kill-criteria.json"
[ -f "$DRYRUN_VERDICT" ] || {
    echo "FATAL: dry-run verdict not materialized at $DRYRUN_VERDICT (kill-criteria exit=${KILL_CRITERIA_EXIT})" >&2
    rm -rf "$DRYRUN_LOGS_DIR"
    exit 3
}

# Persist the dry-run artifact (rename to a timestamped file in the live logs dir)
DRYRUN_ARTIFACT="${LOGS_DIR}/.public-inbox-predeploy-dry-run-$(date -u +%Y%m%dT%H%M%SZ).json"
mv "$DRYRUN_VERDICT" "$DRYRUN_ARTIFACT"
rm -rf "$DRYRUN_LOGS_DIR"

# Week-0 baseline placeholder. Mirrors the TBF-018 `.monitor-baseline-2026-06-29.json`
# pattern: a deploy-time snapshot of the threshold table (the only piece of state
# that matters for the cascade — the kill-criteria metrics themselves are not
# Δ-based). This file is the source of truth for "what thresholds were active
# when the cron was deployed" and is the artifact to consult during a future
# re-baseline or threshold-tune operation. Update this file (or re-run the
# dry-run) when re-tuning a threshold.
BASELINE_FILE="${LOGS_DIR}/.public-inbox-kill-criteria-baseline-$(date -u +%Y-%m-%d).json"
.venv/bin/python - "$BASELINE_FILE" "$TIMESTAMP" "$REPO_ROOT" <<'PYEOF'
import importlib.util, json, os, sys
baseline_file = sys.argv[1]
ts = sys.argv[2]
repo_root = sys.argv[3]

# Import THRESHOLDS from the kill-criteria script (single source of truth).
# Three-way lockstep: openspec/_index.json :: killCriteria ↔
# scripts/public_inbox_kill_criteria.py :: THRESHOLDS ↔ this baseline file.
spec = importlib.util.spec_from_file_location(
    "public_inbox_kill_criteria",
    os.path.join(repo_root, "scripts", "public_inbox_kill_criteria.py"),
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

baseline_doc = {
    "created_at": ts,
    "tool": "scripts.public_inbox_kill_criteria",
    "version": 1,
    "purpose": (
        "Week-0 baseline placeholder for public-inbox-monetization kill-criteria cron. "
        "Initial threshold values mirrored from scripts/public_inbox_kill_criteria.py::THRESHOLDS. "
        "Update this file (or re-run scripts/public-inbox-monetization-pre-deploy.sh) "
        "when re-tuning a threshold. See docs/dev/public-inbox-ops.md §Threshold-tune workflow."
    ),
    "thresholds": mod.THRESHOLDS,
}
with open(baseline_file, "w") as f:
    json.dump(baseline_doc, f, ensure_ascii=False, indent=2)
print(f"  Baseline placeholder persisted: {baseline_file}")
PYEOF

# Read the verdict + parse per-metric summary
export REPO_ROOT DRYRUN_ARTIFACT TIMESTAMP
echo ""
echo "[public-inbox-predeploy-dry-run] computing deploy verdict from cascade..."
.venv/bin/python - <<'PYEOF'
import json, sys, os
artifact_path = os.environ["DRYRUN_ARTIFACT"]
ts = os.environ["TIMESTAMP"]

artifact = json.load(open(artifact_path))
verdict = artifact["overall_verdict"]
severity = artifact["banner"]["severity"]
banner = artifact["banner"]["text"]
metrics = artifact["metrics"]

print(f"  Snapshot at:        {ts}")
print(f"  Verdict:            {verdict}")
print(f"  Severity:           {severity}")
print(f"  Banner:             {banner}")
print()
print(f"  Per-metric status:")
for k, v in metrics.items():
    val = v["value"]
    threshold = v["threshold"]
    op = v["operator"]
    sample = v["sample_size"]
    status = v["status"]
    if val is None:
        val_str = "n/a"
    elif isinstance(val, float):
        val_str = f"{val:.4f}"
    else:
        val_str = str(val)
    print(f"    {k:30s} {status:18s} value={val_str} (threshold {op}{threshold}, sample={sample})")
print()

# Annotate the artifact with pre-deploy context
artifact["pre_deploy_dry_run"] = {
    "purpose": "Pre-deploy dry-run (T-1 before public-inbox daily cron emission). Verifies 6-metric verdict cascade.",
    "deploy_recommendation": "DEPLOY" if verdict != "STOP-SHIP" else "DO NOT DEPLOY",
    "checked_at": ts,
}
with open(artifact_path, "w") as f:
    json.dump(artifact, f, ensure_ascii=False, indent=2)
print(f"  Artifact persisted: {artifact_path}")
print()

# Exit semantics
if verdict == "STOP-SHIP":
    print("[public-inbox-predeploy-dry-run] STOP-SHIP: DO NOT deploy daily cron. Investigate killswitch metric 🚨")
    sys.exit(1)
elif verdict == "WATCHFUL":
    print("[public-inbox-predeploy-dry-run] WATCHFUL: deploy daily cron (non-killswitch metric failed; review trigger_action). Plan:")
    print("  bash scripts/deploy-public-inbox-kill-criteria-cron.sh validate   # confirm pre-deploy checks")
    print("  bash scripts/deploy-public-inbox-kill-criteria-cron.sh install    # crontab -e write")
    sys.exit(0)
elif verdict == "INSUFFICIENT_DATA":
    print("[public-inbox-predeploy-dry-run] INSUFFICIENT_DATA: deploy daily cron (banner will be yellow/info until 30d data accumulates).")
    sys.exit(0)
else:  # CRUISE
    print("[public-inbox-predeploy-dry-run] CRUISE: deploy daily cron with confidence. Plan:")
    print("  bash scripts/deploy-public-inbox-kill-criteria-cron.sh validate   # confirm pre-deploy checks")
    print("  bash scripts/deploy-public-inbox-kill-criteria-cron.sh install    # crontab -e write")
    sys.exit(0)
PYEOF
