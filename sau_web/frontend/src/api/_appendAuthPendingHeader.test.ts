import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { InternalAxiosRequestConfig, AxiosHeaders } from 'axios'
import {
  appendAuthPendingHeader,
  SAU_AUTH_PENDING_HEADER,
} from './_appendAuthPendingHeader'
import { useAuthStore } from '../features/auth/authStore'

function makeConfig(): InternalAxiosRequestConfig {
  // Use AxiosHeaders constructor — axios v1 typed shape.
  // We construct a config-shaped object with a writable headers
  // instance so .set() updates the header map.
  const headers = new (class {
    private map: Record<string, string> = {}
    set(name: string, value: string): void {
      this.map[name] = value
    }
    get(name: string): string | undefined {
      return this.map[name]
    }
  })() as unknown as AxiosHeaders
  // Mark with the set method; the cast above already provides it.
  return {
    method: 'get',
    url: '/api/foo',
    headers: headers as unknown as InternalAxiosRequestConfig['headers'],
  } as InternalAxiosRequestConfig
}

describe('appendAuthPendingHeader', () => {
  let realGetState: typeof useAuthStore.getState

  beforeEach(() => {
    realGetState = useAuthStore.getState
  })

  afterEach(() => {
    useAuthStore.getState = realGetState
    // Reset store to a clean initial state so a leaked getState
    // override (test threw mid-run) doesn't poison the next test.
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    })
    vi.restoreAllMocks()
  })

  it('sets X-SAU-Auth-Pending when isLoading=true', () => {
    useAuthStore.getState = () =>
      ({ isLoading: true } as unknown as ReturnType<typeof useAuthStore.getState>)

    const config = makeConfig()
    const out = appendAuthPendingHeader(config)
    expect(out.headers.get(SAU_AUTH_PENDING_HEADER)).toBe('1')
  })

  it('does NOT set the header when isLoading=false', () => {
    useAuthStore.getState = () =>
      ({ isLoading: false } as unknown as ReturnType<typeof useAuthStore.getState>)

    const config = makeConfig()
    const out = appendAuthPendingHeader(config)
    expect(out.headers.get(SAU_AUTH_PENDING_HEADER)).toBeUndefined()
  })

  it('is a safe no-op when useAuthStore.getState throws', () => {
    useAuthStore.getState = () => {
      throw new Error('store not initialized')
    }

    const config = makeConfig()
    expect(() => appendAuthPendingHeader(config)).not.toThrow()
    expect(config.headers.get(SAU_AUTH_PENDING_HEADER)).toBeUndefined()
  })

  it('returns the same config object reference (in-place mutation)', () => {
    useAuthStore.getState = () =>
      ({ isLoading: true } as unknown as ReturnType<typeof useAuthStore.getState>)

    const config = makeConfig()
    const out = appendAuthPendingHeader(config)
    // Pointer-identity — callers register the helper as a
    // request interceptor which expects the same object back.
    expect(out).toBe(config)
  })
})
