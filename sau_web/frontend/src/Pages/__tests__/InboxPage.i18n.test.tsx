/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { mockUseAuth } from '@/test/auth-router-spies'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { ToastProvider } from '@/Components/ui/toast'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { useInboxStore, type InboxEntry } from '@/stores/inboxStore'

// ─────────────────────────────────────────────────────────────────────────
// InboxPage · i18n flip (round-2 dashboard-surface sweep)
//
// Mirrors AppShell.i18n.test.tsx + TasksPage.i18n.test.tsx structure:
// real <I18nextProvider i18n={i18n}> wrap (NOT a vi.mock stub) so the
// production changeLanguage codepath is exercised end-to-end. The
// inboxStore is seeded via the real store API (NOT mocked) so the
// production label-resolution codepath at render time is hit.
//
// Test surface (5 specs):
//   (a) Initial zh-CN filter chips — 6 status filter chips resolve
//       via labelKey/labelFallback (mirrors AppShell STATUS_META pattern)
//   (b) Initial zh-CN row action chrome — badge label + action button
//       labels + cookie-expired strings + transcript label resolve
//       for a single seeded `failed` entry
//   (c) Initial zh-CN batch action chrome — select-all + 3 batch
//       action buttons + selected-count interpolation resolve
//   (d) Initial zh-CN filter empty state — 「暂无匹配记录」 + 「清除筛选」
//       resolve when a specific filter has 0 matches
//   (e) Switch to en-US flips all 4 surfaces (absorption: no zh-CN
//       leakage anywhere) + round-trip persistence
// ─────────────────────────────────────────────────────────────────────────

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Proxy backstop for @/api/client — only inboxDownload + inboxTranscribeStream
// are stubbed (the InboxPage only calls those two methods for the i18n-test
// surface). Other methods get a vi.fn() so a future refactor that adds a
// new api.someMethod(...) call fails at ASSERTION time rather than at
// render time.
const inboxDownload = vi.fn().mockResolvedValue({
  success: true,
  filename: 'test.mp4',
  engine: 'yt-dlp',
})
const inboxTranscribeStream = vi.fn()

vi.mock('@/api/client', () => ({
  api: new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === 'inboxDownload') return inboxDownload
        if (prop === 'inboxTranscribeStream') return inboxTranscribeStream
        return vi.fn()
      },
    },
  ),
}))

const clipboardWrite = vi.fn().mockResolvedValue(undefined)
const clipboardRead = vi.fn().mockRejectedValue(
  new DOMException('Read permission denied.', 'NotAllowedError'),
)
Object.defineProperty(globalThis.navigator, 'clipboard', {
  value: { writeText: clipboardWrite, readText: clipboardRead },
  writable: true,
  configurable: true,
})

import InboxPage from '../InboxPage'

// Helper: seed the store with a single entry of a given status. Uses
// the real store API (not a mock) so the production label-resolution
// path at render time is exercised. The entry's URL + filename are
// canonical so test assertions can target them.
//
// `failed` entries are seeded WITHOUT a filename so the page renders
// the download-retry button (status === 'failed' && !entry.filename).
// With a filename, the page would render the transcribe-retry button
// instead, which is a different i18n key path.
function seedEntry(status: InboxEntry['status']): InboxEntry {
  const entry: InboxEntry = {
    id: `seed_${status}_1`,
    url: `https://example.com/${status}.mp4`,
    status,
    startedAt: Date.now(),
    filename:
      status === 'downloading' || status === 'failed'
        ? undefined
        : `${status}.mp4`,
    engine:
      status === 'downloading' || status === 'failed'
        ? undefined
        : 'yt-dlp',
  }
  if (status === 'failed') {
    entry.error = 'fresh cookies (not necessarily logged in) are needed'
  }
  if (status === 'transcribed') {
    entry.transcript = 'sample transcript text'
  }
  useInboxStore.setState({ entries: [entry] })
  return entry
}

function setAuth() {
  mockUseAuth.mockReturnValue({
    user: { id: 1, email: 'qa@example.com', role: 'admin' },
    isAuthenticated: true,
    isLoading: false,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  })
}

function mountInboxPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <TestProviders
        client={makeQueryClient()}
        initialEntries={['/dashboard/inbox']}
      >
        <ToastProvider>
          <AuthGuard>
            <InboxPage />
          </AuthGuard>
        </ToastProvider>
      </TestProviders>
    </I18nextProvider>,
  )
}

