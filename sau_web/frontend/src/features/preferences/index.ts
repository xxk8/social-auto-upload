// ──────────────────────────────────────────────────────────────────────────
// features/preferences/index.ts
//
// Public barrel — single import path for the entire preferences slice.
//
// Round-opt-prefs-dialog v5 (barrel migration): previous round split
// the slice into a <PreferencesDialogProvider /> + <PreferencesDialog>
// + 4 tabs/<Tab> + shared/ helpers pyramid. v5 collapses the
// consumer surface into a single re-export path so any shell —
// AppShell sidebar, mobile AppBar, future command-palette — that
// wants to mount the dialog + its 4 tabs and access the API gets
// ONE import statement:
//
//     import {
//       AccountTab,
//       SettingsTab,
//       PersonalizationTab,
//       AboutTab,
//       PreferencesDialog,
//       PreferencesDialogProvider,
//       usePreferencesDialog,
//       type PreferencesTab,
//       type PreferencesDialogState,
//     } from '@/features/preferences'
//
// ── What's NOT re-exported (and why): ────────────────────────────────────
//
// • `tabs/*.tsx` sub-paths — internal-only; consumers import the
//   named `AccountTab` etc. via THIS barrel. Re-exporting the
//   sub-paths would let a future PR reach inside the slice
//   capsule to grab a single tab (e.g. `from
//   '@/features/preferences/tabs/AccountTab'`) which silently
//   SPLITS the consumer from the barrel contract — keep them
//   opaque.
//
// • `shared/{payments,themes,InfoRow}` — internal helpers (TIER_MAP,
//   THEMES, InfoRow). Same rationale: keep the slice hierarchy
//   opaque; consumers reach the content via the tabs, not the
//   helpers.
//
// • `PreferencesDialogProvider.helpers` — pure-types module that
//   `Provider.tsx` imports INTERNALLY. Consumers who need
//   `PreferencesTab` get the re-exported `type` here instead of
//   reaching into the helpers file directly. The internal
//   types-only module is a Fast Refresh implementation concern.
//   (`AccountsProvider.helpers.ts` similarly isn't re-exported via
//   `features/accounts/index.ts` — same convention.)
//
// • `PreferencesDialogContext` — PRIVATE const inside Provider.tsx
//   (not exported). Consumers use `usePreferencesDialog()` as the
//   public API surface; the React Context is an implementation
//   detail.
//
// • The Dialog source file itself (`PreferencesDialog.tsx`) —
//   consumers use the named `PreferencesDialog` re-export, NOT the
//   internal source path. Same convention as tabs.
//
// ── Test file note ──────────────────────────────────────────────────────
//
// Three test files (PreferencesDialog.test.tsx, UserMenu.test.tsx,
// AppShell.test.tsx) intentionally KEEP their sub-path imports for
// `vi.mock('@/features/preferences/PreferencesDialogProvider', ...)`.
// Mocking the barrel would replace ALL exports (tabs + dialog +
// provider + hook) atomically, breaking test isolation. Sub-path
// mocks are the canonical escape hatch.
// ──────────────────────────────────────────────────────────────────────────

export { OverviewTab } from './tabs/OverviewTab'
export { AccountTab } from './tabs/AccountTab'
export { SettingsTab } from './tabs/SettingsTab'
export { PersonalizationTab } from './tabs/PersonalizationTab'
export { AboutTab } from './tabs/AboutTab'

export { PreferencesDialog } from './PreferencesDialog'

export {
  PreferencesDialogProvider,
  usePreferencesDialog,
} from './PreferencesDialogProvider'

export type {
  PreferencesTab,
  PreferencesDialogState,
} from './PreferencesDialogProvider.helpers'
