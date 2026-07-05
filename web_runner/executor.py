"""Priority-based task executor with per-platform concurrency limits.

Replaces the fixed ThreadPoolExecutor(8) with:
- PriorityQueue for task ordering (scheduled < normal < retry)
- Per-platform semaphores to prevent rate-limit violations
- Supervisor thread that loads due scheduled tasks from DB on startup
- Persistent scheduled tasks (survive restarts via DB scheduled_at column)
"""
from __future__ import annotations

import os
import queue
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

from utils.log import logger as _task_logger

# ── Per-platform concurrency configuration ──────────────────────────

_DEFAULT_PLATFORM_CONCURRENCY: dict[str, int] = {
    "douyin": 2,
    "kuaishou": 2,
    "xiaohongshu": 2,
    "bilibili": 3,
    "tencent": 2,
    "tiktok": 2,
    "baijiahao": 2,
}


def _load_platform_concurrency() -> dict[str, int]:
    """Load per-platform concurrency limits from env or defaults."""
    limits = dict(_DEFAULT_PLATFORM_CONCURRENCY)
    for platform in limits:
        env_key = f"SAU_CONCURRENT_{platform.upper()}"
        val = os.environ.get(env_key)
        if val:
            try:
                limits[platform] = max(1, int(val))
            except ValueError:
                pass
    return limits


# ── Priority levels ─────────────────────────────────────────────────

PRIORITY_SCHEDULED = 0  # Lowest — execute at their scheduled time
PRIORITY_NORMAL = 1     # Default
PRIORITY_RETRY = 2      # Highest — user explicitly requested retry


class _PrioritizedTask:
    """Wrapper for tasks in the priority queue."""

    __slots__ = ("priority", "seq", "fn", "args", "platform", "task_id")

    def __init__(
        self,
        priority: int,
        seq: int,
        fn: Callable,
        args: tuple,
        platform: str = "",
        task_id: str = "",
    ):
        self.priority = priority
        self.seq = seq  # FIFO tiebreaker
        self.fn = fn
        self.args = args
        self.platform = platform
        self.task_id = task_id

    def __lt__(self, other: _PrioritizedTask) -> bool:
        if self.priority != other.priority:
            return self.priority < other.priority
        return self.seq < other.seq


class PlatformExecutor:
    """Priority-based executor with per-platform concurrency control."""

    def __init__(self) -> None:
        self._queue: queue.PriorityQueue[_PrioritizedTask] = queue.PriorityQueue()
        self._platform_limits = _load_platform_concurrency()
        self._platform_semaphores: dict[str, threading.Semaphore] = {}
        self._seq_counter = 0
        self._seq_lock = threading.Lock()
        self._shutdown = False

        # Create per-platform semaphores
        for platform, limit in self._platform_limits.items():
            self._platform_semaphores[platform] = threading.Semaphore(limit)
        # Default semaphore for unknown platforms
        self._default_semaphore = threading.Semaphore(2)

        # Worker pool — max_workers is sum of all platform limits
        total_workers = sum(self._platform_limits.values())
        self._pool = ThreadPoolExecutor(
            max_workers=total_workers,
            thread_name_prefix="sau-platform",
        )

        # Supervisor thread
        self._supervisor = threading.Thread(
            target=self._supervisor_loop,
            name="sau-supervisor",
            daemon=True,
        )
        self._supervisor.start()

        _task_logger.info(
            f"[executor] initialized with {total_workers} workers, "
            f"platform limits: {self._platform_limits}"
        )

    def _next_seq(self) -> int:
        with self._seq_lock:
            self._seq_counter += 1
            return self._seq_counter

    def _get_semaphore(self, platform: str) -> threading.Semaphore:
        return self._platform_semaphores.get(platform, self._default_semaphore)

    def submit(
        self,
        fn: Callable,
        *args: Any,
        priority: int = PRIORITY_NORMAL,
        platform: str = "",
        task_id: str = "",
    ) -> None:
        """Submit a task to the priority queue.

        The supervisor will dispatch it when a worker is available
        for the given platform.
        """
        task = _PrioritizedTask(
            priority=priority,
            seq=self._next_seq(),
            fn=fn,
            args=args,
            platform=platform,
            task_id=task_id,
        )
        self._queue.put(task)

    def _execute_with_semaphore(self, task: _PrioritizedTask) -> None:
        """Acquire platform semaphore, run task, release."""
        sem = self._get_semaphore(task.platform)
        sem.acquire()
        try:
            task.fn(*task.args)
        finally:
            sem.release()

    def _supervisor_loop(self) -> None:
        """Main supervisor loop: polls queue and dispatches tasks."""
        while not self._shutdown:
            try:
                task = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            self._pool.submit(self._execute_with_semaphore, task)

    def load_scheduled_tasks(self) -> None:
        """Load due scheduled tasks from DB into the queue.

        Called on startup to restore tasks that were scheduled before
        a restart.
        """
        try:
            from web_runner.db import get_database
            from web_runner.utils import _run_sau

            db = get_database()
            now = datetime.now().isoformat(timespec="seconds")
            rows = db.fetch_all(
                "SELECT task_id, argv FROM tasks "
                "WHERE status = 'pending' AND scheduled_at IS NOT NULL "
                "AND scheduled_at <= ?",
                (now,),
            )
            count = 0
            for row in rows:
                task_id = row["task_id"]
                argv_raw = row.get("argv")
                if isinstance(argv_raw, str):
                    import json
                    try:
                        argv = json.loads(argv_raw)
                    except (json.JSONDecodeError, TypeError):
                        argv = []
                elif isinstance(argv_raw, list):
                    argv = argv_raw
                else:
                    argv = []

                # Extract platform from argv for semaphore
                platform = ""
                for i, arg in enumerate(argv):
                    if i == 0 and not arg.startswith("-"):
                        platform = arg
                        break

                self.submit(
                    _run_sau, task_id, argv,
                    priority=PRIORITY_NORMAL,
                    platform=platform,
                    task_id=task_id,
                )
                count += 1

            if count:
                _task_logger.info(f"[executor] loaded {count} due scheduled tasks from DB")
        except Exception as exc:
            _task_logger.warning(f"[executor] failed to load scheduled tasks: {exc}")

    def shutdown(self, wait: bool = True) -> None:
        """Shutdown the executor."""
        self._shutdown = True
        self._pool.shutdown(wait=wait)


