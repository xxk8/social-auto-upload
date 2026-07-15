import { describe, expect, it } from 'vitest'
import {
  HALO_ALPHA,
  pctToTone,
  rateToTone,
  toneBgClass,
  toneBorderClass,
  toneChipClasses,
  toneDotClasses,
  toneDotStyle,
  toneFillBgClass,
  toneFgVar,
  toneRingClass,
  toneStyleClasses,
  toneTextClass,
  validityTone,
  type Tone,
} from './tone'

const ALL_TONES: readonly Tone[] = ['success', 'warning', 'error', 'info']

describe('pctToTone — boundary semantics (3-band, no `info`)', () => {
  describe('success branch', () => {
    it('pct === 100 → success', () => {
      expect(pctToTone(100)).toBe('success')
    })

    it.each([101, 120, 1_000_000])('pct = %i ≥ 101 → error (malformed ratio)', (pct) => {
      expect(pctToTone(pct)).toBe('error')
    })
  })

  describe('warning branch (inclusive [50, 99])', () => {
    it.each([50, 51, 75, 99])('pct = %i → warning', (pct) => {
      expect(pctToTone(pct)).toBe('warning')
    })

    it('pct = 49 → error (just-below boundary falls through)', () => {
      expect(pctToTone(49)).toBe('error')
    })
  })

  describe('error branch', () => {
    it.each([0, 1, 25, 48])('pct = %i → error', (pct) => {
      expect(pctToTone(pct)).toBe('error')
    })

    it('negative pct → error', () => {
      expect(pctToTone(-1)).toBe('error')
      expect(pctToTone(-100)).toBe('error')
    })

    it('NaN → error (Number.isFinite guard)', () => {
      expect(pctToTone(Number.NaN)).toBe('error')
    })

    it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      '%s → error (Number.isFinite guard, NOT warning)',
      (val) => {
        expect(pctToTone(val)).toBe('error')
      },
    )
  })

  describe('lock the contract: pctToTone ⊆ {success, warning, error}', () => {
    // Regression guard: a future maintainer who "helpfully" extends pctToTone
    // to return `info` will trip this test. The 4-band contract lives in
    // rateToTone, not pctToTone.
    it.each([
      0, 1, 25, 49, 50, 75, 79, 80, 85, 99, 100, 101, -1, Number.NaN, Number.POSITIVE_INFINITY,
    ])('pctToTone(%s) never returns `info`', (pct) => {
      expect(pctToTone(pct)).not.toBe('info')
    })
  })
})

