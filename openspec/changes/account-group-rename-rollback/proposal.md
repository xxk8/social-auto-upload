## Why

`web_runner/routes/account_groups.py::rename_account_group` is supposed to rename on-disk cookie files AND update the DB rows that point to those files atomically. The current implementation calls `db.execute()` / `db.insert_returning_id()` for each platform's cookie path update INSIDE a single `db.transaction()` block — but the cookie file `os.rename` calls happen BEFORE the DB writes in the same code path, and if a mid-flight file operation raises `PermissionError` (e.g., OS-level file lock, antivirus quarantine, COW-FS race), the route handler currently:

1. **Silently partially-commits the FS half**, leaving the first platform's file renamed but the DB still pointing to the old path;
2. **Returns a 5xx-shaped RuntimeError** via `INSERT did not return id: ...` from `web_runner/db.py::SqliteTransactionHandle.insert_returning_id` (line 426) instead of the user-visible 409 "rename failed; group unchanged";
3. **Leaks partial state**: subsequent reads return a name-mismatched / orphaned setup until the operator manually rolls back.

The Pytest functional reproducer `tests/test_sau_web_account_groups.py::TestAccountGroupFsSafety::test_rename_disk_failure_rolls_back_earlier_success` (line 505) mocks the second `os.rename` to raise `PermissionError`, then asserts:
- HTTP 409 (not 500)
- DB row's name unchanged (`"原始"` not `"新名"`)
- Both `douyin_原始.json` and `kuaishou_原始.json` files restored to disk, neither `_新名.json` exists

That test fails today because the current implementation does not restore the first fs-rename before the DB transaction aborts. This is a real production data-integrity bug — operators who experience a transient fs failure during a rename lose the ability to use the renamed account group until a full manual restore.

## What Changes

- **fs-first → db-second ordering**: rewrite `rename_account_group` so the route handler iterates authorizations, performs the `os.rename` for each, and only INSIDE the DB transaction writes the updated `cookie_file` rows when ALL renames succeeded. On any raise, REVERSE every successful `os.rename` before the DB block sees the change.
- **Dual-side rollback**: on `PermissionError`, `OSError`, `FileNotFoundError` during the rename loop, call `os.rename(new, old)` for each completed iteration BEFORE the DB transaction's `with`-block exit; the DB block then aborts naturally (no rows written) and the route returns 409.
- **Surfacing 409, not 5xx**: catch `OSError` at the route boundary (don't let `PermissionError` propagate up to Flask's default 500 handler); log the interruption via the existing structured logger.
- **Test-side fix scaffolding**: `tests/test_sau_web_account_groups.py::TestAccountGroupFsSafety` mocking now patches the route handler's local `os.rename` reference (not the module-level `os` via `with patch.object(ag_route, "os") as fake_os_module` — that path is brittle and the test file already has a TODO-style double-patch workaround at line 540). Simplify to a single `patch.object`-on-the-route-module path.

## Capabilities

### Modified Capabilities
- `api-account-groups`: The rename endpoint now guarantees atomic fs+db consistency. On mid-flight file failure, the rename is fully rolled back and the operator sees 409 with a structured message; the operator can safely retry.

## Impact

- **Web API**: `web_runner/routes/account_groups.py::rename_account_group` (~30 lines of rewrite); `web_runner/routes/account_groups.py::authorize_account_group` (no behavioral change; cross-check only)
- **DB layer**: `web_runner/db.py::SqliteTransactionHandle.insert_returning_id` (kept; no change — the `RuntimeError` it raises still indicates structural breakage, but with the new ordering it is no longer reachable on partial-fs paths)
- **Tests**: `tests/test_sau_web_account_groups.py::TestAccountGroupFsSafety` (collapse the dual-patch workaround at lines 525-541 into a single `@patch("web_runner.routes.account_groups.os.rename")`)
- **CLI**: No CLI changes
- **Frontend**: No frontend code changes; the AccountsPage rename input contract is unchanged — invalid names still reject before reaching the route
- **Breaking**: None. The observable 409 response replaces a 500 surface; operators who relied on the 500 to detect a partial state must migrate to checking the response shape (`success:False, message`).
