#!/usr/bin/env python3
"""Capture BEFORE/AFTER EXPLAIN (ANALYZE, BUFFERS) for the slow paths in
``web_runner/routes/analytics.py`` + ``web_runner/routes/admin.py``.

Used to generate ``docs/perf-baseline.md``. The script is idempotent: each
run drops + recreates the ``sau_perf`` test DB, seeds the same data
shape, and re-captures both the BEFORE (3 new indexes absent) and AFTER
(3 new indexes present) EXPLAIN plans.

Run from the repo root::

    .venv/bin/python scripts/perf_baseline_capture.py

Output:
  * stdout: human-readable summary table (paste into the doc §3 + §4)
  * ``/tmp/perf/{before,after}_Q{1..11}.txt``: full EXPLAIN plan per query
  * ``/tmp/perf/INDEX_PLAN.txt``: complete ``CREATE INDEX`` DDL that was
    added between the BEFORE and AFTER captures (so a future re-run
    starts from a known state)

The 3 new indexes that this script benchmarks are the ones added in
round 7 of ``web_runner/db.py::_init_db_postgres``:

  * ``idx_tasks_list_desc ON tasks (created DESC, task_id DESC)``
  * ``idx_error_events_task_id ON error_events (task_id, ts DESC)``
  * ``idx_verification_login_active ON verification_codes
     (email, created_at DESC) WHERE used = false AND purpose = 'login'``

If you change those indexes, re-run this script and update the doc.
"""
from __future__ import annotations

import argparse
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg

# Source-of-truth for the 3 new indexes: ``web_runner/db.py``. The hardcoded
# ``NEW_INDEXES`` list below is checked against this file at startup so a
# future PR that adds/removes/renames an index in db.py doesn't silently
# desync the script's captured plans from the deployed schema. See
# ``_verify_index_drift()`` for the check.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_DB_PY = _REPO_ROOT / "web_runner" / "db.py"

# ── Configuration ─────────────────────────────────────────────────
TEST_DB = "sau_perf"
ADMIN_DSN = "postgresql://localhost/postgres"
TEST_DSN = f"postgresql://localhost/{TEST_DB}"
OUT_DIR = "/tmp/perf"

SEED = 42
N_USERS = 5_000
N_TASKS = 50_000
N_ERRORS = 15_000
N_USAGE_LOGS = 100_000
N_VERIFICATION_CODES = 10_000
N_AUDIT_LOG = 2_000

FROM_DATE = "2026-06-01"  # 1-month window inside the 1-year seed range
TO_DATE = "2026-06-30"

PLATFORMS = ["douyin", "kuaishou", "xiaohongshu", "bilibili",
             "tencent", "tiktok", "baijiahao"]
ACCOUNTS = [f"acct_{i}" for i in range(1, 51)]
ACTIONS = ["upload-video", "upload-note"]
EXC_TYPES = ["TimeoutExpired", "NonZeroExit", "NetworkError",
             "CookieExpired", "AuthFailed"]

# The 3 new indexes that flip from ABSENT (BEFORE) to PRESENT (AFTER).
NEW_INDEXES = [
    "CREATE INDEX idx_tasks_list_desc "
    "ON tasks (created DESC, task_id DESC)",
    "CREATE INDEX idx_error_events_task_id "
    "ON error_events (task_id, ts DESC)",
    "CREATE INDEX idx_verification_login_active "
    "ON verification_codes (email, created_at DESC) "
    "WHERE used = false AND purpose = 'login'",
]

# Pre-existing indexes (mirror web_runner/db.py::_init_db_postgres
# PRIOR to the round 7 additions). Order matters for diff stability.
PREEXISTING_INDEXES = [
    "CREATE INDEX idx_tasks_created ON tasks (created)",
    "CREATE INDEX idx_tasks_status ON tasks (status)",
    "CREATE INDEX idx_error_events_ts ON error_events (ts)",
    "CREATE INDEX idx_error_events_platform ON error_events (platform)",
    "CREATE INDEX idx_error_events_account ON error_events (account)",
    "CREATE INDEX idx_error_events_exc_type ON error_events (exc_type)",
    "CREATE INDEX idx_usage_user_action "
    "ON usage_logs (user_id, action, created_at)",
    "CREATE INDEX idx_admin_audit_created ON admin_audit_log (created_at)",
    "CREATE INDEX idx_verification_email ON verification_codes (email)",
    "CREATE INDEX idx_tasks_analytics "
    "ON tasks (platform, status, created)",
    "CREATE INDEX idx_admin_audit_admin ON admin_audit_log (admin_user_id)",
]


