# Audit the `account_groups(name)` UNIQUE-collision mechanism

## Why

`openspec/changes/drop-legacy-failing-tests-2026q3/design.md §Branch B` flagged
that the `_sync_cookie_files_to_db` walker at
`web_runner/utils.py::create_app()` boot can raise
`RuntimeError("INSERT did not return id")` when the underlying
`INSERT INTO account_groups (name, created) VALUES (?, ?)` (line ~422) hits the
`UNIQUE` constraint on `account_groups(name)`.

The prior ticket labelled the mechanism as **preliminary** and offered two
hypotheses:

- **Path A**: plural conforming cookie files sharing an `account_name` stem
  (e.g. `douyin_alice.json` + `xiaohongshu_alice.json` both → `account_name="alice"`).
- **Path B**: cross-session residue in the shared real DB from a previous boot.

A deeper re-read of `web_runner/utils.py::_sync_cookie_files_to_db` (lines
390-446) shows **both preliminary hypotheses are incorrect** because the loop
performs `SELECT id FROM account_groups WHERE name = ?` BEFORE the INSERT
(`_sync_cookie_files_to_db` line 415). Within a single sequential call, the
SELECT catches the previously-inserted row on the 2nd file-with-same-stem and
re-uses `group_id` via the `if group: group_id = group["id"]` branch (line
418) → no INSERT → no UNIQUE collision.

**The only viable collision mechanism is a TOCTOU (Time-Of-Check to Time-Of-Use)
race across concurrent `_sync_cookie_files_to_db` calls** — e.g. two
`create_app()` boots launched in parallel that both walk the same
`COOKIES_DIR` against the same shared DB:

```
Thread 1: SELECT id FROM account_groups WHERE name='alice'  → None
Thread 2: SELECT id FROM account_groups WHERE name='alice'  → None   (BEFORE Thread 1 INSERTs)
Thread 1: INSERT INTO account_groups (name='alice') ...     → succeeds (id=1)
Thread 2: INSERT INTO account_groups (name='alice') ...     → UNIQUE collision → IntegrityError
                                                            → fetchone() returns None
                                                            → RuntimeError("INSERT did not return id")
```

This audit ticket pins the mechanism via a reproducible stand-alone script
(spawns N threads against a tmp `COOKIES_DIR` + tmp DB + 1 conforming cookie
file) and documents the SQLite-vs-Postgres exception-flow differential. Fix
recommendations follow but are NOT in scope of this audit ticket — see §Out
of Scope.

## What Changes

1. **NEW `scripts/audit_account_groups_unique_collision.py`** — minimal
   reproducer: standalone, runnable, takes `--threads N` + `--dialect
   sqlite|postgres` (defaulting to `sqlite`), recreates the
   `account_groups + account_authorizations` schema in a tmp DB, drops a
   single conforming cookie file into a tmp `COOKIES_DIR`, spawns
   `N` threads calling `_sync_cookie_files_to_db()` concurrently, captures
   each thread's outcome, and prints summary (`which threads crashed` /
   `INSERTs that did not return id`). Run on demand only; NOT part of CI.

2. **NEW `openspec/changes/audit-account-groups-unique-collision-2026q3/`**
   — this directory.

   - `proposal.md` (this file) — what / why / out-of-scope.
   - `tasks.md` — concrete audit steps.
   - `design.md` — mechanism refinement, SQLite-vs-Postgres differential,
     reopen-path recommendations.

3. **UPDATE `openspec/changes/drop-legacy-failing-tests-2026q3/design.md
   §Branch B`** — mark the preliminary Path A / Path B hypotheses as
   SUPERSEDED by this audit ticket. Keep the §Branch B structure (it still
   documents the user-visible symptom and the existing fixture fix + INSERT
   OR IGNORE hardening recommendations) but add a `supersedes:` pointer to
   the new ticket.

## Out of Scope

- **No source-edit changes to `web_runner/utils.py` or `web_runner/db.py`
  in this ticket.** Surgical fixes (2-line fixture swap in
  `tests/test_structured_log.py::client`, `INSERT OR IGNORE` /
  `ON CONFLICT DO NOTHING` hardening on the `account_groups(name)` INSERT
  in `_sync_cookie_files_to_db`) belong to a follow-up reopen ticket once
  the reproducer confirms the TOCTOU mechanism in practice.
- **No resurrection of the dropped `TestErrorEventsApiRoute` class.** That
  PR cycle is closed; the audit's deliverable is the mechanism document +
  reproducer, not new test coverage. Resurrecting the class (with the 2-line
  fixture swap + `INSERT OR IGNORE` hardening) is a downstream ticket.
- **No CI integration of the reproducer script.** The script is intentionally
  on-demand so it doesn't gate the test suite (the runner-thread timing
  window for the race-induced collision is non-deterministic — CI flakes
  would be noise). The script's purpose is to demonstrate the mechanism
  ONCE so the follow-up reopen ticket has a verified reproducer + proposed
  fix path.

## Risk / Non-Goals

- The reproducer is **educational, not a regression test**. CI integration
  would require deterministic collision timing, which the current
  `INSERT-RETURNING-id` round-trip can't guarantee.
- The TOCTOU window is narrow (microseconds in-process). The reproducer
  picks a timing-amplification strategy (the `select + insert` happens in
  `db.insert_returning_id` which opens a NEW connection per call on SQLite —
  so the SELECT-then-INSERT window is the wall-clock between two
  `db.fetch_one` returns and two `db.insert_returning_id` calls; with N
  threads the race is statistically reliable).
- Postgres is **not** exercised by default in the reproducer (it requires a
  running DB instance). The script supports `--dialect postgres` for
  pointing at an existing `DATABASE_URL`; the SQLite path is the default
  and validates the mechanism end-to-end without external infra.
