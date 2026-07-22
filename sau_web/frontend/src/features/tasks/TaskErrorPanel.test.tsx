// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { TaskErrorPanel } from './TaskErrorPanel'

// ─────────────────────────────────────────────────────────────────────────
// TaskErrorPanel — kind-specific data-kind / data-needs-relogin / CTA
// assertions (real I18nextProvider + locale flip pattern, mirroring
// drawer.test.tsx + AppShell.i18n.test.tsx + LocalePicker.test.tsx).
//
// Why this file exists:
//
//   1. Per-kind contract lock — the panel's `data-kind` /
//      `data-needs-relogin` / CTA `<Link to=…>` triplet is the
//      machine-readable contract TaskDrawer.test.tsx (and any future
//      test or operator-tooling) relies on. Each of the 7 rule kinds
//      (cookie / rate_limit / network / timeout / file / platform /
//      auth) is exercised end-to-end with a hand-picked error
//      string that matches ONLY that kind's regex (so the test is
//      deterministic — no cross-rule ambiguity).
//
//   2. CTA link resolution — for kinds with a `route` action
//      (cookie → /dashboard/accounts, file → /dashboard/publish,
//      auth → /dashboard/accounts), the `<Link to=…>` MUST resolve
//      to the right path. A future refactor that re-points a kind
//      to the wrong route (e.g. file → /dashboard/accounts by
//      mistake) trips red here before an operator clicks the CTA
//      and lands on the wrong page.
//
//   3. Retry-only branches — for kinds with `action.href = null`
//      (rate_limit / network / timeout / platform / unknown), the
//      CTA renders as a `<span>` (NOT a `<Link>`). This test pins
//      the no-Link contract: a future refactor that wraps a
//      retry-only label in `<Link to="">` would generate a useless
//      self-link in the drawer; the negative `queryByRole` assertion
//      catches that.
//
//   4. Unknown fallback — when no rule matches (or error is empty
//      with non-cookie status), the panel falls back to `kind:
//      'unknown'` with the generic 立即重试 CTA. The empty-error +
//      cookie_invalid-status path falls back to `kind: 'cookie'`
//      (this is a deliberate branch in humanizeTaskError — the
//      status field carries the cookie signal even when the error
//      string is empty).
//
//   5. Locale flip invariance — the panel's titles / details /
//      CTA labels are HARDCODED Chinese in humanizeTaskError
//      (NOT in the locale bundles). The locale flip test asserts
//      that the data-kind / data-needs-relogin / CTA href DON'T
//      change when locale flips — the panel is locale-independent
//      for routing (an operator on en-US who hits a cookie failure
//      is still routed to /dashboard/accounts; the title stays
//      登录态失效 because that's the canonical copy for the
//      kind, not a translation).
//
// Mock boundary:
//   • `react-i18next` is NOT mocked — the real I18nextProvider
//     chain (src/lib/i18n/config.ts → <I18nextProvider> in test
//     mount → useTranslation inside the panel's child branches)
//     is the contract under test. The panel doesn't currently
//     call useTranslation, but the real-provider pattern is the
//     project convention for chrome/feature tests (per
//     docs/dev/adr-i18n-invariant.md + drawer.test.tsx). If a
//     future refactor localizes the action.label or the
//     empty-error fallback text, the test harness already
//     supports it.
//   • `react-router-dom` is wrapped in <MemoryRouter> because
//     TaskErrorPanel renders <Link to={h.action.href}> for
//     route-bearing kinds (cookie / file / auth). Without
//     MemoryRouter, the Link's use of react-router internals
//     throws outside a router context.
//   • No localStorage writes — the panel doesn't touch
//     localStorage. The polyfill below is for parity with
//     drawer.test.tsx (some sibling test files share the
//     jsdom env) and to guard against future side-effects.
// ─────────────────────────────────────────────────────────────────────────

// jsdom 25 occasionally lazy-mounts `window.localStorage` AFTER
// the test file's module load completes. Polyfill with an in-memory
// Map implementation. The Storage contract is preserved
// (getItem / setItem / removeItem / clear / key / length) so the
// test's own `localStorage.setItem` / `getItem` round-trips
// through the polyfill. Mirrors `drawer.test.tsx` +
// `LocalePicker.test.tsx`.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) =>
        store.has(key) ? (store.get(key) as string) : null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value))
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size
      },
    },
    configurable: true,
    writable: true,
  })
}

