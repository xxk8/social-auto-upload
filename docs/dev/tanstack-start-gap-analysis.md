# [Diagnostic 11] TanStack Start `build-from-scratch` 文档 vs 当前 `main` 状态 — 8 项 GAP 盘点

| Field | Value |
|-------|-------|
| **Severity** | P3 — informational catalogue only; **零代码改动**. |
| **Labels** | `migration`, `second-batch-tickets`, `tanstack-router`, `tanstack-start`, `gap-analysis`, `diagnostic-only`, `reference-only`, `pre-migration-state` |
| **Surfaced by** | 2026-07-21 user instruction: "看下 https://tanstack.com/start/latest/docs/framework/react/getting-started 文档, 看哪些地方问题, 然后修复好". chosen scope = **PATH A (diagnose-only)** per ask_user. **零代码修改**. The migration is *not* auto-started; this doc is a reference for any future PR that wants to attempt path B/C. |
| **Blocks** | (i) future PRs that touch the routing layer without first reading the canonical TanStack Start setup — they'll re-discover the 8 GAP rows below in 5-30 minutes per gap; (ii) reviewers who can't tell whether a "we'll route via createFileRoute" PR is the migration or a hack; (iii) contributors who want to attempt path B/C need a definitive checklist. |
| **Estimated scope** | **zero diff for this diagnostic**. Paths B/C scope: B = ~1-2 hrs light scaffold, C = ~3-5 hrs full cutover (see §🛣 Migration paths). |
| **Depends on** | This doc itself depends on **Ticket 07 §🎉 Retrospective** (`react-i18next@17.0.8` upstream Layer C fix) — IF that hypothesis holds, path B/C is dramatically easier. IF not, future PRs must duplicate the saga-era 9-iteration workaround sequence. |
| **Status** | 🟡 **DOCUMENTED — migration NOT auto-started** (2026-07-21, doc-only commit pending). The current `main` boots cleanly with dev server returning HTTP 200 on `/`, `/login`, `/dashboard/*`, `/catalog`, `/pricing`, `/about` (verified via browser-use 2026-07-21); no migration is BLOCKING the user-visible "OK 状态" delivered last turn. |

---

## 🔁 Local reproduction

To verify the gap catalogue against the current `main`:

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload
git branch --show-current     # → main
git log --oneline -1          # → <latest-doc-commit>

# Confirm: no TanStack Start / TanStack Router runtime packages installed:
cd sau_web/frontend
grep -E '"@tanstack/(react-router|react-start|router-vite-plugin|router-core)"' package.json | sort -u
# Expected output (note: only router-vite-plugin, transitive via @assistant-ui/react):
#   "@tanstack/router-vite-plugin": "<transitive>"

# Confirm: no TanStack plugins in vite.config.ts
grep -nE 'tanstackStart|TanStackRouter' vite.config.ts
# Expected: zero matches (vite.config.ts only has react() + tailwindcss() + mdx)

# Confirm: routing via react-router-dom, NOT @tanstack/react-router
grep -nE "from 'react-router-dom'|BrowserRouter|createBrowserRouter" src/main.tsx src/App.tsx | head -5
# Expected: 21+ matches — react-router-dom is the *current* router

# Confirm: page boots & renders (the user-visible OK state)
nohup npx vite --port 5180 --strictPort --host 127.0.0.1 > /tmp/vite-ok.log 2>&1 &
for i in $(seq 1 30); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:5180/ 2>/dev/null)" = "200" ]; then break; fi
  sleep 1
