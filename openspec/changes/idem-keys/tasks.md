# round-OPT-idem-keys — Idempotency-Key Contract (防止 tab 关闭后重试重复发布)

> **Status: mergeable** — all implementation + tests + docs complete; **14/14 contract tests passing in 0.78s** (`tests/test_idempotency_contract.py`); `docs/web-shell.md` §"Idempotency-Key 契约" published.
>
> **Round goal**: tab close mid-upload + reopen + retry must NOT create a duplicate publish. The client generates a UUID per publish intent, sends it as the `Idempotency-Key` request header, and the backend caches the response keyed by `(user_id, route, key)`.
>
> **Test command** (requires local PG):
> ```bash
> DATABASE_URL=postgres://... .venv/bin/python -m pytest tests/test_idempotency_contract.py -v
> ```
>
> **See also**:
> - `docs/web-shell.md` §"Idempotency-Key 契约（防止 tab 关闭后重试重复发布）" — the user-facing contract documentation (5-scenario table, 测试覆盖 sub-section, 5xx trade-off rationale). One-click from this tasks.md to the doc, and vice-versa.
>
> **Known followups** (not blocking merge):
> - Fix the pre-existing psycopg dict-adaptation bug in `web_runner/notifications.py` so the test fixture can drop the `start_worker` + `emit_event` mock + TODO comment (in the `client` fixture of `tests/test_idempotency_contract.py`).
> - Investigate the patchright Node.js EPIPE error that cascades from unhandled exceptions during Flask test client teardown — the 5xx test's `NameError` was masked as EPIPE. A cleaner teardown path would surface the real Python error immediately.

## 1. DB Schema (Web API / Database)

- [x] 1.1 `web_runner/db.py:_SCHEMA` 加 `idempotency_keys` 表 — composite PK on `(user_id, route, key)` + columns: `payload_hash`, `state` (`'processing'` / `'completed'`), `response_status`, `response_body`, `response_headers` (JSON), `task_id`, `expires_at`, `created_at`.
- [x] 1.2 `web_runner/db.py:init_db()` 加 partial index `idx_idempotency_keys_expires` on `(expires_at) WHERE state='completed'` so the janitor sweep stays O(few) regardless of table size.

## 2. 后端 — Idempotency Helper 模块 (Web API)

