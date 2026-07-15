import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLicenseStore } from './useLicenseStore'
import { api } from '@/api/client'

// Mock only the api/client layer — the softError helper is exercised
// end-to-end (mocking it would defeat the test purpose). Vitest hoists
// `vi.mock` above the static import above, so the mock substitutes the
// real `api` at runtime.
vi.mock('@/api/client', () => ({
  api: {
    license: {
      status: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
    },
  },
}))

const apiMock = api as unknown as {
  license: {
    status: ReturnType<typeof vi.fn>
    activate: ReturnType<typeof vi.fn>
    deactivate: ReturnType<typeof vi.fn>
  }
}

function resetStore() {
  useLicenseStore.setState({
    tier: 'legacy',
    key: null,
    activatedAt: null,
    loading: false,
    error: null,
    errorTone: 'default',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

describe('useLicenseStore — errorTone wiring through resolveSoftPrompt', () => {
  it('initial state: tier=legacy, error=null, errorTone=default', () => {
    const s = useLicenseStore.getState()
    expect(s.tier).toBe('legacy')
    expect(s.error).toBeNull()
    expect(s.errorTone).toBe('default')
  })

  it('activate success → updates tier; clears error + tone to default', async () => {
    apiMock.license.activate.mockResolvedValueOnce({
      success: true,
      data: { tier: 'pro', activated_at: '2026-07-11T00:00:00Z' },
    })
    const ok = await useLicenseStore.getState().activate('SAU-PRO-ABCDEFGHIJKL')
    expect(ok).toBe(true)
    const s = useLicenseStore.getState()
    expect(s.tier).toBe('pro')
    expect(s.error).toBeNull()
    expect(s.errorTone).toBe('default')
  })

  it('activate success:false with RE_DUPLICATE-matching message → errorTone info (Tier 1 regex)', async () => {
    // English matches /already/i in RE_DUPLICATE — same regex path as
    // the Chinese "已被其他用户使用" production message, but readable.
    const dupMsg = 'This license key has already been used by another user'
    apiMock.license.activate.mockResolvedValueOnce({
      success: false,
      message: dupMsg,
    })
    const ok = await useLicenseStore.getState().activate('SAU-PRO-ABCDEFGHIJKL')
    expect(ok).toBe(false)
    const s = useLicenseStore.getState()
    expect(s.error).toBe(dupMsg)
    expect(s.errorTone).toBe('info')
  })

  it('activate axios-thrown 409 + duplicate message → errorTone info (Tier 1 verb-driven)', async () => {
    const err: any = new Error('Request failed with status code 409')
    err.response = { status: 409, data: { message: 'duplicate' } }
    apiMock.license.activate.mockRejectedValueOnce(err)
    await useLicenseStore.getState().activate('SAU-PRO-ABCDEFGHIJKL')
    const s = useLicenseStore.getState()
    expect(s.errorTone).toBe('info')
    expect(s.error).toMatch(/duplicate/)
  })

  it('activate axios-thrown network error (no response) → errorTone error', async () => {
    apiMock.license.activate.mockRejectedValueOnce(new Error('Network Error'))
    await useLicenseStore.getState().activate('SAU-PRO-ABCDEFGHIJKL')
    const s = useLicenseStore.getState()
    expect(s.errorTone).toBe('error')
  })

  it('activate success:false validation (422-style, no RE_DUPLICATE match) → errorTone error', async () => {
    apiMock.license.activate.mockResolvedValueOnce({
      success: false,
      message: 'Invalid key format',
    })
    await useLicenseStore.getState().activate('not-a-key')
    const s = useLicenseStore.getState()
    expect(s.errorTone).toBe('error')
  })

  it('clearError() resets both error and errorTone back to default', async () => {
    apiMock.license.activate.mockResolvedValueOnce({
      success: false,
      message: 'This license key has already been used by another user',
    })
    await useLicenseStore.getState().activate('SAU-PRO-ABCDEFGHIJKL')
    expect(useLicenseStore.getState().errorTone).toBe('info')
    useLicenseStore.getState().clearError()
    const s = useLicenseStore.getState()
    expect(s.error).toBeNull()
    expect(s.errorTone).toBe('default')
  })

  it('fetchStatus catch → errorTone error (no verb, no Tier 1 regex match)', async () => {
    apiMock.license.status.mockRejectedValueOnce(new Error('Server unreachable'))
    await useLicenseStore.getState().fetchStatus()
    const s = useLicenseStore.getState()
    expect(s.errorTone).toBe('error')
    expect(s.error).toBe('Server unreachable')
  })

  it('deactivate catch → errorTone error', async () => {
    apiMock.license.deactivate.mockRejectedValueOnce(new Error('Network'))
    await useLicenseStore.getState().deactivate()
    expect(useLicenseStore.getState().errorTone).toBe('error')
  })

  it('activate success-after-failed-retry: errorTone resets to default', async () => {
    // First call fails — start-of-action reset already cleared tone;
    // failure path sets info tone.
    apiMock.license.activate.mockResolvedValueOnce({
      success: false,
      message: 'This license key has already been used by another user',
    })
    await useLicenseStore.getState().activate('SAU-PRO-ABCDEFGHIJKL')
    expect(useLicenseStore.getState().errorTone).toBe('info')
    // Retry starts (loading:true reset → tone='default' again); success
    // path leaves tone untouched, but the start-of-action reset already
    // brought it back to 'default' so the invariant holds.
    apiMock.license.activate.mockResolvedValueOnce({
      success: true,
      data: { tier: 'pro', activated_at: '2026-07-11T00:00:00Z' },
    })
    await useLicenseStore.getState().activate('SAU-PRO-ABCDEFGHIJKL')
    const s = useLicenseStore.getState()
    expect(s.tier).toBe('pro')
    expect(s.error).toBeNull()
    expect(s.errorTone).toBe('default')
  })
})
