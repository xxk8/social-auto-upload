# Public-Inbox Kill Criteria — Operator Runbook

> Daily verdict + 30-day rolling threshold cron lifecycle: deploy, verify, idempotent re-run, rollback, and threshold tuning. Wired into the existing alert system (dashboard banner via `GET /api/public-inbox/kill-criteria` + optional webhook via `SAU_KILL_CRITERIA_WEBHOOK`). Anchored to `openspec/changes/public-inbox-monetization/design.md` §Kill Criteria — the same change that ships the `/try` public trial surface this runbook monitors.

## Why this exists

`scripts/public_inbox_kill_criteria.py` is the daily emitter for the 6 public-inbox-monetization kill criteria (reward button CTR, 5s abandon rate, affiliate CTR, registration conversion, monthly UV, platform failure rate). It runs un-attended via cron: queries the SQLite `guest_usage_logs` + `reward_events` tables for 30-day rolling windows, computes per-metric verdicts, and writes the cascade to `.sau-logs/public-inbox-kill-criteria.json`. The verdict is consumed by `web_runner/routes/public_inbox_kill_criteria.py::GET /api/public-inbox/kill-criteria` (admin-gated) which renders a banner in the Web Shell dashboard.

Without cron, no verdict emits; without the verdict, the dashboard banner is silent. This runbook covers the four operations an on-call operator might do:

1. **Deploy** — install the daily cron entry for the first time on a fresh host.
2. **Verify** — confirm the entry is present and the 30-day auto-trigger is wired correctly.
3. **Rollback** — remove the entry without touching unrelated cron entries.
4. **Re-tune** — adjust a threshold if the baseline arithmetic needs widening (e.g. `monthly_uv_avg` 5000 floor is too aggressive for a quiet product).

It does **not** cover the `/try` page implementation itself (see `openspec/changes/public-inbox-monetization/tasks.md`) or the dashboard banner UI (see `docs/web-shell.md`). Both preconditions for `install` mode to succeed.

## Prereqs

- Bash ≥ 3.2 (macOS default is fine).
- `python3` is on `$PATH`; **do NOT use the bare `python` command** — macOS does not ship `python` (only `python3`). Use `.venv/bin/python` (matches the cron line exactly) or `python3`.
- Project `.venv/` populated: `uv pip install -e .` from repo root.
- `web_runner/db.py` importable (so the script can call `get_database()`).
- `.sau-logs/` writable for the daily verdict JSON + cron log append.
- Optional: `SAU_KILL_CRITERIA_WEBHOOK` env var to enable Slack/飞书 webhook delivery on `STOP-SHIP` / `WATCHFUL` verdicts.

## Deploy — first-time install

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload

# Dry-validation (no crontab writes): runs all 5 prerequisite checks +
# invokes scripts/public-inbox-monetization-pre-deploy.sh as a strong gate +
# verifies the Week-0 baseline placeholder is materialized.
bash scripts/deploy-public-inbox-kill-criteria-cron.sh validate

# Real install (idempotent — see below). The install mode ALWAYS calls
# validate first (with output, not silent); if validate fails, install aborts
# BEFORE writing to crontab. No cron is ever deployed without a passing
# pre-deploy dry-run on the dev DB.
bash scripts/deploy-public-inbox-kill-criteria-cron.sh install

# Optional: enable webhook delivery (Slack/飞书/Discord incoming webhook URL)
# Add to the deploy user's shell profile OR to the cron line env block:
export SAU_KILL_CRITERIA_WEBHOOK="https://hooks.slack.com/services/.../..."
```

**Why the strong gate?** The pre-deploy dry-run is the only place we can
verify "will the daily cron emit STOP-SHIP at first fire?" against the real
dev DB. Without the gate, an operator could `install` a cron whose first
emission is a killswitch FAIL — wasted compute, false pager. The
`validate` → `install` chain guarantees:

1. Pre-deploy exits 0 (CRUISE / WATCHFUL / INSUFFICIENT_DATA, not STOP-SHIP).
2. Week-0 baseline placeholder file is present (proves the dry-run actually
   ran to completion, not just exited 0 by accident).
3. The crontab write only happens if both above are true.

If the pre-deploy is STOP-SHIP, validate fails; the operator must fix the
dev DB (e.g. data, schema) or wait for the issue to resolve before re-running
validate → install.

Expected post-install crontab (one line, daily at 07:00 UTC — one hour after the TBF-018 06:00 cron to avoid CPU contention):

```
# public-inbox-monetization daily kill-criteria cron entry (verbatim):
0 7 * * * cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload && .venv/bin/python scripts/public_inbox_kill_criteria.py >> .sau-logs/public-inbox-kill-criteria.log 2>&1
```

> **Two-keyed exit codes from the script**:
> - `0` — `CRUISE` / `WATCHFUL` / `INSUFFICIENT_DATA` (informational).
> - `1` — `STOP-SHIP` (operator action expected; webhook fired if configured).
> - non-zero on internal Python errors (bug, not kill criteria).

## Verify — the 30-day auto-trigger is wired

> **This is the §4 the prior PR was missing.** Three sanity checks together confirm the kill-criteria auto-trigger will fire after 30 days of data accumulates. If any of the three fails, the auto-trigger will silently break and the dashboard banner will not flip.

```bash
# (1) Crontab entry present (must return exactly 1 line)
crontab -l | grep -cE 'public_inbox_kill_criteria'
# → 1   (any other number means duplication; see Troubleshooting)

