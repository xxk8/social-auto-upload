import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// happy-dom does not provide localStorage by default in the version used.
// Provide a minimal mock so Zustand persist middleware does not crash.
if (typeof globalThis.localStorage === 'undefined') {
  const ls: Record<string, string> = {}
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => ls[key] ?? null,
      setItem: (key: string, val: string) => { ls[key] = val },
      removeItem: (key: string) => { delete ls[key] },
      clear: () => { for (const k in ls) delete ls[k] },
      get length() { return Object.keys(ls).length },
      key: (i: number) => Object.keys(ls)[i] ?? null,
    },
    writable: true,
    configurable: true,
  })
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
