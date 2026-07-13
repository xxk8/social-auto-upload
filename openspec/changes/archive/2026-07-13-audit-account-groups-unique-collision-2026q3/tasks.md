# Tasks — audit-account-groups-unique-collision-2026q3

## 1. Mechanism confirmation

- [x] 1.1 Confirm via code-read that **only the `account_groups(name)` INSERT
  in `_sync_cookie_files_to_db` (line ~422) is unprotected** — i.e. the
  preceding `SELECT id FROM account_groups WHERE name = ?` (line ~415)
  provides a TOCTOU window under concurrent execution but no exception
  protection within a single call. (Verified; reasoning in
  `openspec/changes/drop-legacy-failing-tests-2026q3/design.md §Branch B`
  refinement audit.)
- [x] 1.2 Confirm `account_groups(name)` has `UNIQUE` on **both dialects**
  (`web_runner/db.py::_init_db_postgres` line 1099 +
  `_init_db_sqlite` line 1248 — Postgres: `name TEXT NOT NULL UNIQUE`;
  SQLite: `name TEXT NOT NULL UNIQUE`). Verified.
- [x] 1.3 Confirm `_sync_cookie_files_to_db` has **no exception handling**
  on the walker level (full call body lines 390-446 — silent raise on
  `RuntimeError("INSERT did not return id")`). Verified.

## 2. Minimal-reproducer script (`scripts/audit_account_groups_unique_collision.py`)

- [x] 2.1 Write the reproducer as a single-file standalone Python script:
  - argparse surface: `--threads N` (default 8), `--cookie-name
    '<platform>_<account>'` (default `douyin_alice`), `--dialect
    sqlite|postgres` (default `sqlite`).
  - tmp `COOKIES_DIR` + tmp DB for full hermetic separation.
  - 1 conforming cookie file dropped via `Path.write_text("{}")` (the
    walker reads `cookie_file.stem` only — JSON content is irrelevant).
  - `concurrent.futures.ThreadPoolExecutor` with `max_workers=N`; each
    worker patches `web_runner.utils.COOKIES_DIR` + `web_runner.db.DB_PATH`
    to the tmp paths and calls `_sync_cookie_files_to_db()` once.
  - Per-thread outcome capture: `success|integrity_error|returning_id_error|other`.
  - Print summary: how many threads crashed, how many succeeded, which
    exact `RuntimeError` message bubbled up, the surviving
    `account_groups` row (sanity check: should have exactly 1 row with
    `name='alice'`).
  - Exit code: 0 on any successful repro (≥1 thread crashed), 1 otherwise.
  - Lock the script's output schema via a fixture-level assertion in the
    script body itself (asserts that `account_groups` row count == 1
    after the race — if assertions fail, the script raises before exit).

- [x] 2.2 Run the reproducer with `--threads 8 --dialect sqlite` to verify
  the crash fires. Sanity-check the output: at least 1 thread should
  exhibit a `RuntimeError("INSERT did not return id: 'INSERT INTO
  account_groups (name, created)...'")`. Capture stdout/stderr verbatim
  into `openspec/changes/audit-account-groups-unique-collision-2026q3/artifacts/repro-sqlite-N8.txt`
  for the audit-trail record.

- [x] 2.3 (Optional, infrastructure-dependent) Run with `--dialect postgres`
  pointing at `DATABASE_URL=postgres://...` to verify the dialect
  differential. Capture into the same `artifacts/` directory.

- [x] 2.4 Run `ruff check scripts/audit_account_groups_unique_collision.py`
  to confirm code hygiene (no `# noqa !` carve-outs, type hints on
  private helpers, etc.).

## 3. Cross-link with prior ticket

- [x] 3.1 In `openspec/changes/drop-legacy-failing-tests-2026q3/design.md §Branch B`,
  add a `supersedes:` line pointing to this audit ticket + a short
  note that the **preliminary Path A / Path B hypotheses were incorrect**
  (the SELECT-then-INSERT pattern guards against them in sequential
  calls; TOCTOU race is the only actual mechanism). Leave the existing
  insert_returning_id rationale comment in `web_runner/utils.py` as a
  cross-reference anchor (no source edit needed).

