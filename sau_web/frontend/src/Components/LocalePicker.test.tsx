// ── LocalePicker — visitor-facing locale picker. Used inside
//    `<MarketingTopBar />`'s nav cluster as the sibling of
//    `<ThemeToggle size="compact" />`. Round-NT-28 i18n MVP test.
//
// Why this file exists:
//
//   1. End-to-end wiring proof — confirms the real I18nextProvider
//      bootstrap chain (`src/lib/i18n/config.ts` → `<I18nextProvider>`
//      in test mount → `useTranslation()` inside the picker →
//      `useLocale()` → `i18n.changeLanguage` + `localStorage.setItem`)
//      resolves correctly when the user clicks an option. A mocked
//      `useTranslation` would prove only the call paths, not the
//      actual locale resolution + persistence.
//
//   2. native-language label invariant — both options render in their
//      OWN language (`中文` / `English`), NOT in the user's current
//      locale or in English. Per the architect's chrome-mockup
//      review, this is the "speak the visitor's language first" rule.
//
//   3. localStorage persistence — `useLocale.setLocale()` writes
//      `sau-ui-locale` AFTER `await i18n.changeLanguage(...)`. The
//      await-then-write order prevents the "I picked x, displayed y,
//      crashed to z" race. Confirmed end-to-end here because a future
//      refactor that re-orders the writes trips red before the next
//      page-boot.
//
//   4. active-marker swap — the small ✓ glyph + `data-active="true"`
//      attribute follows the live locale. Asserted after click so a
//      mirror-state desync (locale says en-US, marker still on zh-CN)
//      trips red.
//
//   5. aria-label parity — the trigger's accessible name mirrors
//      `locale.switch_label` and the menu-label mirrors
//      `locale.select_label`. Without these, screen-reader users on
//      en-US still hear "切换语言 / 选择语言" instead of the localized
//      equivalents — defeating the screen-reader i18n contract.
//
// Harness notes:
//
//   • Real `<I18nextProvider i18n={i18n}>` (no `vi.mock('react-
//     i18next', ...)` here) wraps the component-under-test so the
//     singleton's resources + changeLanguage path exercise the
//     production code.
//
//   • All click interactions go through `userEvent.click` (the
//     project's `user-event-shim`). Radix's DropdownMenu trigger
//     listens for a synthesized "press" event sourced from
//     pointerdown/pointerup, NOT click. `fireEvent.click` skips
//     pointer events, so the dropdown content never portals. The
//     shim's `user.click()` covers the canonical sequence Radix
//     expects under jsdom. Established pattern in UserMenu.test.tsx.
//
//   • `localStorage` polyfill at module-load (jsdom 25 lazy-mount
//     workaround — `<ThemeProvider>`'s useState initializer reads
//     `localStorage.getItem` synchronously).

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { LocalePicker } from '@/Components/LocalePicker'

// jsdom 25 occasionally lazy-mounts `window.localStorage` AFTER
// the test file's module load completes; when that happens,
// `<ThemeProvider>`'s `useState` initializer throws on first
// render. Polyfill with an in-memory Map implementation. The
// Storage contract is preserved (getItem / setItem / removeItem /
// clear / key / length) so the test's own `localStorage.setItem` /
// `getItem` assertions round-trip through the polyfill.
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

function mountLocalePicker() {
  return render(
    <I18nextProvider i18n={i18n}>
      <TestProviders client={makeQueryClient()}>
        <LocalePicker />
      </TestProviders>
    </I18nextProvider>,
  )
}

// Radix DropdownMenu trigger / menu-item interactions require the
// pointer-event sequence (pointerdown → pointerup → click) before
// Radix's press detection synthesizes the click as a "press".
// The project's `user-event-shim` `user.click()` only does
// `el.focus() + fireEvent.click(el)` — it does NOT dispatch
// pointerdown/pointerup, so Radix's press detection never fires
// and the dropdown content never portals to document.body. This
// helper bridges the gap locally without modifying the shim (which
// is shared with other test files that may depend on its current
// semantics).
async function radixClick(el: HTMLElement) {
  await act(async () => {
    fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(el, { button: 0, pointerType: 'mouse' })
    el.focus()
    fireEvent.click(el)
  })
}

