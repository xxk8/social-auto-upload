// Minimal test-utils — second step in the 5-PR migration to remove
// `@testing-library/react`. ChatArea.test.tsx is the first consumer;
// PR 3-5 migrate the remaining 44 files.
//
// Surface:
//   - `render(ui)` → mounts via `createRoot` + sync `act()`, appends
//     a container to `document.body`, returns `{ container }`. The
//     `afterEach` at the bottom auto-removes it.
//   - `screen` is a singleton over the last render (matches
//     @testing-library's pattern so 45+ test files don't have to
//     change call shape). Queries: `getByText` / `queryByText` /
//     `getByTestId` / `queryByTestId` / `getByRole` / `queryByRole`.
//   - `fireEvent.click` / `change` / `keyDown` wrap dispatches in
//     sync `act()` so React 19 auto-batching can't race the next
//     `screen.getBy*` (PR 1 spent 7 iterations on this — applied
//     here from day one). `change` uses the React prototype-setter
//     pattern so controlled-input onChange trackers fire. `keyDown`
//     applies the `Object.defineProperty` workaround for `keyCode`
//     (PR 1 v6 lesson: `KeyboardEventInit` drops the legacy field).
//
// Text queries normalize whitespace on both sides (so `'foo  bar'`
// matches `<p>foo\n  bar</p>` from JSX indentation). Without this,
// future migrations would intermittently fail on multi-line text.
import { type ReactElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach } from 'vitest'

let currentRoot: Root | null = null
let currentContainer: HTMLElement | null = null

export function render(ui: ReactElement): { container: HTMLElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  // `!:` definite-assignment assertion — `act()` is sync, so `root`
  // is always assigned by the next line. Without it, tsc can't track
  // the assignment through the closure and flags `root` as possibly
  // null (TS18047).
  let root!: Root
  act(() => {
    root = createRoot(container)
    root.render(ui)
  })
  currentRoot = root
  currentContainer = container
  return { container }
}

function getContainer(): HTMLElement {
  if (!currentContainer) {
    throw new Error(
      'No rendered component. Call `render(<Component />)` before using `screen`.',
    )
  }
  return currentContainer
}

// React hijacks `HTMLInputElement.prototype.value` (and TextArea) to
// track controlled-input state. Direct `el.value = X` bypasses that
// tracker, so onChange handlers see a stale value. Mirror @testing-
// library: grab the prototype's native setter, call it on the
// instance, then dispatch `change`. PR 4's form migrations (VideoForm
// / NoteForm) rely on this.
function setInputValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter!.call(el, value)
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

function matchesText(el: Element, q: string | RegExp): boolean {
  const t = norm(el.textContent ?? '')
  return typeof q === 'string' ? t.includes(q) : q.test(t)
}

function findByText(q: string | RegExp): Element | null {
  // Deepest-match heuristic: skip an ancestor if a descendant also
  // matches (so `<p>foo</p>` is returned, not its `<body>` wrapper).
  for (const el of getContainer().querySelectorAll('*')) {
    if (!matchesText(el, q)) continue
    let hasMatchingDescendant = false
    for (const c of el.querySelectorAll('*')) {
      if (matchesText(c, q)) {
        hasMatchingDescendant = true
        break
      }
    }
    if (!hasMatchingDescendant) return el
  }
  return null
}

function findByRole(
  role: string,
  options?: { name?: string | RegExp },
): Element | null {
  for (const el of getContainer().querySelectorAll('*')) {
    if (el.getAttribute('role') !== role) continue
    if (options?.name) {
      const accessible = el.getAttribute('aria-label') ?? el.textContent ?? ''
      if (
        typeof options.name === 'string'
          ? !accessible.includes(options.name)
          : !options.name.test(accessible)
      ) {
        continue
      }
    }
    return el
  }
  return null
}

export const screen = {
  getByText(q: string | RegExp): HTMLElement {
    const f = findByText(q)
    if (!f) throw new Error(`getByText: no element matching ${String(q)}`)
    return f as HTMLElement
  },
  queryByText(q: string | RegExp): HTMLElement | null {
    return findByText(q) as HTMLElement | null
  },
  getByTestId(id: string): HTMLElement {
    const f = getContainer().querySelector(`[data-testid="${id}"]`)
    if (!f) {
      throw new Error(`getByTestId: no element matching [data-testid="${id}"]`)
    }
    return f as HTMLElement
  },
  queryByTestId(id: string): HTMLElement | null {
    return getContainer().querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  },
  getByRole(role: string, options?: { name?: string | RegExp }): HTMLElement {
    const f = findByRole(role, options)
    if (!f) throw new Error(`getByRole: no element with role="${role}"`)
    return f as HTMLElement
  },
  queryByRole(
    role: string,
    options?: { name?: string | RegExp },
  ): HTMLElement | null {
    return findByRole(role, options) as HTMLElement | null
  },
}

// MDN keyCode values for the special keys we test. `KeyboardEventInit`
// drops the legacy `keyCode` field from the constructor (per DOM spec
// — it's deprecated), so we have to patch it on the event instance
// via `Object.defineProperty` after construction. PR 1 v6 documented
// this; PR 4 form tests will need it for Radix Tabs roving tabindex.
const KEY_CODES: Record<string, number> = {
  Escape: 27,
  Enter: 13,
  Space: 32,
  Tab: 9,
  ArrowDown: 40,
  ArrowUp: 38,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Backspace: 8,
  Delete: 46,
}

const dispatchInAct = (el: Element, ev: Event): void => {
  act(() => {
    el.dispatchEvent(ev)
  })
}

export const fireEvent = {
  click(el: Element): void {
    dispatchInAct(
      el,
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
  },
  change(el: Element, init: { target: { value: string } }): void {
    // Set value via React's prototype-setter BEFORE dispatching so
    // the onChange handler sees the new value. Direct `el.value =`
    // bypasses React's controlled-input tracker.
    if ('value' in el) {
      setInputValue(el as HTMLInputElement, init.target.value)
    }
    dispatchInAct(el, new Event('change', { bubbles: true, cancelable: true }))
  },
  keyDown(el: Element, init: { key: string; code?: string }): void {
    const ev = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    })
    const keyCode = KEY_CODES[init.key] ?? 0
    Object.defineProperty(ev, 'keyCode', { value: keyCode, configurable: true })
    Object.defineProperty(ev, 'which', { value: keyCode, configurable: true })
    dispatchInAct(el, ev)
  },
}

// Auto-cleanup between tests. `setup.ts`'s `afterEach(cleanup())`
// only clears @testing-library/react's container; we own our own.
// The `const root = currentRoot` capture is the same narrowing trick
// as the render fix — `if (currentRoot)` narrows the type only in
// the outer scope, not inside the `act` callback's closure.
afterEach(() => {
  if (currentRoot) {
    const root = currentRoot
    act(() => {
      root.unmount()
    })
    currentRoot = null
  }
  if (currentContainer) {
    currentContainer.remove()
    currentContainer = null
  }
})