# (2) Daily script runnable end-to-end (emits verdict JSON without writing)
.venv/bin/python scripts/public_inbox_kill_criteria.py --dry-run --no-webhook
# Expected (with < 100 samples): verdict=INSUFFICIENT_DATA
# Expected (with ≥ 100 samples, all passing): verdict=CRUISE

# (3) Flask route serves the verdict (admin cookie required in production)
curl -b /tmp/sau-cookies.txt http://localhost:6001/api/public-inbox/kill-criteria
# Returns the same verdict JSON wrapped with Cache-Control: public, max-age=300.
# Bypass cache to force a fresh fetch:
curl -H 'Cache-Control: no-cache' -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/public-inbox/kill-criteria
```

**Interpretation of (2) — what each verdict means for the 30-day trigger**:

| Verdict | 30-day trigger status | Operator action |
|---|---|---|
| `INSUFFICIENT_DATA` | ⏳ Waiting for data accumulation (total sample < 100) | None — re-run in a few days. Banner is yellow/info. |
| `CRUISE` | ✅ All 6 metrics within thresholds | None — feature is healthy. Banner is green/info. |
| `WATCHFUL` | ⚠️ At least 1 non-killswitch metric failed | Review `failed=` line in `.sau-logs/public-inbox-kill-criteria.log`; follow `trigger_action` in the per-metric JSON. |
| `STOP-SHIP` | 🚨 At least 1 killswitch metric failed (monthly_uv_avg or platform_failure_rate) | Execute the per-metric `trigger_action` immediately. Webhook already fired. |

The 30-day auto-trigger **only fires** when the data has accumulated enough for the `MIN_SAMPLE_SIZE = 100` floor (or `30` for `monthly_uv_avg`) — see `scripts/public_inbox_kill_criteria.py::MIN_SAMPLE_SIZE`. Until then, the verdict is `INSUFFICIENT_DATA` and the banner reads "数据不足，暂不判定".

## Idempotent re-run behavior

The `install` mode wraps `crontab -l` with a `grep -vF` guard such that re-running it does **not** duplicate the line. The exact pattern from `scripts/deploy-public-inbox-kill-criteria-cron.sh` lines 71–73:

```bash
(
    crontab -l 2>/dev/null | grep -vF -e 'scripts/public_inbox_kill_criteria.py' || true
    echo "$CRON_LINE"
) | crontab -
```

So `install → install → install` produces **1 crontab with 1 line**, not 3. The TBF-018 deploy script uses the same `grep -vF` pattern; **the two scripts do not share a single crontab line text**, so re-running either does not disturb the other.

> **TOCTOU caveat**: the implementation does `(crontab -l | grep -vF | crontab -)` with no `flock`. Safe on a single-operator host; for multi-operator or fleet-style deploy, prepend `flock -n /tmp/sau-cron.lock` around both `crontab -l` and `crontab -` invocations. See the deploy script header for rationale.

## Rollback — remove the entry

The **deploy-canonical** rollback uses single `-e` fixed-string expression (matches `install` exactly):

```bash
crontab -l 2>/dev/null \
    | grep -vF -e 'scripts/public_inbox_kill_criteria.py' \
    | crontab -
```

Verified locally: the corrected pipe reduces the post-rollback crontab to **N-1 lines** (where N is the prior count, includes the TBF-018 entries). The live crontab stays untouched because no input was actually piped to `crontab -` — this is a state-preserving test discipline. **Always pipe to a temp file first, inspect, then re-run with `| crontab -` only when you've confirmed the diff is what you want.**

> **Same footgun as the TBF-018 runbook**: under `grep -vF` (fixed-string mode), patterns are matched **literally** — not as regex. The apparent short form
>
> ```bash
> crontab -l | grep -vF 'scripts/public_inbox_kill_criteria.py\s' | crontab -
> ```
>
> is a no-op: `\s` becomes the two literal characters `\`+`s`, which never matches the standalone occurrence. Always use the multi-`-e` form.

## Threshold-tune workflow

When `.sau-logs/public-inbox-kill-criteria.json` comes back **non-CRUISE**, you have six knobs available — but only two are genuinely tunable, and the rest are gates that should never be loosened because they encode the "kill the feature" invariant.

| Counter | Where the threshold lives | Tunable? | Why |
|---|---|---|---|
| `reward_button_ctr` | `scripts/public_inbox_kill_criteria.py::THRESHOLDS["reward_button_ctr"]` | **Yes** — informational signal | Loosening the 0.05 floor (e.g. 0.03) lets the feature survive weaker user pull, at the cost of keeping a feature with low engagement. |
| `reward_abandon_rate` | `THRESHOLDS["reward_abandon_rate"]` | **Yes** — informational signal | Loosening 0.70 (e.g. 0.80) accepts more 5s drop-offs. Better lever is to shorten the stub to 3s first. |
| `affiliate_ctr` | `THRESHOLDS["affiliate_ctr"]` | **No** — `implemented=False` | Not yet wired to a tracking event. Until `affiliate_click` event is added to `AffiliateRail` component, this metric returns `NOT_IMPLEMENTED`. Don't tune. |
| `registration_conversion` | `THRESHOLDS["registration_conversion"]` | **Yes** — informational signal | Loosening 0.02 (e.g. 0.01) buys time for the registration UX to mature. Better lever is to A/B test the registration copy. |
| `monthly_uv_avg` | `THRESHOLDS["monthly_uv_avg"]` | **No** — killswitch | The 5000 floor is a feature-sustain gate. If breached, the feature is not gaining enough traffic to justify its maintenance. Loosening defeats the kill criteria's purpose. |
| `platform_failure_rate` | `THRESHOLDS["platform_failure_rate"]` | **No** — killswitch | The 0.20 ceiling is a kill-switch for the entire feature. Loosening lets a broken user experience linger. |

### Re-tune procedure (informational metrics only)

```bash
# 1. Open scripts/public_inbox_kill_criteria.py in your editor and locate THRESHOLDS:
THRESHOLDS: dict[str, dict[str, Any]] = {
    "reward_button_ctr": {"operator": "<", "threshold": 0.05, ...},
    "reward_abandon_rate": {"operator": ">", "threshold": 0.70, ...},
    # ...
}

