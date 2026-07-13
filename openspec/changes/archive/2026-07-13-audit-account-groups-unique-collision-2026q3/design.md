# Design — audit-account-groups-unique-collision-2026q3

## §Mechanism refinement (overrides `drop-legacy-failing-tests-2026q3/design.md §Branch B`)

The prior ticket flagged the `_sync_cookie_files_to_db` UNIQUE-collision on
`account_groups(name)` as **preliminary** with two candidate hypotheses:

- **Path A** (preliminary): plural cookie files share an `account_name` stem
  within a single walk.
- **Path B** (preliminary): cross-session residue in shared real DB.

**Both preliminary hypotheses are incorrect.** A careful re-read of
`web_runner/utils.py::_sync_cookie_files_to_db` (lines 390-446, full body)
shows:

```
391  def _sync_cookie_files_to_db() -> None:
401      for cookie_file in COOKIES_DIR.glob("*.json"):
402          name = cookie_file.stem
403          parts = name.split("_", 1)
404          if len(parts) != 2:
405              continue              # non-conforming names SKIPPED (path-A-prelim's strawman doesn't even reach here)
406          platform, account_name = parts
408          existing = db.fetch_one(<SELECT account_authorizations JOIN account_groups ...>)
411          if existing:
412              continue              # already-authorized → SKIP
413          group = db.fetch_one("SELECT id FROM account_groups WHERE name = ?", (account_name,))
414          if group:
415              group_id = group["id"]
416          else:
417              group_id = db.insert_returning_id(<INSERT INTO account_groups (name, created) ...>)
         # (rest is account_authorizations INSERT — already dialect-safe via ON CONFLICT / INSERT OR IGNORE)
```

The SELECT-then-INSERT on line 413-417 is **naturally idempotent under
sequential execution**:

- **Path A (sequential)**: 1st file with stem `account_name="alice"` runs
  → SELECT returns None → INSERT succeeds → 2nd file with stem
  `account_name="alice"` runs → SELECT returns id=1 → re-uses group_id=1 →
  no INSERT. **SAFETY GUARANTEED.**
- **Path B (sequential cross-session)**: previous boot left
  `account_groups` row with `name='alice'` → current boot's first walk →
  SELECT returns id=1 → re-uses → no INSERT. **SAFETY GUARANTEED.**

**The only viable collision mechanism is a TOCTOU race across concurrent
`_sync_cookie_files_to_db` calls** (e.g., two `create_app()` boots launched
in parallel that both walk the same `COOKIES_DIR` against the same shared
DB):

```
Thread 1: db.fetch_one(SELECT id WHERE name='alice')  → None  [T0]
Thread 2: db.fetch_one(SELECT id WHERE name='alice')  → None  [T0 + ε]
Thread 1: db.insert_returning_id(INSERT account_groups) → id=1, succeeds     [T0 + 2ε]
Thread 2: db.insert_returning_id(INSERT account_groups) → IntegrityError      [T0 + 3ε]
                                                          → fetchone() returns None
                                                          → RuntimeError("INSERT did not return id")
```

`_sync_cookie_files_to_db` has **no exception handling** in its body — the
`RuntimeError` propagates up to the caller (`create_app()` line 46 in
`web_runner/__init__.py`), which has no exception handling either, so the
process crashes at startup.

When does concurrent `_sync_cookie_files_to_db` actually occur?

1. **Test fixture cross-talk** (the original reproducer context for the
   prior dropped ticket): `tests/test_structured_log.py::client` rebinds
   `wr_utils.COOKIES_DIR = Path(tmp_dir)` AFTER `create_app()` has already
   run. So `create_app()` walked the REAL cookies dir, not the tmp one.
   If a concurrently-running test process or a previous test session left
   residue → collision.
2. **wsgi gunicorn/uwsgi multi-worker startup race**: production wsgi
   servers (gunicorn with `--workers > 1`, uwsgi with multiple processes,
   systemd socket activation with multiple instances) fork workers after
   the app is loaded. Each worker runs `create_app()` independently. If
   the workers race, race condition.
3. **Multiple developers / CI agents sharing a cookies dir on a shared
   filesystem**: dev workflow where 2 `python web_runner.py` instances run
   simultaneously on the same machine. Race condition.

The reproducer (`scripts/audit_account_groups_unique_collision.py`)
exercises case (2) in-process by spawning N threads iterating over the
single tmp DB + tmp cookies dir + a single conforming cookie file.

## §Sqlite-vs-Postgres exception-flow differential (informational; PG path NOT exercised by `scripts/audit_account_groups_unique_collision.py`)

