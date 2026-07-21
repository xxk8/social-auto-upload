# Index & Performance Topology

> **Status:** Living doc. The 3 indexes added in round 7 (`idx_tasks_list_desc`, `idx_error_events_task_id`, `idx_verification_login_active`) are documented here with their query patterns + measured speedups from `docs/perf-baseline.md`. The future-strategy section (§6) covers BRIN indexes, table partitioning, and materialized views — not yet implemented, but the design rationale + activation criteria are recorded so a future PR can land them without re-deriving the analysis.
>
> **Sibling doc:** `docs/perf-baseline.md` — the per-query before/after EXPLAIN (ANALYZE, BUFFERS) catalog. This doc is the *what* and *why*; perf-baseline is the *measured evidence*.

## 1. Scope

This doc covers the PostgreSQL-side performance topology of `social-auto-upload`:

1. **Current index inventory** (§2) — every index in `web_runner/db.py::_init_db_postgres`, what query it serves, when it was added
2. **The 3 new indexes (round 7)** (§3) — deep-dive: DDL, target query, measured speedup, maintenance cost
3. **Autovacuum tuning** (§4) — per-table settings for high-churn tables so dead-row bloat doesn't slow down the planner
4. **Index maintenance playbook** (§5) — how to add, drop, verify, and drift-check indexes (the contract this doc enforces on `web_runner/db.py`)
5. **Future strategies** (§6) — BRIN for time-series tables, partitioning for unbounded-growth tables, materialized views for dashboard queries
6. **References** (§7)

The target audience is the next operator who picks up this code without having been through the round-7 perf work. By the end of this doc you should understand every index in the schema, what query it serves, and what to do when a query goes slow.

## 2. Current index inventory

24 indexes total (21 pre-existing + 3 added in round 7). All live in `web_runner/db.py::_init_db_postgres::index_statements` and are `CREATE INDEX IF NOT EXISTS` so they're idempotent across re-deploys.

| # | Index | Table | Columns | Type | Query it serves |
|---|---|---|---|---|---|
| 1 | `idx_logs_ts` | `logs` | `ts` | b-tree | Time-range log queries (`WHERE ts >= ?`) |
| 2 | `idx_logs_message` | `logs` | `message` | b-tree | Exact-match message lookups (rare) |
| 3 | `idx_tasks_created` | `tasks` | `created` | b-tree | Date-range tasks filters (any `WHERE created >= ?`) |
| 4 | `idx_tasks_status` | `tasks` | `status` | b-tree | Status-only filters (admin overview, success counts) |
| 5 | **`idx_tasks_list_desc`** *(NEW)* | `tasks` | `(created DESC, task_id DESC)` | b-tree DESC | Paginated tasks list, default dashboard render |
| 6 | `idx_tasks_analytics` | `tasks` | `(platform, status, created)` | b-tree | `GROUP BY platform, status` + date filter (analytics dashboard) |
| 7 | `idx_tasks_pending_scheduled` | `tasks` | `(status, scheduled_at)` | b-tree **partial** | Cron worker picking up scheduled tasks |
| 8 | `idx_error_events_ts` | `error_events` | `ts` | b-tree | Error timeline (`WHERE ts >= ? ORDER BY ts DESC`) |
| 9 | `idx_error_events_platform` | `error_events` | `platform` | b-tree | Per-platform error counts |
| 10 | `idx_error_events_account` | `error_events` | `account` | b-tree | Per-account error counts |
| 11 | `idx_error_events_exc_type` | `error_events` | `exc_type` | b-tree | `GROUP BY exc_type` (admin system view) |
| 12 | **`idx_error_events_task_id`** *(NEW)* | `error_events` | `(task_id, ts DESC)` | b-tree | "Latest errors for this task" attribution view |
| 13 | `idx_auth_group_id` | `account_authorizations` | `group_id` | b-tree | FK lookup from `account_groups` |
| 14 | `idx_verification_email` | `verification_codes` | `email` | b-tree | Unfiltered email lookup (admin / SSE token path) |
| 15 | **`idx_verification_login_active`** *(NEW)* | `verification_codes` | `(email, created_at DESC)` | b-tree **partial** | Login hot path (active login code for email, latest first) |
| 16 | `idx_usage_user_action` | `usage_logs` | `(user_id, action, created_at)` | b-tree | Tier/quota metering (`WHERE user_id = ? AND action = ? AND created_at >= ?`) |
| 17 | `idx_admin_audit_created` | `admin_audit_log` | `created_at` | b-tree | Admin audit log list (`ORDER BY created_at DESC LIMIT/OFFSET`) |
| 18 | `idx_admin_audit_admin` | `admin_audit_log` | `admin_user_id` | b-tree | "What did admin X do?" forensic view |
| 19 | `idx_studio_projects_owner` | `studio_projects` | `(owner_user_id, updated_at DESC)` | b-tree | "My projects, recently updated first" dashboard |
| 20 | `idx_studio_episodes_project` | `studio_episodes` | `(project_id, episode_no)` | b-tree | Episode list within a project |
| 21 | `idx_notifications_task` | `notifications` | `task_id` | b-tree | Notifications for a specific task |
| 22 | `idx_notifications_event_type` | `notifications` | `event_type` | b-tree | Notifications filtered by type |
| 23 | `idx_notifications_unread` | `notifications` | `(delivered, final_failed)` | b-tree **partial** | Undelivered + failed-notification retry sweep |
| 24 | `idx_webhooks_config_route` | `webhooks_config` | `(platform, account)` | b-tree | Webhook routing lookup |