describe('rateToTone — 4-band validity mapping (homepage tile)', () => {
  describe('null data state', () => {
    it.each([0, 1, 0.5, 0.99])('total === 0, rate ∈ %s → null', (rate) => {
      expect(rateToTone(rate, 0)).toBeNull()
    })
  })

  describe('success branch', () => {
    it.each([1, 1.0])('rate === %s → success', (rate) => {
      expect(rateToTone(rate, 10)).toBe('success')
    })
  })

  describe('info branch (inclusive [0.8 - RATE_EPSILON, 1))', () => {
    // 80% - epsilon but < 100% is the steel-cyan "mostly healthy" signal.
    // `rateToTone(0.799999999) → 'info'` is the user-locked regression
    // case for FP-drift tolerance — see describe below for the named lock.
    // Upper bound `1.0` is EXCLUSIVE: `rate === 1` short-circuits to
    // `'success'` via the `if (rate >= 1) return 'success'` clause in
    // `rateToTone` (before the info-band check).
    it.each([0.79, 0.799, 0.8, 0.85, 0.9, 0.99])(
      'rate ∈ [0.79, 1) = %s → info (includes FP-drift lower bound)',
      (rate) => {
        expect(rateToTone(rate, 10)).toBe('info')
      },
    )
  })

  describe('warning branch (inclusive [0.5 - RATE_EPSILON, 0.8 - RATE_EPSILON))', () => {
    // 50%+ but below 79% is the amber partial signal. Like the info
    // branch above, the lower bound carries RATE_EPSILON tolerance for
    // float drift across accumulated counts/total divisions.
    it.each([0.49, 0.499999999, 0.5, 0.65, 0.789])(
      'rate ∈ [0.49, 0.79) = %s → warning',
      (rate) => {
        expect(rateToTone(rate, 10)).toBe('warning')
      },
    )
  })

  describe('error branch', () => {
    // Strict `< 0.49` after the RATE_EPSILON relaxation: `0.5 - 0.01 = 0.49`
    // now belongs to the warning branch. The `0.48 / 0.4 / 0.25 / 0.1 / 0`
    // cases below `'below [0.49, ...)'` in FP-drift tolerance prove the
    // boundary holds against the same drift.
    it.each([0, 0.1, 0.25])('rate < 0.49 = %s → error', (rate) => {
      expect(rateToTone(rate, 10)).toBe('error')
    })

    // Symmetric with pctToTone: malformed `valid > total` race state should
    // be treated as `error`, NOT optimistic `success`. Either function gives
    // the same answer for the same data — symmetric.
    it.each([1.05, 1.5, 2])('rate > 1 (malformed) → error', (rate) => {
      expect(rateToTone(rate, 10)).toBe('error')
    })

    it('NaN rate → error', () => {
      expect(rateToTone(Number.NaN, 10)).toBe('error')
    })

    it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      '%s → error',
      (val) => {
        expect(rateToTone(val, 10)).toBe('error')
      },
    )
  })

  describe('FP-drift tolerance (RATE_EPSILON buffer)', () => {
    // Pinned regression: a rate that "should be" 0.8 but drifted down
    // by float arithmetic must still classify as 'info', not 'warning'.
    // Without RATE_EPSILON the boundary was `rate >= 0.8` — too tight
    // because IEEE 754 rounding on cumulative `validCount / totalCount`
    // divisions frequently lands at 0.79999999... → fails the strict `>=`.
    // The 0.01 buffer upstream-grade this case so the user-intent
    // ("should round to 0.8") wins over floating-point representation.
    it('rateToTone(0.799999999) → info (FP-drift regression case)', () => {
      expect(rateToTone(0.799999999, 10)).toBe('info')
    })

    it('rateToTone(0.499999999) → warning (symmetric FP-drift case)', () => {
      expect(rateToTone(0.499999999, 10)).toBe('warning')
    })

    // Just BELOW the new lower bound (0.79) — must NOT be `info`.
    it.each([0.75, 0.7, 0.6, 0.5])(
      'rate = %s below [0.49, 0.79) → warning (not info): confirms the boundary holds with FP drift',
      (rate) => {
        expect(rateToTone(rate, 10)).toBe('warning')
      },
    )

    // Just BELOW the lower warning bound (0.49) — must fall through to `error`.
    it.each([0.48, 0.4, 0.25, 0.1, 0])(
      'rate = %s below [0.49, ...) → error',
      (rate) => {
        expect(rateToTone(rate, 10)).toBe('error')
      },
    )
  })
})

describe('toneStyleClasses — static class-string map', () => {
  it('every Tone has all five atomic classes (bg / border / fg / fill / ring)', () => {
    for (const tone of ALL_TONES) {
      const entry = toneStyleClasses[tone]
      expect(entry.bg).toBe(`bg-[var(--status-${tone}-bg)]`)
      expect(entry.border).toBe(`border-[var(--status-${tone}-border)]`)
      expect(entry.fg).toBe(`text-[var(--status-${tone}-fg)]`)
      expect(entry.fill).toBe(`bg-[var(--status-${tone}-fg)]`)
      expect(entry.ring).toBe(`ring-[var(--status-${tone}-fg)]`)
    }
  })

  it('the map is frozen at the type level (no Tone missing or extra)', () => {
    expect(Object.keys(toneStyleClasses).sort()).toEqual([...ALL_TONES].sort())
  })
})

