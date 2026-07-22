// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { Drawer } from './drawer'

// ─────────────────────────────────────────────────────────────────────────
// Drawer — i18n aria-label for close button (real I18nextProvider + locale flip)
//
// Why this file uses the real `<I18nextProvider i18n={i18n}>` pattern
// (NOT a `vi.mock('react-i18next')` stub):
//
//   1. End-to-end wiring proof — confirms the production i18n singleton
//      (`src/lib/i18n/config.ts` → `<I18nextProvider>` in test mount →
//      `useTranslation()` inside Drawer → `t('common.close', 'Close')`)
//      resolves correctly when the user switches locales. A mocked
//      `useTranslation` would prove only the call paths, not the actual
//      resource lookup + locale flip. Without this, a regression in the
//      singleton's resource-load path would silently pass.
//
//   2. Key-path coverage via resource lookup — the `common.close` key
//      must be present in BOTH the zh-CN bundle (`"关闭"`) AND the
//      en-US bundle (`"Close"`) for the locale flip to land on the
//      localized value. If a future refactor renames `common.close`
//      to e.g. `common.dismiss` in the component WITHOUT updating
//      the locale bundles, `t('common.dismiss')` falls back to `'Close'`
//      in zh-CN, and the test (which asserts `getByRole('button', {
//      name: '关闭' })`) fails red. This is the load-bearing key-drift
//      net — the real I18nextProvider pattern catches the drift
//      through the resource lookup, not via a tSpy.
//
//   3. Pattern parity with `LocalePicker.test.tsx` + `AppShell.i18n.test.tsx`.
//      This is the established project convention for chrome-surface
//      i18n tests; deviating to a tSpy stub would break the pattern
//      parity and lose the e2e wiring proof.
//
// Mock boundary:
//   • `motion/react` IS mocked (framer-motion animations don't work
//     in jsdom). The 4 framer-motion-specific props (`initial`,
//     `animate`, `exit`, `transition`) are destructured + dropped to
//     prevent noisy React warnings about unknown HTML attributes.
//   • `react-i18next` is NOT mocked — the real I18nextProvider chain
//     is the contract under test.
// ─────────────────────────────────────────────────────────────────────────

// Mock motion/react so the test doesn't depend on framer-motion
// animations (which don't work in jsdom). The `motion` components
// used by Drawer (motion.button, motion.aside) are stubbed to plain
// HTML elements so we can assert on the rendered DOM without
// animation runtime interference. `useReducedMotion` returns
// `false` so the drawer always uses the slide animation path
// (the non-reduced branch is the canonical default).
//
// IMPORTANT: framer-motion-specific props (`initial`, `animate`,
// `exit`, `transition`) are explicitly DESTRUCTURED and dropped
// before the spread — passing them through to the underlying HTML
// element would generate noisy React warnings about unknown DOM
// attributes (and break the test in strict-mode consoles).
vi.mock('motion/react', () => ({
  motion: {
    button: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown>) => (
      <button {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
        {children as React.ReactNode}
      </button>
    ),
    aside: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown>) => (
      <aside {...(props as React.HTMLAttributes<HTMLElement>)}>
        {children as React.ReactNode}
      </aside>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

// jsdom 25 occasionally lazy-mounts `window.localStorage` AFTER
// the test file's module load completes. Polyfill with an in-memory
// Map implementation. The Storage contract is preserved
// (getItem / setItem / removeItem / clear / key / length) so the
// test's own `localStorage.setItem` / `getItem` round-trips
// through the polyfill. Mirrors `LocalePicker.test.tsx`.
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

const LOCAL_STORAGE_KEY = 'sau-ui-locale'

function mountDrawer() {
  return render(
    <I18nextProvider i18n={i18n}>
      <Drawer open={true} onOpenChange={vi.fn()} />
    </I18nextProvider>,
  )
}

describe('Drawer · i18n aria-label for close button (real I18nextProvider + locale flip)', () => {
  beforeEach(async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY)
    }
    // Reset the singleton to zh-CN at the start of every test so
    // `i18n.changeLanguage(...)` calls below actually trigger a
    // re-render (rather than setting language to its current value).
    await i18n.changeLanguage('zh-CN')
  })

  // (a) Default locale is zh-CN — close button's aria-label resolves
  //     via `t('common.close', 'Close')` to the bundle value `"关闭"`.
  //     This proves the i18n resource path is wired correctly end-to-end
  //     for the production locale.
  it('default zh-CN: close button aria-label resolves to "关闭"', () => {
    mountDrawer()
    expect(
      screen.getByRole('button', { name: '关闭' }),
    ).toBeInTheDocument()
    // Negative assertion — the English fallback must NOT be present
    // in zh-CN (catches a regression where the fallback leaks through
    // even when the resource is present, e.g. if `t()` is called with
    // a wrong arg order).
    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument()
  })

  // (b) Locale flip — after `await act(() => i18n.changeLanguage('en-US'))`
  //     the close button re-renders with `aria-label="Close"` (the
  //     en-US bundle value for `common.close`). Proves the singleton's
  //     `changeLanguage` codepath propagates to the Drawer's
  //     `useTranslation()` subscription.
  it('switching to en-US flips close button aria-label to "Close"', async () => {
    mountDrawer()
    // Sanity: initial state has the Chinese label
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    expect(
      screen.getByRole('button', { name: 'Close' }),
    ).toBeInTheDocument()
    // The Chinese label is gone — catches a regression where both
    // labels would be present (e.g. if the resolved aria-label leaked
    // into a stale render tree).
    expect(
      screen.queryByRole('button', { name: '关闭' }),
    ).not.toBeInTheDocument()
  })

  // (c) Round-trip — zh-CN → en-US → zh-CN restores the Chinese
  //     label. Catches a regression where the resolved aria-label
  //     is mutated during a language change (per ADR-i18n-invariant:
  //     NEVER mutate the t() output — the resolution must always
  //     produce a fresh string on each render). If a future refactor
  //     caches the first resolved value, the second flip back would
  //     hang on English.
  it('zh-CN → en-US → zh-CN round-trip restores "关闭"', async () => {
    mountDrawer()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })

    // Chinese label restored; English label gone
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument()
  })

  // (d) Open-gate — the close button only renders when `open` is
  //     true (the AnimatePresence + open gate). Verifies the
  //     locale-flip assertion is exercising the real render path
  //     (not a stale tree from a previous test).
  it('does not render the close button when open is false (locale flip still applies)', async () => {
    // Pre-flip to en-US to prove the open=false branch is
    // locale-independent (the close button shouldn't render in
    // either locale when the drawer is closed).
    await i18n.changeLanguage('en-US')
    render(
      <I18nextProvider i18n={i18n}>
        <Drawer open={false} onOpenChange={vi.fn()} />
      </I18nextProvider>,
    )
    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument()
  })
})
