# Web Shell architecture lock

| Field | Value |
|-------|-------|
| **Status** | **LOCKED** — 2026-07-23 |
| **Audience** | Contributors |

## Why this exists

The branch was named `migration/tanstack-start-2026q3` and ticket docs discuss TanStack Start / SSR. That path is **stopped**. Landing point is **TanStack Router SPA + Python Flask API**.

## Locked decisions

1. **Frontend stack**: Vite + React 19 + `@tanstack/react-router` file routes under `sau_web/frontend/app/routes/`.
2. **Not in scope**: `@tanstack/react-start`, `tanstackStart()` Vite plugin, SSR entry (`ssr.tsx` / `StartClient`), `createServerFn` wrapping Flask.
3. **Backend**: Flask `web_runner.py` owns `/api/*`. Browser axios talks to Flask (dev proxy or same origin in prod).
4. **HTTP client**: **one** axios instance in [`sau_web/frontend/src/api/request.ts`](../../sau_web/frontend/src/api/request.ts). `client.ts` re-exports it and builds the `api.*` barrel. Do not add a second `axios.create`.
5. **Path casing**: `src/components/` and `src/pages/` (all lowercase). Imports use `@/components/...` and `@/pages/...` only — never mixed `@/Components` / `@/Pages` (breaks Linux CI).
6. **Package manager**: **npm** + `package-lock.json` only (no `pnpm-lock.yaml` in this tree).

## When to revisit Start

Only if product needs public SEO / OG for marketing pages, or a deliberate Node BFF. Then consider **thin** Start (public routes only), not full server-fn migration of upload/accounts.

## Cross-references

- Hub: [docs/dev/INDEX.md](INDEX.md)
- Ops surface: [docs/web-shell.md](../web-shell.md)
- Frontend README: [sau_web/frontend/README.md](../../sau_web/frontend/README.md)
- Historical Start tickets remain under `second-batch-tickets/` as post-mortems, not active roadmap.
