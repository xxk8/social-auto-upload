## ADDED Requirements

### Requirement: SSE error contract on missing or invalid account

The system SHALL return structured HTTP 4xx errors (not SSE `event: error`) when `/api/crawl/search-stream` is called without a valid `account` group. The 401 contract SHALL be `{success: false, code: "missing_account", message: <platform-specific hint>, redirect_url: "/app/accounts"}`. The 400 contract (account name provided but the group has no authorization for the platform) SHALL be `{success: false, code: "account_not_found", message: <hint>, redirect_url: "/app/accounts"}`. The Frontend SHALL be able to render the error message and (optionally) navigate to `redirect_url` without parsing the `message` string.

#### Scenario: 401 missing_account when account field is omitted

- **GIVEN** the user is authenticated and a valid platform (e.g. `"dy"`) and keyword (e.g. `"美食"`) are sent
- **AND** the `account` field is omitted from the request body
- **WHEN** `POST /api/crawl/search-stream` is called
- **THEN** the system SHALL return HTTP 401
- **AND** the response body SHALL be `{"success": false, "code": "missing_account", "message": "search-stream requires an authorized account for platform 'dy'; please add one at /app/accounts and retry", "redirect_url": "/app/accounts"}`
- **AND** the `message` SHALL include the platform short name (e.g. `'dy'`) so the user knows which platform to add auth for
- **AND** the route SHALL NOT acquire the streaming semaphore (the 401 fails fast before the semaphore `acquire(blocking=False)` call)

#### Scenario: 401 missing_account when account is empty string

- **GIVEN** the user is authenticated
- **WHEN** `POST /api/crawl/search-stream` is called with `"account": ""`
- **THEN** the system SHALL return HTTP 401 with `code: "missing_account"` (same as omitted)
- **AND** the Frontend's `readSSEStream` non-2xx path SHALL extract `errBody.message` and call `handlers.onError(message)` so the user sees the backend's hint in the dashboard task list

#### Scenario: 400 account_not_found when group has no platform authorization

- **GIVEN** the user is authenticated
- **AND** `account: "my-group"` is provided
- **AND** the `account_authorizations` join shows `my-group` has no authorization for the requested platform (e.g. `"dy"`)
- **WHEN** `POST /api/crawl/search-stream` is called
- **THEN** the system SHALL return HTTP 400 with `code: "account_not_found"`
- **AND** the response SHALL include `redirect_url: "/app/accounts"` so the Frontend can offer a "go add auth" action

#### Scenario: 200 SSE proceeds when account is valid

- **GIVEN** the user is authenticated
- **AND** `account: "my-group"` is provided
- **AND** `my-group` has a valid `dy` authorization (cookie file exists on disk)
- **WHEN** `POST /api/crawl/search-stream` is called with `{"platform": "dy", "keyword": "美食", "account": "my-group", "max_count": 20}`
- **THEN** the system SHALL return HTTP 200 with `Content-Type: text/event-stream`
- **AND** the route SHALL acquire the streaming semaphore (default value 3, env `SAU_STREAM_CONCURRENCY`) before launching the crawler
- **AND** rows are emitted as `event: platform_result` followed by a final `event: done`
- **AND** the semaphore is released in the `finally` block (even on crawler exception)

### Requirement: Asyncgen cleanup sequencing before loop.close()

The system SHALL drive `gen.aclose()` on a still-alive asyncio loop BEFORE calling `loop.close()`, so Python 3.12+'s `BaseEventLoop.close()` auto-asyncgen-sweep finds `_asyncgens` empty. The `loop.close()` call itself SHALL be wrapped in `try/except Exception` (symmetric to the `gen.aclose()` wrap) and any teardown-race exception SHALL be logged at `debug` level only. The system SHALL NOT propagate a `loop.close()` exception to the SSE caller (the route's `except Exception` would otherwise turn the cleanup artifact into a spurious `event: error` even though the data was already streamed successfully).

#### Scenario: explicit aclose runs before loop.close on natural exhaustion

