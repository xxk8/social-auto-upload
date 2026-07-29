"""External CLI task worker — claims pending rows from PostgreSQL.

Run alongside the web process when ``SAU_TASK_MODE=worker``:

    # terminal A — HTTP only (no local CLI execution)
    SAU_TASK_MODE=worker python run.py

    # terminal B — one or more workers (horizontal scale)
    python -m web_runner.worker
    # or: sau-worker

Workers use ``FOR UPDATE SKIP LOCKED`` so multiple processes can share
the same pending queue without double-running a task.

Env:
  SAU_WORKER_POLL      sleep seconds when idle (default 1.0)
  SAU_WORKER_ID        optional label for logs
  SAU_TASK_TIMEOUT     CLI timeout seconds (shared with inline runner)
"""
from __future__ import annotations

import json
import os
import signal
import sys
import time
from datetime import datetime
from typing import Any

# Load .env / pool via db module
import web_runner.db  # noqa: F401
from web_runner.db import get_connection, init_db
from utils.log import logger as _logger


_STOP = False


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def claim_next_task() -> dict[str, Any] | None:
    """Atomically claim one runnable task (pending or due scheduled)."""
    now = datetime.now().isoformat(timespec="seconds")
    # CTE + UPDATE … RETURNING is one statement so our connection wrapper
    # keeps it in a single transaction before context-manager commit.
    sql = """
        WITH cte AS (
            SELECT task_id
            FROM tasks
            WHERE (
                status = 'pending'
                OR (
                    status = 'scheduled'
                    AND scheduled_at IS NOT NULL
                    AND scheduled_at != ''
                    AND scheduled_at <= %s
                )
            )
            AND (
                scheduled_at IS NULL
                OR scheduled_at = ''
                OR scheduled_at <= %s
            )
            ORDER BY COALESCE(NULLIF(scheduled_at, ''), created) ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE tasks AS t
        SET status = 'running'
        FROM cte
        WHERE t.task_id = cte.task_id
        RETURNING t.task_id, t.argv, t.platform, t.action, t.account
    """
    # Our placeholder rewriter expects `?` — use those.
    sql_q = sql.replace("%s", "?")
    with get_connection() as conn:
        rows = conn.execute(sql_q, (now, now)).fetchall()
        if not rows:
            return None
        row = rows[0]
        return dict(row) if not isinstance(row, dict) else row


def _parse_argv(raw: Any) -> list[str] | None:
    if not raw:
        return None
    if isinstance(raw, list):
        return [str(x) for x in raw]
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x) for x in data]
    except (json.JSONDecodeError, TypeError):
        return None
    return None


def process_one() -> bool:
    """Claim and run one task. Returns True if work was done."""
    from web_runner.utils import _db_update_task, _run_sau, log

    claimed = claim_next_task()
    if not claimed:
        return False
    task_id = claimed.get("task_id")
    argv = _parse_argv(claimed.get("argv"))
    if not task_id:
        return False
    if not argv:
        _db_update_task(
            str(task_id),
            status="error",
            error="Worker: missing argv on claimed task",
        )
        log(f"[{task_id}] worker skip: no argv")
        return True
    worker_id = os.environ.get("SAU_WORKER_ID", "").strip() or str(os.getpid())
    log(f"[{task_id}] worker={worker_id} claimed ({claimed.get('platform')}/{claimed.get('action')})")
    # _run_sau sets status running again (harmless) and streams logs.
    _run_sau(str(task_id), argv)
    return True


def main(argv: list[str] | None = None) -> int:
    global _STOP
    _ = argv
    poll = max(0.2, _env_float("SAU_WORKER_POLL", 1.0))
    worker_id = os.environ.get("SAU_WORKER_ID", "").strip() or str(os.getpid())

    def _handle_stop(signum: int, frame: Any) -> None:  # noqa: ARG001
        global _STOP
        _STOP = True
        _logger.info(f"[worker:{worker_id}] signal {signum} — shutting down")

    signal.signal(signal.SIGINT, _handle_stop)
    signal.signal(signal.SIGTERM, _handle_stop)

    init_db()
    _logger.info(
        f"[worker:{worker_id}] started (poll={poll}s). "
        "Set SAU_TASK_MODE=worker on the web process."
    )

    idle_spins = 0
    while not _STOP:
        try:
            worked = process_one()
        except Exception as exc:  # strict-exceptions: allow
            _logger.exception(f"[worker:{worker_id}] claim/run error: {exc}")
            worked = False
        if worked:
            idle_spins = 0
            continue
        idle_spins += 1
        # Mild backoff when the queue is empty.
        time.sleep(min(poll * (1 + idle_spins // 10), poll * 5))

    _logger.info(f"[worker:{worker_id}] exit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
