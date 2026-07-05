// ──────────────────────────────────────────────────────────────────────────
// preferences/PreferencesDialogProvider.helpers.ts
//
// Pure-types module — NO React, NO React hooks, NO context object.
//
// Round-opt-prefs-dialog v4 (slice extraction): renamed from the
// old `PreferencesDialogContext.tsx` which co-existed the Provider
// + the Context + the hook in a single file and tripped Fast
// Refresh's `react-refresh/only-export-components` rule. v4 split
// to the canonical pattern matched by `AccountsProvider.tsx` +
// `AccountsProvider.helpers.ts`:
//
//   • `PreferencesDialogProvider.tsx` — Provider component +
//     PUBLIC `usePreferencesDialog` hook + private (non-exported)
//     `PreferencesDialogContext` object. Fast Refresh sees only
//     React-shaped payloads (component + hook) here, satisfying the
//     eslint-loader rule.
//
//   • `PreferencesDialogProvider.helpers.ts` (THIS FILE) —
//     pure types only. No React. Mirrors `AccountsProvider.helpers.ts`
//     which similarly carries domain types (`Tier` / `TierKey` /
//     `UpdatableAccount`) WITHOUT any React hook or context object.
//
// Consumer import surface (now a SINGLE path per consumer):
//   • Before v4: 2 lines
//       `import { <Provider />} from '.../PreferencesDialogProvider'`
//       `import { usePreferencesDialog } from '.../PreferencesDialogProvider.helpers'`
//   • After v4:  1 line
//       `import { <Provider />, usePreferencesDialog } from '.../PreferencesDialogProvider'`
//     Plus, types-only consumers (e.g. the moved
//     `PreferencesDialog.test.tsx` type-import of `PreferencesTab`)
//     import from THIS file alone — no need to import the Provider
//     module for a pure-type reference.
// ──────────────────────────────────────────────────────────────────────────

export type PreferencesTab =
  | 'account'
  | 'settings'
  | 'personalization'
  | 'about'

export interface PreferencesDialogState {
  /** Whether the modal is mounted & visible. */
  open: boolean
  /** Which tab the modal is currently displaying. */
  activeTab: PreferencesTab
  /** Open + set the active tab (defaults to 'account'). */
  openPreferences: (tab?: PreferencesTab) => void
  /** Close the modal. Does NOT clear activeTab — preserved so the
   * next open() with no tab argument resumes on the last tab the
   * operator was reading. */
  closePreferences: () => void
  /** Imperative tab-switch used by the left-nav rows inside the
   * modal. Stays a thin setter so the modal re-renders cheaply. */
  setActiveTab: (tab: PreferencesTab) => void
}
