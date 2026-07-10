"""Calendar-focused routes complementing ``web_runner/routes/tasks.py``.

Adds ``GET /api/calendar/tasks`` which returns the tasks whose
**effective date** falls within a calendar range, plus a small
server-side aggregation split (by_platform / by_status). The
pre-existing ``GET /api/tasks/scheduled`` only returns rows where
``scheduled_at IS NOT NULL AND status IN ('pending', 'scheduled')``
— a strict subset of what the content-calendar surface needs. The
calendar shows the FULL lifecycle (success / failed / running
already-published tasks alongside currently-scheduled ones) so an
operator can see "what happened recently" + "what's planned" on the
same grid.

## Effective-date semantics

::
    effective_date = COALESCE(scheduled_at, created)

* **Scheduled** tasks (any status) pin to ``scheduled_at`` — the
  planned publish time.
* **One-off** tasks (no ``scheduled_at``) pin to ``created`` — when
  the operator actually kicked them off.

This makes the timeline read chronologically: past dates are
populated by what already happened, future dates by what's
upcoming, no double-counting.

## Dialect contract

* ``?`` placeholders only — ``_translate_placeholders`` rewrites to
  ``%s`` for PG. Live codebase is PG-only post-SQLite-removal.
* Returns ISO 8601 strings (consistent with ``/api/tasks``).
* No auth gate at this route — same parity as
  ``/api/tasks/scheduled`` and ``/api/publish/history`` (lightweight
  read; the auth boundary lives at ``/api/*`` via the global
  ``_check_auth`` hook in ``web_runner/__init__.py``).
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime

from flask import Blueprint, jsonify, request

from web_runner.db import get_database
from web_runner.routes.tasks import _title_from_argv

bp = Blueprint("calendar", __name__)


@bp.get("/api/calendar/tasks")
def list_calendar_tasks():
    """Return tasks whose effective date is within ``[start, end)``.

    Query params
    -----------
    start : str
        Inclusive lower bound, ``YYYY-MM-DD`` (e.g. ``2026-07-01``).
    end : str
        Exclusive upper bound, ``YYYY-MM-DD`` (e.g. ``2026-08-01``).
        Half-open semantics lets the frontend page month-by-month
        with no gap or overlap.
    platform : str, optional
        Comma-separated; ``"douyin,bilibili"`` narrows the result
        set. Empty string = no platform filter.
    account : str, optional
        Comma-separated; same shape as ``platform``. Empty string =
        no account filter.

    Response
    --------
    ::
        {
          "success": true,
          "data": {
            "tasks": [
              {
                "task_id":   "task_abc",
                "platform":  "douyin",
                "account":   "work1",
                "action":    "upload-video",
                "status":    "success",
                "title":     "周末探店 Vlog",
                "scheduled_at": null,
                "created":  "2026-07-04T14:30:00",
                "effective_date": "2026-07-04"
              }
            ],
            "summary": {
              "total": 28,
              "by_platform": {"douyin": 12, "bilibili": 8, ...},
              "by_status":   {"success": 20, "failed": 2, "pending": 6}
            }
          }
        }

    Errors
    ------
    * ``400`` — missing or malformed ``start`` / ``end``
    * ``500`` — DB failure (caught by the global ``_handle_unexpected_error``)
    """
    start = request.args.get("start", "").strip()
    end = request.args.get("end", "").strip()
    # Defensive date validation: a typo'd ``start=2026-13-01`` would
    # silently return NO rows (lex compare fails), so we surface it
    # as a 400 instead. datetime.strptime is strict — accepts ONLY
    # ``YYYY-MM-DD``, not the ISO-with-T variants the analytics route
    # tolerates.
    if not start or not end:
        return jsonify({
            "success": False,
            "message": "start and end are required (e.g. start=2026-07-01&end=2026-08-01)",
        }), 400
    for label, value in (("start", start), ("end", end)):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            return jsonify({
                "success": False,
                "message": f"Invalid {label}={value!r}; use YYYY-MM-DD",
            }), 400

    platforms = _csv(request.args.get("platform", ""))
    accounts = _csv(request.args.get("account", ""))

    db = get_database()
    # COALESCE(scheduled_at, created::timestamp) — both fall to the
    # same lexicographic ordering under TIMESTAMP cast, regardless of
    # how PG renders scheduled_at (default `2026-07-08 10:00` vs iso
    # `2026-07-08T10:00`). Index-backed: ``idx_tasks_created`` covers
    # the created-only branch and ``idx_tasks_pending_scheduled`` the
    # scheduled-active branch; planner will pick whichever is
    # selective per query.
    conditions = [
        "COALESCE(scheduled_at, created::timestamp) >= ?::timestamp",
        "COALESCE(scheduled_at, created::timestamp) < ?::timestamp",
    ]
    params: list = [start, end]
    if platforms:
        placeholders = ",".join("?" for _ in platforms)
        conditions.append(f"platform IN ({placeholders})")
        params.extend(platforms)
    if accounts:
        placeholders = ",".join("?" for _ in accounts)
        conditions.append(f"account IN ({placeholders})")
        params.extend(accounts)
    where = " AND ".join(conditions)

    rows = db.fetch_all(
        f"SELECT task_id, platform, account, action, status, "
        f"scheduled_at, created, argv "
        f"FROM tasks WHERE {where} "
        f"ORDER BY COALESCE(scheduled_at, created::timestamp), task_id",
        tuple(params),
    )

    # Aggregation runs in Python on the SQL-fetched set rather than via
    # a second ``GROUP BY`` query. The month-view cap is bounded by
    # whatever the user actually scheduled + executed in one month
    # (typ. <200 rows); the cost is dwarfed by the network round-trip
    # AND keeping the route read-side from any CLOSE/COALESCE dance
    # in SQL. Move to SQL only if a user ever pages through >10k
    # rows — at which point an EXPLAIN ANALYZE on idx_tasks_created
    # becomes the next bottleneck, not this loop.
    by_platform: Counter[str] = Counter()
    by_status: Counter[str] = Counter()
    tasks = []
    for row in rows:
        platform = row.get("platform") or ""
        status = row.get("status") or ""
        account = row.get("account") or ""
        by_platform[platform or "(none)"] += 1
        by_status[status or "(none)"] += 1

        title = _title_from_argv_safe(row.get("argv"), row.get("action", "") or "", row["task_id"])
        scheduled_at = _stringify_timestamp(row.get("scheduled_at"))
        created = row.get("created") or ""
        tasks.append({
            "task_id": row["task_id"],
            "platform": platform,
            "account": account,
            "action": row.get("action"),
            "status": status,
            "title": title,
            "scheduled_at": scheduled_at,
            "created": created,
            "effective_date": _effective_date(scheduled_at, created),
        })
    return jsonify({"success": True, "data": {
        "tasks": tasks,
        "summary": {
            "total": len(tasks),
            "by_platform": dict(by_platform),
            "by_status": dict(by_status),
        },
    }})


def _csv(s: str) -> list[str]:
    """Parse a comma-separated query param into a trimmed, deduped list.

    Empty / missing → ``[]`` so callers can safely do
    ``if platforms: conditions.append(f"platform IN (...)") ...`` —
    the empty list short-circuits the IN clause and keeps the SQL
    simple. No dedup-dict usage: the SQL planner already treats
    ``IN ('a','a')`` as a single match.
    """
    if not s:
        return []
    return [x.strip() for x in s.split(",") if x.strip()]


def _title_from_argv_safe(argv_payload, action: str, task_id: str) -> str:
    """Run the 3-step title-extraction chain on a row's ``argv`` column.

    Mirrors ``web_runner/routes/tasks.py::_title_from_argv`` but
    accepts the pre-fetched ``argv`` payload (JSON string or list
    shape depending on dialect — PG is JSON-string here) so we don't
    duplicate the parser logic.

    Returns ``""`` on empty payload rather than the
    ``<action>#<short>`` fallback — the calendar cell needs the
    short fallback when ``argv`` is missing, but title length
    matters: we want stable, short placeholders. Delegate to the
    existing helper on a parsed list.
    """
    if not argv_payload:
        return ""
    try:
        # PG stores argv as JSON string; ``json.loads`` round-trips.
        # Tasks.py uses a dialect-aware ``db.json_load`` helper that
        # is identity-on-PG so we don't need it here.
        import json
        if isinstance(argv_payload, str):
            argv_list = json.loads(argv_payload)
        else:
            argv_list = argv_payload
        if isinstance(argv_list, list):
            return _title_from_argv([str(v) for v in argv_list], action, task_id)
    except (ValueError, TypeError):
        # Malformed argv blob — fall through to the action-based
        # placeholder via the helper's last-resort branch.
        pass
    return f"{action or 'task'}#{task_id[-6:]}"


def _stringify_timestamp(value) -> str | None:
    """Normalize ``scheduled_at`` to an ISO string (or ``None``).

    ``scheduled_at`` is PG TIMESTAMP, so psycopg returns a
    ``datetime`` object; the JSON serializer needs a string. The
    ``None`` branch handles both NULL rows and legacy text-shaped
    values from a pre-migration DB.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return value.isoformat(timespec="seconds")
    except AttributeError:
        return str(value)


def _effective_date(scheduled_at_iso: str | None, created_iso: str) -> str:
    """Compute the calendar-pin date ``YYYY-MM-DD``.

    Returns the ``scheduled_at`` date if present, otherwise the
    ``created`` date. Both inputs are ISO strings; we slice the
    first 10 chars (the ``YYYY-MM-DD`` prefix). Empty inputs return
    ``""`` so the calendar can skip them in the month-grid render.
    """
    if scheduled_at_iso:
        return scheduled_at_iso[:10]
    return (created_iso or "")[:10]
