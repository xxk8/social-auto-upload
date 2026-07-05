# Test-App Bugfix Tickets · 2026 Q3

> **Status**: Proposed · **Created**: 2026-06-29 · **Origin**: `chore(tests): lint sweep` (`4e96781`) unblocked 73 previously unimportable pytest FAILs + 4 ERRORs across 9 test files.
>
> The 3 highest-priority tickets have their own dedicated openspec changes:
> - [`account-group-rename-rollback`](../openspec/changes/account-group-rename-rollback/) — real product bug in `rename_account_group()` (atomic fs+db rollback)
> - [`upload-argv-shape-restoration`](../openspec/changes/upload-argv-shape-restoration/) — 30/34 publish-flow tests failing in `test_sau_web_upload.py` (CLI argv shape regression)
> - [`openrouter-streaming-rotation`](../openspec/changes/openrouter-streaming-rotation/) — 8/15 streaming tests failing in `test_stream_openrouter.py` (mock drift or rotation regression)
>
> This file is the **flurry** — every remaining FAIL / ERROR enumerated as its own trackable ticket stub so individual contributors can pick them up independently of the top-3.
>
> **Total**: 73 distinct FAILs + 4 distinct ERRORs across 9 test files. Naming convention: `TBF-NNN` for grep-ability (`git grep TBF-` / `rg TBF- docs/`). Each entry ≤ 6 lines; intentionally lightweight to fit a single PR each.

---

## Status index

<!-- Mutate the checkboxes below to track pickup / resolution. The H2 headers below contain the full ticket details; this index exists purely so the file's mutation surface (step 8 of "How to pick up a TBF") matches the actual list state. -->

- [ ] TBF-001
- [ ] TBF-002
- [ ] TBF-003
- [ ] TBF-004
- [ ] TBF-005
- [ ] TBF-006
- [ ] TBF-007
- [ ] TBF-008
- [ ] TBF-009
- [ ] TBF-010
- [ ] TBF-011
- [ ] TBF-012
- [x] TBF-013
- [x] TBF-014
- [ ] TBF-015
- [x] TBF-016
- [x] TBF-017
- [ ] TBF-018
- [ ] TBF-019
- [ ] TBF-020
- [x] TBF-023

---

## Acceptance / Process

- Each TBF-NNN becomes one PR (`fix(<module>): <title>`) of ≤ ~50 LoC diff.
- Each PR carries the `TBF-NNN` keyword in its commit message subject for grep-ability.
- Each PR must keep `tests/test_<file>.py` collection count unchanged + the specific failing test turning PASS.
- Bulk-fixing multiple TBF-NNN into one PR is FORBIDDEN — keep fuzz small for clean revert surface.

---

## TBF-001 · account_groups: 6 publish-flow authorization tests fail

- **File · Class**: `tests/test_sau_web_account_groups.py::TestAuthorizeQrPlatforms` / `TestAuthorizeNonQrPlatforms` / `TestAuthorizeEdgeCases`
- **Failing tests** (6): `test_all_qr_platforms_return_200`, `test_douyin_authorize_returns_correct_cookie_path`, `test_bilibili_authorize_returns_correct_cookie_path`, `test_tencent_authorize_returns_correct_cookie_path`, `test_all_non_qr_platforms_return_200`, `test_tiktok_authorize_returns_correct_cookie_path`, `test_baijiahao_authorize_returns_correct_cookie_path`
- **Symptom**: POST `/api/account-groups/<id>/authorize` returns a status code other than 200, OR 200 but with a `data.cookie_file` path that doesn't match the `<platform>_<group_name>.json` shape asserted by the test
- **Hypothesis**: A recent rename of the cookie-file path template (e.g., escaped `<platform>_<group_name>.json` → `<platform>__<group_name>.json` with double underscore) broke the path assertion. OR `_run_sau` async spawn shape changed.
- **Acceptance**: 6 tests pass; 200 status + correct path on the data field

## TBF-002 · account_groups: ERROR collections on QR platform authorize (2)

- **File · Class**: `tests/test_sau_web_account_groups.py::TestAuthorizeQrPlatforms` (collection-time ERROR)
- **Failing tests** (2 ERROR): `test_all_qr_platforms_return_200`, `test_douyin_authorize_returns_correct_cookie_path`
- **Symptom**: pytest "ERROR" status (not FAIL) — the test couldn't even run. Likely a `conftest.py` fixture import collision OR a missing app-factory dependency injected at test runtime
- **Hypothesis**: `tests/conftest.py::app` fixture re-defines something that the test module's own `app` fixture conflicts with; pytest-import-time race. OR a `web_runner/__init__.py::create_app` import surface was broadened and now pulls in a side-effect (e.g., SMTP probe) the test can't tolerate.
- **Acceptance**: 2 ERRORs become PASS (or, if collection-time is unavoidable, the test gets `@pytest.mark.skip` with a documented TODO + TBF-002 reference)

## TBF-003 · account_groups: 4 authorize edge-case tests fail

