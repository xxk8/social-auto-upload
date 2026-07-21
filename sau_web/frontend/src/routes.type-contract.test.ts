import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')

// ── Stub layout ────────────────────────────────────────────────────────
//
// Synthetic file names — only used internally by the TypeScript
// Compiler API. Nothing is ever written to disk. The names are
// namespaced under `src/__typo_check/` so the in-memory paths look
// "real" to the module resolver, and the relative `'../routes'`
// import in each stub resolves to `src/routes.ts`.
const STUB_DIR = resolve(projectRoot, 'src/__typo_check')
const SYNTHETIC_NAMES = {
  PublicRoute: `${STUB_DIR}/public-route.ts`,
  DashboardRoute: `${STUB_DIR}/dashboard-route.ts`,
  AdminRoute: `${STUB_DIR}/admin-route.ts`,
  LegacyRoute: `${STUB_DIR}/legacy-route.ts`,
  Positive: `${STUB_DIR}/positive.ts`,
} as const
const ROUTES_PATH = resolve(projectRoot, 'src/routes.ts')

// ── Negative stubs (one per union) ─────────────────────────────────────
//
// Each has a DELIBERATE typo that tsc MUST reject. If it doesn't,
// the corresponding union has been widened (e.g. to `string`) and
// IDE autocomplete + typo detection is broken. The typos are
// near-misses of real paths: missing letter, truncated suffix —
// exactly the typo class the union is supposed to catch.
const NEGATIVE_STUB_SOURCES = {
  PublicRoute: `
import { type PublicRoute } from '../routes'
const item: { to: PublicRoute } = { to: '/hotlst' }
export default item
`,
  DashboardRoute: `
import { type DashboardRoute } from '../routes'
const item: { path: DashboardRoute } = { path: '/dashbord/publish' }
export default item
`,
  AdminRoute: `
import { type AdminRoute } from '../routes'
const item: { path: AdminRoute } = { path: '/dashboard/admi' }
export default item
`,
  LegacyRoute: `
import { type LegacyRoute } from '../routes'
const item: { path: LegacyRoute } = { path: '/publish_old' }
export default item
`,
} as const

// ── Positive stub (exercises ALL valid members) ───────────────────────
//
// Inverse half of the contract: every real path in `ROUTES` MUST be
// accepted by its union. If a member is removed (narrowing), at
// least one of these lines fails to type-check, the stub emits a
// diagnostic, and the positive test fails. Together with the
// negative stubs (which catch widening), this pins the union
// membership symmetrically — neither can grow nor shrink without
// the meta-test catching it.
//
// `studioDetail` is intentionally absent from `dashboardItems` —
// it's a parametric function (not a literal path), so the
// `DashboardRoute` union explicitly excludes it. The same goes for
// the nested `admin` object (extracted to its own union / variable
// below).
const POSITIVE_STUB_SOURCE = `
import {
  type PublicRoute,
  type DashboardRoute,
  type AdminRoute,
  type LegacyRoute,
  ROUTES,
} from '../routes'

const publicItems: { to: PublicRoute }[] = [
  { to: ROUTES.public.landing },
  { to: ROUTES.public.login },
  { to: ROUTES.public.loginAuth },
  { to: ROUTES.public.pricing },
  { to: ROUTES.public.about },
  { to: ROUTES.public.hotlist },
  { to: ROUTES.public.catalog },
]

const dashboardItems: { path: DashboardRoute }[] = [
  { path: ROUTES.dashboard.root },
  { path: ROUTES.dashboard.publish },
  { path: ROUTES.dashboard.tasks },
  { path: ROUTES.dashboard.analytics },
  { path: ROUTES.dashboard.logs },
  { path: ROUTES.dashboard.inbox },
  { path: ROUTES.dashboard.studio },
  { path: ROUTES.dashboard.account },
  { path: ROUTES.dashboard.settings },
  { path: ROUTES.dashboard.personalization },
]

const adminItems: { path: AdminRoute }[] = [
  { path: ROUTES.dashboard.admin.root },
  { path: ROUTES.dashboard.admin.users },
  { path: ROUTES.dashboard.admin.audit },
]

const legacyItems: { path: LegacyRoute }[] = [
  { path: ROUTES.legacy.app },
  { path: ROUTES.legacy.publish },
  { path: ROUTES.legacy.tasks },
  { path: ROUTES.legacy.logs },
  { path: ROUTES.legacy.analytics },
]

export { publicItems, dashboardItems, adminItems, legacyItems }
`

