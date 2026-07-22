# [Ticket 16] Fix missing test-runner type definitions (TS2593/TS2304) — `beforeEach`/`afterEach`/`describe` not found

| Field | Value |
|-------|-------|
| **Severity** | P3 — non-fatal (test runner globals are available at runtime via `vitest`; errors only fire when `tsc` checks test files against `tsconfig.app.json`). Does NOT block tests from running. |
| **Labels** | `migration`, `second-batch-tickets`, `typescript`, `testing`, `vitest` |
| **Surfaced by** | TanStack Start migration — the `tsconfig.app.json` `include: ["src", "app"]` picks up `*.test.tsx` files, which reference test-runner globals (`beforeEach`, `afterEach`, `describe`, `it`) without vitest types in scope. |
| **Blocks** | tsc-ratchet gate reaching 0 baseline. Needed before CI can enforce strict type checking on test files. |
| **Estimated scope** | ~8 errors across 5 files. Fix: add vitest type reference or create separate tsconfig for tests. |
| **Depends on** | None |
| **Status** | 🟡 OPEN — classified, fix scope estimated |

---

## Error signature

```
src/Components/AiPanel/AiPanel.test.tsx(98,3): error TS2593: Cannot find name 'beforeEach'.
Do you need to install type definitions for a test runner?
Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.

src/Components/AiPanel/AiPanel.test.tsx(335,3): error TS2304: Cannot find name 'afterEach'.

src/features/publish/NoteForm.test.tsx(281,3): error TS2593: Cannot find name 'describe'.
```

- **TS2593**: A function name is used but cannot be resolved to any type declaration.
- **TS2304**: A name cannot be found in the current scope.

Both fire because `tsconfig.app.json` includes test files (`*.test.tsx`) but does not reference `vitest` type declarations. The `vitest` globals (`beforeEach`, `afterEach`, `describe`, `it`, `expect`, `vi`) are only available at runtime via `vitest`'s test runner; TypeScript needs a type declaration to recognize them during static analysis.

---

## Root cause

`tsconfig.app.json` has:

```json
{
  "include": ["src", "app"]
}
```

This includes all files under `src/` and `app/`, **including test files** (`*.test.tsx`). These test files use Vitest globals without importing them explicitly:

```tsx
// No import needed at runtime — vitest injects globals
beforeEach(() => { ... })
afterEach(() => { ... })
describe('Component', () => { ... })
```

But TypeScript doesn't know about these globals unless:
1. The `tsconfig.json` includes `"types": ["vitest/globals"]`, OR
2. A `/// <reference types="vitest/globals" />` triple-slash directive is added to test files, OR
3. A separate `tsconfig.test.json` is used for test files with the vitest types included.

### Why it only surfaced now

Previously, the project may have had a broader `tsconfig.json` or `tsconfig.node.json` that included vitest types. After the TanStack Start migration, the tsconfig structure was simplified to `tsconfig.app.json` (which focuses on browser code) and vitest types were dropped from the `types` array.

---

## Affected files (8 errors across 5 unique files)

| File | Error | Missing name |
|------|-------|-------------|
| `src/Components/AiPanel/AiPanel.test.tsx` | TS2593 (line 98), TS2304 (line 335) | `beforeEach`, `afterEach` |
| `src/Components/AiPanel/AiPanelToolbar.test.tsx` | TS2593 (lines 74, 177, 182) | `beforeEach`, `afterEach` |
| `src/Components/AiSidebar/AiSidebar.tsx` | TS2593 (line 634) | `beforeEach` |
| `src/features/publish/NoteForm.test.tsx` | TS2593 (line 281) | `describe` |
| `src/features/publish/VideoForm.test.tsx` | TS2593 (line 310) | `describe` |

Note: `AiSidebar.tsx` is NOT a test file — it references `beforeEach` in production code, which is suspicious. This should be investigated separately (possibly a stray test utility inlined in the component file).

---

## Fix strategy

### Recommended: Add `vitest/globals` to tsconfig.app.json `types` array

The simplest fix is to add vitest's global type declarations to the tsconfig:

```diff
// tsconfig.app.json
{
  "compilerOptions": {
    "types": [
-     "vite/client"
+     "vite/client",
+     "vitest/globals"
    ],
  },
  "include": ["src", "app"]
}
```

This makes `beforeEach`, `afterEach`, `describe`, `it`, `expect`, `vi`, and all other vitest globals available TypeScript-wide.

**Pros:**
- 1-line change
- No file-by-file modifications
- All test files immediately type-check correctly
- `vitest/globals` is already installed as part of `vitest` (no extra dependency)

**Cons:**
- vitest globals become available in non-test files (production code), which could accidentally compile code that uses `it()` or `describe()` in a bundle. However, this is unlikely to cause real issues since `vitest` globals are `declare`-only and don't inject runtime code.
- If the project has a strict policy of "no test globals in production tsconfig", a separate `tsconfig.test.json` is better.

### Alternative: Triple-slash directives per test file

Add `/// <reference types="vitest/globals" />` to each test file's header:

```tsx
// AiPanel.test.tsx
/// <reference types="vitest/globals" />
import { ... } from '...'
```

**Pros:**
- Explicit per-file declaration — no risk of test globals leaking into production code
- Easy to audit: grep for `vitest/globals` to find all test files

**Cons:**
- Must be added to every test file (~50+ files in the project)
- Easy to forget on new test files
- Each file needs the directive before any code

### Alternative: Separate `tsconfig.test.json`

Create a tsconfig that extends `tsconfig.app.json` but adds vitest types:

```json
// tsconfig.test.json
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

Then run `tsc` for tests with `--project tsconfig.test.json`.

**Pros:**
- Separation of concerns — production code and test code use different tsconfigs
- No type leakage

**Cons:**
- Requires `vitest --config` or `tsc -b` to reference the correct config
- Additional configuration surface

---

## 🧬 `AiSidebar.tsx` anomaly

`src/Components/AiSidebar/AiSidebar.tsx` (line 634) has a `beforeEach` reference in production code. This is highly unusual — `beforeEach` is a test-only function. Possible causes:

1. A test utility was accidentally inlined in the component file
2. A conditional `if (process.env.NODE_ENV === 'test') { beforeEach(...) }` block
3. A stray test fragment from refactoring

**Action**: Investigate and remove or guard the `beforeEach` call in `AiSidebar.tsx`. If it's intentional test helper code, extract it to a separate `src/Components/AiSidebar/AiSidebar.test-utils.ts` file.

---

## Acceptance criteria

- [ ] `npx tsc --noEmit --project tsconfig.app.json | grep -cE 'TS2593|TS2304'` returns 0
- [ ] All 5 affected test files pass with `npx vitest run`
- [ ] `AiSidebar.tsx` `beforeEach` reference is resolved (removed or guarded)
- [ ] No regression in the non-test production code (build succeeds)
- [ ] If using `types: ["vitest/globals"]`, verify no accidental test-global usage in production files

---

## Cross-references

- **`tsconfig.app.json`**: The `types: ["vite/client"]` and `include: ["src", "app"]` fields that need updating.
- **`vitest` config**: Check `vitest.config.ts` or `vite.config.ts` for `globals: true` setting — if vitest's `globals: true` is already set, the types should match. Verify they're in sync.
- **`src/Components/AiSidebar/AiSidebar.tsx`**: Line 634 — the anomalous `beforeEach` reference in production code. Investigate before or alongside this ticket.
- **Hub**: [docs/dev/INDEX.md#contributors](INDEX.md#contributors) — Contributors (writing code, merging PRs).
