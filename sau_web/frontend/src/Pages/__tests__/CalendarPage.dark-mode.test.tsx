// ── Source-level CSS spec test for CalendarPage dark-mode ────────────────
//
// `vitest.config.ts` sets `css: false`, so our stylesheet doesn't
// get injected into jsdom by Vite's pipeline — that blocks testing
// of computed styles in jsdom's CSSOM. Instead, read
// `src/index.css` at test time and regex-pin the contract that
// ships the calendar dark-mode "hairline grid lines" fix:
//
//   1. `--rbc-grid-line` token declared inside `.dark .rbc-(calendar
//      |month-view|time-view|agenda-view)` as
//      `color-mix(in oklab, var(--border) 45%, transparent)` — scope
//      locked to dark-mode AND scoped to rbc-* containers so other
//      `.dark` cards/lists aren't affected.
//   2. The dense rbc grid-line selectors (month-view cells + rows
//      + header strip, week-view time slots + day-slot + time gutter
//      + time header, agenda thead / tbody) MUST reference
//      `var(--rbc-grid-line)`. Collapsing any back to `var(--border)`
//      undoes the hairline-density fix.
//   3. The outer calendar shell + toolbar button retain
//      `var(--border)` so the perimeter reads as a contained widget.
//
// Source-level assertions catch the failure modes that matter
// (rule definition disappeared, value shape drift, accidental
// re-collapse) without depending on jsdom's CSS computation,
// which is incomplete for modern features like `color-mix`/`oklch`.
//
// Naming note: file is `.tsx` despite containing no JSX because
// `vitest.config.ts`'s `include` glob only collects `*.test.tsx`
// under `src/` — `.test.ts` is gated to `src/lib/` + `src/api/`.
// A future PR that loosens the include glob to also pick up
// `src/**/*.test.ts` could rename this file to `.ts` for accuracy.

// The 18 percentage is the hairline-density tuning knob. Any
// change must be a deliberate PR — the regex matcher for the
// `declares...` test (below) threads this constant into the
// percentage position of the `color-mix(...)` declaration
// regex, so an accidental tweak (e.g. reverting to 25% or 30%
// to make the grid more visible) trips the declaration regex.
// The per-selector tests below don't carry a percentage — they
// verify rule selection (which selectors reference `--rbc-grid-line`).
// Two checks of different invariants, both needed.

const GRID_LINE_PERCENT = '18'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const indexCss = readFileSync(resolve(__dirname, '../index.css'), 'utf-8')

// `.dark .rbc-(calendar|month-view|time-view|agenda-view)` — the
// selector group that introduces `--rbc-grid-line`. Matched as a
// string fragment so we can anchor the variable declaration against
// the right scope.
const DECL_SCOPE_SRC = /\.dark\s+\.rbc-(?:calendar|month-view|time-view|agenda-view)/

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Assert that the CSS file contains a rule whose body matches
 * `selector` and sets `border-color: <expected>`. Anchored on
 * the rule body (`{...}`) via `[^}]*` so the match cannot leak
 * across rule boundaries — a regression on selector A (e.g.
 * border-color flipped back to `var(--border)`) must FAIL here
 * even if a downstream selector B still has `border-color:
 * var(--rbc-grid-line)`. The non-greedy cross-file scan would
 * silently mask that regression, so we explicitly confine to
 * one rule body.
 *
 * Handles combined rules like `.dark .rbc-month-row,
 * .dark .rbc-day-bg` via the trailing `(?:\\s*,\\s*[^,{}]+)*`
 * group — those two selectors share one body, so a single match
 * covers both sides of the comma list.
 */
function expectSelectorHasBorderColor(selector: string, expected: string): void {
  const re = new RegExp(
    escapeForRegex(selector) +
      '(?:\\s*,\\s*[^,{}]+)*' +
      '\\s*\\{[^}]*border-color:\\s*' +
      escapeForRegex(expected) +
      '[^}]*\\}',
  )
  expect(
    re.test(indexCss),
    `${selector} should set border-color: ${expected} — see doc in src/index.css`,
  ).toBe(true)
}