describe('LocalePicker · visitor-facing locale picker used in MarketingTopBar (Round-NT-28 i18n MVP)', () => {
  beforeEach(async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY)
    }
    await i18n.changeLanguage('zh-CN')
  })

  // (a) Trigger button is present + accessible-name + data-testid.
  it('renders trigger button with data-testid="locale-picker-trigger" + aria-label "切换语言" in zh-CN', () => {
    mountLocalePicker()
    const trigger = screen.getByTestId('locale-picker-trigger')
    expect(trigger).toBeInTheDocument()
    // aria-label resolves via `t('locale.switch_label', '切换语言')`
    // — in zh-CN the resource key is present so the resource value
    // wins over the fallback (still '切换语言').
    expect(trigger).toHaveAttribute('aria-label', '切换语言')
  })

  // (b) Click trigger → Radix DropdownMenu portals content to
  //     document.body. Click en-US option → i18n.language flips +
  //     localStorage write completes.
  it('clicking en-US option flips i18n.language to "en-US" + writes localStorage', async () => {
    mountLocalePicker()
    const trigger = screen.getByTestId('locale-picker-trigger')

    // radixClick dispatches pointerdown + pointerup + click so
    // Radix's press detection synthesizes the click as a "press"
    // and the dropdown content portals to document.body.
    await radixClick(trigger)
    const enOption = await screen.findByTestId('locale-option-en-US')
    expect(enOption).toBeInTheDocument()

    // Native-language label invariant — the option shows "English"
    // regardless of the active locale. Locks the "speak the visitor's
    // language first" rule.
    expect(enOption).toHaveTextContent('English')

    await radixClick(enOption)

    // changeLanguage resolves async; waitFor polls until the
    // singleton reflects the new locale.
    await waitFor(() => {
      expect(i18n.language).toBe('en-US')
    })
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEY)).toBe('en-US')
  })

  // (c) Flip back round-trip — start at zh-CN → en-US → zh-CN again.
  //     Validates the picker is symmetric, not a one-way toggle.
  it('flipping to en-US then back to zh-CN restores i18n.language + localStorage', async () => {
    mountLocalePicker()
    const trigger = screen.getByTestId('locale-picker-trigger')

    // First flip: zh-CN → en-US
    await radixClick(trigger)
    await radixClick(screen.getByTestId('locale-option-en-US'))
    await waitFor(() => expect(i18n.language).toBe('en-US'))

    // Second flip: en-US → zh-CN
    await radixClick(trigger)
    const zhOption = await screen.findByTestId('locale-option-zh-CN')
    expect(zhOption).toHaveTextContent('中文')
    await radixClick(zhOption)
    await waitFor(() => expect(i18n.language).toBe('zh-CN'))
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEY)).toBe('zh-CN')
  })

  // (d) After clicking en-US, the active marker swaps. The active
  //     option carries `data-active="true"`; the inactive one has NO
  //     data-active attribute (vs `data-active="false"`, which would
  //     mismatch LocalePicker.tsx's conditional that emits `undefined`).
  it('after en-US flip, locale-option-en-US has data-active="true" + locale-option-zh-CN has none', async () => {
    mountLocalePicker()
    const trigger = screen.getByTestId('locale-picker-trigger')

    await radixClick(trigger)
    await radixClick(screen.getByTestId('locale-option-en-US'))
    await waitFor(() => expect(i18n.language).toBe('en-US'))

    // Reopen the dropdown to inspect both options. Polled lookup —
    // Radix DropdownMenu's toggle-on-trigger re-open transition
    // isn't instant; `findByTestId` polls up to 1s for the portal
    // to mount.
    await radixClick(trigger)
    const reopenedEn = await screen.findByTestId('locale-option-en-US')
    const reopenedZh = await screen.findByTestId('locale-option-zh-CN')
    expect(reopenedEn).toHaveAttribute('data-active', 'true')
    expect(reopenedZh).not.toHaveAttribute('data-active')
  })

  // (e) Trigger's aria-label flips with locale — proves the
  //     i18n.next subsystem inside the chrome ALSO picks up the
  //     locale change (not just the i18n.language singleton state).
  it('trigger aria-label flips "切换语言" → "Switch language" on en-US flip', async () => {
    mountLocalePicker()
    const trigger = screen.getByTestId('locale-picker-trigger')
    expect(trigger).toHaveAttribute('aria-label', '切换语言')

    await radixClick(trigger)
    await radixClick(screen.getByTestId('locale-option-en-US'))
    await waitFor(() => expect(i18n.language).toBe('en-US'))

    expect(screen.getByTestId('locale-picker-trigger')).toHaveAttribute(
      'aria-label',
      'Switch language',
    )
  })

  // (f) DropdownMenuLabel (the "选择语言" / "Select language" eyebrow)
  //     flips in lockstep. Locks the second chrome string beyond
  //     the trigger's aria-label.
  it('dropdown label mirror flips "选择语言" → "Select language" on en-US flip', async () => {
    mountLocalePicker()
    const trigger = screen.getByTestId('locale-picker-trigger')

    await radixClick(trigger)
    expect(screen.getByText('选择语言')).toBeInTheDocument()

    await radixClick(screen.getByTestId('locale-option-en-US'))
    await waitFor(() => expect(i18n.language).toBe('en-US'))

    await radixClick(trigger)
    expect(screen.getByText('Select language')).toBeInTheDocument()
    expect(screen.queryByText('选择语言')).not.toBeInTheDocument()
  })
})
