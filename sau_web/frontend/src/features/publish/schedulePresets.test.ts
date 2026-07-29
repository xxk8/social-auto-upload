import { describe, expect, it } from 'vitest'
import { parseScheduleParam, toLocalDatetimeString } from './schedulePresets'

describe('parseScheduleParam', () => {
  it('maps date-only to 09:00 local', () => {
    expect(parseScheduleParam('2026-07-25')).toBe('2026-07-25T09:00')
  })

  it('keeps datetime-local without seconds', () => {
    expect(parseScheduleParam('2026-07-25T14:30')).toBe('2026-07-25T14:30')
  })

  it('strips seconds from local wall time', () => {
    expect(parseScheduleParam('2026-07-25T14:30:00')).toBe('2026-07-25T14:30')
    expect(parseScheduleParam('2026-07-25 08:15:00')).toBe('2026-07-25T08:15')
  })

  it('returns null for empty / garbage', () => {
    expect(parseScheduleParam('')).toBeNull()
    expect(parseScheduleParam(null)).toBeNull()
    expect(parseScheduleParam('not-a-date')).toBeNull()
  })

  it('round-trips Date via toLocalDatetimeString', () => {
    const d = new Date(2026, 6, 25, 9, 0, 0)
    expect(toLocalDatetimeString(d)).toBe('2026-07-25T09:00')
  })
})
