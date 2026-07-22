// ──────────────────────────────────────────────────────────────────────────
// Components/OnboardingTour.helpers.ts — `react-refresh/only-export-components`
// allow-list.
//
// Companion to `Components/OnboardingTour.tsx`. The only value-level
// non-component export from the original was `resetOnboardingTour()` (a
// public, callable reset hook for re-triggering the tour from any UI
// surface). The three local tour-storage primitives it depends on
// (`STORAGE_KEY`, `TOUR_DONE_EVENT`, `TOUR_RESET_EVENT`) moved with it so
// the hook and the strings stay on the same side of the boundary; the
// trimmed `.tsx` imports them back for its `beforeClose` closure and event
// listeners.
//
// Consumers update:
//   - `<OnboardingTour>` from `@/components/OnboardingTour` (unchanged)
//   - `resetOnboardingTour()` from `@/components/OnboardingTour.helpers`
// ──────────────────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'sau-onboarding-done'
export const TOUR_DONE_EVENT = 'sau-tour-done'
export const TOUR_RESET_EVENT = 'sau-tour-reset'

/**
 * Public reset hook — call from anywhere (settings, sidebar footer, etc.)
 * to clear the localStorage flag and immediately reopen the tour.
 */
export function resetOnboardingTour() {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event(TOUR_RESET_EVENT))
}