The `uniq_users_one_founder` partial unique index is also defined in `db.py` (a separate `CREATE UNIQUE INDEX ... WHERE is_founder = TRUE`) — it's an **invariant enforcer** (at most one founder), not a perf index, so it's not in this table.

## 3. The 3 new indexes (round 7) — deep dive

Each was added in the same PR that produced `docs/perf-baseline.md`. The decision to add each is documented in `openspec/changes/.../tasks.md` (round 7 perf indexes). The measured speedups are from `docs/perf-baseline.md §3`.

### 3.1 `idx_tasks_list_desc ON tasks (created DESC, task_id DESC)`

**DDL:**
```sql
CREATE INDEX IF NOT EXISTS idx_tasks_list_desc
  ON tasks (created DESC, task_id DESC)
```

**Target query** (`web_runner/utils.py:203`):
```sql
SELECT * FROM tasks ORDER BY created DESC, task_id DESC LIMIT ?
```

The composite DESC matches the `ORDER BY ... DESC` exactly. The trailing `task_id DESC` is the **load-bearing** tiebreaker: `_db_insert_task` writes `created` at `timespec="seconds"` precision (see `web_runner/utils.py`), so same-second inserts are the **common** case during batch publishes (e.g. cron sweeping 50 scheduled tasks in the same second). Without the tiebreaker, the planner picks an arbitrary `task_id` order and pagination is non-deterministic — page 2 could re-show rows from page 1. The composite is what makes the dashboard pagination contract safe.

**Why it matters:**
- Called on every `/api/admin/tasks` page render
- Was previously an `Index Scan Backward using idx_tasks_created` + `Incremental Sort` (0.276 ms, 119 buffer hits)
- Now a direct `Index Scan using idx_tasks_list_desc` (0.047 ms, 81 buffer hits) — **5.9× speedup**

**When it stops helping:** If the user adds a `WHERE` clause (e.g. `WHERE status = 'failed' ORDER BY created DESC, task_id DESC`), the planner has to choose between this index and `idx_tasks_status`. With low selectivity (status is 80% success), the planner may switch to a Bitmap Heap Scan on `idx_tasks_status`. That's still fine — the cost of the wrong plan on a 50k-row table is ~2 ms. Re-evaluate when the table exceeds 1M rows.

