import { afterEach, expect, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not ship ResizeObserver — @dnd-kit/dom (used by
// InboxPage's DragDropProvider) requires it at import time.
// Minimal stub: observe/unobserve/disconnect are no-ops.
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// jsdom does not ship window.matchMedia — ThemeProvider requires it
// to detect prefers-color-scheme at mount time. Minimal stub.
if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof matchMedia
}

// jsdom <25 does not ship window.EventSource. Three places in the
// codebase construct one directly:
//   - src/api/tasks.ts (streamTasks) — now has a `typeof`
//     guard that returns null early, so this stub is belt-only
//     for that path.
//   - src/api/accounts.ts:55 (refreshStaleAccounts) — also has
//     no guard yet and would ReferenceError if a test imported
//     `accountsApi` directly without vi-mocking. Stub catches.
//   - src/Components/LoginProgressModal.tsx:202 — `new
//     EventSource(sseUrl)` inside the open-effect. Renders
//     thrown ReferenceError would crash the entire test
//     simulate-open. Stub catches.
//
// Real test behavior: the stub never fires events. Tests that
// exercise SSE behavior must mock `@/api/client` (the Proxy
// pattern) and trigger events manually via the mocked stream's
// `eventListeners`. The stub just keeps the constructor from
// blowing up the whole test run.
if (typeof globalThis.EventSource === 'undefined') {
  globalThis.EventSource = class EventSource {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSED = 2
    url: string
    readyState: number = EventSource.CONNECTING
    withCredentials: boolean = false
    onerror: ((event: Event) => void) | null = null
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    constructor(url: string, init?: EventSourceInit) {
      this.url = url
      this.withCredentials = init?.withCredentials ?? false
    }
    addEventListener(_type: string, _listener: EventListenerOrEventListenerObject | null): void {
      void _type
      void _listener
    }
    removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject | null): void {
      void _type
      void _listener
    }
    close(): void {
      this.readyState = EventSource.CLOSED
    }
    dispatchEvent(_event: Event): boolean {
      void _event
      return true
    }
  } as unknown as typeof EventSource
}

// jsdom 25 sometimes lazy-mounts window.localStorage AFTER setup
// but BEFORE beforeEach runs. AppShell.tsx (and any component
// reading localStorage in a useState initializer) throws
// "Cannot read properties of undefined (reading 'removeItem')"
// or — more insidiously — exposes a localStorage whose
// `removeItem` is undefined (Storage-like shape, missing
// methods). Hoisted from per-file polyfill blocks in
// AppShell.test.tsx + AppShell.i18n.test.tsx (round-NT-28
// dashboard sweep) so all tests share one install path. The
// dual-target defineProperty (window + globalThis) handles
// environments where the bare `localStorage.removeItem(...)`
// reference resolves to globalThis, not window. Both installs
// go through `safeDefine`, a best-effort helper that swallows
// any defineProperty throw — TypeError on non-configurable
// re-define is the main one (real LS already installed with
// `configurable: false`), but the swallow also covers future
// throws (preventExtensions-target rejection, strict-mode
// descriptor failure). A working real localStorage is the
// desired terminal state, so a half-install is preferable to
// a setup-time crash that takes out the whole test file.
// Idempotent — `safeDefine` is a no-op when defineProperty
// fails (real LS stays installed).
if (
  typeof window !== 'undefined' &&
  (typeof window.localStorage === 'undefined' ||
    typeof window.localStorage.removeItem !== 'function')
) {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
  // Best-effort `Object.defineProperty`: any throw is swallowed
  // (TypeError on non-configurable re-define, preventExtensions
  // rejection, strict-mode descriptor failures, ...). Names the
  // swallow intent — "do this best-effort, half-install beats
  // setup crash". Used solely for the localStorage polyfill.
  const safeDefine = (
    target: object,
    key: string,
    descriptor: object,
  ): void => {
    try {
      Object.defineProperty(target, key, descriptor)
    } catch { void 0 }
  }
  safeDefine(window, 'localStorage', {
    value: ls,
    configurable: true,
    writable: true,
  })
  safeDefine(globalThis, 'localStorage', {
    value: ls,
    configurable: true,
    writable: true,
  })
}

