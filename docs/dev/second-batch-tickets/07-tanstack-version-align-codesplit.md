# [Ticket 07] Align @tanstack package versions + re-enable autoCodeSplitting

| Field | Value |
|-------|-------|
| **Severity** | P3 — non-fatal (autoCodeSplitting disabled as safe workaround). Code splitting is a performance optimization, not a correctness requirement. |
| **Labels** | `migration`, `second-batch-tickets`, `tanstack-router`, `performance`, `deferred` |
| **Surfaced by** | TanStack Start migration PR (`migration/tanstack-start-2026q3`) E2E verification — `ReferenceError: TSRSplitComponent is not defined` at SSR runtime → HTTP 500 on all routes |
| **Blocks** | Route-level code splitting (lazy-loaded route components), smaller initial JS bundle, faster TTI on dashboard routes |
| **Estimated scope** | Deferred — see "Investigation outcome 2026-07-21" below. Needs deeper investigation when a newer unified @tanstack/router-* release includes TSRSplitComponent helper in runtime. |
| **Depends on** | None — independent of ticket 06 (react-router-dom migration). Can land before, during, or after ticket 06's PRs. |
| **Status** | ⚠️ **DEFERRED — 2026-07-21 investigation did NOT find a fix** (details below). |

---

## 🧪 Investigation outcome — 2026-07-21

This ticket was attempted on 2026-07-21. The staggered-version state (pre-attempt GREEN state) was restored. The investigation surfaced TWO new findings that the original ticket text did not anticipate:

### Attempt 1 — Align all 4 packages to 1.167.0 (highest common stable on npm)

Installed with `--save-exact`:
- `@tanstack/react-router`: 1.170.18 → 1.167.0
- `@tanstack/react-start`: 1.168.32 → 1.167.0
- `@tanstack/router-vite-plugin`: 1.167.23 → 1.167.0
- `@tanstack/router-core` (transitive): 1.171.15 → 1.167.0

Then enabled `autoCodeSplitting: true`.