**Maintenance cost:** A composite 2-column index on a 50k-row table is ~1.2 MB on disk. Inserts append a single 16-byte entry per row. With ~1000 task inserts/day, bloat is negligible; VACUUM keeps it in check.

---

### 3.2 `idx_error_events_task_id ON error_events (task_id, ts DESC)`

**DDL:**
```sql
CREATE INDEX IF NOT EXISTS idx_error_events_task_id
  ON error_events (task_id, ts DESC)
```

**Target query** (error-attribution view on the task detail page):
```sql
SELECT * FROM error_events WHERE task_id = ? ORDER BY ts DESC LIMIT 10
```

**Why it matters:**
- The previous plan was `Seq Scan on error_events` (8.186 ms, 988 buffer hits) — the planner did a full table scan over 15k rows to find 1 task's errors
- Now a direct `Index Scan using idx_error_events_task_id` (0.016 ms, 72 buffer hits) — **512× speedup** (largest single-query win in the baseline)

The trailing `ts DESC` eliminates the sort node for the "latest first" view. If the query is rewritten to `ORDER BY ts ASC LIMIT 10` (e.g. "show me the first errors for this task"), the planner can still use this index via backward scan (the leading column is still `task_id`).

**When it stops helping:** This index is keyed on `task_id` which has a foreign-key-like distribution (some tasks have 0 errors, popular tasks have 100+). For "find errors for task X" it's optimal. For "find ALL errors of exc_type Y" it's useless — use `idx_error_events_exc_type` instead.

**Maintenance cost:** Similar to 3.1. ~600 KB on a 15k-row table. The trailing `ts DESC` doubles the per-row btree payload (8 bytes per key), but it's the difference between "no plan" and "512× plan" so the trade is worth it.

---

### 3.3 `idx_verification_login_active ON verification_codes (email, created_at DESC) WHERE used = false AND purpose = 'login'`

**DDL:**
```sql
CREATE INDEX IF NOT EXISTS idx_verification_login_active
  ON verification_codes (email, created_at DESC)
  WHERE used = false AND purpose = 'login'
```

**Target query** (`web_runner/routes/auth.py:315` — login hot path):
```sql
SELECT id, code, expires_at FROM verification_codes
WHERE email = ? AND purpose = 'login' AND used = false AND expires_at > ?
ORDER BY created_at DESC LIMIT 1
```

**Why it matters:**
- Per-login-attempt hot path (every login attempt hits this)
- Previous plan: `Bitmap Heap Scan on idx_verification_email` + post-filter for `used = false AND purpose = 'login'` (0.041 ms, 34 buffer hits)
- Now: direct `Index Scan using idx_verification_login_active` (0.017 ms, 35 buffer hits) — **2.4× speedup**

**The partial predicate `WHERE used = false AND purpose = 'login'` is the key insight:**
- 99% of `verification_codes` rows have `used = true` (codes get invalidated after one use)
- 95% are `purpose = 'login'` (the rest are SSE tokens)
- The partial index covers ~1% of the table — tiny index, fast scan, no post-filter cost

**`expires_at > ?` is intentionally NOT in the partial predicate.** PG would reject the index if we added `now()` (non-immutable), and even with a bound parameter (`WHERE expires_at > '2026-01-01'`) the partial predicate would only ever match the rows valid at the moment the index was created. We apply the `expires_at > ?` filter post-index instead, on the tiny partial result set.

**The trailing `created_at DESC` eliminates the sort node** for `ORDER BY created_at DESC LIMIT 1`. The planner walks the index in order and returns the first matching row.

**When it stops helping:** If the partial predicate ever matches >50% of rows (e.g. if `used` was never set), the planner will fall back to the full `idx_verification_email` + post-filter. This shouldn't happen in practice because the `used = 0` happens on INSERT (code is freshly created) and the index is naturally tiny.

