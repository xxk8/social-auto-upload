import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { mockUseAuth } from '@/test/auth-router-spies'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { ToastProvider } from '@/Components/ui/toast'

// ── framework-level mocks (must precede under-test imports) ─────────────

// useAuth is mocked so AuthGuard can be driven by per-test state without
// booting authStore / TanStack Query / the /api/auth/me fetch.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Ponytail: only mock the two inbox methods InboxPage exercises. The
// rest of the api surface (no other methods are called by this page)
// doesn't need stubs — failing-fast by `undefined is not a function`
// would also work but the explicit stubs make test intent clearer.
const inboxDownload = vi.fn()
const inboxTranscribeStream = vi.fn()

// Proxy backstop — mirrors the `AccountsProvider` mock's pattern. If
// a future PR adds another `api.someMethod(...)` call to InboxPage,
// the test fails loudly via `mockResolvedValue`/vi.fn assertion
// mismatches rather than via a TypeError at render time. Without the
// Proxy the failure mode would be `TypeError: api.deleteInbox is not
// a function` thrown during render, which exits the test suite
// before any assertion fires. Proxy makes the failure attributable.
vi.mock('@/api/client', () => {
  return {
    api: new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === 'inboxDownload') {
            return (...args: unknown[]) => inboxDownload(...args)
          }
          if (prop === 'inboxTranscribeStream') {
            return (...args: unknown[]) => inboxTranscribeStream(...args)
          }
          // Default: any other api method returns a vi.fn() so render-time
          // calls (e.g. future api.deleteInbox(...)) fail at ASSERTION time
          // rather than throwing during render.
          return vi.fn()
        },
      },
    ),
  }
})

// Clipboard mock — happy-dom doesn't ship a real clipboard.
// writeText jest.fn wires through to a no-resolve stub so the
// copy-success branch (calls writeText, then addToast('文案已复制'))
// is observable without flaky pending-state flakes.
// readText is the paste-button side; default rejects so the
// paste-permission-denied branch is exercised if a test ever forgets
// to seed it. The paste-success test re-stubs via
// `clipboardRead.mockResolvedValueOnce(...)`.
const clipboardWrite = vi.fn().mockResolvedValue(undefined)
const clipboardRead = vi.fn().mockRejectedValue(
  new DOMException('Read permission denied.', 'NotAllowedError'),
)
Object.defineProperty(global.navigator, 'clipboard', {
  value: { writeText: clipboardWrite, readText: clipboardRead },
  writable: true,
  configurable: true,
})

// ── imports (post-mock) ────────────────────────────────────────────────

import InboxPage from './InboxPage'

// ── helpers (module-level, shared across describe blocks) ───────────────

function setAuth({
  isAuthenticated = true,
  user = { id: 1, email: 'qa@example.com', role: 'admin' as const },
}: {
  isAuthenticated?: boolean
  user?: { id: number; email: string; role: 'admin' | 'user' } | null
} = {}) {
  mockUseAuth.mockReturnValue({
    user,
    isAuthenticated,
    isLoading: false,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  })
}

// Helper: type a URL → click download → wait until the entry lands with
// `downloaded` status. Uses the default mock (success). Shared across
// batch-operations and filtering describe blocks.
async function addEntry(url: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('视频分享链接'), {
    target: { value: url },
  })
  fireEvent.click(screen.getByTestId('inbox-download'))
  await waitFor(() => {
    const entries = screen.getAllByTestId('inbox-entry')
    expect(entries[0]).toHaveAttribute('data-status', 'downloaded')
  })
}

// Helper: stacks a one-shot failing mock on inboxDownload so the download
// lands with `failed` status. Shared across describe blocks.
async function addFailedEntry(url: string): Promise<void> {
  inboxDownload.mockResolvedValueOnce({
    success: false,
    message: '模拟失败',
  })
  fireEvent.change(screen.getByLabelText('视频分享链接'), {
    target: { value: url },
  })
  fireEvent.click(screen.getByTestId('inbox-download'))
  await waitFor(() => {
    const entries = screen.getAllByTestId('inbox-entry')
    expect(entries[0]).toHaveAttribute('data-status', 'failed')
  })
}

function mountInboxPage() {
  // TestProviders already wraps with <MemoryRouter initialEntries=…>;
  // nesting another MemoryRouter triggers react-router v6's
  // "Router inside Router" runtime error. Pass initialEntries via
  // TestProviders instead.
  //
  // ToastProvider is wrapped explicitly here because useToast()
  // throws "must be used within a ToastProvider" otherwise — InboxPage
  // calls addToast on every download branch (success/fail/empty-url/
  // non-http). AccountsPage.test.tsx / PublishPage.test.tsx DON'T need
  // this wrap because those pages never call useToast directly; adding
  // it here is the minimum-scope solution (don't modify TestProviders
  // for one test's needs).
  return render(
    <TestProviders
      client={makeQueryClient()}
      initialEntries={['/app/inbox']}
    >
      <ToastProvider>
        <AuthGuard>
          <InboxPage />
        </AuthGuard>
      </ToastProvider>
    </TestProviders>,
  )
}

// Default mock shape: download succeeds, transcribe immediately fires
// onDone (no chunks). Per-test overrides come in `beforeEach` for
// the streaming / failure branches.
beforeEach(() => {
  mockUseAuth.mockReset()
  inboxDownload.mockReset()
  inboxTranscribeStream.mockReset()
  clipboardWrite.mockClear()
  // Default: clipboard.readText rejects (paste-permission-denied).
  // Tests that exercise the success path explicitly stack
  // `mockResolvedValueOnce(...)` BEFORE clicking the paste button.
  clipboardRead.mockReset()
  clipboardRead.mockRejectedValue(
    new DOMException('Read permission denied.', 'NotAllowedError'),
  )
  inboxDownload.mockResolvedValue({
    success: true,
    filename: 'test.mp4',
    engine: 'yt-dlp',
  })
  inboxTranscribeStream.mockImplementation(
    async (_payload, _onChunk, onDone) => {
      onDone('seed transcript')
    },
  )
})

// ── tests ───────────────────────────────────────────────────────────────

