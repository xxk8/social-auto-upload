import { describe, it, expect } from 'vitest'
import { humanizeTaskError } from './taskError'

describe('humanizeTaskError', () => {
  it('classifies cookie expiry with relogin CTA', () => {
    const r = humanizeTaskError('cookie_invalid: session expired')
    expect(r.kind).toBe('cookie')
    expect(r.needsRelogin).toBe(true)
    expect(r.action?.href).toBe('/dashboard/accounts')
    expect(r.title).toContain('登录')
  })

  it('classifies Chinese cookie wording', () => {
    const r = humanizeTaskError('登录态失效，请重新登录')
    expect(r.kind).toBe('cookie')
    expect(r.needsRelogin).toBe(true)
  })

  it('classifies rate limit / 风控', () => {
    const r = humanizeTaskError('触发风控，请稍后再试 rate limit 429')
    expect(r.kind).toBe('rate_limit')
  })

  it('classifies network errors', () => {
    const r = humanizeTaskError('ECONNRESET network unreachable')
    expect(r.kind).toBe('network')
  })

  it('classifies missing file', () => {
    const r = humanizeTaskError('File not found: /tmp/video.mp4')
    expect(r.kind).toBe('file')
    expect(r.action?.href).toBe('/dashboard/publish')
  })

  it('empty error + cookie_invalid status → cookie', () => {
    const r = humanizeTaskError(null, { status: 'cookie_invalid' })
    expect(r.kind).toBe('cookie')
    expect(r.needsRelogin).toBe(true)
  })

  it('empty error without status → unknown with retry', () => {
    const r = humanizeTaskError('')
    expect(r.kind).toBe('unknown')
    expect(r.action?.label).toMatch(/重试/)
  })

  it('unmatched message keeps short title', () => {
    const r = humanizeTaskError('weird proprietary failure XYZ-99')
    expect(r.kind).toBe('unknown')
    expect(r.title).toContain('weird proprietary')
  })
})
