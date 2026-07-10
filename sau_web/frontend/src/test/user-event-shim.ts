/**
 * Minimal `userEvent` shim — replacement for `@testing-library/user-event`
 * (removed in round-OPT-jest-dom-removal because the dep is used in
 * exactly ONE test file: PreferencesDialog.test.tsx). The shim covers
 * the API surface that file actually uses:
 *
 *   - `userEvent.setup()`     → returns a user object
 *   - `user.click(el)`        → fires a click event (awaits a microtask)
 *   - `user.keyboard(input)`  → dispatches keydown/keyup sequences with
 *                               `{KeyName}` placeholder support
 *                               (e.g. `'{Escape}'`, `'{ArrowDown}'`,
 *                               `'{Home}'`, `'{End}'`)
 *
 * If a future test needs `user.type` / `user.tab` / `user.hover` etc.,
 * extend the `SPECIAL_KEYS` map and the `keyboard` parser — the file
 * is intentionally small so the surface is auditable.
 *
 * Why a shim instead of migrating to `fireEvent`? `fireEvent.click(el)`
 * has subtly different semantics (no focus / pointer-move) than
 * `userEvent.click(el)`, and a test that depends on the realistic
 * event sequence (Radix Dialog's dismissable-layer, focus management
 * on tabs) would need a heavier rewrite. The shim preserves the
 * user-event contract at minimum cost.
 */
import { fireEvent } from '@testing-library/react'
import { act } from 'react'

// `{KeyName}` → DOM `key` / `code` / legacy `keyCode` value. The
// `keyCode` field is the legacy KeyboardEvent property that some
// libraries (notably Radix Tabs' roving-tabindex handler) read
// alongside the modern `key` / `code` fields. Without it, arrow-key
// navigation silently fails. Numbers below are the standardized
// KeyboardEvent.keyCode values from
// https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
const SPECIAL_KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  Escape:    { key: 'Escape',    code: 'Escape',    keyCode: 27 },
  Enter:     { key: 'Enter',     code: 'Enter',     keyCode: 13 },
  Space:     { key: ' ',         code: 'Space',     keyCode: 32 },
  Tab:       { key: 'Tab',       code: 'Tab',       keyCode: 9  },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp:   { key: 'ArrowUp',   code: 'ArrowUp',   keyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight:{ key: 'ArrowRight',code: 'ArrowRight',keyCode: 39 },
  Home:      { key: 'Home',      code: 'Home',      keyCode: 36 },
  End:       { key: 'End',       code: 'End',       keyCode: 35 },
  PageUp:    { key: 'PageUp',    code: 'PageUp',    keyCode: 33 },
  PageDown:  { key: 'PageDown',  code: 'PageDown',  keyCode: 34 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8  },
  Delete:    { key: 'Delete',    code: 'Delete',    keyCode: 46 },
}

type Keystroke = { key: string; code: string; keyCode: number }

/**
 * Parse a keyboard-input string with `{KeyName}` placeholders into
 * a sequence of keystroke descriptors. Each descriptor carries
 * `key` + `code` + `keyCode` (the latter is the legacy field some
 * libraries still read; the modern `key` is the primary contract).
 *
 * Examples:
 *   `'{Escape}'`           → `[{ key: 'Escape', code: 'Escape', keyCode: 27 }]`
 *   `'hello'`              → one descriptor per character
 *   `'a{Escape}b'`         → `a`, `Escape`, `b` (3 descriptors)
 */
function parseKeyboardString(input: string): Keystroke[] {
  const out: Keystroke[] = []
  // Matches `{KeyName}` (group 1) or a single non-`{` character (group 2).
  // The unbalanced `}` literal in input is dropped (jest-dom parity).
  const re = /\{([A-Za-z]+)\}|([^{])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (m[1] !== undefined) {
      const token = m[1]
      const mapped = SPECIAL_KEYS[token] ?? token
      // SPECIAL_KEYS entry shape: { key, code, keyCode }. The fallback
      // `?? token` case (an unmapped `{Foo}` token) yields a keystroke
      // with keyCode=0, which the event constructor accepts (keyCode is
      // writable, 0 = "no mapping" per the DOM spec).
      out.push(
        mapped && typeof mapped === 'object'
          ? mapped
          : { key: token, code: token, keyCode: 0 },
      )
    } else if (m[2] !== undefined) {
      const ch = m[2]
      out.push({ key: ch, code: `Key${ch.toUpperCase()}`, keyCode: ch.charCodeAt(0) })
    }
  }
  return out
}

