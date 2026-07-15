# SSE-Route Testing Gotchas

> Runbook for the **headline trap** (a dev-env var that silently bypasses the patched `login_fn`) and the **sibling gotchas** that bite you the first time you write or run an integration test against a `web_runner/routes/*.py` SSE endpoint. If your SSE-route test "hangs forever, only emits an SVG-mock QR + infinite `: keepalive`", start here — you've hit the trap, not a regression.

## Why this exists

The SSE login route (`web_runner/routes/accounts.py::login_account_sse`) has two code paths that look identical from the test-client side but are reachable **only** from one path at a time:

1. **Real path** — route imports `cli.platforms.douyin` (and 6 siblings) inside a daemon thread, captures the uploader's `qrcode_callback` events into a `queue.Queue`, and streams them as `event: qrcode\ndata: ...\n\n` SSE frames. This is the path your `patch("cli.platforms.douyin.login", ...)` is asserting against.
2. **Mock path** — when the dev-env var `SAU_MOCK_AUTHORIZE=true` is set, the same route **short-circuits before the thread even starts**: it returns a synthetic SVG QR (`data:image/svg+xml;base64,...`) as the first `event: qrcode` frame, then enters an infinite `: keepalive\n\n` loop. The daemon thread is never spawned, so the `cli.platforms.*.login` import never runs and your patched function is **never reached**.

The mock path exists as a **manual-dev affordance** (`SAU_MOCK_AUTHORIZE=true` in `.env.example`) so an operator can exercise the full QR dialog flow in the browser without spinning up patchright/Chromium. It is **not** intended to be enabled during automated tests — yet because pytest (and standalone `python debug_*.py` scripts) inherit the dev-shell environment by default, a test that mounts a fake against `cli.platforms.douyin.login` silently exercises the mock path and hangs.

The 2026-07-11 debugging session that found this: `tests/test_sau_login_sse_qrcode.py` hung indefinitely on a dev box that had `SAU_MOCK_AUTHORIZE=true` exported in the shell. Symptom was "route returns 200, stream starts emitting frames, but they are the SVG mock — patched function never invoked". The fix-stack: harden the test fixture with `monkeypatch.delenv("SAU_MOCK_AUTHORIZE", raising=False)`; harden standalone debug scripts with `os.environ.pop(...)`; **never** loosen the mock short-circuit in the route itself, because it serves a real operator-facing dev need.

## Prereqs