**Maintenance cost:** Negligible. The partial index covers ~100 active codes at any time (5-minute TTL × 1 code per login attempt). ~10 KB on disk.

## 4. Autovacuum tuning

PG's default autovacuum is tuned for general-purpose workloads. For `social-auto-upload` the high-churn tables need explicit tuning so dead-row bloat doesn't slow down the planner's index-choice decisions.

### 4.1 The 4 high-churn tables

| Table | Insert rate | Update rate | Why high-churn |
|---|---|---|---|
| `logs` | High (~1k/day) | None | Bulk insert + trim-to-10000 rows pattern in `web_runner/utils.py` |
| `error_events` | High (~500/day) | None | Bulk insert + trim-to-10000 rows pattern in `web_runner/utils.py` |
| `usage_logs` | Very high (~3k/day) | None | Per-publish billing-meter log |
| `verification_codes` | Medium (~100/day) | High (status flip on use) | `used = 0 → used = 1` per login attempt |

The `tasks` and `error_events` tables are trimmed to 10k rows via the `_log_trim_counter` pattern (every 200 inserts, delete the oldest). This is a constant-volume workload — VACUUM cost is bounded.

The `verification_codes` table is naturally high-churn (codes expire after 5 minutes) but never trimmed. It grows linearly. Eventually a `cron` cleanup should be added (see §6.2).

### 4.2 Per-table settings

> **Deployed (round 7).** The 4 `ALTER TABLE ... SET (...)` statements below are now in `web_runner/db.py::alteration_statements` (they ship with `init_db()` so a fresh `create_app()` picks them up). `ALTER TABLE ... SET (...)` is idempotent (setting the same option to the same value is a no-op) so re-runs are safe — operators on older deployments get the tuning on next app restart with no manual migration. Re-ran `scripts/perf_baseline_capture.py` after the deploy: **no query regressed** — all 11 captured queries are within **0.9×–1.1×** of the §3 + §4 baseline numbers (warm-cache noise band). The speedup magnitudes for the 3 round-7 indexes are recorded in `docs/perf-baseline.md §3`; absolute exec times shift run-to-run on the order of 0.01 ms so we don't restate them here.
>
> **Locked-down PG roles (RDS, Cloud SQL, etc.).** If the app's PG role lacks `ALTER` privilege on the 4 high-churn tables (common on managed PG where the app role is separate from the migration role), `init_db()` will abort mid-loop on the first `ALTER TABLE ... SET (...)` statement and the app's first request 500s. In that case run the 4 ALTER TABLE statements manually as a one-time migration using a role with sufficient privilege (`rds_superuser` on RDS, `cloudsqliamuser` on Cloud SQL), then redeploy — subsequent `init_db()` calls are no-ops (idempotent) so the app picks up cleanly.

Apply via the schema's `ALTER TABLE ... SET (...)` statements in `web_runner/db.py::alteration_statements` (round 7+):

```sql
-- Default autovacuum_vacuum_scale_factor is 0.2 (20% dead rows triggers VACUUM)
-- For high-churn tables, lower it so VACUUM runs more often and bloat stays small.
ALTER TABLE logs SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE error_events SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE usage_logs SET (autovacuum_vacuum_scale_factor = 0.05);
-- verification_codes never trims (unlike logs / error_events which are
-- capped at 10k by _log_trim_counter). Aggressive autovacuum from day 1
-- is required; otherwise the table fills with dead codes (all used=true
-- after one use, all expired after 5 min) and the planner stats go stale.
ALTER TABLE verification_codes SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_cost_limit = 2000
);
```

**Why per-table, not `postgresql.conf`:** Different tables have different churn profiles. A blanket `autovacuum_vacuum_scale_factor = 0.05` would over-VACUUM small tables like `admin_audit_log` (only 2k rows) and waste IOPS. Per-table settings let you tune each table to its workload.

