#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// lint-with-baseline.mjs
//
// CI-actionable diff checker for ESLint baseline artifacts. Compares a
// freshly-captured `eslint --format json` snapshot against a stored
// baseline (e.g. `scripts/.lint-baseline-after-render-harness.json`)
// and exits non-zero when the fresh output introduces NEW violations
// NOT in the baseline.
//
// Behaviour:
//   - Reads baseline JSON → keyed by (file, ruleId, line) triples
//   - Reads fresh JSON   → same shape
//   - Diff = (fresh - baseline); excludes severity-1 (warnings)
//   - Exit 0 = no new violations
//   - Exit 1 = at least one new violation; prints summary
//
// Usage:
//   node scripts/lint-with-baseline.mjs
//     # Uses baseline @ scripts/.lint-baseline-after-render-harness.json
//     # Generates fresh @ scripts/.lint-baseline-fresh.json (overwritten)
//
//   node scripts/lint-with-baseline.mjs --baseline path/to/baseline.json
//                                           --fresh path/to/fresh.json
//
//   # To pre-bake the fresh snapshot in CI runners:
//   ./node_modules/.bin/eslint . --ext .ts,.tsx --format json \
//       --output-file scripts/.lint-baseline-fresh.json
//   node scripts/lint-with-baseline.mjs
// ──────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function parseArgs(argv) {
  const out = { baseline: null, fresh: null }
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--baseline') {
      out.baseline = value
      i += 1
    } else if (flag === '--fresh') {
      out.fresh = value
      i += 1
    }
  }
  return out
}

const args = parseArgs(process.argv)

const baselinePath = args.baseline
  ? resolve(args.baseline)
  : join(__dirname, '.lint-baseline-after-render-harness.json')

const freshPath = args.fresh
  ? resolve(args.fresh)
  : join(__dirname, '.lint-baseline-fresh.json')

// Read baseline
let baselineRaw
try {
  baselineRaw = JSON.parse(readFileSync(baselinePath, 'utf8'))
} catch (err) {
  console.error(`[lint-with-baseline] FATAL: could not read baseline @ ${baselinePath}`)
  console.error(`  ${err.message}`)
  process.exit(2)
}

// If --fresh wasn't passed in, generate it ourselves via eslint.
// NOTE: this requires `node_modules/.bin/eslint` to exist in repoRoot.
const { execSync } = await import('node:child_process')
if (!args.fresh) {
  console.log(`[lint-with-baseline] generating fresh snapshot @ ${freshPath}`)
  try {
    execSync(
      './node_modules/.bin/eslint . --ext .ts,.tsx --format json ' +
        `--output-file ${freshPath}`,
      { cwd: repoRoot, stdio: ['pipe', 'inherit', 'inherit'] },
    )
  } catch (err) {
    // eslint exits 1 when there are violations — that's expected; suppress.
    if (err.status !== 1) {
      console.error('[lint-with-baseline] FATAL: eslint invocation failed')
      console.error(err.message)
      process.exit(2)
    }
  }
}

if (!existsSync(freshPath)) {
  console.error(`[lint-with-baseline] FATAL: fresh snapshot missing @ ${freshPath}`)
  process.exit(2)
}

const freshRaw = JSON.parse(readFileSync(freshPath, 'utf8'))

// Normalize: extract (file, ruleId, line) triples for severity=2 only.
function violationsByLocation(json) {
  const out = new Map()
  for (const f of json) {
    const file = f.filePath
    for (const m of f.messages ?? []) {
      if (m.severity !== 2) continue
      const key = `${file}::${m.ruleId ?? '<null>'}::${m.line}`
      out.set(key, { file, ruleId: m.ruleId ?? '<null>', line: m.line, message: m.message })
    }
  }
  return out
}

const baselineSet = violationsByLocation(baselineRaw)
const freshSet = violationsByLocation(freshRaw)

// New = in fresh, not in baseline.
const newViolations = []
for (const [key, val] of freshSet) {
  if (!baselineSet.has(key)) {
    newViolations.push(val)
  }
}

// Resolved = in baseline, not in fresh.
const resolvedViolations = []
for (const [key, val] of baselineSet) {
  if (!freshSet.has(key)) {
    resolvedViolations.push(val)
  }
}

// Group new violations by file×rule for compact reporting.
const byFileRule = new Map()
for (const v of newViolations) {
  const key = `${v.file}::${v.ruleId}`
  if (!byFileRule.has(key)) byFileRule.set(key, { file: v.file, ruleId: v.ruleId, entries: [] })
  byFileRule.get(key).entries.push(v)
}

console.log(
  `[lint-with-baseline] baseline=${baselineSet.size} violations, ` +
    `fresh=${freshSet.size}, new=${newViolations.length}, resolved=${resolvedViolations.length}`,
)

if (newViolations.length > 0) {
  console.log('\n[lint-with-baseline] NEW violations introduced:')
  for (const { file, ruleId, entries } of byFileRule.values()) {
    console.log(`  • ${file} :: ${ruleId} (${entries.length})`)
    for (const e of entries) {
      console.log(`    L${e.line}: ${e.message.slice(0, 120)}`)
    }
  }
}

if (resolvedViolations.length > 0) {
  console.log('\n[lint-with-baseline] RESOLVED (now passing):')
  // Show first 10 for visibility, then summarise the rest.
  for (const r of resolvedViolations.slice(0, 10)) {
    console.log(`  • ${r.file}:${r.line} :: ${r.ruleId}`)
  }
  if (resolvedViolations.length > 10) {
    console.log(`  …and ${resolvedViolations.length - 10} more`)
  }
}

if (newViolations.length > 0) {
  console.log('\n[lint-with-baseline] FAIL: at least one new violation vs baseline.')
  process.exit(1)
}

console.log(
  '[lint-with-baseline] PASS: no new violations vs baseline. ' +
    `(${resolvedViolations.length} previously-baselined now resolved)`,
)
process.exit(0)