- Running `social-auto-upload` `.venv` with `uv pip install -e .` (matches the test-invocation path the route thread uses).
- Flask test client (`app.test_client()` or `pytest` + `create_app()`) — the route's `Response(generate(), mimetype="text/event-stream", ...)` streams via Flask's WSGI iterator, which the test client surfaces as a chunked iterable.
- `pytest` ≥ 7 with `monkeypatch` (already in the dev-deps).
- For interactive debug scripts: standalone Python with the project on `sys.path` (mirrors `debug_sse_test.py`'s `sys.path.insert(0, str(Path(__file__).resolve().parent))`).

## The headline trap: `SAU_MOCK_AUTHORIZE`

### Symptom (the 1-click diagnosis)

The SSE test client's stream looks like this on the mock path:

```
b": " + 4096 spaces + b"\n\n"                           ← anti-proxy-buffer preamble
b"event: qrcode\ndata: {"image_path":"","image_data_url":"data:image/svg+xml;base64,PHN2ZyB4...}\n\n"   ← SVG mock, NOT your stub
b": keepalive\n\n", b": keepalive\n\n", ...           ← infinite loop
```

The base64 payload decodes to the literal `<svg ...><rect ...><text>douyin QR Mock</text></svg>` — distinct from any uploader helper's `data:image/png;base64,...` payload.

If you see **any** of these, you have the dev-env var inherited and the test is exercising the mock short-circuit:

1. The `image_data_url` payload starts with `data:image/svg+xml;base64,` (uploader helpers always emit `data:image/png;base64,`).
2. The stream contains `: keepalive\n\n` lines (the mock's per-connection interruptible sentinel queue; the real route emits `event: ping\ndata: {"ts": "..."}\n\n`).
3. `mock_login.assert_called_once()` (when `side_effect=`) or your `fake_douyin_login()` print never fires in the worker thread — there is no worker thread on the mock path.

### Fix patterns

For **pytest fixtures**, neutralize the env var before `create_app()` runs:

```python
@pytest.fixture
def app(monkeypatch, tmp_path):
    # SAU_MOCK_AUTHORIZE=true short-circuits the SSE route to a synthetic
    # SVG QR + infinite keepalive, bypassing the patched login_fn the test
    # is asserting on. Make the test independent of the dev-shell env so
    # it passes deterministically in CI and on dev boxes that have this
    # flag exported.
    monkeypatch.delenv("SAU_MOCK_AUTHORIZE", raising=False)
    monkeypatch.setenv("SAU_AUTH_ENABLED", "false")
    monkeypatch.setattr(wr_utils, "COOKIES_DIR", tmp_path / "cookies")
    # ... (rest of the fixture)
```

Why `raising=False`? `monkeypatch.delenv` raises by default if the var is not in the environment (e.g. a CI runner that never set it). `raising=False` makes the call a no-op in that case — exactly what we want for "neutralize if present, don't care otherwise".

For **standalone debug scripts**, neutralize inline before the test client call:

```python
def main():
    import os
    os.environ["SAU_AUTH_ENABLED"] = "false"
    # SAU_MOCK_AUTHORIZE=true short-circuits the SSE route to return a
    # synthetic SVG QR + infinite keepalive, bypassing the patched login_fn.
    os.environ.pop("SAU_MOCK_AUTHORIZE", None)
    # ... (rest of the script)
```

For **CI configuration**, ensure the runner has `SAU_MOCK_AUTHORIZE` unset (or explicitly `false`). Most CI systems do not inherit the developer's shell env by default, but on self-hosted runners with `env: ALL_PROXY=...`-style passthroughs this can leak — verify with `env | grep SAU_MOCK` in the workflow's setup step.

### Why we don't fix this in the route

You might think "let's just always call the real path in tests" — but that would break the **very feature** the mock exists to support: an operator manually exercising the QR dialog in the browser without spin-up cost. The right boundary is **the test** (or the dev script), not the route. Document the trap, harden every fixture that mounts a fake, and move on.

## Sibling gotchas (other SSE-route hazards)

These will bite the next person writing an integration test against an SSE endpoint. None of them have been a mystery in the same way as `SAU_MOCK_AUTHORIZE`, but each costs a debug session the first time.

- **Mock path loops forever** (no terminal event ever emits, by design so the browser EventSource doesn't fire `onerror` before the qrcode event arrives). Always break on `event: result` / `event: error`, not byte counts — and clip with a hard timeout or chunk-count ceiling. See the byte-level fingerprints in [The headline trap: `SAU_MOCK_AUTHORIZE`](#the-headline-trap-sau_mock_authorize) §Symptom for the `: keepalive` vs `event: ping` distinguisher.

### Patched function vs `asyncio.run` — sync vs async mismatch

The route's `_run_login` does `result = asyncio.run(login_fn(account, headless=headless, qrcode_callback=_qrcode_callback))`. If `login_fn` (your patched version) is a **synchronous** function, `asyncio.run(login_fn(...))` raises `TypeError: a coroutine was expected, got dict` — caught by the route's exception handler, which puts a `{"event": "result", "data": {"success": False, "message": "a coroutine was expected..."}}` frame into the queue. The stream will terminate normally; the test can read the failure and assert against it.

If you want your fakes to match the real `async def login(...)` signature (preferred for downstream code that `await`s the result), use `side_effect=` with an `async def` function — `patch` correctly auto-detects an async target and wraps the side_effect in an `AsyncMock` semantic (the returned `mock_login` has `assert_called_once`).

If you use `new=` (not `side_effect=`) with a sync function, `mock_login` is **the raw function**, not a Mock — `mock_login.assert_called_once()` will raise `AttributeError`. Either switch to `side_effect=` (keeps Mock methods) or remove the assertion and rely on the in-thread log to prove the patch was reached.

### Drain ordering and chunk-size inspections

Flask's test-client response chunks are not guaranteed to align to SSE frame boundaries. A 4100-byte preamble chunk + a 416-byte `event: qrcode\ndata: {...}\n\n` chunk is a common shape (the 416-byte chunk on the mock path is `data:image/svg+xml;base64,<svg>`, longer than the typical ~100-byte uploader payload). Always:

1. Iterate `response.response` (don't `.get_data()` — that consumes everything into one buffer and obscures the chunked emission).
2. Break only on terminal **events** (`event: result` / `event: error`), not on byte counts. SSE comments (`: keepalive`) don't count as events.
3. Parse frames post-hoc with `_parse_sse_frames(raw_bytes)` — see `tests/test_sau_login_sse_qrcode.py::_parse_sse_frames` for the reference implementation.

### Auth-gating on SSE endpoints

The login SSE route is gated by `_is_auth_enabled()` + `authenticate_sse_request(request)` (see `web_runner/routes/auth.py`). When `SAU_AUTH_ENABLED=true` (default), a missing or invalid session cookie returns `401 {success: false, message: "未登录"}` — **not a streaming response**, so a test client expecting chunks will get a one-shot JSON error. Always set `monkeypatch.setenv("SAU_AUTH_ENABLED", "false")` in the fixture when testing the route's streaming behavior; toggle it explicitly when testing the auth path itself.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| SSE test hangs forever; only `: keepalive\n\n` frames after preamble | `SAU_MOCK_AUTHORIZE=true` inherited from dev shell; route short-circuits to mock path before daemon thread starts | Add `monkeypatch.delenv("SAU_MOCK_AUTHORIZE", raising=False)` to the test fixture; add `os.environ.pop("SAU_MOCK_AUTHORIZE", None)` to standalone debug scripts |
| `event: qrcode` frame payload starts with `data:image/svg+xml;base64,` and decodes to `<svg>...<text>douyin QR Mock</text></svg>` | Same as above — the mock path is being exercised; the patch never reached the worker thread | Same as above |
| `mock_login.assert_called_once()` raises `AttributeError: 'function' object has no attribute 'assert_called_once'` | Patch used `new=fake_func` (raw function bound as `mock_login`); `assert_called_once` only exists on `mock.MagicMock` returned by `side_effect=` patches | Switch to `side_effect=fake_func` (keeps Mock methods), or drop the assertion and verify via the in-thread log instead |
| Stream drains but the `result` event has `success: false, "a coroutine was expected, got dict"` | Your `fake_douyin_login` is sync but the route calls `asyncio.run(login_fn(...))`; sync return value → `TypeError` → caught → `result` event with the wrapper's error message | Either make `fake_douyin_login` an `async def` (matches real signature), or accept the `success: false` in your test's terminal-event assertion |
| Stream returns `401 {"success": false, "message": "未登录"}` immediately | `SAU_AUTH_ENABLED=true` (default); the SSE gate's `authenticate_sse_request` rejects the unauthenticated request | `monkeypatch.setenv("SAU_AUTH_ENABLED", "false")` in the fixture; or for auth-path tests, mint a valid session cookie and pass via `client.set_cookie(...)` |
| Test passes locally with `SAU_MOCK_AUTHORIZE=false`, fails on CI with the same code | CI runner has `SAU_MOCK_AUTHORIZE=true` exported (rare; usually leaked via `env: ...` passthroughs) | Verify with `env \| grep SAU_MOCK` in the workflow setup step; explicitly `unset` if needed |
| `: keepalive` frames after a real uploader `event: result` terminal frame | The mock path's keepalive loop and the real path's terminal frame use different generators; not all test-client chunk boundaries align | Break on `event: result` / `event: error`, not on byte counts; parse post-hoc with `_parse_sse_frames` |

## Cross-references

- `web_runner/routes/accounts.py::login_account_sse` — the SSE route; line ~255 maps to `GET /api/accounts/login/sse`. The mock short-circuit is at the top of that function (`if os.environ.get("SAU_MOCK_AUTHORIZE", "").lower() == "true":`), gated before `_run_login`'s daemon thread.
- `tests/test_sau_login_sse_qrcode.py` — reference integration test that hardens the fixture against `SAU_MOCK_AUTHORIZE` via `monkeypatch.delenv`. Mirror this pattern in every new SSE-route test.
- `debug_sse_test.py` (repo root) — standalone debug script that hardens against the env var via `os.environ.pop`; useful template when writing throwaway debug scripts for new SSE routes.
- `.env.example` §8 — definition + comment for `SAU_MOCK_AUTHORIZE=true` → "real platform credentials"; explains why this dev affordance exists and why tests must opt out.
- `docs/dev/public-inbox-ops.md` §Troubleshooting — sibling docs-dev runbook with the same structure (Why this exists / Prereqs / body / cross-refs / Hub backlink); mirror for new dev ops docs.
- `docs/dev/INDEX.md` — dev-docs hub; this file is registered under the Contributors table.
- **Hub**: [docs/dev/INDEX.md#contributors](docs/dev/INDEX.md#contributors) — Contributors (writing code, merging PRs).