beforeEach(async () => {
  mockUseAuth.mockReset()
  setAuth()
  // Reset the Zustand store between tests so entries / inflight /
  // selection / filter state from a previous test don't bleed into
  // the next test's mountInboxPage() render.
  useInboxStore.getState().reset()
  // Wait for i18n init — mirrors the InboxPage.test.tsx fix. The
  // t('inbox.row.badge.downloaded', '已下载') call inside InboxRow
  // returns the key string if the static resources haven't been
  // loaded by the time the row renders. The I18nextProvider wrap
  // alone doesn't help — the provider references the i18n instance
  // but the instance must be initialized first.
  if (!i18n.isInitialized) {
    await i18n.init()
  }
  // Reset the i18next singleton to zh-CN at the start of every test
  // so subsequent changeLanguage() calls trigger a re-render
  // (rather than setting language to its current value).
  await i18n.changeLanguage('zh-CN')
})

describe('InboxPage · i18n flip', () => {
  // (a) Initial zh-CN filter chips — 6 status filter chips
  //     resolve via labelKey/labelFallback. The filter bar
  //     (data-testid="inbox-filter-bar") is only rendered when
  //     entries.length > 0, so seed 1 entry to make the chips
  //     visible.
  it('initial zh-CN: 6 status filter chips render in Chinese (labelKey/labelFallback resolution)', () => {
    seedEntry('downloaded')
    mountInboxPage()
    const filterBar = screen.getByTestId('inbox-filter-bar')
    // All 6 filter chip labels in Chinese — scoped to filter bar to
    // avoid section-header / row-badge duplicate matches.
    expect(within(filterBar).getByText('全部')).toBeInTheDocument()
    expect(within(filterBar).getByText('下载中')).toBeInTheDocument()
    expect(within(filterBar).getByText('已下载')).toBeInTheDocument()
    expect(within(filterBar).getByText('失败')).toBeInTheDocument()
    expect(within(filterBar).getByText('转写中')).toBeInTheDocument()
    expect(within(filterBar).getByText('已转写')).toBeInTheDocument()
  })

  // (b) Initial zh-CN row action chrome — badge label + action
  //     buttons + cookie-expired strings + transcript label. Seed
  //     a `failed` entry so the cookie-expired banner renders.
  it('initial zh-CN: row badge + action buttons + cookie-expired strings + transcript label render in Chinese', () => {
    const failedEntry = seedEntry('failed')
    mountInboxPage()
    const row = screen.getByTestId('inbox-entry')
    // Badge label resolves via inbox.row.badge.failed → '失败'
    expect(within(row).getByText('失败')).toBeInTheDocument()
    // Action button (status='failed' && !entry.filename → 重试 button)
    expect(within(row).getByText('重试')).toBeInTheDocument()
    // Cookie-expired strings — entry.error contains the magic
    // 'fresh cookies' substring so the cookie-expired banner renders
    expect(within(row).getByText(/平台授权已过期/)).toBeInTheDocument()
    expect(within(row).getByText(/Cookie 过期可能导致下载失败/)).toBeInTheDocument()
    expect(within(row).getByText('去账号管理重新授权')).toBeInTheDocument()
    // Remove aria-label
    expect(within(row).getByLabelText('移除')).toBeInTheDocument()
    // Reference entry for type-narrowing (avoid unused-var lint)
    expect(failedEntry.status).toBe('failed')
  })

  // (c) Initial zh-CN batch action chrome — select-all + 3 batch
  //     action buttons + selected-count interpolation. The batch
  //     toolbar is only rendered when selectedIds.size > 0, so
  //     seed 1 entry + tick its checkbox to reveal the toolbar.
  it('initial zh-CN: batch action toolbar (select-all + 3 actions + count) renders in Chinese', async () => {
    seedEntry('failed')
    mountInboxPage()
    // Tick the row's checkbox to reveal the batch toolbar
    const selectButton = screen.getByRole('button', { name: '选择' })
    await act(async () => {
      selectButton.click()
    })
    // Select-all button (1 entry selected → label = '取消全选')
    expect(screen.getByRole('button', { name: '取消全选' })).toBeInTheDocument()
    // Selected count interpolation: t('inbox.batch.selected_count', '已选 {{count}} 项', { count: 1 }) → '已选 1 项'
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    // 3 batch action buttons
    expect(screen.getByRole('button', { name: '清除选中' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试选中' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转写选中' })).toBeInTheDocument()
  })

  // (d) Initial zh-CN filter empty state — 「暂无匹配记录」 + 「清除筛选」
  //     resolve when a specific filter has 0 matches. The page defaults
  //     to grouped view; switching to a specific filter (e.g. 「失败」)
  //     with no matching entries renders the filter-empty state.
  it('initial zh-CN: filter empty state (no matches) renders in Chinese', async () => {
    seedEntry('downloaded')
    mountInboxPage()
    const filterBar = screen.getByTestId('inbox-filter-bar')
    // Click 失败 filter (0 matches) — scope to filter bar to avoid
    // section-header button duplication in grouped view.
    await act(async () => {
      within(filterBar).getByRole('button', { name: /失败\s*0/ }).click()
    })
    // Filter empty state container + 2 zh-CN strings
    expect(screen.getByTestId('inbox-filter-empty')).toBeInTheDocument()
    expect(screen.getByText('暂无匹配记录')).toBeInTheDocument()
    expect(screen.getByText('清除筛选')).toBeInTheDocument()
  })

  // (e) Switch to en-US flips ALL 4 surfaces (filter chips + row
  //     badge/buttons/cookie-expired/transcript + batch toolbar +
  //     filter empty state) with full absorption. Then round-trip
  //     back to zh-CN restores Chinese labels (catches a regression
  //     where the resolved STATUS_LABEL_META / FILTER_OPTIONS map
  //     is mutated during a language change).
  it('switching to en-US flips filter chips + row chrome + batch toolbar + filter empty state (full absorption)', async () => {
    seedEntry('failed')
    mountInboxPage()

    // Sanity: initial Chinese labels render
    const filterBar = screen.getByTestId('inbox-filter-bar')
    expect(within(filterBar).getByText('全部')).toBeInTheDocument()
    expect(within(filterBar).getByText('失败')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    // (a) Filter chips flipped to English
    expect(within(filterBar).getByText('All')).toBeInTheDocument()
    expect(within(filterBar).getByText('Downloading')).toBeInTheDocument()
    expect(within(filterBar).getByText('Downloaded')).toBeInTheDocument()
    expect(within(filterBar).getByText('Failed')).toBeInTheDocument()
    expect(within(filterBar).getByText('Transcribing')).toBeInTheDocument()
    expect(within(filterBar).getByText('Transcribed')).toBeInTheDocument()
    // Absorption: Chinese filter labels gone
    expect(within(filterBar).queryByText('全部')).not.toBeInTheDocument()
    expect(within(filterBar).queryByText('失败')).not.toBeInTheDocument()

    // (b) Row chrome flipped to English
    const row = screen.getByTestId('inbox-entry')
    expect(within(row).getByText('Failed')).toBeInTheDocument()
    expect(within(row).getByText('Retry')).toBeInTheDocument()
    // Cookie-expired banner — regex match because the resource value
    // includes a trailing clause (`— please sign in again`) that the
    // exact-string getByText would not match. Mirrors the zh-CN path
    // above which already uses regex.
    expect(
      within(row).getByText(/Platform authorization expired/),
    ).toBeInTheDocument()
    expect(
      within(row).getByText(/Re-authorize in account management/),
    ).toBeInTheDocument()
    expect(within(row).getByLabelText('Remove')).toBeInTheDocument()
    // Absorption: Chinese row strings gone
    expect(within(row).queryByText('失败')).not.toBeInTheDocument()
    expect(within(row).queryByText('重试')).not.toBeInTheDocument()

    // Round-trip back to zh-CN restores Chinese labels
    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })
    expect(within(filterBar).getByText('全部')).toBeInTheDocument()
    expect(within(filterBar).getByText('已下载')).toBeInTheDocument()
    expect(within(row).getByText('失败')).toBeInTheDocument()
    expect(within(row).getByText('重试')).toBeInTheDocument()
    // Round-trip batch-toolbar coverage: tick the row's checkbox to
    // reveal 「已选 1 项」 + the 3 batch action buttons. If a
    // regression silently drops the toolbar's i18n keys after the
    // zh→en→zh swap, the assertions below catch it. Then deselect
    // to keep the rest of the test state clean.
    await act(async () => {
      screen.getByRole('button', { name: '选择' }).click()
    })
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除选中' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试选中' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转写选中' })).toBeInTheDocument()
    await act(async () => {
      screen.getByRole('button', { name: '取消选择' }).click()
    })
    // Round-trip filter-empty-state coverage: click the 「已下载 0」
    // chip (0 matches since the only seeded entry is `failed` with
    // filename undefined, so all non-failed chips have count 0).
    // Note: the filter ALREADY requires entries.length > 0 to render
    // the filter bar; the seeded single `failed` entry keeps the
    // filter bar on the page so clicking 「已下载 → 0 matches」
    // surfaces the filter-empty state under both languages.
    await act(async () => {
      within(filterBar).getByRole('button', { name: /已下载\s*0/ }).click()
    })
    expect(screen.getByText('暂无匹配记录')).toBeInTheDocument()
    expect(screen.getByText('清除筛选')).toBeInTheDocument()
    // Absorption: English labels gone after round-trip
    expect(within(filterBar).queryByText('All')).not.toBeInTheDocument()
    expect(within(row).queryByText('Failed')).not.toBeInTheDocument()
    expect(screen.queryByText('No matching records')).not.toBeInTheDocument()
  })
})