# ── DB schema (mirrors web_runner/db.py::_init_db_postgres) ─────
SCHEMA_STATEMENTS = [
    """CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending',
        platform TEXT, action TEXT, account TEXT, created TEXT,
        code INTEGER, error TEXT, argv TEXT, result TEXT, publish_detail TEXT,
        priority INTEGER DEFAULT 0, scheduled_at TIMESTAMP
    )""",
    """CREATE TABLE error_events (
        id SERIAL PRIMARY KEY, ts TEXT NOT NULL, task_id TEXT,
        level TEXT NOT NULL DEFAULT 'error', phase TEXT NOT NULL,
        platform TEXT, account TEXT, action TEXT,
        exc_type TEXT, exc_message TEXT, traceback TEXT, argv TEXT,
        attempt_no INTEGER, retry_count INTEGER, status_code INTEGER
    )""",
    """CREATE TABLE users (
        id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL,
        last_login TEXT, login_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
        license_tier TEXT DEFAULT 'legacy', license_key TEXT, license_activated_at TIMESTAMP,
        name TEXT, avatar TEXT, is_founder BOOLEAN NOT NULL DEFAULT FALSE
    )""",
    """CREATE TABLE verification_codes (
        id SERIAL PRIMARY KEY, email TEXT NOT NULL, code TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'login', expires_at TEXT NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE usage_logs (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        action TEXT NOT NULL CHECK(action IN ('publish','ai_generate','account_add')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE admin_audit_log (
        id SERIAL PRIMARY KEY,
        admin_user_id INTEGER NOT NULL REFERENCES users(id),
        target_user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0
    )""",
]


# ── Query set (9 queries: 3 direct targets + 6 representative) ──
def build_queries(cur) -> list[dict]:
    """Build the 9-query set with seed-derived bound parameters.

    Some queries (Q2, Q3) need a real ``task_id`` / ``email`` from the
    seeded data; we sample one with a quick SELECT.
    """
    cur.execute("SELECT email FROM verification_codes "
                "WHERE used=false AND purpose='login' LIMIT 1")
    q3_email = cur.fetchone()[0]
    cur.execute("SELECT task_id FROM tasks LIMIT 1")
    q2_task = cur.fetchone()[0]

    return [
        # ── DIRECT TARGETS (3) ──
        {
            "id": "Q1",
            "label": "Tasks list (paginated default)",
            "file": "web_runner/utils.py:203",
            "sql": "SELECT * FROM tasks ORDER BY created DESC, task_id DESC LIMIT 20",
            "params": (),
        },
        {
            "id": "Q2",
            "label": "Error events for a task (latest first)",
            "file": "error attribution view",
            "sql": "SELECT * FROM error_events WHERE task_id = %s "
                   "ORDER BY ts DESC LIMIT 10",
            "params": (q2_task,),
        },
        {
            "id": "Q3",
            "label": "Latest active login verification code for email",
            "file": "web_runner/routes/auth.py:315",
            "sql": "SELECT id, code, expires_at FROM verification_codes "
                   "WHERE email = %s AND purpose = 'login' AND used = false "
                   "AND expires_at > %s "
                   "ORDER BY created_at DESC LIMIT 1",
            "params": (q3_email, "2026-01-01T00:00:00"),
        },
        # ── ANALYTICS DASHBOARD (5) ──
        {
            "id": "Q4",
            "label": "Tasks COUNT in date range (analytics summary)",
            "file": "web_runner/routes/analytics.py:69",
            "sql": "SELECT COUNT(*) as total FROM tasks "
                   "WHERE created >= %s AND created <= %s || 'z'",
            "params": (FROM_DATE, TO_DATE),
        },
        {
            "id": "Q5",
            "label": "Tasks GROUP BY platform, status (analytics summary)",
            "file": "web_runner/routes/analytics.py:115",
            "sql": "SELECT platform, status, COUNT(*) as cnt FROM tasks "
                   "WHERE created >= %s AND created <= %s || 'z' "
                   "GROUP BY platform, status",
            "params": (FROM_DATE, TO_DATE),
        },
        {
            "id": "Q6",
            "label": "Tasks per-day GROUP BY day (analytics summary)",
            "file": "web_runner/routes/analytics.py:132",
            "sql": "SELECT SUBSTR(created, 1, 10) as day, status, "
                   "COUNT(*) as cnt FROM tasks "
                   "WHERE created >= %s AND created <= %s || 'z' "
                   "GROUP BY day, status ORDER BY day",
            "params": (FROM_DATE, TO_DATE),
        },
        {
            "id": "Q7",
            "label": "Per-account GROUP BY (analytics accounts)",
            "file": "web_runner/routes/analytics.py:182",
            "sql": "SELECT account, platform, COUNT(*) as total, "
                   "SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success, "
                   "SUM(CASE WHEN status IN ('failed','error') "
                   "THEN 1 ELSE 0 END) as failed "
                   "FROM tasks WHERE created >= %s AND created <= %s || 'z' "
                   "AND account IS NOT NULL AND account != '' "
                   "GROUP BY account, platform ORDER BY total DESC",
            "params": (FROM_DATE, TO_DATE),
        },
        {
            "id": "Q8",
            "label": "Tasks SELECT + ORDER BY created DESC (analytics export)",
            "file": "web_runner/routes/analytics.py:226",
            "sql": "SELECT created, platform, account, action, status, error "
                   "FROM tasks WHERE created >= %s AND created <= %s || 'z' "
                   "ORDER BY created DESC",
            "params": (FROM_DATE, TO_DATE),
        },
        # ── ADMIN DASHBOARD (3) ──
        {
            "id": "Q9",
            "label": "Active users today (admin overview)",
            "file": "web_runner/routes/admin.py:383",
            "sql": "SELECT COUNT(DISTINCT user_id) AS cnt FROM usage_logs "
                   "WHERE created_at >= %s",
            "params": (FROM_DATE,),
        },
        {
            "id": "Q10",
            "label": "Error events GROUP BY exc_type (admin system)",
            "file": "web_runner/routes/admin.py:480",
            "sql": "SELECT exc_type, COUNT(*) AS cnt FROM error_events "
                   "WHERE exc_type IS NOT NULL GROUP BY exc_type "
                   "ORDER BY cnt DESC LIMIT 10",
            "params": (),
        },
        {
            "id": "Q11",
            "label": "Unacknowledged audit log count (admin badge)",
            "file": "web_runner/routes/admin.py:408",
            "sql": "SELECT COUNT(*) AS cnt FROM admin_audit_log "
                   "WHERE acknowledged = 0",
            "params": (),
        },
    ]