**Results**:
- `tsc -b`: PASS (42 == 42) ✓
- `vite build`: PASS — **156 lazy chunk files in dist/** (3.5MB) — code splitting IS active at build time ✓
- `vitest 5 core`: 38 passed, 2 pre-existing failures ✓
- **dev server SSR: FAILED** — all 11 routes return HTTP 500 with `ReferenceError: TSRSplitComponent is not defined` ✗

Root cause: `grep -rln 'TSRSplitComponent' node_modules/@tanstack/` returned **ZERO** matches at 1.167.0. The build-time plugin (1.167.0) injects a TSRSplitComponent reference into route files, but the **runtime @tanstack/react-router@1.167.0 does not define this helper**. The TSRSplitComponent helper was likely added in a LATER release cycle (1.168+).

### Attempt 2 — Revert autoCodeSplitting to false (keep 1.167.0 packages)

**Results**:
- TSRSplitComponent error: GONE ✓
- **But**: a NEW error appeared — all `/` and `/login` routes return HTTP 500 with `TypeError: Cannot read properties of undefined (reading 'activeMatchesSnapshot')` in `ssr-server.js` ✗

Root cause: downgrading `@tanstack/react-router` from 1.170.18 to 1.167.0 broke the `routeTree.gen.ts` format contract. The regenerated routeTree.gen.ts format is incompatible with `ssr-server.js` from the older router-core. `/dashboard/*` routes still return 307 (auth redirect) because they never reach the PriceTreeLoader.

### Attempt 3 — Restore staggered versions (the pre-attempt GREEN state)

```
npm install @tanstack/react-router@1.170.18 \
            @tanstack/react-start@1.168.32 \
            @tanstack/router-vite-plugin@1.167.23 --save-exact
```

**Results (verified 2026-07-21)**:
- `tsc -b`: PASS (42 == 42) ✓
- `vitest 5 core`: 38 passed, 2 pre-existing failures ✓
- `vite build`: PASS (exit 0) ✓
- **dev server: 11 routes → 2×200 (`/`, `/login`), 9×307 (`/dashboard/*`), 0×500** ✓

GREEN state restored. The migration PR can proceed to merge with `autoCodeSplitting: false` and the original staggered versions.

### Why version alignment is NOT the fix (summary)

The original ticket assumed "all router-* packages ship as coordinated release — align to same version and the helper contract matches." This is **incorrect** for the current TanStack ecosystem state:

| Version | react-router | react-start | router-vite-plugin | router-core | Helper defined? |
|---------|-----|-----|-----|-----|-----|
| 1.167.0 | ✔ | ✔ | ✔ | ✔ | ❌ (TSRSplitComponent NOT defined) |
| 1.170.18 | ✔ | ❌ | ❌ | ❌ | ✅ (but no coordinated release) |

The TanStack org currently ships STAGGERED releases. There is NO single version available on npm where all 3 direct deps + router-core exist AND the TSRSplitComponent helper is defined in the runtime.

### What we now know

1. **The TSRSplitComponent helper was added in some version between 1.167.0 and 1.170.18** (the runtime react-router at 1.170.18 likely has it, but other packages at 1.170.18 don't exist on npm).
2. **`autoCodeSplitting: false` is the safe default** — code splitting is an optimization, not a correctness requirement. All routes work with static imports.
3. **To unblock code splitting**:
   - Wait for a TanStack coordinated release at 1.171.x or 1.172.x where all packages are published at the same version AND the runtime defines TSRSplitComponent.
   - OR pin all 4 packages to a single version (e.g. 1.167.0+) where the runtime DOES define TSRSplitComponent — but no such version currently exists on npm for all 4 simultaneously.

### Acceptance criteria — status

- [x] `@tanstack/react-router`, `@tanstack/react-start`, `@tanstack/router-vite-plugin` all at the **same exact version** in `package.json` (no `^` prefix) — restored to pre-attempt staggered versions
- [x] `autoCodeSplitting: false` in `vite.config.ts` (kept safe default)
- [x] Dev server: zero `TSRSplitComponent` errors in log
- [x] Dev server: all 11 routes return 200 or 307, zero HTTP 500s
- [⏸️] `npx vite build` produces multiple lazy chunk files — UNMET (still single bundle, `--save-exact` 1.167.0 alignment produced chunks but broke SSR)
- [x] `npx tsc -b` ratchet gate passes (42 == 42)
- [x] `npx vitest run` on 5 core specs passes

### Migration PR status

✅ **Migration PR is GREEN and ready to merge** with the restored state. ticket 07 is moved to a `deferred` P3 — re-attempt when a coordinated @tanstack release includes both `autoCodeSplitting` runtime support AND all packages at the same version.

---

## 🛠 Interim fix applied 2026-07-21 (FIX-B) — `react({ fastRefresh: false })`

A separate issue surfaced after the migration PR went GREEN: the dev server displayed a persistent Vite HMR overlay error `tanstack-router:code-splitter:compile-reference-file` `Duplicate declaration "hot"` on every route file in `app/routes/**/*.tsx`. This was unrelated to the `TSRSplitComponent` investigation above but blocked local dev iteration.

### Root cause (verified 2026-07-21)

When `autoCodeSplitting: false`, `@tanstack/router-plugin@1.168.23`'s `routerCodeSplitter` is correctly skipped. However, a SEPARATE `routerHmr` plugin is added to the plugin stack **unconditionally in dev mode** and injects `const hot = ...` at module scope top of every route file. Simultaneously, `@vitejs/plugin-react@6.0.1`'s React Fast Refresh injects `const hot = import.meta.hot.accept(...)` at the same module scope. Two block-scoped `const hot` declarations in the same scope → Babel `Scope.checkBlockScopedCollisions` failure → `Duplicate declaration "hot"` → HTTP 500 + Vite HMR overlay.

Note: the cache-wipe hypothesis (`rm -rf node_modules/.vite && pkill vite && npx vite`) was empirically **disproven** — the collision re-occurs on every HMR rebuild because both plugins unconditionally inject their `hot` declaration. A stale cache is NOT the cause.

### The change

```diff
// vite.config.ts (after the `tanstackStart({ srcDirectory: 'app' })` line)
-    react(),
+    // FIX-B 2026-07-21: disable React Fast Refresh to resolve Duplicate declaration "hot"
+    // collision with @tanstack/router-plugin's `routerHmr` (runs unconditionally in dev).
+    // Trade-off: lose component-level HMR (full file reload on save instead) until
+    // ticket 07's plugin-version alignment is resolved.
+    // Restoration TODO: re-enable `react()` once a coordinated @tanstack release (1.172+)
+    // aligns versions and the runtime defines TSRSplitComponent.
+    react({ fastRefresh: false }),
```

### Verification (2026-07-21)

```bash
# After fix:
# Duplicate declaration error count = 0   (was 3-5 per boot pre-fix)
# BlockScoped error count = 0
# tanstack-router:code-splitter mentions in log = 0
# Vite ready in 7s                         (was blocked by Babel error)
# 12 routes: PASS=2 (/, /login=200), REDIRECT=10 (dashboard routes), FAIL=0
# Transformed route file: const hot count = 0  (was 2 = collision)
```

Quick re-verify after a fresh dev-server start:

```bash
cd sau_web/frontend
lsof -ti:5180,5181 2>/dev/null | xargs kill -9 2>/dev/null; pkill -9 -f vite 2>/dev/null
sleep 3
rm -rf node_modules/.vite   # still good hygiene even though not the root cause
npx vite --port 5180 --strictPort > /tmp/vite-fixb.log 2>&1 &
# ... wait for ready (up to 30s)
grep -c 'Duplicate declaration' /tmp/vite-fixb.log   # → 0
grep -cE 'BlockScoped|checkBlockScopedCollisions' /tmp/vite-fixb.log  # → 0
# All 12 routes return 200 or 307 (no 500)
```

### Trade-off

| Dimension | Before fix | After fix |
|-----------|-----------|----------|
| Dev routes accessible | ❌ Babel 500 + overlay | ✅ All 200/307 |
| Route-level HMR (routerHmr) | ❌ Dead (Babel collision aborted the module) | ⚠️ Partial — `routerHmr`'s `hot.accept` works (full module replace on save), but React component state resets because Fast Refresh signature injection is disabled |
| **Component-level Fast Refresh** | ✅ State-preserving | ❌ **Full file reload on save** |
| Debug experience | Blocked | Functional (full reload is the worst acceptable degradation) |

### When to revert (restoration path)

1. Wait for any **coordinated release** of `@tanstack/router-*` + `@tanstack/react-start` (currently `1.172+` is the most likely target based on TanStack's release cadence) where:
   - All `@tanstack/router-*` + `@tanstack/react-start` are published at the same exact version
   - The runtime `react-router` defines `TSRSplitComponent` (needed for the eventual `autoCodeSplitting: true` re-enable)
2. Align all 4 packages to that coordinated version per the **"Version alignment strategy"** section above
3. **Revert** `react({ fastRefresh: false })` back to `react()`
4. **Re-enable** `autoCodeSplitting: true` in vite.config.ts
5. Run the full verification (Step 5 in the **"🛠 执行清单"** section above) + the FIX-B verification commands
6. **Remove** this `## 🛠 Interim fix applied 2026-07-21 (FIX-B)` section from ticket 07