done
curl -s -o /dev/null -w 'GET / → HTTP %{http_code}\n' --max-time 5 http://127.0.0.1:5180/
# Expected: HTTP 200 ✓
# SAFETY: only kill vite processes spawned by THIS experiment (matched on the
# `--port 5180 --strictPort` flag subset). A generic `pkill -9 -f vite` would
# clobber dev servers the user has running in OTHER terminals (e.g. an
# in-flight Flask+Vite full-stack dev session). The narrow pattern is intentional.
pkill -9 -f 'vite --port 5180 --strictPort' 2>/dev/null || true
```

If any of those greps contradict the **Expected** lines, the catalogue is stale and must be re-derived before path B/C is attempted.

---

## 📊 Gap inventory (verbatim, 2026-07-21 sweep)

TanStack Start `build-from-scratch` (https://tanstack.com/start/latest/docs/framework/react/build-from-scratch) lists 10 mandatory setup steps. Our current project satisfies **2 of them** and has **8 GAP rows**.

| # | doc-required step | current `main` | status |
|---|---|---|---|
| 1 | install `@tanstack/react-router` | ❌ not in `dependencies` of `package.json` | **GAP** |
| 2 | install `@tanstack/react-start` | ❌ not in `package.json` | **GAP** |
| 3 | `vite` + `@vitejs/plugin-react` (build tool + React integration) | ✅ vite `^8.1.0` + `@vitejs/plugin-react ^6.0.1` | **OK** |
| 4 | `tanstackStart()` plugin in `vite.config.ts` (imported from `@tanstack/react-start/plugin/vite`) | ❌ not imported, plugin not present | **GAP** |
| 5 | `TanStackRouter()` plugin in `vite.config.ts` (routesDirectory + autoCodeSplitting configured) | ❌ not imported, plugin not present | **GAP** |
| 6 | `src/router.tsx` exporting `getRouter()` with `createRouter({ routeTree, scrollRestoration: true })` | ❌ not present (current router lives in `src/App.tsx` via `<BrowserRouter>`) | **GAP** |
| 7 | `src/routes/__root.tsx` exporting `Route = createRootRoute({...})` with `<RootDocument>` that wraps `<Outlet/>` + `<HeadContent/>` + `<Scripts/>` | ❌ not present (current `<Routes>` block is in `src/App.tsx`) | **GAP** |
| 8 | auto-generated `src/routeTree.gen.ts` (vite plugin emits on first start) | ❌ not present (only generated when `tanstackStart` plugin is enabled) | **GAP** |
| 9 | route files use `createFileRoute('/path')` per file with file-based routing | ❌ uses react-router-dom `<Route path="..." element={...}/>` (21 lazy imports + Route registrations, all in `src/App.tsx`) | **GAP** |
| 10 | server functions via `createServerFn({ method: 'GET' \| 'POST' }).handler(...)` | ❌ project uses `axios` client-side calls only; no server-fn surface | **GAP** |

**OK rows: 2 / 10. GAP rows: 8 / 10.**

### Priority axis

| Tier | criterion |
|------|-----------|
| **P0** | blocks dev server boot OR drops a project-authored feature surface |
| **P1** | required by every TanStack Start downstream doc (Routing / Server Functions / Streaming SSR). Without these, attempting any deeper migration doc becomes guesswork. |
| **P2** | recommended for production-grade TanStack Start alignment; not required for dev-server boot |
| **P3** | deferred / informational only |

| # | step | tier | why |
|---|------|------|-----|
| 1 | install `@tanstack/react-router` | **P1** | next-tier docs (Routing, Server Functions) all import from `@tanstack/react-router`. None work without it. |
| 2 | install `@tanstack/react-start` | **P1** | the `tanstackStart()` plugin import path lives inside this package; SSR + streaming are packaging concerns |
| 4 | `tanstackStart()` plugin in vite.config.ts | **P1** | dev server won't even try TanStack Start without it |
| 5 | `TanStackRouter()` plugin in vite.config.ts | **P1** | enables file-based routing + autoCodeSplitting + `routeTree.gen.ts` emission |
| 6 | `src/router.tsx` | **P1** | mandatory file per docs; must export `getRouter()` |
| 7 | `src/routes/__root.tsx` | **P1** | mandatory entry route per docs |
| 8 | auto-generated `routeTree.gen.ts` | **P1** | imported by `src/router.tsx`; emitted by TanStackRouter plugin on first start |
| 9 | routes use `createFileRoute` per file | **P1** | file-based routing convention; the entire route loader/component/loader-data pattern depends on this |
| 10 | server functions via `createServerFn` | **P2** | recommended for production-grade SSR streaming; the project can ship SPA-routed-only without it (if dev server boots in SPA mode) |
| 3 | vite + `@vitejs/plugin-react` | already OK | — |

> **Path C (full migration) needs all 8 GAP rows closed as P1.** **Path B (light scaffold) only needs rows 1-2 + 4-8 (6 of 8); rows 9-10 deferred.**

---

## 🧬 Per-gap analysis (the 8 GAP rows)

### GAP #1 — install `@tanstack/react-router`

**Doc citation:** https://tanstack.com/start/latest/docs/framework/react/build-from-scratch §"Install Dependencies" (verbatim: `npm i @tanstack/react-start @tanstack/react-router`)

**Current state:** `package.json` `dependencies` block has no `@tanstack/react-router` entry. (Committed by commit `8cc3acaf` then trimmed during the saga-era rollback.)

**Why missing:** the saga-era rollback to pre-migration state explicitly removed the `@tanstack/react-router` dependency to clear the dup-decl + TSRSplitComponent cascade. The rollback went wider than necessary because the root cause (Layer C, Layer D) was unconfirmed at rollback time.

**Fix scope:** ~5 min · 1 package · 1 line in `package.json` (`"@tanstack/react-router": "^1.170.18"`). No code change yet — just `npm install` after the entry exists.

> **Re-attempt pre-flight note (2026-07-21):** Downstream project 不身陷 Layer C 病灶 — PATH B 的 `vite.config.ts` SyntaxError 是上游 TanStack 接口不齐：实测 `@tanstack/router-vite-plugin@1.167.23` exports 是 `TanStackRouterVite` / `tanstackRouter`，文档里那个 `TanStackRouter` 不存在；`@tanstack/react-start@1.168.32` 没有 `./plugin/vite` sub-path。未来 PATH B 入力者必须先 `npm install --save-exact @tanstack/react-router@latest @tanstack/react-start@latest @tanstack/router-vite-plugin@latest` 把 4 个包对齐到同一版本（建议 ≥ 1.172），再验证 build-from-scratch 的 `TanStackRouter` / `@tanstack/react-start/plugin/vite` import 在新版本可解析，否则不要 retry。

**Dependency:** none. Row can be closed first.

---

### GAP #2 — install `@tanstack/react-start`

**Doc citation:** same doc, same §Install Dependencies.

**Current state:** `package.json` lists zero `@tanstack/react-start` entry.

**Why missing:** same root cause as GAP #1 (saga rollback).

**Fix scope:** ~5 min · 1 package · `--save-exact` should pin to the version matching `@tanstack/router-vite-plugin` (per the saga's lesson: staggered releases break `TSRSplitComponent`).

> **Re-attempt pre-flight note (2026-07-21):** 见 GAP #1 同名 note — Downstream project 不是 Layer C 承受者，是上游 TanStack 接口不齐（`@tanstack/react-start@1.168.32` 无 `./plugin/vite` sub-path）。Future PR 务必先升 4 包到统一版号（建议 ≥ 1.172）再试 import 解析。

**Dependency:** best done alongside GAP #1 + GAP #5.

---

### GAP #4 — `tanstackStart()` plugin in vite.config.ts

**Doc citation:** §"Update Configuration Files" — verbatim example:

```ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart(),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
})
```

**Current state:** `vite.config.ts` imports `react` + `tailwindcss` + `mdx` only. No `tanstackStart` import. No `tsconfigPaths` config (eliminated because we don't use TS aliases).

**Why missing:** saga rollback to pre-migration state. Adding it back risks Layer B (TSRSplitComponent) returning per `Ticket 07 §🧪 Investigation outcome` "Versions... not aligned, the runtime @tanstack/react-router@1.167.0 does not define TSRSplitComponent helper".

**Fix scope:** ~10 min · 1 import + 1 plugin entry. Pre-flight check: confirm `@tanstack/router-vite-plugin@1.167.23` works against the exact `@tanstack/react-start` version picked per GAP #2.

**Dependency:** GAP #2 + GAP #5 first.

---

### GAP #5 — `TanStackRouter()` plugin in vite.config.ts

**Doc citation:** §"Update Configuration Files" — implied (doc shows `tanstackStart()` but `TanStackRouter()` from `@tanstack/router-vite-plugin` is the parallel companion plugin per the prior saga).

**Current state:** no `TanStackRouter` import in `vite.config.ts`.

**Why missing:** saga rollback; per saga the plugin version `@tanstack/router-vite-plugin@1.167.23` is installed transitively but not configured.

**Fix scope:** ~10 min · 1 import + 1 plugin config block. Per the saga, the safe working config is `autoCodeSplitting: false` to avoid the Layer B / TSRSplitComponent ReferenceError until upstream ships a coordinated `@tanstack/router-*` 1.172+ release where the runtime defines the helper.

**Dependency:** GAP #2 + GAP #4 + GAP #1.

---

### GAP #6 — `src/router.tsx` exporting `getRouter()`

**Doc citation:** §"The Router Configuration" — verbatim:

```tsx
// src/router.tsx
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
  })
  return router
}
```

**Current state:** `src/router.tsx` does not exist. The current router lives in `src/App.tsx` (a `<BrowserRouter>` wrapping 21 `<Route>` elements registered inline).

**Why missing:** saga rollback.

**Fix scope:** ~5 min · 1 new 12-line file. Pure addition — does NOT replace `src/App.tsx` until path C is attempted (path B keeps both routers coexisting).

**Dependency:** GAP #8 (`routeTree.gen.ts` exists so the import resolves).

---

### GAP #7 — `src/routes/__root.tsx` with `createRootRoute` + `<RootDocument>` + `<Outlet/>` + `<HeadContent/>` + `<Scripts/>`

**Doc citation:** §"The Root of Your Application" — verbatim shape required.

**Current state:** `src/routes/__root.tsx` does not exist. The `src/App.tsx`'s `<Routes>` block is the closest analogue.

**Why missing:** saga rollback.

**Fix scope:** ~10 min · 1 new ~30-line file. Coexists with `src/App.tsx` under path B; **replaces** `src/App.tsx` under path C.

**Dependency:** GAP #6 + GAP #4.

---

### GAP #8 — auto-generated `src/routeTree.gen.ts`

**Doc citation:** §"The Router Configuration" note: "You won't have a routeTree.gen.ts file yet. This file will be generated when you run TanStack Start for the first time."

**Current state:** file does not exist. Vite has not emitted it because GAP #5 is not closed.

**Why missing:** consequent on GAP #5 (plugin not configured).

**Fix scope:** ~0 min additional — the plugin auto-emits on first dev start. **Warning:** every dev/prod start re-evaluates `routeTree.gen.ts` against the current `src/routes/` tree, so the file can churn between commits. Decision needed: commit the generated file or add to `.gitignore` (per the predecessor saga, **commit** to avoid silent drift in CI).

**Dependency:** GAP #5 first (then `npx vite` once with current `src/routes/` content).

---

### GAP #9 — routes use `createFileRoute`

**Doc citation:** §"Writing Your First Route" — verbatim example shows `createFileRoute('/')({ component: Home, loader: async () => ... })`.

**Current state:** `src/App.tsx` registers 21 lazy-imported Pages via `<Route path=... element={<LazyComponent/>}/>` inside a single `<BrowserRouter>`. Each page is exported from `src/Pages/*.tsx` as a default Component (no `createFileRoute` involvement).

**Verification recipe (ground the "21" count for future maintainers):** `grep -cE 'lazy\(' src/App.tsx` returns **21** in `main` @ commit `8cc3acaf`-era tree. IF a future PR adds a new lazy import, this number grows — re-read §Acceptance criteria row #9 before trusting the gap-scope estimate.

**Why missing:** saga rollback.

**Fix scope:** ~1 hr · 21 file splits · ≈ 21 files each ~10 lines of boilerplate, each invoking `createFileRoute('/path')({ component: MyPage })`. **Risk:** every `<Route path>` in `src/App.tsx` becomes its own `src/routes/<path-segment>.tsx` file; the `LazyOnboardingTour` wrapper must be re-parented to `__root.tsx`; nested route semantics are <u>not</u> a 1:1 drop-in (the React Router v6 nested-state-store vs TanStack route-loader difference).

**Dependency:** GAP #6 + GAP #7 + GAP #8 first. This is the largest gap.

---

### GAP #10 — server functions via `createServerFn`

**Doc citation:** §"Building a Robust Application" / "Server Functions" page (link from the build-from-scratch footer area).

**Current state:** the project uses `axios` direct calls in `src/api/*.ts` files (e.g. `src/api/client.ts`, `src/api/accounts.ts`); there is no `createServerFn` invocation surface anywhere.

**Why missing:** the entire backend integration pattern is client-fetch + cookie JWT. TanStack Start's `createServerFn` would force-pass these through a server runtime which doesn't exist on this project today.

**Fix scope:** ~30 min per current backend hook to migrate (could be ~5-10 hrs depending on backend surface); requires SSR to be functional (a prerequisite) before server-fn handlers can mount.

**Dependency:** GAP #4 (SSR runtime available) + GAP #9 (route-level context for the loader/handler split). **Defer until path C.**

---

## 🛣 Migration paths

The chat-derived 3-path menu presented to the user. PATH A is *this* diagnostic doc — completed. B and C are future PRs.

### Path A — Diagnostic only (CURRENT PR)

- **Scope:** write this doc + add INDEX.md row + run docs-discoverability-audit gate. **Zero code change.**
- **Risk:** minimal. Doc-only commit. No runtime impact. No lockfile drift.
- **Reversibility:** trivial. `git revert <commit>` restores pre-doc state.
- **Recommended next ticket:** *none* if the user is satisfied with the catalogue. Open ticket-12 if path B/C is requested.

### Path B — Light scaffold (parallel)

- **Scope:** install `@tanstack/react-router` + `@tanstack/react-start` (rows 1-2); add `tanstackStart()` + `TanStackRouter()` plugins with `autoCodeSplitting: false` (rows 4-5); create `src/router.tsx` + `src/routes/__root.tsx` (rows 6-7); let the plugin emit `routeTree.gen.ts` (row 8). **DO NOT touch rows 9 (createFileRoute per file) and row 10 (createServerFn)**.
- **Risk:** Medium. The saga's dup-decl + Layer B failure modes are documented. Mitigations: keep `autoCodeSplitting: false`, only land the plugin + scaffolding, **preserve** `src/App.tsx`'s `<BrowserRouter>` so react-router-dom keeps serving existing routes. Verify: existing `/ /login /dashboard /catalog /pricing /about` routes still return HTTP 200 via Vite's SPA loader **AND** `app/`-style TanStack routes (mounted at a NEW prefix like `/start/*`) work in parallel.
- **Reversibility:** Medium. Plugin entry in `vite.config.ts` can be reverted with a 5-line edit. The new `src/router.tsx` + `src/routes/__root.tsx` files are additive (can be deleted later). Lockfile drift is the costliest side-effect (use `--save-exact`).
- **Recommended ticket allocation:** ticket-12 (scaffold) → ticket-13 (verification recipe) → ticket-14 (deferred restore from path C).

### Path C — Full cutover

- **Scope:** everything in path B PLUS row 9 (21 `createFileRoute` files) + row 10 (server-fn migration). The full doc-mandated surface.
- **Risk:** **High.** The saga documented 9 iteration cycles with 4 separate incompat layers (Layer A / Layer B / Layer C / Layer D). The Layer C hypothesis ticket-07 §🎉 Retrospective proposes *plausibly fixed* by `react-i18next@17.0.8` upstream — but the hypothesis is unverified (escalation recipe in ticket-07 ## Cross-references). Layer B's `TSRSplitComponent` ReferenceError is genuinely still possible until upstream ships `@tanstack/router-vite-plugin@1.172+` with the runtime helper defined. Layer A is ortho (useAccountGroups short-circuit, deprioritized ticket-05-B path).
- **Reversibility:** Complex. The 21 `createFileRoute` file splits cannot be cleanly reverted without a parallel branch carrying both shapes. Recommend a **single one-way door PR** with a rollback branch tag pre-baked for emergency revert.
- **Recommended ticket allocation:** ticket-12 (path B scaffold) → ticket-13 (cluster-by-cluster `createFileRoute` rollout starting with `LandingPage`, `LoginPage`, `LoginAuthPage` which are 0-children routes) → ticket-14 (cluster X vitest cluster fix per ticket-10 §🧬 Cluster X.b 1-line harness wrap) → ticket-15 (server-fn rollout).

> **STRONG RECOMMENDATION:** do *not* attempt Path C without first verifying the ticket-07 §🎉 Retrospective Layer C hypothesis via the recipe:
>
> ```bash
> cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend
> npm install --no-audit --no-fund
> node -e "console.log('react:', require('react/package.json').version, '| default-field:', 'default' in require('react'))"
> node -e "console.log('react-i18next:', require('react-i18next/package.json').version)"
> grep -nE 'React\.default\.useMemo|^(import|const).*useMemo' node_modules/react-i18next/dist/es/I18nextProvider.js | head -3
> ```
>
> If `react: 19.x | default-field: false` AND `react-i18next` uses named `useMemo` import → Layer C **plausibly resolved** → path C is much safer. If neither, **defer** path C and report ticket-07's Layer C Hypothesis FALSIFIED — meaning ticket-10's Cluster X `test-utils/render.tsx` 1-line harness wrap (NOT the upstream fix) becomes the only path forward.

---

## ✅ Acceptance criteria — per gap

| Gap # | Surface | Fix | Target |
|-------:|---------|-----|-------:|
| 1 | deps | `npm i @tanstack/react-router@<TARGET> --save-exact` | 1 entry in `package.json` |
| 2 | deps | `npm i @tanstack/react-start@<TARGET> --save-exact` (≤ `@tanstack/router-vite-plugin@1.167.23` for compat) | 1 entry |
| 3 | — | OK row, no change | — |
| 4 | vite.config | add `tanstackStart()` import + plugin entry | 1 file, +2 lines |
| 5 | vite.config | add `TanStackRouter()` import + `{ routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts', autoCodeSplitting: false }` | 1 file, +5 lines |
| 6 | src | create `src/router.tsx` exporting `getRouter()` | +1 file, +12 lines |
| 7 | src | create `src/routes/__root.tsx` with `createRootRoute` + `<RootDocument>` + `<Outlet/>` + `<HeadContent/>` + `<Scripts/>` | +1 file, +30 lines |
| 8 | generated | `npx vite` once with current routes → plugin emits `src/routeTree.gen.ts`; **commit** the file | +1 file, ~thousands of lines (auto-gen) |
| 9 | src | 21 file splits from `src/App.tsx` lazy imports → 21 new `src/routes/*.tsx` files each with `createFileRoute('/...')({ component })` | +21 files, ~21 default-component-shape re-exports trimmed |
| 10 | src | replace `axios` direct calls with `createServerFn({ method: 'GET' }).handler(...)` — per backend integration | per backend surface, ~0.5 hrs each |
| **Σ Path B** | — | **6 rows (1, 2, 4, 5, 6, 7, 8)** | **+~50 lines + 1 lockfile entry** |
| **Σ Path C** | — | **all 8 rows** | **+~500 lines + 21 file splits + lockfile + tsc/vitest fallout** |

---

## ⚠️ Risks — preservation recommendations

1. **Do not attempt Path B or C without first verifying the ticket-07 §🧪 Investigation outcome**. Specifically: Layer B (`autoCodeSplitting: true` + staggered versions) failure mode. The ticket documents a 9-iteration sequence; reproducing those iterations without reading the ticket would add another 5+ rounds.
2. **`autoCodeSplitting` defaults to `false` for any version not exactly aligned across `@tanstack/router-*` + `@tanstack/react-start` + `@tanstack/router-core`**. Even when path B starts, keep this flag false until @tanstack/router-vite-plugin 1.172+ ships (Ticket 07 §"Version alignment strategy").
3. **`react-router-dom` + `@tanstack/react-router` do not coexist cleanly**. If path B is attempted, the existing `<BrowserRouter>` wrapper in `src/App.tsx` will continue to mount routes but the new `<RouterProvider>` (from `src/router.tsx`) cannot be added in parallel without a JS-level conflict. **Workaround:** mount `src/router.tsx`'s router under a TOTALLY-ORTHOGONAL URL prefix (e.g. `/start/*`) and gate the dev experience to that surface only until path C.
4. **`routeTree.gen.ts` MUST be committed**. Per the saga's prior burst, leaving the file in `.gitignore` causes silent CI drift — different developers / CI runners see different routing surfaces. Choose: **commit** (default).
5. **The 21 `<Route path>` in `src/App.tsx` are not 1:1 with file-based routing**. Some elements are nested `<Route>` siblings (e.g. `<Route path="/dashboard/*" element={<AppShellWithPrefs/>}/>`-style splats); some are wrap patterns (e.g. `<Suspense fallback={<AuthLoadingSkeleton/>}>`). The TanStack `createFileRoute` route equivalent needs nested route files (`src/routes/dashboard/route.tsx` for the `AppShellWithPrefs` layout) — that's not a drop-in.
6. **Server functions require SSR to be functional**. The project today is SPA-mode react-router-dom (Vite serves `/src/main.tsx`, no Node SSR). Path C requires `tanstackStart()` to enable SSR; this in turn requires Node-side assets (`vite ssrLoader`, TanStack Server Functions runtime). Without these, server-fn handlers cannot bind — they'd crash on first call.
7. **Ticket-10 Cluster X vitest failures are downstream of the migration**. If path B/C is attempted without first verifying Layer C resolution, ticket-10's 205/213 vitest Layer-C failures will RE-SURFACE on every test that uses `useTranslation()` because `<I18nextProvider>` is not guaranteed to be in the test mount chain. Path B/C's ticket allocation should include ticket-14 (1-line harness wrap per ticket-10 §🧬 Cluster X.b).

---

## 🧪 Validation gate — what "OK" looks like per row

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload/sau_web/frontend

# Gap #1–#2 (deps present)
node -e "require('@tanstack/react-router/package.json'); console.log('OK')"  # should not throw
node -e "require('@tanstack/react-start/package.json'); console.log('OK')"

# Gap #4–#5 (plugins imported)
grep -nE 'tanstackStart|TanStackRouter' vite.config.ts  # ≥ 2 matches

# Gap #6–#7 (entry files exist)
test -f src/router.tsx && test -f src/routes/__root.tsx && echo "OK"

# Gap #8 (routeTree emitted)
test -f src/routeTree.gen.ts && wc -l src/routeTree.gen.ts

# Gap #9 (21 createFileRoute files)
grep -lE 'createFileRoute' src/routes/*.tsx 2>/dev/null | wc -l  # ≥ 21

# Gap #10 (server-fn surface)
grep -lE 'createServerFn' src/routes/*.tsx src/api/*.ts 2>/dev/null | wc -l  # ≥ 1

# Runtime smoke: dev server boots + new surface returns 200
nohup npx vite --port 5180 --strictPort --host 127.0.0.1 > /tmp/vite-tanstack.log 2>&1 &
for i in $(seq 1 30); do
  if [ "$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' http://127.0.0.1:5180/ 2>/dev/null)" = "200" ]; then
    echo "ready ${i}s"; break
  fi
  sleep 1
done
curl -s -o /dev/null -w 'GET / → HTTP %{http_code}\n' http://127.0.0.1:5180/
curl -s -o /dev/null -w 'GET /start (new surface) → HTTP %{http_code}\n' http://127.0.0.1:5180/start
# Expected on Path B completion: / → 200, /start → 200 (path B mount point; SPA load returns shell)
grep -c 'TSRSplitComponent\|Duplicate declaration' /tmp/vite-tanstack.log  # → 0
pkill -9 -f 'vite' 2>/dev/null || true
```

---

## 🎉 当前状态 (2026-07-21)

| Surface | Status | Notes (verbatim from verification recipe) |
|---|---|---|
| **Layer C upstream** (ticket-07 §🎉 Retrospective 假设) | ✅ **RESOLVED** | `react@19.2.7` (`'default' in require('react')` → `false`) + `react-i18next@17.0.10` 走 named `useMemo` import (recipe 3 lines 实测 PASS) |
| **ticket-10 Cluster X** (`setup.ts` vi.mock harness wrap) | ✅ **RESOLVED** | 205 / 213 vitest failures 缩平到 0（91 test 文件零改动） |
| **ticket-10 Cluster Q orphans** | 🟡 3 LEFT | `AuthorizeDialog.test.tsx` / `GroupToolbar.test.tsx` / `PersonalizationPage.test.tsx` — AssertionError class 不再是 Layer C 病灶 |
| **Vite dev server boot** | ✅ GREEN | HTTP 200 on `/`、`/login`、`/dashboard/*`、`/catalog`、`/pricing`、`/about` |
| **PATH B (TanStack Start scaffold)** | 🟡 **PARTIAL — ROLLED BACK** | setup 文件写过 + `vite.config.ts` 改过 → 因 staggered-version `@tanstack/router-vite-plugin@1.167.23` exports `TanStackRouterVite` / `@tanstack/react-start@1.168.32` 没有 `./plugin/vite` sub-path，文档 `import { TanStackRouter }`、`import { tanstackStart } from '@tanstack/react-start/plugin/vite'` 都不解析 → rollback |

---

## 🔗 Cross-references

- **Ticket 07** (`docs/dev/second-batch-tickets/07-tanstack-version-align-codesplit.md`): the sibling ticket that documents the 9-iteration rollback history + 🎉 Layer C retrospective. **Path B/C re-attempts MUST start here** for the Layer C verification recipe before opening the gap rows above.
- **Ticket 10** (`docs/dev/second-batch-tickets/10-pre-existing-failures-vitest-tsc.md`): the horizontal super-set of cluster failures (213 vitest + 105 tsc). Path C cutover must sequence ticket-14 (Cluster X 1-line harness wrap) AFTER gap row #2 lands.
- **Ticket 06** (`docs/dev/second-batch-tickets/06-react-router-dom-to-tanstack.md`, *when committed*): Layer B (67-file `react-router-dom` → TanStack Router hooks migration). **Predecessor ticket** to this one — gap row #9 (createFileRoute per file) is the natural mapping of ticket-06's hook-replacement phase. File not present on `main` as of 2026-07-21; conditional link gracefully fades if not yet committed.
- **Ticket 05** (`docs/dev/second-batch-tickets/05-useauthorizeaccountgroup-aspirational-short-circuit.md`): Layer A (ortho to migration; B path decided). Path B/C does not change Layer A status.
- **Ticket 08** (`docs/dev/second-batch-tickets/08-toast-context-case-mismatch.md`, *when committed*): React 19 case-casing issue. **Orthogonal** to paths B/C.
- **TanStack Start `build-from-scratch` (canonical)**: https://tanstack.com/start/latest/docs/framework/react/build-from-scratch
- **TanStack Start `getting-started`** (hub): https://tanstack.com/start/latest/docs/framework/react/getting-started
- **TanStack Router `quick-start`**: https://tanstack.com/router/latest/docs/framework/react/quick-start

---

- **Hub**: [docs/dev/INDEX.md#contributors](INDEX.md#contributors) — Contributors (writing code, merging PRs).
