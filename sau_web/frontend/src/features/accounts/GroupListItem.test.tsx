import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── mocks ────────────────────────────────────────────────────────────

// Stub dnd-kit's useSortable — the component only consumes `ref` +
// `handleRef` (as callback refs) + `isDragging`. Returning no-op
// callback refs avoids the "useSortable must be used inside a
// SortableContext" throw that would otherwise fire in a vitest
// jsdom render.
vi.mock('@dnd-kit/react/sortable', () => ({
  useSortable: () => ({
    ref: () => {},
    handleRef: () => {},
    isDragging: false,
  }),
}))

// Stub the dispatch hook — the real useAccountsDispatch reads
// from a context that requires the full AccountsProvider tree
// (query client + account groups hooks). For a focused i18n test
// we only need the surface methods called from the component:
// hoverTargetGroupId, handleSelectGroup, getPlatformLabel,
// handleStartRename, handleStartAuthorize, handleDeleteGroup.
// getPlatformLabel returns the Chinese display name so the
// platform badge assertion works without importing PLATFORMS.
vi.mock('./AccountsProvider.helpers', () => ({
  useAccountsDispatch: () => ({
    hoverTargetGroupId: null,
    handleSelectGroup: vi.fn(),
    getPlatformLabel: (platform: string) =>
      platform === 'douyin' ? '抖音' : platform,
    handleStartRename: vi.fn(),
    handleStartAuthorize: vi.fn(),
    handleDeleteGroup: vi.fn(),
  }),
}))

// Stub GroupDeleteDialog — it manages its own modal state and
// is not relevant to the aria-label contract being tested.
// Returning `null` avoids any Radix portal noise in jsdom.
vi.mock('./GroupDeleteDialog', () => ({
  GroupDeleteDialog: () => null,
}))

// Stub react-i18next with tSpy (mirrors the SortableAuthorizationItem
// pattern). The component calls t() for 3 aria-labels:
//   - accounts.group.rename
//   - accounts.group.add_authorization
//   - accounts.group.delete
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

import { GroupListItem } from './GroupListItem'
import type { AccountGroup } from '@/api/client'

// ── helpers ─────────────────────────────────────────────────────────

const mockGroup: AccountGroup = {
  id: 1,
  name: 'Test Group',
  created: '2024-01-01T00:00:00Z',
  authorizations: [
    { id: 10, platform: 'douyin', cookie_file: '/cookies/douyin.json', valid: true },
  ],
}

function renderItem(group: AccountGroup = mockGroup) {
  return render(
    <MemoryRouter>
      <GroupListItem group={group} selected={false} index={0} />
    </MemoryRouter>,
  )
}

// ── test suite ──────────────────────────────────────────────────────

describe('GroupListItem — i18n aria-labels for action buttons', () => {
  it('renders the 3 action buttons with the i18n aria-labels (rename / add / delete)', () => {
    // All 3 action buttons (rename / add authorization / delete)
    // are unconditionally rendered in the secondary cluster
    // (visibility is gated by hover/focus on desktop, but the
    // DOM is always present). The tSpy assertion covers the
    // full i18n surface for this component.
    tSpy.mockClear()
    renderItem()
    expect(
      screen.getByRole('button', { name: /Rename group/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Add authorization/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Delete group/i }),
    ).toBeInTheDocument()
    // Pin all 3 i18n KEY PATHS so a future refactor that renames
    // any of `accounts.group.{rename,add_authorization,delete}`
    // trips red here. These 3 keys are SHARED with SortableGroup
    // (grid view) — a future rename in one file without the
    // other would be a bug, and the tSpy assertions in both
    // test files catch the drift.
    expect(tSpy).toHaveBeenCalledWith('accounts.group.rename', expect.any(String))
    expect(tSpy).toHaveBeenCalledWith(
      'accounts.group.add_authorization',
      expect.any(String),
    )
    expect(tSpy).toHaveBeenCalledWith('accounts.group.delete', expect.any(String))
  })
})