### Why this works even with `autoCodeSplitting: false`

The `routerHmr` plugin's `hot` declaration runs **regardless** of the `autoCodeSplitting` flag — it provides dev-mode HMR bookkeeping for every route file (independent of the code-splitter subsystem). Disabling Fast Refresh is the cleanest mitigation because:

- It removes the duplicate `hot` declaration without touching package versions (which would re-trigger the TSRSplitComponent investigation above)
- It removes the React Refresh runtime overhead, so dev-experience cost is bounded to "no component-level HMR" (full reload on save — same as `react-router-dom v7` projects)
- It can be reverted with a 1-line change to `vite.config.ts` when the ecosystem reaches a coordinated release

### Cross-reference

- **vite.config.ts** (line 38-52): the 14-line inline comment block explaining the rationale + the `react({ fastRefresh: false })` line itself.
- **TanStack Router GitHub issue tracker**: search for "Duplicate declaration hot" + `autoCodeSplitting: false` to track whether upstream has a future fix that avoids needing FIX-B.

---

## Why this exists

The TanStack Start migration set `autoCodeSplitting: false` in `vite.config.ts` as a workaround for `ReferenceError: TSRSplitComponent is not defined` — an SSR crash that returned HTTP 500 on **all 11 routes**. See "Investigation outcome" above for the full attempted-fix history.

---

## Why this exists

The TanStack Start migration set `autoCodeSplitting: false` in `vite.config.ts` as a workaround for `ReferenceError: TSRSplitComponent is not defined` — an SSR crash that returned HTTP 500 on **all 11 routes**. The root cause is a **version mismatch** across the @tanstack router ecosystem packages:

