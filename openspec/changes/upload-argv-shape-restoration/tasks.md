## 1. Capture & Triage

- [ ] 1.1 Run `.venv/bin/pytest tests/test_sau_web_upload.py --tb=short -p no:warnings -q 2>&1 | head -150 > /tmp/upload_argv_traceback.txt` and inspect the 30 distinct fail lines. Cluster by assertion-error type (`assert X != Y`) to confirm ONE root cause vs multiple.
- [ ] 1.2 If multiple regression clusters found, split this openspec change into N parallel sub-changes via `openspec/changes/fix-upload-argv-validation-N`. Otherwise proceed to D1.

## 2. Fix argv builder

- [ ] 2.1 In `web_runner/routes/upload.py`, locate the function that builds the CLI argv from request body (likely `build_cli_argv` or similar). Diff against `cli/parser.py` to find the divergence.
- [ ] 2.2 Apply the minimal revert/restoration to align `build_cli_argv` with the parser's expected argv shape.
- [ ] 2.3 If the divergence is on the parser side, edit `cli/parser.py` instead (carefully — the CLI is consumed by `sau_cli.py` users; ensure backwards compat).

## 3. Restore cross-platform flag parity

- [ ] 3.1 For each platform with required-on-`upload-video` flags (Bilibili: `--cover`, Tencent: `--product-link`, `--product-title`), verify the route's request body → argv mapping is correct.
- [ ] 3.2 For dual-thumbnail platforms (Douyin + Tencent), verify both `--thumbnail-url` and `--dynamic-cover` are passed when set. For Kuaishou, verify neither is passed.
- [ ] 3.3 For browser-required platforms, verify `--headless` defaults to the platform-config's value unless explicitly overridden by request body.

## 4. Fix missing-field validation

- [ ] 4.1 Verify `test_missing_platform` / `test_missing_account` / `test_missing_title` / `test_missing_file` return 400 with the expected Chinese message strings.
- [ ] 4.2 Verify per-platform required-field-set is correctly loaded (likely from `cli/platforms/<platform>.py`'s `REQUIRED_FIELDS` constant).

## 5. Tests

- [ ] 5.1 Run `.venv/bin/pytest tests/test_sau_web_upload.py -v --tb=short` — all 34 tests pass (was 4 pass / 30 fail).
- [ ] 5.2 Run `.venv/bin/pytest tests/ -v --tb=short -k 'upload'` — confirm adjacent upload-related tests still pass.

## 6. Verification

- [ ] 6.1 Run `.venv/bin/ruff check web_runner/routes/upload.py cli/parser.py` and `.venv/bin/black --check web_runner/routes/upload.py cli/parser.py` — must remain GREEN
- [ ] 6.2 Run `.venv/bin/python -m pytest tests/ --collect-only -q` — confirm 0 import-time regression (collection should still surface 390 tests)
- [ ] 6.3 Manual smoke: hit `POST /api/upload/video` with a known-good request body, verify the CLI subprocess is spawned with correct argv (log via `_db_logger.debug` for one-off check)

## Pre-Apply Verification (openspec apply gate)

> **Required BEFORE ** — these gating steps confirm the spec scenarios match what the failing tests actually assert. Skipping them risks  against a contract the implementation does not need to satisfy.

- [ ] 0.1 Capture full tracebacks for all FAIL-cluster tests in this change's failing-test list (run  per test).
- [ ] 0.2 Diff each captured traceback against the matching  block in . For each Scenario, confirm:
  - The WHEN conditions match the test's setup
  - The THEN entries match the test's assertions (modulo whitespace — REMOVE brackets/commas/etc-specific-to-the-test)
  - The AND entries match additional assertions chained in the test
- [ ] 0.3 For any Scenario whose test failure does NOT match the spec (i.e., the test asserts something different from what the spec says), update the spec's Scenario OR mark it for  deletion. Do NOT apply the change while a mismatch exists.
- [ ] 0.4 Capture a baseline-reference pytest run (HEAD with no code changes) showing the FAIL count delta when the change is applied. Use  both before and after the impl lands.
