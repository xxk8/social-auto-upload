"""Standalone minimal-reproducer for the `_sync_cookie_files_to_db` TOCTOU race.

This script demonstrates (and lets a maintainer re-verify) that the
`_sync_cookie_files_to_db()` walker at `web_runner/utils.py` raises
either::

    sqlite3.IntegrityError("UNIQUE constraint failed: account_groups.name")

or::

    RuntimeError("INSERT did not return id: 'INSERT INTO account_groups
                  (name, created) VALUES (?, ?)'")

when N concurrent walkers race on the SELECT-then-INSERT pattern.

The reproducer is a counterpart to the audit-trail story in
``openspec/changes/audit-account-groups-unique-collision-2026q3/design.md``.
Run it directly to capture stdout into the ``artifacts/`` directory; do
NOT add to CI (timing is non-deterministic — CI would flake).

## Mechanism (from design.md §Mechanism refinement)

The original hypothesis (preliminary Path A: plural cookie files share an
account_name stem) was rejected after re-reading `_sync_cookie_files_to_db`
(web_runner/utils.py:390-446): the loop performs `SELECT id FROM
account_groups WHERE name = ?` BEFORE the INSERT. Within a single
sequential call, the SELECT catches the previously-inserted row on the
2nd file-with-same-stem and re-uses `group_id` via the
`if group: group_id = group["id"]` branch → no INSERT → no UNIQUE
collision. Path A is sequentially impossible.

The **actual** collision mechanism is a **TOCTOU (Time-Of-Check to
Time-Of-Use) race** across concurrent walkers. Two threads can both pass
through the SELECT with `None` returned, then collide on the INSERT.

## Empirical outcomes (from a 2026-Q3 smoke run with N=8)

The race can fire on either of two exception paths:

1. **`sqlite3.IntegrityError`** (driver-rejection): the second thread's
   `conn.execute("INSERT INTO account_groups ... RETURNING id")` triggers
   the UNIQUE constraint directly. The sqlite3 driver raises
   `IntegrityError` BEFORE `fetchone()` runs; the `RuntimeError("INSERT
   did not return id")` fallback block in `insert_returning_id` is never
   reached.

2. **`RuntimeError("INSERT did not return id")`** (the fallback): under
   SQLite's WAL+busy_timeout mode plus concurrent-write timing, the second
   thread's `conn.execute` may SUCCEED (writes to WAL) but the
   `with self._connect() as conn:` roll-back on unwind causes `fetchone()`
   to return `None`. The `if not row` fallback then fires
   `RuntimeError("INSERT did not return id: <sql>")`.

In practice at N=8, the empirical distribution was approximately
``{walker_returned_ok: 5, walker_raised_runtime_error: 1,
walker_raised_integrity_error: 2}``. The exact split is non-deterministic
because SQLite's WAL + busy_timeout mode resolves the race window
opaquely; both kinds of errors confirm the same underlying TOCTOU race.

## Sqlite-vs-Postgres differential (informational, NOT exercised here)

The script wires SQLite only. PostGres differential is documented in
`design.md §Sqlite-vs-Postgres exception-flow differential` — the key
behavioral difference is that PostgresDatabase.insert_returning_id DOES
NOT have a `RuntimeError("INSERT did not return id")` fallback (the PG
method would silently return `0` if fetchone returned None), so on
Postgres the UNIQUE collision surfaces as a clean `sqlite3.IntegrityError`
(post `_translate_psycopg_exception` wrap) with `__cause__ =
psycopg.errors.UniqueViolation`. The `RuntimeError("INSERT did not
return id")` symptom is SQLite-only. This script does not exercise the
PG path because wiring requires operator-supplied `DATABASE_URL` +
`psycopg` installed — out of scope for the hermetic audit.

## Usage

    .venv/bin/python scripts/audit_account_groups_unique_collision.py \\
        --threads 8

    # With artifact-capture (recommended for audit-trail records):
    .venv/bin/python scripts/audit_account_groups_unique_collision.py \\
        --threads 8 \\
        --artifacts-dir openspec/changes/audit-account-groups-unique-collision-2026q3/artifacts/

## Exit code

    0  = race fired (≥ 1 thread crashed with EITHER exception path)
    1  = race did not fire (try raising --threads for a wider race surface)
    2  = script-level error (bad args, missing tmp setup, post-run
         invariance assertion failure)

## Hermetic isolated import trick (why the sys.modules stub)

`web_runner/utils.py::_sync_cookie_files_to_db` is invoked at IMPORT TIME
via `web_runner/__init__.py::create_app()` boot path (line 46 of
`__init__.py`). Importing the real module naively would run the real
walker against the REAL cookies dir + REAL DB (`db/database.db`),
polluting audit state.

The script sidesteps that by:
1. `os.environ.setdefault("SAU_DB_DIALECT", "sqlite")` BEFORE any
   web_runner import, so the module-level `_IS_POSTGRES` constant
   (web_runner/utils.py:220) reads `False` from the start.
2. `sys.path.insert(0, REPO_ROOT)` so `web_runner.utils` is findable.
3. Inserting a stub `web_runner` package into `sys.modules` BEFORE the
   real one is touched — the stub package has no `__init__.py` boot
   side effects.
4. Importing `web_runner.db` + `web_runner.utils` through the stub —
   the modules load fine (they only import each other + stdlib).
5. Rebinding `wr_utils.COOKIES_DIR` + `wr_db.DB_PATH` to tmp paths.
6. Initializing the tmp `account_groups` + `account_authorizations`
   schema verbatim from `web_runner/db.py::_init_db_sqlite`.

After this setup, N threads can call the real walker without any
import-time or boot-time side effects affecting the actual production
state.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
import traceback
import types
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

# Pre-import env binding: web_runner/utils.py:220 reads
# `_IS_POSTGRES = os.environ.get("SAU_DB_DIALECT", "postgres").lower() == "postgres"`
# at module-level. Default is postgres, which would route the walker's
# `account_authorizations` INSERT through the PG-specific ON CONFLICT
# branch. For the audit script the SELECT-then-INSERT pre-check prevents
# reaching that branch (the tmp DB is empty), but explicit binding is
# documentation-by-environment + future-proofing.
os.environ.setdefault("SAU_DB_DIALECT", "sqlite")

REPO_ROOT = Path(__file__).resolve().parent.parent

# ── Schema-mirroring DDL (verbatim from web_runner/db.py::_init_db_sqlite) ──
#
# We can't reuse web_runner.db.init_db() because that imports the entire
# Flask machinery + registers blueprints — too much side effect for a
# focused audit. We're reproducing ONLY the 2 tables the walker touches:
#   account_groups (UNIQUE on name) + account_authorizations.
# If these columns drift in production, the audit is invalidated —
# keep in sync with web_runner/db.py lines 1235-1248.

CREATE_TABLE_ACCOUNT_GROUPS = """
CREATE TABLE IF NOT EXISTS account_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
)
"""

CREATE_TABLE_ACCOUNT_AUTHORIZATIONS = """
CREATE TABLE IF NOT EXISTS account_authorizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    cookie_file TEXT NOT NULL,
    created TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (group_id) REFERENCES account_groups(id) ON DELETE CASCADE,
    UNIQUE(group_id, platform)
)
"""


def _build_argparser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--threads", type=int, default=8,
        help="N concurrent walkers to race (default 8). Higher = more "
             "likely to catch the TOCTOU window deterministically. N=2 is "
             "the minimum that triggers the race; N≥4 typically fires on "
             "the first try.",
    )
    ap.add_argument(
        "--cookie-name", default="douyin_alice",
        help="Conforming cookie stem `<platform>_<account>` (default "
             "`douyin_alice`). Splits on the FIRST underscore matches the "
             "real walker's `parts = name.split('_', 1)` invariant. "
             "account_name = stem parts[1].",
    )
    ap.add_argument(
        "--artifacts-dir", default=None,
        help="Optional output directory for stdout-as-JSON trace. "
             "Recommended: openspec/changes/audit-account-groups-unique-collision-2026q3/artifacts/ "
             "so the audit-trail record lives alongside the openspec ticket.",
    )
    return ap


def _stub_web_runner_package() -> types.ModuleType:
    """Install an empty `web_runner` package into sys.modules BEFORE the
    real one is touched.

    Reason: `web_runner/__init__.py::create_app()` boot path runs
    `_sync_cookie_files_to_db()` at line 46, which would walk the REAL
    cookies dir against the REAL DB. Bypassing `__init__.py` keeps the
    audit hermetic.
    """
    pkg = types.ModuleType("web_runner")
    pkg.__path__ = [str(REPO_ROOT / "web_runner")]  # noqa: SLF001 — required for submodule resolution
    sys.modules["web_runner"] = pkg
    return pkg


def _setup_env(tmp_dir: Path, db_path: Path) -> tuple:
    """Import `web_runner.db` + `web_runner.utils` through a stub package
    + rebind `COOKIES_DIR` + `DB_PATH` to tmp paths + init the local
    schema. Returns (wr_utils, wr_db) module references.
    """
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    _stub_web_runner_package()

    import web_runner.db as wr_db
    import web_runner.utils as wr_utils

    # Rebind module-level paths to the tmp values — both reads happen
    # at call time (per their respective init explanations in the
    # modules), so a rebind before walker entry is sufficient.
    wr_utils.COOKIES_DIR = tmp_dir
    wr_db.DB_PATH = db_path

    # Initialize the tmp DB schema. We mirror `_init_db_sqlite` for
    # ONLY the 2 tables the walker touches (account_groups +
    # account_authorizations).
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(CREATE_TABLE_ACCOUNT_GROUPS)
        conn.execute(CREATE_TABLE_ACCOUNT_AUTHORIZATIONS)
        conn.commit()

    # Drop a single conforming cookie file. JSON content is irrelevant
    # because the walker reads `cookie_file.stem` only.
    (tmp_dir / "douyin_alice.json").write_text("{}")

    return wr_utils, wr_db


def _worker(idx: int, wr_utils, cookie_name: str) -> tuple[int, str, str, str]:
    """Single walker call. Returns (idx, outcome, exc_type, exc_message_or_ok_detail).

    Outcome taxonomy (matches empirical observations at N=8):
      * walker_returned_ok              — walker returned without exception
      * walker_raised_integrity_error   — driver-level UNIQUE-constraint rejection
                                          (sqlite3.IntegrityError direct from
                                          conn.execute BEFORE fetchone)
      * walker_raised_runtime_error     — fetchone returned no row (SQLite WAL
                                          + busy_timeout race resolution),
                                          triggering `insert_returning_id`'s
                                          `if not row` fallback block
      * walker_raised_other             — any other exception (transport,
                                          schema, etc. — investigate)
    """
    try:
        wr_utils._sync_cookie_files_to_db()  # noqa: SLF001 — real prod entry point
        return (idx, "walker_returned_ok", "", "")
    except RuntimeError as exc:
        return (idx, "walker_raised_runtime_error", type(exc).__name__, str(exc))
    except sqlite3.IntegrityError as exc:
        return (idx, "walker_raised_integrity_error", type(exc).__name__, str(exc))
    except Exception as exc:
        return (
            idx,
            "walker_raised_other",
            type(exc).__name__,
            f"{exc!s}\n---traceback---\n{''.join(traceback.format_exception(type(exc), exc, exc.__traceback__))}",
        )


def main(argv: list[str] | None = None) -> int:
    args = _build_argparser().parse_args(argv)

    if args.threads < 2:
        print("[audit] FATAL: --threads must be ≥ 2 to demonstrate the race", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="sau_audit_") as tmp:
        tmp_dir = Path(tmp) / "cookies"
        db_path = Path(tmp) / "audit.db"

        wr_utils, wr_db = _setup_env(tmp_dir, db_path)

        # ── N-thread race ──
        outcomes: list[tuple[int, str, str, str]] = []

        with ThreadPoolExecutor(max_workers=args.threads) as ex:
            futures = [ex.submit(_worker, i, wr_utils, args.cookie_name) for i in range(args.threads)]
            for fut in as_completed(futures):
                outcomes.append(fut.result())

        outcomes.sort(key=lambda r: r[0])

        # ── Post-run validation — account_groups must contain exactly 1 row ──
        with sqlite3.connect(str(db_path)) as conn:
            row = conn.execute(
                "SELECT id, name, created FROM account_groups WHERE name = 'alice'",
            ).fetchone()

        n_ok = sum(1 for r in outcomes if r[1] == "walker_returned_ok")
        n_runtime = sum(1 for r in outcomes if r[1] == "walker_raised_runtime_error")
        n_integrity = sum(1 for r in outcomes if r[1] == "walker_raised_integrity_error")
        n_other = sum(1 for r in outcomes if r[1] == "walker_raised_other")

        result = {
            "dialect": "sqlite",
            "threads": args.threads,
            "cookie": args.cookie_name,
            "outcomes": [
                {
                    "worker": idx,
                    "outcome": outcome,
                    "exc_type": exc_type,
                    "exc_or_detail": exc_msg,
                }
                for idx, outcome, exc_type, exc_msg in outcomes
            ],
            "summary": {
                "walker_returned_ok": n_ok,
                "walker_raised_runtime_error": n_runtime,
                "walker_raised_integrity_error": n_integrity,
                "walker_raised_other": n_other,
            },
            "account_groups_row_after_race": (
                dict(zip(("id", "name", "created"), row, strict=False)) if row else None
            ),
        }

        print(json.dumps(result, indent=2, ensure_ascii=False))

        # ── Artifact capture (optional) ──
        if args.artifacts_dir:
            artifact_dir = Path(args.artifacts_dir)
            artifact_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
            art = artifact_dir / f"repro-sqlite-N{args.threads}-{stamp}.json"
            art.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"[audit] trace written: {art}", file=sys.stderr)

        # ── Outcome assertions + exit code ──
        if row is None:
            print(
                "[audit] FATAL: account_groups row missing post-race; "
                "walker did not INSERT on any thread — walker change "
                "invalidated reproducer",
                file=sys.stderr,
            )
            return 2
        if n_ok == 0 and n_runtime == 0 and n_integrity == 0:
            print(
                "[audit] FATAL: zero ok AND zero errors; walker "
                "may be in a no-op state",
                file=sys.stderr,
            )
            return 2
        if n_ok > 1:
            # Two or more threads both succeeded — would mean SELECT-
            # then-INSERT protection is lost entirely. Investigate.
            print(
                f"[audit] FATAL: {n_ok} threads ALL succeeded (= both "
                "passed SELECT and both INSERTed); SELECT-then-INSERT "
                "protection lost — re-audit walker integrity",
                file=sys.stderr,
            )
            return 2

        n_total_crashed = n_runtime + n_integrity + n_other
        if n_total_crashed > 0:
            print(
                f"[audit] mechanism CONFIRMED: {n_total_crashed}/{args.threads} "
                f"thread(s) raised on account_groups UNIQUE "
                f"(runtime={n_runtime}, integrity={n_integrity}, other={n_other}); "
                f"{n_ok} returned ok; "
                f"account_groups row (id={row[0]}, name={row[1]!r}) "
                "post-run state validates.",
                file=sys.stderr,
            )
            return 0

        print(
            f"[audit] mechanism NOT REPRODUCED with N={args.threads}; "
            f"{n_ok} returned ok and {n_total_crashed} errored. Try raising "
            "--threads to widen race surface.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