# ── Seed data ────────────────────────────────────────────────────
def seed(db) -> None:
    """Seed the sau_perf DB with realistic row counts.

    Uses ``cur.executemany`` with ``None`` for NULLs (the most reliable
    psycopg 3 path; ``COPY`` from StringIO has NULL-escape issues that
    bite on macOS for some reason). Seed time ~10s on PG 14.
    """
    random.seed(SEED)
    statuses = ["success"] * 80 + ["failed"] * 15 + ["error"] * 5
    random.shuffle(statuses)
    start = datetime(2025, 7, 1, tzinfo=timezone.utc)
    cur = db.cursor()
    t0 = time.time()

    # users
    cur.executemany(
        "INSERT INTO users (email, role, created_at, last_login, "
        "login_attempts, locked_until, license_activated_at, "
        "license_key, license_tier, is_founder) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        [(f"user{i}@test.com",
          "user" if i > 5 else "admin",
          "2025-01-01T00:00:00", None, 0, None, None, None, None, False)
         for i in range(1, N_USERS + 1)],
    )

    # tasks (50k) — chunked to avoid massive in-memory SQL
    tasks = []
    for i in range(N_TASKS):
        secs = random.randint(0, 365 * 24 * 3600)
        ts = start + timedelta(seconds=secs)
        tasks.append((f"task-{i:06d}", random.choice(statuses),
                      random.choice(PLATFORMS), random.choice(ACTIONS),
                      random.choice(ACCOUNTS),
                      ts.isoformat(timespec="seconds")))
    for j in range(0, len(tasks), 5000):
        cur.executemany(
            "INSERT INTO tasks (task_id, status, platform, action, account, "
            "created) VALUES (%s, %s, %s, %s, %s, %s)",
            tasks[j:j + 5000],
        )

    # error_events (15k)
    errors = []
    for i in range(N_ERRORS):
        secs = random.randint(0, 365 * 24 * 3600)
        ts = start + timedelta(seconds=secs)
        errors.append((ts.isoformat(timespec="seconds"),
                       f"task-{random.randint(0, N_TASKS - 1):06d}",
                       "error", "runtime",
                       random.choice(PLATFORMS), random.choice(ACCOUNTS),
                       random.choice(ACTIONS), random.choice(EXC_TYPES),
                       f"Error message {i}", None, None, None, None, None))
    for j in range(0, len(errors), 5000):
        cur.executemany(
            "INSERT INTO error_events (ts, task_id, level, phase, platform, "
            "account, action, exc_type, exc_message, traceback, argv, "
            "attempt_no, retry_count, status_code) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            errors[j:j + 5000],
        )

    # usage_logs (100k)
    usage = []
    for i in range(N_USAGE_LOGS):
        secs = random.randint(0, 365 * 24 * 3600)
        ts = start + timedelta(seconds=secs)
        usage.append((random.randint(1, N_USERS),
                      random.choice(["publish", "ai_generate", "account_add"]),
                      ts))
    for j in range(0, len(usage), 5000):
        cur.executemany(
            "INSERT INTO usage_logs (user_id, action, created_at) "
            "VALUES (%s, %s, %s)",
            usage[j:j + 5000],
        )

    # verification_codes (10k, 99% used=true, 95% purpose=login)
    cur.executemany(
        "INSERT INTO verification_codes (email, code, purpose, expires_at, "
        "used, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
        [(f"user{random.randint(1, N_USERS)}@test.com",
          f"{random.randint(100000, 999999):06d}",
          "login" if i % 100 < 95 else "sse",
          (start + timedelta(seconds=random.randint(60, 86400))
           + timedelta(minutes=5)).isoformat(timespec="seconds"),
          random.random() < 0.99,
          (start + timedelta(seconds=random.randint(60, 86400)))
          .isoformat(timespec="seconds"))
         for i in range(N_VERIFICATION_CODES)],
    )

    # admin_audit_log (2k, all unacked)
    cur.executemany(
        "INSERT INTO admin_audit_log (admin_user_id, target_user_id, action, "
        "detail, created_at, acknowledged) VALUES (%s,%s,%s,%s,%s,%s)",
        [(random.randint(1, 5), random.randint(6, N_USERS),
          "role_change", "{}",
          (start + timedelta(seconds=random.randint(0, 365 * 24 * 3600)))
          .isoformat(timespec="seconds"),
          0) for _ in range(N_AUDIT_LOG)],
    )

    cur.execute("ANALYZE")
    print(f"  +seed complete ({time.time() - t0:.1f}s)")