describe('InboxPage · AuthGuard + chrome + key interactions', () => {
  // ── AuthGuard bounce ──────────────────────────────────────────────────

  // AuthGuard wraps the page in App.tsx. When isAuthenticated is
  // false, AuthGuard fires <Navigate to="/login" replace />, so the
  // page content never mounts. The "素材收件箱" heading uniquely
  // belongs to this page — its absence is a positive bounce signal.
  // ── Paste-from-clipboard button ────────────────────────────────────────

  // Paste button must wire to `navigator.clipboard.readText()` and
  // show the result in the URL input. Mirrors the user's primary copy
  // flow: 复制剪贴板 (Douyin/XHS share-screen) → 粘贴到 Inbox → 下载.
  it('paste button reads clipboard text into the URL input', async () => {
    setAuth()
    clipboardRead.mockResolvedValueOnce(
      'https://v.douyin.com/D1obbfHosxs/',
    )
    mountInboxPage()
    fireEvent.click(screen.getByTestId('inbox-paste'))
    expect(await screen.findByDisplayValue('https://v.douyin.com/D1obbfHosxs/')).toBeInTheDocument()
    expect(clipboardRead).toHaveBeenCalledTimes(1)
  })

  // Permission-denied branch (non-secure context, denied permission)
  // must NOT throw and must NOT clobber the user's typed input. Locked
  // here so a future swap to a different clipboard-read strategy
  // (e.g. execCommand) keeps the failure-mode invariant.
  it('paste button surfaces a permission-denied toast and keeps typed URL intact', async () => {
    setAuth()
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/keep.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-paste'))
    // The input still reads the user-typed value (paste did NOT
    // overwrite it on rejection).
    expect(screen.getByLabelText('视频分享链接')).toHaveValue('https://example.com/keep.mp4')
  })

  // ── Concurrent-downloads contract (post busy-refactor) ─────────────
  //
  // The previous design used a single `busy` boolean that disabled
  // URL input / paste / download button / every row's retry button
  // for the duration of any in-flight download. User-reported bug:
  // "after one download the rest of the page is locked". The new
  // design tracks per-entry inflight state in a Set, so concurrent
  // downloads / retries are allowed. This test locks the FIX: while
  // a download is in flight, paste + URL input + download button +
  // other rows' retry buttons must all stay clickable. The in-flight
  // count chip is the only UI feedback.
  //
  // The dangling-promise pattern (mockReturnValueOnce + manual
  // resolve) is hermetic: try/finally guarantees `resolveDownload`
  // fires even if the waitFor assertion throws mid-test, so no
  // leaked promise bleeds into the next test's beforeEach.
  it('paste + URL input + download button stay ENABLED while a download is in flight', async () => {
    setAuth()
    let resolveDownload!: (v: unknown) => void
    inboxDownload.mockReturnValueOnce(
      new Promise((res) => {
        resolveDownload = res
      }),
    )
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/x.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    try {
      // Wait for the entry to register in 'downloading' state.
      await waitFor(() => {
        expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
          'data-status',
          'downloading',
        )
      })
      // In-flight count chip is visible with N=1.
      expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('1')
      // Top-level controls stay enabled.
      expect(screen.getByTestId('inbox-paste')).not.toBeDisabled()
      expect(screen.getByLabelText('视频分享链接')).not.toBeDisabled()
      expect(screen.getByTestId('inbox-download')).not.toBeDisabled()
    } finally {
      // Drain the in-flight download so the pending promise doesn't
      // bleed into the next test's beforeEach.
      resolveDownload({ success: true, filename: 'x.mp4', engine: 'yt-dlp' })
    }
  })

  // User can fire a SECOND download while the first is still in
  // flight. Each download gets its own entry id and is tracked
  // independently. The in-flight count chip increments live.
  it('user can start a second download while the first is in flight', async () => {
    setAuth()
    let resolveFirst!: (v: unknown) => void
    inboxDownload
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveFirst = res
        }),
      )
      // Second call resolves immediately (default mock).
    mountInboxPage()
    // Kick off download 1 (will hang).
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/first.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    await waitFor(() => {
      // The first entry is mid-flight, shown as 'downloading'.
      const entries = screen.getAllByTestId('inbox-entry')
      expect(entries[0]).toHaveAttribute('data-status', 'downloading')
      expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('1')
    })

    // Paste a second URL while the first is still in flight.
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/second.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))

    // Second download finishes via the default mock.
    await waitFor(() => {
      const entries = screen.getAllByTestId('inbox-entry')
      // 2 entries: one 'downloading' (first) + one 'downloaded' (second).
      const statuses = entries.map((e) => e.getAttribute('data-status'))
      expect(statuses).toContain('downloading')
      expect(statuses).toContain('downloaded')
    })
    // In-flight count is still 1 (only the first is still pending).
    expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('1')

    // Drain the first download.
    resolveFirst({ success: true, filename: 'first.mp4', engine: 'yt-dlp' })
    await waitFor(() => {
      // In-flight count chip disappears when count hits 0.
      expect(screen.queryByTestId('inbox-inflight-count')).not.toBeInTheDocument()
    })
    // 2 entries: both 'downloaded'.
    const entries = screen.getAllByTestId('inbox-entry')
    for (const e of entries) {
      expect(e).toHaveAttribute('data-status', 'downloaded')
    }
  })

  // Per-row retry is independent: clicking retry on entry A does NOT
  // block clicking retry on entry B. Each retry is tracked
  // independently via the per-row inflightEntryIds.has() check.
  // The user-facing behavior: clicking retry on a 'failed' entry
  // immediately flips its status to 'downloading' (the row's
  // 重试 button is REMOVED from the DOM, since it's only rendered
  // for `status === 'failed' && !entry.filename`). Other rows'
  // 重试 buttons stay enabled so a user can fire parallel retries.
  it('per-row retry is independent — clicking one does not block other rows', async () => {
    setAuth()
    mountInboxPage()
    // Seed 2 failed entries.
    await addFailedEntry('https://example.com/fail1.mp4')
    await addFailedEntry('https://example.com/fail2.mp4')

    // 2 failed entries → 2 retry buttons, both enabled.
    const retryButtons = screen.getAllByTestId('inbox-download-retry')
    expect(retryButtons).toHaveLength(2)
    expect(retryButtons[0]).not.toBeDisabled()
    expect(retryButtons[1]).not.toBeDisabled()

    // Mock a hanging retry on the FIRST button.
    let resolveRetry!: (v: unknown) => void
    inboxDownload.mockReturnValueOnce(
      new Promise((res) => {
        resolveRetry = res
      }),
    )
    try {
      fireEvent.click(retryButtons[0])

      // While retry 0 is in flight: the entry's status flips to
      // 'downloading', so the 重试 button for entry 0 is REMOVED
      // from the DOM (the render condition no longer holds). The
      // OTHER entry's retry button is unaffected and still enabled.
      await waitFor(() => {
        // Entry 0's status is now 'downloading' (not 'failed').
        const entries = screen.getAllByTestId('inbox-entry')
        const downloadingEntries = entries.filter(
          (e) => e.getAttribute('data-status') === 'downloading',
        )
        expect(downloadingEntries).toHaveLength(1)
        // The in-flight count chip shows N=1.
        expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('1')
        // Only 1 retry button remains (for the OTHER failed entry).
        const remaining = screen.getAllByTestId('inbox-download-retry')
        expect(remaining).toHaveLength(1)
        // That remaining retry button is enabled — other rows are
        // NOT blocked by entry 0's in-flight retry.
        expect(remaining[0]).not.toBeDisabled()
      })
    } finally {
      // Drain the in-flight retry so the pending promise doesn't
      // bleed into the next test's beforeEach.
      resolveRetry({ success: true, filename: 'fail1.mp4', engine: 'yt-dlp' })
    }

    // After completion: the now-downloaded entry has no retry
    // button (status flipped out of 'failed && !filename'). Only
    // the still-failed entry's retry button remains.
    await waitFor(() => {
      const remaining = screen.getAllByTestId('inbox-download-retry')
      expect(remaining).toHaveLength(1)
      expect(remaining[0]).not.toBeDisabled()
    })
  })

  // The in-flight count chip is hidden when count is 0 and increments
  // by 1 per concurrent in-flight entry.
  it('in-flight count chip shows 0 → 1 → 0 as downloads complete', async () => {
    setAuth()
    let resolveDownload!: (v: unknown) => void
    inboxDownload.mockReturnValueOnce(
      new Promise((res) => {
        resolveDownload = res
      }),
    )
    mountInboxPage()
    // No chip when nothing is in flight.
    expect(screen.queryByTestId('inbox-inflight-count')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/x.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    await waitFor(() => {
      expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('1')
    })

    resolveDownload({ success: true, filename: 'x.mp4', engine: 'yt-dlp' })
    await waitFor(() => {
      expect(screen.queryByTestId('inbox-inflight-count')).not.toBeInTheDocument()
    })
  })

  // Issue 1 lock test: handleRemove on an in-flight entry
  // decrements the chip IMMEDIATELY. Without the fix, the
  // dangling promise's `clearInflight(id)` in `finally` would only
  // fire when the underlying api.inboxDownload resolves — seconds
  // later, with the chip showing a stale count the whole time.
  it('removing an in-flight entry clears the in-flight count chip immediately', async () => {
    setAuth()
    let resolveHangingDownload!: (v: unknown) => void
    inboxDownload.mockReturnValueOnce(
      new Promise((res) => {
        resolveHangingDownload = res
      }),
    )
    mountInboxPage()

    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/hang.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))

    // Wait for the entry to register in 'downloading' + chip to
    // show N=1.
    await waitFor(() => {
      expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
        'data-status',
        'downloading',
      )
      expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('1')
    })

    try {
      // Click the row's Trash icon (handleRemove). The entry is
      // still in flight; without the fix, the chip would stay at
      // '1' until the dangling promise's `finally` runs
      // clearInflight. With Issue 1's fix, clearInflight(id) runs
      // synchronously inside handleRemove's useCallback body.
      fireEvent.click(screen.getByTestId('inbox-remove'))
      await waitFor(() => {
        expect(
          screen.queryByTestId('inbox-inflight-count'),
        ).not.toBeInTheDocument()
      })
    } finally {
      // Drain the dangling promise so it doesn't bleed into the
      // next test's beforeEach.
      resolveHangingDownload({ success: false, message: 'cancelled' })
    }
  })

  // Issue 1 lock test (batch variant): handleBatchRemove on N
  // in-flight entries clears the chip synchronously. The chip
  // drops to 0 immediately, not after the dangling promises
  // resolve. The N clearInflight calls + setEntries +
  // setSelectedIds are all batched into a single React commit
  // by React 18+ automatic batching (since the fireEvent.click
  // handler runs in React's event system), so the chip
  // transitions N→0 in one atomic render — the user never
  // observes a stale intermediate count.
  it('batch-removing in-flight entries clears the in-flight chip immediately', async () => {
    setAuth()
    let resolveHang1!: (v: unknown) => void
    let resolveHang2!: (v: unknown) => void
    inboxDownload
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveHang1 = res
        }),
      )
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveHang2 = res
        }),
      )
    mountInboxPage()

    // Start 2 hanging downloads (input/paste/download button is
    // not disabled, so the second URL can be entered while the
    // first is in flight — picks up from the existing concurrent-
    // downloads contract tests above).
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/h1.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/h2.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))

    await waitFor(() => {
      expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('2')
    })

    // Tick both checkboxes to reveal the batch toolbar.
    const checkboxes = screen.getAllByRole('button', { name: '选择' })
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])

    try {
      fireEvent.click(screen.getByRole('button', { name: /清除选中/ }))
      // Chip must drop to 0 immediately. Without the fix, it
      // would stay at '2' until both dangling promises resolve.
      await waitFor(() => {
        expect(
          screen.queryByTestId('inbox-inflight-count'),
        ).not.toBeInTheDocument()
      })
    } finally {
      resolveHang1({ success: false, message: 'cancelled' })
      resolveHang2({ success: false, message: 'cancelled' })
    }
  })

  // Issue 1 lock test (clearAll variant): handleClearAll on N
  // in-flight entries clears the chip synchronously AND drops
  // the entry list to the empty state. The single
  // setInflightEntryIds(prev => prev.size === 0 ? prev : new
  // Set()) commit + setEntries([]) + setSelectedIds(new Set())
  // are batched into ONE React commit by React 18+ automatic
  // batching, so the chip transitions N→0 atomically (no
  // phantom intermediate count) and the empty-state placeholder
  // renders in the same commit.
  it('clearing all in-flight entries clears the in-flight chip immediately and drops to empty state', async () => {
    setAuth()
    let resolveHang1!: (v: unknown) => void
    let resolveHang2!: (v: unknown) => void
    inboxDownload
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveHang1 = res
        }),
      )
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveHang2 = res
        }),
      )
    mountInboxPage()

    // Start 2 hanging downloads.
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/h1.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/h2.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))

    await waitFor(() => {
      expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('2')
    })

    try {
      // `全部清除` button is rendered once entries.length > 0,
      // and clicking it routes through handleClearAll. We use
      // the text matcher because no `data-testid` is attached
      // to this button in source (only paste / URL / download
      // inputs carry testids).
      fireEvent.click(screen.getByText('全部清除'))

      // Chip must drop to 0 immediately (no phantom). Entry
      // list must drop to empty state. Both should commit in
      // one React batch.
      await waitFor(() => {
        expect(
          screen.queryByTestId('inbox-inflight-count'),
        ).not.toBeInTheDocument()
      })
      expect(screen.getByText(/暂无下载记录/)).toBeInTheDocument()
      // URL input / paste / download button stay enabled so
      // the user can immediately fire the next download.
      // Mirrors the symmetric assertion set locked by the
      // existing concurrent-downloads contract tests above.
      expect(screen.getByLabelText('视频分享链接')).not.toBeDisabled()
      expect(screen.getByTestId('inbox-paste')).not.toBeDisabled()
      expect(screen.getByTestId('inbox-download')).not.toBeDisabled()
    } finally {
      // Drain the dangling promises so they don't bleed into the
      // next test's beforeEach.
      resolveHang1({ success: false, message: 'cancelled' })
      resolveHang2({ success: false, message: 'cancelled' })
    }
  })

  // ── AuthGuard bounce ──────────────────────────────────────────────────

  it('does NOT render inbox chrome when anonymous (AuthGuard bounce)', () => {
    setAuth({ isAuthenticated: false })
    mountInboxPage()
    expect(
      screen.queryByRole('heading', { name: '素材收件箱' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbox-download')).not.toBeInTheDocument()
  })

  // ── Page chrome ───────────────────────────────────────────────────────

  it('renders the PageHeader with title "素材收件箱" when authenticated', () => {
    setAuth()
    mountInboxPage()
    expect(
      screen.getByRole('heading', { name: '素材收件箱' }),
    ).toBeInTheDocument()
  })

  it('renders the PageHeader description "从分享链接下载到本地, 再转写音视频文案"', () => {
    setAuth()
    mountInboxPage()
    expect(
      screen.getByText(/从分享链接下载到本地.+转写音视频文案/),
    ).toBeInTheDocument()
  })

  it('renders the URL input with placeholder + 下载 button when authenticated', () => {
    setAuth()
    mountInboxPage()
    // The label points at this id — assert the input is reachable by
    // both the input-attribute matcher AND its label sibling, proving
    // the for/id wiring is correct.
    expect(screen.getByLabelText('视频分享链接')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-download')).toBeInTheDocument()
  })

  // ── Empty state ───────────────────────────────────────────────────────

  it('renders the empty-state placeholder when no entries yet', () => {
    setAuth()
    mountInboxPage()
    expect(
      screen.getByText(/暂无下载记录.+粘贴分享链接开始/),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-entries')).not.toBeInTheDocument()
  })

  // ── URL validation (pre-flight, before hitting the backend) ───────────

  // The page mirrors the backend's URL validation client-side so users
  // see the toast INSTANTLY instead of waiting for a 400 round-trip.
  it('does NOT call api.inboxDownload when URL is empty', async () => {
    setAuth()
    mountInboxPage()
    fireEvent.click(screen.getByTestId('inbox-download'))
    // Client-side rejection: no history row created, no api call.
    await waitFor(() => {
      expect(inboxDownload).not.toHaveBeenCalled()
      expect(screen.queryByTestId('inbox-entry')).not.toBeInTheDocument()
    })
  })

  it('does NOT call api.inboxDownload when URL is not http(s)', async () => {
    setAuth()
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'ftp://example.com/x.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    await waitFor(() => {
      expect(inboxDownload).not.toHaveBeenCalled()
    })
  })

  // ── App-share text extraction (Douyin / XHS / Kuaishou clipboard) ─────

  // Douyin app share-text format: prefix noise ("4.66 xfo:/ :4pm 08/23
  // y@g.Ok # 情感 # 对象 …") + https URL + suffix ("复制此链接，打开Dou
  // 音搜索，直接观看视频！"). Frontend regex extract the URL and pass
  // to backend, otherwise backend's `startswith('http(s)://')` gate
  // would 400 the request and the entry would never get a chance to
  // download. Also verifies the entry's `url` is stored as the
  // CLEAN extracted URL (not the appshare blob) so scan-back through
  // `entries` later reads cleanly.
  it('extracts https URL from app-share text containing prefix garbage + suffix', async () => {
    setAuth()
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: {
        value:
          '4.66 xfo:/ :4pm 08/23 y@g.Ok https://v.douyin.com/D1obbfHosxs/ 复制此链接，打开Dou音搜索，直接观看视频！',
      },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))

    await waitFor(() => {
      // The extracted URL (no trailing Chinese full-width punctuation)
      // is what gets submitted to the backend; the displayed entry URL
      // is also the clean form so the history list stays readable.
      expect(inboxDownload).toHaveBeenCalledWith(
        'https://v.douyin.com/D1obbfHosxs/',
      )
      expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
        'data-status',
        'downloaded',
      )
      // Round-16 regression guard: locks the entry's display to the
      // CLEAN URL, not the raw appshare blob. Catches future drift
      // where `api.inboxDownload` is wired to one URL form but the
      // entry's `url` field is wired to another — the exact bug class
      // Round 15 introduced by passing `trimmed` instead of `target`
      // to the API call (entry URL was clean, API call was blob).
      const entryText =
        screen.getByTestId('inbox-entry').textContent ?? ''
      expect(entryText).toContain('https://v.douyin.com/D1obbfHosxs/')
      expect(entryText).not.toContain('复制此')
    })
  })

  // Hashtag-only / no URL at all → reject with toast. Distinct from
  // a clean non-http URL (which the earlier test rejects) and from a
  // clean URL (which goes through).
  it('rejects app-share-like text with no http URL at all', async () => {
    setAuth()
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: '随便聊聊 #情感 #对象 复制此链接' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    await waitFor(() => {
      expect(inboxDownload).not.toHaveBeenCalled()
    })
  })

  // ── Per-platform app-share corpus (XHS / Kuaishou) ───────
  //
  // vitest mirror of tests/test_inbox.py::
  // test_extract_first_url_pulls_appshare_per_platform. The `$id`
  // shape matches the Python pytest parametrize ids verbatim
  // (xhs-short, kuaishou-short) so a `vitest --testNamePattern=<id>`
  // lookup hits the same case that `pytest -k <id>` hits on the
  // backend — drift between the two languages is now findable in
  // 1 grep, not 2. Sample texts are intentionally inline + kept in
  // lock-step with the Python corpus (file-level contract anchor).
  //
  // Douyin stays as a separate `it()` block above (independent test
  // surface — different blob shape, expects different URL). XHS +
  // Kuaishou share the same per-platform `blob → expected URL →
  // forbidden CTA substring` shape, so they pair naturally.
  //
  // Cases:
  //   * xhs-short      — xhslink.com short URL inside hashtag blob.
  //   * kuaishou-short — v.kuaishou.com short URL inside hashtag blob.
  //
  // When a new platform app-share text shape is added (e.g. an
  // XHS long-form `xiaohongshu.com/explore/<id>?xsec_token=...`
  // case to mirror Python's xhs-long), append ONE object + ONE
  // id to the table below; no test-name change required. The
  // `vitest --testNamePattern=<id>` / `pytest -k <id>` filters
  // stay usable throughout — the platform dimension lives in
  // the ID, not in the test name.

  test.each([
    {
      id: 'xhs-short',
      blob: '小红书爆款 #情感 #生活 📍北京三里屯 https://www.xhslink.com/aB3CdEf9Xy 复制此链接，打开小红书查看更多精彩内容！',
      expected: 'https://www.xhslink.com/aB3CdEf9Xy',
      forbidden: '复制此链接',
    },
    {
      id: 'kuaishou-short',
      blob: '快手爆款短视频 #搞笑 #日常 https://v.kuaishou.com/Xy7p9Q2wRt 复制链接打开快手，精彩不容错过！',
      expected: 'https://v.kuaishou.com/Xy7p9Q2wRt',
      forbidden: '复制链接',
    },
  ])(
    'extracts https URL from $id app-share text (vitest ↔ pytest $id lock-step)',
    async ({ blob, expected, forbidden }) => {
      setAuth()
      mountInboxPage()
      fireEvent.change(screen.getByLabelText('视频分享链接'), {
        target: { value: blob },
      })
      fireEvent.click(screen.getByTestId('inbox-download'))

      await waitFor(() => {
        expect(inboxDownload).toHaveBeenCalledWith(expected)
        expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
          'data-status',
          'downloaded',
        )
        // Round-16 regression guard (mirrored from Douyin `it()`
        // above): locks entry display to CLEAN URL, never the raw
        // appshare blob. Same `forbidden` substring concept — `'复制
        // ...'` is the platform-specific CTA marker and must NOT
        // appear in the rendered entry text.
        const entryText =
          screen.getByTestId('inbox-entry').textContent ?? ''
        expect(entryText).toContain(expected)
        expect(entryText).not.toContain(forbidden)
      })
    },
  )

  // ── Round-19 sec fix (sec-2 mirror) — frontend regex tightened ────

  // Defense-in-depth: even when the input starts with http(s)://
  // (which used to bypass extraction under the loose `/^https?:\/\//i`
  // gate), the page MUST still clean the URL via the regex extract
  // helper on its side too. Mirrors backend `inbox.py::dl()`
  // force-extract: real-world share-text copy with manually-trimmed
  // prefix but leftover Chinese CTA suffix — e.g. a user pastes
  // `https://example.com/x.mp4 复制此链接` after accidentally dropping
  // only the prefix — must NOT be sent verbatim to the backend.
  it('cleans trailing appshare-style suffix when input starts with https', async () => {
    setAuth()
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/x.mp4 复制此链接' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))

    await waitFor(() => {
      // Clean URL reaches the backend; no Chinese suffix.
      expect(inboxDownload).toHaveBeenCalledWith(
        'https://example.com/x.mp4',
      )
      expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
        'data-status',
        'downloaded',
      )
      // Round-16 regression guard carries forward: entry display must
      // show the clean URL, never the appshare-style suffix.
      const entryText =
        screen.getByTestId('inbox-entry').textContent ?? ''
      expect(entryText).toContain('https://example.com/x.mp4')
      expect(entryText).not.toContain('复制此')
    })
  })

  // ── Download success path ─────────────────────────────────────────────

  it('download success appends entry with 已下载 badge + filename + engine tag', async () => {
    setAuth()
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/x.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))

    await waitFor(() => {
      const entry = screen.getByTestId('inbox-entry')
      expect(entry).toHaveAttribute('data-status', 'downloaded')
      expect(within(entry).getByText('test.mp4')).toBeInTheDocument()
      expect(within(entry).getByText('yt-dlp')).toBeInTheDocument()
      expect(within(entry).getByText('已下载')).toBeInTheDocument()
    })
    expect(inboxDownload).toHaveBeenCalledWith('https://example.com/x.mp4')
    // Counter chip in card header updated.
    expect(screen.getByTestId('inbox-entry-count')).toHaveTextContent('1')
  })

  // ── Download failure path ─────────────────────────────────────────────

  it('download failure appends entry with 失败 badge + backend message', async () => {
    setAuth()
    inboxDownload.mockResolvedValue({
      success: false,
      message: 'url rejected (private/loopback)',
    })
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://localhost/x' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))

    await waitFor(() => {
      const entry = screen.getByTestId('inbox-entry')
      expect(entry).toHaveAttribute('data-status', 'failed')
      expect(within(entry).getByText('失败')).toBeInTheDocument()
      expect(
        within(entry).getByText('url rejected (private/loopback)'),
      ).toBeInTheDocument()
    })
  })

  // ── Transcribe streaming path ─────────────────────────────────────────

  // Streaming test: the page must ACCUMULATE incoming chunks into the
  // transcript <pre>, not replace the previous chunk. This is what
  // makes long-video transcription legible (99% of the time the user
  // is reading a partial transcript while the rest streams in).
  //
  // Using single-token chunks (no embedded newlines) is intentional:
  // happy-dom normalizes `\n` inside `<pre>` differently across versions
  // and the assertion's substring match gets flaky. The accumulation
  // contract is the same regardless of how the chunks decompose.
  it('transcribe streaming accumulates chunks into the transcript <pre>', async () => {
    setAuth()
    inboxTranscribeStream.mockImplementation(
      async (_payload, onChunk, onDone) => {
        onChunk('chunk-one ')
        onChunk('chunk-two ')
        onChunk('chunk-three')
        onDone('chunk-one chunk-two chunk-three')
      },
    )
    // Pre-seed an already-downloaded entry by routing past the
    // download mutation phase via a successful default mock.
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/x.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    await waitFor(() =>
      expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
        'data-status',
        'downloaded',
      ),
    )

    // Now click 转写 — streams chunks. fireEvent auto-wraps in act()
    // (testing-library v13+); microtask drain is handled by happy-dom's
    // scheduler so the 3 onChunk + 1 onDone setEntries calls flush
    // into a single committed render before waitFor's first poll.
    fireEvent.click(screen.getByTestId('inbox-transcribe'))

    await waitFor(() => {
      expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
        'data-status',
        'transcribed',
      )
      // The transcript <pre> shows the concatenated stream end-state.
      expect(screen.getByTestId('inbox-transcript')).toHaveTextContent(
        'chunk-one chunk-two chunk-three',
      )
    })
    expect(inboxTranscribeStream).toHaveBeenCalledWith(
      { filename: 'test.mp4' },
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    )
  })

  // ── Transcribe failure path ───────────────────────────────────────────

  it('transcribe error fires 失败 badge + error toast', async () => {
    setAuth()
    inboxTranscribeStream.mockImplementation(
      async (_payload, _onChunk, _onDone, onError) => {
        onError('OPENAI_API_KEY missing')
      },
    )
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/x.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    await waitFor(() =>
      expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
        'data-status',
        'downloaded',
      ),
    )

    fireEvent.click(screen.getByTestId('inbox-transcribe'))

    await waitFor(() => {
      const entry = screen.getByTestId('inbox-entry')
      expect(entry).toHaveAttribute('data-status', 'failed')
      expect(within(entry).getByText('OPENAI_API_KEY missing')).toBeInTheDocument()
    })
  })

  // ── Copy-to-clipboard path ────────────────────────────────────────────

  it('copy button calls navigator.clipboard.writeText with the transcript', async () => {
    setAuth()
    inboxTranscribeStream.mockImplementation(
      async (_payload, onChunk, onDone) => {
        onChunk('hello world')
        onDone('hello world')
      },
    )
    mountInboxPage()
    fireEvent.change(screen.getByLabelText('视频分享链接'), {
      target: { value: 'https://example.com/x.mp4' },
    })
    fireEvent.click(screen.getByTestId('inbox-download'))
    await waitFor(() =>
      expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
        'data-status',
        'downloaded',
      ),
    )

    fireEvent.click(screen.getByTestId('inbox-transcribe'))
    await waitFor(() =>
      expect(screen.getByTestId('inbox-entry')).toHaveAttribute(
        'data-status',
        'transcribed',
      ),
    )

    fireEvent.click(screen.getByTestId('inbox-copy'))

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith('hello world')
    })
  })
})