// ── Custom matchers (replacement for @testing-library/jest-dom) ──
//
// KEEP IN SYNC with src/test/vitest-matchers.d.ts — adding a matcher
// here without adding it to the .d.ts (or vice versa) causes
// "Property does not exist on Assertion" at the call site.
//
// Implements the subset of jest-dom matchers actually used in this
// codebase (per the code-search inventory at the time of removal):
//   toBeInTheDocument (391), toHaveAttribute (89), toHaveTextContent
//   (37), toBeDisabled (30), toBeVisible (2), toHaveValue (1),
//   toBeChecked (1), toContainElement (1). The ratchet on tsc-error
//   count covers regression; if a future test needs a new matcher,
//   add it here AND in the .d.ts in the same commit.
//
// Asymmetric matcher support: `expect.stringContaining(...)` and
// `expect.stringMatching(...)` arrive as objects with an
// `asymmetricMatch(value)` method. We fall through to that branch
// after the string/RegExp fast-paths so jest-dom's async-matcher
// contract is preserved (the inventory today doesn't use it, but
// adding the defensive check now is cheaper than a future test
// adding it and immediately hitting `expected.test is not a function`).
function isElementDisabled(el: HTMLElement): boolean {
  // 1. Element's own native `disabled` property.
  const nativeDisabled =
    'disabled' in el && (el as HTMLButtonElement).disabled === true
  if (nativeDisabled) return true
  // 2. `aria-disabled="true"` (Radix's disabled-as-aria pattern,
  //    also used by some shadcn primitives).
  if (el.getAttribute('aria-disabled') === 'true') return true
  // 3. `<fieldset disabled>` ancestor (HTML spec: a fieldset with
  //    `disabled` set disables its first-legend-less descendants).
  const fieldset = el.closest('fieldset') as HTMLFieldSetElement | null
  if (fieldset != null && fieldset.disabled) return true
  return false
}

function asymmetricMatch(
  expected: unknown,
  actual: unknown,
): boolean {
  if (typeof expected === 'string') {
    return typeof actual === 'string' && actual.includes(expected)
  }
  if (expected instanceof RegExp) {
    return typeof actual === 'string' && expected.test(actual)
  }
  if (
    expected != null &&
    typeof (expected as { asymmetricMatch?: unknown }).asymmetricMatch === 'function'
  ) {
    return (expected as { asymmetricMatch: (v: unknown) => boolean }).asymmetricMatch(actual)
  }
  return (expected as unknown) === actual
}