**Activation threshold:** `logs` / `error_events` / `usage_logs` are trimmed to 10k rows by `_log_trim_counter` so the absolute row count is bounded — apply the aggressive settings **from day 1** (the trim pattern makes the dead-row ratio a poor signal for the default 20% scale factor). `verification_codes` is unbounded (no trim pattern exists yet — see §6.2) so the 0.02 scale factor must also be in place **from day 1**; otherwise the table fills with used/expired codes and the partial index in §3.3 loses its selectivity advantage.

### 4.3 Monitoring bloat

After a few weeks of production, check for table bloat:

```sql
SELECT
  schemaname || '.' || relname AS table_name,
  n_live_tup, n_dead_tup,
  ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 1) AS dead_pct
FROM pg_stat_user_tables
WHERE n_live_tup > 1000
ORDER BY dead_pct DESC;
```

If `dead_pct > 20%` for any of the high-churn tables, the autovacuum settings in §4.2 aren't aggressive enough. Lower the scale factor further (e.g. `0.02`) or check if the trim jobs in `web_runner/utils.py` are running.

## 5. Index maintenance playbook

### 5.1 Adding a new index

1. **Identify the query** that needs the index. Run `EXPLAIN (ANALYZE, BUFFERS)` against the current schema and confirm the plan is suboptimal (seq scan on a >10k-row table, or explicit sort node where a covering index would do).
2. **Choose the index shape.** Use the smallest column list that satisfies the query (covering via `INCLUDE` if the query reads non-key columns). Add a trailing `DESC` if the query has `ORDER BY ... DESC`. Add a `WHERE` partial predicate for queries that always filter to a small subset.
3. **Add the DDL to `web_runner/db.py::index_statements`.** Use `CREATE INDEX IF NOT EXISTS` for idempotency. Use Python string-literal continuation for multi-line DDL.
4. **Sync the `NEW_INDEXES` list in `scripts/perf_baseline_capture.py`.** The drift check in §5.4 will refuse to run if they desync.
5. **Run `python scripts/perf_baseline_capture.py`** to capture before/after EXPLAIN plans. Paste the new row into `docs/perf-baseline.md §3` (direct target) or `§4` (representative query).
6. **Commit the index DDL + perf-baseline update + capture-script update in the same PR.** Otherwise the drift check goes red on the next perf-baseline run.

### 5.2 Dropping an unused index

1. **Verify the index is unused** via `pg_stat_user_indexes.idx_scan = 0` for at least 30 days. Don't drop based on gut feeling — even "obviously useless" indexes occasionally catch a one-off query (e.g. an ad-hoc admin report).
2. **Run the capture script FIRST** — if the index is removed, any query that depended on it shows a regression in the next baseline run. Capture the current state as the "with index" baseline.
3. **Drop via `DROP INDEX IF EXISTS name;` in a migration script** (not in `web_runner/db.py` — that file only adds, never drops, to preserve idempotency for re-deploys).
4. **Re-run the capture script** and confirm no query regressed. Update `docs/perf-baseline.md` if the captured numbers changed.

### 5.3 Verifying an index is used

