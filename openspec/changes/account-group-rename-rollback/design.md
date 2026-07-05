## Context

The social-auto-upload Web API exposes `POST /api/account-groups/<id>/rename` to rename a multi-platform publisher group. Cookie files are stored on disk as `<platform>_<group_name>.json` under `web_runner/utils.py::COOKIES_DIR`; the DB table `account_authorizations.cookie_file` records the absolute path each auth entry points at. When the operator renames a group, both the on-disk files AND the DB rows must move together — otherwise a renamed group is unreadable (DB row points to a file with the OLD name that no longer exists) and operators see a confusing 500 surface when the inconsistency next surfaces.

The current `rename_account_group` makes two unsafe assumptions:
1. **`os.rename` is atomic and reliable.** In practice a transient `PermissionError` (Windows file lock from AV, macOS quarantine, NFS stale-handle) can hit mid-iteration. The audit-critical-fixes migration to `get_database()` (PR2-final) didn't introduce the bug, but it didn't fix it either.
2. **DB transaction abort restores FS state.** It can't — the DB transaction never sees the FS half; the rename was an FS-only side effect.

The pytest reproducer `test_rename_disk_failure_rolls_back_earlier_success` (test_sau_web_account_groups.py:505) was added to lock the desired behavior, but the test was authored AFTER the broken implementation shipped; the bug stood up in CI silently because the lint sweep blocking-collection recovery on prior runs hid the FAIL.

## Goals / Non-Goals

**Goals:**
- Atomic fs+db rename or clean rollback
- 409 surface (not 500 / RuntimeError) on partial fs failure
- Structured log on interruption so operators can grep `.sau-logs/`
- Test-side patch simplification: collapse the brittle double-patch in the test to a clean single-patch

**Non-Goals:**
- Cross-process rename lock / file-locking detection. Many fs PermissionErrors are transient and retry-safe; we're not building a retry orchestrator, just guaranteeing the user-visible 409 + restoration
- PostgreSQL-specific behavior changes. The decision ordering (fs-first / db-second) works on both backends; psycopg's `INSERT ... RETURNING id` doesn't have an analog of the SQLite 3.35+ requirement
- Frontend UX changes. The AccountsPage rename input stays as-is
- Renaming the underlying `rename_account_group` function. Function name stays; only the body changes

## Decisions

### D1: fs-first / db-second ordering

**Decision**: Perform all `os.rename` operations FIRST, accumulating a `{old_path: new_path}` map of completed renames. Only AFTER the loop completes cleanly do we open the `with db.transaction() as tx:` block and emit DB writes for the resolved paths.

**Rationale**: This inverts the current failure mode. A failed `os.rename` now leaves the FS unchanged (all renames so far are tracked for reverse-iteration). A failed DB write rolls back naturally via the transaction's `with`-exit handler. The two halves no longer interact.

**Alternatives considered**:
- **Savepoint-per-rename inside one big transaction**: Keeps the existing code-shape but doesn't fix the FS half (transaction can't restore FS). Rejected — same observable bug.
- **Two-phase commit (PC)**: Way out of scope for this fix. The two halves are FS + DB, not two resource managers that support PC.
- **`try-finally` with explicit rollback around the rename loop**: Same shape as D1 but harder to read; rejected for clarity.

### D2: Reverse-iteration rollback

**Decision**: When the rename loop catches `(PermissionError, OSError, FileNotFoundError)`, call `_rollback_renames(partial_mapping)` which loops the partial-successful mappings in REVERSE order calling `os.rename(new, old)`. Secondary errors during rollback are caught per-iteration and logged at WARNING (best-effort).

**Rationale**: FS rename is generally reverseable — `os.rename(a, b)` then `os.rename(b, a)` restores — but on a PermissionError-trailing state the reverse call may itself fail if the path got a stale lock. Best-effort ensures the route returns 409 with whatever state the FS settled in; the operator can manually resolve.

**Alternatives considered**:
- **Crash on rollback failure (raise RuntimeError instead of returning 409)**: Worse UX — operator sees 500 instead of structured message. Rejected.
- **Hold a transaction over the FS ops (locks DB conn during slow FS)**: Reduces pool availability. Rejected.

### D3: Catch `OSError` at route boundary, not deep in helpers

**Decision**: Define a domain exception (`_RenameInterrupted`) raised by the helper on FS failure. The route catches it and returns 409. The DB layer's `RuntimeError("INSERT did not return id")` stays untouched — that's a structural-breakage signal reserved for genuine "this should never happen" cases. We don't conflate the two.

**Rationale**: Two error classes, two response surfaces. Domain exception = user-actionable (retry / restructure group name). DB RuntimeError = maintainer-actionable (DB schema broken, fix the code). Conflating them is what made the bug silent in the first place.

**Alternatives considered**:
- **Single big `except Exception:`**: Hides structural bugs. Rejected.

### D4: Test-side double-patch simplification

**Decision**: After the route handler modules `os` via `import os` at the top (already the case), the test's `patch.object(ag_route, "os")` outer wrapper is unnecessary indirection — `ag_route.os.rename` resolves via attribute lookup, and a single `patch("web_runner.routes.account_groups.os.rename", side_effect=fake_rename)` does the same job. Collapse.

**Rationale**: The current code has TWO patch contexts nested (line 525 outer `patch.object(ag_route, "os") as fake_os_module` + line 538 inner `patch("web_runner.routes.account_groups.os.rename", side_effect=fake_rename)`). Only the inner one fires; the outer noop-documents that `ag_route`'s `os.rename` access goes through the module's `os` import. After D1 the inner alone is sufficient.

**Alternatives considered**:
- **Manual `monkeypatch.setattr`**: Same effect as `@patch(...)`; not pytest-idiomatic for this test file. Rejected.

## Risks / Trade-offs

- **[Risk] `_rollback_renames` reverses in wrong order on multiple platforms** → Mitigation: iterate partial_mapping in the order renames completed (preserved via dict insertion order in Python 3.7+); on rollback iterate in REVERSE.
- **[Risk] Logger fields `interrupted_at` may grow unbounded** → Mitigation: structured logger already caps to first 16 KB per record; should not be measurable.
- **[Risk] Postgres-side `_RenameInterrupted` not raised (psycopg path)**: → The fs-first ordering means the FS half fails first; the transaction's `with db.transaction()` was the side that raised. Cross-check: write a PG-side equivalent test (TODO; future PR).

## Migration Plan

1. **Phase 1 — this change**: Rewrite `rename_account_group` fs-first / db-second per D1-D4
2. **Phase 2 (follow-up)**: Add PG-side `test_rename_disk_failure_rolls_back_earlier_success` equivalent using mock pool (deferred to postgres-test-coverage openspec change)
3. **Phase 3 (follow-up)**: Audit other routes in `account_groups` for the same fs-vs-db dual-write pattern (likely `authorize_account_group` writes a cookie file stub then DB row; verify atomicity)

**Rollback**: `git revert` this single commit restores prior behavior (with the latent partial-commit bug). The test regression is acceptable as a known-limit while the fix lands.

## Open Questions

- Should `_rename_cookie_files` accept a hook for dry-run mode so the frontend can preview side effects? (Future nice-to-have; not now.)
- Should the route handler capture `errno` from `PermissionError` and surface a more specific message (e.g., PermissionError.errno == EBUSY → "file locked; close in browser and retry")? (Yes, after initial fix lands; considered a polish.)