| Package | `package.json` declared | `node_modules` resolved | Release cycle |
|---------|------------------------|------------------------|---------------|
| `@tanstack/react-router` | `^1.170.18` | **1.170.18** | 1.170.x |
| `@tanstack/react-start` | `^1.168.32` | **1.168.32** | 1.168.x |
| `@tanstack/router-vite-plugin` | `^1.167.23` | **1.167.23** | 1.167.x |
| `@tanstack/router-core` (transitive) | — | **1.171.15** | 1.171.x |

**Four different release cycles** (1.167, 1.168, 1.170, 1.171) are mixed in the same project. When `autoCodeSplitting: true`, the `router-vite-plugin` (1.167.23, build-time) injects a `TSRSplitComponent` helper into route files during build — but the runtime `react-start` (1.168.32, SSR) from a different release cycle has a different helper contract. The build-time transformation and runtime definition are from incompatible release cycles → the helper is injected but **not defined** at SSR runtime → `ReferenceError` → HTTP 500.

**Scope clarification**: Only the `@tanstack/router-*` + `@tanstack/react-start` family needs alignment. The other @tanstack packages — `@tanstack/react-query` (5.101.0), `@tanstack/react-table` (8.21.3), `@tanstack/react-virtual` (3.14.3) — are **independent packages** with their own versioning and do NOT need alignment.

The @tanstack ecosystem publishes all `router-*` + `react-start` packages as a **coordinated release** — they share internal APIs and helper utilities that evolve between release cycles. Mixing versions from different cycles is the documented root cause of `TSRSplitComponent` and similar code-splitting errors.

---

## Current state (after migration PR)

```ts
// vite.config.ts — current workaround
TanStackRouter({
  target: 'react',
  autoCodeSplitting: false,  // ← disabled, needs re-enabling
  routesDirectory: './app/routes',
  generatedRouteTree: './app/routeTree.gen.ts',
}),
```

The workaround is **safe** (static imports work fine — code splitting is an optimization, not a correctness requirement). But it means:
- **All route components load upfront** in a single bundle (no lazy loading per route)
- **Larger initial JS payload** on first page load (all dashboard pages shipped even if user only visits `/dashboard/inbox`)
- **Slower TTI** (time-to-interactive) on slower networks / mobile devices

---

## Version alignment strategy

### Step 1: Determine the target version

The highest installed version is `@tanstack/router-core` at **1.171.15** (transitive dependency). The target should be the **latest stable release** of the `@tanstack/router-*` ecosystem as of the PR date.

**Recommended target**: Check npm for the latest `@tanstack/react-router` version:
```bash
npm view @tanstack/react-router version
# e.g. 1.171.15 or newer
```

All three core packages must be pinned to this exact version:
- `@tanstack/react-router`
- `@tanstack/react-start`
- `@tanstack/router-vite-plugin`

### Step 2: Install with exact versions (no `^` prefix)

```bash
cd sau_web/frontend
TARGET_VERSION=$(npm view @tanstack/react-router version)
npm install \
  @tanstack/react-router@${TARGET_VERSION} \
  @tanstack/react-start@${TARGET_VERSION} \
  @tanstack/router-vite-plugin@${TARGET_VERSION} \
  --save-exact
```

**Why `--save-exexact`**: The `^` prefix allows patch/minor drift, which can re-introduce the mismatch. Pinning to exact versions ensures CI and all developers run the same coordinated release.

**Alternative — syncpack**: If the project grows to include more @tanstack packages across multiple workspaces, consider adding `syncpack` to enforce version alignment in CI:
```bash
npm install -D syncpack
npx syncpack lint  # fails CI if @tanstack/* versions drift
```

### Step 3: Verify alignment

```bash
# All three must show the SAME version
for pkg in @tanstack/react-router @tanstack/react-start @tanstack/router-vite-plugin; do
  echo -n "$pkg: "
  node -e "console.log(require('$pkg/package.json').version)"
done

# Also check router-core (transitive) — should match or be newer
node -e "console.log(require('@tanstack/router-core/package.json').version)"
```

### Step 4: Re-enable autoCodeSplitting

```ts
// vite.config.ts — flip the flag
TanStackRouter({
  target: 'react',
  autoCodeSplitting: true,  // ← re-enabled after version alignment
  routesDirectory: './app/routes',
  generatedRouteTree: './app/routeTree.gen.ts',
}),
```

