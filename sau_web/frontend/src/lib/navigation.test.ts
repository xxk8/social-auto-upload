import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerNavigate, navigateInApp } from '@/lib/navigation'

const mockNavigate = vi.fn()

beforeEach(() => {
  mockNavigate.mockClear()
  // Reset by re-registering a no-op fn and immediately
  // deregistering it. The module-level `_navigate` cannot be
  // imported null'd, so each test starts from a clean
  // baseline via the symmetric register/cleanup contract.
  const deregister = registerNavigate(vi.fn())
  deregister()
})

describe('navigation registry', () => {
  it('calls the registered function with path and opts', () => {
    const deregister = registerNavigate(mockNavigate)
    try {
      navigateInApp('/dashboard/publish', { replace: true })
      expect(mockNavigate).toHaveBeenCalledTimes(1)
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard/publish', {
        replace: true,
      })
    } finally {
      deregister()
    }
  })

  it('falls back to window.location.href when registry is empty', () => {
    // jsdom's `window.location` is a non-configurable accessor on
    // the Window instance — `vi.spyOn(window.location, 'href',
    // 'set')` throws `TypeError: Cannot redefine property: href`.
    // The only working approach is to replace the entire
    // `location` property via `Object.defineProperty` AND restore
    // the original in `finally` (the v1 of this test forgot to
    // restore, leaking the mock across tests in jsdom).
    const originalLocation = window.location
    const hrefSetter = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        set href(v: string) {
          hrefSetter(v)
        },
      },
    })
    try {
      navigateInApp('/login')
      expect(hrefSetter).toHaveBeenCalledWith('/login')
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  it('is a no-op when both registry and window are unavailable', () => {
    vi.stubGlobal('window', undefined)
    try {
      expect(() => navigateInApp('/login')).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('replacing registration replaces the previous instance', () => {
    const firstMock = vi.fn()
    const secondMock = vi.fn()
    const deregisterFirst = registerNavigate(firstMock)
    const deregisterSecond = registerNavigate(secondMock)
    try {
      navigateInApp('/foo')
      expect(firstMock).not.toHaveBeenCalled()
      expect(secondMock).toHaveBeenCalledWith('/foo', {})
    } finally {
      deregisterSecond()
      // First is no longer the active one (second replaced it),
      // so deregisterFirst is a no-op (it only nulls if the
      // current fn === firstMock).
      deregisterFirst()
    }
  })

  it('unregister only nulls when the SAME fn is registered', () => {
    const deregister = registerNavigate(vi.fn())
    // Replace with a different fn; deregister (for the
    // ORIGINAL fn) must be a no-op.
    const otherRegistrar = registerNavigate(mockNavigate)
    deregister()
    // The other registrar is still active.
    navigateInApp('/keep-me')
    expect(mockNavigate).toHaveBeenCalledWith('/keep-me', {})
    otherRegistrar()
  })
})
