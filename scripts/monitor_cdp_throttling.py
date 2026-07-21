"""Hourly cron-friendly monitor for TBF-018 4-week production window.

Scans `.sau-logs/*.log` for patchright CDP-DEBUG patterns and writes a
one-line aggregate to `.sau-logs/monitor-cdp-throttling.log`. Tracks
per-log-file byte-offset (keyed by inode) in `.sau-logs/.monitor-state.json`
for true idempotency — re-runs in same hour do NOT double-count.

Patterns monitored
------------------

* 🚨 ``cdp_throttle``: ``"Too many requests to CDP server"`` — TBF-018 primary
  trigger (v9 fast-spin polish race-condition symptom).
* ⚠️ ``http_errors``: ``"patchright urlopen failed"`` — secondary signal
  (network-layer issues independent of fast-spin decision).
* ℹ️ ``race_events``: ``"ContextClosed"`` + ``"TargetClosedError"`` —
  patchright race-classifier hits already handled at runtime; logged
  here as supplementary telemetry, NOT a revert trigger.

Decision criterion (per TBF-018 ticket)
---------------------------------------

* 🚨 ``cdp_throttle >= 1`` per 5-min cycle, OR ℹ️ ``race_events`` pre-empted
  success in hot-loop window → revert v9 fast-spin polish to try/finally
  wrapper (per TBF-018 ticket body Recommended fix section).
* Zero 🚨 across 4-week baseline → downgrade TBF-018 to wontfix.
* Manual review at week 1/2/3/4 checkpoints (see TBF-018 Decisions log).

Cron recommendation
-------------------

::

    0 * * * * cd <repo> && .venv/bin/python scripts/monitor_cdp_throttling.py \\
        >> .sau-logs/monitor-cdp-throttling.log 2>&1

**Single-instance only**: do NOT schedule on multiple hosts without a
file-locking wrapper (e.g. ``fcntl.flock`` on ``.monitor-state.json``).
Two concurrent cron sweeps can interleave write and corrupt the JSON
state, causing the next run to reset to offset 0 and double-count
events. For the 4-week TBF-018 baseline window, single-host cron is
the expected deployment.

Exit semantics
--------------

* Exit 0 even when `.sau-logs/` is missing (clean deploy / first-run
  pre-log) so cron doesn't false-alarm. A diagnostic line is printed.
* Exit 0 on empty match (zero throttling is the GOOD signal — we want
  weekly checkpoints to show zero events).
* Exit non-zero ONLY on internal Python errors (bug, not throttling).

Design notes
------------

* **Inode-keyed byte-offset idempotency**: when patchright rotates
  ``backend.log`` (e.g. ``backend.log → backend.log.1``, new file gets
  new inode), the offset naturally resets to 0. Rotation-aware without
  parsing timestamps or inode-tracking via paths (which break on
  restore-from-backup).
* **Logs of unknown encoding** are decoded with ``errors="replace"``
  so binary / mojibake data never crashes the hourly sweep.
* **Self-exclusion**: the monitor's own output file
  (``monitor-cdp-throttling.log``) is NOT counted, so writing one
  sweep line plus its verbose body can't recursively inflate its own
  cdp_throttle counter (a fun failure mode for naive grep loops).
* **No external deps**: stdlib only (``json``, ``argparse``, ``pathlib``).
* **No pip / no test harness**: this is a one-shot utility mirroring
  ``scripts/refresh_douyin_cookies.py`` style.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# Force UTF-8 stdout so the 🚨/⚠️ℹ️️ emojis in the aggregate line do not mojibake on
# bare-bones Linux cron environments that lack ``LANG=en_US.UTF-8``.
# Mirrors `utils/log.py::log_formatter` discipline (reconfigure-or-skip EAFP).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Default locations tied to project root. Override with --logs-dir for portability.
# Using __file__-relative resolves correctly whether invoked from cron cwd
# (~/.cron or /tmp) or directly from the repo root.
_REPO_ROOT = Path(__file__).resolve().parent.parent
LOGS_DIR = _REPO_ROOT / ".sau-logs"
STATE_FILE_NAME = ".monitor-state.json"
OUT_LOG_NAME = "monitor-cdp-throttling.log"

# Patterns grouped by severity bucket. Substring match is enough because
# patchright's debug log strings are stable across v0.x → v1.x.
PATTERNS: dict[str, list[str]] = {
    "cdp_throttle": ["Too many requests to CDP server"],
    "http_errors":  ["patchright urlopen failed"],
    "race_events":  ["ContextClosed", "TargetClosedError"],
}


def _load_state(state_path: Path) -> dict[str, int]:
    """Load byte-offset state from JSON. Returns ``{}`` if missing or corrupt."""
    if not state_path.exists():
        return {}
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        sys.stderr.write(f"[monitor] WARNING: state file corrupt ({exc}); resetting\n")
        return {}


def _save_state(state_path: Path, state: dict[str, int]) -> None:
    """Persist state JSON. Atomic rename is overkill for hourly cron (file is private)."""
    state_path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def _scan_log(log_path: Path, state: dict[str, int]) -> dict[str, int]:
    """Scan one log file for all patterns, update state, return count dict.

    Keyed by inode so rotation produces a fresh offset-0 entry naturally.
    """
    stat_result = log_path.stat()
    inode_key = str(stat_result.st_ino)
    current_size = stat_result.st_size

    # If the file shrunk relative to the prior offset (rotation, truncation,
    # accidental rewrite), reset to scan from start of new content.
    prior_offset = state.get(inode_key, 0)
    offset = 0 if current_size < prior_offset else prior_offset

    with log_path.open("rb") as f:
        f.seek(offset)
        raw = f.read()

    chunk = raw.decode("utf-8", errors="replace")

    counts: dict[str, int] = {
        bucket: sum(chunk.count(p) for p in patterns) for bucket, patterns in PATTERNS.items()
    }
    counts["bytes_scanned"] = len(chunk)

    state[inode_key] = offset + len(raw)
    return counts


def _build_aggregate_line(timestamp: str, files_scanned: int, totals: dict[str, int]) -> str:
    """One-line human-readable aggregate. Emojis help visual scanning at a glance."""
    return (
        f"[{timestamp}] monitor sweep: "
        f"files_scanned={files_scanned}, "
        f"🚨cdp_throttle={totals['cdp_throttle']}, "
        f"⚠️http_errors={totals['http_errors']}, "
        f"ℹ️race_events={totals['race_events']}, "
        f"bytes_scanned={totals['bytes_scanned']}\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--logs-dir", default=str(LOGS_DIR),
                    help=f"Logs directory to scan (default: {LOGS_DIR}).")
    ap.add_argument("--reset-state", action="store_true",
                    help="Delete state file before scanning. Used after manual cleanup.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print aggregate line without saving state (offset NOT advanced).")
    args = ap.parse_args()

    logs_dir = Path(args.logs_dir)

    if not logs_dir.exists():
        # Clean deploy / no production logs yet — exit 0 so cron doesn't flag
        # an empty / missing dir as a job failure.
        sys.stdout.write(f"[monitor] logs dir missing ({logs_dir}); nothing to scan\n")
        return

    state_path = logs_dir / STATE_FILE_NAME
    if args.reset_state and state_path.exists():
        state_path.unlink()

    state: dict[str, int] = {} if args.dry_run else _load_state(state_path)

    totals: dict[str, int] = {bucket: 0 for bucket in PATTERNS}
    totals["bytes_scanned"] = 0
    files_scanned = 0

    # Alphabetical glob — deterministic scan order helps humans reproduce
    # an aggregate line from a given state (otherwise aggregated counts
    # could differ between iterations if order isn't pinned).
    for log_path in sorted(logs_dir.glob("*.log")):
        if log_path.name == OUT_LOG_NAME:
            continue  # self-exclusion
        try:
            sub = _scan_log(log_path, state)
        except OSError as exc:
            sys.stderr.write(f"[monitor] WARNING: cannot read {log_path.name} ({exc}); skipping\n")
            continue
        for k, v in sub.items():
            totals[k] += v
        files_scanned += 1

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sys.stdout.write(_build_aggregate_line(timestamp, files_scanned, totals))
    sys.stdout.flush()

    if not args.dry_run:
        _save_state(state_path, state)


if __name__ == "__main__":
    main()
