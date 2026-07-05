// ──────────────────────────────────────────────────────────────────────────
// test-utils/TestProviders.tsx
//
// Shared test helper that wraps children in cross-cutting contexts
// needed by SLICE-INTEGRATION tests (round-OPT-prefs-dialog v8 +
// v6 inherited pattern).
//
// Currently wraps in `MemoryRouter` only. The rationale: any
// future dashboard that mounts `<ConfirmDialogProvider>` at
// AppShell + later needs a `useNavigate()` inside a dispatch
// callback (e.g. Provider mode that navigates after confirming
// publish) will already have router context live. Adding the
// wrap now means the migration is zero-cost.
//
// Future growth scope (add here, NOT in individual test files):
//   • `<ThemeProvider>` (when slimmer slices grow theme-coupled
//     affordances — patch the slice-comment-level rationale at
//     decoration time).
//   • `<AuthProvider>` (when a future slice needs the user/
//     permission context that the AppShell mounts).
//   • `<ToastProvider>` (when the dispatch returns success/
//     failure toasts — the v6 AiSidebar inline `addToast` could
//     grow a Provider-mode equivalent routed through this.)
//
// Keeping the helper small: each wrapper added here also adds
// a new test for that wrapper's contract — typically those
// tests live in `test-utils/__tests__/` once the helper's
// scope outgrows the slice-integration tests.
// ──────────────────────────────────────────────────────────────────────────

import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

interface TestProvidersProps {
  children: ReactNode
  /** Initial router entry path. Default `/`. */
  initialPath?: string
}

export function TestProviders({
  children,
  initialPath = '/',
}: TestProvidersProps) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  )
}