/**
 * Dispatch a single keystroke to the given element. Uses raw
 * `new KeyboardEvent(...)` + `Object.defineProperty` to set
 * `keyCode` post-construction — NOT `fireEvent.keyDown` from
 * `@testing-library/react` (which we tried in v4-v5 and silently
 * dropped the legacy `keyCode` field; the DOM spec's
 * `KeyboardEventInit` dictionary ignores it because the property is
 * deprecated, and the KeyboardEvent constructor drops it from
 * `init` on the way in).
 *
 * Why `keyCode` matters: Radix Tabs' roving-tabindex handler reads
 * `event.keyCode` (alongside the modern `key` field) for arrow /
 * Home / End navigation. The shim's `SPECIAL_KEYS` map above carries
 * the canonical MDN keyCode values for every special key in the
 * inventory. The PreferencesDialog arrow-down / arrow-up /
 * Home+End tests were the canary that exposed the v5 silent drop.
 *
 * We also patch `which` (the even older legacy property some
 * libraries still read) for belt-and-suspenders, and dispatch
 * keyup so handlers that bind to `keyup` (e.g. the Escape-to-close
 * in Radix Dialog) get a matching release event. The deprecated
 * `keypress` event is intentionally NOT dispatched (matches
 * user-event v14 behavior).
 */
function dispatchKey(
  el: Element,
  key: string,
  code: string,
  keyCode: number,
): void {
  const init: KeyboardEventInit = {
    key,
    code,
    bubbles: true,
    cancelable: true,
    composed: true,
  }
  const downEvent = new KeyboardEvent('keydown', init)
  Object.defineProperty(downEvent, 'keyCode', { value: keyCode, configurable: true })
  Object.defineProperty(downEvent, 'which', { value: keyCode, configurable: true })
  el.dispatchEvent(downEvent)

  const upEvent = new KeyboardEvent('keyup', init)
  Object.defineProperty(upEvent, 'keyCode', { value: keyCode, configurable: true })
  Object.defineProperty(upEvent, 'which', { value: keyCode, configurable: true })
  el.dispatchEvent(upEvent)
}

const userEvent = {
  /**
   * `setup()` is a no-op for our purposes — it exists for
   * `@testing-library/user-event` parity so call sites
   * (`const user = userEvent.setup()`) don't need to change. Returns
   * a user object with the methods we implement. Each call returns
   * a fresh object — there is intentionally no shared state between
   * `setup()` calls (parity with user-event v14, where `setup()`
   * also returns a per-instance handle; vitest's test isolation
   * expects this).
   */
  setup() {
    return {
      click(el: HTMLElement) {
        // user-event v14 focuses the element as part of its click
        // sequence (mousedown → focus → mouseup → click). Radix Tabs
        // + Dialog rely on the focused element being correct before
        // keyboard navigation (e.g. PreferencesDialog's ArrowDown
        // cycles between focused Tab.Triggers) — `fireEvent.click`
        // alone does NOT focus, which silently breaks those tests.
        // Calling `.focus()` here restores the v14 contract for our
        // single-consumer test surface.
        if (typeof el.focus === 'function') {
          el.focus()
        }
        fireEvent.click(el)
        // user.click is async in v14+; resolve a microtask so
        // `await user.click(...)` works at call sites.
        return Promise.resolve()
      },
      async keyboard(input: string) {
        // Wrap the raw dispatch in React's `act()` so state updates
        // triggered by Radix Tabs' onKeyDown handler (e.g. moving
        // the active tab + updating `aria-selected`) are flushed
        // before this promise resolves. Without `act()`, React 19's
        // auto-batching leaves the state update pending, and a
        // caller that runs `expect(...).toHaveAttribute('aria-selected', 'true')`
        // immediately after `await user.keyboard(...)` would race
        // the update and fail. `fireEvent.*` (used in v4-v5)
        // wraps in `act()` automatically; switching to raw
        // `el.dispatchEvent` in v6 lost that. The 3 keyboard tests
        // (arrow-down / arrow-up / Home+End) were the canary.
        await act(async () => {
          const target =
            (document.activeElement as Element | null) ?? document.body
          const keys = parseKeyboardString(input)
          for (const { key, code, keyCode } of keys) {
            dispatchKey(target, key, code, keyCode)
          }
        })
      },
    }
  },
}

export default userEvent
