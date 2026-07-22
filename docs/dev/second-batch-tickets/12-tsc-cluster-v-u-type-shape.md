# [Ticket 12] tsc Clusters V + U — type-def shape mismatch (TS2339 + TS2353, ~26 errors)

| Field | Value |
|-------|-------|
| **Severity** | P2 — 26 TypeScript errors block achieving zero `tsc` error count on `main`. The CI ratchet gate gates delta, not absolute, so CI doesn't flash red — but every developer running `tsc --noEmit` (or an IDE with on-save typecheck) sees 26 distraction errors that obscure real type regressions. |
| **Labels** | `tsc`, `type-defs`, `TS2339`, `TS2353`, `second-batch-tickets`, `≤200-line-diff` |
| **Surfaced by** | ticket-10 initial catalogue (24 TS2339 + 7 TS2353 = 31 originally); some resolved by `npm install` (updated type definitions), 26 remain as of 2026-07-21 fresh sweep. |
| **Parent** | [ticket-10](10-pre-existing-failures-vitest-tsc.md) §🧬 Cluster V + Cluster U |
| **Status** | 🟡 **DOCUMENTED — NOT FIXED** (2026-07-21). 2 clusters across ~8 source files. |
| **Estimated scope** | ~1.5 hr — ~26 errors across ~8 files. |

---

## Why this exists

Two clusters catalogued in ticket-10 as originally separate (V: TS2339 property-doesn't-exist, U: TS2353 excess-property) share the same root cause: **type definitions in the store/API layer were written before the fields they reference**, or the test data was never updated after a field was renamed/removed. Both surface as "shape mismatch" — the type checker sees a contract the runtime code violates.

**Delta from original catalog**: of the original 31 errors (24 TS2339 + 7 TS2353), ~5 were TS2307-cascade artifacts resolved when `npm install` populated `@assistant-ui/react` type declarations. Net remaining: 26.

---

## Prereqs

- `npx tsc --noEmit --project tsconfig.app.json` baseline counted
- Node modules populated (no TS2307 missing-module blockers remaining)

---

## Inventory

### Cluster V (TS2339, ~18 errors) — property-doesn't-exist on type

| File | Errors | Missing property | Likely fix |
|------|-------:|-----------------|------------|
| `src/stores/useLicenseStore.test.ts` | 13 | `errorTone` not on `LicenseSnapshot` | Add `errorTone` to `LicenseSnapshot` type def OR update test expectations |
| `src/features/publish/ContentTemplatePicker.tsx` | 5 | `contentTemplates` not on `api` type | Add `contentTemplates` to the API client type definition |

**Root cause**: `errorTone` was added to the store's runtime state but the `LicenseSnapshot` type def was not extended to include it. Similarly, `api.contentTemplates` is called in the component but the API client type was not updated after the content-templates feature was extracted into its own namespace.

**Fix-A** (recommended): Add the missing fields to the type definitions.
**Fix-B**: Remove the test assertions referencing the missing field (if the field is intentionally removed from production).

### Cluster U (TS2353, ~8 errors) — excess-property check

| File | Errors | Excess property | Likely fix |
|------|-------:|-----------------|------------|
| `src/features/publish/preflight.test.ts` | 6 | `valid: true` in `PlatformAccountMapping` | Rename `valid` → `status: 'ok'` or similar canonical field name |
| `src/features/publish/preflight.ts` | 2 | Same `valid` field in `mappingHealth()` return | Align the return-shape with `PlatformAccountMapping` type |

**Root cause**: `preflight.ts`'s `mappingHealth()` returns an object with a `valid` field, but `PlatformAccountMapping` (defined in `GroupPublishSelector.tsx`) doesn't expose a `valid` property. The field was likely renamed during a schema refactor from `valid` to `status: 'ok' | 'stale' | 'invalid'`.

---

## Fix scope summary

| Cluster | Errors | Fix description | Est. diff size |
|---------|-------:|-----------------|---------------:|
| V | ~18 | Add `errorTone` to `LicenseSnapshot` type + add `contentTemplates` to API client type | 5–10 lines |
| U | ~8 | Rename `valid` → correct field name in `preflight.test.ts` + `preflight.ts` | 3–5 lines |

**Total**: ≤30-line diff across ~8 source files. ~1.5 hr.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Property 'errorTone' does not exist on type 'LicenseSnapshot'` | `errorTone` field exists at runtime but type was never extended | Add `errorTone?: 'default' | 'info' | 'error'` to `LicenseSnapshot` |
| `Object literal may only specify known properties, and 'valid' does not exist in type 'PlatformAccountMapping'` | `preflight.ts` returns `{ valid: true }` but type expects `status: 'ok'` | Rename `valid` → `status` in both source and tests, matching the canonical type |

---

## Validation gate

```bash
cd sau_web/frontend
# After fix — count Cluster V + U errors (should be 0)
npx tsc --noEmit --project tsconfig.app.json 2>&1 | grep -cE 'TS2339|TS2353'
# Expected: 0
```

---

## Cross-references

- **Parent ticket**: [ticket-10 §🧬 Cluster V + Cluster U](10-pre-existing-failures-vitest-tsc.md)
- **Type-def source**: `src/stores/useLicenseStore.ts` (LicenseSnapshot) + `src/features/publish/GroupPublishSelector.tsx` (PlatformAccountMapping) + `src/api/client.ts` (API client type)
- **Deliverable note**: Cluster Z (TS2307, 31 errors) was resolved by `npm install` and does not need a separate ticket. See ticket-14 for the resolution log.
- **Hub**: [docs/dev/INDEX.md#contributors](INDEX.md#contributors) — Contributors (writing code, merging PRs).