# ── Singleton ───────────────────────────────────────────────────────

_executor: PlatformExecutor | None = None
_executor_lock = threading.Lock()


def get_executor() -> PlatformExecutor:
    """Get or create the singleton PlatformExecutor."""
    global _executor
    if _executor is not None:
        return _executor
    with _executor_lock:
        if _executor is not None:
            return _executor
        _executor = PlatformExecutor()
        _executor.load_scheduled_tasks()
        return _executor


def submit_task(
    fn: Callable,
    *args: Any,
    priority: int = PRIORITY_NORMAL,
    platform: str = "",
    task_id: str = "",
) -> None:
    """Submit a task using the global executor."""
    get_executor().submit(fn, *args, priority=priority, platform=platform, task_id=task_id)


# ── Inbox slot semaphore ────────────────────────────────────────────
# ponytail: tiny, sync, Postgres-style. Bound the number of concurrent
# /api/inbox/download + /api/inbox/transcribe requests, because each one
# can stall a Flask thread-pool worker for ~60-180s (Chromium launch +
# yt-dlp subprocess + OpenAI Whisper upload). Without this gate, two
# runaway download requests can starve every other /api/* endpoint that
# shares the same WSGI threadpool. Default 2 matches the per-platform
# caps above; override via SAU_INBOX_MAX_CONCURRENT.
_INBOX_DEFAULT_LIMIT = 2


def _init_inbox_semaphore() -> threading.BoundedSemaphore:
    try:
        limit = max(1, int(os.environ.get(
            "SAU_INBOX_MAX_CONCURRENT", str(_INBOX_DEFAULT_LIMIT))))
    except ValueError:
        limit = _INBOX_DEFAULT_LIMIT
    return threading.BoundedSemaphore(limit)


# Module-level singleton: env read at import time. Tests replace it
# via `monkeypatch.setattr(web_runner.executor, "_inbox_sem", ...)`.
_inbox_sem: threading.BoundedSemaphore = _init_inbox_semaphore()


def acquire_inbox_slot() -> bool:
    """Non-blocking slot acquire. Returns False when saturated — caller
    should respond 429 and NOT do any engine work."""
    return _inbox_sem.acquire(blocking=False)


def release_inbox_slot() -> None:
    """Release a previously-acquired slot. BoundedSemaphore will raise
    if called without a matching acquire — agent of catching double-release
    bugs in route code."""
    _inbox_sem.release()
