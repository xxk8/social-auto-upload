# [Ticket 15] Fix case-sensitivity path conflicts (TS1149/TS1261) — `src/components/` vs `src/Components/`

| Field | Value |
|-------|-------|
| **Severity** | P2 — non-fatal (type-check passes with 68 warnings; all errors are about file-name casing, not correctness). Blocks CI tsc-ratchet gate from reaching 0. |
| **Labels** | `migration`, `second-batch-tickets`, `typescript`, `case-sensitivity`, `cleanup` |
| **Surfaced by** | TanStack Start migration — pre-existing errors now visible on `migration/tanstack-start-2026q3` branch after main migration work completed |
| **Blocks** | tsc-ratchet gate reaching 0 baseline. Needed before CI can enforce strict type checking. |
| **Estimated scope** | ~72 unique file references across ~40 import statements. Fix: merge path casing to a single convention. |
| **Depends on** | None |
| **Status** | 🟡 OPEN — classified, fix scope estimated |

---

## Error signature

```
error TS1149: File name '/Users/.../src/components/ui/button.tsx'
differs from already included file name
'/Users/.../src/Components/ui/button.tsx' only in casing.

error TS1261: Already included file name
'/Users/.../src/Components/AiPanel/ChatArea.tsx'
differs from file name
'/Users/.../src/components/AiPanel/ChatArea.tsx' only in casing.
```

Two TypeScript compiler diagnostics fire when the same file path is referenced with inconsistent casing:

- **TS1149**: TypeScript has already resolved, transformed, or emitted a file under a different-cased path, and the new reference's file-name casing differs.
- **TS1261**: A file referenced through `path` mapping or `include` glob has a casing variant that collides with an already-included file.

Both fire because TypeScript's `forceConsistentCasingInFileNames` (default: true in `--strict` / `tsconfig.app.json`) detects that `src/components/...` and `src/Components/...` refer to the same physical file (on macOS case-insensitive FS) but differ in spelling.

---

## Root cause

The project has **two concurrent import conventions**:

| Convention | Examples |
|-----------|----------|
| **Uppercase `Components`** | `import { Button } from '@/Components/ui/button'` |
| **Lowercase `components`** | `import { Button } from '@/components/ui/button'` |

Both resolve to the same directory on macOS (case-insensitive file system), but TypeScript's `forceConsistentCasingInFileNames` catches the mismatch.

### Origins

- The original codebase used `src/Components/` (uppercase `C`).
- During the TanStack Start migration, some auto-migration tools or manual edits introduced `@/components/...` (lowercase `c`) import paths.
- The two conventions now coexist, causing TypeScript to emit TS1149/TS1261 on any file that imports from one convention while another file imports the same module from the other.

### macOS case-insensitivity trap

On macOS (default APFS case-insensitive), `rm -rf src/components` deletes `src/Components/` because the filesystem treats them as identical. This was discovered in the migration PR and resolved by `git checkout HEAD -- src/Components/`. The fix must not rely on deleting either directory — both are the same directory.

---

## Affected files (~72 unique file references)

The errors span all major module trees:

```
src/Components/ui/accordion.tsx
src/Components/ui/alert-dialog.tsx
src/Components/ui/badge.tsx
src/Components/ui/button.tsx
src/Components/ui/card.tsx
src/Components/ui/chip-bar.tsx
src/Components/ui/dialog.tsx
src/Components/ui/empty-state.tsx
src/Components/ui/input.tsx
src/Components/ui/page-header.tsx
src/Components/ui/progress.tsx
src/Components/ui/scroll-area.tsx
src/Components/ui/select.tsx
src/Components/ui/tabs.tsx
src/Components/ui/toast.tsx
src/Components/ui/tooltip.tsx
src/Components/AiPanel/AiPanelToolbar.tsx
src/Components/AiPanel/ChatArea.tsx
src/Components/AiRightPanel/PublishAiSidebar.tsx
src/Components/AiSidebar/AiSidebar.tsx
app/routes/__root.tsx
```

---

## Fix strategy

### Recommended: Standardize on `@/Components/` (uppercase `C`)

The project's original convention is `src/Components/` (uppercase `C`). The fix is to update all `@/components/...` import statements to use `@/Components/...`.

**Steps:**

1. **Find all lowercase imports**: `grep -rn "@/components/" src/ app/ --include='*.ts' --include='*.tsx'` to find every `@/components/...` import
2. **Replace casing**: `sed` or `str_replace` all `@/components/` → `@/Components/` in source files
3. **Verify**: `cd sau_web/frontend && npx tsc --noEmit --project tsconfig.app.json | grep -cE 'TS1149|TS1261'` should return 0
4. **Remove tsconfig check** (optional): If all paths are consistent, consider removing `forceConsistentCasingInFileNames` only as a last resort — better to fix the source.

### Alternative: Lower all to `@/components/`

If the team prefers lowercased paths for aesthetic consistency, reverse the replacement direction. But this would rename ~100 import statements and the physical directory would still be `Components/` — which works on macOS but may cause issues on Linux CI (case-sensitive). Not recommended.

---

## ⚠️ macOS CI caveat

On Linux CI (case-sensitive file system), `@/Components/` will NOT resolve if no physical `src/Components/` directory exists. However, since `src/Components/` IS the actual directory on disk (lowercase `components` is the alias), `@/Components/` works on all platforms. The errors are purely a TypeScript compiler warning, not a runtime issue.

---

## Acceptance criteria

- [ ] `grep -rn "@/components/" src/ app/ --include='*.ts' --include='*.tsx' | grep -v node_modules` returns 0
- [ ] `npx tsc --noEmit --project tsconfig.app.json | grep -cE 'TS1149|TS1261'` returns 0
- [ ] All routes render correctly in dev server (no runtime path-resolution failures)
- [ ] `npx vitest run` on the 5 core specs passes (same pass count as pre-fix)

---

## Cross-references

- **macOS case-insensitivity**: The `rm -rf src/components` incident on `migration/tanstack-start-2026q3` proved that lowercase and uppercase resolve to the same physical directory on APFS. The fix must NOT attempt to delete either directory.
- **`vite.config.ts` resolves `@/` to `src/`**: The Vite alias `'@': path.resolve(__dirname, 'src')` means both `@/Components/` and `@/components/` resolve to `src/Components/` on macOS. On Linux, only the exact-cased variant resolves correctly.
- **Tsconfig.app.json**: The `paths` field has `"@/*": ["./src/*"]` — so `@/Components/` maps to `src/Components/` and `@/components/` maps to `src/components/`. Both work on macOS; only the exact case works on Linux.
- **Hub**: [docs/dev/INDEX.md#contributors](INDEX.md#contributors) — Contributors (writing code, merging PRs).