describe('CalendarPage — rbc dark-mode CSS spec', () => {
  it('declares --rbc-grid-line scoped to .dark .rbc-* as color-mix(--border 45%)', () => {
    // Single-knob contract: scope + value. Drift in either piece
    // regresses the calendar's dark-mode density visually.
    const re = new RegExp(
      DECL_SCOPE_SRC.source +
        '[\\s\\S]*?--rbc-grid-line:\\s*color-mix\\(\\s*in oklab\\s*,\\s*var\\(--border\\)\\s+' +
        GRID_LINE_PERCENT +
        '%\\s*,\\s*transparent\\s*\\)',
    )
    expect(
      re.test(indexCss),
      '--rbc-grid-line declaration is missing or has shape drift (scope, percentage, or color-mix args)',
    ).toBe(true)
  })

  it('dense rbc grid-line selectors reference var(--rbc-grid-line)', () => {
    // Every rbc-* selector whose border-color was softened in this
    // round. Each MUST point to the scoped token — collapsing any
    // back to `var(--border)` undoes the hairline-density fix.
    // Split into month-view / week-view / agenda-view buckets so a
    // future contributor adding a new selector musn't skip the
    // relevant bucket.
    const softenedSelectors: ReadonlyArray<string> = [
      // Month view
      '.dark .rbc-header',
      '.dark .rbc-month-row',
      '.dark .rbc-day-bg',
      // Week view
      '.dark .rbc-time-header',
      '.dark .rbc-time-header-content',
      '.dark .rbc-time-content',
      '.dark .rbc-time-gutter',
      '.dark .rbc-time-slot',
      '.dark .rbc-timeslot-group',
      '.dark .rbc-day-slot',
      // Agenda view
      '.dark .rbc-agenda-view table.rbc-agenda-table tbody > tr > td',
      '.dark .rbc-agenda-view table.rbc-agenda-table thead > tr > th',
    ]
    for (const sel of softenedSelectors) {
      expectSelectorHasBorderColor(sel, 'var(--rbc-grid-line)')
    }
  })

  it('outer calendar shell + toolbar button borders keep full var(--border)', () => {
    // Outer perimeter reads as a contained widget. If anyone
    // accidentally applies `var(--rbc-grid-line)` to these
    // selectors, the calendar loses its container shape (45% alpha
    // isn't strong enough to outline a 720px-tall widget).
    const perimeterSelectors: ReadonlyArray<string> = [
      '.dark .rbc-toolbar button',
      '.dark .rbc-agenda-view table.rbc-agenda-table',
    ]
    for (const sel of perimeterSelectors) {
      expectSelectorHasBorderColor(sel, 'var(--border)')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Round 4 (OPT-cal-table-beautify, 2026-07-10) — Calendar table polish
// invariants. The 3 tests above are the round-3 hairline-density
// contract (--rbc-grid-line 18% mix); these 5 tests pin the round-4
// polish contract (header roster, today callout, weekend tint, off-
// range dim, selected-cell ring). The two describe blocks together
// cover the rbc dark-mode visual contract end-to-end — see the
// "Calendar polish — round 4" comment block in `src/index.css` for
// the why behind each selector.
// ─────────────────────────────────────────────────────────────────────────

describe('CalendarPage — rbc dark-mode table polish (round 4 / OPT-cal-table-beautify)', () => {
  // Generic "selector sets property: value" helper (round-4 contract
  // spans typography / box-shadow / opacity / color-mix — too varied
  // for a single specialised helper like expectSelectorHasBorderColor
  // to carry without growing to a kitchen-sink utility).
  function propHas(selector: string, prop: string, value: string): boolean {
    const re = new RegExp(
      escapeForRegex(selector) +
        '(?:\\s*,\\s*[^,{}]+)*' +
        '\\s*\\{[^}]*' +
        prop + // prop name is identifier-only (no regex-meta chars); literal insert is safe
        ':\\s*' +
        escapeForRegex(value) +
        '[^}]*\\}',
    )
    return re.test(indexCss)
  }

  it('today cell carries a 2px primary top-accent strip', () => {
    // Pin: .dark .rbc-month-view .rbc-today has
    //   box-shadow: inset 0 2px 0 0 var(--primary)
    // Strip sits one pixel INSIDE the cell border (inset, not outset)
    // so it reads as a contained marker rather than overlapping the
    // neighbouring 18% gridlines.
    const re = new RegExp(
      escapeForRegex('.dark .rbc-month-view .rbc-today') +
        '(?:\\s*,\\s*[^,{}]+)*' +
        '\\s*\\{[^}]*box-shadow:\\s*inset 0 2px 0 0 ' +
        escapeForRegex('var(--primary)') +
        '[^}]*\\}',
    )
    expect(
      re.test(indexCss),
      '.dark .rbc-month-view .rbc-today must carry `box-shadow: inset 0 2px 0 0 var(--primary)` (2px top accent strip)',
    ).toBe(true)
  })

  it('today date-number is mono bold + has 今日 · eyebrow prefix', () => {
    // Two conjunctive asserts:
    //   (a) .dark .rbc-current .rbc-button-link sets
    //       font-family: var(--font-jetbrains-mono) + font-weight: 600
    //   (b) .dark .rbc-current .rbc-button-link::before sets
    //       content: '今日 · '
    // Both must hold — losing (a) makes the today number read like
    // any other date; losing (b) loses the operator-facing Chinese
    // hint that distinguishes this specific cell.
    const linkRe = new RegExp(
      escapeForRegex('.dark .rbc-current .rbc-button-link') +
        '(?:\\s*,\\s*[^,{}]+)*' +
        '\\s*\\{[^}]*font-family:\\s*' +
        escapeForRegex('var(--font-jetbrains-mono)') +
        '[^}]*font-weight:\\s*600[^}]*\\}',
    )
    const eyebrowRe = new RegExp(
      escapeForRegex('.dark .rbc-current .rbc-button-link::before') +
        '(?:\\s*,\\s*[^,{}]+)*' +
        '\\s*\\{[^}]*content:\\s*' +
        escapeForRegex("'今日 · '") +
        '[^}]*\\}',
    )
    expect(
      linkRe.test(indexCss) && eyebrowRe.test(indexCss),
      [
        '.dark .rbc-current .rbc-button-link must set',
        ' font-family: var(--font-jetbrains-mono) AND font-weight: 600',
        '(today number row), AND',
        ".dark .rbc-current .rbc-button-link::before must set content: '今日 · '",
        '(today eyebrow prefix).',
      ].join('\n'),
    ).toBe(true)
  })

  it('weekday header is uppercase mono tracked (roster typography)', () => {
    // Three properties must co-exist on .dark .rbc-header:
    //   text-transform: uppercase
    //   font-family: var(--font-jetbrains-mono)
    //   letter-spacing: 0.08em
    // Picking up only 1 or 2 of 3 reads as "polish attempt" rather
    // than a coherent engineering-tool roster treatment.
    const allThree =
      propHas('.dark .rbc-header', 'text-transform', 'uppercase') &&
      propHas('.dark .rbc-header', 'font-family', 'var(--font-jetbrains-mono)') &&
      propHas('.dark .rbc-header', 'letter-spacing', '0.08em')
    expect(
      allThree,
      '.dark .rbc-header must set ALL THREE: text-transform: uppercase + font-family: var(--font-jetbrains-mono) + letter-spacing: 0.08em',
    ).toBe(true)
  })

  it('weekend cells carry a muted/card 50/50 soft tint', () => {
    // Pin: .dark .rbc-month-view .rbc-weekend-bg has
    //   background-color: color-mix(in oklab, var(--muted) 50%, var(--card))
    // The `:nth-child(6|7)` belt-and-suspenders selectors share this
    // body via the comma-list contract — a single match on
    // `.rbc-weekend-bg` covers both sides of the comma list.
    const re = new RegExp(
      escapeForRegex('.dark .rbc-month-view .rbc-weekend-bg') +
        '(?:\\s*,\\s*[^,{}]+)*' +
        '\\s*\\{[^}]*background-color:\\s*' +
        escapeForRegex('color-mix(in oklab, var(--muted) 50%, var(--card))') +
        '[^}]*\\}',
    )
    expect(
      re.test(indexCss),
      '.dark .rbc-month-view .rbc-weekend-bg must set background-color: color-mix(in oklab, var(--muted) 50%, var(--card))',
    ).toBe(true)
  })

  it('off-range dim drops 0.45 → 0.30 (round-4 contract)', () => {
    // Pin: .dark .rbc-off-range has opacity: 0.30
    // (round-3 left this at 0.45; round-4 tightens it so neighbour-
    // month spillover dates read clearly as "not this month" against
    // current-month dates at 1.0.)
    const re = new RegExp(
      escapeForRegex('.dark .rbc-off-range') +
        '(?:\\s*,\\s*[^,{}]+)*' +
        '\\s*\\{[^}]*opacity:\\s*0\\.30[^}]*\\}',
    )
    expect(
      re.test(indexCss),
      '.dark .rbc-off-range must set opacity: 0.30 (round-4 dim; was 0.45 in round-3)',
    ).toBe(true)
  })

  it('selected cell carries a 1px primary inset ring', () => {
    // Pin: .dark .rbc-month-view .rbc-selected-cell has
    //   box-shadow: inset 0 0 0 1px ... var(--primary)
    // Phase-2 quick-create prerequisite — without the ring click
    // feedback is inconsistent vs. toolbar buttons that keep full
    // var(--border). Sits inside the cell so it doesn't overlap
    // the 18% hairline grid.
    const re = new RegExp(
      escapeForRegex('.dark .rbc-month-view .rbc-selected-cell') +
        '(?:\\s*,\\s*[^,{}]+)*' +
        '\\s*\\{[^}]*box-shadow:\\s*inset 0 0 0 1px color-mix\\(' +
        '[^}]*' +
        escapeForRegex('var(--primary)') +
        '[^}]*\\}',
    )
    expect(
      re.test(indexCss),
      '.dark .rbc-month-view .rbc-selected-cell must carry `box-shadow: inset 0 0 0 1px color-mix(... var(--primary) ...)`',
    ).toBe(true)
  })
})