```sql
-- Per-index usage stats
SELECT
  schemaname, relname, indexrelname,
  idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

`idx_scan = 0` for >30 days → candidate for §5.2.

```sql
-- Per-query plan check (single query)
EXPLAIN (ANALYZE, BUFFERS) <your query here>;
```

Look for `Index Scan using <name>` or `Bitmap Index Scan on <name>` in the plan output. If you see `Seq Scan`, the planner doesn't think the index helps (either the table is too small, or the selectivity is too low).

### 5.4 Drift check (the perf-baseline capture script's `NEW_INDEXES` list)

`scripts/perf_baseline_capture.py::_verify_index_drift()` runs at the top of every capture and refuses to run if any of the 3 new indexes in `NEW_INDEXES` has drifted from `web_runner/db.py`:

- **Name drift** (index added/renamed/removed in db.py without updating the script) → fail
- **DDL drift** (column added, opclass changed, `WHERE` clause modified in db.py without updating the script) → fail

This is the **contract** that links `web_runner/db.py` (the deployed schema) to `scripts/perf_baseline_capture.py` (the regression detector). When a future PR touches one of the 3 new indexes, the drift check forces them to update both files in the same PR — which is exactly what you want for a perf baseline.

If the drift check is failing and the diff is intentional, update `NEW_INDEXES` in the script. If it's accidental, fix `web_runner/db.py` to match.

## 6. Future strategies

These are not yet implemented. The design rationale + activation criteria are recorded so a future PR can land them without re-deriving the analysis.

### 6.1 BRIN indexes for time-series tables

**What:** Block Range Index — a tiny (1 KB per range) index ideal for monotonically-increasing time-series columns. The b-tree on `logs.id` / `error_events.id` / `notifications.id` is fine at the current row count but will grow to GB-scale past 1M rows.

**When to land:** When any of `logs`, `error_events`, `usage_logs`, `notifications` exceeds 1M rows AND the operator notices an index-size or seq-scan-on-time-range problem.

**DDL sketch:**
```sql
CREATE INDEX idx_logs_id_brin ON logs USING BRIN (id) WITH (pages_per_range = 32);
CREATE INDEX idx_error_events_id_brin ON error_events USING BRIN (id) WITH (pages_per_range = 32);
CREATE INDEX idx_notifications_created_brin ON notifications USING BRIN (created_at) WITH (pages_per_range = 32);
```

**Trade-off:** BRIN is 100× smaller than b-tree, but range scans are 5-10× slower per match (you scan the whole range, then filter). Only a win if the table is big enough that b-tree is in cache-pressure territory.

**Query set to re-evaluate:** `web_runner/utils.py::_db_get_logs(after=?)` and the admin trends endpoints. Run `docs/perf-baseline.md` capture before + after the BRIN add to confirm the trade is net-positive.

### 6.2 Table partitioning for unbounded-growth tables

**What:** Split a high-volume table into per-month (or per-day) partitions. Old partitions can be detached + archived without touching live data; each partition has its own (small) indexes.

**When to land:** When `logs` / `error_events` / `usage_logs` / `verification_codes` exceed ~1M rows AND a "drop old data" cleanup is needed (currently these tables are trimmed to 10k rows via DELETE, which is O(N) per call).

**DDL sketch (per-month range partitioning):**
```sql
CREATE TABLE logs_partitioned (
  id SERIAL,
  ts TEXT NOT NULL,
  message TEXT NOT NULL
) PARTITION BY RANGE (to_date(ts, 'YYYY-MM-DD"T"HH24:MI:SS'));

CREATE TABLE logs_2025_07 PARTITION OF logs_partitioned
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE logs_2025_08 PARTITION OF logs_partitioned
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
-- ... one partition per month
```

**Trade-off:** Partitioning requires the partition key to be in every query. For `logs` that's fine (every query has a `ts` filter or sort). For `error_events` and `usage_logs` similar. But cross-partition queries get slower (the planner has to check each partition).

**Old-data cleanup becomes a 1-second `DETACH PARTITION ... CONCURRENTLY`** instead of a multi-minute DELETE that holds row locks.

### 6.3 Materialized views for the dashboard

**What:** A PG materialized view that pre-aggregates the 5+ COUNT/GROUP BY queries in `web_runner/routes/analytics.py`. Refreshed every 5 min via `REFRESH MATERIALIZED VIEW CONCURRENTLY`.

**When to land:** When the analytics dashboard's p95 latency exceeds 500 ms (currently ~10 ms on 50k tasks). The threshold is the inflection point where re-scanning `tasks` on every page load becomes worse than paying the mat-view refresh cost.

**DDL sketch:**
```sql
CREATE MATERIALIZED VIEW mv_tasks_daily AS
SELECT
  date_trunc('day', to_timestamp(created, 'YYYY-MM-DD"T"HH24:MI:SS')) AS day,
  status,
  platform,
  COUNT(*) AS cnt