# 2. Decide which sub-knob to loosen. Mirror the change in
#    openspec/changes/public-inbox-monetization/_index.json::killCriteria
#    AND in openspec/changes/public-inbox-monetization/design.md §Kill Criteria
#    (three-way lockstep — openspec is the source of truth, not the script).

# 3. Manual dry-run against current DB state:
.venv/bin/python scripts/public_inbox_kill_criteria.py --dry-run

# 4. Verify the verdict is what you expect.
#    If STOP-SHIP fires afresh, revert the threshold widening.

# 5. Tomorrow's 07:00 UTC cron will overwrite the manual emission — that's fine.
```

### What NOT to re-tune

- `monthly_uv_avg = "delta < 5000 → STOP-SHIP"` is the feature-sustain invariant. If you feel the urge to lower this floor (e.g. 1000), stop and write a follow-up change: the right response to low traffic is to **drop the feature**, not to lower the bar.
- `platform_failure_rate = "delta > 0.20 → STOP-SHIP"` doesn't have a numeric knob because at 20% failure rate the user experience is broken. Loosening makes the broken experience persist.

## Manual dry-run emission (preview what the next 07:00 UTC cron will write)

> **macOS gotcha**: bare `python` is **not installed** on macOS. The bare command `python scripts/public_inbox_kill_criteria.py …` returns exit 1 with `command not found` and does **not** materialize the verdict JSON, even though the script is stdlib-only. Always invoke with `.venv/bin/python` (matches the cron line).

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload

# Preview WITHOUT overwriting the actual cron-emitted file (safe):
.venv/bin/python scripts/public_inbox_kill_criteria.py --dry-run --no-webhook
# Output: a one-line summary on stdout, no JSON written, no webhook fired.

# Mirror the cron's exact invocation (overwrites the live artifact):
.venv/bin/python scripts/public_inbox_kill_criteria.py
jq -r '"verdict=\(.overall_verdict) severity=\(.banner.severity) banner=\(.banner.text)"' \
    .sau-logs/public-inbox-kill-criteria.json

# Inspect per-metric details (the 6 thresholds + status + sample_size):
jq '.metrics | to_entries[] | {metric: .key, status: .value.status, value: .value.value, sample_size: .value.sample_size}' \
    .sau-logs/public-inbox-kill-criteria.json
```

**Exit-code semantics**:

| Exit | Meaning | Action |
|---|---|---|
| `0` | `CRUISE` / `WATCHFUL` / `INSUFFICIENT_DATA` (informational) | No action — banner is data, not a pager. |
| `1` | `STOP-SHIP` (monthly_uv_avg or platform_failure_rate failed) | Execute the per-metric `trigger_action` immediately. Webhook already fired (if configured). |
| `2+` | System error (missing DB / malformed DB / Python bug) | Fix the upstream root cause, then re-run. |

## How to reset test data (smoke the cascade transitions)

> **Why this section exists**: when onboarding a new operator, or after PR-A (public-inbox backend) is merged, you need to verify the kill-criteria cascade works end-to-end *without* waiting 30 days for real data. This procedure exercises the `INSUFFICIENT_DATA → CRUISE / WATCHFUL / STOP-SHIP` transitions by injecting synthetic fixture rows into a SQLite file the script reads from.

### Two-mode design

- **Mode A — Isolated smoke (recommended; works today)**: spin up a `/tmp/sau-pikc-smoke.db` file, bootstrap the public-inbox schema there, inject fixture data, point the script at it via `--db-path`. The dev DB is never touched — safe on any host, no cleanup beyond `rm /tmp/sau-pikc-smoke.db`.
- **Mode B — Live DB smoke (post-PR-A only)**: truncate the real `guest_usage_logs` + `reward_events` tables in `db/database.db` and inject fixture rows directly. Use this when you want to verify the *full* code path including `web_runner/routes/public_inbox_kill_criteria.py` consuming the JSON. **Always back up first.**

### Mode A — Isolated smoke (the recommended path)

#### Step 1: bootstrap a temp SQLite file