# ── EXPLAIN capture + parsing ────────────────────────────────────
def parse_plan(plan_text: str) -> dict:
    """Extract (exec_time_ms, plan_time_ms, shared_hit, shared_read, top_node).

    Note: ``re.finditer`` yields ``re.Match`` objects, not strings. Earlier
    versions of this function called ``int(g)`` on the Match itself, which
    raised ``TypeError`` at runtime. We unwrap each match's group(1)
    explicitly. Variable names are scoped per use (``exec_m``,
    ``plan_m``, ``hit_m``, ``read_m``) to avoid the shadowing trap where
    reusing a single ``m`` for two ``re.search`` calls leaves the second
    branch accidentally referring to the first match.
    """
    exec_m = re.search(r"Execution Time:\s*([\d.]+)\s*ms", plan_text)
    exec_ms = float(exec_m.group(1)) if exec_m else None
    plan_m = re.search(r"Planning Time:\s*([\d.]+)\s*ms", plan_text)
    plan_ms = float(plan_m.group(1)) if plan_m else None
    hits = sum(int(hit_m.group(1))
               for hit_m in re.finditer(r"shared hit=(\d+)", plan_text))
    reads = sum(int(read_m.group(1))
                for read_m in re.finditer(r"shared read=(\d+)", plan_text))
    return {
        "exec_time_ms": exec_ms,
        "plan_time_ms": plan_ms,
        "shared_hit": hits,
        "shared_read": reads,
        "top_node": plan_text.split("\n", 1)[0].strip(),
    }


def run_explain(cur, q: dict, label: str) -> dict:
    cur.execute("EXPLAIN (ANALYZE, BUFFERS) " + q["sql"], q["params"])
    plan_text = "\n".join(row[0] for row in cur.fetchall())
    return {"label": label, "query": q,
            "parsed": parse_plan(plan_text), "plan_text": plan_text}


