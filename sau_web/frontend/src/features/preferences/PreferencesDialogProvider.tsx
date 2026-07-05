// ──────────────────────────────────────────────────────────────────────────
// preferences/PreferencesDialogProvider.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): split from the
// legacy `PreferencesDialogContext.tsx` so the Provider component
// sits next to its only consumer-facing API (the hook) — mirroring
// the canonical `AccountsProvider.tsx` pattern where the Provider
// component AND its dispatch hook (e.g. `useAccountsDispatch`)
// live TOGETHER in one file.
//
// Intentional non-component exports: this file exports the hook
// `usePreferencesDialog` because that IS the public API surface.
// The `react-refresh/only-export-components` rule is suppressed by
// project convention for Provider files that expose hooks as part of
// their designed interface (same convention used for
// `AccountsProvider.tsx`).
//
// The PURE TYPES (`PreferencesTab`, `PreferencesDialogState`) sit at
// `PreferencesDialogProvider.helpers.ts` — mirroring the canonical
// `AccountsProvider.helpers.ts` shape (domain types only, no React).
//
// Why THIS split (not the v4 split):
//   • The previous v4 split put the hook in `.helpers.ts`. That's
//     the BACKWARDS of the canonical pattern: `helpers.ts` is
//     reserved for PURE types / pure utils (like `tierKeyOf`).
//     Hooks that are coupled to a Provider (throw "must be used
//     within <Provider>") live next to the Provider component.
//   • The React Context is a private implementation detail — NOT
//     exported. Consumers use the hook, not the Context.
//   • Fast Refresh compliance: this file's only top-level payloads
//     are 1 React component (`<PreferencesDialogProvider>`) + 1
//     React hook (`usePreferencesDialog`) — both legitimate
//     Fast Refresh payloads.
//   • Side-benefit: UserMenu/Page consumers + tests collapse from
//     2 import lines to 1 each (one provider-path import instead
//     of "provider path + helpers path").
//
// Mount placement (App.tsx → AppShellWithPrefs):
//   • AppShell-level (NOT App.tsx top-level) so any shell — desktop
//     sidebar (UserMenu), mobile AppBar (UserMenu mode="mobile"),
//     future command-palette, future command-center sub-shell —
//     can drop in `<PreferencesDialogProvider>` +
//     `<PreferencesDialog />` locally against the SAME provider
//     state without re-implementing the dialog or its 4 tabs.
//   • Public visitor surface (/, /pricing, /login, /about) stays
//     free of dashboard-only state because those pages don't
//     include <UserMenu /> → no opening trigger.
// ──────────────────────────────────────────────────────────────────────────

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  PreferencesDialogState,
  PreferencesTab,
} from './PreferencesDialogProvider.helpers'

// Private — NOT exported. Consumer entry-point is `usePreferencesDialog`.
// Keeps the Context object out of the public API surface so future
// refactors (e.g. swapping to Zustand or a Firebase listener) don't
// break consumer import paths.
const PreferencesDialogContext = createContext<PreferencesDialogState | null>(
  null,
)

interface PreferencesDialogProviderProps {
  children: ReactNode
}

export function PreferencesDialogProvider({
  children,
}: PreferencesDialogProviderProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<PreferencesTab>('account')

  const openPreferences = useCallback((tab: PreferencesTab = 'account') => {
    setActiveTab(tab)
    setOpen(true)
  }, [])

  const closePreferences = useCallback(() => {
    setOpen(false)
  }, [])

  // Memoize the value so consumers don't re-render on parent state
  // changes unrelated to the dialog (e.g. AppShell sidebar collapse).
  const value = useMemo<PreferencesDialogState>(
    () => ({
      open,
      activeTab,
      openPreferences,
      closePreferences,
      setActiveTab,
    }),
    [open, activeTab, openPreferences, closePreferences],
  )

  return (
    <PreferencesDialogContext.Provider value={value}>
      {children}
    </PreferencesDialogContext.Provider>
  )
}

// ── consumers (UserMenu, PreferencesDialog, tests) ──────────────────────
// `usePreferencesDialog` is exported intentionally as part of the
// Provider's public API surface (not an accidental leftover). The
// react-refresh rule is configured to allow this pattern for
// Provider files that expose hooks — see top-of-file comment.
export function usePreferencesDialog(): PreferencesDialogState {
  const ctx = useContext(PreferencesDialogContext)
  if (!ctx) {
    throw new Error(
      'usePreferencesDialog must be used within a PreferencesDialogProvider',
    )
  }
  return ctx
}