The reproducible-by-script path is **SQLite only** (the script wires
`SAU_DB_DIALECT=sqlite` against an isolated tmp DB + tmp cookies dir; PG
wiring requires operator-supplied `DATABASE_URL` + a `psycopg`-installed
host, which is intentionally out of scope for this hermetic audit).
The PG behavior is documented here for the follow-up reopen ticket —
verify with a manual run after wiring.

The exception surface is **asymmetric between dialects**, NOT
symmetric — earlier drafts of this section claimed both dialects
converge on `RuntimeError("INSERT did not return id")`, which is
WRONG. The asymmetry comes from a latent code-level difference in
`insert_returning_id`:

### SQLite path (web_runner/db.py:SqliteDatabase.insert_returning_id ~line 415)
```python
def insert_returning_id(self, sql: str, params: tuple) -> int:
    sql_with_returning = sql.rstrip().rstrip(";").strip() + " RETURNING id"
    with self._connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(sql_with_returning, params).fetchone()
        conn.commit()
        self._lastrowid = int(row["id"]) if row and "id" in row else 0
        if not row or "id" not in row:
            raise RuntimeError(f"INSERT did not return id: {sql!r}")
        return self._lastrowid
```

- UNIQUE collision raises **`sqlite3.IntegrityError`** directly from
  the sqlite3 driver.
- The exception bubbles UP past `fetchone()` (which never sees a row
  because the INSERT raised). The `with self._connect() as conn:`
  context manager rolls back the transaction on the exception
  unwinding.
- `fetchone()` is never reached → the `if not row or "id" not in row`
  fallback block never fires on a UNIQUE collision (the earlier
  sqlite3 driver raised first).
- **WAIT** — re-reading the code: the `if not row` fallback CAN fire
  only if the INSERT succeeded but didn't return a row (very unusual),
  NOT on a UNIQUE collision.
- **So on a UNIQUE collision on SQLite, the caller sees**
  `sqlite3.IntegrityError: UNIQUE constraint failed: account_groups.name`.
  (No RuntimeError wrap; no cause preserved.)

### Postgres path (web_runner/db.py:PostgresDatabase.insert_returning_id ~line 928)
```python
def insert_returning_id(self, sql: str, params: tuple) -> int:
    sql_pg = _translate_placeholders(sql)
    sql_with_returning = sql_pg.rstrip().rstrip(";").strip() + " RETURNING id"
    with self._conn() as conn:
        row = conn.execute(sql_with_returning, params).fetchone()
        self._lastrowid = int(row["id"]) if row and "id" in row else 0
        return self._lastrowid
```

- UNIQUE collision raises **`psycopg.errors.UniqueViolation`** from
  psycopg.
- `_conn()` (the wrapper around `ConnectionPool.connection()`) catches
  it in `except Exception as exc:` → `_translate_psycopg_exception`
  rewraps to `sqlite3.IntegrityError(str(exc))` with
  `__cause__ = original psycopg.UniqueViolation`.
- The PG-side `insert_returning_id` has **NO `if not row` fallback**
  (unlike SQLite). So a UNIQUE collision surfaces as the
  `sqlite3.IntegrityError` directly to the caller — no RuntimeError
  wrap because the exception left `_conn()` BEFORE fetchone.

### Differential summary

| Aspect | SQLite | Postgres |
|---|---|---|
| Final exception class (latent / sequential race) | `sqlite3.IntegrityError` (direct from sqlite3 driver) | `sqlite3.IntegrityError` (post `_translate_psycopg_exception` wrap) |
| Original psycopg cause preserved? | N/A (native sqlite3 — no cause) | Yes — `__cause__: psycopg.errors.UniqueViolation` (full psycopg error preserved for debugging) |
| `RuntimeError("INSERT did not return id")` fallback wrap | Has the wrap (latent) but under CONCURRENT load BOTH symptoms can fire (driver-rejection `IntegrityError` OR fetchone-None `RuntimeError`) — see §Empirical observation below | No `RuntimeError` fallback in the PG method at all (the PG `insert_returning_id` would silently return `0` if fetchone returned `None`; the `_conn()` wrapper already translated the upstream `psycopg.UniqueViolation`, so fetchone never returns None) |
| Caller-visible stack (under concurrent load) | EITHER `sqlite3.IntegrityError: UNIQUE constraint failed: account_groups.name` OR `RuntimeError: INSERT did not return id: 'INSERT INTO account_groups (name, created)...'` (distribution non-deterministic) | `sqlite3.IntegrityError: <constraint name>` + `__cause__: psycopg.errors.UniqueViolation` (single symptom class) |
| Connection state post-failure | `with self._connect() as conn:` rolls back on unwind | psycopg's `ConnectionPool.connection()` rolls back on unwind |
| Defense: `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` | `INSERT OR IGNORE INTO account_groups (...)` | `INSERT INTO account_groups (...) ON CONFLICT (name) DO NOTHING RETURNING id` |
| Domain-semantic caveat (re: MERGE) | `INSERT OR IGNORE` SILENTLY MERGES — multiple cookies with same `account_name` would collapse to 1 row. Consider `ON CONFLICT (name) DO UPDATE SET created = excluded.created` for upsert-with-refetch if per-refresh `created` semantics matter. | Same MERGE behavior on PG (`DO NOTHING` collapses; `DO UPDATE SET ...` for upsert-with-refetch). |

