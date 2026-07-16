# AGENTS.md

## Quick start

```bash
bash sau_web/start.sh   # starts Flask :6001 + Vite :5180, logs to .sau-logs/
```

## Architecture

- **Python backend**: Flask app in `run.py` → `web_runner/`. API routes in `web_runner/routes/`. DB: PostgreSQL via `DATABASE_URL` env var. Auto-creates schema on first run.
- **Frontend**: Single React + Vite app at `sau_web/frontend/`. Port 5180. Serves both marketing landing (`/`) and Web Shell dashboard (`/dashboard/*`). Vite proxies `/api/*` to Flask.
- **CLI**: `sau_cli.py` / `cli/` package. Entry point `sau` registered via `pyproject.toml [project.scripts]`.
- **Legacy**: `sau_backend.py`, `sau_backend/`, `sau_frontend/` are removed/historical. Don't touch.

## Python (backend + CLI)

```bash
uv pip install -e .          # core deps
uv pip install -e ".[web]"   # + Flask, psycopg, edge-tts, etc.
uv pip install -e ".[dev]"   # + pytest, ruff, black, isort

patchright install chromium   # browser driver (use PLAYWRIGHT_DOWNLOAD_HOST for China mirror)
```

Lint: `ruff check .`
Test: `pytest tests/ -x -q`
Line length: 120 (black + ruff)

## Frontend

```bash
cd sau_web/frontend
npm install
npm run dev       # Vite dev server on :5180
npx tsc --noEmit  # typecheck (NOT tsc -b — use --noEmit for single-file changes)
npx vitest run    # unit tests
npm run lint      # eslint
```

CI runs `tsc -b` with a ratchet gate (current baseline in `docs/tsc-error-baseline.txt`). Don't increase the error count without updating the baseline.

## Key gotchas

- **dnd-kit v0.5.0** (`@dnd-kit/react`): `useDroppable` returns `isDropTarget` (not `isOver`). `useSortable` already makes items both draggable + droppable. For cross-type hover detection, use `useDragDropMonitor` with `onDragOver`/`onDragEnd` — don't try to attach a separate `useDroppable` ref to an element already wrapped by `useSortable`.
- **`mutateAsync` vs `mutate`**: React Query's `mutateAsync` only takes variables — no options object as 2nd arg. Use `.catch()` for error handling, not `onError` callback.
- **Test mocks**: Account test files mock `@/hooks/useAccountGroups` — any new hook (e.g. `useMoveAuthorization`) must be added to the mock or tests crash with "No export is defined".
- **`@dnd-kit/react` vs `@dnd-kit/sortable`**: The project uses `@dnd-kit/react` (v0.5.0), not the older `@dnd-kit/sortable` v4. Imports: `useDraggable`/`useDroppable` from `@dnd-kit/react`, `useSortable` from `@dnd-kit/react/sortable`.
- **PostgreSQL only**: `DATABASE_URL` is required. Default in `start.sh`: `postgres:///sau`. The `db.py` `_translate_placeholders()` converts `?` to `%s` for psycopg — use `?` in SQL, not `%s` directly.
- **Auth in dev**: `start.sh` sets `SAU_AUTH_ENABLED=false` by default. Production requires it.
- **JSX `data-testid` emission works under both `@vitejs/plugin-react` (Babel) and vite production builds — DO NOT chase parser-trap fixes if `getByTestId` returns 0 matches.** A 7-round chase in `round-OPT-sentiment-card-testid` (documented at [`docs/dev/jsx-testid-parsing.md`](docs/dev/jsx-testid-parsing.md)) proved the parser wasn't the issue — see the **mock-state remediation** bullet below.
- **For tests where the fetch gates downstream state, prefer `mockResolvedValue(...)` (persistent) over `mockResolvedValueOnce(...)` — but only if the hypothesis applies.** Self-verify in 5 minutes: add `console.log(apiX.mock.calls.length)` inside the component's `useEffect` for one failing test. If `> 1`, you have the same symptom constellation as the `round-OPT-sentiment-card-testid` saga — switch the mock. If `=== 1`, you've hit a different bug; revert and keep digging. If `=== 0`, your fetch never fired — likely a `useQuery({ enabled: false })` short-circuit or a query-cache hit; inspect React Query state. Full reasoning + caveats at [`docs/dev/jsx-testid-parsing.md`](docs/dev/jsx-testid-parsing.md) §"Hypothesised root cause". The persistent-over-once rule's full convention + migration catalogue (Appendix A) lives at [`docs/dev/test-mocking-conventions.md`](docs/dev/test-mocking-conventions.md) — adopt the convention when adding new fetch-gating tests; consult the catalogue before sending a migration PR.


## Operations tunables (SAU_HEALTH_* + SAU_COOKIE_STALE_HOURS)

账号健康监控 env var 表在[`docs/install.md` §11](docs/install.md) 环境变量段（5 列：var / default / range / 调优位置 / 说明）。on-call 调阈值 / debug cookie stale / 解释反复 expiring_soon 时，先 **grep -E 'SAU_(HEALTH|COOKIE_STALE)'** 命中 `docs/install.md` 的环境变量表 + `web_runner/{utils,health_monitor}.py` 模块级常量行。

env 改动必须重启 Flask 进程（Python 模块级常量在 import 时一次性读取，不监听 SIGHUP）；跨 knob 的语义细节（ORTHOGONAL TRIGGERS / `_clamp_health_retries` 硬夹）见 install.md 表格下方的「互相关系」段。

通知通道 env vars（4 个 `SAU_*_WEBHOOK_URL` / 亅底 `SAU_WEBHOOK_URL` / `SAU_SMTP_*` / reserved `SAU_HEALTH_WEBHOOK_URL` 座位）同在 [`docs/install.md` §11 环境变量表](docs/install.md#11-account-health-monitoringaccount-health-monitoring) 表里；`grep -E 'SAU_(HEALTH|COOKIE_STALE|.*_WEBHOOK_|SMTP)'` 一次命中账号健康度 + 通知通道 + SMTP 三套参数。 `openspec/changes/account-health-monitoring/design.md[D3]` 中领会的独立 `SAU_HEALTH_WEBHOOK_URL` 名只上车预留口径，实际源用中 `web_runner/notifications.py` 的 4 个 `SAU_*_WEBHOOK_URL` 代替。

## CI (`.github/workflows/ci.yml`)

1. `ruff check .` — Python lint
2. `pytest tests/ -x -q` — Python tests (with real PostgreSQL service)
3. `npx tsc -b` + build — frontend typecheck + build
4. `vitest run` on 5 core specs — routing, auth, page chrome, inbox
5. `tsc-ratchet-gate` — error count must not exceed baseline
6. `openspec-stub-gate` — delta-format stub count ratchet
7. `docs-discoverability-audit` — doc structure contract
