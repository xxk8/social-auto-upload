# TBF-018 Monitor Cron — Operator Runbook

> Daily verdict + hourly CDP-throttle sweep cron lifecycle: deploy, verify, idempotent re-run, rollback, and threshold tuning. Anchored to the existing TBF-018 monitoring window (`2026-07-06 → 2026-08-02`) — the same window referenced by the Week 0 baseline JSON.

## Why this exists

`scripts/diff_monitor_baseline.py` and `scripts/monitor_cdp_throttling.py` are the two emitters for the TBF-018 4-week monitoring window. They run un-attended via cron: hourly CDP sweeps appended to `.sau-logs/monitor-cdp-throttling.log`, daily diff verdicts written to `.sau-logs/monitor-baseline-diff.json`. The verdict is consumed by `web_runner/routes/monitor.py::GET /api/monitor/status` (admin-gated) which renders a banner in the Web Shell dashboard.

Without cron, no verdict emits; without the verdict, the dashboard banner is silent. This runbook covers the four operations an on-call operator might do:

1. **Deploy** — install both cron entries for the first time on a fresh host.
2. **Verify** — confirm both entries are present (the user's exact grep).
3. **Rollback** — remove both entries without touching unrelated cron entries.
4. **Re-tune** — adjust the `http_errors` threshold if a `WATCHFUL` cross-threshold fires and the baseline arithmetic needs widening.

It does **not** cover the pre-deploy baseline seeding (see `scripts/pre-deploy-dry-run.sh`) or the dashboard rendering (see `docs/web-shell.md`). Both preconditions for `install` mode to succeed.

## Prereqs

- Bash ≥ 3.2 (macOS default is fine).
- `python3` is on `$PATH`; **do NOT use the bare `python` command** — macOS does not ship `python` (only `python3`), so `python scripts/diff_monitor_baseline.py …` silently fails with `command not found`. Use `.venv/bin/python` (matches the cron line exactly) or `python3`.
- Project `.venv/` populated: `uv pip install -e .` from repo root.
- `.sau-logs/.monitor-baseline-2026-06-29.json` (Week 0 reference) exists. The deploy script's `validate` mode refuses `install` if this file is missing.
- `.sau-logs/.monitor-predeploy-dry-run-2026-06-29.json` exists for the same reason. Both files are seeded by `scripts/pre-deploy-dry-run.sh` (T-1 day prior to first emission).

## Deploy — first-time install

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload

# Dry-validation (no crontab writes): check prerequisites emit "✓" for each
bash scripts/deploy-monitor-cdp-throttling-cron.sh validate

# Real install (idempotent — see below)
bash scripts/deploy-monitor-cdp-throttling-cron.sh install
```

Expected post-install crontab:

```
# TBF-018 hourly cron entry (verbatim):
0 * * * * cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload && .venv/bin/python scripts/monitor_cdp_throttling.py >> .sau-logs/monitor-cdp-throttling.log 2>&1
# Daily diff helper entry (TBF-018 + scripts/diff_monitor_baseline.py):
0 6 * * * cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload && .venv/bin/python scripts/diff_monitor_baseline.py --verdict-output .sau-logs/monitor-baseline-diff.json >> .sau-logs/monitor-baseline-diff.log 2>&1
```

> **Two-keyed exit codes from the script**:
> - `0` — both entries appended.
> - `2` — `validate` failed (missing prerequisite). Re-run `validate` first to find which is.
> - `1` — usage error (called with an unknown mode).

## Verify — the user's exact grep

```bash
crontab -l | grep -E 'monitor_cdp_throttling|diff_monitor_baseline'
```

Returns both lines (one hourly, one daily). **Entry count must be 2**, not 4 — the `install` mode is idempotent and re-runs collapse into the same two rows.

```bash
# Quick count sanity:
crontab -l | grep -cE 'monitor_cdp_throttling|diff_monitor_baseline'
# → 2   (any other number means duplication; see Troubleshooting)
```

Both commands expect **no `database` URL or auth env vars** to be set — these cron entries write to local disk only.

> **Pre-flight (added 2026-07-02):** before running `bash scripts/pre-deploy-dry-run.sh`, confirm the dev DB is in **pre-PR-A** state. The dry-run now has a built-in guard (step 0) that exits 2 if the public-inbox tables (`guest_usage_logs` / `reward_events`) already exist:
>
> ```bash
> bash scripts/pre-deploy-dry-run.sh 2>&1 | head -3 | grep "OK: dev DB in pre-PR-A state"
> # Expected: prints the OK line. Empty output = FATAL (post-PR-A state; re-baseline required).
> ```
>
> If the pre-PR-A check fails, the Week 0 baseline (`.monitor-baseline-2026-06-29.json`) no longer matches the dev DB shape and the dry-run's Δ computation would be misleading. See `scripts/pre-deploy-dry-run.sh` step 0 + `docs/dev/public-inbox-ops.md` §6 Mode B for the WAL gotcha that bit us on 2026-07-02.

## Idempotent re-run behavior

The `install` mode wraps `crontab -l` with a `grep -vF` guard such that re-running it does **not** duplicate the lines. The exact pattern from `scripts/deploy-monitor-cdp-throttling-cron.sh` lines 91–96:

```bash
(
    crontab -l 2>/dev/null | grep -vF -e 'scripts/monitor_cdp_throttling.py' -e 'scripts/diff_monitor_baseline.py' || true
    echo "$CRON_LINE"
    echo "$DAILY_CRON_LINE"
) | crontab -
```

So `install → install → install` produces **1 crontab with 2 lines**, not 6. This is the property verified by `tests/test_deploy_monitor_cdp_throttling_cron_idempotency.py` (3 tests).

> **TOCTOU caveat**: the implementation does `(crontab -l | grep -vF | crontab -)` with no `flock`. Safe on a single-operator host; for multi-operator or fleet-style deploy, prepend `flock -n /tmp/sau-cron.lock` around both `crontab -l` and `crontab -` invocations. See the deploy script header for rationale.

## Rollback — remove both entries

> **⚠ There is a footgun in the obvious-looking rollback command.** Under `grep -vF` (fixed-string mode), patterns are matched **literally** — **not as regex**. The apparent short form
>
> ```bash
> crontab -l | grep -vF 'scripts/monitor_cdp_throttling.py\scripts/diff_monitor_baseline.py' | crontab -
> ```
>
> is a no-op: `\s` becomes the two literal characters `\`+`s`, which never matches either standalone occurrence. Verified locally against the live crontab — the as-written form leaves both entries in place (`/tmp/sau_rollback_user.txt` retains 2 lines after the pipe).

The **corrected, deploy-canonical** rollback uses two `-e` fixed-string expressions (mirrors `install` exactly):

```bash
crontab -l 2>/dev/null \
    | grep -vF \
        -e 'scripts/monitor_cdp_throttling.py' \
        -e 'scripts/diff_monitor_baseline.py' \
    | crontab -
```

Verified locally: the corrected pipe reduces the post-rollback crontab to **0 lines** in simulation (`/tmp/sau_rollback_correct.txt` is empty), and the live crontab stays untouched because no input was actually piped to `crontab -`. **State-preserving test discipline** — always pipe to a temp file first, inspect, then re-run with `| crontab -` only when you've confirmed the diff is what you want.

If you also want to remove an entry by timestamp rather than full path (e.g. you see unfamiliar cron lines from a previous operator):

```bash
crontab -l > /tmp/sau-cron-pre.txt       # backup
crontab -l | sed '/^.*monitor_cdp_throttling.py/d; /^.*diff_monitor_baseline.py/d' \
    | crontab -
crontab -l > /tmp/sau-cron-post.txt      # diff against pre if anything unexpected
```

## Threshold-tune workflow

When `.sau-logs/monitor-baseline-diff.json` comes back **non-CRUISE**, you have three knobs available — and **only one of them is genuinely tunable**. The other two are binary gates that should never be loosened because they encode the TBF-018 revert-trigger invariant.

| Counter | Where the threshold lives | Tunable? | Why |
|---|---|---|---|
| `cdp_throttle` | `scripts/diff_monitor_baseline.py::decide_severity('cdp_throttle', delta…)` (lines 88–95) | **No** — any `delta > 0` → `STOP-SHIP` | This is THE TBF-018 revert trigger. If you see a non-zero delta, the operator action is to revert v9 fast-spin polish via a new TBF-NNN ticket per the 4-week decisions log, NOT to widen the threshold. |
| `http_errors` | Line 99: `threshold_ceil = max(5, int(baseline * 1.5) + 1)` | **Yes** — three sub-knobs (floor `5`, multiplier `1.5`, `+1` ceil precedence) | Informational-only signal. Not a revert trigger. Loosening controls how much weekly growth is tolerated before the banner severity flips from `info` → `warning`. |
| `race_events` | Lines 111–117 | **No** — any `delta > 0` → `WATCHFUL` but still informational | Supplementary cross-ref only. Loosening makes the cross-ref less useful; tightening produces noise from normal browser races. |

### The one tunable — `http_errors` ceiling

Today the formula behaves as follows on Week 0 (`baseline.http_errors = 3`):

| Baseline `B` | `int(B * 1.5) + 1` | Floor `5` binding? | Final `threshold_ceil` |
|---|---|---|---|
| 1 | 2 | yes | **5** |
| 3 | 5 | yes (tie) | **5** |
| 5 | 8 | no | **8** |
| 10 | 16 | no | **16** |
| 100 | 151 | no | **151** |

The **floor `5`** protects very small baselines from a `1`-wide tolerance window. The **multiplier `1.5`** controls when weekly growth is considered "steady" vs "trending". The **`+ 1`** rounds the ceiling up so the comparison `delta >= threshold_ceil` is inclusive (a delta that *equals* `int(B * 1.5)` would already be a violation).

### Re-tune procedure

```bash
# 1. Open scripts/diff_monitor_baseline.py in your editor and locate line 99:
threshold_ceil = max(5, int(baseline * 1.5) + 1)

# 2. Decide which sub-knob to loosen. Reasonable loosening directions:
#    - Floor: 5  → 20  (only for tiny-baseline hosts where 5 is too tight)
#    - Multiplier: 1.5  → 2.0  (accept 2x weekly growth before WATCHFUL)
#    - Both, with an inline comment explaining WHY.

# 3. Manual dry-run against current hourly-sweep state:
.venv/bin/python scripts/diff_monitor_baseline.py \
    --baseline-path .sau-logs/.monitor-baseline-2026-06-29.json \
    --verdict-output .sau-logs/monitor-baseline-diff.json

# 4. Verify the verdict is what you expect (CRUISE / WATCHFUL / STOP-SHIP).
#    If STOP-SHIP fires afresh, revert the threshold widening and follow
#    the rollback_path in .sau-logs/.monitor-predeploy-dry-run-2026-06-29.json.

# 5. Tomorrow's 06:00 UTC cron will overwrite the manual emission — that's fine.
```

### What NOT to re-tune

- `cdp_throttle = "delta > 0 → STOP-SHIP"` is the TBF-018 design invariant. If you ever feel the urge to set this to `delta > 5` or similar, stop and write a TBF-NNN ticket: the right response to a positive CDP delta is a code revert, not a threshold widening.
- `race_events = "delta > 0 → WATCHFUL"` doesn't have a numeric knob because the race-classifier signal has no "scale" semantics — a single `ContextClosed` event is informative on its own.

## Manual dry-run emission (preview what the next 06:00 UTC cron will write)

> **macOS gotcha**: bare `python` is **not installed** on macOS (`/usr/bin/python` is absent; only `python3` ships from `/opt/homebrew/bin` or `/Library/Frameworks/Python.framework`). The bare command `python scripts/diff_monitor_baseline.py …` returns exit 1 with `command not found` and does **not** materialize the verdict JSON, even though the script is stdlib-only and `python3` would work fine. Always invoke with `.venv/bin/python` (matches the cron line).

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload

# Preview WITHOUT overwriting the actual cron-emitted file (safe):
.venv/bin/python scripts/diff_monitor_baseline.py \
    --baseline-path .sau-logs/.monitor-baseline-2026-06-29.json \
    --verdict-output /tmp/sau-verdict-preview.json
cat /tmp/sau-verdict-preview.json

# Or, mirror the cron's exact invocation (overwrites the live artifact):
.venv/bin/python scripts/diff_monitor_baseline.py \
    --verdict-output .sau-logs/monitor-baseline-diff.json
jq -r '"verdict=\(.overall_verdict) severity=\(.banner.severity) cdp_delta=\(.counters.cdp_throttle.delta)"' \
    .sau-logs/monitor-baseline-diff.json
```

**Exit-code semantics**:

| Exit | Meaning | Action |
|---|---|---|
| `0` | CRUISE / WATCHFUL / INFO (informational) | No action — banner is data, not a pager. |
| `1` | STOP-SHIP (cdp_throttle delta > 0) | Revert v9 fast-spin polish via a new TBF-NNN ticket per project 4-week decisions log. |
| `2` | System error (missing baseline / malformed JSON / regex parse failure on the most recent hourly log line) | Fix the upstream root cause (re-seed baseline, fix log line format), then re-run. |

## Monitoring the cron output

```bash
# Hourly sweep log (one new line per cron fire):
tail -f .sau-logs/monitor-cdp-throttling.log

# Daily verdict log (one new line per cron fire at 06:00 UTC):
tail -f .sau-logs/monitor-baseline-diff.log

# Last emitted verdict JSON (read-once per dashboard refresh):
jq -r '"verdict=\(.overall_verdict) severity=\(.banner.severity) banner=\(.banner.text)"' \
    .sau-logs/monitor-baseline-diff.json

# Banner endpoint (web_runner, admin-only):
curl -b /tmp/sau-cookies.txt http://localhost:6001/api/monitor/status
# Returns the same verdict JSON wrapped with Cache-Control: public, max-age=300.
# Bypass cache to force a fresh fetch:
curl -H 'Cache-Control: no-cache' -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/monitor/status
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Hourly cron emits nothing (log empty after several `:00` marks) | crontab entry missing or `.venv/bin/python` not at the canonical path | Re-run `bash scripts/deploy-monitor-cdp-throttling-cron.sh install`; verify with `crontab -l | grep -cE 'monitor_cdp_throttling' → 1` |
| Daily verdict cron returns exit 2 | Baseline missing or `.monitor-cdp-throttling.log` empty | Run `scripts/pre-deploy-dry-run.sh` to seed both baselines; wait for one hourly sweep to land |
| Verdict is `STOP-SHIP` (exit 1) | `cdp_throttle>0` since baseline | Do NOT loosen the threshold; follow the `rollback_path` in `.sau-logs/.monitor-predeploy-dry-run-2026-06-29.json` and open a TBF-NNN revert ticket |
| Verdict is `WATCHFUL` with severity `error` | Mixed: `cdp_throttle>0` AND another counter flagged | Investigate `cdp_throttle.delta` first (the actual revert trigger); the rest is informational |
| Bare `python` command fails silently | macOS does not ship `python` | Use `.venv/bin/python` (cron-faithful) or `python3` |
| `crontab -l | grep -vF '…\s…' | crontab -` removes nothing | `\s` is treated as literal `\`+`s` under `-F` | Use multi-`-e` form: `grep -vF -e 'scripts/monitor_cdp_throttling.py' -e 'scripts/diff_monitor_baseline.py'` |
| Entry count > 2 after multiple installs | Someone forked `deploy-monitor-cdp-throttling-cron.sh` and removed the `grep -vF` guard | Manually `crontab -e` and dedupe by hand |
| Banner endpoint returns stale data | `Cache-Control: max-age=300` on the admin endpoint | Add `Cache-Control: no-cache` header, or wait 5 minutes |

## Daily-emission verification (hand-off after install)

The cron fires at `06:00 UTC` daily. To confirm the next-day emission lands as expected:

```bash
# 1. Wait until after 06:00 UTC, then:
date -u
jq -r '"verdict=\(.overall_verdict) severity=\(.banner.severity) banner=\(.banner.text) cdp_delta=\(.counters.cdp_throttle.delta) http_delta=\(.counters.http_errors.delta) race_delta=\(.counters.race_events.delta)"' \
    .sau-logs/monitor-baseline-diff.json

# 2. Expected: CRUISE on a quiet day. STOP-SHIP only if v9 fast-spin polish regressed.
#    If non-CRUISE, follow the threshold-tune procedure above (only tunable is http_errors).

# 3. Diff against yesterday's manual preview (if you kept a copy):
diff -q <(jq 'del(.snapshot_at)' .sau-logs/monitor-baseline-diff.json) \
        <(jq 'del(.snapshot_at)' /tmp/sau-verdict-preview.json)
# 0=structurally identical except timestamp; 1=counter delta changed since yesterday.
```

## Cross-references

- `scripts/deploy-monitor-cdp-throttling-cron.sh` — the `print | validate | install` orchestrator (source of truth for cron line text + idempotency guard).
- `scripts/diff_monitor_baseline.py::decide_severity` (lines 80–116) — per-counter threshold logic.
- `scripts/diff_monitor_baseline.py::main` (lines 200–253) — verdict cascade (per-counter status → `overall_verdict`).
- `scripts/pre-deploy-dry-run.sh` — T-1 day synthetic-load dry-run. Added 2026-07-02: step 0 in the comment block + Python heredoc guard that fails the run if the dev DB is in post-PR-A state (has `guest_usage_logs` / `reward_events` tables). See §3 Verify "Pre-flight" above.
- `scripts/monitor_cdp_throttling.py` — hourly sweep emitter; do not edit its STDIN/STDOUT format without bumping `SWEEP_LINE_RE` in `diff_monitor_baseline.py` (line 40).
- `.sau-logs/.monitor-baseline-2026-06-29.json` — Week 0 reference; never re-tune this file's `baseline_counts`.
- `.sau-logs/.monitor-predeploy-dry-run-2026-06-29.json` — T-1 day synthetic-load dry-run record and rollback-path note.
- `web_runner/routes/monitor.py` — `GET /api/monitor/status` admin endpoint that surfaces the verdict JSON to the dashboard banner.
- `tests/test_deploy_monitor_cdp_throttling_cron_idempotency.py` — locks the no-duplicate-on-reinstall property.
- `tests/test_diff_monitor_baseline.py` — 8 unit tests covering parse-error, baseline-missing, run-log-missing, threshold-edge, and per-counter verdict cascades.
- `docs/bug-tickets/test-app-bugfix-tickets-2026q3.md TBF-018` — design rationale for the 4-week monitoring window.
- `docs/web-shell.md` — Web Shell dashboard banner UI; consumes `GET /api/monitor/status`.
- `openspec/changes/project-optimization/tasks.md` §7.1 — v0.2 polish candidates incl. m3u8 deep-fetch memo that cross-references the path-C no-op decision.
- **Hub**: [docs/dev/INDEX.md#operators](docs/dev/INDEX.md#operators) — Operators (on-call, system ops).
- **Sibling runbook (public-inbox)**: [docs/dev/public-inbox-ops.md](public-inbox-ops.md) — post-PR-A pre-deploy (`scripts/public-inbox-monetization-pre-deploy.sh`) + 4-verdict kill-criteria cascade. The two scripts (TBF-018 monitoring vs public-inbox kill-criteria) do **not** share crontab lines, do **not** share dev-DB pre-flight, and do **not** share a baseline file — keep them independent.
- **Sibling runbook** (public-inbox-monetization, parallel kill-criteria cron): [docs/dev/public-inbox-ops.md](public-inbox-ops.md) — the dev DB pre-PR-A guard documented above mirrors the §6 Mode B "WAL gotcha" + schema-bootstrap contract from this runbook.

> **Discoverability**: this doc follows the same kebab-case + H2-sectioned pattern as `docs/dev/postgres-getting-started.md` and `docs/dev/hot-reload-philosophy.md`. If a future designer wants to consolidate `docs/dev/` into an `INDEX.md`, this file can be linked under "Operator runbooks / cron deployment".