- [x] 2.1 新建 `web_runner/idempotency.py` — module docstring documents the 5-scenario contract (replay / 409 / 422 / no-key / 5xx trade-off) and references the Stripe-style protocol.
- [x] 2.2 `payload_hash(parts)` — SHA-256 hex over a stable, ordered list of route-specific signature parts. Plain strings / dicts / lists; dicts + lists go through `repr()` for deterministic stringification.
- [x] 2.3 `lookup(user_id, route, key, payload_hash_value)` — returns `("replay", cached)` / `("conflict-422", None)` / `("inflight-409", None)` / `None`. Same hash + `state='completed'` → replay; different hash → 422; `state='processing'` → 409; no row → `None`.
- [x] 2.4 `claim(user_id, route, key, payload_hash_value)` — atomic `INSERT ... ON CONFLICT (user_id, route, key) DO NOTHING` via PG. Returns `True` if newly inserted, `False` if row already existed. Uses `datetime.now(timezone.utc)` for the `expires_at` default (round-2 hotfix: timezone symmetry with `complete()`'s `CURRENT_TIMESTAMP + INTERVAL '7 days'`).
- [x] 2.5 `complete(user_id, route, key, response_body, response_status, response_headers, task_id)` — `UPDATE ... SET state='completed'` with the cached body + status + headers + task_id. JSON-encodes the headers dict.
- [x] 2.6 `release(user_id, route, key)` — `DELETE ... WHERE state='processing'` (only deletes processing rows; concurrent retries that already promoted to `completed` are left alone). Best-effort: `try/except: pass`.
- [x] 2.7 `cleanup_expired()` — janitor sweep: `DELETE ... WHERE expires_at < CURRENT_TIMESTAMP`. Returns rowcount. Logs on error. Covered by partial index `idx_idempotency_keys_expires`.
- [x] 2.8 `check_and_claim(user_id, route, key, payload_hash_value)` — combined lookup + claim. Returns a `Response` (replay / 409 / 422) if caller should return early, or `None` to proceed. Two-step (lookup → claim → re-lookup) so concurrent requests resolve deterministically.
- [x] 2.9 `finalize(user_id, route, key, response, task_id)` — called immediately before route returns. 2xx → `complete()` (cache body + status + headers for replay); 4xx + 5xx → `release()` (user-recovery-over-dedup trade-off). Docstring captures the 5xx rationale.
- [x] 2.10 `make_replay_response(cached)` — `Response(body, status=..., mimetype='application/json')` + restored headers + `Idempotency-Replayed: true` marker. Round-2 hotfix: `mimetype='application/json'` pinned explicitly (Flask defaults to `text/html`); header-drop log warning if a cached header can't be set.

## 3. 后端 — 6 Routes Wired (Web API)

All 6 protected routes follow the same 3-step dance: **read key → check_and_claim (early return on replay / 409 / 422) → finalize on the terminal response**. `payload_hash` is route-specific:

- [x] 3.1 `web_runner/routes/upload.py:upload_video` — multipart signature `(platform, account, title, file_name, file_size, file_mime)`. Claim after validation, release on 2 post-claim 4xx (file too small / no file_path), finalize on 2xx.
- [x] 3.2 `web_runner/routes/upload.py:upload_note` — multipart signature `(platform, account, title, image_count, image_total_size, image_names_joined)`. Claim after image save, release on 2 post-claim 4xx (no saved_images / platform not in NOTE_PLATFORMS), finalize on 2xx.
- [x] 3.3 `web_runner/routes/tasks.py:add_task` — JSON signature `[json.dumps(payload, sort_keys=True)]`. Claim before task row insert, release on images-required 4xx, finalize on 2xx.
- [x] 3.4 `web_runner/routes/tasks.py:retry_task` — single-key signature `[task_id]`. Claim after argv parse, release on 2 post-claim 4xx (no stored_argv / invalid stored_argv), finalize on 2xx.
- [x] 3.5 `web_runner/routes/tasks.py:reschedule_task` — signature `[task_id, new_scheduled_at]`. Claim after datetime parse, release on 4 post-claim 4xx (task_id missing / task not found / task not pending / invalid datetime / past datetime), finalize on 2xx.
- [x] 3.6 `web_runner/routes/tasks.py:copy_task` — same signature as reschedule. Claim after datetime parse, release on 4 post-claim 4xx, finalize on 2xx.

## 4. 前端 — Idempotency-Key 注入 (Frontend)

- [x] 4.1 新建 `sau_web/frontend/src/api/_idempotencyStore.ts` — localStorage-backed UUID store keyed by `(user_id, route)`. TTL 7 days matches backend cache TTL.
- [x] 4.2 Request interceptor: reads existing UUID from localStorage or generates a new one, injects as `Idempotency-Key` header for the 6 protected routes (`/api/upload/video`, `/api/upload/note`, `/api/tasks/add`, `/api/tasks/retry`, `/api/tasks/reschedule`, `/api/tasks/copy`).
- [x] 4.3 Response interceptor: clears the localStorage entry on 2xx / 4xx / 5xx (network error keeps the entry so a retry uses the same UUID). Symmetric with backend's `finalize()` 4xx+5xx → release branch.
- [x] 4.4 Direct ES import for `useAuthStore` (round-1 hotfix: replaced `require()` for circular-dep safety; matches the existing `_appendAuthPendingHeader.ts` pattern via Vite ES module hoisting).
- [x] 4.5 Test exports for the test harness: `_PROTECTED_ROUTES_FOR_TEST`, `_clearAllIdempotencyEntriesForTest` (underscore-prefixed convention).

## 5. 测试 — Contract Tests (CI-runnable)

`tests/test_idempotency_contract.py` — 14 tests, all passing in 0.78s. Requires `DATABASE_URL` (skips cleanly on SQLite-only CI).

- [x] 5.1 Helper-layer tests (9) cover all 6 core functions in `web_runner/idempotency.py`:
  - `test_payload_hash_deterministic_for_same_parts` + `test_payload_hash_includes_file_metadata` — `payload_hash()` determinism + multipart sensitivity (file_name / size / mime).
  - `test_lookup_returns_none_for_unknown_key` — `lookup()` on a fresh key.
  - `test_claim_succeeds_then_lookup_returns_processing` — `claim()` + `lookup()` chain.
  - `test_claim_conflict_returns_false_on_second_call` — `claim()` ON CONFLICT semantics.
  - `test_complete_promotes_to_replay` — `complete()` promotes state to `'completed'`.
  - `test_mismatch_returns_422` — `lookup()` returns `("conflict-422", None)` on hash mismatch.
  - `test_release_removes_processing_row` — `release()` drops the row.
  - `test_cleanup_expired_deletes_past_rows` — janitor sweep with backdated `expires_at`.
- [x] 5.2 E2E tests (5) walk the real `create_app()` + Flask test client + PG path. All use the `client` fixture (SAU_AUTH_ENABLED=false + notification mock) + the executor mock (so the background thread doesn't invoke the real CLI):
  - `test_no_key_header_passes_through_normally` — **场景 5** (未提供 key → 202 透传, no claim/lookup).
  - `test_2xx_replay_returns_cached_with_marker` — **场景 1 + 场景 2** (首次提交 + 重放). Strongest pin: `SELECT COUNT(*) FROM tasks WHERE task_id=...` must be 1 (replay must NOT insert a 2nd task row).
  - `test_409_on_concurrent_retry_with_same_key` — **场景 3** (并发重试 → 409 + Retry-After: 5 + NO Idempotency-Replayed header).
  - `test_422_on_key_with_different_payload` — **场景 4** (key + 不同 payload → 422).
  - `test_5xx_releases_key_for_retry` — **5xx trade-off** (500 → release → retry re-claims with new task_id, no Idempotency-Replayed). Counter-based mock of `_make_accepted_response` exercises the full `finalize()` branch path.
- [x] 5.3 Autouse fixture `_purge_test_keys` cleans up `idempotency_keys` rows where `key LIKE 'idem-test-%'` (round-3 hotfix: pre-round pattern matched on `route LIKE` and missed the e2e tests' real routes, leaking rows across runs).
- [x] 5.4 `client` fixture sets `SAU_AUTH_ENABLED=false` (round-2 hotfix: bypasses the Flask auth gate's 401 on `/api/*` for the e2e tests) + mocks `web_runner.notifications.start_worker` + `emit_event` to no-ops (works around a pre-existing psycopg dict-adaptation bug in `web_runner/notifications.py`; TODO comment documents the workaround).
- [x] 5.5 Narrow-catch convention in test cleanups: `except (psycopg.Error, OSError):` per the project convention (`web_runner/utils.py::_start_orphan_watchdog` uses the same shape).

## 6. 文档 (Docs)

`docs/web-shell.md` — new "Idempotency-Key 契约（防止 tab 关闭后重试重复发布）" section placed next to the existing "火象忽略 契约" sub-section.

- [x] 6.1 §"客户端使用" — frontend `_idempotencyStore.ts` auto-injects `Idempotency-Key` for the 6 protected POSTs. UUID 不需开发者手动生成, 跨 tab 关闭持久化 (localStorage, TTL 7 天).
- [x] 6.2 §"后端响应" — first-request + replay-request HTTP examples with the `Idempotency-Replayed: true` marker.
- [x] 6.3 §"5 个合约场景（全部已锁定）" — 5-scenario table (首次提交 / 重放 / 并发重试 / key+不同payload / 未提供key). The pre-round "4 个合约场景" heading was off-by-one (table has 5 rows).
- [x] 6.4 §"测试覆盖" sub-section — 14 tests mapped to the 5 scenarios + helper-layer coverage. The "全部已锁定" claim is fully defensible (round-3 hotfix: added a one-liner explicitly mapping the first request in `test_2xx_replay_returns_cached_with_marker` to 场景 1, since it was only implicitly covered).
- [x] 6.5 §"存储与 TTL" — PostgreSQL `idempotency_keys` table layout + payload_hash composition + 7-day TTL + janitor sweep via the partial index.
- [x] 6.6 §"5xx 语义（round-OPT-idem-keys 必需知道的 trade-off）" — user-recovery-over-dedup rationale (5xx → release so a retry can re-execute; the trade-off is "重复写文件 + 重复插任务行" on the next retry).

## 7. Hotfixes Applied (from code-reviewer passes)

All caught by 3 code-reviewer-minimax-m3 review passes. Each entry links back to the file + line where the fix was applied.

- [x] 7.1 `tests/test_idempotency_contract.py` — test toggle inversion fix (the original `test_422_on_key_with_different_payload` returned "second-hash" on the wrong call).
- [x] 7.2 `web_runner/idempotency.py:finalize` + `sau_web/frontend/src/api/_idempotencyStore.ts` — 5xx double-trap fix: backend `finalize()` now `release()`s on 5xx (was incorrectly `complete()`-ing, locking the key for 7 days on transient 5xx); frontend response interceptor now clears on 5xx (was keeping the entry).
- [x] 7.3 `sau_web/frontend/src/api/_idempotencyStore.ts` — `require('../features/auth/authStore')` replaced with a top-level `import { useAuthStore } from '../features/auth/authStore'`. Vite ES module hoisting handles the cycle.
- [x] 7.4 `web_runner/idempotency.py:claim` — timezone mismatch fix: `datetime.now(timezone.utc)` (was `datetime.now()` returning naive local time, mismatching `complete()`'s `CURRENT_TIMESTAMP + INTERVAL '7 days'`).
- [x] 7.5 `web_runner/idempotency.py:make_replay_response` — `mimetype='application/json'` explicitly pinned (Flask `Response` defaults to `text/html`).
- [x] 7.6 `web_runner/idempotency.py:make_replay_response` — log warning added for cached headers Flask refuses to set (e.g. control characters).
- [x] 7.7 `web_runner/routes/upload.py:upload_video` — duplicate `read_key_from_request()` call removed.
- [x] 7.8 `tests/test_idempotency_contract.py` — autouse fixture cleanup leak fix: `route LIKE '%_TEST_PREFIX%'` → `key LIKE 'idem-test-%'` (the old pattern missed the e2e tests' real routes `/api/tasks/add`).
- [x] 7.9 `tests/test_idempotency_contract.py` — `client` fixture now sets `SAU_AUTH_ENABLED=false` so the 2 e2e tests can reach the route logic past the Flask auth gate.
- [x] 7.10 `tests/test_idempotency_contract.py` — narrow-catch convention: `except (psycopg.Error, OSError):` (was `except Exception: pass`).
- [x] 7.11 `tests/test_idempotency_contract.py:test_5xx_releases_key_for_retry` — `db = get_database()` re-added before the cleanup block (was accidentally removed when the redundant direct DB check was dropped, causing a teardown `NameError` that cascaded into a patchright EPIPE).
