import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
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
