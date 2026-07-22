# [Ticket 11] Cluster Q — 4 assertion-error test files (AppShell / routes / publishWizardStore / useChatStore)

| Field | Value |
|-------|-------|
| **Severity** | P2 — blocks clean `npx vitest run` baseline (the remaining 4 assertion failures prevent a zero-fail vitest run after Cluster X was resolved via harness wrap) |
| **Labels** | `bug`, `second-batch-tickets`, `cluster-q`, `vitest-assertion-error`, `≤200-line-diff` |
| **Surfaced by** | ticket-10 §🧬 Cluster Q — the 4 files survived Cluster X culling (213 → 3 vitest fail) because their failures are `AssertionError` (shape mismatch, not `null.useContext`). 3 of 4 are genuine test-data drift; 1 file (routes.test.ts) is clean on fresh run. |
| **Parent** | [ticket-10](10-pre-existing-failures-vitest-tsc.md) §🧬 Root cause hypotheses → Cluster Q |
| **Status** | 🟡 **DOCUMENTED — NOT FIXED** (2026-07-21). 3 files need targeted assertion fixes. |
| **Estimated scope** | ~30 min — 1 line per failing assertion in 3 files. |

---

## Why this exists

After Cluster X was resolved (I18nextProvider harness wrap in `src/test/setup.ts` drove 213 → 3 vitest failures), 4 files remained. 1 of those 4 (routes.test.ts) is now **passing on fresh `npx vitest run`** — the `expect(14).toBe(12)` count mismatch was an artifact of the Layer-C cascade blocking the Router mount. The remaining 3 files have real assertion mismatches, documented below.

---

## Prereqs

- Cluster X harness wrap already landed in `src/test/setup.ts` (I18nextProvider `vi.mock`)
- `npx vitest run` baseline: 87 tests across 4 files, 3 fail, 84 pass

---

## Inventory

### 1. `src/stores/publishWizardStore.test.tsx` (2 failures)

**Test**: `parses legacy full-width comma `，` wire form`
```
Expected: ['#foo', '#bar', '#baz']
Received: ['#foo，#bar，#baz']
```
The parsing logic treats full-width commas as part of the tag text rather than a separator. Likely cause: the `split()` regex only matches `,` (U+002C) but the wire data uses `，` (U+FF0C, full-width comma).

**Test**: `drops empty tokens from legacy mixed string`
```
Expected: ['#foo', '#bar']
Received: ['#foo  #bar']
```
Empty-token filtering is not splitting on the space-delimited pattern. The double-space between `#foo` and `#bar` was not treated as a separator.

**Scope**: ≤200-line diff. Either:
- **Fix-A**: normalize full-width `，` → ASCII `,` before the split
- **Fix-B**: update the `expect()` values to match the current store behaviour (if the full-width behaviour is intentional)

### 2. `src/stores/useChatStore.test.tsx` (1 failure)

**Test**: `records formContextAtSend verbatim`
```
Expected: tags: ''
Received: tags: []
```
The `formContextAtSend.tags` is an empty array `[]` but the test expects an empty string `''`. Likely cause: the store's `formContextAtSend` initializes `tags` as `[]`, but the assertion was written when it was `''` (pre-refactor type change).

**Scope**: 1-line fix. Change `tags: ''` → `tags: []` in the test's expected object.

### 3. `src/AppShell.test.tsx` — PASSED on fresh run

Previously catalogued under Cluster Q as an assertion-failure orphan, but on re-run after Cluster X fix, all 36 tests in AppShell test suite pass. The original failure was a Layer-C cascade artifact, not a real assertion mismatch.

### 4. `src/routes.test.ts` — PASSED on fresh run

Same story as AppShell.test.tsx. All 27 tests pass. The `expect(14).toBe(12)` failure from the initial catalog was a Router-context artifact from the Layer-C cascade.

---

## Fix scope summary

| File | Failures | Fix description | Est. diff size |
|------|---------:|-----------------|---------------:|
| `publishWizardStore.test.tsx` | 2 | Normalize full-width comma OR update expectation values | 3–5 lines |
| `useChatStore.test.tsx` | 1 | Align `tags` type: `''` → `[]` | 1 line |
| `AppShell.test.tsx` | 0 | Already passing — no changes needed | 0 lines |
| `routes.test.ts` | 0 | Already passing — no changes needed | 0 lines |

**Total**: ≤10-line diff across 2 files. ≤30 min.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `publishWizardStore.test.tsx` — comma split fails | Regex only matches ASCII `,` | Add `，` to split pattern or normalize input upstream |
| `useChatStore.test.tsx` — `tags: ''` vs `[]` | Store typed `tags` as array, test as string | Align expected value |

---

## Validation gate

```bash
cd sau_web/frontend
npx vitest run --reporter=default \
  src/stores/publishWizardStore.test.tsx \
  src/stores/useChatStore.test.tsx
# Expected: 0 failed, X passed
```

---

## Cross-references

- **Parent ticket**: [ticket-10 §🧬 Cluster Q](10-pre-existing-failures-vitest-tsc.md)
- **Cluster X resolution**: `src/test/setup.ts` (I18nextProvider `vi.mock` harness wrap — the precondition for seeing Q failures without Layer-C noise)
- **Full inventory**: ticket-10 §📊 Failure inventory (42 files, 213 cases original)
- **Prev ticket-10 accuracy note**: the initial Cluster Q catalog listed 7 files; 3 of those were Layer-C artifacts that resolved after Cluster X fix. The 4 real Q-orphans above are the ground truth.
- **Hub**: [docs/dev/INDEX.md#contributors](INDEX.md#contributors) — Contributors (writing code, merging PRs).
