## Why

8 of 15 tests in `tests/test_stream_openrouter.py` fail at HEAD 5a9332a (53% fail rate) — the highest FAIL rate among AI-related test files. The streaming key-rotation helpers in `web_runner/routes/ai.py` are exercised by these tests via `@mock.patch` on `requests.post` + a key-rotation decorator. The failing tests cover:

- Login + key rotation on 429 (rate limit)
- Multi-key exhaustion when all keys are 429
- 500 / 401 / connection-error emitter branches
- `key_info` event ordering before data events
- `model` / `max_tokens` / `temperature` query-param passthrough
- `connect_timeout` is a tuple validation

Two plausible root causes:

1. **Mock-signature drift**: a recent change to the `mock_post` side_effect shape (e.g., now returns `MagicMock(response=...)` instead of a direct `Response`) broke the helper's `.raise_for_status()` / `.iter_lines()` calls. Likely fix: update the mock fixture in `test_stream_openrouter.py::conftest.py` (or the test class's setup) to match the new helper signature. Reciprocal fix could be: ensure the helper accepts the older signature for back-compat.

2. **Real product bug in key rotation**: the 4-5 spot-checked tests that exercise 429-retry (`test_429_retries_with_next_key`, `test_multiple_429s_rotate_through_all_keys`, `test_all_keys_429_emits_exhaustion_error`, `test_no_keys_available_emits_error`) all assert specific event stream shapes. If the helper now emits `data: {"error": ...}` BEFORE yielding the leaves the test confused.

## What Changes

- **Trace ONE failure to confirm root cause**: `.venv/bin/pytest tests/test_stream_openrouter.py::TestStreamOpenRouter::test_429_retries_with_next_key --tb=long` will surface the actual mismatch.
- **If mock drift**: refactor the test's `mock_post` fixture to align with `_stream_sse_post` / `_post_to_openrouter` helper signatures. Likely the `_run_sau` shim was refactored; the test fixture patch surface needs to match.
- **If real rotation regression**: identify the line in `web_runner/routes/ai.py` where the rotation state was lost (e.g., a `for key in keys: ... break`-prefix change), and restore the original control flow.

## Capabilities

### Modified Capabilities
- `api-ai-stream`: AI streaming endpoint with OpenRouter provider now correctly rotates keys on 429 and emits the expected SSE event sequence.

## Impact

- **Web API**: `web_runner/routes/ai.py::_post_to_openrouter` (or equivalent streaming entry point); likely 1-5 lines of fix
- **AI panel frontend**: No changes — `src/Components/AiPanel/` contract unchanged
- **CLI**: No CLI changes (CLI does not call the streaming endpoint)
- **Tests**: `tests/test_stream_openrouter.py` — 8 tests start passing; the 7 already-passing tests stay
- **Mocks**: If mock-signature drift, also update `tests/test_ai_routes.py` if it shares the same fixture pattern
