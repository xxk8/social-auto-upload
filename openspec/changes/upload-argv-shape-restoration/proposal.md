## Why

30 of 34 tests in `tests/test_sau_web_upload.py` fail at HEAD 5a9332a — the highest single-file FAIL cluster in the suite. The failing classes:

- **TestBilibiliUploadVideo** (7 fails): argv shape for `sau bilibili upload-video` — `--file`, `--title`, `--tags`, `--cover`, `--desc`, `--schedule`, `--tid`, `--headless`, `--desc-platform-set`
- **TestThumbnailUploadVideo** (6 fails): `--thumbnail` flag handling, dual-thumbnails for douyin/tencent, no-dual for kuaishou, empty-thumbnail-not-passed
- **TestTencentUploadVideo** (6 fails): Tencent-specific argv shape — `--product-link`, `--product-title`
- **TestCrossPlatform** (6 fails): cross-cutting flag rules (desc-in-desc-platforms, headless-passed-for-browser-platforms, baseline fixture parity)
- Plus ~5 fails in: TestSchedule (1), TestHeadless (3), TestMissingField (1), TestDraft variants (estimate ~2)

At 88% fail rate across 30 distinct tests, the dominant hypothesis is ONE common regression rather than 30 independent bugs. The most likely root cause: `web_runner/routes/upload.py::build_cli_argv` (or equivalent) diverged from the CLI's argparse model — e.g., a renamed option (`--cover` → `--cover-image`), an inverted boolean (`--headless` defaults changed), or a positional-vs-flag rearrangement.

Why this matters: the publish flow is the core user-facing feature of the entire app. If 30 of its tests fail simultaneously, the daemon's argv pipeline is probably broken for ALL platforms — operators hitting `/api/upload/video` get silently rejected (or succeed with wrong args).

## What Changes

- **Audit `web_runner/routes/upload.py::build_cli_argv` against `cli/parser.py`** — every CLI flag the tests assert must be present in argv in the correct position. Likely single-line fix: revert a recent rename / invert a default.
- **Restore cross-platform flag parity**: Bilibili, Tencent, and CrossPlatform tests all assert the same `--headless` shape for browser-required platforms; ensure `build_cli_argv` honors the platform's `requires: true` metadata from `cli/platforms/<platform>.py` PLATFORM_CONFIG.
- **Restore thumbnail dual-flag for douyin/tencent**: Tencent-specific behavior — `--thumbnail-url` (cover for the post) and `--dynamic-cover` (animated cover) — both must be passed when set. Kuaishou must NOT receive either. Verify the platform-to-arg-translation map.
- **Restore missing-field validation**: `test_missing_platform` / `test_missing_account` / `test_missing_title` / `test_missing_file` must return 400 with `success=False, message=` subset of the existing Chinese error strings. Likely a recent route-level schema fix accidentally dropped `required` markers.

## Capabilities

### Modified Capabilities
- `api-publish-upload`: The publish route now correctly constructs `sau <platform> upload-video ...` argv in the exact shape the CLI parser expects. The contract (per the existing `cli/parser.py`) is unchanged — this change fixes the implementation to match.

## Impact

- **Web API**: `web_runner/routes/upload.py` (likely 1-3 lines of revert); possibly `cli/parser.py` if the divergence is on the parser side rather than the route side
- **CLI**: No CLI changes — the bug is that the Web shim builds wrong argv; the CLI itself is correct
- **Frontend**: No frontend code changes — PublishPage already builds the correct request body; the body matches the backend's expectations
- **Database / DB layer**: No changes
- **Tests**: `tests/test_sau_web_upload.py` — 30 tests start passing; the 4 already-passing tests stay passing (no regression)
- **Breaking**: None expected. If the prior (broken) argv was silently producing wrong outcomes, callers will now see the correct outcome.
