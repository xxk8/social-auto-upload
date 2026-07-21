import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── mocks ────────────────────────────────────────────────────────────

// Stub the accounts context hooks — the real useAccountsState /
// useAccountsDispatch read from a context that requires the full
// AccountsProvider tree (query client + account groups hooks).
// For a focused i18n test we only need the surface state + dispatch
// methods called from the component.
//
// IMPORTANT: `state.searchQuery` is set to a non-empty string so
// the conditional `{localSearch && <button>}` for clear_search
// evaluates true and the clear_search button is rendered. Without
// this, the tSpy assertion for `accounts.toolbar.clear_search`
// would never fire.
vi.mock('./AccountsProvider', () => ({
  useAccountsState: () => ({
    searchQuery: 'test',
    selectedIds: new Set<number>(),
    filteredGroups: [{ id: 1 }, { id: 2 }], // non-empty so allSelected = false
    validityFilter: 'all' as const,
    isReorderInFlight: false,
    viewMode: 'grid' as const,
  }),
  useAccountsDispatch: () => ({
    setSearchQuery: vi.fn(),
    handleClearSearch: vi.fn(),
    setValidityFilter: vi.fn(),
    setBatchDeleteOpen: vi.fn(),
    setSelectedIds: vi.fn(),
    handleSelectAll: vi.fn(),
    setViewMode: vi.fn(),
  }),
}))

// Stub react-i18next with tSpy (mirrors the SortableAuthorizationItem
// pattern). The component calls t() for 3 aria-labels:
//   - accounts.toolbar.clear_search (only when localSearch truthy)
//   - accounts.toolbar.grid_view (always)
//   - accounts.toolbar.list_view (always)
//
// `tSpy` is hoisted via `vi.hoisted` so the vi.fn is available
// before the vi.mock factory runs. Tests then assert on `tSpy`
// to pin the i18n KEY PATH, not just the fallback string — a
// future refactor that renames any of the 3 keys would fail the
// spy assertion, catching the key drift between the component
// and the locale bundles.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tSpy,
  }),
}))

// ── imports (post-mock) ─────────────────────────────────────────────

import { GroupToolbar } from './GroupToolbar'

// ── test suite ──────────────────────────────────────────────────────

describe('GroupToolbar — i18n aria-labels for view toggle + clear search', () => {
  it('renders the 3 buttons with the i18n aria-labels (clear_search / grid_view / list_view)', () => {
    // The clear_search button only renders when localSearch is
    // truthy (it overlays the search input as a clear-X
    // affordance). The mock sets state.searchQuery = 'test' so
    // localSearch starts non-empty and the button renders. The
    // grid_view + list_view buttons are always rendered in the
    // view toggle segment.
    tSpy.mockClear()
    render(<GroupToolbar />)
    expect(
      screen.getByRole('button', { name: /Clear search/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Grid view/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /List view/i }),
    ).toBeInTheDocument()
    // Pin all 3 i18n KEY PATHS so a future refactor that renames
    // any of `accounts.toolbar.{clear_search,grid_view,list_view}`
    // trips red here. Catches key drift between the component
    // and the locale bundles.
    expect(tSpy).toHaveBeenCalledWith(
      'accounts.toolbar.clear_search',
      expect.any(String),
    )
    expect(tSpy).toHaveBeenCalledWith('accounts.toolbar.grid_view', expect.any(String))
    expect(tSpy).toHaveBeenCalledWith('accounts.toolbar.list_view', expect.any(String))
  })
})