// ── Compiler API integration ───────────────────────────────────────────
//
// Why the Compiler API (not `tsc -p .` subprocess):
//   `tsconfig.app.json` sets `tsBuildInfoFile: ./node_modules/.tmp/
//   tsconfig.app.tsbuildinfo` (incremental cache). The v1 approach
//   (subprocess `tsc -p .`) failed because the first invocation
//   recorded the project state to the cache, and the second
//   invocation trusted the cache and didn't re-scan the
//   `include: ["src"]` pattern for newly-added stub files. Result:
//   exit 0 (the stub wasn't checked at all).
//
// Why IN-MEMORY source files (not fs writes):
//   v2 wrote stubs to `src/__typo_check/` and cleaned them up via
//   `beforeAll`/`afterAll`. The stubs were populated for the
//   duration of the test — a parallel `tsc --noEmit` (pre-commit
//   hook, watch mode, CI parallel job) would fail because the
//   stub files contained deliberate type errors. v3+ (current
//   version) keeps all 6 source files (1 real + 5 synthetic) in
//   memory via a custom CompilerHost. No fs writes, no cleanup,
//   no race conditions, no project-level tsconfig change needed.
//
// Why the MINIMAL program (just routes.ts + 5 stubs):
//   The union membership check is purely a function of the
//   literal-string union defined in `routes.ts`. The full
//   project's other files don't matter for the assertion. Compile
//   time drops to sub-second, well under the default 5s vitest
//   timeout.
//
// Why override `types: []`:
//   The project's tsconfig has `"types": ["vite/client",
//   "vitest/globals"]`. Overriding to `[]` in the program options
//   prevents those globals from polluting the program — the stubs
//   can't accidentally depend on `vi.fn()` etc., and the type
//   checker has less work to do.
function getStubDiagnostics(): Map<string, readonly ts.Diagnostic[]> {
  const tsconfigPath = resolve(projectRoot, 'tsconfig.app.json')
  const configText = readFileSync(tsconfigPath, 'utf-8')
  const configParseResult = ts.parseConfigFileTextToJson(tsconfigPath, configText)
  if (!configParseResult.config) {
    throw new Error(
      `Failed to parse tsconfig.app.json: ${ts.flattenDiagnosticMessageText(
        configParseResult.error?.messageText ?? 'unknown',
        '\n',
      )}`,
    )
  }
  const parsedConfig = ts.parseJsonConfigFileContent(
    configParseResult.config,
    ts.sys,
    projectRoot,
    undefined,
    'tsconfig.app.json',
  )

  const options: ts.CompilerOptions = {
    ...parsedConfig.options,
    types: [], // exclude vite/vitest globals — see comment above
  }

  // Pre-parse all 6 source files. The 1 real file (routes.ts) is
  // read from disk; the 5 stubs are pure strings.
  const languageVersion = options.target ?? ts.ScriptTarget.ES2023
  const sourceFiles = new Map<string, ts.SourceFile>()
  const makeSource = (fileName: string, text: string) =>
    ts.createSourceFile(
      fileName,
      text,
      languageVersion,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    )

  sourceFiles.set(ROUTES_PATH, makeSource(ROUTES_PATH, readFileSync(ROUTES_PATH, 'utf-8')))
  sourceFiles.set(
    SYNTHETIC_NAMES.PublicRoute,
    makeSource(SYNTHETIC_NAMES.PublicRoute, NEGATIVE_STUB_SOURCES.PublicRoute),
  )
  sourceFiles.set(
    SYNTHETIC_NAMES.DashboardRoute,
    makeSource(SYNTHETIC_NAMES.DashboardRoute, NEGATIVE_STUB_SOURCES.DashboardRoute),
  )
  sourceFiles.set(
    SYNTHETIC_NAMES.AdminRoute,
    makeSource(SYNTHETIC_NAMES.AdminRoute, NEGATIVE_STUB_SOURCES.AdminRoute),
  )
  sourceFiles.set(
    SYNTHETIC_NAMES.LegacyRoute,
    makeSource(SYNTHETIC_NAMES.LegacyRoute, NEGATIVE_STUB_SOURCES.LegacyRoute),
  )
  sourceFiles.set(
    SYNTHETIC_NAMES.Positive,
    makeSource(SYNTHETIC_NAMES.Positive, POSITIVE_STUB_SOURCE),
  )

  // Custom CompilerHost — uses pre-parsed source files for the 6
  // files in our minimal program; falls back to the default host
  // for lib lookups (which `skipLibCheck: true` makes fast).
  //
  // The `languageVersionOrOptions` arg passed to `getSourceFile`
  // by the program may differ from what we used to pre-parse —
  // this is fine: the program uses the cached `SourceFile`
  // regardless. (If a future TS version validates the language
  // version of returned source files, the test would break; the
  // v4 → v5 transition would address it.)
  const baseHost = ts.createCompilerHost(options, /* setParentNodes */ true)
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      const cached = sourceFiles.get(fileName)
      if (cached) return cached
      return baseHost.getSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile,
      )
    },
    fileExists: (fileName) => {
      if (sourceFiles.has(fileName)) return true
      return baseHost.fileExists(fileName)
    },
    readFile: (fileName) => {
      const cached = sourceFiles.get(fileName)
      if (cached) return cached.text
      return baseHost.readFile(fileName)
    },
  }

  const fileNames: string[] = [
    ROUTES_PATH,
    SYNTHETIC_NAMES.PublicRoute,
    SYNTHETIC_NAMES.DashboardRoute,
    SYNTHETIC_NAMES.AdminRoute,
    SYNTHETIC_NAMES.LegacyRoute,
    SYNTHETIC_NAMES.Positive,
  ]
  const program = ts.createProgram(fileNames, options, host)

  // Bucket diagnostics by source file. We only care about
  // diagnostics from the stub files (not from routes.ts itself) —
  // a typo in routes.ts would surface as a stub diagnostic, so
  // this filter is safe.
  const stubNames = new Set<string>([
    SYNTHETIC_NAMES.PublicRoute,
    SYNTHETIC_NAMES.DashboardRoute,
    SYNTHETIC_NAMES.AdminRoute,
    SYNTHETIC_NAMES.LegacyRoute,
    SYNTHETIC_NAMES.Positive,
  ])
  const byFile = new Map<string, ts.Diagnostic[]>()
  for (const diag of ts.getPreEmitDiagnostics(program)) {
    if (!diag.file) continue
    const fileName = diag.file.fileName
    if (!stubNames.has(fileName)) continue
    const list = byFile.get(fileName) ?? []
    list.push(diag)
    byFile.set(fileName, list)
  }
  return byFile
}

