// ──────────────────────────────────────────────────────────────────────────
// lib/no-opensource-references.test.ts
//
// Guard test: scans all user-facing .tsx files for forbidden open-source
// references that would reveal the product's open-source origin.
//
// Forbidden patterns (case-insensitive):
//   • github.com/dreammis       — original upstream repo URL
//   • github.com/dyhBUPT        — original upstream repo URL (alt)
//   • dreammis/social-auto-upload — repo slug in text
//   • 开源                       — "open source" in Chinese
//   • MIT 协议                   — "MIT license" in Chinese
//   • MIT License                — "MIT license" in English
//   • Star History               — star-history.com chart reference
//
// SCOPE: Only user-facing .tsx files are scanned (pages, components,
// features). Test files (*.test.tsx) and type files (*.ts) are excluded
// so test assertions and type definitions aren't flagged.
//
// ALLOWLIST: LoginAuthPage.tsx is exempt because "GitHub 登录" is a
// legitimate OAuth login feature label, not open-source attribution.
// Note: this test scans the ENTIRE raw file content (including code
// comments), so a comment like `// 开源 project` inside a .tsx file
// would trigger a false positive. If a legitimate code comment needs
// to use one of the forbidden patterns, add the file to ALLOWLIST.
//
// If a genuine need arises to reference GitHub in a user-facing file
// (e.g. a new OAuth provider), add the filename to ALLOWLIST below with
// a justification comment.
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

// Vite's import.meta.glob with { as: 'raw' } reads file contents at build
// time. The eager: true option makes the imports available synchronously.
// We glob all .tsx files under src/ EXCEPT *.test.tsx files.
const modules = import.meta.glob('/src/**/*.tsx', {
  as: 'raw',
  eager: true,
}) as Record<string, string>

// Files that are allowed to contain GitHub references (OAuth login labels,
// not open-source attribution). Add here ONLY with a clear justification.
const ALLOWLIST: ReadonlySet<string> = new Set([
  // LoginAuthPage renders "GitHub 登录" as an OAuth provider button label.
  // This is a login feature, not open-source attribution.
  '/src/Pages/LoginAuthPage.tsx',
])

// Forbidden patterns — if any of these appear in a user-facing .tsx file,
// the test fails. Patterns are matched as substring (case-insensitive).
const FORBIDDEN_PATTERNS: ReadonlyArray<{
  pattern: string
  reason: string
}> = [
  { pattern: 'github.com/dreammis', reason: 'links to original upstream repo' },
  { pattern: 'github.com/dyhBUPT', reason: 'links to original upstream repo (alt)' },
  { pattern: 'dreammis/social-auto-upload', reason: 'upstream repo slug in text' },
  { pattern: '开源', reason: '"open source" — reveals open-source origin' },
  { pattern: 'MIT 协议', reason: 'MIT license text in Chinese' },
  { pattern: 'MIT License', reason: 'MIT license text in English' },
  { pattern: 'Star History', reason: 'star-history.com chart reference' },
  { pattern: 'contrib.rocks', reason: 'contributor image from contrib.rocks' },
]

describe('no-opensource-references guard', () => {
  // Collect all .tsx files that are NOT test files
  const userFacingFiles = Object.entries(modules).filter(
    ([path]) => !path.endsWith('.test.tsx'),
  )

  it('scans at least 50 user-facing .tsx files (sanity check)', () => {
    // If this number drops dramatically, the glob pattern may be broken.
    expect(userFacingFiles.length).toBeGreaterThan(50)
  })

  for (const [filePath, content] of userFacingFiles) {
    const isAllowed = ALLOWLIST.has(filePath)

    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      it(`${filePath} does not contain "${pattern}" (${reason})`, () => {
        if (isAllowed) {
          // Allowlisted files are exempt — skip the assertion
          return
        }
        expect(
          content.toLowerCase(),
          `\n❌ Forbidden pattern "${pattern}" found in ${filePath}\n   Reason: ${reason}\n   If this is a legitimate reference (e.g. OAuth), add the file to ALLOWLIST in no-opensource-references.test.ts\n`,
        ).not.toContain(pattern.toLowerCase())
      })
    }
  }
})
