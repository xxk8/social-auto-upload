# Drop Legacy Failing Tests · 2026 Q3 — Tasks

## 1. Acknowledge `test_video_fill_meta_*` already gone post §8.4.2

- [x] 1.1 Confirm: `tests/test_xiaohongshu_uploader.py` currently contains only `XiaoHongShuVideoValidateUploadArgsTests::test_validate_upload_args_contract` (the Phase 4 §8.4.2 lock-in test that replaced the file). The legacy `test_video_fill_meta_*` tests are NOT in the current file — they were dropped as a side-effect when §8.4.2 rewrote the file on 2026-07-02.
  - **Verification**: `grep -n 'test_video_fill_meta' tests/test_xiaohongshu_uploader.py` returns no matches. Confirmed absent.
- [x] 1.2 Audit-trail — `docs/bug-tickets/test-app-bugfix-tickets-2026q3.md::TBF-013`: mark `- [x] TBF-013` in the Status index + add **Resolved at** date + reference to `openspec/changes/fix-baijiahao-schedule-time/...` — actually no, the resolution was `openspec/changes/cli-uploader-architecture-consistency/tasks.md` §8.4.4 (Tencent/Bilibili/Kuaishou/Xiaohongshu migration). Reference the right ticket in the resolved-at note.

## 2. Drop `TestErrorEventsApiRoute`

- [x] 2.1 Delete the entire `TestErrorEventsApiRoute` class from `tests/test_structured_log.py` (4 methods: 2 ERROR `test_get_endpoint_returns_rows` + `test_get_endpoint_filters_by_account_and_exc_type`; 2 PASS `test_get_endpoint_limit_offset` + `test_empty_filter_returns_empty_list`). All 4 dropped together to keep the `client` fixture shared scope hermetic.
- [x] 2.2 Insert audit-trail comment at the deletion site pointing to `openspec/changes/drop-legacy-failing-tests-2026q3/proposal.md` + noting the root-cause analysis so future maintainers can resurrect if the product behaviour is ever re-asserted.

## 3. Restructure TBF-014

- [x] 3.1 The original TBF-014 referenced `TestStructuredLoggerHook` / `TestLoguruIntercept` shape mismatches — those classes don't exist in the current `tests/test_structured_log.py` (the file currently contains only `TestLogErrorEventHelper` + `TestErrorEventsApiRoute` + `TestLogs`). The TBF-014 description was speculative/wrong at the time it was filed. Drop the non-existent class references; restructure to focus on the actually-existing `TestErrorEventsApiRoute` (the 4 tests dropped by §2).
- [x] 3.2 Mark `- [x] TBF-014` in the Status index.
- [x] 3.3 Update the TBF-014 body to record the root-cause analysis (the `client` fixture bugs) + the resolution path (this openspec ticket) so a future maintainer who wants to re-pin the /api/error-events behaviour has the rationale + migration-test-handle (separate Sandbox-DB integration test) on hand.

## 4. Verification

- [x] 4.1 `pytest tests/test_structured_log.py -v` exits 0 — 7 `TestLogErrorEventHelper` PASS + 2 `TestLogs` PASS, no ERROR, no FAIL.
- [x] 4.2 `pytest tests/test_xiaohongshu_uploader.py -v` exits 0 (still 1/1 PASS — Phase 4 §8.4.2 lock-in contract test).
- [x] 4.3 `pytest tests/test_sau_cli_shim.py tests/test_sau_browser_cli.py tests/test_sau_bilibili_cli.py tests/test_sau_bilibili_e2e.py tests/test_cli_parser_byte_for_byte.py tests/test_baijiahao_uploader.py tests/test_douyin_uploader.py tests/test_base_video_uploader.py tests/test_bilibili_uploader.py tests/test_kuaishou_uploader.py tests/test_tencent_uploader.py tests/test_baijiahao_set_schedule_time.py` exits 0 (the Phase 2/3/4/4.5 closure suite — pre-existing unrelated failures in `test_xiaohongshu_uploader` (x2) + `test_structured_log` (x2) are GONE post this drop).
- [x] 4.4 `ruff check tests/test_structured_log.py tests/test_xiaohongshu_uploader.py` exits 0.

## 5. Sanity grep

- [x] 5.1 `grep -rn 'TestErrorEventsApiRoute' .` returns zero references (only the deleted class — no surviving code/documentation references that would become dangling).
- [x] 5.2 `grep -rn 'test_video_fill_meta' .` returns zero references (those tests are gone; nothing else references them).
- [x] 5.3 `grep -rn 'audio/drop-legacy-failing-tests-2026q3' .` returns at least 4 references (the audit trail is indexed in the openspec ticket itself + the live `docs/bug-tickets/...` TBF-013/TBF-014 closures + the deleted-test-file inline comment).
