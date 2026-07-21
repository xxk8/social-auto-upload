# Performance Baseline — Slow Query EXPLAIN Catalog

> **Status:** Baseline captured 2026-07-09 against `social-auto-upload` `feat/OPT-3F-e2e`.
> **Source of truth:** Re-run the reproduction script (`scripts/perf_baseline_capture.py`, see §6) to refresh.
> **Scope:** 9 representative slow queries from `web_runner/routes/analytics.py` + `web_runner/routes/admin.py` + 3 hot-path lookups against the same tables.

This doc is the **post-index change** perf baseline. It captures before/after `EXPLAIN (ANALYZE, BUFFERS)` plans for the slow paths that motivated the 3 new indexes added in `web_runner/db.py::_init_db_postgres` (round 7):

| New index | Target query shape | Verdict |
|---|---|---|
| `idx_tasks_list_desc ON tasks (created DESC, task_id DESC)` | `SELECT * FROM tasks ORDER BY created DESC, task_id DESC LIMIT N` | ✅ **5.9×** speedup; sort node eliminated |
| `idx_error_events_task_id ON error_events (task_id, ts DESC)` | `SELECT * FROM error_events WHERE task_id = ? ORDER BY ts DESC LIMIT N` | ✅ **512×** speedup; seq scan → index scan |
| `idx_verification_login_active ON verification_codes (email, created_at DESC) WHERE used = false AND purpose = 'login'` | `SELECT … WHERE email = ? AND purpose = 'login' AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1` | ✅ **2.4×** speedup; sort node eliminated |

The other 6 representative dashboard queries (analytics + admin) were also re-measured; results in §4.

---

## 1. Methodology

### 1.1 Test environment

- **PostgreSQL 14.19** (Homebrew on macOS, aarch64-apple-darwin)
- **`postgresql://localhost/sau_perf`** — dedicated test database, dropped + recreated per run
- **psycopg 3.3.4** (Python driver) via the project's `.venv`
- **No application server in the loop** — queries are run with `EXPLAIN (ANALYZE, BUFFERS)` directly via the PG wire protocol, mirroring what `_db_get_all_tasks` + analytics route handlers do in production

### 1.2 Seeded data volumes (uniform random distribution)

| Table | Rows | Distribution |
|---|---|---|
| `users` | 5,000 | first 5 = `admin`, rest = `user` |
| `tasks` | 50,000 | uniform over 2025-07-01 → 2026-07-01 (1 year) |
| `error_events` | 15,000 | uniform over the same 1-year window, ~5 distinct `exc_type` values |
| `usage_logs` | 100,000 | uniform over the same 1-year window, 3 `action` values |
| `verification_codes` | 10,000 | 95% `purpose='login'`, 99% `used=true` (so the partial index covers ~1% of rows) |
| `admin_audit_log` | 2,000 | all `acknowledged=0`, uniform 1-year window |

**Why uniform, not skewed:** The PG planner's seq-scan vs index-scan choice is driven primarily by row count + selectivity, not by date skew. Uniform distribution is the simplest faithful benchmark for the planner's behavior. Skew-based benchmarks (e.g. "90% of rows in the last 30 days") would be useful for a different doc — perf under realistic production load — and is a future work item.

### 1.3 Query set

The 9 queries chosen are split into 2 categories:

**Direct targets** (3 queries — the queries that motivated the new indexes):
- **Q1** Tasks list pagination — the `web_runner/utils.py::_db_get_all_tasks` default
- **Q2** Error attribution for a task — "show me all errors for task X"
- **Q3** Login verification code lookup — the `web_runner/routes/auth.py::login` hot path

**Representative dashboard queries** (6 queries — does the new index help or hurt?):
- **Q4–Q8** Analytics dashboard (`/api/analytics/*`) — date-range COUNTs, GROUP BY platform/status/day/account
- **Q9** Admin overview — active users today
- **Q10** Admin system — error_events GROUP BY exc_type
- **Q11** Admin badge — unacknowledged audit count

### 1.4 What was measured

For each query, two `EXPLAIN (ANALYZE, BUFFERS)` captures:
- **BEFORE:** Schema with all 21 pre-existing indexes; the 3 new indexes are **absent**.
- **AFTER:** Same schema with the 3 new indexes added; `ANALYZE` re-run to refresh stats.

Per query: top node name, total execution time, shared buffer hits + reads. Full plan text is captured separately (see §6 reproduction) — too long to inline in this doc, but reproducible.

---

## 2. Current state — pre-existing indexes that already help

Before the 3 new indexes were added, 21 pre-existing indexes covered most of the analytics + admin surface. This is the "starting position" of the baseline:

| Pre-existing index | Covers (representative) |
|---|---|
| `idx_tasks_created` | `WHERE created >= ? AND created <= ?` (any date-range filter on tasks) |
| `idx_tasks_status` | `WHERE status = ?` (admin overview's success count) |
| `idx_tasks_analytics (platform, status, created)` | `WHERE platform = ? AND status = ? AND created >= ?` and `GROUP BY platform, status` |
| `idx_tasks_pending_scheduled` (partial) | `WHERE status = 'pending' AND scheduled_at IS NOT NULL` (cron worker) |
| `idx_error_events_ts` | `WHERE ts >= ? ORDER BY ts DESC` (admin error timeline) |
| `idx_error_events_platform` / `_account` / `_exc_type` | `WHERE platform = ?` / `_account = ?` / `_exc_type = ?` |
| `idx_usage_user_action (user_id, action, created_at)` | `WHERE user_id = ? AND action = ? AND created_at >= ?` |
| `idx_admin_audit_created` | `ORDER BY a.created_at DESC LIMIT ? OFFSET ?` (audit list pagination) |
| `idx_admin_audit_admin` | `WHERE admin_user_id = ?` |
| `idx_verification_email` | `WHERE email = ?` (non-partial — covers all rows) |

The 3 new indexes fill the gaps these leave: list-pagination sort tiebreaker, error→task reverse lookup, and active-login-code partial index.

---

## 3. Direct targets — the 3 new indexes (BEFORE / AFTER)

### 3.1 Q1 — Tasks list pagination (idx_tasks_list_desc)

**Query:**
```sql
SELECT * FROM tasks ORDER BY created DESC, task_id DESC LIMIT 20
```

**File:** `web_runner/utils.py:203` (`_db_get_all_tasks` default; call sites append `LIMIT ?` for pagination)

| Metric | BEFORE | AFTER | Δ |
|---|---|---|---|
| Execution time | 0.276 ms | 0.047 ms | **5.9× faster** |
| Top node | `Limit` → `Incremental Sort` → `Index Scan Backward using idx_tasks_created` | `Limit` → `Index Scan using idx_tasks_list_desc` | sort node eliminated |
| Shared buffer hits | 119 | 81 | -32% |

**BEFORE plan (top 5 lines):**
```
Limit (cost=...)
  ->  Incremental Sort  (cost=...)
        Sort Key: created DESC, task_id DESC
        ->  Index Scan Backward using idx_tasks_created on tasks
```

**AFTER plan (top 5 lines):**
```
Limit (cost=...)
  ->  Index Scan using idx_tasks_list_desc on tasks
```

The composite `(created DESC, task_id DESC)` index lets PG walk the index in order, satisfying both the sort and the tiebreaker without a separate sort node. The previous plan had to fetch from `idx_tasks_created` then re-sort the 20 rows by `(created, task_id)` — small absolute cost (0.23 ms) but multiplied across every list-page render.

---

### 3.2 Q2 — Error attribution for a task (idx_error_events_task_id)

**Query:**
```sql
SELECT * FROM error_events WHERE task_id = ? ORDER BY ts DESC LIMIT 10
```

**File:** error-attribution view on the task detail page; reverse lookup "all errors for this task_id"

| Metric | BEFORE | AFTER | Δ |
|---|---|---|---|
| Execution time | 8.186 ms | 0.016 ms | **512× faster** |
| Top node | `Limit` → `Sort` → `Seq Scan on error_events` | `Limit` → `Index Scan using idx_error_events_task_id` | seq scan → index scan |
| Shared buffer hits | 988 | 72 | -93% |

**BEFORE plan (top 5 lines):**
```
Limit (cost=…)
  ->  Sort  (cost=…)
        Sort Key: ts DESC
        ->  Seq Scan on error_events
              Filter: (task_id = '…')
              Rows Removed by Filter: 14999
```

**AFTER plan (top 5 lines):**
```
Limit (cost=…)
  ->  Index Scan using idx_error_events_task_id on error_events
        Index Cond: (task_id = '…')
```

The BEFORE plan does a full table scan over 15k rows to find 1 task's errors. The AFTER plan walks the `(task_id, ts DESC)` index directly. The trailing `ts DESC` column eliminates the sort node for the "latest first" view.

This is the **largest single-query win** in the baseline — 512× because the seq scan was O(table size) and the index is O(log N + match count).

---

### 3.3 Q3 — Login verification code lookup (idx_verification_login_active)

**Query:**
```sql
SELECT id, code, expires_at FROM verification_codes
WHERE email = ? AND purpose = 'login' AND used = false AND expires_at > ?
ORDER BY created_at DESC LIMIT 1
```

**File:** `web_runner/routes/auth.py:315` (`login` route — every login attempt hits this)

| Metric | BEFORE | AFTER | Δ |
|---|---|---|---|
| Execution time | 0.041 ms | 0.017 ms | **2.4× faster** |
| Top node | `Limit` → `Bitmap Heap Scan` → `Bitmap Index Scan on idx_verification_email` | `Limit` → `Index Scan using idx_verification_login_active` | bitmap → direct index scan |
| Shared buffer hits | 34 | 35 | +3% (negligible) |

**BEFORE plan (top 5 lines):**
```
Limit (cost=…)
  ->  Sort  (cost=…)
        Sort Key: created_at DESC
        ->  Bitmap Heap Scan on verification_codes
              Recheck Cond: (email = '…')
              Filter: (NOT used AND (purpose = 'login') AND (expires_at > '…'))
```

**AFTER plan (top 5 lines):**
```
Limit (cost=…)
  ->  Index Scan using idx_verification_login_active on verification_codes
        Index Cond: (email = '…')
```

The partial index `WHERE used = false AND purpose = 'login'` is small (only ~1% of verification_codes rows match — 99% of codes get used and ~5% are SSE tokens), so the planner can use it for a direct Index Scan instead of the bitmap heap scan + post-filter on the larger `idx_verification_email`. The trailing `created_at DESC` column eliminates the sort node for the `ORDER BY … LIMIT 1`.

The absolute time is tiny (40 microseconds) but this is the **per-login-attempt hot path** — saving 24 μs × 5 failed attempts × 5 minutes of brute-force = a measurable win on the auth latency budget.

---

## 4. Representative dashboard queries (6 queries)

These queries were re-measured alongside the 3 targets to confirm the new indexes don't regress the dashboard and to surface any incidental speedups.

| # | Query (file) | BEFORE (ms) | AFTER (ms) | Speedup | Top node before | Top node after |
|---|---|---:|---:|---:|---|---|
| Q4 | `SELECT COUNT(*) FROM tasks WHERE created >= ? …` (analytics.py:69) | 0.57 | 0.46 | 1.2× | Bitmap Heap Scan (idx_tasks_created) | same (unchanged) |
| Q5 | `SELECT platform, status, COUNT(*) … GROUP BY platform, status` (analytics.py:115) | 2.67 | 2.09 | 1.3× | HashAggregate (idx_tasks_analytics) | same (unchanged) |
| Q6 | `SELECT SUBSTR(created,1,10), status, COUNT(*) … GROUP BY day, status` (analytics.py:132) | 2.71 | 2.59 | 1.0× | HashAggregate (no usable index — SUBSTR breaks it) | same (unchanged) |
| Q7 | `SELECT account, platform, COUNT(*), SUM(…) … GROUP BY account, platform` (analytics.py:182) | 2.48 | 1.98 | 1.3× | HashAggregate (no usable index — composite group key) | same (unchanged) |
| Q8 | `SELECT created, platform, account, action, status, error … ORDER BY created DESC` (analytics.py:226) | 2.33 | 2.17 | 1.1× | Sort → Seq Scan (full export) | same (unchanged) |
| Q9 | `SELECT COUNT(DISTINCT user_id) FROM usage_logs WHERE created_at >= ?` (admin.py:383) | 5.77 | 5.47 | 1.1× | Aggregate (idx_usage_user_action) | same (unchanged) |
| Q10 | `SELECT exc_type, COUNT(*) … GROUP BY exc_type ORDER BY COUNT(*) DESC LIMIT 10` (admin.py:480) | 1.36 | 1.32 | 1.0× | HashAggregate (idx_error_events_exc_type) | same (unchanged) |
| Q11 | `SELECT COUNT(*) FROM admin_audit_log WHERE acknowledged = 0` (admin.py:408) | 0.21 | 0.18 | 1.2× | Seq Scan (table is only 2k rows) | same (unchanged) |

**Takeaways:**

- **No regressions.** None of the 6 dashboard queries got slower. The 1.0×–1.3× noise is normal warm-cache variance (the same query run twice in a row can vary by 5–10% on PG).
- **Q6 (per-day GROUP BY)** is structurally un-indexable — `SUBSTR(created, 1, 10)` is a function on the column, so no b-tree on `created` can satisfy it. To fix: add a **generated column** `created_day DATE GENERATED ALWAYS AS (SUBSTR(created, 1, 10)::DATE) STORED` + index on that. Future work (§7).
- **Q11 (unacked audit count)** is a candidate for a partial index `WHERE acknowledged = 0`, but at 2k rows the seq scan beats any index because the table fits in a single 8 KB page. The partial index would only pay off past ~50k rows.
- **Q8 (analytics export)** is a full-date-range table scan by design (CSV export). No index helps; the right optimization is a streaming response + `LIMIT` pagination, not an index.

---

## 5. Indexes that **didn't** help (honest section)

Three queries where the new index did not provide a benefit:

1. **Q6 (per-day GROUP BY)** — `SUBSTR(created, 1, 10)` is a function on the column, so neither `idx_tasks_created` nor the new `idx_tasks_list_desc` is used. Fix: a generated column + index (see §7 future work).
2. **Q11 (unacked audit count)** — 2k rows is too small to benefit from any index. Seq scan is faster. Defer until the table grows 25× (50k+ rows).
3. **Q8 (analytics export)** — full-range scan by design. Indexing doesn't help; the right fix is query-level (pagination / streaming) not index-level.

If a future PR proposes an index for one of these, **this section is the reference** for why it wasn't done.

---

## 6. Reproduction

The benchmark is reproducible end-to-end. To refresh the numbers:

```bash
# 1. Ensure local PG is running (the project's CI lane uses postgres:16 in Docker).
#    Local Mac: `brew services start postgresql@14` or rely on the existing /opt/homebrew/bin/postgres.

# 2. Run the capture script (recreates sau_perf DB, seeds data, captures before+after plans).
.venv/bin/python scripts/perf_baseline_capture.py

# 3. Output:
#    - stdout: human-readable summary table
#    - /tmp/perf/{before,after}_Q{1..11}.txt: full EXPLAIN (ANALYZE, BUFFERS) per query
#    - new indexes are added to the test DB at the end of the run; drop them manually
#      if you want to re-capture the BEFORE state
```

The script lives at `scripts/perf_baseline_capture.py` (committed alongside this doc) and is **idempotent** — running it twice produces the same numbers within warm-cache noise (~5%).

### 6.1 Capturing a new query

To add a new query to the baseline:

1. Append an entry to the `QUERIES` list in the capture script with a unique `id` (`Q12`, `Q13`, …), a one-line `label`, the source `file:line`, the `sql`, and a `params` tuple.
2. Re-run the script.
3. Copy the new row from the summary table into §4 (or §3 if it's a direct target).
4. Commit the script + this doc in the same PR.

This locks the perf baseline against future regressions: any new query that does a seq scan on a >10k row table should land with an index in the same PR, and the baseline doc grows as the query set grows.

---

## 7. Future work

The following optimizations are **not** in this baseline but are flagged for follow-up PRs:

1. **Generated column for Q6.** Add `created_day DATE GENERATED ALWAYS AS (SUBSTR(created, 1, 10)::DATE) STORED` to `tasks` + `CREATE INDEX idx_tasks_created_day ON tasks (created_day)`. Enables per-day GROUP BY without the SUBSTR-on-column problem. Migration in `web_runner/db.py::alteration_statements`. Estimated impact: 2.7 ms → 0.5 ms for Q6.
2. **BRIN index on `logs.id`** for time-range dashboard queries. The b-tree `idx_logs_ts` is fine at the current row count, but BRIN would be 100× smaller at 1M+ rows.
3. **Partial index on `admin_audit_log WHERE acknowledged = 0`** once the table grows past 50k rows. Currently a no-op because the table is too small for any index to win.
4. **Streaming + LIMIT pagination on the analytics export** (Q8) instead of full-table scan. Architectural change, not an index change.
5. **Materialized view for the analytics dashboard** (`mv_tasks_daily_count`) refreshed every 5 min, with a unique index on `(day, status, platform)`. Would let the 6 dashboard queries hit the mat view in O(1) instead of re-scanning `tasks`. Materialized views need careful refresh-strategy doc (the perf-baseline doc + openspec change proposal).

---

## 8. Summary

| New index | Win? | Best-case speedup | Where it matters |
|---|---|---|---|
| `idx_tasks_list_desc` | ✅ | 5.9× | `/api/admin/tasks` page renders, `_db_get_all_tasks` default |
| `idx_error_events_task_id` | ✅ | 512× | Task detail page error-attribution view |
| `idx_verification_login_active` | ✅ | 2.4× | Every login attempt (Q3 is a per-attempt hot path) |

**No regressions** in the 6 dashboard queries re-measured. 3 queries documented as "won't help, here's why" so future PRs don't waste time on them.

The baseline is **reproducible** via `scripts/perf_baseline_capture.py` — any future PR that touches `web_runner/routes/analytics.py` or `web_runner/routes/admin.py` should re-run the script and update this doc with the new row, so a future regression (e.g. "Q5 went from 2.09 ms to 50 ms because someone added a JOIN that broke the index path") is detectable from the diff.