```bash
SMOKE_DB=/tmp/sau-pikc-smoke.db
SMOKE_LOGS=/tmp/sau-pikc-smoke-logs
rm -f "$SMOKE_DB" && mkdir -p "$SMOKE_LOGS"

# Schema mirrors scripts/public_inbox_kill_criteria.py::_SCHEMA_BOOTSTRAP,
# kept lockstep with web_runner/db.py::init_db() post-PR-A.
sqlite3 "$SMOKE_DB" <<'SQL'
CREATE TABLE guest_usage_logs (
    id INTEGER PRIMARY KEY,
    guest_uuid TEXT NOT NULL,
    ip TEXT,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE reward_events (
    id INTEGER PRIMARY KEY,
    guest_uuid TEXT NOT NULL,
    ip TEXT,
    event TEXT NOT NULL,
    elapsed_ms INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
);
SQL
```

#### Step 2: scenario A — `INSUFFICIENT_DATA → CRUISE`

Inject 1000 dense 30d-window downloaders + 60 reward grants (6% CTR, above 5% threshold) + 100 clicks / 10 abandons (10% abandon, well below 70%) + 50 new users (5% conversion, well above 2%) + 15000 historical downloaders placed at days 31-89 (OUTSIDE the 30d window, only contributing to the 90d `monthly_uv_avg` calc = (1000+15000)/3 = 5333 > 5000 threshold).

> **Why the 30d vs 90d data must be split**: the script's `downloaders` count and `uv_3m` count come from the same `guest_usage_logs` table. If historical 90d data also lives in the 30d window, it dilutes `reward_button_ctr` and `registration_conversion` ratios (e.g. 30 reward grants vs 6000 downloaders = 0.5% → FAIL). The fixture must pin the 30d-window subset so ratios stay above threshold, AND pad the 90d window separately to satisfy `monthly_uv_avg`.

```bash
sqlite3 "$SMOKE_DB" <<SQL
-- 30d-window activity: 1000 downloaders at -5 days (sample_size=1000 ≥ 100)
INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
SELECT 'd' || x, '10.0.0.1', 'download', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<1000) SELECT x FROM cnt);

-- 60 reward grants → reward_button_ctr = 60/1000 = 6% > 5% threshold → PASS
INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
SELECT 'r' || x, '10.0.0.1', 'reward', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<60) SELECT x FROM cnt);

-- 100 reward_button_clicks + 10 abandons → abandon = 10/100 = 10% < 70% → PASS, sample=100 ≥ 100 ✓
INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
SELECT 'c' || x, '10.0.0.1', 'reward_button_click', 0, datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<100) SELECT x FROM cnt);
INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
SELECT 'a' || x, '10.0.0.1', 'reward_abandon', 4000, datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<10) SELECT x FROM cnt);

-- 90d-window padding ONLY: 15000 historical downloaders at -31..-89 days
-- (OUTSIDE the 30d window — these only count toward uv_3m, not 30d sample_size)
-- monthly_uv_avg = (1000+15000)/3 = 5333 > 5000 threshold → PASS
INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
SELECT 'h' || x, '10.0.0.1', 'download', datetime('now', '-' || (30 + (x % 60)) || ' days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<15000) SELECT x FROM cnt);

-- 50 new users → registration_conversion = 50/1000 = 5% > 2% threshold → PASS
INSERT INTO users (email, role, created_at)
SELECT 'u' || x || '@smoke.test', 'user', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<50) SELECT x FROM cnt);
SQL

.venv/bin/python scripts/public_inbox_kill_criteria.py \
    --db-path "$SMOKE_DB" --logs-dir "$SMOKE_LOGS" --no-webhook
echo "exit=$?"
jq -r '"verdict=\(.overall_verdict) severity=\(.banner.severity) banner=\(.banner.text)"' \
    "$SMOKE_LOGS/public-inbox-kill-criteria.json"
```

**Expected**: `verdict=CRUISE severity=info`, banner starts with `✅ 公开试用 6 项 kill criteria 全部通过`, `exit=0`.

#### Step 3: scenario B — `CRUISE → WATCHFUL`

Re-create the temp DB and inject a single non-killswitch FAIL. Easiest: drop `reward_button_ctr` below 5% (10 reward grants / 1000 downloaders = 1%).

```bash
rm -f "$SMOKE_DB" && touch "$SMOKE_DB"
sqlite3 "$SMOKE_DB" <<'SQL'
CREATE TABLE guest_usage_logs (id INTEGER PRIMARY KEY, guest_uuid TEXT NOT NULL, ip TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE reward_events   (id INTEGER PRIMARY KEY, guest_uuid TEXT NOT NULL, ip TEXT, event TEXT NOT NULL, elapsed_ms INTEGER, created_at TEXT NOT NULL);
CREATE TABLE users           (id INTEGER PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
SQL

sqlite3 "$SMOKE_DB" <<SQL
-- 30d-window activity: 1000 downloaders at -5 days
INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
SELECT 'd' || x, '10.0.0.1', 'download', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<1000) SELECT x FROM cnt);

-- 10 reward grants → reward_button_ctr = 10/1000 = 1% < 5% → FAIL
INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
SELECT 'r' || x, '10.0.0.1', 'reward', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<10) SELECT x FROM cnt);

-- Other metrics stay at PASS levels (100 clicks, 10 abandons = 10%)
INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
SELECT 'c' || x, '10.0.0.1', 'reward_button_click', 0, datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<100) SELECT x FROM cnt);
INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
SELECT 'a' || x, '10.0.0.1', 'reward_abandon', 4000, datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<10) SELECT x FROM cnt);

-- 90d-window padding (15000 historical at days 31-89, OUTSIDE 30d) → monthly_uv_avg PASS
INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
SELECT 'h' || x, '10.0.0.1', 'download', datetime('now', '-' || (30 + (x % 60)) || ' days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<15000) SELECT x FROM cnt);

-- 50 new users (PASS registration_conversion)
INSERT INTO users (email, role, created_at)
SELECT 'u' || x || '@smoke.test', 'user', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<50) SELECT x FROM cnt);
SQL

.venv/bin/python scripts/public_inbox_kill_criteria.py \
    --db-path "$SMOKE_DB" --logs-dir "$SMOKE_LOGS" --no-webhook
echo "exit=$?"
jq -r '"verdict=\(.overall_verdict) severity=\(.banner.severity) failed=\([.metrics | to_entries[] | select(.value.status==\"FAIL\") | .key] | join(\",\"))"' \
    "$SMOKE_LOGS/public-inbox-kill-criteria.json"
```