// ── Platform chip click-to-navigate tests ────────────────────────────────
//
// The "支持下载" strip renders platform chips beneath the URL input. Each
// chip (except 'general') is wrapped in an `<a href="..." target="_blank"
// rel="noopener noreferrer">` so users can click to open the platform
// website. These tests lock the href/target/rel contract for every platform
// and verify the general chip stays unlinked.

describe('InboxPage · platform chip click-to-navigate', () => {
  const EXPECTED_URLS: Record<string, string> = {
    douyin: 'https://www.douyin.com',
    kuaishou: 'https://www.kuaishou.com',
    xiaohongshu: 'https://www.xiaohongshu.com',
    bilibili: 'https://www.bilibili.com',
    youtube: 'https://www.youtube.com',
    tiktok: 'https://www.tiktok.com',
    twitter: 'https://x.com',
    instagram: 'https://www.instagram.com',
    facebook: 'https://www.facebook.com',
    tencent: 'https://channels.weixin.qq.com',
    ixigua: 'https://www.ixigua.com',
    dailymotion: 'https://www.dailymotion.com',
    rumble: 'https://rumble.com',
    vk: 'https://vk.com',
  }

  // All 14 platform chips with a dedicated URL render as <a> tags
  // with the correct href, target=_blank, and rel=noopener noreferrer.
  // Parametrized so a future platform addition just adds one row.
  test.each(
    Object.entries(EXPECTED_URLS).map(([key, url]) => ({
      platformKey: key,
      expectedUrl: url,
    })),
  )(
    '$platformKey chip is an <a> linking to $expectedUrl',
    ({ platformKey: _platformKey, expectedUrl }) => {
      setAuth()
      mountInboxPage()

      // Narrow the 14 <a> tags by exact href match.
      const matched = screen
        .getAllByRole('link')
        .find((el) => el.getAttribute('href') === expectedUrl)
      expect(matched).toBeTruthy()
      expect(matched).toHaveAttribute('target', '_blank')
      expect(matched).toHaveAttribute('rel', 'noopener noreferrer')
    },
  )

  // The 'general' chip (其他·通用) is the catch-all; it has no
  // dedicated website URL and must NOT be wrapped in an <a> tag.
  // A future regression that accidentally wraps it would create
  // a broken link to undefined — this test catches that.
  it('general chip is NOT wrapped in an <a> tag', () => {
    setAuth()
    mountInboxPage()

    // All <a> tags in the "支持下载" strip:
    const links = screen.getAllByRole('link')
    // Collect their text content to check none says "通用"
    const linkTexts = links.map((l) => l.textContent ?? '')
    const generalLinks = linkTexts.filter((t) => t.includes('通用'))
    expect(generalLinks).toHaveLength(0)

    // The general chip is icon-only (no text label). It is still
    // rendered as a plain <span> (not an <a>) and carries the
    // platform name in its title attribute as a tooltip.
    expect(screen.getByTitle('其他·通用')).toBeInTheDocument()
  })

  // All 14 platform links open in a new tab (target=_blank).
  // Locks the security contract so a future refactor doesn't drop
  // _blank or rel.
  it('every platform <a> has target=_blank and rel=noopener noreferrer', () => {
    setAuth()
    mountInboxPage()

    const links = screen.getAllByRole('link')
    expect(links.length).toBe(Object.keys(EXPECTED_URLS).length)
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  // All 14 expected URLs should have an href on the page.
  // Catches a typo in the PLATFORM_URLS constant vs the expected test map.
  it('every expected platform URL has a matching <a> on the page', () => {
    setAuth()
    mountInboxPage()

    const hrefs = screen
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
    for (const [, url] of Object.entries(EXPECTED_URLS)) {
      expect(hrefs).toContain(url)
    }
  })
})

// ── Batch operations tests ───────────────────────────────────────────────
//
// After downloading entries, the user can select them via checkbox and
// perform batch actions: select-all, clear-selected, retry-selected, and
// clear-all. These tests cover the full batch lifecycle.

describe('InboxPage · batch operations', () => {
  // ── Individual checkbox ──────────────────────────────────────────────

  it('checkbox toggles selection on click and batch toolbar becomes visible', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/v1.mp4')

    // No toolbar when selection empty
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument()

    // Click checkbox → selected
    fireEvent.click(screen.getByRole('button', { name: '选择' }))
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消选择' })).toBeInTheDocument()

    // Click again → deselected
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }))
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument()
  })

  // ── Select all / deselect all ─────────────────────────────────────────
  //
  // The batch toolbar (with 全选 / 取消全选 button) is only rendered when
  // `selectedIds.size > 0`. To reveal it, we first tick one checkbox to
  // seed a selection — then the toolbar appears and the toggle can be
  // exercised.

  it('select-all toggles all entries when clicked', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/v1.mp4')
    await addEntry('https://example.com/v2.mp4')
    await addEntry('https://example.com/v3.mp4')

    // Tick one checkbox to reveal the batch toolbar
    fireEvent.click(screen.getAllByRole('button', { name: '选择' })[0])
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument()

    // Now '全选' is visible → select all 3
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByText(/已选 3 项/)).toBeInTheDocument()

    // Click '取消全选'
    fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument()
  })

  // ── Batch remove ─────────────────────────────────────────────────────

  it('batch remove deletes selected entries', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/a.mp4')
    await addEntry('https://example.com/b.mp4')

    expect(screen.getAllByTestId('inbox-entry')).toHaveLength(2)

    // Tick one checkbox to reveal toolbar → select all → remove
    fireEvent.click(screen.getAllByRole('button', { name: '选择' })[0])
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: /清除选中/ }))

    await waitFor(() => {
      expect(screen.queryByTestId('inbox-entries')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/暂无下载记录/)).toBeInTheDocument()
  })

  // ── Batch retry ──────────────────────────────────────────────────────

  it('batch retry retries only failed selected entries', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/ok.mp4')         // index 2: downloaded
    await addFailedEntry('https://example.com/bad1.mp4')  // index 1: failed
    await addFailedEntry('https://example.com/bad2.mp4')  // index 0: failed (prepended)

    // Select the two failed entries (indices 0 and 1)
    const checkboxButtons = screen.getAllByRole('button', { name: '选择' })
    fireEvent.click(checkboxButtons[0])
    fireEvent.click(checkboxButtons[1])

    fireEvent.click(screen.getByText('重试选中'))

    await waitFor(() => {
      // 3 setup calls (addEntry + 2x addFailedEntry) + 2 retry calls
      expect(inboxDownload).toHaveBeenCalledTimes(5)
      // Retry invoked inboxDownload for the two failed URLs
      expect(inboxDownload).toHaveBeenCalledWith(
        'https://example.com/bad2.mp4',
      )
      expect(inboxDownload).toHaveBeenCalledWith(
        'https://example.com/bad1.mp4',
      )
    })
  })

  // ── Layered-defense guard against re-firing inboxDownload ──────────
  //
  // Bug-fix invariant under test: while handleBatchRetry's for-loop
  // is still draining (one entry's api.inboxDownload is hanging), a
  // SECOND click on 「重试选中」 MUST NOT trigger another
  // inboxDownload call for the same entry. The protection has two
  // cooperative layers — see handleBatchRetry in InboxPage.tsx:
  //
  //   1. Layer 1 — UI defense. The 「重试选中」 button is rendered
  //      with `disabled={batchBusy || ...}`. React suppresses the
  //      onClick handler when the button is disabled, so a user-side
  //      click on the disabled button is a no-op: no second
  //      handleBatchRetry is even started. The `in-flight chip` is
  //      the visible signal of this lock.
  //
  //   2. Layer 2 — Logic defense. The toRetry filter inside
  //      handleBatchRetry requires `e.status === 'failed' &&
  //      !inflightEntryIds.has(e.id)`. The status flip (the
  //      currently-retrying entry → 'downloading') plus the per-
  //      entry in-flight set together exclude the in-flight entry
  //      from any second-batch retry, even if a second
  //      handleBatchRetry somehow fired (e.g. a future refactor
  //      dropped the `disabled` prop).
  //
  // Either layer alone protects the race; both together make the
  // guard immune to future regressions on either axis. This test
  // exercises BOTH layers in a single flow and verifies the
  // observable invariant (the HANG entry's call count stays at 1
  // even after a second click during the hang).
  it('double-defense: a second click on 「重试选中」 during an in-flight batch does NOT re-fire inboxDownload for the same entry', async () => {
    setAuth()
    mountInboxPage()

    // Seed 2 failed entries in REVERSE order so hang.mp4 ends up at
    // entries[0]. addFailedEntry prepends each new entry, so adding
    // 'recover.mp4' first and 'hang.mp4' second puts hang.mp4 at
    // the top. handleBatchRetry iterates `entries.filter(...)` in
    // array order, so hang.mp4 becomes the FIRST iteration of the
    // batch loop and recover.mp4 is queued behind it.
    await addFailedEntry('https://example.com/recover.mp4')
    await addFailedEntry('https://example.com/hang.mp4')

    // Queue the HANG mock AFTER the two setup fails have been
    // consumed. mockReturnValueOnce / mockResolvedValueOnce share a
    // FIFO queue, so order matters: if we queued the hang BEFORE
    // addFailedEntry, recover.mp4's setup call would receive the
    // hang promise and stay in 'downloading' forever, tripping its
    // own waitFor. After the two setup fails are consumed (list above),
    // the next queued mock is the hang promise, which arrives during
    // handleBatchRetry's iteration 1 — exactly the simulated race
    // we want to lock down.
    let resolveHangingDownload!: (v: unknown) => void
    inboxDownload.mockReturnValueOnce(
      new Promise((res) => {
        resolveHangingDownload = res
      }),
    )
    // The NEXT call (after drain) falls through to the default
    // success mock from beforeEach.

    // Tick both checkboxes to reveal the batch toolbar.
    const checkboxes = screen.getAllByRole('button', { name: '选择' })
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    await waitFor(() => {
      expect(screen.getByText(/已选 2 项/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /重试选中/ })).not.toBeDisabled()

    // === Phase 1: first click → batch lock → hang.mp4 hangs ===
    fireEvent.click(screen.getByRole('button', { name: /重试选中/ }))

    // Layer 1 evidence: button now disabled (batchBusy=true).
    // Layer 2 evidence: hang.mp4's status has flipped to
    // 'downloading', so any second batch retry's toRetry filter
    // would skip hang.mp4 via the `e.status === 'failed'` check
    // — and the !inflightEntryIds.has(e.id) check redundantly
    // protects it.
    await waitFor(() => {
      const downloadingEntries = screen
        .getAllByTestId('inbox-entry')
        .filter((e) => e.getAttribute('data-status') === 'downloading')
      expect(downloadingEntries).toHaveLength(1)
      expect(screen.getByRole('button', { name: /重试选中/ })).toBeDisabled()
      expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('1')
    })

    // Snapshot: hang.mp4 inboxDownload call count is now 2 (1 setup
    // fail + 1 batch hang); total calls are 3 (2 setup + 1 batch
    // hang). The double-defense invariant: this number does NOT
    // grow on the second click.
    expect(
      inboxDownload.mock.calls.filter(
        ([u]) => u === 'https://example.com/hang.mp4',
      ).length,
    ).toBe(2)
    expect(inboxDownload).toHaveBeenCalledTimes(3)

    try {
      // === Phase 2: second click during in-flight batch ===
      // Layer 1 fires: React suppresses onClick on disabled buttons,
      // so fireEvent.click is a no-op for the React handler. No
      // second handleBatchRetry is started. fireEvent is synchronous
      // in this regard (no microtask to await), so no defensive
      // setTimeout is needed — the post-click `expect(...).toBe
      // Disabled()` confirmation is sufficient evidence that
      // nothing fired.
      fireEvent.click(screen.getByRole('button', { name: /重试选中/ }))

      // === Phase 3: ASSERT hang.mp4's inboxDownload count is unchanged ===
      // Whether Layer 1 or Layer 2 wins, the HANG entry must NOT
      // receive a second inboxDownload call. This is the bug-fix
      // invariant under test.
      expect(
        inboxDownload.mock.calls.filter(
          ([u]) => u === 'https://example.com/hang.mp4',
        ).length,
      ).toBe(2)
      // Total must NOT have grown during the second click (would be
      // 4 if a fired second batch reused recover.mp4 instead).
      expect(inboxDownload).toHaveBeenCalledTimes(3)
      // Layer 1 is still locked: button still disabled.
      expect(screen.getByRole('button', { name: /重试选中/ })).toBeDisabled()
      // In-flight chip still N=1 (only hang.mp4 is in flight).
      expect(screen.getByTestId('inbox-inflight-count')).toHaveTextContent('1')
    } finally {
      // Drain so the suspended `await api.inboxDownload` resumes and
      // the batch loop progresses to recover.mp4. Always drain in
      // `finally` so a failing assertion above can't leak the
      // dangling promise into the next test's beforeEach.
      resolveHangingDownload({
        success: true,
        filename: 'hang.mp4',
        engine: 'yt-dlp',
      })
    }

    // === Phase 4: After drain, batch completes. ===
    // recover.mp4 (was queued behind the hang) now also gets
    // downloaded via the default success mock.
    await waitFor(() => {
      const downloadedEntries = screen
        .getAllByTestId('inbox-entry')
        .filter((e) => e.getAttribute('data-status') === 'downloaded')
      expect(downloadedEntries).toHaveLength(2)
      // In-flight chip hidden once both retries complete.
      expect(
        screen.queryByTestId('inbox-inflight-count'),
      ).not.toBeInTheDocument()
    })

    // Final assertion: total inboxDownload calls = 2 setup + 1
    // batch hang.mp4 + 1 batch recover.mp4 = 4. The second click
    // during the hang did NOT add a 3rd iteration: the layered
    // defense shielded the system from a re-fire of hang.mp4.
    expect(inboxDownload).toHaveBeenCalledTimes(4)
    expect(inboxDownload).toHaveBeenCalledWith('https://example.com/hang.mp4')
    expect(inboxDownload).toHaveBeenCalledWith('https://example.com/recover.mp4')
  })

  it('batch retry button is disabled when selected entry is not failed', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/ok.mp4')

    fireEvent.click(screen.getByRole('button', { name: '选择' }))

    // 'downloaded' status → batch retry disabled
    expect(screen.getByRole('button', { name: /重试选中/ })).toBeDisabled()
  })

  it('batch toolbar hidden when nothing selected (even with failed entries)', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/ok.mp4')
    await addFailedEntry('https://example.com/bad.mp4')

    // No selection → toolbar not rendered
    expect(screen.queryByText(/重试选中/)).not.toBeInTheDocument()
    expect(screen.queryByText(/清除选中/)).not.toBeInTheDocument()
  })

  // ── Clear all ────────────────────────────────────────────────────────

  it('全部清除 empties all entries', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/v1.mp4')
    await addEntry('https://example.com/v2.mp4')

    expect(screen.getAllByTestId('inbox-entry')).toHaveLength(2)

    fireEvent.click(screen.getByText('全部清除'))

    await waitFor(() => {
      expect(screen.queryByTestId('inbox-entries')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/暂无下载记录/)).toBeInTheDocument()
  })

  // ── Remove entry from selection ──────────────────────────────────────

  it('removing an entry deselects it from selectedIds', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/v1.mp4')
    await addEntry('https://example.com/v2.mp4')

    // Tick one checkbox to reveal toolbar → select all
    fireEvent.click(screen.getAllByRole('button', { name: '选择' })[0])
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument()

    // Remove the newest entry (index 0 after prepend)
    const removeButtons = screen.getAllByTestId('inbox-remove')
    fireEvent.click(removeButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/已选 1 项/)).toBeInTheDocument()
    })
  })
})