function mountPanel(props: {
  error: string | null | undefined
  status: string
}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <TaskErrorPanel error={props.error} status={props.status} />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('TaskErrorPanel · kind-specific data-kind / data-needs-relogin / CTA link assertions', () => {
  beforeEach(async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('sau-ui-locale')
    }
    // Reset the singleton to zh-CN at the start of every test so
    // `i18n.changeLanguage(...)` calls below actually trigger a
    // re-render (rather than setting language to its current value).
    await i18n.changeLanguage('zh-CN')
  })

  // (a) cookie — `needsRelogin: true` + action.href = /dashboard/accounts.
  //     The most common production failure mode (cookie expiry after
  //     long idle). Pinning this contract is the highest-impact single
  //     test in the file.
  it('cookie: data-kind=cookie + data-needs-relogin=true + CTA link to /dashboard/accounts', () => {
    mountPanel({ error: 'cookie invalid', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-tag', 'task-error-panel')
    expect(panel).toHaveAttribute('data-kind', 'cookie')
    expect(panel).toHaveAttribute('data-needs-relogin', 'true')
    // The CTA is a real react-router <Link>, so getByRole('link')
    // resolves to the rendered <a href="/dashboard/accounts">.
    const cta = screen.getByRole('link', { name: /去重新登录/ })
    expect(cta).toHaveAttribute('href', '/dashboard/accounts')
  })

  // (b) rate_limit — no needsRelogin, action.href = null (retry-only
  //     CTA rendered as a <span>, NOT a <Link>). The
  //     `queryByRole('link', ...)` negative assertion catches a
  //     regression where the retry-only label accidentally gets
  //     wrapped in a <Link to="">.
  it('rate_limit: data-kind=rate_limit + data-needs-relogin=false + retry-only CTA (no link)', () => {
    mountPanel({ error: 'rate_limit triggered', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'rate_limit')
    expect(panel).toHaveAttribute('data-needs-relogin', 'false')
    // Retry-only label rendered as <span>
    expect(screen.getByText('稍后重试')).toBeInTheDocument()
    // No <a> / <Link> for retry-only actions
    expect(
      screen.queryByRole('link', { name: /稍后重试/ }),
    ).not.toBeInTheDocument()
  })

  // (c) network — no needsRelogin, retry-only CTA. Same shape as (b);
  //     included separately so a future refactor that re-points
  //     network's action.href to a route trips red specifically
  //     for the network kind.
  it('network: data-kind=network + data-needs-relogin=false + retry-only CTA (no link)', () => {
    mountPanel({ error: 'ECONNREFUSED', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'network')
    expect(panel).toHaveAttribute('data-needs-relogin', 'false')
    expect(screen.getByText('立即重试')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /立即重试/ }),
    ).not.toBeInTheDocument()
  })

  // (d) timeout — no needsRelogin, retry-only CTA. The error
  //     string "deadline exceeded" matches ONLY the timeout rule's
  //     `deadline` token (NOT the network rule's `timeout` token),
  //     so the test is deterministic.
  it('timeout: data-kind=timeout + data-needs-relogin=false + retry-only CTA (no link)', () => {
    mountPanel({ error: 'deadline exceeded', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'timeout')
    expect(panel).toHaveAttribute('data-needs-relogin', 'false')
    expect(screen.getByText('立即重试')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /立即重试/ }),
    ).not.toBeInTheDocument()
  })

  // (e) file — no needsRelogin, action.href = /dashboard/publish.
  //     The CTA routes the operator back to the publish wizard
  //     (the most likely fix is to re-pick a valid video file).
  it('file: data-kind=file + data-needs-relogin=false + CTA link to /dashboard/publish', () => {
    mountPanel({ error: 'video file too large', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'file')
    expect(panel).toHaveAttribute('data-needs-relogin', 'false')
    const cta = screen.getByRole('link', { name: /重新发布/ })
    expect(cta).toHaveAttribute('href', '/dashboard/publish')
  })

  // (f) platform — no needsRelogin, retry-only CTA. Common cause
  //     of flaky automation (platform A/B test, DOM rename). The
  //     retry-only contract is important here: routing the operator
  //     to a "fix platform" page would be wrong — the right action
  //     is just to retry the run.
  it('platform: data-kind=platform + data-needs-relogin=false + retry-only CTA (no link)', () => {
    mountPanel({ error: 'selector not found', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'platform')
    expect(panel).toHaveAttribute('data-needs-relogin', 'false')
    expect(screen.getByText('立即重试')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /立即重试/ }),
    ).not.toBeInTheDocument()
  })

  // (g) auth — no needsRelogin (the issue is perms, not session
  //     expiry), action.href = /dashboard/accounts. The CTA label
  //     "查看账号" (vs cookie's "去重新登录") is the signal that
  //     the user shouldn't re-login, they should investigate
  //     account-level state in the platform app.
  it('auth: data-kind=auth + data-needs-relogin=false + CTA link to /dashboard/accounts', () => {
    mountPanel({ error: '403 permission denied', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'auth')
    expect(panel).toHaveAttribute('data-needs-relogin', 'false')
    const cta = screen.getByRole('link', { name: /查看账号/ })
    expect(cta).toHaveAttribute('href', '/dashboard/accounts')
  })

  // (h) unknown — no rule matched. The panel falls back to the
  //     generic "发布失败" + retry-only CTA. `data-kind=unknown` is
  //     the signal for any future analytics / triage tooling to
  //     bucket this failure as "uncategorized" (vs. the 7 known
  //     kinds). Pinning the contract here ensures the fallback
  //     doesn't silently drop the data-kind attribute.
  it('unknown: data-kind=unknown (no rule matched) + data-needs-relogin=false + retry-only CTA', () => {
    mountPanel({
      error: 'completely unrecognized xyz',
      status: 'failed',
    })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'unknown')
    expect(panel).toHaveAttribute('data-needs-relogin', 'false')
    expect(screen.getByText('立即重试')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /立即重试/ }),
    ).not.toBeInTheDocument()
  })

  // (i) Empty error + cookie_invalid status — the special-case
  //     branch in humanizeTaskError. When the task's `error` field
  //     is null/empty BUT the status is 'cookie_invalid', the
  //     panel falls back to kind='cookie' (NOT kind='unknown').
  //     This is a deliberate signal: an empty error + cookie
  //     status is a known pattern from the uploader (the CLI
  //     sometimes returns a null error with a sentinel status
  //     when the browser was killed mid-login). Pinning this
  //     contract ensures a future refactor of humanizeTaskError
  //     doesn't accidentally route this case to 'unknown'.
  it('empty error + status=cookie_invalid → falls back to cookie kind + relogin CTA', () => {
    mountPanel({ error: null, status: 'cookie_invalid' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'cookie')
    expect(panel).toHaveAttribute('data-needs-relogin', 'true')
    const cta = screen.getByRole('link', { name: /去重新登录/ })
    expect(cta).toHaveAttribute('href', '/dashboard/accounts')
  })

  // (j) Locale flip invariance — the panel's data-kind /
  //     data-needs-relogin / CTA href MUST be locale-independent.
  //     Titles, details, and action labels are hardcoded Chinese
  //     in humanizeTaskError (NOT in the locale bundles), so they
  //     don't change on a locale flip. This is by design: an
  //     operator on en-US who hits a cookie failure is still
  //     routed to /dashboard/accounts (the right place to fix
  //     the issue) — the panel's copy is in the canonical
  //     language for the kind, not a translation of it. Without
  //     this test, a future refactor that wraps h.title in t(...)
  //     would silently break the contract (en-US title would
  //     fall back to the dev-time literal, missing the bundled
  //     en-US resource).
  it('locale flip zh-CN → en-US: data-kind / data-needs-relogin / CTA href unchanged (panel is locale-independent for routing)', async () => {
    mountPanel({ error: 'cookie invalid', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'cookie')
    expect(panel).toHaveAttribute('data-needs-relogin', 'true')
    const ctaBefore = screen.getByRole('link', { name: /去重新登录/ })
    expect(ctaBefore).toHaveAttribute('href', '/dashboard/accounts')

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    // After flip: data-kind / data-needs-relogin / CTA href are
    // all unchanged. The panel re-renders (because I18nextProvider
    // subscribes the component to the singleton's language state),
    // but the routing contract is preserved.
    expect(panel).toHaveAttribute('data-kind', 'cookie')
    expect(panel).toHaveAttribute('data-needs-relogin', 'true')
    const ctaAfter = screen.getByRole('link', { name: /去重新登录/ })
    expect(ctaAfter).toHaveAttribute('href', '/dashboard/accounts')
  })

  // (k) a11y contract — the panel is announced to screen readers
  //     via `role="alert"` + `aria-live="polite"`. The aria-live
  //     value is "polite" (not "assertive") because the failure is
  //     informational — the operator is already looking at the
  //     drawer, we just want the SR to read the failure aloud
  //     when the drawer opens, not interrupt whatever's
  //     currently being read.
  it('renders with role="alert" + aria-live="polite" for screen-reader announcement', () => {
    mountPanel({ error: 'cookie invalid', status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('aria-live', 'polite')
    expect(panel).toHaveAttribute('data-tag', 'task-error-panel')
  })

  // (l) Long-error truncation — `humanizeTaskError` truncates the
  //     title to 48 chars + '…' when no rule matches AND the raw
  //     error's first line is > 48 chars (table-row density cap).
  //     Locks code-reviewer round-1 nit #2.
  it('unknown + long first line (> 48 chars): title truncated to 48 chars + "…" + detail kept full', () => {
    const longError = 'x'.repeat(80)
    mountPanel({ error: longError, status: 'failed' })
    const panel = screen.getByRole('alert')
    expect(panel).toHaveAttribute('data-kind', 'unknown')
    expect(panel).toHaveAttribute('data-needs-relogin', 'false')
    // Anchored regex locks the EXACT 48+… form so a future
    // threshold bump (e.g. 48 → 64) fails the test loudly.
    const title = screen.getByText(/^x{48}…$/)
    expect(title.textContent?.length).toBe(49)
    // Detail is the full 80-char string (under the 400-char
    // detail-ceiling, no truncation).
    expect(screen.getByText(longError)).toBeInTheDocument()
  })
})
