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

## CI (`.github/workflows/ci.yml`)

1. `ruff check .` — Python lint
2. `pytest tests/ -x -q` — Python tests (with real PostgreSQL service)
3. `npx tsc -b` + build — frontend typecheck + build
4. `vitest run` on 5 core specs — routing, auth, page chrome, inbox
5. `tsc-ratchet-gate` — error count must not exceed baseline
6. `openspec-stub-gate` — delta-format stub count ratchet
7. `docs-discoverability-audit` — doc structure contract