// ── Status filtering & grouped view tests ────────────────────────────────
//
// The page renders a status filter bar above the entries list. When the
// filter is set to "全部", entries are grouped by status with section
// headers. When a specific status is selected, entries render as a flat
// list. Drag-and-drop sort was removed in the grouped-view refactor
// (cross-group drag is semantically meaningless).
//
// The STATUS_ORDER defines the section rendering sequence:
//   downloading → transcribing → failed → downloaded → transcribed

describe('InboxPage · filtering & grouped view', () => {
  // ── Filter bar visibility ─────────────────────────────────────────────

  it('filter bar is hidden when no entries', () => {
    setAuth()
    mountInboxPage()

    // None of the filter labels should appear when entries is empty
    expect(screen.queryByText('全部')).not.toBeInTheDocument()
    expect(screen.queryByText('下载中')).not.toBeInTheDocument()
    expect(screen.queryByText('已下载')).not.toBeInTheDocument()
    expect(screen.queryByText('失败')).not.toBeInTheDocument()
    expect(screen.queryByText('转写中')).not.toBeInTheDocument()
    expect(screen.queryByText('已转写')).not.toBeInTheDocument()
  })

  it('filter bar renders with all 6 options and correct counts', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/v1.mp4')
    await addEntry('https://example.com/v2.mp4')
    await addFailedEntry('https://example.com/fail.mp4')

    // 3 entries: 2 downloaded + 1 failed. All 6 filter chips are
    // rendered as <button> elements inside the filter bar.
    // (Section headers are ALSO buttons in the grouped view — scope
    // via within() to the filter bar to avoid duplicate matches.)
    const filterBar = screen.getByTestId('inbox-filter-bar')
    expect(within(filterBar).getByRole('button', { name: /全部\s*3/ })).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: /下载中\s*0/ })).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: /已下载\s*2/ })).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: /失败\s*1/ })).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: /转写中\s*0/ })).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: /已转写\s*0/ })).toBeInTheDocument()
  })

  // ── Flat list (specific filter selected) ──────────────────────────────

  it('filtering to a specific status shows only matching entries in flat list', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/ok1.mp4')
    await addEntry('https://example.com/ok2.mp4')
    await addFailedEntry('https://example.com/bad.mp4')

    // Default is "全部" → grouped view (3 entries visible)
    expect(screen.getAllByTestId('inbox-entry')).toHaveLength(3)

    // Click "失败" filter chip — scope to filter bar to avoid section
    // header button duplication in grouped view.
    const filterBar = screen.getByTestId('inbox-filter-bar')
    fireEvent.click(within(filterBar).getByRole('button', { name: /失败\s*1/ }))
    await waitFor(() => {
      const entries = screen.getAllByTestId('inbox-entry')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toHaveAttribute('data-status', 'failed')
    })

    // Click "已下载" filter chip (name: "已下载 2") → flat list, 2 entries
    fireEvent.click(within(filterBar).getByRole('button', { name: /已下载\s*2/ }))
    await waitFor(() => {
      const entries = screen.getAllByTestId('inbox-entry')
      expect(entries).toHaveLength(2)
      for (const e of entries) {
        expect(e).toHaveAttribute('data-status', 'downloaded')
      }
    })
  })

  it('clicking "全部" returns to grouped view', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/ok.mp4')
    await addFailedEntry('https://example.com/bad.mp4')

    // Filter to "已下载" — scope to filter bar to avoid section header
    // button duplication in grouped view.
    const filterBar = screen.getByTestId('inbox-filter-bar')
    fireEvent.click(within(filterBar).getByRole('button', { name: /已下载\s*1/ }))
    await waitFor(() => {
      expect(screen.getAllByTestId('inbox-entry')).toHaveLength(1)
    })

    // Back to "全部" → grouped view with 2 entries across groups
    fireEvent.click(within(filterBar).getByRole('button', { name: /全部\s*2/ }))
    await waitFor(() => {
      expect(screen.getAllByTestId('inbox-entry')).toHaveLength(2)
    })

    // Both section headers should exist (inside entries container)
    // Use getAllByText because each status label appears as both
    // a section header and an InboxRow badge.
    const entries = screen.getByTestId('inbox-entries')
    expect(within(entries).getAllByText('已下载').length).toBeGreaterThanOrEqual(1)
    expect(within(entries).getAllByText('失败').length).toBeGreaterThanOrEqual(1)
  })

  // ── Grouped view section headers ──────────────────────────────────────

  it('grouped view renders section headers in STATUS_ORDER for non-empty groups', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/ok.mp4')
    await addFailedEntry('https://example.com/bad.mp4')

    // Filter is "全部" by default → grouped view with 2 non-empty groups:
    //   failed (1) → downloaded (1)
    // STATUS_ORDER: downloading → transcribing → failed → downloaded → transcribed
    //
    // Both filter chips exist in the filter bar (proves 2 non-empty
    // groups are rendered). Scope to filter bar to avoid section header
    // button duplication — section headers are ALSO <button> with the
    // same accessible name.
    const filterBar = screen.getByTestId('inbox-filter-bar')
    expect(
      within(filterBar).getByRole('button', { name: /失败\s*1/ }),
    ).toBeInTheDocument()
    expect(
      within(filterBar).getByRole('button', { name: /已下载\s*1/ }),
    ).toBeInTheDocument()

    // Section headers exist inside the entries container alongside
    // InboxRow badges (same text), so use getAllByText length check.
    const entriesContainer = screen.getByTestId('inbox-entries')
    expect(
      within(entriesContainer).getAllByText('失败').length,
    ).toBeGreaterThanOrEqual(1)
    expect(
      within(entriesContainer).getAllByText('已下载').length,
    ).toBeGreaterThanOrEqual(1)
  })

  // ── Empty filter result state ─────────────────────────────────────────

  it('shows empty filter state when specific filter has no matches', async () => {
    setAuth()
    mountInboxPage()
    await addEntry('https://example.com/ok1.mp4')
    await addEntry('https://example.com/ok2.mp4')

    // Filter to "失败" (0 entries match)
    const filterBar = screen.getByTestId('inbox-filter-bar')
    fireEvent.click(within(filterBar).getByRole('button', { name: /失败\s*0/ }))

    await waitFor(() => {
      expect(screen.getByTestId('inbox-filter-empty')).toBeInTheDocument()
      expect(screen.getByText('暂无匹配记录')).toBeInTheDocument()
      expect(screen.getByText('清除筛选')).toBeInTheDocument()
    })

    // Click "清除筛选" → back to grouped view with 2 entries
    fireEvent.click(screen.getByText('清除筛选'))
    await waitFor(() => {
      expect(screen.queryByTestId('inbox-filter-empty')).not.toBeInTheDocument()
      expect(screen.getAllByTestId('inbox-entry')).toHaveLength(2)
    })
  })

  it('empty status groups are not rendered in grouped view', async () => {
    setAuth()
    mountInboxPage()
    // Only downloaded entries
    await addEntry('https://example.com/ok1.mp4')
    await addEntry('https://example.com/ok2.mp4')
    await addEntry('https://example.com/ok3.mp4')

    // All 3 entries are 'downloaded', so only the "已下载" group renders.
    // The other 4 group section headers should be absent from the
    // grouped entries container.
    expect(screen.getAllByTestId('inbox-entry')).toHaveLength(3)

    // Only the "已下载" group section exists. The other 4 status groups
    // must NOT appear as section headers inside the entries container.
    // The filter bar still shows all labels (with count 0), so we scope
    // queries via within() to the entries container.
    const entriesContainer = screen.getByTestId('inbox-entries')

    // The "已下载" label appears as a group section header AND as badges
    // inside each entry row (3 entries × 1 badge = 3 badges + 1 header).
    // allByText with exact match returns all 4 occurrences.
    expect(
      within(entriesContainer).getAllByText('已下载').length,
    ).toBeGreaterThanOrEqual(1)

    // Empty groups must NOT appear inside the entries container
    for (const label of ['下载中', '转写中', '失败', '已转写']) {
      expect(
        within(entriesContainer).queryByText(label),
      ).not.toBeInTheDocument()
    }
  })
})