**Expected**: `verdict=WATCHFUL failed=reward_button_ctr`, `severity=warning`, `exit=0`.

#### Step 4: scenario C — `WATCHFUL → STOP-SHIP`

A killswitch FAIL promotes `WATCHFUL → STOP-SHIP`. Easiest killswitch to trigger is `monthly_uv_avg` (since `platform_failure_rate` is `NOT_IMPLEMENTED` until PR-D wires the success/failure column). Drop the 90d padding to 0 so `monthly_uv_avg = 1000/3 = 333 < 5000 → FAIL → STOP-SHIP`.

```bash
rm -f "$SMOKE_DB" && touch "$SMOKE_DB"
sqlite3 "$SMOKE_DB" <<'SQL'
CREATE TABLE guest_usage_logs (id INTEGER PRIMARY KEY, guest_uuid TEXT NOT NULL, ip TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE reward_events   (id INTEGER PRIMARY KEY, guest_uuid TEXT NOT NULL, ip TEXT, event TEXT NOT NULL, elapsed_ms INTEGER, created_at TEXT NOT NULL);
CREATE TABLE users           (id INTEGER PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
SQL

sqlite3 "$SMOKE_DB" <<SQL
-- 30d-window activity (CRUISE on metrics 1/2/4): 1000 downloaders, 60 reward grants, 100 clicks, 10 abandons, 50 new users
INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
SELECT 'd' || x, '10.0.0.1', 'download', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<1000) SELECT x FROM cnt);
INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
SELECT 'r' || x, '10.0.0.1', 'reward', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<60) SELECT x FROM cnt);
INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
SELECT 'c' || x, '10.0.0.1', 'reward_button_click', 0, datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<100) SELECT x FROM cnt);
INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
SELECT 'a' || x, '10.0.0.1', 'reward_abandon', 4000, datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<10) SELECT x FROM cnt);
INSERT INTO users (email, role, created_at)
SELECT 'u' || x || '@smoke.test', 'user', datetime('now', '-5 days')
FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<50) SELECT x FROM cnt);

-- CRITICAL: NO 90d padding. monthly_uv_avg = 1000/3 = 333 < 5000 → FAIL → STOP-SHIP
-- (uv_3m = 1000 ≥ 30, so the sample-size gate is satisfied)
SQL

.venv/bin/python scripts/public_inbox_kill_criteria.py \
    --db-path "$SMOKE_DB" --logs-dir "$SMOKE_LOGS" --no-webhook
echo "exit=$?"
jq -r '"verdict=\(.overall_verdict) severity=\(.banner.severity) banner=\(.banner.text)"' \
    "$SMOKE_LOGS/public-inbox-kill-criteria.json"
```

**Expected**: `verdict=STOP-SHIP severity=error`, banner contains `monthly_uv_avg`, **`exit=1`** (kill-switch exit code; cron will surface this in mail spool).

#### Step 5: cleanup

```bash
rm -f "$SMOKE_DB" "$SMOKE_LOGS/public-inbox-kill-criteria.json"
rmdir "$SMOKE_LOGS" 2>/dev/null || true
echo "smoke artifacts cleaned"
```

### Mode B — Live DB smoke (post-PR-A only)

> **⚠️ Back up first.** Live-DB smoke mutates real tables. Only run when you want to verify the full code path end-to-end (incl. the Web Shell banner consuming the verdict JSON).
>
> **WAL gotcha**: `db/database.db` runs in SQLite WAL mode, so the live data is split across **three** files — `db/database.db` (main), `db/database.db-shm` (shared memory index), `db/database.db-wal` (write-ahead log). A plain `cp db/database.db "$BAK"` only captures the main file; if the WAL has uncheckpointed pages (e.g. tables you just dropped / inserted during the smoke), the backup will be stale and the restore (or the live DB after a `cp` overwrite) will replay the ghost data on next open. Two safe options:
>
> ```bash
> # Option 1 — checkpoint the WAL first, then a plain cp is enough:
> sqlite3 db/database.db 'PRAGMA wal_checkpoint(TRUNCATE);'
> cp db/database.db "$BAK"
>
> # Option 2 — copy all three files together:
> cp db/database.db{,-shm,-wal} "$(dirname "$BAK")/"
> ```
>
> The kill-criteria smoke hit this on 2026-07-02: a `cp`-only restore left the test tables behind because the WAL had not been checkpointed. The fix was an explicit `PRAGMA wal_checkpoint(TRUNCATE)` before re-checking the schema.

