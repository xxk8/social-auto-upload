# Design: tsc-ratchet sweep workflow

## How the gate currently works

`tsc-ratchet-gate` in `.github/workflows/ci.yml` runs `npx tsc -b` with
`FORCE_COLOR=0`, counts `^src/.*: error TS\d+:` lines, and compares against
`docs/tsc-error-baseline.txt`. The gate fails when the count rises above
baseline (new errors introduced) AND when the count falls below baseline
without a corresponding baseline decrement (a backfill PR forgot to lower
the baseline). The exact stderr line on backfill drift prints the literal
command CI expects, so recovery is one shell line.

## Per-PR workflow

For every PR fixing K of the 15 drift errors:

1. Run `FORCE_COLOR=0 npx tsc -b` from `sau_web/frontend/` and capture
   `CURRENT_COUNT`.
2. Run `printf '%s\n' "$CURRENT_COUNT" > docs/tsc-error-baseline.txt` in
   repo root.
3. Commit the source fix AND the baseline file in the SAME commit. The
   ratchet compares current vs baseline atomically -- co-committing keeps
   the gate green at every CI run.
4. Bump `openspec/changes/tsc-drift-sweep-2026-q3/_index.json` `tasks.completed`
   by K. `tasks.total` stays at 15 until the umbrella is closed.

## Files in scope (initial seed; expand via follow-up PRs)

Pending live verifier with stable regex. Known contributor surfaced during
investigation: `src/Components/LoginProgressModal.tsx:97` (TS2591: Cannot
find name 'process'). This is PRE-EXISTING (the `process.env.NODE_ENV`
reference predates the recent `isOperatorOrDevMode` -> `canSeeInternalProbe`
rename; the rename did not introduce the error). A clean fix is to declare
`process` types via `@types/node` or to scope the check to a Node-only
module subset.

## Out of scope

- Raising `docs/tsc-error-baseline.txt` to ≥ 143. The user's preference is
  the ratchet STILL BITES -- this is path B (sweep errors, not relax gate).
- Re-architecting `tsc-ratchet-gate` itself. The gate's mechanical behavior
  is correct; only the count needs lowering.
- Disabling the gate. Even with drift, the gate correctly blocks regressions.
