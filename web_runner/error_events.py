"""Structured error event logging for web_runner."""
from __future__ import annotations

import json
import traceback
from datetime import datetime

from web_runner.db import db_lock, get_connection

LOG_MAX_ROWS = 10_000
_error_event_trim_counter = 0
_MAX_TRACEBACK_CHARS = 8000


def _log_error_event(
    phase: str,
    platform: str = "",
    account: str = "",
    action: str = "",
    task_id: str | None = None,
    exc: BaseException | None = None,
    exc_type: str = "",
    exc_message: str = "",
    tb: str | None = None,
    argv: list[str] | None = None,
    attempt_no: int | None = None,
    retry_count: int | None = None,
    status_code: int | None = None,
) -> None:
    global _error_event_trim_counter
    now = datetime.now().isoformat(timespec="seconds")
    if exc is not None and not exc_type:
        exc_type = type(exc).__name__
    if exc is not None and not exc_message:
        exc_message = str(exc)
    # Synthetic NonZeroExit rows (CLI non-zero) prefix the message with the exit code.
    if (
        status_code is not None
        and exc_type == "NonZeroExit"
        and exc_message
        and not exc_message.startswith(f"exit code {status_code}")
    ):
        exc_message = f"exit code {status_code} {exc_message}"
    if tb is None and exc is not None:
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    if tb is None:
        tb = ""
    if tb and len(tb) > _MAX_TRACEBACK_CHARS:
        # Keep the head + a clear marker + the tail so the root raise is preserved.
        head = tb[: _MAX_TRACEBACK_CHARS // 2]
        tail = tb[-(_MAX_TRACEBACK_CHARS // 2) :]
        tb = f"{head}\n... [truncated] ...\n{tail}"
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                """INSERT INTO error_events
                   (ts, task_id, level, phase, platform, account, action,
                    exc_type, exc_message, traceback, argv, attempt_no, retry_count, status_code)
                   VALUES (?, ?, 'error', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    now,
                    task_id,
                    phase,
                    platform,
                    account,
                    action,
                    exc_type,
                    exc_message,
                    tb,
                    json.dumps(argv) if argv else None,
                    attempt_no,
                    retry_count,
                    status_code,
                ),
            )
            conn.commit()
            _error_event_trim_counter += 1
            if _error_event_trim_counter >= 100:
                _error_event_trim_counter = 0
                conn.execute(
                    "DELETE FROM error_events WHERE id NOT IN "
                    "(SELECT id FROM error_events ORDER BY ts DESC LIMIT ?)",
                    (LOG_MAX_ROWS,),
                )
                conn.commit()


def _db_get_error_events(
    after: str | None = None,
    platform: str | None = None,
    account: str | None = None,
    action: str | None = None,
    exc_type: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict]:
    import sqlite3

    with db_lock:
        with get_connection() as conn:
            conn.row_factory = sqlite3.Row
            query = "SELECT * FROM error_events"
            conditions: list[str] = []
            params: list = []
            if after:
                conditions.append("ts > ?")
                params.append(after)
            if platform:
                conditions.append("platform = ?")
                params.append(platform)
            if account:
                conditions.append("account = ?")
                params.append(account)
            if action:
                conditions.append("action = ?")
                params.append(action)
            if exc_type:
                conditions.append("exc_type = ?")
                params.append(exc_type)
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            query += " ORDER BY ts DESC"
            if limit is not None:
                query += " LIMIT ?"
                params.append(limit)
            if offset:
                query += " OFFSET ?"
                params.append(offset)
            rows = conn.execute(query, params).fetchall()
            return [dict(r) for r in rows]