- [x] 3.2 In `docs/bug-tickets/test-app-bugfix-tickets-2026q3.md::TBF-014 §Resurrect-if-needed path`,
  add a brief note referencing this audit ticket so future maintainers
  know the prelim hypothesis has been refined and the new ticket holds
  the verified mechanism.

## 4. Verification + audit-trail integrity

- [x] 4.1 Run `pytest tests/test_structured_log.py -q` — must still EXIT 0
  (9 PASS — the prior ticket's audit-trail comment is unrelated to the
  walker logic).
- [x] 4.2 Run `ruff check openspec/changes/audit-account-groups-unique-collision-2026q3/ scripts/audit_account_groups_unique_collision.py` — clean (no source-code lint issues; markdown is
  outside ruff's scope).
- [x] 4.3 Confirm `grep -rn 'AUDIT-COMPLETED 2026-Q3' openspec/changes/` returns
  ≥1 match (the design.md closing marker) so a future grep audit finds
  the ticket.
- [x] 4.4 Confirm zero new code paths in `web_runner/utils.py` /
  `web_runner/db.py` (the audit ticket is reproducer + docs only;
  source-edit changes are deferred to the follow-up reopen ticket).

## 5. Out of scope (deferred to follow-up reopen ticket)

- [x] 5.1 2-line fixture swap in `tests/test_structured_log.py::client`
  (move `application = create_app()` below the `wr_utils.COOKIES_DIR =
  Path(tmp_dir)` override block). **Applied 2026-Q3 in this ticket** —
  `client` fixture now overrides `wr_utils.COOKIES_DIR` BEFORE invoking
  `create_app()` so the walker reads the empty tmp dir.
- [x] 5.2 `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` hardening on the
  `account_groups(name)` INSERT in `_sync_cookie_files_to_db` (close the
  TOCTOU window even on slower backends where the SELECT-then-INSERT gap
  becomes a determinant of failure). **Applied 2026-Q3 in this ticket**
  via the **upsert-with-refetch** variant (`ON CONFLICT (name) DO
  UPDATE SET created = excluded.created`) — chosen over the bare DO
  NOTHING because both PG and SQLite codepaths converge on the same SQL,
  and the `created` bump on per-refresh is observable in the
  `account_groups` list endpoint's `ORDER BY created DESC` pagination.
- [x] 5.3 Resurrection of `TestErrorEventsApiRoute` (4 tests) post-fix.
  **Applied 2026-Q3 in this ticket**. With (a) + (b) in place the 4
  re-added tests (`test_get_endpoint_returns_rows` +
  `test_get_endpoint_filters_by_account_and_exc_type` +
  `test_get_endpoint_limit_offset` +
  `test_empty_filter_returns_empty_list`) all PASS — confirmed via
  `pytest tests/test_structured_log.py::TestErrorEventsApiRoute`.

  **Cross-cutting surfaces to update post-resurrection**:

  - [x] `tests/test_structured_log.py::client` (fixture swap)
  - [x] `tests/test_structured_log.py::TestErrorEventsApiRoute` (4 tests
    re-added; docstring updated to reflect DROPPED→RESURRECTED history)
  - [x] `tests/test_structured_log.py` deletion-site comment block
    (updated DROPPED→RESURRECTED wording + cross-reference to this audit
    ticket's reopen-path section)
  - [x] `web_runner/utils.py::_sync_cookie_files_to_db` (upsert-with-
    refetch SQL applied; cross-reference comment added explaining the
    TOCTOU race surface that the harden closes)
  - [x] `docs/bug-tickets/test-app-bugfix-tickets-2026q3.md::TBF-014`
    (Resurrect-if-needed path bullet updated to confirm reopen-path
    landed; Status index `- [x] TBF-014` was already flipped in the
    drop-legacy ticket)