```bash
# 1. Back up the real DB
BAK="db/database.db.smoke-bak.$(date +%s)"
cp db/database.db "$BAK"
echo "backup: $BAK"

# 2. Truncate the public-inbox tables (keep `users`; only wipe the test
#    user records you previously injected)
sqlite3 db/database.db <<'SQL'
DELETE FROM guest_usage_logs;
DELETE FROM reward_events;
DELETE FROM users WHERE role = 'user' AND created_at >= datetime('now', '-30 days');
SQL

# 3. Run any of the scenario INSERT blocks above against db/database.db
#    (omit the CREATE TABLE statements — they exist post-PR-A)

# 4. Fire the script normally (no --db-path override; reads db/database.db)
.venv/bin/python scripts/public_inbox_kill_criteria.py

# 5. Verify via the admin endpoint (cookie required in production)
curl -b /tmp/sau-cookies.txt http://localhost:6001/api/public-inbox/kill-criteria

# 6. Restore from backup when done
LATEST_BAK=$(ls -t db/database.db.smoke-bak.* | head -1)
mv "$LATEST_BAK" db/database.db
```

### Why this works without waiting 30 days

The script's 30-day window is implemented as `created_at >= (now - 30 days)`. Inserting rows with `created_at = datetime('now', '-5 days')` (or `-N days` for `N < 30`) places all fixture rows inside the window so the threshold evaluation runs against fresh data immediately. The sample-size gates (`MIN_SAMPLE_SIZE = 100`, `uv_3m >= 30` for `monthly_uv_avg`) are also satisfied by the row counts in each scenario.

> **`NOT_IMPLEMENTED` is expected.** `affiliate_ctr` and `platform_failure_rate` always show `NOT_IMPLEMENTED` in this smoke because the `affiliate_click` event and the `success`/`failure` status column aren't wired yet (PR-D). The cascade ignores them in scenario A → CRUISE, demotes the rest in scenarios B/C as expected. Don't panic when those two metrics stay `NOT_IMPLEMENTED` — that's by design pre-PR-D.

## Monitoring the cron output

```bash
# Daily sweep log (one new line per cron fire at 07:00 UTC):
tail -f .sau-logs/public-inbox-kill-criteria.log

# Last emitted verdict JSON (read-once per dashboard refresh):
jq -r '"verdict=\(.overall_verdict) severity=\(.banner.severity) failed=\([.metrics | to_entries[] | select(.value.status=="FAIL") | .key] | join(","))"' \
    .sau-logs/public-inbox-kill-criteria.json

# Banner endpoint (web_runner, admin-only):
curl -b /tmp/sau-cookies.txt http://localhost:6001/api/public-inbox/kill-criteria
# Returns the same verdict JSON wrapped with Cache-Control: public, max-age=300.
# Bypass cache to force a fresh fetch:
curl -H 'Cache-Control: no-cache' -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/public-inbox/kill-criteria

# Webhook smoke-test (requires SAU_KILL_CRITERIA_WEBHOOK env):
SAU_KILL_CRITERIA_WEBHOOK="https://httpbin.org/post" \
    .venv/bin/python scripts/public_inbox_kill_criteria.py --dry-run
# Note: --dry-run does NOT fire the webhook. Drop --dry-run to test the full path
# (will overwrite the live artifact, prefer a temp test webhook URL).
```

## Webhook delivery

When `SAU_KILL_CRITERIA_WEBHOOK` is set and the verdict is `STOP-SHIP` or `WATCHFUL`, the script POSTs the full verdict JSON to the URL via stdlib `urllib.request.urlopen` (no external deps). 5-second timeout; failures are logged to stderr and the script continues. **The script does NOT retry** — the next day's cron emission provides the next attempt.

Supported webhook receivers:

- **Slack**: incoming webhook URL via Slack App → Incoming Webhooks.
- **飞书 (Lark)**: custom bot incoming webhook URL.
- **Discord**: webhook URL via Channel Settings → Integrations → Webhooks.
- **Generic JSON receiver**: any HTTP endpoint that accepts `application/json` POSTs.

Payload shape (mirrors the JSON file on disk):

