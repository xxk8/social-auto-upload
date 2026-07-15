# `/tmp/sau_recovery/` Backup Contents (volunteer recovery)

During the optional mode (`feat/OPT-3F-e2e` cleanup round), two untracked
directories with malformed path-like names were intentionally **moved out** of
the working tree to clear `git status`, rather than deleted outright.

The directories were moved to `/tmp/sau_recovery/` because:

1. They contained a single file each (named `path`) with content that appeared
   to be **more comprehensive** than the legitimate counterparts:
   - `cli/parser.py</path` ← contains `search` and `detail` actions not in
     current `cli/parser.py`.
   - `cli/platforms/__init__.py</path` ← contains an expanded platform import
     registry compared to current `cli/platforms/__init__.py`.
2. Both were untracked, so their data loss would be silent — moving to a known
   location preserves the possibility of recovery on a follow-up branch.

## Names + Locations

```
/tmp/sau_recovery/cli_parser_path_dir/path
/tmp/sau_recovery/cli_platforms_init_path_dir/path
```

## Migration date

2026-07-15 (round-OPT-3F-e2e cleanup window).

## Recovery

If the user (or a future branch) decides to recover, the recommended path is:

1. Compare the `path` contents against current `cli/parser.py` and
   `cli/platforms/__init__.py`.
2. Surface the additions as a follow-up PR (`feat: extend crawler CLI parser`)
   rather than amending this chain.
3. Once recovered (or verified redundant), the `/tmp/sau_recovery/` dirs can
   be deleted via `rm -rf /tmp/sau_recovery/`.

## Why not just delete them?

The malformed path files contained parser/platform-init extensions that were
not yet exposed in the current codebase. Deleting them unconditionally could
represent silent data loss of in-progress work that the developer hadn't yet
committed. Since the project was already in cleanup-recovery mode, "move first,
decide later" was the safer default.