describe('toneChipClasses', () => {
  it.each(ALL_TONES)(
    'Tone = %s → bg+fg Tailwind pair referencing --status-*-{bg,fg}',
    (tone) => {
      const cls = toneChipClasses(tone)
      expect(cls).toContain(`var(--status-${tone}-bg)`)
      expect(cls).toContain(`var(--status-${tone}-fg)`)
      // Not full-string regex: substring shape check is enough.
      expect(cls.startsWith('bg-[var(--status-')).toBe(true)
      expect(cls.endsWith('-fg)]')).toBe(true)
    },
  )

  it('nullish input → neutral muted utility (no token used)', () => {
    expect(toneChipClasses(null)).toBe('bg-muted text-muted-foreground')
    expect(toneChipClasses(undefined)).toBe('bg-muted text-muted-foreground')
  })
})

describe('toneBgClass', () => {
  it.each(ALL_TONES)('Tone = %s → bg-[var(--status-{tone}-bg)]', (tone) => {
    expect(toneBgClass(tone)).toBe(`bg-[var(--status-${tone}-bg)]`)
  })

  it('nullish input → bg-muted', () => {
    expect(toneBgClass(null)).toBe('bg-muted')
    expect(toneBgClass(undefined)).toBe('bg-muted')
  })
})

describe('toneBorderClass', () => {
  it.each(ALL_TONES)('Tone = %s → border-[var(--status-{tone}-border)]', (tone) => {
    expect(toneBorderClass(tone)).toBe(`border-[var(--status-${tone}-border)]`)
  })

  it('nullish input → border-border (hairline fallback so boxes stay separated)', () => {
    expect(toneBorderClass(null)).toBe('border-border')
    expect(toneBorderClass(undefined)).toBe('border-border')
  })
})

describe('toneTextClass', () => {
  it.each(ALL_TONES)('Tone = %s → text-[var(--status-{tone}-fg)]', (tone) => {
    expect(toneTextClass(tone)).toBe(`text-[var(--status-${tone}-fg)]`)
  })

  it('nullish input → text-muted-foreground', () => {
    expect(toneTextClass(null)).toBe('text-muted-foreground')
    expect(toneTextClass(undefined)).toBe('text-muted-foreground')
  })
})

describe('toneFillBgClass', () => {
  it.each(ALL_TONES)('Tone = %s → bg-[var(--status-{tone}-fg)]', (tone) => {
    expect(toneFillBgClass(tone)).toBe(`bg-[var(--status-${tone}-fg)]`)
  })

  it('nullish input → bg-muted', () => {
    expect(toneFillBgClass(null)).toBe('bg-muted')
    expect(toneFillBgClass(undefined)).toBe('bg-muted')
  })
})

describe('toneRingClass', () => {
  it.each(ALL_TONES)('Tone = %s → ring-[var(--status-{tone}-fg)]', (tone) => {
    expect(toneRingClass(tone)).toBe(`ring-[var(--status-${tone}-fg)]`)
  })

  it('nullish input → ring-border (neutral hairline outline)', () => {
    expect(toneRingClass(null)).toBe('ring-border')
    expect(toneRingClass(undefined)).toBe('ring-border')
  })
})

describe('toneDotClasses', () => {
  it.each(['success', 'error', 'info'] as const)(
    'Tone = %s → bg-[var(--status-{tone}-fg)]',
    (tone) => {
      expect(toneDotClasses(tone)).toBe(`bg-[var(--status-${tone}-fg)]`)
    },
  )

  it('Tone = warning → status-running + dual text/bg-warning (pulse ring via currentColor)', () => {
    // status-running utility uses currentColor for ::after pulse ring,
    // so we need text-[var(--status-warning-fg)] for that AND
    // bg-[var(--status-warning-fg)] for the solid dot fill on the chip bg.
    expect(toneDotClasses('warning')).toBe(
      'status-running text-[var(--status-warning-fg)] bg-[var(--status-warning-fg)]',
    )
  })

  it('nullish input → muted-foreground dot', () => {
    expect(toneDotClasses(null)).toBe('bg-muted-foreground/60')
    expect(toneDotClasses(undefined)).toBe('bg-muted-foreground/60')
  })
})

