// ──────────────────────────────────────────────────────────────────────────
// .card-outline SSoT — source-level CSS contract test.
//
// Pins the contract documented in `src/index.css` `/* ===== Card ===== */`:
// the single Tailwind utility that all dashboard outer-card wrappers
// should use INSTEAD of `border border-border/40`. Future PRs that:
//   1. Delete the rule            → red (no declaration in Card block)
//   2. Soften the percent         → red (CARD_OUTLINE_PERCENT mismatch)
//   3. Bump the CARD_OUTLINE_PERCENT constant but forget to update CSS
//                                  → red (CSS still pinned to old %)
//   4. Re-declare the class via @apply / inline style / another block
//                                  → red (class declared > 1×)
//
// This is a source-level pin (regex on the CSS file) rather than a
// computed-style assertion because vitest's jsdom env is configured
// with `css: false` — CSS rules don't load, and `color-mix` / `oklch`
// resolution in jsdom is incomplete. The class is consumed at runtime
// by `border card-outline` Tailwind chains, so the test covers the
// contract that matters: the rule body in `src/index.css` is correct.
//
// Why this test lives in `src/lib/` and not `src/Components/ui/`:
// `vitest.config.ts` restricts `.test.ts` (non-React helper tests) to
// `src/lib/**/*.test.ts` + `src/api/**/*.test.ts` + `src/*.test.ts`.
// Component / hook tests use `.test.tsx` (universal). The restriction
// is intentional — see the vitest.config.ts include-glob comment for
// the full rationale. `.card-outline` is a global CSS utility, so
// `src/lib/` is the closest match.
//
// Pattern parallels `src/Pages/CalendarPage.dark-mode.test.tsx` which
// pins the `.rbc-*` + `--rbc-grid-line` contract the same way.
// ──────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Single source of truth for the density. Bump this constant AND the
// literal in the `.card-outline { ... }` rule in tandem — the test
// below fails on a one-sided edit (either direction). Same one-sided-
// fail pattern as the CalendarPage dark-mode ratchet test: the test
// is the regression guard, not the SSoT, so the contract deliberately
// lives in TWO places (the test constant + the CSS literal) to make
// silent drift impossible.
const CARD_OUTLINE_PERCENT = '25'

// Resolve `src/index.css` from this test file's location.
//   test file:   src/lib/card-outline.test.ts
//   here (dir):  src/lib/
//   target:      src/index.css
const here = dirname(fileURLToPath(import.meta.url))
const indexCssPath = resolve(here, '..', 'index.css')
const indexCss = readFileSync(indexCssPath, 'utf-8')

// Extract the `/* ===== Card ===== */` block so assertions are scoped
// to the Card section rather than the whole stylesheet. The block
// starts at the first `/* ===== Card` marker and ends at the next
// `/* ===== ` section header (or EOF if none follows). If the section
// header is ever reworded, this scan breaks loudly — the test then
// fails on `not.toThrow` because indexOf returns -1.
const cardBlock = (() => {
  const start = indexCss.indexOf('/* ===== Card')
  if (start === -1) {
    throw new Error(
      'card-outline test: `/* ===== Card ===== */` header not found in src/index.css. ' +
        'Either re-add the section header (canonical name) or update the test scanner.',
    )
  }
  const tail = indexCss.slice(start)
  // Look for the next section header AFTER the Card one. The leading
  // `\n` anchors so we don't accidentally match the Card header itself.
  const nextHeader = tail.indexOf('\n/* ===== ', 1)
  return nextHeader === -1 ? tail : tail.slice(0, nextHeader)
})()

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('.card-outline SSoT (src/index.css /* ===== Card ===== */)', () => {
  it('declares .card-outline as a class rule inside the Card block', () => {
    // The selector MUST match `.card-outline {` (with optional
    // whitespace before the brace). Anything else (e.g. `@apply
    // .card-outline;` from a Tailwind block, or a class with a
    // different name) would mean the SSoT is being shadowed or
    // renamed — both trip the gate.
    expect(cardBlock).toMatch(/\.card-outline\s*\{/)
  })

  it('sets border-color via color-mix(in oklab, var(--border) <%>%, transparent)', () => {
    // Anchored on the rule body: selector + `{` + body containing the
    // expected `border-color: ...` line + `}`. The body-anchored regex
    // prevents a false-green where selector A's correct rule is
    // "borrowed" by selector B's regression in a later block.
    const expected = new RegExp(
      '\\.card-outline\\s*\\{[^}]*border-color:\\s*' +
        'color-mix\\(\\s*in oklab,\\s*var\\(--border\\)\\s*' +
        escapeForRegex(CARD_OUTLINE_PERCENT) +
        '%,\\s*transparent\\s*\\)[^}]*\\}',
    )
    expect(cardBlock).toMatch(expected)
  })

  it('declares .card-outline exactly once in the Card block (no @apply shadowing)', () => {
    // If `@apply .card-outline;` or another rule body picks up the
    // class name, the cascade order can shadow this declaration and
    // silently re-introduce the problem the SSoT was meant to fix.
    // A second class declaration is the unambiguous signal that
    // someone is reaching for the SSoT outside of its SSoT spot.
    const matches = cardBlock.match(/\.card-outline\s*\{/g) ?? []
    expect(matches.length).toBe(1)
  })
})
