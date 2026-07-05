#!/usr/bin/env bash
# Deploy daily cron entry for public-inbox-monetization kill criteria monitor.
# Reference: openspec/changes/public-inbox-monetization/design.md §Kill Criteria
# + docs/dev/public-inbox-ops.md (operator runbook).
#
# Cron cadence: 0 7 * * * UTC (one hour AFTER the TBF-018 0 6 cron) to avoid
# CPU contention on a single-host deployment.
#
# Operator-side action: paste the printed cron_entry into the host crontab.
# Idempotent. Re-running this script is safe — print mode emits the same line.
#
# Lifecycle note: this cron is for a permanent business-metric feature, NOT a
# temporary technical-debt observation window (which is what the CDP-throttling
# cron is for). Keeping the deploy scripts separate prevents accidental
# deletion when TBF-018 maintenance ends.
#
# Prerequisites checked by `validate` mode:
#   - .venv/bin/python exists + is executable
#   - scripts/public_inbox_kill_criteria.py exists
#   - .sau-logs/ exists + is writable
#   - web_runner/db.py exists (so the script can import get_database)
#   - (optional) SAU_KILL_CRITERIA_WEBHOOK env var if webhook delivery is desired
#
# REPO_ROOT caveat: cron line target path = ${REPO_ROOT} (defaults to canonical
# dev-box path). For deploy host with different path, run `bash scripts/
# deploy-public-inbox-kill-criteria-cron.sh install /custom/path` OR pass
# REPO_ROOT env var.

set -eu

REPO_ROOT_DEFAULT="/Users/a123/Notes/02-project/projecke/github/social-auto-upload"
REPO_ROOT="${REPO_ROOT:-$REPO_ROOT_DEFAULT}"
CRON_LINE="0 7 * * * cd ${REPO_ROOT} && .venv/bin/python scripts/public_inbox_kill_criteria.py >> .sau-logs/public-inbox-kill-criteria.log 2>&1"

MODE="${1:-print}"  # default to 'print' so accidental invocation still emits useful info

print_entry() {
    cat <<EOF
# public-inbox-monetization daily kill-criteria cron entry (verbatim):
${CRON_LINE}
EOF
}

_print_manual_override_warning() {
    echo ""
    echo "⚠️  ⚠️  ⚠️  MANUAL OVERRIDE --skip-pre-deploy ACTIVE ⚠️  ⚠️  ⚠️"
    echo "  The pre-deploy dry-run was SKIPPED. The cron will be installed"
    echo "  WITHOUT validation of the dev DB or kill-criteria metrics."
    echo "  This is an EMERGENCY ESCAPE HATCH for ops scenarios where the"
    echo "  pre-deploy gate is blocking but you MUST deploy the cron NOW."
    echo "  Consequences:"
    echo "    • The first daily emission (tomorrow 07:00 UTC) will hit the"
    echo "      live dev DB — if thresholds would trigger STOP-SHIP, it will"
    echo "      fire as a surprise webhook (no deploy-time warning)."
    echo "    • The Week-0 baseline was NOT generated at deploy time. The"
    echo "      first daily emission will generate it instead."
    echo "    • The cron line includes MANUAL_DEPLOY=1 as an audit trail"
    echo "      visible in crontab -l."
    echo "  To re-enable the gate: re-run install WITHOUT --skip-pre-deploy"
    echo "  after the blocking issue resolves."
    echo "⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️"
    echo ""
}

validate() {
    local failed=0
    local checks=(
        "[ -x \"${REPO_ROOT}/.venv/bin/python\" ]" \
        "[ -f \"${REPO_ROOT}/scripts/public_inbox_kill_criteria.py\" ]" \
        "[ -d \"${REPO_ROOT}/.sau-logs\" ]" \
        "[ -w \"${REPO_ROOT}/.sau-logs\" ]" \
        "[ -f \"${REPO_ROOT}/web_runner/db.py\" ]"
    )
    for chk in "${checks[@]}"; do
        if eval "$chk" 2>/dev/null; then
            echo "✓ $chk"
        else
            echo "✗ FAILED: $chk"
            failed=1
        fi
    done

    # Strong gate: run the pre-deploy dry-run as part of validate.
    # This ensures we never install a cron whose first daily emission would be
    # STOP-SHIP (killswitch metric failed at deploy time). The pre-deploy also
    # persists the Week-0 baseline placeholder (deploy-time THRESHOLDS snapshot)
    # which install relies on as evidence the validation pipeline ran.
    #
    # The pre-deploy supports SAU_DB_PATH_OVERRIDE + SAU_LOGS_DIR_OVERRIDE for
    # test isolation; in production both env vars are unset and the pre-deploy
    # uses the canonical ${REPO_ROOT}/db/database.db + ${REPO_ROOT}/.sau-logs.
    if [ "$failed" -eq 0 ]; then
        if ! _run_pre_deploy_check; then
            failed=1
        fi
    fi

    if [ "$failed" -eq 0 ]; then
        echo ""
        echo "Pre-deploy validation PASSED. Ready to deploy cron entry below."
        echo "Optional: export SAU_KILL_CRITERIA_WEBHOOK=<url> before cron fires"
        echo "to enable Slack/飞书 webhook delivery on STOP-SHIP / WATCHFUL."
    else
        echo ""
        echo "Pre-deploy validation FAILED. Resolve missing items before cron emit."
        return 1
    fi
}

