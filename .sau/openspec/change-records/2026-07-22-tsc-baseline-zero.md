# Baseline Shift: tsc-error-baseline 46 → 0

**Date:** 2026-07-22
**Trigger:** TanStack Start migration (branch `migration/tanstack-start-2026q3`)
**Baseline file:** `docs/tsc-error-baseline.txt`
**Previous value:** 46
**New value:** 0

## Summary

All 46 pre-existing TypeScript compilation errors in `sau_web/frontend/` were resolved as part of the React Router → TanStack Start migration. The `tsc-ratchet-gate` CI job now enforces a zero-error baseline.

## Error categories resolved

| Category | Error codes | Count | Files touched |
|----------|-------------|-------|---------------|
| Missing type fields | TS2339 | 13 | `useLicenseStore.ts` (`errorTone` on `LicenseState`) |
| Missing optional props | TS2353 | 6 | `GroupPublishSelector.tsx` (`valid?`/`stale?` on `PlatformAccountMapping`) |
| Property access on missing type | TS2339 | 2 | `preflight.ts` (reads `m.valid`/`m.stale`) |
| Unused imports | TS6133 | 5 | `ContentTemplatePicker.tsx` (Badge), `TaskTable.tsx` (Badge/Tooltip×3) |
| Missing required props | TS2741 | 2 | `drawer.test.tsx` (`children` on `<Drawer>`) |
| Cannot find name | TS2304 | 1 | `TasksPage.tsx` (`Loader2` not imported) |
| Wrong union literal | TS2322 | 3 | `SchedulingDialog.tsx`, `BatchImportDialog.tsx` (Badge `variant="default"` → `"info"`) |
| Missing API methods | TS2339 | 4 | `publish.ts` (`contentTemplates.*` stubs) |
| Missing API methods | TS2339 | 2 | `publish.ts` (`scheduling.*` stubs) |
| Missing API methods | TS2339 | 2 | `tasks.ts` (`batchImport`/`downloadBatchTemplate`) |
| Missing store action | TS2339 | 1 | `publishWizardStore.ts` (`setSchedule`) |
| Module not found | TS2307 | 2 | `inboxResume.ts` (created), `MemoryRouter.tsx` (`@tanstack/react-router` installed) |
| Wrong argument count | TS2554 | 1 | `inboxResume.ts` (`inboxTranscribeStream` missing `onError`) |
| Re-export wiring | — | ~4 | `client.ts` (barrel re-exports for new API methods) |

## Files modified (14 total)

1. `src/stores/useLicenseStore.ts` — added `errorTone` type field + initial state
2. `src/features/publish/GroupPublishSelector.tsx` — added `valid?`/`stale?` to `PlatformAccountMapping`
3. `src/features/publish/ContentTemplatePicker.tsx` — removed unused `Badge` import
4. `src/Components/motion/drawer.test.tsx` — added `children={null}` to 2 `<Drawer>` renders
5. `src/Pages/TasksPage.tsx` — added `Loader2` to lucide-react import
6. `src/features/tasks/TaskTable.tsx` — removed 4 unused symbol imports
7. `src/features/publish/SchedulingDialog.tsx` — Badge variant `'default'` → `'info'`
8. `src/features/tasks/BatchImportDialog.tsx` — Badge variant `'default'` → `'info'` (2 sites)
9. `src/api/publish.ts` — added `contentTemplates` CRUD + `scheduling` stubs
10. `src/api/tasks.ts` — added `batchImport` + `downloadBatchTemplate`
11. `src/api/client.ts` — re-exported new API methods on merged `api` object
12. `src/stores/publishWizardStore.ts` — added `setSchedule(schedule: string)` to interface + impl
13. `src/stores/inboxResume.ts` — NEW FILE: `resumeInterruptedDownloads` + `__resetResumeGuard`
14. `sau_web/frontend/package.json` — added `@tanstack/react-router` devDep

## Verification

```bash
cd sau_web/frontend && npx tsc --noEmit --project tsconfig.app.json 2>&1 | grep -c 'error TS'
# Output: 0
```

## Impact on CI

The `tsc-ratchet-gate` job in `.github/workflows/ci.yml` compares the error count against `docs/tsc-error-baseline.txt`. With the baseline now at 0, any new TypeScript error will fail CI. Future PRs that introduce type errors must either fix them or update the baseline with a corresponding change record.