- **GIVEN** a `_run_async_gen` async generator finishes naturally (StopAsyncIteration)
- **WHEN** the sync generator's `finally` block runs
- **THEN** the system SHALL call `loop.run_until_complete(gen.aclose())` BEFORE `loop.close()`
- **AND** the held patchright `Browser` SHALL be closed via the `async with self._open_browser_session() as context:` `__aexit__` chain during the `gen.aclose()` pass
- **AND** Python 3.12+'s `loop.close()` auto-asyncgen-sweep SHALL find `_asyncgens` empty (no `aclose()` calls on pending asyncgens)
- **AND** the sync generator's `close()` method SHALL return normally without raising

#### Scenario: loop.close AttributeError is swallowed (production fix)

- **GIVEN** the held patchright `Browser` is closed via the explicit `gen.aclose()` pass
- **AND** `loop.close()` auto-asyncgen-sweep hits a remaining patchright `Browser`-like object that lacks `aclose()`
- **WHEN** the `finally` block runs
- **THEN** the system SHALL catch the `AttributeError("'Browser' object has no attribute 'aclose'")` exception
- **AND** SHALL log it at `debug` level: `"event loop close raised during _run_async_gen teardown: 'Browser' object has no attribute 'aclose'"`
- **AND** SHALL NOT propagate the exception to the sync generator's caller (the SSE route)
- **AND** the SSE stream SHALL complete normally with a final `event: done` (or the `event: error` for the original crawler exception, whichever applies)

#### Scenario: SSE disconnect mid-stream triggers cleanup without spurious error

- **GIVEN** a `_run_async_gen` stream is mid-flight (e.g. yielded row 1 of 5)
- **WHEN** the SSE client disconnects (Flask calls `gen.close()` on the route's `generate()`)
- **THEN** `GeneratorExit` propagates down the `yield from` chain into `_run_async_gen`
- **AND** the `finally` block's explicit `gen.aclose()` runs the held `Browser.close()` cleanly
- **AND** the `loop.close()` `try/except` swallows any teardown race exception
- **AND** the held `Browser` SHALL be closed (no zombie Chromium processes)
- **AND** the streaming semaphore SHALL be released in the route's `finally` block

### Requirement: SSE concurrency limit via semaphore

The system SHALL enforce a server-side concurrency limit on `/api/crawl/search-stream` so a single authenticated user (or a small group) cannot exhaust worker threads / DB connections by opening N concurrent SSE streams. The default semaphore size SHALL be 3, overridable via the `SAU_STREAM_CONCURRENCY` environment variable. The semaphore SHALL be acquired BEFORE the crawler launches and released in the route's `finally` block (so a `crawler.search_stream()` exception does not leak the slot). When the semaphore is exhausted, the system SHALL return HTTP 429 with a `Retry-After: 5` header.

#### Scenario: semaphore is acquired before crawler launches

- **GIVEN** the user is authenticated and the request passes the 401/400 validations
- **WHEN** `POST /api/crawl/search-stream` is called
- **THEN** the route SHALL call `_STREAM_SEMAPHORE.acquire(blocking=False)` BEFORE instantiating the crawler
- **AND** if the acquire succeeds, the crawler SHALL launch inside `Response(generate(), ...)`
- **AND** if the acquire fails, the route SHALL return HTTP 429 with `Retry-After: 5`

#### Scenario: semaphore is released in finally on success

- **GIVEN** the crawler streams all rows and yields `event: done` naturally
- **WHEN** the `generate()` function exits
- **THEN** the `finally` block SHALL call `_STREAM_SEMAPHORE.release()`
- **AND** the released slot SHALL be available for the next request

#### Scenario: semaphore is released in finally on crawler exception

- **GIVEN** the crawler's `search_stream()` raises `RuntimeError("simulated crawler crash")`
- **WHEN** the route's `generate()` catches the exception and emits `event: error`
- **THEN** the `finally` block SHALL still call `_STREAM_SEMAPHORE.release()`
- **AND** the slot SHALL be available for the next request (no permanent semaphore leak)

#### Scenario: SAU_STREAM_CONCURRENCY env var overrides default

- **GIVEN** the environment variable `SAU_STREAM_CONCURRENCY=10` is set
- **WHEN** Flask starts up
- **THEN** the `_STREAM_SEMAPHORE` SHALL be a `threading.Semaphore(10)`
- **AND** an invalid (non-integer) value SHALL log a warning and fall back to the default 3
- **AND** a value < 1 SHALL be clamped to 1 via `max(1, int(raw))`
