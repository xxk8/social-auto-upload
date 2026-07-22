# [Ticket 14] Cluster Z resolved + tsc remnant consolidation — resolution log + assembly guide

| Field | Value |
|-------|-------|
| **Severity** | P3 — informational. Cluster Z (31 TS2307 errors) is already resolved. Contains the assembly guide for the 3 mechanical-fix tickets (11/12/13) and the `docs/tsc-error-baseline.txt` ratchet update. |
| **Labels** | `tsc`, `TS2307`, `consolidation`, `second-batch-tickets`, `ratchet-gate`, `informational` |
| **Parent** | [ticket-10](10-pre-existing-failures-vitest-tsc.md) §🧬 Cluster Z |
| **Status** | ✅ **RESOLVED BY npm install — no code changes needed**. |
| **Estimated scope** | 0 lines of source-code changes. |

---

## Why this exists

Ticket-10's original catalog (2026-07-21) counted 31 TS2307 errors — `Cannot find module '@assistant-ui/react'` — distributed across `src/features/ai-assistant/`. This was a **`node_modules` population artifact**: the doc-only commit `ed889b9a` deliberately avoided `npm install`, so the `@assistant-ui/react` package's type declarations were absent from `node_modules/`, causing TypeScript to fail all imports from that package.

As of the 2026-07-21 fresh sweep (after `npm install` was run for the Cluster X harness wrap), **TS2307 count = 0**. The errors were never real type regressions — they were a missing-dep sandboxing artifact.

This ticket documents that resolution and provides the "assembly guide" for the remaining 3 mechanical-fix tickets to reach **0 tsc errors + 0 vitest failures**.

---

## Prereqs

- `npm install` run (populates `@assistant-ui/react` type declarations)
- `npx tsc --noEmit --project tsconfig.app.json` baseline: **43 total errors** (was 105 in original catalog)

---

## Error count reconciliation: 105 → 43

| Cluster | Original (ticket-10) | Fresh (2026-07-21) | Delta | Reason |
|---------|--------------------:|-------------------:|------:|--------|
| **Z** (TS2307) | 31 | **0** | -31 | Resolved by `npm install` |
| **V** (TS2339) | 24 | **~18** | -6 | Some were TS2307 cascade artifacts |
| **W** (TS7006) | 29 | **~7** | -22 | Most were cascade artifacts from TS2307 / `npm install` updated React Router type inference |
| **U** (TS2353) | 7 | **~8** | +1 | `preflight.ts` had 2 errors, not 1; catalog grew |
| **T** (TS6133) | 5 | **~5** | 0 | Unchanged — pre-existing unused imports |
| **E** (rare) | 6 | **~2** | -4 | TS2741/TS2347 cascade vanished with TS2307 resolution |
| **S** (TS2322) | 3 | **~3** | 0 | Unchanged — pre-existing variant mismatch |
| **Total** | **105** | **~43** | **-62** | |

## Assembly guide

After tickets 11/12/13 land:

| Ticket | Description | Errors | PR order | Diff size |
|--------|-------------|-------:|----------|----------:|
| **11** (Cluster Q) | 3 vitest assertion fixes | 3 vitest fails | First | ≤10 lines |
| **12** (V+U) | Type-def shape: `errorTone`, `contentTemplates`, `valid` → `status` | ~26 tsc | Second | ≤30 lines |
| **13** (W+T+S+E) | Implicit-any annotations + unused-import removal + TS2322 fix | ~17 tsc | Third | ≤20 lines |
| **14** (this ticket) | Cluster Z resolution log + assemble + ratchet update | 0 | Fourth (docs) | 0 lines |

**Final state after all 4 PRs**:

```bash
cd sau_web/frontend
npx vitest run --reporter=default
# Expected: 0 failed, ~2700+ passed (3 fewer than Cluster X post-fix: 3 assertion payloads corrected)

npx tsc --noEmit --project tsconfig.app.json 2>&1 | grep -c 'error TS'
# Expected: 0
```

---

## Ratchet gate update

After tickets 11/12/13 land, update `docs/tsc-error-baseline.txt` from its current value to `0`:

```bash
echo 0 > docs/tsc-error-baseline.txt
git add docs/tsc-error-baseline.txt
```

This is safe because:
- The CI ratchet gate compares delta-not-absolute (baseline shifts down)
- All tsc errors are resolved via the 3 fix PRs above
- No new tsc errors are introduced (all 3 PRs have validation gates)

---

## Troubleshooting

If after landing tickets 11/12/13 the tsc error count is still > 0:

| Error | Likely source | Fix |
|-------|--------------|-----|
| Any remaining TS2307 | A second untyped dependency with missing type declarations | `npm install --save-dev @types/<pkg>` or FIX-B (skipLibCheck) |
| New TS errors from the fix PRs | The type-def changes in ticket-12 may surface new implicit-any sites | Add the annotations as part of ticket-12, not a separate fixup |
| Ratchet gate fails | Baseline file not updated | `cd au_web/frontend/docs && echo 0 > tsc-error-baseline.txt` |

---

## Cross-references

- **Parent ticket**: [ticket-10 §🧬 Cluster Z](10-pre-existing-failures-vitest-tsc.md)
- **`@assistant-ui/react` resolution**: 3 files in `src/features/ai-assistant/` — `MagicSuggestions.tsx`, `AiRuntimeProvider.tsx`, `externalMessageConverter.ts`, `AiAssistantPanel.tsx`
- **Ratchet gate script**: `.github/workflows/ci.yml` → `tsc-ratchet-gate`
- **Baseline file**: `docs/tsc-error-baseline.txt`
- **Hub**: [docs/dev/INDEX.md#contributors](INDEX.md#contributors) — Contributors (writing code, merging PRs).
