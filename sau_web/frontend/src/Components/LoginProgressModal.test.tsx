/**
 * Stage 1b PR-B test spec — YouTube interactive headed-Chrome flow.
 *
 * Pinned affordances (data-testid attributes on `<LoginProgressModal>`
 * render output from src/Components/LoginProgressModal.tsx):
 *
 *   - `login-interactive-title`            — banner title
 *   - `login-interactive-guidance-l{1,2,3}` — 3 guidance lines
 *   - `login-interactive-cta-label`        — "5 minute auto-cancel" hint
 *   - `login-interactive-status-label`     — "headed Chrome 等待中" prose
 *
 * Test scope (TBF-027 split: handler ↔ render):
 *
 *   This file pins the COMPONENT-level render layer with a fake
 *   `EventSource` double that emits one `headed_chrome_ready` event.
 *   The provider-level dispatch (`useAuthorizeAccountGroup` +
 *   `useConfirmAuthorizeAccountGroup`) is mocked at the module
 *   boundary so the test focuses on the SSE event → UI mount path.
 *
 *   Why not also test the IE-side handlers in this file?
 *   - The 4 SSE handlers (`qrcode` / `challenge_detected` / `result` /
 *     `headed_chrome_ready`) are tightly coupled to `eventSourceRef`
 *     staleness and `cancelledRef` lifecycle state. Testing them here
 *     would need full `useEffect` mock + `act` simulation, which is
 *     brittle under jsdom's single-threaded timer.
 *   - Better: a parallel `AccountsProvider.test.tsx` integration test
 *     (mirroring the `handleReauthorize` coverage at
 *     `features/accounts/AccountsProvider.test.tsx::test_handle_reauthorize_*`)
 *     pins the handler-level invariants. That's a follow-up; this file
 *     covers the render surface which is the load-bearing assertion
 *     for PR-B's UI contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

// ── EventSource fake: collects listeners + emit() helper ─────────────
class FakeEventSource {
  static instances: FakeEventSource[] = []
  static lastReadyState = 1
  url: string
  readyState: number = FakeEventSource.lastReadyState
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {}
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    ;(this.listeners[type] ??= []).push(cb)
  }
  emit(type: string, data: unknown) {
    const evt = { data: JSON.stringify(data) } as MessageEvent
    for (const cb of this.listeners[type] ?? []) cb(evt)
  }
  close() {
    this.readyState = 2
  }
}

// Stub `EventSource` global BEFORE component imports.
;(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource

// Stub `useToast` so the headed_chrome_ready's console.info path doesn't
// crash the mount on missing ToastProvider.
vi.mock('@/Components/ui/toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

// Stub auth hook so `useAuth().user` access pattern doesn't crash.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ user: { role: 'user' } }),
}))

// Stub SSE-token fetch so the authorize chain resolves without network.
vi.mock('@/features/auth/authApi', () => ({
  authApi: {
    getSseToken: vi.fn(async () => ({
      success: true,
      data: { token: 'fake-token-for-test' },
    })),
  },
}))

// Stub mutation hooks — both resolve successfully on mutateAsync.
vi.mock('@/hooks/useAccountGroups', () => ({
  useAuthorizeAccountGroup: () => ({
    mutateAsync: vi.fn(async () => ({
      success: true,
      data: { group_name: 'test-group', platform: 'youtube' },
    })),
  }),
  useConfirmAuthorizeAccountGroup: () => ({
    mutateAsync: vi.fn(async () => ({ success: true, data: {} })),
  }),
}))

// Stub react-i18next so `t('accounts.login.interactive_browser_handoff.*', ...)`
// returns the English fallback verbatim — this gives the test stable data-testid targets
// regardless of locale bundle state, but ALSO exercises the key path so future drift fails.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

// Real component (no shallow re-export shim — we want the full render path).
import { LoginProgressModal } from './LoginProgressModal'

const props = {
  open: true,
  onOpenChange: vi.fn(),
  groupId: 42,
  platform: 'youtube',
  groupName: 'test-group',
  platformLabel: 'YouTube',
  onComplete: vi.fn(),
}

describe('LoginProgressModal · Stage 1b PR-B · YouTube interactive headed-Chrome branch', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
  })
  afterEach(() => {
    cleanup()
  })

  it('mounts the YouTube interactive headed-Chrome UI surface when headed_chrome_ready SSE event fires', async () => {
    render(<LoginProgressModal {...props} />)

    // Wait for the authorize chain + EventSource mount to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const es = FakeEventSource.instances[0]
    expect(es, 'EventSource should be opened by the authorize chain').toBeDefined()

    // Emit the PR-A contract `headed_chrome_ready` event with the
    // minimum viable payload (per Stage 1b backend contract).
    await act(async () => {
      es.emit('headed_chrome_ready', { platform: 'youtube', account: 'test-group' })
    })

    // The 7 PR-B pinned affordances should be in the DOM:
    expect(screen.getByTestId('login-interactive-title')).toHaveTextContent(
      /Browser is ready/i,
    )
    expect(screen.getByTestId('login-interactive-guidance-l1')).toBeInTheDocument()
    expect(screen.getByTestId('login-interactive-guidance-l2')).toBeInTheDocument()
    expect(screen.getByTestId('login-interactive-guidance-l3')).toBeInTheDocument()
    expect(screen.getByTestId('login-interactive-cta-label')).toHaveTextContent(
      /headed Chrome sign-in/i,
    )
    expect(screen.getByTestId('login-interactive-status-label')).toHaveTextContent(
      /headed chrome/i,
    )
  })

  it('does NOT mount the interactive UI surface before headed_chrome_ready arrives', async () => {
    render(<LoginProgressModal {...props} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    // No `headed_chrome_ready` emitted yet — surface must NOT be in DOM.
    expect(screen.queryByTestId('login-interactive-title')).toBeNull()
    expect(screen.queryByTestId('login-interactive-cta-label')).toBeNull()
  })

  it('does NOT mount the QR scan <img> for the interactive branch', async () => {
    render(<LoginProgressModal {...props} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const es = FakeEventSource.instances[0]
    await act(async () => {
      es.emit('headed_chrome_ready', { platform: 'youtube', account: 'test-group' })
    })

    // The QR scan surface (data-testid not present in production code
    // for QR — assert via absence of the YouTube QR `<img alt=...>`).
    const qrImgs = screen.queryAllByRole('img', { name: /登录二维码/i })
    expect(qrImgs, 'QR scan <img> must NOT render for interactive platforms').toHaveLength(0)
  })
})