```json
{
  "snapshot_at": "2026-08-01T07:00:00+00:00",
  "tool": "scripts.public_inbox_kill_criteria",
  "version": 1,
  "overall_verdict": "STOP-SHIP",
  "banner": {"severity": "error", "text": "🚨 ..."},
  "metrics": {
    "monthly_uv_avg": {"status": "FAIL", "value": 1200, "threshold": 5000, "operator": "<", "sample_size": 3600, "trigger_action": "..."},
    "..."
  }
}
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Daily cron emits nothing (log empty after several `:00+7` marks) | crontab entry missing or `.venv/bin/python` not at the canonical path | Re-run `bash scripts/deploy-public-inbox-kill-criteria-cron.sh install`; verify with `crontab -l | grep -cE 'public_inbox_kill_criteria' → 1` |
| Verdict is perpetually `INSUFFICIENT_DATA` | Total sample < 100 (no real user data yet) | None — wait for traffic. Banner is yellow/info by design. |
| Verdict is `WATCHFUL` with one or two metric `FAIL` | At least one informational metric breached threshold (reward_button_ctr, reward_abandon_rate, registration_conversion) | Review the `trigger_action` field in the per-metric JSON and follow it. Webhook fires if configured. |
| Verdict is `STOP-SHIP` (exit 1) | `monthly_uv_avg` or `platform_failure_rate` failed (killswitch) | Execute the per-metric `trigger_action` immediately. Do NOT loosen the threshold — the right response to a killswitch is the trigger action, not a threshold widening. |
| `affiliate_ctr` / `platform_failure_rate` always `NOT_IMPLEMENTED` | Tracking events not yet wired in the frontend | None for the cron; but file a follow-up to add `affiliate_click` event to `AffiliateRail` and `success` / `failure` status to the inbox route. |
| Webhook doesn't fire on `WATCHFUL` | `SAU_KILL_CRITERIA_WEBHOOK` env not set, OR script can't reach the URL | Check `.sau-logs/public-inbox-kill-criteria.log` for `[kill-criteria] webhook failed: ...`. 5-second timeout; transient network blips resolve on next cron fire. |
| Bare `python` command fails silently | macOS does not ship `python` | Use `.venv/bin/python` (cron-faithful) or `python3` |
| Entry count > 1 after multiple installs | Someone forked the deploy script and removed the `grep -vF` guard | Manually `crontab -e` and dedupe by hand. |
| Banner endpoint returns stale data | `Cache-Control: max-age=300` on the admin endpoint | Add `Cache-Control: no-cache` header, or wait 5 minutes. |

## Cross-references

- `scripts/public_inbox_kill_criteria.py` — the daily emitter (source of truth for threshold values).
- `scripts/deploy-public-inbox-kill-criteria-cron.sh` — the `print | validate | install` orchestrator (source of truth for cron line text + idempotency guard).
- `web_runner/routes/public_inbox_kill_criteria.py` — `GET /api/public-inbox/kill-criteria` admin endpoint that surfaces the verdict JSON to the dashboard banner.
- `web_runner/routes/monitor.py` — sibling endpoint for TBF-018 CDP throttling. Different SLA (5-min vs next-business-day), different verdict semantics. **Do NOT merge the two endpoints** — they answer different operational questions.
- `tests/test_public_inbox_kill_criteria.py` — unit tests covering threshold evaluation, verdict cascade, metric computation, banner generation, webhook delivery, route synthetic fallback.
- `openspec/changes/public-inbox-monetization/design.md` — source-of-truth for the 6 kill criteria (thresholds, trigger actions). Mirror changes here when re-tuning.
- `openspec/changes/public-inbox-monetization/_index.json::killCriteria` — machine-readable threshold table; three-way lockstep with the script + design.md.
- `openspec/changes/public-inbox-monetization/proposal.md` — context for the public-inbox-monetization change this runbook monitors.
- `docs/web-shell.md` — Web Shell dashboard banner UI; consumes `GET /api/public-inbox/kill-criteria`.
- `docs/dev/monitor-cdp-throttling-cron-ops.md` — sibling runbook for the TBF-018 monitoring window. Same operator-side conventions; **do not co-deploy**.
- `docs/dev/INDEX.md` — dev-docs hub; this file is registered under the Operators table.
- **Hub**: [docs/dev/INDEX.md#operators](docs/dev/INDEX.md#operators) — Operators (on-call, system ops).

## §7 PR-A successor (`scripts/public-inbox-monetization-pre-deploy.sh`)

> **Status (delivered 2026-07-02)**: PR-A successor pre-deploy dry-run is now implemented at `scripts/public-inbox-monetization-pre-deploy.sh`. The TBF-018 `scripts/pre-deploy-dry-run.sh` is the **pre-PR-A** dry-run; **after PR-A merges** (or in any post-PR-A environment), use the public-inbox successor instead. The TODO marker in `scripts/pre-deploy-dry-run.sh` has been followed: that script's FATAL message now points operators to this successor.
>
> **What changed (2026-07-02)**:
> 1. Created `scripts/public-inbox-monetization-pre-deploy.sh` (mirror of TBF-018 structure, but with the 4-verdict cascade from `scripts/public_inbox_kill_criteria.py`).
> 2. Updated `scripts/pre-deploy-dry-run.sh` to remove the `TODO(2026-07-02)` marker and point the FATAL message to the successor.
> 3. Added 12 pytest tests at `tests/test_public_inbox_monetization_pre_deploy.py` covering schema check, 4 cascade scenarios, isolation, baseline placeholder, and contract.
> 4. Updated the todo-guard test (`tests/test_pre_deploy_dry_run_todo_guard.py`) to handle the post-followup state.
>
> **What this section is now**: an **ops reference** for the public-inbox pre-deploy dry-run (vs the original "future PR-A dev checklist" it was before). See the mirror table below for the structural comparison to TBF-018, and the runbook below the table for the operator workflow.

### Mirror table — TBF-018 vs public-inbox-monetization

| 维度 | TBF-018 (pre-PR-A) | Public-Inbox (PR-A 接班) |
|---|---|---|
| **Baseline 文件** | `.sau-logs/.monitor-baseline-2026-06-29.json` (Week 0 reference, 不可调) | `.sau-logs/.public-inbox-kill-criteria-baseline-<date>.json` (待 PR-A 定义; 命名同 TBF-018 `.monitor-baseline-*.json` 模式, 初值从 `_index.json::killCriteria` 阈值表抄) |
| **N 项 metric 预检** | 3 metrics: `cdp_throttle` / `http_errors` / `race_events` — 来自 `scripts/diff_monitor_baseline.py::decide_severity` | 6 metrics: `reward_button_ctr` / `reward_abandon_rate` / `affiliate_ctr` / `registration_conversion` / `monthly_uv_avg` / `platform_failure_rate` — 来自 `scripts/public_inbox_kill_criteria.py::THRESHOLDS` |
| **Verdict cascade** | 3 档: `CRUISE` / `STOP-SHIP` / `STOP-SHIP-WATCHFUL` | 4 档: `CRUISE` / `WATCHFUL` / `STOP-SHIP` / `INSUFFICIENT_DATA` — 多 INSUFFICIENT 档专门处理 30d 样本 < 100 的"等数据"状态, 不发告警 |
| **Cron deploy script** | `scripts/deploy-monitor-cdp-throttling-cron.sh` (`print` / `validate` / `install` 三段式 + crontab idempotent guard) | `scripts/deploy-public-inbox-kill-criteria-cron.sh` (**已存在** — 2026-07-02 实现的 print / validate / install 三段式镜像版本, 可直接复用) |
| **Deploy cron 时刻** | `0 * * * *` (hourly) + `0 6 * * *` (daily) | `0 7 * * *` (daily, 错峰 1 小时避免与 TBF-018 的 06:00 cron 抢 CPU) |
| **Runbook cross-refs** | `docs/dev/monitor-cdp-throttling-cron-ops.md` (4 周监控窗口 + Week 0 baseline 不可调) | `docs/dev/public-inbox-ops.md` (**本 runbook** — 永久商业化指标, 无 4 周窗口期, threshold 可调) |

### Operator workflow (post-PR-A)

```bash
# 1. Validate prerequisites (mirrors the TBF-018 pattern)
bash scripts/public-inbox-monetization-pre-deploy.sh

