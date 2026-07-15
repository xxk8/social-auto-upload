# tsc-drift-sweep-2026-q3

## Problem

`docs/tsc-error-baseline.txt` (= `128`) is 15 errors behind the actual
`npx tsc -b` count (= `143`). Drift was introduced by earlier-session work
(round-§11 wizard port + cross-platform Proposal B mirror — xiaohongshu /
bilibili cookie flows) that landed without re-syncing the ratchet.
`tsc-ratchet-gate` (`.github/workflows/ci.yml`) now fails locally and would
fail on merge.

## Approach

Open a follow-up umbrella that documents the runbook. The baseline file is
NOT raised — that would weaken the ratchet ("it still bites" requires the
baseline stays at or below the actual error count). Each future PR that
fixes K of the drift errors atomically:

1. Commits the source fix.
2. Updates `docs/tsc-error-baseline.txt` to the post-fix count
   (the same `printf '%s\n' "$CURRENT_COUNT" > docs/tsc-error-baseline.txt`
   command that CI's `tsc-ratchet-gate` prints on backfill-drift failure).
3. Bumps `_index.json` `tasks.completed` by K.

## Scope

15 errors across N files (per-file / per-rule breakdown pending live
verifier). One umbrella change, mirroring `web-shell-polish-2026-q3`. Each
PR touches 1-3 files and fixes an isolated failure class.
