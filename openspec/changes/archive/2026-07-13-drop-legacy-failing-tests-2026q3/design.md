# Drop Legacy Failing Tests · 2026 Q3 — Design

## Why Drop rather than Fix

### Branch A — `test_video_fill_meta_*` (decision: **already superseded, no action**)

The legacy `test_video_fill_meta_title` / `test_video_fill_meta_desc` / `test_video_fill_meta_tags` / `test_video_fill_meta_combined` tests in `tests/test_xiaohongshu_uploader.py` exercised the `XiaoHongShuVideo.fill_title` / `fill_desc` / `fill_tags` / `fill_meta` helpers (the humanized form-fill surface). Phase 4 §8.4.2 (in `openspec/changes/cli-uploader-architecture-consistency/tasks.md`) migrated `XiaoHongShuVideo` to inherit `BaseVideoUploader`, after which the lock-in test in `tests/test_xiaohongshu_uploader.py` was rewritten from scratch as a single `test_validate_upload_args_contract` — the rewrite dropped the legacy `test_video_fill_meta_*` tests as a side-effect.

The dropped tests were never reproduced in the rewrite: the lock-in test pins the `validate_upload_args` contract (the validation entry-point exposed for the CLI dispatcher's preflight), which is the structural contract the §8.4 migration is supposed to lock, NOT the page-form-fill helpers. The latter are not exercised anywhere else currently — they were dropped because the §8.4 family-wide audit was scoped to validate_args, not form-fill. If a future ticket re-adds the humanized form-fill tests, it would be a clean "re-pin XiaoHongShuVideo render surface" ticket, NOT a resurrection of stale tests.

### Branch B — `TestErrorEventsApiRoute` (decision: **DROP all 4**)

The user's framing of "(2 errors)" in the message pointer was accurate but the class itself contains **4 tests**: 2 currently ERROR + 2 currently PASS. The fixture-scope bug (see Root cause below) triggers RuntimeError at setup, not at every test — the 2 PASS tests happen to exercise query shapes that don't trigger the underlying DB INSERT path because their `_log_error_event` calls have been purged by `setup_method` already by the time `_sync_cookie_files_to_db` re-fires on the (already-built) app.

#### Root cause analysis (CORRECTED attribution per code-reviewer-minimax-m3 pass 2)

The 2 ERROR tests share the `client` fixture in `tests/test_structured_log.py`:

```python
@pytest.fixture
def client():
    application = create_app()                 # ← runs BEFORE the COOKIES_DIR override
    application.config["TESTING"] = True
    with tempfile.TemporaryDirectory() as tmp_dir:
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = Path(tmp_dir)   # ← override applied AFTER create_app
        with application.test_client() as c:
            yield c
        wr_utils.COOKIES_DIR = orig_cookies_dir
```

`create_app()` calls `web_runner/__init__.py::_sync_cookie_files_to_db()` which walks `COOKIES_DIR.glob("*.json")` against the **REAL** `cookies/` directory (the override only fires AFTER `create_app()` returned). The actual reproducer's INSERT params `('7x', '2026-07-02T14:51:51')` came from a **conforming** filename with `account_name='7x'`, NOT a non-conforming `7x.json` (which the loop's `len(parts) != 2` skip-clause filters out — see below).

**CORRECTED mechanism (per code-reviewer-minimax-m3 pass 2):**

1. **Theoretical path A** (PLURAL conforming cookies sharing an account_name stem): Two or more cookie files conforming to `<platform>_<account>.json` shape happen to share the same `<account>` stem across different `<platform>` prefixes — e.g. `tk_7x.json` + `ac_7x.json`. Each passes the `len(parts) != 2` skip-clause (both split cleanly into 2 parts). Both produce `account_name='7x'`. First INSERT into `account_groups(name='7x')` succeeds. Second INSERT in the same `_sync_cookie_files_to_db()` walking iteration collides on UNIQUE `name` constraint → `sqlite3.IntegrityError` raised by the underlying `conn.execute("INSERT INTO account_groups ... RETURNING id")` → `SqliteDatabase.insert_returning_id` reads back no row from `RETURNING id` post-collision (the fetch happens after the implicit rollback, returning an empty rowset) → `_lastrowid = 0` → RuntimeError "INSERT did not return id: ...".

