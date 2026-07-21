## 1. Refactor `rename_account_group` to fs-first / db-second

- [ ] 1.1 In `web_runner/routes/account_groups.py`, extract the file-rename loop from `rename_account_group` into a helper `_rename_cookie_files(authorization_rows, new_group_name) -> dict[str, Path]` that returns a `{old_path: new_path}` mapping for successful renames and raises on the first failure (with the partial mapping attached to the exception context for rollback)
- [ ] 1.2 In `rename_account_group`, call `_rename_cookie_files` OUTSIDE `with db.transaction() as tx:` so DB writes only start when every fs rename succeeded
- [ ] 1.3 Inside the `db.transaction()` block, emit `UPDATE account_authorizations SET cookie_file = ?` (or `INSERT RETURNING id` for newly-resolved group ids) using the just-built mapping. If any DB write fails, the partial DB writes are auto-rolled back by the `with`-block's exception handler.
- [ ] 1.4 Add a helper `_rollback_renames(partial_mapping: dict[str, Path])` that loops the mapping in reverse order, calling `os.rename(new, old)` and swallowing secondary errors with a structured-log WARNING. Best-effort consistency (per audit-critical-fixes §D4 isolation guidance).

## 2. Surface errors as 409 (route boundary)

- [ ] 2.1 In `rename_account_group`, wrap `_rename_cookie_files` in a try/except catching `(PermissionError, OSError, FileNotFoundError)`. On catch, call `_rollback_renames(partial_mapping)` and return `409` with `success=False` and `message="rename aborted: <reason>; group unchanged"`.
- [ ] 2.2 Log interruptions via `_db_logger.warning("rename_account_group: fs interruption after %d renames", len(partial))` with structured fields `op=rename group_id=<id> old_name=<> new_name=<> interrupted_at=<platform>` so operators can grep `.sau-logs/` to find partial-failure events
- [ ] 2.3 Do not let raw `RuntimeError("INSERT did not return id: ...")` propagate to Flask's default error handler; verify the test in `test_rename_disk_failure_rolls_back_earlier_success` returns 409 path exclusively

## 3. Test-side scaffolding cleanup

- [ ] 3.1 In `tests/test_sau_web_account_groups.py::TestAccountGroupFsSafety::test_rename_disk_failure_rolls_back_earlier_success`, collapse the dual-patch pattern (lines 525-541) to a single `with patch("web_runner.routes.account_groups.os.rename", side_effect=fake_rename):` after the route handler now imports `os` from the module's own scope
- [ ] 3.2 Verify all `TestAccountGroupFsSafety` tests still pass after the cleanup (`test_rename_happy_path_updates_db_and_disk` must continue to PASS)
- [ ] 3.3 Verify all `TestAuthorizeQrPlatforms` / `TestAuthorizeNonQrPlatforms` / `TestAuthorizeEdgeCases` tests still pass — they don't exercise the fs-failure path but the cookie-file path computation must stay byte-identical

## 4. Verification

- [ ] 4.1 Run `.venv/bin/pytest tests/test_sau_web_account_groups.py -v --tb=short` — all 31 tests pass (was 21 pass / 10 fail / 2 ERROR)
- [ ] 4.2 Run `.venv/bin/pytest tests/test_sau_web_upload.py tests/test_stream_openrouter.py tests/test_auth.py tests/test_tencent_note_implementation.py -v --tb=short` — confirm this fix introduces ZERO regression in neighboring test files
- [ ] 4.3 Run `.venv/bin/ruff check web_runner/routes/account_groups.py web_runner/db.py` and `.venv/bin/black --check web_runner/routes/account_groups.py web_runner/db.py` — must remain GREEN (was already GREEN at HEAD 5a9332a)
- [ ] 4.4 Run `.venv/bin/python -c "from web_runner import create_app; app = create_app(); c = app.test_client(); ...; rename happy-path; rename failure path"` — manual smoke check that the route returns 409 with structured message

## Pre-Apply Verification (openspec apply gate)

> **Required BEFORE ** — these gating steps confirm the spec scenarios match what the failing tests actually assert. Skipping them risks  against a contract the implementation does not need to satisfy.

- [ ] 0.1 Capture full tracebacks for all FAIL-cluster tests in this change's failing-test list (run  per test).
- [ ] 0.2 Diff each captured traceback against the matching  block in . For each Scenario, confirm:
  - The WHEN conditions match the test's setup
  - The THEN entries match the test's assertions (modulo whitespace — REMOVE brackets/commas/etc-specific-to-the-test)
  - The AND entries match additional assertions chained in the test
- [ ] 0.3 For any Scenario whose test failure does NOT match the spec (i.e., the test asserts something different from what the spec says), update the spec's Scenario OR mark it for  deletion. Do NOT apply the change while a mismatch exists.
- [ ] 0.4 Capture a baseline-reference pytest run (HEAD with no code changes) showing the FAIL count delta when the change is applied. Use  both before and after the impl lands.
