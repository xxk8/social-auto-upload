#!/usr/bin/env bash
# Deploy TBF-018 hourly cron entry for patchright CDP-throttling monitoring.
# Reference: docs/bug-tickets/test-app-bugfix-tickets-2026q3.md TBF-018 Monitoring schedule.
# Operator-side action: paste the printed cron_entry into the host crontab (sudo crontab -e).
# Idempotent. Re-running this script is safe — prints the same entry every time.
#
# Race-window note: the `install` mode uses `(crontab -l | grep -vF | crontab -)` which has
# a TOCTOU race vs concurrent `crontab -e` from another session. Single-operator host is safe;
# for multi-operator / auto-deploy fleet, prepend `flock -n /tmp/sau-cron.lock` around both
# `crontab -l` and `crontab -` invocations. Module-level single-instance only.
#
# REPO_ROOT caveat: cron line target path = `${REPO_ROOT}` (defaults to canonical dev-box path).
# For deploy host with different path, run `bash scripts/deploy-monitor-cdp-throttling-cron.sh install /custom/path`
# OR pass REPO_ROOT env var. `print` and `validate` modes already REPO_ROOT-arg-aware;
# without override, the printed/installed line targets the canonical /Users/a123 path.
#
# Prerequisites checked by `validate` mode:
#   - .venv/bin/python exists + is executable
#   - scripts/monitor_cdp_throttling.py exists + is executable (chmod +x)
#   - .sau-logs/ exists + is writable
#   - .sau-logs/.monitor-baseline-2026-06-29.json exists (Week 0 reference)
#   - .sau-logs/.monitor-predeploy-dry-run-2026-06-29.json exists (Pre-deploy dry-run record)

set -eu

REPO_ROOT_DEFAULT="/Users/a123/Notes/02-project/projecke/github/social-auto-upload"
REPO_ROOT="${REPO_ROOT:-$REPO_ROOT_DEFAULT}"
CRON_LINE="0 * * * * cd ${REPO_ROOT} && .venv/bin/python scripts/monitor_cdp_throttling.py >> .sau-logs/monitor-cdp-throttling.log 2>&1"
DAILY_CRON_LINE="0 6 * * * cd ${REPO_ROOT} && .venv/bin/python scripts/diff_monitor_baseline.py --verdict-output .sau-logs/monitor-baseline-diff.json >> .sau-logs/monitor-baseline-diff.log 2>&1"

MODE="${1:-print}"  # default to 'print' so accidental invocation still emits useful info

print_entry() {
    cat <<EOF
# TBF-018 hourly cron entry (verbatim):
${CRON_LINE}
EOF
}

validate() {
    local failed=0
    local checks=(
        "[ -x \"${REPO_ROOT}/.venv/bin/python\" ]" \
        "[ -f \"${REPO_ROOT}/scripts/monitor_cdp_throttling.py\" ]" \
        "[ -d \"${REPO_ROOT}/.sau-logs\" ]" \
        "[ -w \"${REPO_ROOT}/.sau-logs\" ]" \
        "[ -f \"${REPO_ROOT}/.sau-logs/.monitor-baseline-2026-06-29.json\" ]" \
        "[ -f \"${REPO_ROOT}/.sau-logs/.monitor-predeploy-dry-run-2026-06-29.json\" ]"
    )
    for chk in "${checks[@]}"; do
        if eval "$chk" 2>/dev/null; then
            echo "✓ $chk"
        else
            echo "✗ FAILED: $chk"
            failed=1
        fi
    done
    if [ "$failed" -eq 0 ]; then
        echo ""
        echo "Pre-deploy validation PASSED. Ready to deploy cron entry below."
    else
        echo ""
        echo "Pre-deploy validation FAILED. Resolve missing items before cron emit."
        return 1
    fi
}

case "$MODE" in
    print)
        print_entry
        echo ""
        echo "# Daily diff helper entry (TBF-018 + scripts/diff_monitor_baseline.py):"
        echo "${DAILY_CRON_LINE}"
        ;;
    validate)
        validate
        echo ""
        print_entry
        echo ""
        echo "# Daily diff helper entry (TBF-018 + scripts/diff_monitor_baseline.py):"
        echo "${DAILY_CRON_LINE}"
        ;;
    install)
        # Idempotent: re-adds BOTH cron lines (hourly + daily) via crontab -l | grep -vF guard.
        # Operator-side: this writes to the current user's crontab. Run as the deploy user
        # (NOT root, unless the deploy host's policy requires root). Prefer piping
        # into `crontab -` rather than `sudo crontab -e` if the user's crontab is sufficient.
        # Idempotent: re-adds the cron line via crontab -l | grep -F guard.
        # Operator-side: this writes to the current user's crontab. Run as the deploy user
        # (NOT root, unless the deploy host's policy requires root). Prefer piping
        # into `crontab -` rather than `sudo crontab -e` if the user's crontab is sufficient.
        if validate >/dev/null 2>&1; then
            : # proceed
        else
            echo "Validation failed; refusing to install. Re-run with 'validate' first."
            exit 2
        fi
        (
            crontab -l 2>/dev/null | grep -vF -e 'scripts/monitor_cdp_throttling.py' -e 'scripts/diff_monitor_baseline.py' || true
            echo "$CRON_LINE"
            echo "$DAILY_CRON_LINE"
        ) | crontab -
        echo "Cron entries (hourly + daily) installed into $(id -un)'s crontab. Verify with:"
        echo "  crontab -l | grep monitor_cdp_throttling    # hourly entry"
        echo "  crontab -l | grep diff_monitor_baseline     # daily entry"
        ;;
    *)
        echo "Usage: $0 [print|validate|install]"
        echo "  default: print  - emit the cron line verbatim (safe)"
        echo "  validate       - run pre-deploy checks + print if all pass"
        echo "  install        - crontab-writes the entry (operator-side only; idempotent)"
        exit 1
        ;;
esac