FROM tasks
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX ON mv_tasks_daily (day, status, platform);
```

**Refresh:**
```bash
# Every 5 min, run via cron
psql -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_tasks_daily;"
```

**Trade-off:** Stale data (up to 5 min old) on the dashboard. For most analytics views this is fine. For a "real-time task count" view (e.g. for the cron worker's "tasks pending" badge), do NOT use the mat view — query `tasks` directly.

### 6.4 JSONB GIN indexes for searchable payloads

**What:** GIN index on JSONB columns so queries like `WHERE payload @> '{"event":"x"}'` or `WHERE canvas_data->>'layer_id' = 'L3'` use the index instead of a seq scan.

**When to land:** If production ever sees a query that filters on a JSONB column. Currently the JSONB columns (`notifications.payload`, `studio_episodes.scenes_json` / `dialogues_json`) are read-only — no filtering, so no index needed.

**`studio_projects.canvas_data` is a special case — DO NOT GIN this column without thinking.** It's capped at 10 MiB per row by the `SAU_STUDIO_CANVAS_MAX_SIZE` env var (see `openspec/changes/studio-whiteboard/specs/canvas-editor/spec.md`). A GIN index on a 10 MiB JSONB is a multi-GB index that's only queried for canvas-content search — which the current product doesn't do. If a future "search canvases" feature lands, prefer a separate `canvas_search_index TEXT GENERATED` column derived from canvas contents + a b-tree on that, rather than GIN on the full JSONB.

**DDL sketch:**
```sql
CREATE INDEX idx_notifications_payload_gin ON notifications USING GIN (payload jsonb_path_ops);
```

`jsonb_path_ops` is smaller and faster than the default `jsonb_ops` but only supports `@>`. Use it unless you need `?`/`?|`/`?&` operators.

### 6.5 pg_trgm for substring search

**What:** Trigram GIN index for `LIKE '%substring%'` or `ILIKE '%substring%'` queries. PG's default b-tree cannot accelerate leading-wildcard substring matches; trigram GIN is the only path.

**When to land (concrete trigger):** When **both** of these are true:
1. `error_events.exc_message` exceeds 100k rows **and** `logs.message` exceeds 100k rows (the b-tree `idx_logs_message` can't help any LIKE pattern with a leading wildcard, so the threshold is "the table is large enough that a seq scan hurts")
2. Production code contains a real `WHERE <text_col> LIKE '%foo%'` or `WHERE <text_col> ILIKE '%foo%'` query — check with `git grep -nE "(LIKE|ILIKE) '%" web_runner/ sau_backend/`

Don't land on speculation ("we might want substring search someday") — the index is 1-2× the column size, so adding it pre-emptively is a real IOPS cost.

**DDL sketch:**
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_error_events_msg_trgm ON error_events USING GIN (exc_message gin_trgm_ops);
CREATE INDEX idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);
```

**Trade-off:** Trigram indexes are large (often 1-2× the column size). They make sense only when the substring-search workload is real and frequent — a one-off admin report can be answered with a seq scan in seconds even on 1M-row tables.

## 7. References

- **`docs/perf-baseline.md`** — the before/after EXPLAIN (ANALYZE, BUFFERS) catalog. Re-run `scripts/perf_baseline_capture.py` to refresh.
- **`scripts/perf_baseline_capture.py`** — the idempotent capture script. Has the `_verify_index_drift()` startup check that links this doc's index inventory to `web_runner/db.py`.
- **`web_runner/db.py::_init_db_postgres`** — source of truth for the index DDL. All 24 indexes live in the `index_statements` list (3 in `alteration_statements` for the partial unique).
- **`openspec/changes/migrate-sqlite-to-postgresql-19/`** — the round that cut over from SQLite to PG. Has the original index design rationale (which the round-7 indexes are a perf extension of).
- **`openspec/INDEX.md`** — discoverability hub. The "Database / perf" subsection links to this doc + perf-baseline + the openspec changes.