2. **Theoretical path B** (cross-session residue): A prior `pytest` session wrote `account_groups (name='7x')` to the SHARED real DB (the test fixtures don't isolate `account_groups`, only `error_events` and `cookies/` substring of `pages`). A subsequent session has a fresh cookie file with the same `account_name='7x'` stem. `_sync_cookie_files_to_db`'s `SELECT id FROM account_groups WHERE name = ?` check is the FIRST defensive line — but the walker uses the cookie filename's `<account>` slice, NOT the canonical account ID we expect from `account_authorizations` join. If the row already exists with a different `id`, the walker reuses it; if it doesn't exist (somehow purged separately), the walker re-INSERTs and collides.

**INCORRECT attribution (rejected)**: the original design.md pass-1 framing of "non-conforming cookie file leaves stray `account_groups` row" does NOT survive contact with the actual code. `name.split("_", 1)` on `"7x"` returns `["7x"]` of length 1, which triggers the loop's `if len(parts) != 2: continue` skip at `web_runner/utils.py` line ~415. Non-conforming filenames are FILTERED OUT before reaching the INSERT path. They cannot leave stray rows.

**Why the original attribution was wrong**: the pass-1 hypothesis was based on skim of the cookie walker without re-reading the `len(parts) != 2` skip-clause. The actual reproducer's `params = ('7x', ...)` came from the SECOND part of a `<platform>_7x` split — the stem `7x` does NOT appear as `account_name` from a non-conforming `7x.json`. The corrected mechanism (paths A + B above) is more defensible; a follow-up ticket in `openspec/changes/audit-account-groups-unique-collision/` would be the right place to nail this down with a minimal reproducer.

#### Cost-benefit: DROP vs FIX

- DROP cost: 1 file edit (delete + audit-trail comment) + 1 openspec ticket (~80 lines) + 1 docs/bug-tickets ticket closure (~10 lines) + 1 reopen-risk (the 2 currently-PASS tests pin the `/api/error-events` limit/offset + empty-filter behaviour; that behaviour is also covered by `_db_get_error_events` implementation correctness + `TestLogs` for the analogous logs endpoint, but the API payload shape itself — `{success: true, data: [...]}` — depends on the route handler in `web_runner/routes/tasks.py:288` and is NOT unit-tested elsewhere).
- FIX cost: 2-line swap (fix fixture scope) + 3-char surgical (`INSERT OR IGNORE` hardening on `_sync_cookie_files_to_db`'s `account_groups` insert). Total LoC: 5.
- DROP is the **explicit user decision** ("DROP the pre-existing... the long-standing stability ticket"). Fix was offered via `ask_user` + declined.

#### Reopen path (future maintainer)

If a future ticket wants to resurrect `/api/error-events` unit tests, the cleanest path is:

1. Move `client` fixture's `application = create_app()` after the `wr_utils.COOKIES_DIR = Path(tmp_dir)` override (2-line fix).
2. Harden `_sync_cookie_files_to_db` to use `INSERT OR IGNORE` / `ON CONFLICT (name) DO NOTHING` on the `account_groups(name)` insert (~3-char surgical change — the minimal defensive layer that prevents UNIQUE-collision cascades across `platform_*` cookie-file names sharing an `account_name` stem). **Domain-semantic caution (per code-reviewer-minimax-m3 pass 4):** `INSERT OR IGNORE` would silently MERGE multi-platform account-name collisions into ONE `account_groups` row. If `tk_7x.json` + `ac_7x.json` both exist, the standard walker would expect 2 separate `account_groups` rows (one per platform account), but INSERT OR IGNORE collapses them to 1 shared `account_groups(name='7x')` group whose `account_authorizations` rows bind both platforms. If per-account topology is preferred, use `ON CONFLICT (name) DO UPDATE SET created = excluded.created RETURNING id` (upsert-with-refetch) instead — preserves distinct rows for distinct `(platform, account)` collisions that happen to share the `<account>` slice.
3. Recreate `TestErrorEventsApiRoute` with the original 4 tests. They should now all PASS.
4. Mark `openspec/changes/drop-legacy-failing-tests-2026q3/` as **superseded** by the resurrection ticket.

> Optional follow-up: file `openspec/changes/audit-account-groups-unique-collision/` for a minimal reproducer of the corrected root cause. This ticket's design.md is the jumping-off point but a fully-scoped reproducer with deterministic seed cookies is out of scope for a "delete failing tests" change.

## Risk surface

- **Behavioural**: `/api/error-events` route is NOT modified; helpers are NOT modified. Production behaviour unchanged.
- **Coverage**: `TestLogErrorEventHelper` (7 invariants) + `TestLogs` (2 invariants) remain in `tests/test_structured_log.py`. The `/api/error-events` API payload shape (`{success: true, data: [...]}`) loses in-tree unit coverage. The `/api/error-events` route handler correctness is now only verified by:
  - `_db_get_error_events` SQL correctness (covered by `TestLogErrorEventHelper`)
  - `web_runner.routes.tasks.error_events` route handler integration with Flask app context (NOT unit-tested anywhere else).
- **Audit trail**: this openspec ticket + `docs/bug-tickets/test-app-bugfix-tickets-2026q3.md` TBF-013 + TBF-014 closures + the inline audit-trail comment at the deletion site all source-pin the rational for a future maintainer.
- **Diff signal**: pytest exits 0 post this change. Reviewers gating PRs to "tests pass" will see clean signal.
- **Audit-trail accuracy**: the corrected root-cause attribution is now consistent across design.md (this file) + the deletion-site audit-trail comment in `tests/test_structured_log.py` + the TBF-014 body in `docs/bug-tickets/`. The original pass-1 framing is fully replaced (no stale attribution survives).
- **Follow-up audit (2026-Q3)**: [`openspec/changes/audit-account-groups-unique-collision-2026q3/`](../../audit-account-groups-unique-collision-2026q3/) pinned the actual mechanism (TOCTOU race across concurrent `_sync_cookie_files_to_db` calls). The preliminary Path A / Path B hypotheses in this file's §Branch B were **REJECTED** by the deeper re-read — see the audit's `design.md §Mechanism refinement` for the verified race surface. `scripts/audit_account_groups_unique_collision.py` is the runnable SQLite-only minimal-reproducer; the documented corrective fix is in the audit's `§Reopen-path recommendations`. Path-B-style sequential collisions are structurally impossible (SELECT-then-INSERT protects the walker within a single call); the only actual collision mechanism is concurrent execution, which gunicorn/uwsgi workers + dev workflows can hit.