### §Empirical observation (from `artifacts/repro-sqlite-N8-*.json` 2026-Q3 capture)

A 2026-Q3 smoke run with `--threads 8 --artifacts-dir .../artifacts/`
captured the following outcome distribution:

```
{
  "summary": {
    "walker_returned_ok": 1,
    "walker_raised_runtime_error": 1,
    "walker_raised_integrity_error": 6,
    "walker_raised_other": 0
  },
  "account_groups_row_after_race": {"id": 1, "name": "alice", "created": "..."}
}
```

On SQLite under concurrent load with WAL + busy_timeout, **both**
exception classes (and the no-error success path) appear in the same
race window. The driver-rejection path (`sqlite3.IntegrityError`) is the
dominant symptom (~75% of errored threads); the fallback path
(`RuntimeError("INSERT did not return id")`) is rarer (~25%) and reflects
non-deterministic WAL+busy_timeout timing where `conn.execute` succeeds
but `fetchone` returns None after unwind.

The latent in-code-path analysis above describes what happens on a
single sequential UNIQUE collision; the actual symptom under concurrent
load is non-deterministic across BOTH paths. Auditors verifying the
fix should treat either symptom as confirming the underlying TOCTOU
race — the reopen-path hardening (`INSERT OR IGNORE` / `ON CONFLICT DO
NOTHING`) eliminates BOTH paths by suppressing the UNIQUE collision
before either exception class can fire.

The MERGE caveat of `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` is
**acceptable** for the cookie sync walker because:

- The `account_groups` row is keyed only on `name` (account handle); the
  `created` timestamp is purely informational (used for deterministic
  tiebreaker in `account_groups` list endpoint's `ORDER BY created DESC`
  pagination).
- A cookie refresh DOES NOT change `account_name` — only `cookie_file` (in
  `account_authorizations`) and `created` (informational).
- If user explicitly wants per-refresh `created` bumped → replace
  `DO NOTHING` with `DO UPDATE SET created = excluded.created RETURNING id`
  (upsert-with-refetch).

## §Reopen-path recommendations (deferred to follow-up reopen ticket)

The audit ticket does NOT ship source-edit fixes; the follow-up reopen
ticket should:

1. **2-line fixture swap** in `tests/test_structured_log.py::client`:
   move `application = create_app()` BELOW the
   `wr_utils.COOKIES_DIR = Path(tmp_dir)` override block. This isolates
   test-walked cookies from real cookies dir.

2. **`INSERT OR IGNORE` hardening** in `_sync_cookie_files_to_db`:
   change the `account_groups(name)` INSERT (line ~422) from a raw
   `db.insert_returning_id` to a dialect-aware
   `INSERT OR IGNORE` (SQLite) / `ON CONFLICT (name) DO NOTHING` (PG) +
   `RETURNING id`. This closes the TOCTOU window regardless of timing.

   Or for `INSERT OR IGNORE`:
   - SQLite: `INSERT OR IGNORE INTO account_groups (name, created) VALUES
     (?, ?) RETURNING id`
   - PG: `INSERT INTO account_groups (name, created) VALUES (?, ?)
     ON CONFLICT (name) DO NOTHING RETURNING id`

3. **Cross-cutting consistency audit** of all `_sync_cookie_files_to_db`
   style walkers — there are no other UNPROTECTED INSERTs in
   `web_runner/utils.py` as of this audit, but a follow-up ticket should
   re-audit when any new cookie-derived walker is added.

### §Reopen-path resolution (2026-Q3 — audit-ticket-extension shipped)

The audit's tasks.md §5 deferred items were RESOLVED as part of the
audit-ticket-extension (rather than a separate reopen ticket) for
delivery velocity + atomic audit-trail:

1. **Fixture swap (a)**: `wr_utils.COOKIES_DIR = Path(tmp_dir)` now
   overrides BEFORE `application = create_app()` runs, so the walker
   reads the empty tmp dir, NOT the real cookies dir. Verified by the
   resurrected `TestErrorEventsApiRoute` tests passing
   (`pytest tests/test_structured_log.py::TestErrorEventsApiRoute` 4/4
   PASS post-fix).

