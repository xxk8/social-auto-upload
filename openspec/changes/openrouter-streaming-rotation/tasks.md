## 1. Trace one failure to determine root cause

- [ ] 1.1 Run `.venv/bin/pytest tests/test_stream_openrouter.py::TestStreamOpenRouter::test_429_retries_with_next_key --tb=long -p no:warnings -v` and capture the full assertion error + traceback
- [ ] 1.2 Run `.venv/bin/pytest tests/test_stream_openrouter.py --tb=line -p no:warnings 2>&1 | head -60` to get all 8 fail summary lines
- [ ] 1.3 Classify: if assertion mismatch `X != Y` where X is in `mock_post` fixture and Y is in helper output → MOCK DRIFT; if assertion mismatch where X is captured SSE event and Y is the helper's actual emit → REAL REGRESSION

## 2. Fix in correct layer

- [ ] 2.1 If MOCK DRIFT: edit `tests/test_stream_openrouter.py` fixture (likely the `mock_post` setup at top of file). Align with the helper's new signature.
- [ ] 2.2 If REAL REGRESSION: edit `web_runner/routes/ai.py::_post_to_openrouter` (or equivalent) to restore the expected behavior. Verify with `git log -p web_runner/routes/ai.py | head -200` is helpful to find the recent change.

## 3. Cross-fixture audit

- [ ] 3.1 Check `tests/test_ai_routes.py` for shared mock fixtures that may also need updating if MOCK DRIFT path was taken
- [ ] 3.2 Check `tests/test_ai_multi_platform.py` for shared fixtures (`mock_mark`, `mock_post`, `mock_next_key`, `mock_all_keys`) — these are referenced in the test signature and may need consistent updates

## 4. Tests

- [ ] 4.1 Run `.venv/bin/pytest tests/test_stream_openrouter.py -v --tb=short` — all 15 tests pass (was 7 pass / 8 fail)
- [ ] 4.2 Run `.venv/bin/pytest tests/ -v --tb=short -k 'openrouter or ai_stream or ai_route'` — confirm AI-related siblings pass

## 5. Verification

- [ ] 5.1 Run `.venv/bin/ruff check web_runner/routes/ai.py tests/test_stream_openrouter.py` and `.venv/bin/black --check web_runner/routes/ai.py tests/test_stream_openrouter.py` — must remain GREEN
- [ ] 5.2 Manual smoke: open the AI panel, set OpenRouter API key, send "Hello" stream — verify `data: ` events flow and a final `data: [DONE]` or similar terminal event arrives

## Pre-Apply Verification (openspec apply gate)

> **Required BEFORE ** — these gating steps confirm the spec scenarios match what the failing tests actually assert. Skipping them risks  against a contract the implementation does not need to satisfy.

- [ ] 0.1 Capture full tracebacks for all FAIL-cluster tests in this change's failing-test list (run  per test).
- [ ] 0.2 Diff each captured traceback against the matching  block in . For each Scenario, confirm:
  - The WHEN conditions match the test's setup
  - The THEN entries match the test's assertions (modulo whitespace — REMOVE brackets/commas/etc-specific-to-the-test)
  - The AND entries match additional assertions chained in the test
- [ ] 0.3 For any Scenario whose test failure does NOT match the spec (i.e., the test asserts something different from what the spec says), update the spec's Scenario OR mark it for  deletion. Do NOT apply the change while a mismatch exists.
- [ ] 0.4 Capture a baseline-reference pytest run (HEAD with no code changes) showing the FAIL count delta when the change is applied. Use  both before and after the impl lands.
