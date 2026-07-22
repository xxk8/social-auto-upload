# [Ticket 13] tsc Cluster W + mechanical siblings — implicit-any + unused imports + type mismatch (~17 errors)

| Field | Value |
|-------|-------|
| **Severity** | P2 — 17 TypeScript errors across 4 sub-clusters (W: TS7006 implicit-any, T: TS6133 unused import, S: TS2322 type mismatch, E: rare-class orphans). All are mechanical, one-line-per-error fixes. |
| **Labels** | `tsc`, `implicit-any`, `TS7006`, `TS6133`, `TS2322`, `second-batch-tickets`, `≤200-line-diff` |
| **Surfaced by** | ticket-10 §🧬 Cluster W/T/S/E — survived Cluster X culling (not Layer-C-cascade); 17 errors remain after `npm install` resolved Cluster Z cascade artifacts |
| **Parent** | [ticket-10](10-pre-existing-failures-vitest-tsc.md) §🧬 Cluster W, Cluster T, Cluster S, Cluster E |
| **Status** | 🟡 **DOCUMENTED — NOT FIXED** (2026-07-21). 4 sub-clusters across ~12 source files. |
| **Estimated scope** | ~1 hr — mechanical `sed`-style fixes. |

---

## Why this exists

Four small tsc error clusters from ticket-10's original catalog survived the Cluster X resolution. Unlike Clusters V/U (type-def shape changes, ticket-12), these are **mechanical air leaks** — no design decisions, just plain missing type annotations, leftover unused imports after a refactor, and one variant-collision.

**Delta from original catalog**: Cluster W was 29 errors; ~17 resolved via `npm install` (updated React Router type inference reduced implicit-any incidence). Rare-class E errors (TS2741, TS2347) were Layer-C artifacts and are gone entirely. Remaining: 7 errors in W, plus 5 TS6133 + 3 TS2322 + 2 other mechanical → ~17 total.

---

## Prereqs

- `npx tsc --noEmit --project tsconfig.app.json` baseline counted
- No TS2307 missing-module blockers

---

## Inventory

### Cluster W (TS7006, ~7 errors) — implicit any parameter

| File | Errors | Sample error |
|------|-------:|--------------|
| `src/features/tasks/TaskTable.tsx` | 4 | `Parameter 'task' implicitly has an 'any' type.` at render-prop callbacks |
| `src/features/tasks/BatchImportDialog.tsx` | 2 | `Parameter 'e' implicitly has an 'any' type.` at event handler |
| `src/features/publish/SchedulingDialog.tsx` | 1 | `Parameter 'option' implicitly has an 'any' type.` at map callback |

**Fix**: Add inline type annotations (`task: TaskItem`, `e: React.ChangeEvent<HTMLInputElement>`, `option: SelectOption`). Each is a ~3-char insertion at the parameter position.

### Cluster T (TS6133, ~5 errors) — unused imports

| File | Error | Unused symbol |
|------|-------|--------------|
| `src/Components/motion/drawer.test.tsx` | 2 | `Badge` imported from `@/Components/ui/badge` but never referenced |
| `src/stores/inboxResume.test.tsx` | 1 | `wizard` imported but unused |
| `src/test-utils/MemoryRouter.tsx` | 1 | unused type import |
| `src/Pages/TasksPage.tsx` | 1 | unused component import |

**Fix**: `sed`-style removal of the unused import line. Each is a 1-line deletion.

### Cluster S (TS2322, ~3 errors) — type mismatch

| File | Error | Detail |
|------|-------|--------|
| `src/Pages/LoginAuthPage.tsx` | 3 | `"danger"` button variant not assignable to `"primary" | "secondary" | "ghost"` |

**Fix**: The Login button variant `"danger"` was a one-off that is no longer in the Button component's variant union. Either add `"danger"` back to the Button type, or change the call site to use `variant="secondary"` + custom styling. 1-line fix regardless.

### Cluster E (rare-class, ~2 errors) — survivors

| File | Error | Detail |
|------|-------|--------|
| `src/Components/motion/drawer.test.tsx` | 1 | TS2741 (property missing in object literal) |
| `src/Pages/TasksPage.tsx` | 1 | TS2304 (cannot find name) |

These are file-level stragglers that survived the Cluster E cascade collapse.

---

## Fix scope summary

| Sub-cluster | Errors | Fix description | Est. diff size |
|-------------|-------:|-----------------|---------------:|
| W (TS7006) | ~7 | Annotate parameter types in 3 task/scheduling files | 7 lines |
| T (TS6133) | ~5 | Delete unused import lines in 4 files | 5 lines |
| S (TS2322) | ~3 | Add `"danger"` to Button type OR change variant | 1 line |
| E (rare) | ~2 | Fix remaining TS2741/TS2304 in drawer.test.tsx + TasksPage.tsx | 2 lines |

**Total**: ≤20-line diff across ~12 files. ~1 hr.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Parameter 'task' implicitly has an 'any' type.` in TaskTable.tsx | React 19's stricter callback inference: props passed to child components without explicit typing fall through to `any` | `{tasks.map((task: TaskItem) => ...)}` |
| `'Badge' is declared but its value is never read` | Round-OPT-footer refactor removed Badge usage but kept the import | `sed -i "/import { Badge }/d" drawer.test.tsx` |
| `"danger" not assignable to "primary" \| "secondary" \| "ghost"` | Button variant type narrowed; `danger` variant removed during Radix migration | `variant="secondary"` or add `"danger"` back |

---

## Validation gate

```bash
cd sau_web/frontend
# After fix — count remaining cluster errors (should be 0)
npx tsc --noEmit --project tsconfig.app.json 2>&1 | grep -cE 'TS7006|TS6133|TS2322|TS2741|TS2304'
# Expected: 0
```

---

## Cross-references

- **Parent ticket**: [ticket-10 §🧬 Cluster W, T, S, E](10-pre-existing-failures-vitest-tsc.md)
- **Button variant type**: `src/Components/ui/button.tsx` — the `variant` union type
- **Task types**: `src/features/tasks/types.ts` — `TaskItem`, `TaskGroup`, etc.
- **Deliverable note**: Cluster Z (TS2307, 31 errors) was resolved by `npm install` and does not need a separate ticket. See ticket-14 for the resolution log.
- **Hub**: [docs/dev/INDEX.md#contributors](INDEX.md#contributors) — Contributors (writing code, merging PRs).
