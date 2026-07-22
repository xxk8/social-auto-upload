import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PRESETS } from './schedulePresets'
import { SchedulePicker } from './SchedulePicker'

/**
 * Regression suite — locks in the "下周一 18:00" preset's Monday-edge
 * math. The function used to skip to *next* Monday even when today IS
 * Monday pre-18:00; that bug is captured here.
 *
 * Calendar anchors (2026, all day-of-week verified inside each test via
 * `expect(new Date().getDay()).toBe(N)` so a date drift self-fails):
 *   Sunday    July  5 2026
 *   Monday    June 29 2026  (target of Sun advance; also pre/post 18:00 split)
 *   Monday    July  6 2026  (target of Mon-post-18:00 + Tue/Wed/Thu/Fri/Sat advance)
 *   Tuesday   June 30 2026  (6-day advance to Mon Jul 6)
 */

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const preset = PRESETS[2]
if (preset.label !== '下周一 18:00') {
  throw new Error(
    `PRESETS[2] regressed into a different preset: ${preset.label}; aborting regression suite.`,
  )
}

describe('SchedulePicker · PRESETS[2].compute (下周一 18:00)', () => {
  it('Sunday 10:00 → next Monday at 18:00 (1 day ahead)', () => {
    // Jul 5 2026 is a Sunday.
    vi.setSystemTime(new Date(2026, 6, 5, 10, 0, 0))
    expect(new Date().getDay()).toBe(0) // self-check: Sunday

    const result = preset.compute()

    expect(result.getDay()).toBe(1) // Monday
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(6) // July (zero-indexed)
    expect(result.getDate()).toBe(6) // Jul 6
    expect(result.getHours()).toBe(18)
    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
    expect(result.getMilliseconds()).toBe(0)
  })

  it('Monday 09:00 (pre-18:00) → today (same Monday) at 18:00, no advance', () => {
    // Jun 29 2026 is a Monday.
    vi.setSystemTime(new Date(2026, 5, 29, 9, 0, 0))
    expect(new Date().getDay()).toBe(1) // self-check: Monday

    const result = preset.compute()

    expect(result.getDay()).toBe(1) // still Monday
    expect(result.getMonth()).toBe(5) // June (zero-indexed)
    expect(result.getDate()).toBe(29) // today
    expect(result.getHours()).toBe(18)
    expect(result.getMinutes()).toBe(0)
  })

  it('Monday 19:00 (post-18:00) → NEXT Monday at 18:00, 7-day advance', () => {
    vi.setSystemTime(new Date(2026, 5, 29, 19, 0, 0))
    expect(new Date().getDay()).toBe(1) // self-check: Monday

    const result = preset.compute()

    expect(result.getDay()).toBe(1) // next Monday is also a Monday
    expect(result.getMonth()).toBe(6) // July (zero-indexed)
    expect(result.getDate()).toBe(6) // Jul 6
    expect(result.getHours()).toBe(18)
    expect(result.getMinutes()).toBe(0)
  })

  it('Tuesday 10:00 → next Monday at 18:00 (6-day advance)', () => {
    // Jun 30 2026 is a Tuesday.
    vi.setSystemTime(new Date(2026, 5, 30, 10, 0, 0))
    expect(new Date().getDay()).toBe(2) // self-check: Tuesday

    const result = preset.compute()

    expect(result.getDay()).toBe(1) // Monday
    expect(result.getDate()).toBe(6) // Jul 6
    expect(result.getHours()).toBe(18)
  })

  it('Wednesday / Thursday / Friday / Saturday → next Monday at 18:00', () => {
    // Jul 1 Wed · Jul 2 Thu · Jul 3 Fri · Jul 4 Sat (all 2026)
    const cases: Array<{ month: number; day: number; dow: number }> = [
      { month: 6, day: 1, dow: 3 }, // Wed
      { month: 6, day: 2, dow: 4 }, // Thu
      { month: 6, day: 3, dow: 5 }, // Fri
      { month: 6, day: 4, dow: 6 }, // Sat
    ]
    for (const { month, day, dow } of cases) {
      vi.setSystemTime(new Date(2026, month, day, 10, 0, 0))
      expect(new Date().getDay()).toBe(dow) // self-check calendar

      const result = preset.compute()
      expect(result.getDay()).toBe(1) // Monday
      expect(result.getDate()).toBe(6) // Jul 6
      expect(result.getHours()).toBe(18)
      expect(result.getMinutes()).toBe(0)
    }
  })

  it('Monday 17:59 (1-minute before threshold) → today at 18:00', () => {
    vi.setSystemTime(new Date(2026, 5, 29, 17, 59, 0))
    expect(new Date().getDay()).toBe(1)

    const result = preset.compute()
    expect(result.getDate()).toBe(29)
    expect(result.getHours()).toBe(18)
  })

  it('Monday 18:00 (exactly the threshold) → NEXT Monday at 18:00', () => {
    // The boundary is `getHours() < 18`; at exactly 18:00 we treat the
    // same-day slot as already passed. Locks in the inclusive boundary.
    vi.setSystemTime(new Date(2026, 5, 29, 18, 0, 0))
    expect(new Date().getDay()).toBe(1)

    const result = preset.compute()
    expect(result.getDate()).toBe(6) // Jul 6, not 29
    expect(result.getHours()).toBe(18)
  })
})

/**
 * LOW-pass regression — locks each preset chip at `h-8` (32px), which
 * is the WCAG 2.5.5 / 2.5.8 (AAA) minimum tap-target. A regression
 * that drops the chip back to `h-7` (28px) silently degrades the
 * tap affordance for engagement-loop presets; pin the contract here
 * so the future preset-rows UI surfaces the regression at lint time.
 */
describe('SchedulePicker · preset chip tap-target (LOW-pass regression)', () => {
  it('every preset chip renders with h-8 (32px min tap-target)', () => {
    render(<SchedulePicker value="" onChange={vi.fn()} />)
    for (const preset of PRESETS) {
      const btn = screen.getByRole('button', { name: preset.label })
      expect(btn.className).toMatch(/\bh-8\b/)
    }
  })
})