# Helper: invoke the pre-deploy dry-run as a validate-mode gate.
# Returns 0 on success (CRUISE / WATCHFUL / INSUFFICIENT_DATA + baseline file present),
# 1 on any failure (STOP-SHIP, validation error, parse error, missing baseline file).
# Output is captured to a temp log and the last 25 lines are surfaced for the operator.
_run_pre_deploy_check() {
    local pre_deploy_script="${REPO_ROOT}/scripts/public-inbox-monetization-pre-deploy.sh"
    if [ ! -x "$pre_deploy_script" ]; then
        echo "✗ FAILED: pre-deploy script not executable: $pre_deploy_script"
        echo "  Run: chmod +x scripts/public-inbox-monetization-pre-deploy.sh"
        return 1
    fi

    echo ""
    echo "→ Running pre-deploy dry-run as strong gate (no install if dry-run fails)..."
    local log_file
    log_file="$(mktemp -t sau_pre_deploy.XXXXXX.log)"
    if bash "$pre_deploy_script" "${REPO_ROOT}" > "$log_file" 2>&1; then
        echo "✓ pre-deploy dry-run exited 0 (CRUISE / WATCHFUL / INSUFFICIENT_DATA)"
        # Show the tail of the dry-run output (per-metric summary) so the operator
        # sees WHY the verdict was the way it was.
        tail -25 "$log_file" | sed 's/^/  /'
        # Verify the Week-0 baseline placeholder was persisted. This is the
        # traceability artifact for the deploy-time THRESHOLDS snapshot.
        # Honor SAU_LOGS_DIR_OVERRIDE for test isolation (the pre-deploy also
        # honors it, so the baseline lands in the same dir the gate looks in).
        local baseline_dir="${SAU_LOGS_DIR_OVERRIDE:-${REPO_ROOT}/.sau-logs}"
        local baseline_count
        baseline_count=$(find "$baseline_dir" \
            -name '.public-inbox-kill-criteria-baseline-*.json' -type f 2>/dev/null | wc -l)
        if [ "$baseline_count" -ge 1 ]; then
            echo "✓ Week-0 baseline placeholder present (.public-inbox-kill-criteria-baseline-*.json)"
            rm -f "$log_file"
            return 0
        else
            echo "✗ FAILED: Week-0 baseline placeholder not created in ${REPO_ROOT}/.sau-logs"
            echo "  Expected: .public-inbox-kill-criteria-baseline-YYYY-MM-DD.json"
            cat "$log_file" | sed 's/^/  /'
            rm -f "$log_file"
            return 1
        fi
    else
        local rc=$?
        echo "✗ FAILED: pre-deploy dry-run returned non-zero exit (rc=${rc})"
        echo "  Inspect the log for details:"
        cat "$log_file" | sed 's/^/  /'
        rm -f "$log_file"
        return 1
    fi
}

case "$MODE" in
    print)
        print_entry
        ;;
    validate)
        validate
        echo ""
        print_entry
        ;;
    install)
        skip_pre_deploy=false
        if [[ "${2:-}" == "--skip-pre-deploy" ]]; then
            skip_pre_deploy=true
        fi

        if $skip_pre_deploy; then
            _print_manual_override_warning
        else
            # Strong gate: install always runs validate first (shows output, not silent).
            # If validate fails, install aborts BEFORE writing to crontab. This ensures
            # no cron is ever deployed without a passing pre-deploy dry-run on the
            # dev DB (i.e. the daily emission is verified CRUISE-or-better first).
            echo "Running pre-install validation (strong gate)..."
            if validate; then
                echo ""
                echo "Validation PASSED. Proceeding with crontab install..."
            else
                echo ""
                echo "Validation FAILED. Refusing to install."
                echo "Re-run with 'validate' first to see what's blocking, or fix the"
                echo "root cause (e.g. dev DB schema missing public-inbox tables, or"
                echo "the daily emission would be STOP-SHIP at first fire)."
                echo "To bypass the pre-deploy check, run: install --skip-pre-deploy"
                exit 2
            fi
        fi

        # Build the cron line. If --skip-pre-deploy was used, prepend
        # MANUAL_DEPLOY=1 as an env-var audit trail visible in crontab -l.
        cron_line="$CRON_LINE"
        if $skip_pre_deploy; then
            cron_line="0 7 * * * cd ${REPO_ROOT} && MANUAL_DEPLOY=1 .venv/bin/python scripts/public_inbox_kill_criteria.py >> .sau-logs/public-inbox-kill-criteria.log 2>&1"
        fi

        # Idempotent: re-adds the cron line via crontab -l | grep -vF guard.
        # Mirrors deploy-monitor-cdp-throttling-cron.sh install mode exactly
        # to keep the operator's mental model consistent. The grep -vF pattern
        # matches both normal and MANUAL_DEPLOY=1 lines (both contain
        # public_inbox_kill_criteria.py), so idempotency works for both paths.
        (
            crontab -l 2>/dev/null | grep -vF -e 'scripts/public_inbox_kill_criteria.py' || true
            echo "$cron_line"
        ) | crontab -

        echo "Cron entry (daily) installed into $(id -un)'s crontab. Verify with:"
        echo "  crontab -l | grep public_inbox_kill_criteria    # 1 line"
        if $skip_pre_deploy; then
            echo "  ⚠️  This install bypassed the pre-deploy dry-run. Audit trail"
            echo "  MANUAL_DEPLOY=1 is in the cron line. Re-run install without"
            echo "  --skip-pre-deploy after the issue resolves."
        fi
        ;;
    *)
        echo "Usage: $0 [print|validate|install] [--skip-pre-deploy]"
        echo "  default: print  - emit the cron line verbatim (safe)"
        echo "  validate       - run pre-deploy checks + print if all pass"
        echo "  install        - crontab-writes the entry (operator-side only; idempotent)"
        echo "  install --skip-pre-deploy - install WITHOUT pre-deploy dry-run (⚠️  emergency override only)"
        exit 1
        ;;
esac