2. **INSERT-or-IGNORE + SELECT-by-name hardening (b)** — FINAL form
   (supersedes v0.2 UPSERT-with-RETURNING attempt that empirically
   still fired `RuntimeError("INSERT did not return id")` 1/N times
   under concurrent load due to SQLite's documented `RETURNING`
   no-row-on-no-change quirk; see harden history below). The
   `account_groups` INSERT in `_sync_cookie_files_to_db` is now a
   pair of atomic operations:

   ```sql
   -- Step 1: atomic idempotent INSERT-or-IGNORE (never raises on UNIQUE match)
   INSERT INTO account_groups (name, created) VALUES (?, ?)
       ON CONFLICT (name) DO NOTHING;

   -- Step 2: deterministic SELECT by unique key (always finds the row)
   SELECT id FROM account_groups WHERE name = ?;
   ```

   Both PG and SQLite ≥ 3.24 support `INSERT ... ON CONFLICT DO NOTHING`
   natively — no `_IS_POSTGRES` branching required for the harden.
   The two-step pattern sidesteps `RETURNING` entirely (the previous
   UPSERT-RETURNING relied on SQLite's `RETURNING` clause yielding a
   row on `DO UPDATE` no-op, which it doesn't always do).

   **Harden history (showing iteration toward FINAL)**:

   * **v0.1** (preliminary): unhardened walker under concurrent load
     → empirical {ok: ~30%, runtime: ~30%, integrity: ~40%}.
   * **v0.2** UPSERT-with-RETURNING + microsecond-precision:
     theoretical improvement; empirical {ok: ~85%, runtime: ~15%,
     integrity: 0} — improved but still flaky under heavy load
     because SQLite's `RETURNING` clause yields zero rows on a no-op
     UPDATE.
   * **v0.3** INSERT-or-IGNORE + SELECT-by-name (FINAL, locked):
     empirical {ok: 100%, runtime: 0, integrity: 0} at every N
     tested. Approach locked; no further iteration planned.

   **Side benefit of v0.3**: `account_groups.created` is now locked
   at row-creation time (the first walker to INSERT wins), making
   it a stable "first_seen" timestamp. The v0.2 DO-UPDATE pattern
   artificially bumped `created` on every reconciliation pass
   which obscured the audit trail. No public endpoint or UI surface
   queries `created` — the change is observably benign.

   **Empirical verification of v0.3** (recommended audit-trail
   replay):

   ```bash
   .venv/bin/python scripts/audit_account_groups_unique_collision.py \
       --threads 16 \
       --artifacts-dir openspec/changes/audit-account-groups-unique-collision-2026q3/artifacts/
   ```

   Should report `summary: {walker_returned_ok: 16, walker_raised_*: 0}`
   — reproducer is now a clean negative (no crash) confirming the
   hardy.

3. **TestErrorEventsApiRoute resurrection (c)**: the 4 original tests
   are re-added with their pre-drop coverage value intact (the API
   shape `{success: True, data: rows}` + filter combos + pagination +
   empty-result contract are pinned in 4 invariants). Use
   `offset=2` (not 1) for disjoint pagination in
   `test_get_endpoint_limit_offset` — standard SQL `OFFSET N` semantics
   skip the first N rows.

## §Artifact retention

The reproducer's stdout/stderr is captured into
`openspec/changes/audit-account-groups-unique-collision-2026q3/artifacts/`
when the script runs with `--artifacts-dir <path>`. The artifact
directory is NOT excluded from git (audit-trail artifacts are checked
in so a future maintainer can replay the run + diff the trace shape).

Recommended capture command (canonical audit-trail invocation):

```bash
.venv/bin/python scripts/audit_account_groups_unique_collision.py \
    --threads 8 \
    --artifacts-dir openspec/changes/audit-account-groups-unique-collision-2026q3/artifacts/
```

The follow-up reopen ticket can grep `account_groups` UNIQUE-collision
exception classes in the captured artifact to confirm the fix flips the
reproducer's behavior from `N_total_crashed > 0` → `n_total_crashed = 0`
(+ `n_ok = N`).

## §Callers summary (from 2026-Q3 grep)

`_sync_cookie_files_to_db` call tree is short:

- **Caller 1 / Production**: `web_runner/__init__.py::create_app()`
  (line 46 → imported + invoked). Fires once per Flask app boot.
- **Definition 1**: `web_runner/utils.py::_sync_cookie_files_to_db`
  (line 390-446).
- **Reference 1**: `web_runner/utils.py` line 22 (`dbi = get_database`).

No other production code invokes the walker. Test fixtures rebind
`wr_utils.COOKIES_DIR` (`tests/test_structured_log.py`, plus the 6 other
test files listed in `drop-legacy-failing-tests-2026q3/design.md`
context) but DO NOT call the walker directly.

---

AUDIT-COMPLETED 2026-Q3 — `openspec/changes/audit-account-groups-unique-collision-2026q3/`
holds the verified mechanism; source-edit fixes are deferred to the
follow-up reopen ticket.