describe('toneDotStyle', () => {
  // Halo alpha reads `HALO_ALPHA` from `lib/tone.ts` and formats it as
  // `<pct>%` for the box-shadow composer; the assertion below derives
  // the expected string the same way — single source of truth, no
  // manual lock-step maintenance. Future collaborators tightening or
  // loosening the glow only need to edit `HALO_ALPHA`; the test name
  // AND assertion auto-rewrite to match, so the test cannot lie about
  // the halo percentage even if the constant drifts.
  it.each(ALL_TONES)(
    `Tone = %s → background=var(--status-{tone}-fg) + ${HALO_ALPHA * 100}% halo box-shadow`,
    (tone) => {
      const style = toneDotStyle(tone)
      expect(style).toEqual({
        background: `var(--status-${tone}-fg)`,
        boxShadow: `0 0 6px color-mix(in oklab, var(--status-${tone}-fg) ${HALO_ALPHA * 100}%, transparent)`,
      })
    },
  )

  it('nullish input → undefined (React `style={undefined}` is valid; no `?? {}` workaround needed)', () => {
    expect(toneDotStyle(null)).toBeUndefined()
    expect(toneDotStyle(undefined)).toBeUndefined()
  })
})

describe('toneFgVar', () => {
  it.each(ALL_TONES)('Tone = %s → var(--status-{tone}-fg)', (tone) => {
    expect(toneFgVar(tone)).toBe(`var(--status-${tone}-fg)`)
  })
})

describe('validityTone — 2-band with null no-data fall-through (account surface)', () => {
  describe('success branch (all valid)', () => {
    it.each([
      [5, 5],
      [1, 1],
      [10, 10],
    ])('validCount = %i, totalCount = %i → success', (valid, total) => {
      expect(validityTone(valid, total)).toBe('success')
    })
  })

  describe('warning branch (partial)', () => {
    it.each([
      [0, 1],
      [1, 2],
      [3, 5],
      [4, 5],
      [9, 10],
    ])('validCount = %i, totalCount = %i → warning', (valid, total) => {
      expect(validityTone(valid, total)).toBe('warning')
    })
  })

  describe('null branch (zero authorizations)', () => {
    // Alignment with `rateToTone`'s `Tone | null` shape: when there are no
    // authorizations there is no validity to report. Returning `null`
    // makes the degenerate case explicit at the type level — helpers like
    // `toneChipClasses(null)` fall back to the muted utility pair, so a
    // caller that drops the JSX-level `{totalCount > 0 && <chip>}` guard
    // gets a neutral muted chip instead of a misleading mint-green chip
    // on empty data. The two existing call sites (`SortableGroup`,
    // `GroupListItem`) already use this guard; the contract is hardened
    // for future callsites.
    it.each([
      // Canonical degenerate input — zero of zero.
      [0, 0],
      // Defensive: any `total === 0` is degenerate, regardless of valid
      // count (which itself is expected to be 0 in well-formed inputs).
      [2, 0],
    ])('validCount = %i, totalCount = %i → null (no authorizations)', (valid, total) => {
      expect(validityTone(valid, total)).toBeNull()
    })
  })

  describe('lock the contract: return shape ⊆ {null, success, warning}', () => {
    // 2-band "tone or no-data" shape is the deliberate design divergence
    // from `rateToTone` (4-band with `info` steel-cyan hint). `validityTone`
    // is the accounts-surface shortcut where every platform is expected
    // to be active — and returning `null` for empty groups keeps the
    // degenerate case out of the Tone union so callers can't accidentally
    // pick it as a "tone". The exhaustive assertion is intentional: a
    // future contributor who helps-by-extending `validityTone` to return
    // `'info'` (the steel-cyan hint from `rateToTone`) would trip this test
    // as a contract violation.
    it.each([
      [0, 0],
      [5, 5],
      [0, 1],
      [3, 5],
      [4, 5],
    ])(
      'validityTone(%i, %i) returns null, "success", or "warning" (never "info" / "error")',
      (valid, total) => {
        const tone = validityTone(valid, total)
        expect(tone === null || tone === 'success' || tone === 'warning').toBe(true)
      },
    )
  })
})