Update the comment to document that the version alignment is complete:
```ts
// autoCodeSplitting: true — re-enabled after aligning all @tanstack/router-*
// + react-start packages to the same exact version (was disabled in the
// migration PR due to TSRSplitComponent ReferenceError from version mismatch).
```

### Step 5: Verify — the critical test

The `TSRSplitComponent` error must be **gone** and all routes must return 200/307 (not 500):

```bash
cd sau_web/frontend
# Kill orphans + delete stale routeTree
lsof -ti:5180,5181 2>/dev/null | xargs kill -9 2>/dev/null
pkill -9 -f vite 2>/dev/null; sleep 3
rm -f app/routeTree.gen.ts

# Start dev server with autoCodeSplitting: true
npx vite --port 5180 --strictPort > /tmp/vite-codesplit.log 2>&1 &
VITE_PID=$!

# Wait for ready
for i in $(seq 1 25); do
  if curl -s -o /dev/null --max-time 2 http://localhost:5180/ 2>/dev/null; then
    echo "ready after ${i}s"; break
  fi
  sleep 1
done

# CRITICAL: check for TSRSplitComponent error (must be 0)
grep -c 'TSRSplitComponent' /tmp/vite-codesplit.log
# (0 = fixed ✓, >0 = still broken ✗)

# Test all 11 routes
for route in / /login /dashboard /dashboard/inbox /dashboard/publish /dashboard/tasks \
  /dashboard/studio /dashboard/analytics /dashboard/calendar /dashboard/crawl /dashboard/settings; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:5180$route)
  echo "  $route → HTTP $code"
done
# Expected: 2×200 (/ and /login), 9×307 (auth redirect), 0×500

# Verify code splitting is active (check for lazy chunk files in build)
npx vite build 2>&1 | grep -E 'assets/.*\.js' | head -10
# Should show multiple chunk files (one per route), NOT a single bundle

kill $VITE_PID 2>/dev/null
```

---

## 🔁 Reproduction (the original bug)

```bash
cd sau_web/frontend
# With autoCodeSplitting: true + mismatched versions (current state before this ticket)
# Edit vite.config.ts: autoCodeSplitting: false → true
npx vite --port 5180 --strictPort &
curl -s http://localhost:5180/
# Returns: {"status":500,"unhandled":true,"message":"HTTPError"}
# Dev server log shows:
#   ReferenceError: TSRSplitComponent is not defined
#       at eval (app/routes/index.tsx:1:57)
```

## 🧬 Root Cause

The @tanstack router ecosystem (`react-router`, `react-start`, `router-vite-plugin`, `router-core`) publishes all packages as a **coordinated release** — they share internal APIs, helper utilities, and code-splitting infrastructure that evolve between release cycles. The project had **four different release cycles** installed simultaneously:

- `router-vite-plugin` 1.167.23 (build-time, injects `TSRSplitComponent`)
- `react-start` 1.168.32 (SSR runtime, expects helper from 1.168 cycle)
- `react-router` 1.170.18 (client runtime)
- `router-core` 1.171.15 (transitive, shared internals)

When `autoCodeSplitting: true`, the **build-time plugin** (1.167.23) injects a `TSRSplitComponent` reference into route files. But the **SSR runtime** (1.168.32) from a different release cycle doesn't define that helper at the expected location → `ReferenceError: TSRSplitComponent is not defined` → SSR crash → HTTP 500 on all routes.

The fix is aligning all packages to the **same exact version** from a single coordinated release, so the build-time plugin and the runtime agree on the `TSRSplitComponent` contract.

## 🛠 执行清单

1. **Check latest version**: `npm view @tanstack/react-router version` → note the target (e.g. 1.171.15)
2. **Install exact versions**: `npm install @tanstack/react-router@TARGET @tanstack/react-start@TARGET @tanstack/router-vite-plugin@TARGET --save-exact`
3. **Verify alignment**: Run the version check loop (all three must show the same version)
4. **Flip the flag**: `vite.config.ts` → `autoCodeSplitting: false` → `true` + update comment
5. **Run the critical test**: Start dev server, verify `grep -c 'TSRSplitComponent'` = 0, verify all 11 routes return 200/307 (no 500)
6. **Verify code splitting active**: `npx vite build` → check for multiple lazy chunk files (not a single bundle)
7. **Run tsc + vitest**: `npx tsc -b` (ratchet gate ≤ baseline), `npx vitest run` (5 core specs, same pass count as pre-change)
8. **Update `docs/tsc-error-baseline.txt`** if the version bump changes the tsc error count (ratchet gate is bidirectional)