expect.extend({
  toBeInTheDocument(received: unknown) {
    const pass =
      received != null &&
      received instanceof Node &&
      document.body.contains(received)
    return {
      pass,
      message: () =>
        pass
          ? 'expected element NOT to be in the document'
          : 'expected element to be in the document',
    }
  },

  toHaveTextContent(received: Element | null, expected: string | RegExp) {
    const text = received?.textContent ?? ''
    const pass = asymmetricMatch(expected, text)
    return {
      pass,
      message: () =>
        pass
          ? `expected element NOT to have text content ${String(expected)} (got: ${JSON.stringify(text)})`
          : `expected element to have text content ${String(expected)} (got: ${JSON.stringify(text)})`,
    }
  },

  toHaveValue(
    received: HTMLInputElement | HTMLTextAreaElement | null,
    expected: unknown,
  ) {
    const pass =
      received != null && (received as HTMLInputElement).value === expected
    return {
      pass,
      message: () =>
        pass
          ? `expected input NOT to have value ${String(expected)}`
          : `expected input to have value ${String(expected)} (got: ${(received as HTMLInputElement | null)?.value})`,
    }
  },

  toHaveAttribute(
    received: Element | null,
    name: string,
    expected?: string | RegExp,
  ) {
    if (received == null) {
      return {
        pass: false,
        message: () => `expected element, got ${String(received)}`,
      }
    }
    const actual = received.getAttribute(name)
    let pass: boolean
    if (expected === undefined) {
      // 2-arg form: pass if attribute exists at all.
      pass = actual !== null
    } else {
      pass = asymmetricMatch(expected, actual)
    }
    return {
      pass,
      message: () =>
        pass
          ? `expected element NOT to have attribute ${name}=${String(expected)} (got: ${String(actual)})`
          : `expected element to have attribute ${name}=${String(expected)} (got: ${String(actual)})`,
    }
  },

  toBeDisabled(received: HTMLElement | null) {
    if (received == null) {
      return {
        pass: false,
        message: () => `expected element, got ${String(received)}`,
      }
    }
    const pass = isElementDisabled(received)
    return {
      pass,
      message: () =>
        pass
          ? 'expected element NOT to be disabled'
          : 'expected element to be disabled',
    }
  },

  toBeChecked(received: HTMLInputElement | null) {
    const pass =
      received != null &&
      (received as HTMLInputElement).type === 'checkbox' &&
      (received as HTMLInputElement).checked === true
    return {
      pass,
      message: () =>
        pass
          ? 'expected input NOT to be checked'
          : 'expected input to be checked',
    }
  },

  toBeEnabled(received: HTMLElement | null) {
    if (received == null) {
      return {
        pass: false,
        message: () => `expected element, got ${String(received)}`,
      }
    }
    // Mirror of toBeDisabled — pass if NOT disabled by any of:
    // element's own `disabled` property, `aria-disabled="true"`,
    // OR a `<fieldset disabled>` ancestor (HTML spec: a fieldset
    // with `disabled` set disables its first-legend-less descendants).
    const pass = !isElementDisabled(received)
    return {
      pass,
      message: () =>
        pass
          ? 'expected element NOT to be enabled'
          : 'expected element to be enabled',
    }
  },

  toBeVisible(received: HTMLElement | null) {
    if (received == null) {
      return {
        pass: false,
        message: () => `expected element, got ${String(received)}`,
      }
    }
    if (!document.body.contains(received)) {
      return {
        pass: false,
        message: () => 'expected element to be visible (not in document)',
      }
    }
    // Fast path: HTML `hidden` attribute (the test that drives this
    // matcher in PreferencesDialog sets visibility via `hidden={!isActive}`).
    // `el.hidden` is the source of truth — `getComputedStyle(...).display`
    // depends on the UA stylesheet honoring `[hidden]`, which jsdom 16+
    // does but a future jsdom downgrade might not.
    if (received.hidden === true) {
      return {
        pass: false,
        message: () => 'expected element to be visible (has `hidden` attribute)',
      }
    }
    // Walk up the parent chain; bail at the first ancestor with
    // display:none or visibility:hidden. Mirrors jest-dom's
    // `toBeVisible` semantics — opacity:0 is intentionally NOT
    // treated as hidden (jest-dom parity; an opacity-0 element is
    // still "visible" in the layout sense, just transparent).
    let el: HTMLElement | null = received
    while (el) {
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') {
        return {
          pass: false,
          message: () =>
            `expected element to be visible (ancestor <${el!.tagName.toLowerCase()}> is ${style.display === 'none' ? 'display:none' : 'visibility:hidden'})`,
        }
      }
      el = el.parentElement
    }
    return {
      pass: true,
      message: () => 'expected element NOT to be visible',
    }
  },

  toContainElement(received: Element | null, expected: Element) {
    const pass = received != null && received.contains(expected)
    return {
      pass,
      message: () =>
        pass
          ? `expected element NOT to contain <${expected.tagName.toLowerCase()}>`
          : `expected element to contain <${expected.tagName.toLowerCase()}>`,
    }
  },
})

// jsdom/happy-dom DOM cleanup between tests
afterEach(() => {
  cleanup()
})

// Silenced globally — Radix primitives occasionally emit an
// "act()" warning under happy-dom. Real component tests still
// get their own act() wrapping via @testing-library/react.
const originalError = console.error
vi.spyOn(console, 'error').mockImplementation((...args) => {
  const first = typeof args[0] === 'string' ? args[0] : ''
  if (first.includes('not wrapped in act(')) return
  if (first.includes('inside a test was not wrapped in act')) return
  originalError(...args)
})

// Round-XXX second-batch migration: REMOVED the legacy `@/api/client`
// Proxy fallback. All 16 test files that previously mocked
// `@/api/client` have been migrated to domain-specific modules
// (`@/api/accounts`, `@/api/inbox`, `@/api/tasks`, `@/api/ai`,
// `@/api/publish`, `@/api/types`). The global Proxy was masking
// forgotten mocks — a test that imported `api.foo` from `@/api/client`
// without vi.mock-ing it would silently receive a fake `vi.fn()` that
// resolves to `{success: true}`, hiding the contract drift.
//
// After removal: a forgotten mock now triggers the REAL axios call
// → `AggregateError` in `waitFor` → the test fails LOUDLY with a
// clear "fetch failed" error. That's the desired behavior — silent
// fallback was the wrong default per the migration design rationale
// in `docs/.mimocode/plans/1784297910069-crisp-moon.md` §四 P0.
//
// If a future test genuinely needs the wide-shape fallback (e.g. for
// a contract that isn't yet wrapped in a domain module), add an
// explicit `vi.mock('@/api/<domain>', …)` at the top of THAT test file
// — do NOT reintroduce the global Proxy.