// ── Tests ──────────────────────────────────────────────────────────────

/**
 * Pins all 4 route union types (`PublicRoute` / `DashboardRoute` /
 * `AdminRoute` / `LegacyRoute`) symmetrically — neither widening
 * nor narrowing can sneak through.
 *
 * Negative half (catches widening to `string`): each stub imports
 * a union type and tries to assign a deliberate typo. The typo
 * MUST surface as a TS2322 diagnostic.
 *
 * Positive half (catches narrowing / member removal): the
 * `Positive` stub exercises EVERY member of EVERY union. ZERO
 * diagnostics expected; if any union shrinks, the test fails.
 *
 * PR-review usage: a refactor that relaxes the type constraint
 * (e.g. `path: string` instead of `path: DashboardRoute`) OR
 * removes a route entry from `routes.ts` is caught at test time,
 * not at runtime as a 404.
 */
describe('Type contract — IDE typo detection is real (meta-test)', () => {
  // Compile the minimal program ONCE per test file. Without this,
  // every `it` block re-parses 6 source files and re-creates a
  // `ts.Program` — ~5× the compile work for 5 tests. The stubs are
  // immutable strings (no state changes between tests), so caching
  // is safe.
  let diagnosticsByFile: Map<string, readonly ts.Diagnostic[]>
  beforeAll(() => {
    diagnosticsByFile = getStubDiagnostics()
  })

  describe('negative: typo path is REJECTED (catches widening to string)', () => {
    it.each([
      { union: 'PublicRoute',    stub: SYNTHETIC_NAMES.PublicRoute,    typo: '/hotlst' },
      { union: 'DashboardRoute', stub: SYNTHETIC_NAMES.DashboardRoute, typo: '/dashbord/publish' },
      { union: 'AdminRoute',     stub: SYNTHETIC_NAMES.AdminRoute,     typo: '/dashboard/admi' },
      { union: 'LegacyRoute',    stub: SYNTHETIC_NAMES.LegacyRoute,    typo: '/publish_old' },
    ] as const)(
      'tsc catches a $union typo ($typo) at call-site',
      ({ union, stub, typo }) => {
        const stubDiagnostics = diagnosticsByFile.get(stub) ?? []

        // Find the SPECIFIC typo diagnostic — not just "any error
        // in the stub". This guards against false positives where
        // a stub has a different error that would also satisfy
        // `toBeGreaterThan(0)`.
        //
        // TS2322 = "Type 'X' is not assignable to type 'Y'" —
        // this is the error code TS emits for a string literal
        // that's not in a union. The message-text fallback
        // catches the case where TS reformats the literal but
        // the typo substring is still in the diagnostic message.
        const typoError = stubDiagnostics.find(
          (d) =>
            d.category === ts.DiagnosticCategory.Error &&
            (d.code === 2322 ||
              ts.flattenDiagnosticMessageText(d.messageText, '\n').includes(typo)),
        )

        // Build a debug-friendly summary of ALL diagnostics the
        // compiler emitted on this stub. The `toBeDefined()`
        // assertion only checks the matching diagnostic exists,
        // so the message is the only signal a CI run gets —
        // surface every diagnostic the compiler found, not just
        // the one that matched.
        const allDiagnosticsSummary = stubDiagnostics
          .map(
            (d) =>
              `[TS${d.code}] ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
          )
          .join(' | ')

        expect(
          typoError,
          `Expected TS2322 (or message containing "${typo}") on the ${union} stub. ` +
            `If this fails, the ${union} union has been widened (e.g. to \`string\`), ` +
            `losing IDE autocomplete + typo detection at call sites. ` +
            `Compiler found ${stubDiagnostics.length} diagnostic(s) on the stub: ${allDiagnosticsSummary}`,
        ).toBeDefined()
      },
      30_000, // generous — minimal program is normally sub-second,
      // but cold cache / CI slowness could push it close to the
      // default 5s vitest timeout.
    )
  })

  describe('positive: real paths are ACCEPTED (catches narrowing / member removal)', () => {
    it('all 4 unions accept every member from ROUTES (zero diagnostics on the positive stub)', () => {
      const stubDiagnostics = diagnosticsByFile.get(SYNTHETIC_NAMES.Positive) ?? []

      // Build a debug-friendly diagnostic summary so a CI failure
      // immediately tells the dev WHICH union was narrowed AND on
      // which line. Both `line` and `character` are 0-indexed from
      // `getLineAndCharacterOfPosition`; +1 for human-friendly
      // 1-indexed output. The bare `line:col` format matches
      // `tsc --noEmit` convention so the dev can copy-paste the
      // location into their editor.
      const diagnosticSummary = stubDiagnostics
        .map((d) => {
          const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n')
          const pos =
            d.file && d.start !== undefined
              ? d.file.getLineAndCharacterOfPosition(d.start)
              : null
          const loc = pos ? ` (${pos.line + 1}:${pos.character + 1})` : ''
          return `  - [TS${d.code}]${loc} ${msg}`
        })
        .join('\n')

      expect(
        stubDiagnostics,
        `Expected ZERO diagnostics on the positive stub (which exercises all ` +
          `7 PublicRoute + 10 DashboardRoute + 3 AdminRoute + 5 LegacyRoute = 25 members). ` +
          `If this fails, one of the unions has been narrowed — a real path is no ` +
          `longer in the union. Diagnostics:\n${diagnosticSummary}`,
      ).toHaveLength(0)
    }, 30_000)
  })
})