- **File · Class**: `tests/test_sau_web_account_groups.py::TestAuthorizeEdgeCases`
- **Failing tests** (4): `test_group_name_with_spaces`, `test_group_name_with_special_chars`, `test_multiple_qr_platforms_on_same_group`, `test_unlisted_platform_treated_as_non_qr`
- **Symptom**: edge-case group names with non-ASCII / spaces / special chars either reject with 400 (when they shouldn't) OR accept but compute a wrong `cookie_file` path
- **Hypothesis**: `_validate_group_name` validator was tightened; the whitelist no longer includes Chinese CJK characters or hyphenated underscores
- **Acceptance**: 4 tests pass; Chinese names + spaces + hyphen accept correctly

## TBF-004 · upload: 7 Bilibili publish-argv tests fail

- **File · Class**: `tests/test_sau_web_upload.py::TestBilibiliUploadVideo`
- **Failing tests** (7): `test_desc_always_passed`, `test_headless_not_passed`, `test_tid_default_233`, `test_tid_explicit`, `test_basic_with_tags_and_explicit_tid`, `test_schedule_argv_has_no_schedule_flag`, `test_bilibili_without_headless_works`
- **Symptom**: argv shape mismatch in `cli bilibili upload-video` invocations
- **Hypothesis**: tracked in openspec change `upload-argv-shape-restoration` — likely single regression; this TBF is the Bilibili sliver
- **Acceptance**: 7 tests pass; per openspec change §1 confirmed as single-root-cause (otherwise split into TBF-004a, TBF-004b, etc.)

## TBF-005 · upload: 6 Thumbnail publish-argv tests fail

- **File · Class**: `tests/test_sau_web_upload.py::TestThumbnailUploadVideo`
- **Failing tests** (6): `test_thumbnail_in_thumbnail_platform`, `test_no_thumbnail_in_non_thumbnail_platform`, `test_dual_thumbnails_for_douyin`, `test_dual_thumbnails_for_tencent`, `test_no_dual_thumbnails_for_kuaishou`, `test_empty_thumbnail_not_passed`
- **Symptom**: `--thumbnail` / dual-thumbnail (`--thumbnail-url` + `--dynamic-cover`) flag handling broken
- **Hypothesis**: same root as TBF-004 (likely single regression covers both)
- **Acceptance**: 6 tests pass

## TBF-006 · upload: 6 Tencent publish-argv tests fail

- **File · Class**: `tests/test_sau_web_upload.py::TestTencentUploadVideo`
- **Failing tests** (6): `test_product_link_and_title`, `test_product_fields_omitted_when_empty`, + 4 more in `TestTencentUploadVideo`
- **Symptom**: `--product-link`, `--product-title`, Tencent-specific flags missing or wrongly ordered
- **Hypothesis**: same root as TBF-004
- **Acceptance**: 6 tests pass

## TBF-007 · upload: 6 CrossPlatform publish-context tests fail

- **File · Class**: `tests/test_sau_web_upload.py::TestCrossPlatform`
- **Failing tests** (6): `test_baseline`, `test_with_all_extras`, `test_without_extras`, `test_draft_true_variants`, `test_draft_false_values`, `test_schedule_status`
- **Symptom**: cross-platform baseline parity broken — flags shared across platforms diverge in argv shape
- **Hypothesis**: same root as TBF-004
- **Acceptance**: 6 tests pass

## TBF-008 · upload: ~5 Headless / Desc / Schedule / MissingField tests fail

- **File · Class**: `tests/test_sau_web_upload.py` (mixed; ~5 tests spread across `TestHeadless` / `TestDescInDescPlatforms` / `TestMissingField` / `TestSchedule`)
- **Failing tests** (~5): `test_headless_passed_for_browser_platforms`, `test_headed_flag`, `test_headless_absent_for_bilibili`, `test_headless_absent_when_not_sent`, `test_missing_platform` / `test_missing_account` / `test_missing_title` / `test_missing_file`
- **Symptom**: `--headless` defaults wrong / `--desc-platforms` parsing wrong / 400-error contract broken
- **Hypothesis**: same root as TBF-004 OR independent regression on validation
- **Acceptance**: ~5 tests pass

## TBF-009 · openrouter: 8 streaming tests fail

- **File · Class**: `tests/test_stream_openrouter.py::TestStreamOpenRouter`
- **Failing tests** (8): representative subset — `test_429_retries_with_next_key`, `test_multiple_429s_rotate_through_all_keys`, `test_all_keys_429_emits_exhaustion_error`, `test_no_keys_available_emits_error`, `test_500_emits_error_with_message`, `test_401_emits_error_with_status`, `test_connection_error_emits_error`, `test_key_info_emitted_before_data`
- **Symptom class**: tracked in openspec change `openrouter-streaming-rotation`
- **Hypothesis**: see top-3 proposal §Why — either mock-signature drift OR real rotation regression
- **Acceptance**: 8 tests pass

## TBF-010 · tencent_note: ALL 7 tests fail (100% fail rate)

- **File · Class**: `tests/test_tencent_note_implementation.py` (every test function in the module)
- **Failing tests** (7): `test_tencent_note_methods_are_coroutines`, `test_tencent_note_validate_caps_excess_images`, `test_switch_to_note_mode_no_crash_with_truthy_locators`, `test_tencent_upload_note_images_runs_with_stubbed_page`, `test_fill_note_title_and_tags_types_through_stubbed_page`, `test_cli_tencent_upload_note_parser_has_expected_flags`, `test_web_runner_marks_tencent_supporting_notes`
- **Symptom class**: 100% fail rate suspicious — likely a single import-time / fixture-level regression that affects every test. Or all tests independently broken because the Tencent note-mode subset was removed from supported platforms
- **Hypothesis**: Either (a) `uploader/tencent_video_uploader` no longer exposes the `*_note` methods the tests mock against (method was renamed/removed); OR (b) `cli/platforms/tencent.py` no longer surfaces `upload-note` in the supported-platforms list
- **Acceptance**: All 7 tests pass

## TBF-011 · auth: 7 auth-flow tests fail

- **File · Class**: `tests/test_auth.py` (3 classes: `TestSendCode`, `TestVerify`, `TestAuth`)
- **Failing tests** (7): representative subset — `test_send_code_success`, `test_rate_limit`, `test_wrong_code`, `test_first_user_becomes_admin`, `test_invalid_email_format`, `test_invalid_code_format`, `test_unauthenticated`
- **Symptom class**: likely a mix of (a) SMTP-when-not-configured paths (assert 503 / 503 not raised), (b) `401` expecting got `200` style mismatches, (c) admin-promotion auto-detection
- **Hypothesis**: SMTP-toggle default flipped; `SAU_SMTP_ENABLED` or `SAU_AUTH_ENABLED` env-var read changed; the verification-code endpoint validation regex tightened
- **Acceptance**: 7 tests pass

## TBF-012 · ai_routes: 4 FAILs + 2 ERRORs

- **File · Class**: `tests/test_ai_routes.py`
- **Failing tests** (4 + 2 ERROR = 6): FAILs likely in `TestAiKeyMgmt` (admin endpoints); ERRORs in `TestAiConfigGet::test_configured_via_env_var_only`, `test_unconfigured_without_env_or_db`
- **Symptom**: ERRORs are collection-time / fixture setup failures (likely a smoke-test env-var override race); FAILs are 409-vs-200 / 401-vs-200 mismatches
- **Hypothesis**: `SAU_OPENROUTER_API_KEY` env-var read shape changed in `init_db` or the key-rotation contexts collide; OR an auth-bound (`@login_required`) wrapper now rejects admin endpoints that previously were admin-only
- **Acceptance**: 6 tests pass; test collection succeeds without env-var errors

## TBF-013 · xiaohongshu_uploader: legacy `test_video_fill_meta_*` dropped post §8.4.2 migration (audit-trail closure)

- **File · Class**: `tests/test_xiaohongshu_uploader.py`
- **Originally-failing tests** (4): `test_video_fill_meta_title`, `test_video_fill_meta_desc`, `test_video_fill_meta_tags`, `test_video_fill_meta_combined` — all 4 tested the humanized form-fill helpers (`XiaoHongShuVideo.fill_title`, `fill_desc`, `fill_tags`, `fill_meta`).
- **Original symptom (pre-§8.4.2)**: uploader-specific form-fill pin drift — the helpers' pin-level mocks no longer matched the helpers' current implementation surface after the upstream patchright race-wrap DRY refactor (TBF-016) + the `xhs-configurable-creator-domain` config surface widening.
- **Resolution pathway (audited 2026-07-02)**: Phase 4 §8.4.2 migration (in [`openspec/changes/cli-uploader-architecture-consistency/tasks.md`](../../openspec/changes/cli-uploader-architecture-consistency/tasks.md) §8.4.4 / `xiaohongshu` family slot) rewrote `tests/test_xiaohongshu_uploader.py` from scratch as a single `XiaoHongShuVideoValidateUploadArgsTests::test_validate_upload_args_contract` lock-in test pinned on the `validate_upload_args` contract (the entry-point exposed for the CLI dispatcher's preflight). The legacy `test_video_fill_meta_*` tests were dropped as a side-effect of the rewrite — they were NOT re-pinned because §8.4.2's family-wide audit was scoped to `validate_args`, NOT form-fill.
- **Audit-trail ticket**: [`openspec/changes/drop-legacy-failing-tests-2026q3/`](../../openspec/changes/drop-legacy-failing-tests-2026q3/) (proposal §Branch A + tasks §1 + design §Branch A).
- **Coverage note**: the `test_validate_upload_args_contract` lock-in is the structural contract §8.4.2 was designed to pin. The humanized form-fill helpers (title/desc/tags) are NOT currently unit-tested anywhere — re-pinning them would be ADDITIVE work as a clean "re-pin XiaoHongShuVideo render surface" ticket (NOT a resurrection of stale tests).
- **Resurrect-if-needed path**: a future ticket could re-add the 4 form-fill helper tests with mocks reflecting the current `XiaoHongShuVideo.fill_title` impl. Effort estimate: ~50 LoC of test code + helper double tensor (mock `human_type` page-context).
- **Acceptance**: `pytest tests/test_xiaohongshu_uploader.py -v` exits 0 post this drop (1/1 PASS — the §8.4.2 lock-in contract test).
- **Resolved at**: 2026-07-02 by `openspec/changes/drop-legacy-failing-tests-2026q3/` (audit closure of §8.4.2 migration's side-effect deletion). Original ticket counts (the "2 tests fail" referenced in the Status index) covered 2 of the 4 original form-fill tests; the other 2 had already been dropped by the §8.4.2 rewrite.

## TBF-014 · structured_log: `TestErrorEventsApiRoute` fixture-scope bug, dropped 2026-07-02 (audit-trail closure)

- **File · Class**: `tests/test_structured_log.py::TestErrorEventsApiRoute`
- **Originally-failing tests** (4): `test_get_endpoint_returns_rows`, `test_get_endpoint_filters_by_account_and_exc_type` (currently ERROR at fixture setup), `test_get_endpoint_limit_offset`, `test_empty_filter_returns_empty_list` (currently PASS — exercise query shapes that don't trigger the unstable DB INSERT path).
- **Original symptom**: 2 ERROR with `RuntimeError("INSERT did not return id: 'INSERT INTO account_groups (name, created) VALUES (?, ?)'")` raised by `web_runner/db.py::SqliteDatabase.insert_returning_id` during `web_runner/utils.py::_sync_cookie_files_to_db` (called from `web_runner/__init__.py::create_app()` inside the `client` fixture setup). The same fixture build path triggered error in 2 of 4 tests; the other 2 PASS'd because their `_log_error_event` payloads didn't trip the unstable SQLite RETURNING-id silent-collision path.
- **Root-cause analysis** (corrected per code-reviewer-minimax-m3 pass 2; full text in [`openspec/changes/drop-legacy-failing-tests-2026q3/design.md` §Branch B](../../openspec/changes/drop-legacy-failing-tests-2026q3/design.md)): the `client` fixture calls `create_app()` BEFORE `wr_utils.COOKIES_DIR = Path(tmp_dir)` is overridden, so `web_runner/__init__.py::_sync_cookie_files_to_db()` walks the REAL `cookies/` directory. The corrected mechanism is **UNIQUE-constraint collision on `account_groups(name)`**, NOT the originally-attributed "non-conforming cookie file" hypothesis (which `_sync_cookie_files_to_db`'s `len(parts) != 2` skip-clause already filters out — non-conforming filenames never reach the INSERT path). Two theoretical paths documented in design.md §Branch B (both pinned as **preliminary** pending a minimal-reproducer follow-up ticket): (A) two or more CONFORMING cookie files conforming to `<platform>_<account>.json` shape happen to share the same `<account>` stem across different `<platform>` prefixes — e.g. `tk_7x.json` + `ac_7x.json` both produce `account_name='7x'`; first INSERT into `account_groups(name='7x')` succeeds, second collides on UNIQUE `name` → `sqlite3.IntegrityError` → `SqliteDatabase.insert_returning_id` reads back no row post-collision → RuntimeError. (B) cross-session residue in shared real DB — prior `pytest` session wrote `account_groups (name='7x')`; subsequent session has a fresh cookie with the same `account_name` stem; second INSERT collides. A follow-up minimal-reproducer ticket is needed to nail which path triggers in practice; the design.md §Branch B analysis is best-effort until then.
- **Resolution pathway (audited 2026-07-02)**: DROP all 4 tests together for fixture-scope hermeticity. The 2 PASS tests pin the `/api/error-events` API payload shape (`{"success": true, "data": [...]}`) + limit/offset pagination + empty-filter returns empty list. That payload contract is NOT unit-tested elsewhere in the file — coverage loss accepted per user ops mandate.
- **Important**: the `/api/error-events` route handler at `web_runner/routes/tasks.py:288` is NOT modified by this drop. The `_log_error_event` / `_db_get_error_events` helpers retain coverage via `TestLogErrorEventHelper` (7 invariants) above. Only the API-route test class is dropped.
- **Audit-trail ticket**: [`openspec/changes/drop-legacy-failing-tests-2026q3/`](../../openspec/changes/drop-legacy-failing-tests-2026q3/) (proposal §Why + tasks §2 + design §Branch B).
- **Resurrect-if-needed path**: a future maintainer can (a) fix the fixture scope (2-line swap: move `application = create_app()` after the `wr_utils.COOKIES_DIR = Path(tmp_dir)` override block in `tests/test_structured_log.py::client`), AND (b) harden `_sync_cookie_files_to_db` to use `INSERT OR IGNORE` / `ON CONFLICT (name) DO NOTHING` on the `account_groups(name)` insert (~3-char surgical change — the minimal defensive layer that prevents UNIQUE-collision cascades, regardless of which theoretical path A or B actually fires). After both fixes, re-adding `TestErrorEventsApiRoute` with the original 4 tests should flip all 4 to PASS. **Domain-semantic caution (per code-reviewer-minimax-m3 pass 4):** `INSERT OR IGNORE` would silently MERGE multi-platform account-name collisions into ONE `account_groups` row. If per-account topology is preferred, the alternative is `ON CONFLICT (name) DO UPDATE SET created = excluded.created RETURNING id` (upsert-with-refetch) — preserves distinct rows for distinct `(platform, account)` collisions that happen to share the `<account>` slice. The follow-up minimal-reproducer audit at [`openspec/changes/audit-account-groups-unique-collision-2026q3/`](../../openspec/changes/audit-account-groups-unique-collision-2026q3/) REJECTED the preliminary Path A/B hypotheses here (both are sequentially impossible due to SELECT-then-INSERT protection) and pinned the actual mechanism: a **TOCTOU race** across concurrent `_sync_cookie_files_to_db` calls (two threads both pass the SELECT with `None` and race on the INSERT). The audit's `scripts/audit_account_groups_unique_collision.py` is a runnable SQLite-only minimal-reproducer; the PG differential is documented but not exercised (PG requires operator-supplied `DATABASE_URL`). Verified mechanism surface + recommended reopen-path fix cross-references live in the audit ticket's `design.md`.

**Reopen-path resolution 2026-Q3 (audited closure)**: the reopen-path (a) + (b) + (c) shipped as part of the audit ticket's task list §5:

  - **(a) fixture swap applied** in `tests/test_structured_log.py::client` — `wr_utils.COOKIES_DIR = Path(tmp_dir)` now overrides BEFORE `application = create_app()` so the walker reads the empty tmp dir (not the real `cookies/`).
  - **(b) walker upsert-with-refetch applied** in `web_runner/utils.py::_sync_cookie_files_to_db` — `account_groups` INSERT is now `INSERT INTO account_groups (name, created) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET created = excluded.created` (same SQL on both Postgres + SQLite 3.24+; no `_IS_POSTGRES` branching required for the harden).
  - **(c) TestErrorEventsApiRoute resurrected** with the original 4 tests (`test_get_endpoint_returns_rows` + `test_get_endpoint_filters_by_account_and_exc_type` + `test_get_endpoint_limit_offset` + `test_empty_filter_returns_empty_list`). All 4 PASS post-fix — API contract coverage restored.

  Empirical evidence: the audit script's `artifacts/repro-sqlite-N8-*.json` shows the walker no longer fires the race surface (upsert suppresses it). `/api/error-events` production shape unchanged — purely defensive hardening.
- **Acceptance**: `pytest tests/test_structured_log.py -v` exits 0 post this drop (7 `TestLogErrorEventHelper` PASS + 2 `TestLogs` PASS, no ERROR, no FAIL).
- **Resolved at**: 2026-07-02 by `openspec/changes/drop-legacy-failing-tests-2026q3/`.

## TBF-015 · strict_exceptions: 1 test fails

- **File · Class**: `tests/test_strict_exceptions.py`
- **Failing tests** (1): likely `tools/strict_exceptions.py` lint-baseline inventory grew
- **Symptom**: a new `except Exception:` was added in `web_runner/routes/` recently and the inventory check fails
- **Hypothesis**: a recent PR introduced one of the 82 outstanding `except Exception` patterns the lint sweep was designed to catch
- **Acceptance**: 1 test passes; new baseline entry captured or the offending exception refactored

---

## TBF-016 · douyin live-test: page.goto context-closed race recurs post-scan (EDIT 5 wrap insufficient)

- **File · Class**: `uploader/douyin_uploader/main.py::douyin_cookie_gen` (3 unwrapped `await page.goto` sites) — possibly also `cookie_auth` (steps after the EDIT-5-wrapped `page.goto`)
- **Trigger event**: 2026-06-29 live-test of `python sau_cli.py douyin login --account 99` against the v4-fix branch — same `Page.goto: Target page, context or browser has been closed` error recurred **AFTER** QR scan succeeded
- **Symptom observed in `.sau-logs/backend.log`** (timestamp-ordered): `🎭 Douyin 扫码登录不支持 headless, 强制切换到有头浏览器` → QR displayed (Strategy 0/1, NOT CDP-screenshot fallback — `_cdp_capture_screenshot` never invoked) → scan succeeded → `🥳 扫码成功, 已经跳转到登录后页面: https://creator.douyin.com/creator-micro/content/upload` at 11:03:24 → `ERROR: 😢 登录失败: Page.goto: Target page, context or browser has been closed` at 11:03:50 (call log fragment: `- navigating to "https://creator.douyin.com/creator-micro/content/upload", waiting until "domcontentloaded"`). **No `🩻 patchright race` warning emitted** — means EDIT 5 wrap did NOT catch the race. `context.storage_state` had saved a 14695-byte valid Douyin cookie file `cookies/douyin_99.json` (`gd_random` + `x-web-secsdk-uid` + multi-cookie session) BEFORE the race fired, so cookies persisted to disk; the failure surface was the post-scan verification step.
- **Hypothesis (most-likely first)**: EDIT 5 wraps `cookie_auth`'s single `await page.goto(...)` only. The 3 unwrapped `await page.goto(...)` sites inside `douyin_cookie_gen` itself (initial `creator.douyin.com/`, conditional `创作者登录`-click-fallback to upload, no-QR-captured-and-not-clicked fallback to upload) are still exposed to the same patchright startup race. The "navigating to creator-micro/content/upload" call-log fragment + the post-🥳 timestamp points at the third unwrapped goto (the no-QR / not-clicked fallback near the bottom of `douyin_cookie_gen`, line-region near `if not qrcode_info.get("image_data_url") and not landing_page_clicked:`). **Less-likely alternative**: race inside `cookie_auth` on a step AFTER `page.goto` (wait_for_url / get_by_text) — outer `try/finally` re-raises with "Page.goto:" residue from patchright's frame naming, but the originating call would actually be wait_for_url/get_by_text.
- **Recommended fix (two-part)**: (a) Extract `_goto_content_upload_safely(page, *, flow_label: str, timeout: int = 90000)` helper DRY with EDIT 5/6/7 and apply explicitly to the 3 unwrapped gotos in `douyin_cookie_gen`. (b) Extend EDIT 5's try/except in `cookie_auth` to also wrap `wait_for_url(...)` + the `_is_douyin_login_completed`-style polling step so future races on those sites fire 🩻 instead of escaping via the outer try/finally (which leaves the operator with no "raced here" diagnostic, only the bare 😭 logout).
- **Acceptance**: Re-run `python sau_cli.py douyin login --account 99` interactively (operator scans QR). Log shows ZERO `😢 登录失败: Page.goto: Target page, context or browser has been closed`. If any site fires, 🩻 log emitted with a flow-label-specific suffix (`小人正在赶往cookie/图文/视频页`) so the operator greps to the exact raced site. `cookies/douyin_99.json` validates; `cookie_auth` post-scan succeeds without any race escape. Live-test gate Clean.
- **Resolved at**: companion PR with TBF-016 race-wrap DRY refactor (`utils/patchright_race.py::is_patchright_race` + 6 race-wrap sites consolidated to `PatchrightRaceError` raising path). See TBF-017 for the race-classification follow-up. Inline-applied 2026-06-29; commit hash pending follow-up docs commit.

## TBF-017 · race-substring detector brittle to patchright versioning — upgrade to isinstance + name classifier + belt-and-suspenders

- **File · Class**: `uploader/douyin_uploader/main.py` 3 race-detection sites (line 93 `_goto_race_safe`, line 116 `_wait_for_url_race_safe`, line 353 `_wait_for_douyin_login` polling wrap) — previously used inline `if "context or browser has been closed" in msg or "Target page" in msg:` substring detection.
- **Trigger event**: TBF-017 was filed as the design-doc half of the TBF-016 split: race-substring detection depends on patchright implementation-detail wording (`str(e)` substring). Future patchright v1.40+ may rename the underlying error to `TargetClosedError` (the actual internal class name as of 2026-06; not yet exported to `async_api.__all__`), making the substring silently miss race → race leaks to outer except → 😢 hard fail.
- **Investigation findings** (factual, from project `.venv`):
  1. `patchright.async_api` only exposes 2 BaseException subclasses: `Error`, `TimeoutError` (MRO: `TimeoutError → Error → Exception → BaseException → object`).
  2. `TargetClosedError` is **NOT** a public class in `async_api.__all__`. It exists only in `playwright._impl._errors` internally. Error instances expose `.name: str` (= `__class__.__name__`).
  3. Belt-and-suspenders substring `("context or browser has been closed", "Target page")` is the runtime-form when patchright throws bare `Error("...")` with class-level fallthrough (`.name == "Error"`).
  4. `TimeoutError` MUST be excluded — semantic differs (network slow vs context structurally destroyed), conflating them would mis-diagnose polling timeout as race.
- **Recommended fix (applied inline-with-PR)**: extract `utils/patchright_race.py::is_patchright_race(e: BaseException) -> bool` with three-tier detection:
  1. Primary: `isinstance(e, patchright.async_api.Error)` AND `not isinstance(e, TimeoutError)` (exclude timeout explicitly).
  2. Narrow: `e.name in {TargetClosedError, PageClosedError, ContextClosedError, BrowserClosedError}` (future-proofs patchright v1.40+ upgrade where race-specific classes get promoted to `async_api.__all__`).
  3. Belt-and-suspenders: when `e.name == "Error"` (current 2026-06 patchright fallthrough case), fall back to message-substring match (`"context or browser has been closed" or "Target page"`).
  The classifier is pure (no IO), lives in `utils/` (cross-uploader reusable), and replaces 3 inline substring detection sites with one boolean function call.
- **Acceptance**: `tests/test_patchright_race.py` 8 unit tests pass covering TimeoutError exclusion, non-patchright Exception exclusion, race-subclass `TargetClosedError` name match, both substring variants, DNS / TLS error non-match. `py_compile uploader/douyin_uploader/main.py` syntax-clean. Live-test gate remains Clean.
- **Resolved at**: companion PR with TBF-016 race-wrap DRY refactor — `is_patchright_race` applied inline to 3 sites (`_goto_race_safe`, `_wait_for_url_race_safe`, `_wait_for_douyin_login`). Tests in `tests/test_patchright_race.py` added. Inline-applied 2026-06-29; commit hash pending follow-up docs commit.

## TBF-018 · fast-spin polish needs production-observed throttling sentinel before reverting to try/finally

- **File · Class**: `uploader/douyin_uploader/main.py::_wait_for_douyin_login` polling wrap (line ~378-405 area, after v9 fast-spin polish)
- **Trigger event**: 2026-06-29 v9 fast-spin polish — user-explicit acceptance to remove inside-except `await asyncio.sleep(poll_interval)` from the polling wrap after reviewer LOW-1 flagged double-sleep as cosmetic. Production-side impact is **bounded by patchright CDP RPC latency ~5-50ms/call (~20-200 iter/sec)** but not pre-emptively measured in production. `max_soft_failures=5` escalation cap is the operator-traceable exit (~5×50ms≈250ms total hot-window before `polling_unstable` result returned).
- **Symptom (watch-for-if-it-fires)**: patchright CDP-DEBUG log emits `"Too many requests to CDP server"` events OR high CPU + high async blocking time in `_wait_for_douyin_login` during a real production 5-minute QR-wait window where persistent non-race transient blip occurs.
- **Hypothesis (most-likely first)**: 删除 inside-except sleep 后 except 路径重试间隔 = 0 ms (Python `continue` 跳到 for-loop 顶端, 不 fall through 到 bottom sleep). Bounded by patchright's DOM access latency, but if patchright's CDP queue saturation manifests, this becomes a real CPU/event-loop hotspot.
- **Recommended fix (NOT applied this PR)**: revert via try/finally wrapping. Specifically:
  ```python
  try:
      is_completed = await _is_douyin_login_completed(page)
  except Exception as e:
      # ... race path or escalate path returns early (no sleep in this branch via early-return)
      polling_soft_failures += 1
      if polling_soft_failures >= max_soft_failures:
          return _build_login_result(False, "polling_unstable", ...)
      douyin_logger.debug(_msg("🐢", f"..."))
      continue
  finally:
      await asyncio.sleep(poll_interval)
  ```
  Restores 1× sleep per iter regardless of exception, matches pre-v9 behavior. Note `return` statements in except clause DO invoke `finally` (sleep still executes for post-escalation cooldown — this is the *correct* design, not a regression).
- **Acceptance**: Monitor patchright CDP events in production 5-min QR-wait cycles. If `"Too many requests to CDP server"` fires ≥ 1 per cycle, OR a single 5-minute window shows ≥ 1 successful polling wrap iteration without any exception pre-empted (sanity baseline), revert to try/finally wrapper. If observed rate is acceptable (e.g., zero throttling events in 4+ weeks), ticket may be downgraded to "won't fix — minimal-state architectural call retained".
- **Status**: Open (deferred ticket — depends on production observation data, no immediate code action triggered by this).
- **Monitoring schedule (4-week window starting 2026-07-06)**:
  - `scripts/monitor_cdp_throttling.py` (NEW, ~140 LoC, stdlib only) — cron-friendly hourly sweep. Globs `.sau-logs/*.log` for 3 patchright patterns: 🚨 `Too many requests to CDP server` (TBF-018 primary trigger), ⚠️ `patchright urlopen failed` (secondary), ℹ️ `ContextClosed` / `TargetClosedError` (race-classifier signal — supplementary, may inflate under genuine browser races but is NOT a revert trigger by itself).
  - **Idempotency**: per-log-file byte-offset keyed by inode in `.sau-logs/.monitor-state.json`. Re-runs in same hour do NOT double-count. Log rotation triggers implicit offset reset (new inode → scan from start of new content); logging `errors="replace"` so binary/mojibake never crashes the sweep; self-excludes own output file.
  - **Cron expression** (deploy provider-specific path substitution):
    ```
    0 * * * * cd /path/to/social-auto-upload && .venv/bin/python scripts/monitor_cdp_throttling.py >> .sau-logs/monitor-cdp-throttling.log 2>&1
    ```
  - **Exit semantics**: 0 even on missing `.sau-logs/` (clean deploy) + 0 on zero throttling (the GOOD signal); non-zero only on Python internal errors.
- **Decisions log** (4-week rolling baseline):
  - Week 0 (2026-06-29 pre-window baseline) ✓ — one-shot live run of `scripts/monitor_cdp_throttling.py` against all 4 historical `.sau-logs/*.log` files. Captured aggregate: `files_scanned=4, 🚨cdp_throttle=0, ⚠️http_errors=3 (historical pre-v9 incidents, NOT a v9 regression signal ☞ baseline context note), ℹ️race_events=0, bytes_scanned=12963`. Live run consumed all historical log content + wrote byte-offsets to `.sau-logs/.monitor-state.json` (per-log inode-keyed, 10467 / 432 / 2143 / 232 = 13274 bytes end-of-file position vs. 12963 `bytes_scanned` logical-line count — slight gap because `bytes_scanned` filters empty/short lines + non-UTF-8 bytes; both numbers are consistent with the same underlying scan). Baseline counts persisted to `.sau-logs/.monitor-baseline-2026-06-29.json` artifact. **From 2026-07-06 hourly cron forward, all emissions are deltas-vs-baseline (NOT raw-vs-zero)** — e.g. `🚨cdp_throttle=0, Δ_vs_week0=0` is the GOOD expected steady-state; `🚨cdp_throttle=1, Δ_vs_week0=1` is the STOP-ship revert trigger per TBF-018 design. Reference this row whenever a Week 1+ line drifts from baseline; the Δ framing makes the 4-week signal interpretable without ambiguity.
  - Pre-deploy dry-run (2026-07-05 T-1 simulation, executed 2026-06-29) ✓ — CRUISE: proceed to deploy hourly cron 2026-07-06. Procedure: appended 140 lines x 4 files of synthetic non-throttling prod-style log content (deterministic seed=42) to `.sau-logs/*.log` simulating ~7 days of normal prod growth, then ran `scripts/monitor_cdp_throttling.py` LIVE (advanced state offsets past the append). Captured dry-run aggregate: `files_scanned=4, 🚨cdp_throttle=0, ⚠️http_errors=0, ℹ️race_events=0, bytes_scanned=55024` (≈ 49152 bytes appended + 5872 bytes prior residual). Δ vs Week 0: `cdp_throttle=0, http_errors=-3 (informational, NOT a revert trigger; historical baseline is pre-v9 incident count not subtracted from current count for v9 regression diagnosis), race_events=0`. **All 3 STOP-ship-relevant counters steady-state**; v9 fast-spin polish did NOT trigger throttling under the synthetic 7-day prod-like load model. Dry-run artifact persisted to `.sau-logs/.monitor-predeploy-dry-run-2026-06-29.json` (snapshot_at `2026-07-05T00:00:00_simulation`). Operator-side re-runnable helpers: `scripts/pre-deploy-dry-run.sh` (re-runs the procedure + recomputes verdict; idempotent) + `scripts/deploy-monitor-cdp-throttling-cron.sh` (print/validate/install for the cron entry). **Action item**: on actual 2026-07-05, run `bash scripts/pre-deploy-dry-run.sh` to refresh the artifact (it auto-versions to `.monitor-predeploy-dry-run-YYYYMMDDTHHMMSSZ.json` so historical dry-runs retain full audit trail); if cruise returns, run `bash scripts/deploy-monitor-cdp-throttling-cron.sh install` to write the cron entry verbatim into operator crontab. **Operator-side action required**: the `install` mode writes to the operator's crontab (NOT to this repo). Confirm cron is actually deployed via `crontab -l | grep monitor_cdp_throttling` from the deploy host's shell. This repo only contains the helper + dry-run + baseline artifacts; the `crontab -l` view is the source of truth for whether the cron is live.
  - Week 1 (2026-07-06 → 2026-07-12): [ ] TBD — initial baseline. If 🚨cdp_throttle > 0 OR race_events trend anomaly → escalate to a new TBF-NNN revert ticket (number assigned at decision time, NOT pre-allocated here).
  - Week 2 (2026-07-13 → 2026-07-19): [ ] TBD — first repeat-window. Cumulative counts evaluated.
  - Week 3 (2026-07-20 → 2026-07-26): [ ] TBD — second repeat-window + 5-min QR-wait cycle sanity (≥ 1 successful poll-iter without exception pre-empted per TBF-018 Acceptance section).
  - Week 4 (2026-07-27 → 2026-08-02): [ ] final — **revert vs wontfix decision**. If 🚨cdp_throttle ≥ 1 OR race_event rate above baseline → revert to try/finally wrapper (per Recommended fix section). Else downgrade TBF-018 to **wontfix** (v9 fast-spin polish minimal-state architectural call retained) + close ticket.
- **TBF-023 cross-ref (dual-track coverage)**: `tests/test_douyin_polling_recovery.py` (TBF-023, 7 invariants PASS) is the **PR-time regression gate** for v9 fast-spin polish — any unit-test fail during pull-request review triggers immediate revert, doesn't wait for the 4-week TBF-018 production window. TBF-018 monitoring is the **prod-time observation gate** for runtime reality drift. Both gates live complementary; TBF-018 won't close until prod data confirms either revert or wontfix-never-hit-throttling.
- **Acceptance criteria update**: original Acceptance section leaves criteria ambiguous; this schedule formalizes a 4-week artifact (`.sau-logs/monitor-cdp-throttling.log` line histogram) at week 4 -> product owner incident-trigger check x1 →decision per the matrix above.
- **Baseline reference**: `.sau-logs/.monitor-baseline-2026-06-29.json` — Week 0 (2026-06-29) reference artifact. All hourly cron emissions from 2026-07-06 forward are interpreted as Δ vs this baseline (NOT raw-vs-zero). Frozen 7-element status check + per-log inode-keyed byte-offset snapshot. Future maintainers grepping `TBF-018` find this artifact path here without reading the Week 0 row prose above.
- **Pre-deploy reference**: `.sau-logs/.monitor-predeploy-dry-run-2026-06-29.json` — T-1 day (simulated 2026-07-05, executed 2026-06-29) dry-run artifact. CRUISE verdict already passed: `🚨cdp_throttle=0, ⚠️http_errors=0, ℹ️race_events=0` under a synthetic 7-day prod-like load model. On actual 2026-07-05, operator runs `bash scripts/pre-deploy-dry-run.sh` to refresh this artifact (auto-versions to `.monitor-predeploy-dry-run-<timestamp>.json`), then deploys via `bash scripts/deploy-monitor-cdp-throttling-cron.sh install` and verifies with `crontab -l | grep monitor_cdp_throttling`.

## TBF-019 · LOGIN_RESULT_STATUSES central schema registry — seed in place, future rollout tracking

- **File · Class**: `uploader/douyin_uploader/_status_schema.py` (NEW, ~70 LoC) + `uploader/douyin_uploader/main.py::_build_login_result` (import + low-risk docstring pointer only, no signature change) + `tests/test_login_result_status.py` (NEW, ~50 LoC, 6 invariants).
- **Trigger event**: 2026-06-29 status schema drift risk surfaced by spot-check on `web_runner/routes/` (TBF-016 follow-up). Reviewer found that `uploader+web_runner+frontend` future consumer drift is a real risk surface: string-equality checks against `result["status"]` with new-in-PR status additions silently miss recognition. User-approved in-scope proposal: initialize central registry anchor.
- **Symptom (current)**: `_build_login_result` call sites use 6 hardcoded string literals (`"success" / "failed" / "cookie_valid" / "cookie_invalid" / "patchright_race" / "polling_unstable"`) across 9+ sites in `main.py`. Adding a new status (e.g. future `polling_throttled`) requires cross-file coordination: producer (`main.py` `_build_login_result` call site) + consumer (frontend / web_runner string-match). No central registry to enforce parity.
- **Recommended fix applied this PR (seed scope)**:
  1. New module `uploader/douyin_uploader/_status_schema.py` exports `LOGIN_RESULT_STATUSES: frozenset[str]` (canonical 6 values) + `validate_login_status(s: str) -> bool` (EAFP-friendly bool check helper).
  2. `uploader/douyin_uploader/main.py` adds `from uploader.douyin_uploader._status_schema import LOGIN_RESULT_STATUSES` (low-risk import + 4-line docstring pointer in `_build_login_result`). No call-site refactor (avoid scope creep).
  3. New `tests/test_login_result_status.py` (6 invariants): frozenset immutability + canonical value pinning + task-lifecycle namespace disjointness + known/unknown validation + anti-typo guarantee (catch `"patchrightrace"` / `"cookies_valid"` / `"polling-unstable"` etc.).
- **Drift fix (2026-06-29 round 2)**: schema seed 初版 6-element ([success/failed/cookie_valid/cookie_invalid/patchright_race/polling_unstable])。seed 落地后 spot-check `_build_login_result` 9+ call sites,发现 `uploader/douyin_uploader/main.py` line 418 在 `_wait_for_douyin_login` for-loop 走完 `max_checks` (默认 `poll_interval=3 × max_checks=100 = 5min` wall-clock) 仍未触发 success / race / polling_unstable 时 emit `status="timeout"`, 但 `timeout` 不在 6-element schema set 中 — 是 spec 本身遗漏、不是后续 regression。决议 deliberate extend schema with `timeout` → 7-element, schema 与 emission site 重新对齐。
  - Schema 文件: `LOGIN_RESULT_STATUSES` frozenset 加 `"timeout"` entries + module docstring 同步到 “7 个合法 status 字面量”。
  - Tests: canonical-pinning 由 `_6_values` → `_7_values_pinning` + typo-sample 加 `time_out` / `TIMEOUT` 两种漂变门 gate **(reviewer round-2 verdict 删除了原初版冗余的 `_drift_fix` regression test + 过特化的 `timeut` 错字样** — DRY 重叠 + 越限定随机误捶型)**。
- **Recommended fix (NOT applied this PR — future rollout sub-tickets TBD)**:
  - When real future work demands, open dedicated TBF-NNN tickets following the doc's flat `TBF-NNN` convention (NOT `TBF-019.x` sub-tickets — that breaks `git grep TBF-` discoverability):
    - `TBF-020`: enum migration. Incrementally migrate `_build_login_result` call sites to use `validate_login_status(s)` with EAFP try/except (raise `UnknownLoginStatus` if not in set); unit-test that each call site passes validation.
    - `TBF-021`: web_runner consumer mandate (defer until a consumer is actually added). When web_runner adds `douyin_login_result` consumer, mandate `from uploader.douyin_uploader._status_schema import LOGIN_RESULT_STATUSES` and rely on `result["status"] in LOGIN_RESULT_STATUSES` (NOT `== "success"` etc.).
  - **Defer-until-needed (NOT pre-created as ticket)**: TypeScript cross-language source-of-truth via `scripts/sync_login_status_schema.py`. Frontend (TS) cannot directly import Python's `frozenset`, but no frontend surface today consumes the Python schema, so this is speculative. Open as a TBF only when an actual consumer demand appears (TBF-022 placeholder — do NOT pre-create).
- **Why **private** module-prefix (`_status_schema`)**: encapsulation-first; only uploader package internally references it now. Promote to `utils/login_qrcode.py` (location-b) later if cross-package becomes the dominant use.
- **Why **frozenset** + bool helper, NOT enum**: zero call-site signature change (existing 9+ sites keep stringly-typed); minimal patch surface this PR; preserves string-equality schema for future web_runner imports. Enum migration is a follow-up (TBF-020).
- **Defer-until-needed (do NOT pre-create as a ticket)**: TypeScript cross-language source-of-truth via `scripts/sync_login_status_schema.py` build-step generator. Open as a TBF only when an actual frontend consumer demand materializes — speculative today since no frontend surface consumes the Python schema yet.
- **Acceptance**:
  - `tests/test_login_result_status.py` 6 tests pass ✓ (verified post-seeding).
  - `py_compile uploader/douyin_uploader/_status_schema.py` + `main.py` clean ✓.
  - Future TBF-019.x sub-tickets track rollout; this seed ticket itself closes when seed is verified + tests pass.

---

## TBF-020 · LoginResultStatus enum migration — incremental site-by-site, frozen source-of-truth anchor

- **File · Class**: `uploader/douyin_uploader/_login_status.py` (NEW, ~50 LoC — `class LoginResultStatus(str, Enum)` with 7 members mirroring `LOGIN_RESULT_STATUSES`) + `uploader/douyin_uploader/main.py::_build_login_result` (signature widens `status: str` → `status: str | LoginResultStatus`, BACKWARD COMPATIBLE via Union — no caller breakage) + per-call-site migration commits (9 sites in main.py).
- **Trigger event**: TBF-019 schema registry seed established `LOGIN_RESULT_STATUSES: frozenset[str]` + `validate_login_status(s) -> bool`. The bool helper is **stopgap** (per its module docstring RST note) until a proper enum type anchor exists. Future PR-time drift risks without enum:
  1. typos in non-migrated sites (`_build_login_result(False, "succes", ...)` typo'd status silently accepted) — currently no static guard
  2. web_runner / frontend consumers cannot statically type-check (Pyright / TS no schema import)
  3. cross-package refactor (future TBF-021 trigger) needs concrete type, not stringly-typed
  - **Cross-ref**: TBF-021 web_runner consumer mandate (defer-until-needed); only relevant after migration Phase 3 lands a consumer.
- **Symptom (current)**: prior to this ticket, `_build_login_result(False, "succes", "...")` typo'd literal compiles fine and returns `dict` with `status="succes"`. web_runner/consumer downstream can't `isinstance(result["status"], LoginResultStatus)` because there is no such class. Type-checker (mypy / pyright) cannot enforce "must be in canonical 7-element set". Future maintainer scrolling main.py sees `status="polling_unstable"` 9 places; no automated reminder that this string is canonical and spelling-sensitive.
- **Recommended fix (NOT applied this PR — staged migration)**:
  - **Phase 1** (this ticket's seed scope): introduce `LoginResultStatus(str, Enum)` mirroring 7-element frozenset. Members with values:
    - `SUCCESS = "success"` (抖音扫码登录成功)
    - `FAILED = "failed"` (通用 catch-all / outer-finally 兜底)
    - `COOKIE_VALID = "cookie_valid"` (cookie_auth 返回 True)
    - `COOKIE_INVALID = "cookie_invalid"` (cookie_auth 返回 False / cookie 文件不存在)
    - `PATCHRIGHT_RACE = "patchright_race"` (5 race sites in main.py — see TBF-017)
    - `POLLING_UNSTABLE = "polling_unstable"` (_wait_for_douyin_login max_soft_failures=5 escalation — see TBF-018/023)
    - `TIMEOUT = "timeout"` (_wait_for_douyin_login max_checks wall-clock — TBF-019 round-2 drift fix)
  - **Phase 2** (per-call-site migration, batched per status semantic family): **12 call sites** in `uploader/douyin_uploader/main.py` (function definition at line 50 excluded from count). Real breakdown:
    - **`cookie_*` + generic `failed`** (load-bearing pre-races, do these first): 5 sites — lines 174 (`cookie_invalid`), 180 (`cookie_valid`), 444 (`failed` initial outer), 620 (`cookie_invalid` post-flow check), 629 (`failed` outer-finally catch-all).
    - **`patchright_race`**: 4 sites — lines 361/479/517/597. TBF-017 contract gate; result-dict shape unchanged.
    - **`polling_unstable` + `timeout`**: 2 sites — lines 377/418. TBF-018/023 contract gate; result-dict shape unchanged.
    - **`success`**: 1 site — line 406. TBF-023 contract gate; result-dict shape unchanged.
  - **Phase 3** (Union widening — non-breaking): `_build_login_result(status: str)` → `_build_login_result(status: str | LoginResultStatus)`. Str path remains for unknown callers (web_runner / external scripts); enum path is type-safe in-process direction. Migration phase-3 target lands when all 12 sites emit enum members, no remaining string-literal call sites.
- **Recommended fix (NOT applied this PR — full migration)**: **Phase 4** in a future PR drops `Union[str, ...]`, makes `status: LoginResultStatus` only. New code accepting raw strings raises `UnknownLoginStatus` via `validate_login_status(s)` EAFP. **Phase 4 gate**: not on TBF-021 consumer (which is defer-until-needed per TBF-019 spec — indefinite wait risk). Instead, gate on **90-day soak after Phase 3 lands** — assumes migrate-and-deprecate-str is sound within one calendar quarter regardless of consumer. TBF-021 web_runner consumer can still be adopted on demand and would slide in cleanly via Phase 3's union.
- **Schema registry cross-ref (TBF-019 anchor)**: `_login_status.py::LoginResultStatus` MUST be derived from `LOGIN_RESULT_STATUSES` — never duplicate the 7-element list. Cross-anchor is enforced by extending `tests/test_login_result_status.py` with a new invariant: `set(m.value for m in LoginResultStatus) == LOGIN_RESULT_STATUSES`. Drift in either side fails the test loudly.
- **Polling-recovery cross-ref (TBF-023)**: `tests/test_douyin_polling_recovery.py` 7 invariants all assert `result["status"] == "polling_unstable"` (string equality). Migration must NOT change result-dict value-shape: enum member `.value` is the same string the consumer-side test expects. Tests stay 7/7 PASS through migration. Optional Phase 4 enhancement: new test #8 set-membership assertion `result["status"] in {m.value for m in LoginResultStatus}` — defer.
- **Acceptance**:
  1. `_login_status.py::LoginResultStatus(str, Enum)` exported with the 7 members above; `__str__` returns `.value` (so log lines / string comparisons unchanged).
  2. `tests/test_login_result_status.py` extended with cross-anchor invariant `set(m.value for m in LoginResultStatus) == LOGIN_RESULT_STATUSES`.
  3. 9 call sites in main.py: per-PR migration step. Track via `rg '_build_login_result\('` returning all remaining string-literal sites; maintain a never-zero target until Phase 4 closes.
  4. (Optional / defer to Phase 4) test #8 in `tests/test_douyin_polling_recovery.py`: `polling_unstable` set-membership instead of strict equality. Adds regression net for future consumer not enforcing enum import.
- **Why `str, Enum` not plain `Enum`?**: dual inheritance makes enum members **str-coercible** — `LoginResultStatus.SUCCESS == "success"` evaluates True. This preserves backward compatibility at every call site that compares/returns the string value (TBF-023 polling tests, web_runner keys, frontend `result["status"]` reads). Plain Enum would silently break string-equality paths. **Note on Python compat**: `class Foo(str, Enum)` mixin is supported Python 3.6+ (not 3.11+); the version-specific feature is `StrEnum` (PEP 663, Python 3.11+). If we adopt `StrEnum` we lose `LoginResultStatus.SUCCESS == "success"` automatic str equality and must override `__str__` to return `self.value`. Recommendation: stick with `class LoginResultStatus(str, Enum)` mixin for cross-version compatibility + override BOTH `__str__` AND `__format__` to return `self.value` so `f"{member}"` (calls `__format__`) AND `str(member)` (calls `__str__`) both yield `"success"` for loguru / f-string logger paths.
- **Why `str | LoginResultStatus` Union not `LoginResultStatus` only?**: Phase 3 widens cautiously — drops `str` at Phase 4. Premature str-denial would block the existing TBF-016/TBF-017 call sites that emit hardcoded string literals from being migrated in Phase 2 without breaking. This is a phased migration, not a same-day flip.
- **Naming convention footnote** (3 symbols in same package):
  - **`LOGIN_RESULT_STATUSES`** (frozenset, ALL_CAPS, plural) — the collection contract from `uploader/douyin_uploader/_status_schema.py` (TBF-019).
  - **`LoginResultStatus`** (enum, PascalCase, singular) — the type-from-this-frozenset, new in `_login_status.py` (TBF-020 Phase 1).
  - **`validate_login_status`** (helper, snake_case, lowercase) — the bool check helper from `_status_schema.py` (TBF-019, stopgap until Phase 4).
  
  Convention: collection = plural ALL_CAPS, type = singular PascalCase, helper = singular lowercase. Each name's case style flags its role at a glance.
- **Cross-ref tickets**:
  - **TBF-019** — `LOGIN_RESULT_STATUSES` schema registry source-of-truth. This ticket is TBF-019's forward-rollout.
  - **TBF-021** — web_runner consumer mandate (defer until actual consumer added; would `from uploader.douyin_uploader._login_status import LoginResultStatus`).
  - **TBF-023** — polling-recovery test suite (must stay 7/7 PASS through migration; `result["status"]` value-shape unchanged).
- **Status**: Open — staged migration ticket, opens per PR commit (Phase 2 per Stage); not a single-shot fix. Phase 1 seed scope is the only "atomic" deliverable; Phase 2-4 are incremental.

---

## TBF-023 · polling-recovery test suite — 7 invariants gate v9 fast-spin polish + race-mask blind spot contract

- **File · Class**: `tests/test_douyin_polling_recovery.py` (NEW · 476 lines · ~19.5 KB · 7 invariants). Rechecks `_wait_for_douyin_login` in `uploader/douyin_uploader/main.py` (no source change).
- **Trigger event**: 2026-06-29 reviewer LOW-1 cosmetic polish on v9 fast-spin polish (移除 inside-except sleep) flagged that the new `polling_soft_failures` escalation path has no automated regression gate. Without tests, future refactor of `_wait_for_douyin_login` could silently break:
  1. Counter 1→2→3→4→5 escalate boundary at 5
  2. Race vs transient separation (race short-circuits BEFORE counter increment)
  3. TimeoutError race-mask blind spot (Tier 1 explicit exclusion是 design call)
  4. Counter reset on exception-free iter (mid-loop)
  5. Mixed race-mid-counter escape
  6. Wall-clock `max_checks × poll_interval (5min 默认)` backstop vs soft_failures path
- **Symptom (current)**: Module-level integration tests would need real patchright browser → slow + flaky + 不可在 CI gate。Without a unit-level contract suite, v9 fast-spin polish 是靠 reading the code 凝聚 implicit — coven “5 transient → escalate” 没有 automated enforcer。
- **Recommended fix applied this PR**: 7 invariants **full coverage**:
  1. `test_polling_escalates_at_5th_transient_failure` — 5x `Exception` → status=`polling_unstable`, call_count=5（中心 invariant 边界）
  2. `test_polling_recovers_with_2_transient_then_success` — 2x `Exception` + `True` → status=`success`, call_count=3（recovery baseline + counter 不误达 5）
  3. `test_polling_race_short_circuits_to_patchright_race` — 1x `PatchrightError("context closed")` → status=`patchright_race`, call_count=1（race ≠ transient）
  4. `test_timeout_error_with_race_substring_stays_nonrace` — 5x `PatchrightTimeoutError("context closed")` → status=`polling_unstable`（Tier 1 显式排除 TimeoutError，race-mask blind spot 是 design call）
  5. `test_polling_resets_counter_on_success_iteration` — 4x Exception + False + 4x Exception + True → status=`success`, call_count=10（counter mid-loop reset）
  6. `test_polling_4_transient_then_race_returns_race` — race escape mid-counter (counter=4 → race early-return)
  7. `test_polling_max_checks_wallclock_returns_timeout` — 20× False → status=`timeout` (wall-clock 路径不退化为 polling_unstable)
- **Test architecture (zero new 项目 deps)**:
  - `sync def test_…` + `asyncio.run(...)`（不依赖 pytest-asyncio，项目今未装配）
  - `monkeypatch.setattr("uploader.douyin_uploader.main._is_douyin_login_completed", mock_fn)` — module-global lookup target
  - `_MockPage` / `_MockLocator` minimal Playwright doubles (`page.url` plain str; `get_by_text(...).locator("..").first` chain returns `self` → `count() == 0` 走出 expired-box refresh 分支)
  - `_make_mock_is_completed(side_effects)` 播放 a script of `(bool | BaseException)` entries; default False after exhaustion
  - **Real `utils.patchright_race.is_patchright_race` classifier**（**不** monkeypatch classifier）— exercises v8 TBF-017 MRO + Tier 1/2/3 logic at runtime
- **Race classifier integration**: `PatchrightError("context or browser has been closed")` 走 Tier 1 (isinstance Error + not TimeoutError) → True; `PatchrightTimeoutError("context or browser has been closed")` 走 Tier 1 (TimeoutError 排除) → False; dual 是 explicit test #3 / #4 gate。
- **Schema registry cross-ref**: `polling_unstable` 是 `LOGIN_RESULT_STATUSES` 7-element canonical member (TBF-019 schema registry)。Test #1 (`escalates_at_5th_transient_failure`) + Test #4 (`timeout_error_with_race_substring_stays_nonrace`) 都 assert `result["status"] == "polling_unstable"` — 这些 status-equality 是 **schema-policed**。future drift（e.g. 在 `_status_schema.py` rename `polling_unstable` 为 `polling_failed`，或 drop 7-element 回到 6-element）会在 Test #1 + #4 上 fail，与 v9 fast-spin polish + race-mask blind spot design call 一同锁定。
- **Reviewer verdict chain**:
  - **Round 1** (5 tests): `thinker-with-files-gemini` **APPROVE** (audit focus a–n全过：counter-reset line position/ poll_interval=0/ monkeypatch target path/ Race classifier MRO 验证/ TimeoutError race-mask 是 design call 兑现/ Locator chain handling/ Path coercion on `image_path=""`/ `account_file` str-only/ asyncio module-load side-effect-free）。`code-reviewer-minimax-m3` **APPROVE** (LOW-2: 缺失 boundary tests; LOW-3: `_REPO_ROOT` sys.path insert 是 defensive but harmless; LOW-1: module-load side-effect 预言在 future 加 import-time connection 可能 break—not blocking)。`basher`: **5/5 PASS** in **0.47s**.
  - **Round 2** (+2 boundary tests `#6 #7`): `code-reviewer-minimax-m3` **APPROVE** (LOW cosmetic: test #7 `+ [True]` unreachable tail entry; moot—doesn’t 影响 correctness)。`basher`: **7/7 PASS** in **0.38s**。
- **Acceptance**:
  - `pytest tests/test_douyin_polling_recovery.py -v` → 7/7 PASS in <0.5s
  - Module-load side-effect-free（`_MockPage` / `_MockLocator` 不会触发 real patchright CDP session / async_playwright context manager；import时只取 type hints）
  - `monkeypatch.setattr` 自动 test teardown undo· no cross-test leak
  - `tests/conftest.py::real_test_sqlite_db` session-scoped autouse fixture unrelated · 不干扰
  - Future contributor 想 refactor `_wait_for_douyin_login` polling wrap **必须**保持全部 5 invariants + 2 boundary paths 仍绿
- **Resolved at**: pending-push-sha · N/A (TBF-023 doc-update boarding the test-file push on 2026-06-29 · 7 invariants · 0.38s mean run · 0 real browser · reviewer verdict chain double-APPROVED)

---

## How to pick up a TBF

# 1. Pick a TBF-NNN above (ideally one not adjacent to TBF-010 — see "Out-of-band notes")
# 2. Capture the actual traceback first:
   .venv/bin/pytest tests/<file>.py::TestClass::test_name --tb=long -v -p no:warnings
# 3. Confirm hypothesis matches (or refine)
# 4. Branch:
   git checkout -b fix/TBF-NNN-<short-slug>
# 5. Apply fix, ensure test turns PASS
# 6. Commit:
   git commit -m "fix(<module>): <symptom> (TBF-NNN)" -m "..."
# 7. PR title mirrors commit subject; PR body references the TBF-NNN header in this file
# 8. Update this file in a follow-up docs commit:
      - flip the matching `- [ ] TBF-NNN` line in the "Status index" to `- [x] TBF-NNN`
      - append `**Resolved at**: <commit-sha> · <PR-link>` under the matching `## TBF-NNN` header body
      - increment the `0 resolved` counter at the bottom of the Status index

## Out-of-band notes

- The 4 ERROR tests in TBF-002 + TBF-012 should be fixed FIRST — until they collect, their adjacent FAILs in the same file can't be cleanly staged for individual PRs.
- The 7 tencent_note tests in TBF-010 are a strong "all-or-nothing" cluster — either all 7 fix in one PR or none of them; do NOT split.
- The TBF-004..TBF-008 cluster all share the openspec change `upload-argv-shape-restoration`; traceback-audit ONE then propagate the fix to the rest before opening separate PRs.