def save_plan_files(results, phase: str) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for r in results:
        path = os.path.join(OUT_DIR, f"{phase}_{r['query']['id']}.txt")
        with open(path, "w") as f:
            q = r["query"]
            f.write(f"=== {q['id']}: {q['label']} ({r['label']}) ===\n")
            f.write(f"File: {q['file']}\n")
            f.write(f"SQL:  {q['sql']}\n")
            f.write(f"Params: {q['params']}\n\n")
            f.write("--- EXPLAIN (ANALYZE, BUFFERS) ---\n")
            f.write(r["plan_text"])
            f.write(f"\n\nParsed: exec_time={r['parsed']['exec_time_ms']:.2f}ms "
                    f"shared_hit={r['parsed']['shared_hit']} "
                    f"shared_read={r['parsed']['shared_read']}\n")


def _verify_index_drift() -> None:
    """Verify the 3 new indexes in NEW_INDEXES match web_runner/db.py.

    The doc + script define a regression baseline. If a future PR adds,
    removes, renames, OR RESHAPES one of the 3 indexes in
    ``web_runner/db.py``, the script refuses to run rather than silently
    capture plans against a stale schema.

    Drift is detected on two axes:
      1. **Name presence** — is the index name still defined in db.py?
         Catches deletions + renames.
      2. **DDL shape** — does the CREATE INDEX DDL in db.py still match
         the NEW_INDEXES string? Catches "column added", "opclass
         changed", "WHERE clause modified", etc. Whitespace is
         normalized before comparison so reformatting alone isn't a
         false positive.

    Two pre-processing passes are required before the regex match works
    on real ``db.py`` content (which uses Python string-literal
    continuation + ``CREATE INDEX IF NOT EXISTS``):

      * **String-literal collapse** — ``"foo " "bar"`` (3-line DDL) is
        rewritten to ``"foo bar"`` so the regex doesn't stop at the
        first closing quote of the first string literal. Without this,
        multi-line index DDLs like ``idx_verification_login_active``
        get truncated to the first line, producing a false-positive
        drift report.
      * **``IF NOT EXISTS`` strip** — db.py's DDL uses
        ``CREATE INDEX IF NOT EXISTS ...``; the script's NEW_INDEXES
        uses bare ``CREATE INDEX ...``. Both are equivalent at runtime
        (the IF NOT EXISTS is just an idempotency guard for re-runs),
        so the comparison normalizes them away.
    """
    if not _DB_PY.exists():
        print(f"  WARNING: {_DB_PY} not found; skipping drift check")
        return
    raw_text = _DB_PY.read_text()
    # Collapse Python adjacent-string-literal continuation: lines that
    # end with ``"<whitespace>`` followed by a line starting with
    # ``"<whitespace>`` get joined on a single space. The
    # ``re.DOTALL`` makes ``\s`` match newlines so the look-behind
    # accepts the trailing space of the previous line.
    db_text = re.sub(
        r'"\s*\n\s*"', ' ', raw_text, flags=re.DOTALL,
    )
    errors: list[str] = []

    def _normalize(s: str) -> str:
        # Collapse runs of whitespace, then strip ``IF NOT EXISTS``
        # (db.py uses it, the script's NEW_INDEXES doesn't — they're
        # semantically equivalent). Trailing comma/terminator stripped.
        s = re.sub(r"\s*IF NOT EXISTS\s*", " ", s)
        return " ".join(s.split())

    for sql in NEW_INDEXES:
        name = sql.split()[2]  # ``CREATE INDEX <name> ON ...``
        if name not in db_text:
            errors.append(f"missing in db.py: {name}")
            continue
        # Extract the matching ``CREATE INDEX ...`` substring from
        # db.py. The regex allows the optional ``IF NOT EXISTS`` (db.py
        # always includes it) and stops at the first ``"`` (the
        # closing quote of the now-joined single string literal).
        m = re.search(
            rf'CREATE INDEX (?:IF NOT EXISTS )?{re.escape(name)}[^"]*',
            db_text,
        )
        if not m:
            errors.append(f"could not extract DDL for {name} from db.py")
            continue
        db_ddl = _normalize(m.group(0).rstrip(",;"))
        script_ddl = _normalize(sql.rstrip(",;"))
        if db_ddl != script_ddl:
            errors.append(
                f"DDL drift for {name}:\n"
                f"      script: {script_ddl}\n"
                f"      db.py:  {db_ddl}"
            )

    if errors:
        print("  ERROR: NEW_INDEXES drifted from web_runner/db.py:")
        for e in errors:
            print(f"    - {e}")
        print("  Update NEW_INDEXES in scripts/perf_baseline_capture.py "
              "to match the deployed schema before re-running.")
        sys.exit(1)
    print(f"  +NEW_INDEXES matches web_runner/db.py "
          f"({len(NEW_INDEXES)} indexes, name + DDL verified)")