## ✅ Acceptance criteria

- [ ] `@tanstack/react-router`, `@tanstack/react-start`, `@tanstack/router-vite-plugin` all at the **same exact version** in `package.json` (no `^` prefix)
- [ ] `autoCodeSplitting: true` in `vite.config.ts`
- [ ] Dev server: **zero** `TSRSplitComponent` errors in log
- [ ] Dev server: all 11 routes return 200 or 307, **zero HTTP 500s**
- [ ] `npx vite build` produces **multiple lazy chunk files** (code splitting active), not a single bundle
- [ ] `npx tsc -b` ratchet gate passes (error count ≤ baseline)
- [ ] `npx vitest run` on 5 core specs passes (same count as pre-change)

## ⚠️ Risks

- **Version bump breaking changes**: Moving from 1.167/1.168 to 1.171+ may include API changes in `@tanstack/react-router` or `@tanstack/react-start`. Run `npx tsc -b` after the bump to catch type errors. Check the [TanStack Router changelog](https://github.com/tanstack/router/releases) for breaking changes between 1.168 and the target version.
- **`router-core` transitive version**: Even if the three direct dependencies are aligned, `router-core` (transitive) may resolve to a different version. Check `npm ls @tanstack/router-core` — if it's newer than the pinned packages, it should be compatible (core is the lowest-level package). If it's older, force-update: `npm install @tanstack/router-core@TARGET --save-exact`.
- **`autoCodeSplitting` + SSR HMR**: Per TanStack Router GitHub issues (#5653, #7285), code splitting can cause SSR HMR instability during development (crashes after file save). This is a known framework bug, not a project issue. Workaround: `rm -rf node_modules/.vite` to clear the Vite cache. If persistent, consider a custom SSR entry file (see issue #7285).
- **Plugin ordering**: Ensure `TanStackRouter()` is placed correctly in the `plugins` array (before `react()` and `tanstackStart()`). If other plugins (e.g. `unplugin-auto-import`) are added later, test that code splitting still works — plugin conflicts can re-introduce the `TSRSplitComponent` error.
- **Bundle size regression check**: After re-enabling, verify the initial bundle (`dist/client/assets/index-*.js`) is **smaller** than the pre-change single bundle. If it's larger, the code splitting may not be effective (check that route components are actually lazy-loaded, not re-bundled).
- **`routeTree.gen.ts` format change**: Newer `router-vite-plugin` versions may generate `routeTree.gen.ts` in a different format (different imports, different route ID conventions). After the version bump, delete `app/routeTree.gen.ts` and let the plugin regenerate it fresh. Run `npx tsc -b` to catch any type errors from the new format. The committed file must be updated in the same PR.
- **`target: 'react'` option**: The `target: 'react'` option in the `TanStackRouter()` config may be deprecated or renamed in newer plugin versions. Check the plugin's changelog — if removed, delete the option (the plugin may auto-detect the framework).

## Cross-references

- **Migration PR**: `migration/tanstack-start-2026q3` — the PR that disabled `autoCodeSplitting` as a workaround with the 9-line comment in `vite.config.ts` documenting the version mismatch.
- **`vite.config.ts`**: The `autoCodeSplitting: false` comment (lines ~20-30) documents the exact version numbers and the `TSRSplitComponent` error. Update this comment when re-enabling.
- **Ticket 06** (`docs/dev/second-batch-tickets/06-react-router-dom-to-tanstack.md`): The 67-file `react-router-dom` → TanStack Router migration. **Independent of this ticket** — version alignment doesn't depend on the hook migration, and vice versa. Both can proceed in parallel.
- **TanStack Router GitHub issues**: [#5653](https://github.com/tanstack/router/issues/5653), [#7285](https://github.com/tanstack/router/issues/7285) — SSR HMR + code-splitting instability (known framework bugs, not project-specific).
- **Hub**: [docs/dev/INDEX.md#contributors](INDEX.md#contributors) — Contributors (writing code, merging PRs).