## 8. Indexes that **didn't** help

Three representative queries were measured in the round-7 perf baseline and showed **no benefit** from the new indexes. This section is the reference for the next operator so a future PR doesn't waste time proposing indexes for these — each has a structural reason no index can help, and the right fix is **not** an index.

### 8.1 Q6 — per-day GROUP BY (`SUBSTR(created, 1, 10)`)

**Query** (`web_runner/routes/analytics.py:132`):
```sql
SELECT SUBSTR(created, 1, 10) as day, status, COUNT(*) as cnt FROM tasks
WHERE created >= ? AND created <= ? || 'z'
GROUP BY day, status ORDER BY day
```

**Why no index helps:** `SUBSTR(created, 1, 10)` is a function applied to the column at query time. Neither `idx_tasks_created` nor the new `idx_tasks_list_desc` is usable because the b-tree keys are on the raw `created` value, not the `SUBSTR` projection. The planner is forced into a `HashAggregate` over a full date-range scan.

**The right fix is a generated column** (see `docs/perf-baseline.md §7` future work, item #1 — add a `tasks.created_day DATE GENERATED ALWAYS AS (SUBSTR(created, 1, 10)::DATE) STORED` + `CREATE INDEX idx_tasks_created_day ON tasks (created_day)`). This is structural, not an index-shape tweak.

---

### 8.2 Q11 — unacknowledged audit count (2k-row table)

**Query** (`web_runner/routes/admin.py:408`):
```sql
SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE acknowledged = 0
```

**Why no index helps:** `admin_audit_log` is 2k rows today. A partial index `WHERE acknowledged = 0` would shrink the candidate set, but at this size the whole table fits in a single 8 KB page — a seq scan reads it in one disk I/O and the planner correctly prefers that over an index lookup. The index wouldn't pay for itself until the table exceeds ~50k rows (the inflection point where index-random-access beats seq-scan-of-1-page).

**The right fix is to wait.** When the table grows past 50k rows, add the partial index at that time (round 8+). Don't add it pre-emptively — it'd be dead weight (wasted maintenance cost on every INSERT, zero read benefit).

---

### 8.3 Q8 — full-range analytics export

**Query** (`web_runner/routes/analytics.py:226`):
```sql
SELECT created, platform, account, action, status, error
FROM tasks WHERE created >= ? AND created <= ? || 'z'
ORDER BY created DESC
```

**Why no index helps:** The query reads every row in the date range and orders by `created DESC`. With a covering index `(created DESC, ...)` the planner could use the index for ordering, but the index scan still reads every matching index entry — the same total work as a seq scan + sort, just at higher per-page cost. The query is structurally O(date range) and no index reduces that.

**The right fix is query-level, not index-level:**
- **Streaming response** (the current implementation is a full `fetch_all()` + CSV string build; a Flask `Response(generate(), ...)` generator would stream rows to the client without buffering the whole result)
- **LIMIT pagination** if the export is being used for human review rather than data engineering
- **Materialized view** (see §6 future strategies — `mv_tasks_daily` is a better fit if the export is for repeated reporting)

---

**If a future PR proposes an index for any of these, this section is the reference for why it wasn't done.** The pattern is: indexes only help when the planner can use them. Three structural reasons stop the planner:
1. **Function on the column** (Q6) — b-tree on the raw column doesn't match the query's projection
2. **Table too small** (Q11) — seq scan beats index lookup below a size threshold
3. **Full-range scan by design** (Q8) — no index can reduce the work when the query has to read everything

Each of these has a structural fix (generated column, table growth, query-level change) — not an index shape.