# The script will:
#   a. Verify dev DB has guest_usage_logs + reward_events + users tables
#      (post-PR-A state — FATAL if missing; in pre-PR-A state use
#      scripts/pre-deploy-dry-run.sh instead).
#   b. Run scripts/public_inbox_kill_criteria.py LIVE (--no-webhook) with
#      --logs-dir pointing to a temp dir (does NOT clobber the live daily
#      emission).
#   c. Persist a dry-run artifact at:
#        .sau-logs/.public-inbox-predeploy-dry-run-<timestamp>.json
#   d. Persist a Week-0 baseline placeholder at:
#        .sau-logs/.public-inbox-kill-criteria-baseline-<date>.json
#      (initial THRESHOLDS values, for future re-baselining).
#   e. Print per-metric status + 4-verdict cascade summary.
#   f. Exit 0 on CRUISE / WATCHFUL / INSUFFICIENT_DATA (deploy daily cron).
#      Exit 1 on STOP-SHIP (DO NOT deploy; investigate killswitch metric).
#      Exit 2 on validation failure (binary / file / schema missing).
#      Exit 3 on parse failure (verdict JSON missing or malformed).

# 2. If dry-run returns CRUISE / WATCHFUL / INSUFFICIENT_DATA:
bash scripts/deploy-public-inbox-kill-criteria-cron.sh validate
bash scripts/deploy-public-inbox-kill-criteria-cron.sh install

# 3. Verify the daily cron is wired:
crontab -l | grep -cE 'public_inbox_kill_criteria'    # → 1
```

### Env vars (for test / CI use)

| Env var | Purpose |
|---|---|
| `SAU_DB_PATH_OVERRIDE` | Override the dev DB path (test isolation). |
| `SAU_LOGS_DIR_OVERRIDE` | Override the `.sau-logs/` dir (test isolation). |

### Test / fixture design

* `tests/test_public_inbox_monetization_pre_deploy.py` — 12 tests: 3 schema, 4 cascade scenarios (CRUISE / WATCHFUL / STOP-SHIP / INSUFFICIENT_DATA), 2 isolation (live emission + temp logs dir), 3 contract (executable bit, script content, TODO removal), 1 baseline placeholder.
* The cascade scenario tests use the same Mode A pattern as `docs/dev/public-inbox-ops.md` §6: temp SQLite + injected fixtures + `SAU_DB_PATH_OVERRIDE` + `SAU_LOGS_DIR_OVERRIDE` env vars.
* The `tests/test_pre_deploy_dry_run_todo_guard.py` rot-check now handles both pre-followup (marker present, rot logic applies) AND post-followup (marker absent, followed state) cases.

### 关键差异提醒 (post-PR-A)

- **Baseline 不可调 vs 可调**: TBF-018 baseline (`2026-06-29`) 是 TBF-018 monitoring window 锁定的; public-inbox baseline 是 deploy-time snapshot, 运营阶段会反复 re-baseline (re-run the dry-run 或手工编辑 baseline JSON), threshold tune 时同步更新
- **4 档 vs 3 档**: public-inbox 的 INSUFFICIENT_DATA 档是 Phase 1 数据冷启动的预期状态 (30d < 100 样本), 不应该 trigger 告警; TBF-018 没这档因为 hourly sweep 总有数据
- **Killswitch 升级路径**: `monthly_uv_avg < 5000` → STOP-SHIP 是 feature-sustain invariant (公开使用 `Kill criteria` kill switch 触发), 不是 TBF-018 那样的临时 technical-debt 观察
- **Cross-ref mirror**: 本 runbook 的 "Sibling runbook" 行已经反向加了一个 "Sibling runbook (TBF-018 monitoring)" 指针回 TBF-018 runbook, 形成双向 cross-ref 闭环
