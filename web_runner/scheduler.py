"""Task scheduling helpers for web_runner."""
from __future__ import annotations

import threading
from datetime import datetime

_scheduled_timers: dict[str, threading.Timer] = {}
_timer_lock = threading.Lock()


def _normalise_schedule(schedule: str | None) -> str | None:
    if not schedule:
        return None
    return schedule.replace("T", " ").strip()


def _schedule_task(task_id: str, argv: list[str], schedule_time: datetime) -> None:
    # Delayed imports avoid circular import with web_runner.utils
    from web_runner.utils import (
        _db_update_task,
        _run_sau,
        log,
        task_executor,
        worker_mode_enabled,
    )

    delay = (schedule_time - datetime.now()).total_seconds()
    if delay <= 0:
        # Past (or now) schedule → run immediately; flip status back to pending
        # so the task is treated as a normal runnable job (not left "scheduled").
        _db_update_task(task_id, status="pending")
        task_executor.submit(_run_sau, task_id, argv)
        return

    # External worker mode: persist schedule on the row and let workers claim
    # when scheduled_at is due — no in-process Timer (does not survive restarts).
    if worker_mode_enabled():
        log(
            f"[{task_id}] scheduled for {schedule_time.isoformat()} "
            f"(external worker; in {delay:.0f}s)"
        )
        return

    log(f"[{task_id}] scheduled for {schedule_time.isoformat()} (in {delay:.0f}s)")
    timer = threading.Timer(delay, lambda: task_executor.submit(_run_sau, task_id, argv))
    timer.daemon = True
    with _timer_lock:
        _scheduled_timers[task_id] = timer
    timer.start()
