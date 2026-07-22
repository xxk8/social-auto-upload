// ──────────────────────────────────────────────────────────────────────────
// features/preferences/shared/usePreferencesShortcut.test.tsx
//
// Round-OPT-3G+ v3: vitest for the `Cmd+, / Ctrl+,` PreferencesDialog
// shortcut hook.
//
// Strategy: render a thin harness with `renderHook` + a stable
// vi.fn() callback, then fire synthetic `KeyboardEvent`s against
// `document` (where the hook listens). happy-dom 15.x dispatches
// real listeners, so the assertion path matches production.
//
// data-testid invariants: NO data-testid here — the hook is a
// behavior surface, not a render surface. Assertions live in
// `vi.fn().mock.calls.length` rather than DOM queries.
//
// Why not test the AppShell mount directly: AppShell depends on
// AuthGuard + lazy routes + viewport, which AppShell.test.tsx
// already exhaustively mocks. Adding another mock surface for one
// line of behavior (`openPreferences('overview')`) is over-engineering.
// The hook test + a static lint of the AppShell mount line is
// sufficient coverage. Confidence ceiling: if a future AppShell
// refactor accidentally drops the `usePreferencesShortcut({onTrigger:
// () => openPreferences('overview')})` call, a smoke test in
// AppShell.test.tsx can assert it via a renderHook query if needed.
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePreferencesShortcut } from './usePreferencesShortcut'

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  // happy-dom fires real listeners attached via document.addEventListener.
  // We dispatch on `document.body` AND bubble to document so the
  // bubbling phase captures `target` correctly per the hook's
  // `e.target` typing-suppression check.
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  document.body.dispatchEvent(event)
  return event
}

afterEach(() => {
  // Reset any leftover event listeners from the previous renderHook.
  // The hook's useEffect cleanup function handles this for itself;
  // this guard catches any test that forgets to unmount.
  // No-op currently since renderHook teardown runs synchronously.
})

describe('usePreferencesShortcut · Cmd+, / Ctrl+,', () => {
  it('fires onTrigger on metaKey + "," (macOS)', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    fireKey(',', { metaKey: true })
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('fires onTrigger on ctrlKey + "," (Win/Linux)', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    fireKey(',', { ctrlKey: true })
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire on bare "," without modifier', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    fireKey(',')
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('does NOT fire on shift+meta+"," (rejects combo with shift)', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    fireKey(',', { metaKey: true, shiftKey: true })
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('does NOT fire on alt+meta+"," (rejects combo with alt)', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    fireKey(',', { metaKey: true, altKey: true })
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('does NOT fire when typing in an <input> (suppression rule)', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    // Build a real <input> in document so `e.target` resolves to it
    // (the hook types e.target as HTMLElement | null and reads
    // target.tagName / target.isContentEditable).
    const input = document.createElement('input')
    document.body.appendChild(input)
    try {
      const event = new KeyboardEvent('keydown', {
        key: ',',
        bubbles: true,
        cancelable: true,
        metaKey: true,
      })
      input.dispatchEvent(event)
      expect(onTrigger).not.toHaveBeenCalled()
    } finally {
      document.body.removeChild(input)
    }
  })

  it('does NOT fire when typing in a <textarea> (suppression rule)', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    try {
      const event = new KeyboardEvent('keydown', {
        key: ',',
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      })
      textarea.dispatchEvent(event)
      expect(onTrigger).not.toHaveBeenCalled()
    } finally {
      document.body.removeChild(textarea)
    }
  })

  it('does NOT fire on repeat keydowns (user holding the keys)', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    fireKey(',', { metaKey: true, repeat: true })
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('does NOT fire on a different key (e.g. ".")', () => {
    const onTrigger = vi.fn()
    renderHook(() => usePreferencesShortcut({ onTrigger }))
    fireKey('.', { metaKey: true })
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('does NOT attach listener when enabled=false', () => {
    const onTrigger = vi.fn()
    renderHook(() =>
      usePreferencesShortcut({ onTrigger, enabled: false }),
    )
    fireKey(',', { metaKey: true })
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('removes the document listener on unmount', () => {
    const onTrigger = vi.fn()
    const { unmount } = renderHook(() => usePreferencesShortcut({ onTrigger }))
    fireKey(',', { metaKey: true })
    expect(onTrigger).toHaveBeenCalledTimes(1)
    unmount()
    fireKey(',', { metaKey: true })
    expect(onTrigger).toHaveBeenCalledTimes(1) // unchanged after unmount
  })
})