# ── Main ─────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--keep-db", action="store_true",
                   help="Don't drop the test DB on exit (default: drop).")
    args = p.parse_args(argv)

    print("=" * 72)
    print(f"Perf baseline capture (target: {TEST_DB} on localhost:5432)")
    print("=" * 72)

    # 0. Drift check: refuse to run if NEW_INDEXES no longer matches db.py
    _verify_index_drift()

    # 1. Recreate the test DB
    admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    with admin.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {TEST_DB}")
        cur.execute(f"CREATE DATABASE {TEST_DB}")
    admin.close()
    print(f"  +recreated DB {TEST_DB}")

    db = psycopg.connect(TEST_DSN, autocommit=True)
    cur = db.cursor()

    # 2. Schema + pre-existing indexes (BEFORE state)
    for s in SCHEMA_STATEMENTS:
        cur.execute(s)
    for s in PREEXISTING_INDEXES:
        cur.execute(s)
    print(f"  +created {len(SCHEMA_STATEMENTS)} tables + "
          f"{len(PREEXISTING_INDEXES)} pre-existing indexes (BEFORE state)")

    # 3. Seed
    seed(db)

    # 4. Verify the 3 new indexes are ABSENT
    cur.execute("SELECT indexname FROM pg_indexes "
                "WHERE schemaname='public' ORDER BY indexname")
    existing = {r[0] for r in cur.fetchall()}
    new_names = ["idx_tasks_list_desc", "idx_error_events_task_id",
                 "idx_verification_login_active"]
    for n in new_names:
        assert n not in existing, f"BEFORE: {n} should be absent"
    print("  +confirmed: 3 new indexes absent (BEFORE state)")

    # 5. Capture BEFORE
    queries = build_queries(cur)
    before = [run_explain(cur, q, "BEFORE") for q in queries]

    # 6. Add the 3 new indexes
    for sql in NEW_INDEXES:
        cur.execute(sql)
    cur.execute("ANALYZE")
    print("  +added 3 new indexes + ANALYZE (AFTER state)")

    # 7. Capture AFTER
    after = [run_explain(cur, q, "AFTER") for q in queries]

    # 8. Save plan files
    save_plan_files(before, "before")
    save_plan_files(after, "after")
    with open(os.path.join(OUT_DIR, "INDEX_PLAN.txt"), "w") as f:
        f.write("The 3 new indexes added between BEFORE and AFTER:\n\n")
        for s in NEW_INDEXES:
            f.write(f"  {s};\n")

    # 9. Print summary table
    print("\n" + "=" * 72)
    print("SUMMARY (paste into docs/perf-baseline.md §3 + §4)")
    print("=" * 72)
    print()
    print("| # | Query | Before (ms) | After (ms) | Speedup |")
    print("|---|-------|------------:|-----------:|--------:|")
    for b, a in zip(before, after):
        q = b["query"]
        bt, at = b["parsed"]["exec_time_ms"], a["parsed"]["exec_time_ms"]
        speedup = f"{bt / at:.1f}×" if at > 0 else "∞"
        print(f"| {q['id']} | {q['label'][:40]} | {bt:.2f} | {at:.2f} | {speedup} |")

    print(f"\nFull per-query plans saved to {OUT_DIR}/")
    print(f"  {len(before)} before + {len(after)} after = "
          f"{len(before) + len(after)} files")

    if not args.keep_db:
        db.close()
        admin = psycopg.connect(ADMIN_DSN, autocommit=True)
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE {TEST_DB}")
        admin.close()
        print(f"  +dropped {TEST_DB} (re-run with --keep-db to preserve)")
    else:
        db.close()
        print(f"  +kept {TEST_DB} (next run will DROP+CREATE)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
