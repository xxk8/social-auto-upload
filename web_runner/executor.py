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


# Crawler-side concurrency (openspec/changes/mediacrawler-integration).
# Defaults are intentionally LOWER than the publish defaults because
# the crawl path triggers OpenRouter LLM calls (one daemon thread per
# comment — see web_runner/store/saulite_store.py) AND most platforms
# rate-limit aggressively. xhs/dy/ks get the most-restrictive 1 /
# worker cap; bili/wb/tieba/zhihu get 2 because their public APIs
# tolerate more concurrent sessions. Operators tune each platform via
# ``SAU_CRAWLER_CONCURRENT_<PLATFORM>`` env var (e.g. xhs → XHS).
#
# Note: we keep short platform keys here (matching MediaCrawler's
# ``platform_id`` field on AbstractCrawler) but ALSO map the
# publish-side long aliases (xiaohongshu → xhs, douyin → dy, etc.)
# so a cron-launched crawl task can use either form interchangeably.
_DEFAULT_CRAWLER_PLATFORM_CONCURRENCY: dict[str, int] = {
    "xhs": 1,
    "dy": 1,
    "ks": 1,
    "bili": 2,
    "wb": 2,
    "tieba": 2,
    "zhihu": 2,
    # Long-form aliases (publish-side naming) inherit the short-form
    # caps so a cron task that wrote ``xiaohongshu`` matches the
    # same gate as ``xhs``.
    "xiaohongshu": 1,
    "douyin": 1,
    "kuaishou": 1,
    "bilibili": 2,
    "weibo": 2,
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


def _load_crawler_platform_concurrency() -> dict[str, int]:
    """Load per-platform crawler concurrency limits from env or defaults.

    Env-var key is ``SAU_CRAWLER_CONCURRENT_<PLATFORM>`` — e.g.
    ``SAU_CRAWLER_CONCURRENT_XHS=2`` lifts the xhs cap from 1 → 2.
    The long-form aliases (``XIAOHONGSHU``, ``DOUYIN``) ALSO work
    for operators who prefer the publish-side naming.
    """
    limits = dict(_DEFAULT_CRAWLER_PLATFORM_CONCURRENCY)
    for platform in list(limits):
        env_key = f"SAU_CRAWLER_CONCURRENT_{platform.upper()}"
        val = os.environ.get(env_key)
        if val:
            try:
                limits[platform] = max(1, int(val))
            except ValueError:
                pass
    return limits


# ── Priority levels ─────────────────────────────────────────────────

PRIORITY_SCHEDULED = 0  # Lowest — execute at their scheduled time
PRIORITY_NORMAL = 1  # Default
PRIORITY_RETRY = 2  # Highest — user explicitly requested retry


class _PrioritizedTask:
    """Wrapper for tasks in the priority queue.

    The ``pool`` field (added in the mediacrawler-integration round)
    is a string discriminator that the supervisor loop uses to
    route this task to either :attr:`PlatformExecutor._publish_pool`
    or :attr:`PlatformExecutor._crawl_pool`. Two pools (instead
    of one shared pool) prevent the starvation pitfall flagged by
    the architectural review: a burst of 14 publish tasks would
    otherwise block all crawler tasks even when the crawler
    semaphore is fully free.

    Allowed pool values: ``"publish"`` (default — backward-compat
    with every existing caller before mediacrawler-integration)
    and ``"crawl"`` (set by :meth:`load_pending_tasks` when
    reconstructing a crawler row).
    """

    __slots__ = ("priority", "seq", "fn", "args", "platform", "task_id", "pool")

    def __init__(
        self,
        priority: int,
        seq: int,
        fn: Callable,
        args: tuple,
        platform: str = "",
        task_id: str = "",
        pool: str = "publish",
    ):
        self.priority = priority
        self.seq = seq  # FIFO tiebreaker
        self.fn = fn
        self.args = args
        self.platform = platform
        self.task_id = task_id
        self.pool = pool
        if pool not in ("publish", "crawl"):
            # Defensive: a future caller typo shouldn't silently
            # route to the publish pool. The supervisor loop falls
            # back to publish if the value is missing; an UNKNOWN
            # value here is a bug.
            raise ValueError(
                f"_PrioritizedTask.pool must be 'publish' or 'crawl'; got {pool!r}"
            )

    def __lt__(self, other: _PrioritizedTask) -> bool:
        if self.priority != other.priority:
            return self.priority < other.priority
        return self.seq < other.seq


class PlatformExecutor:
    """Priority-based executor with per-platform concurrency control."""

    def __init__(self) -> None:
        self._queue: queue.PriorityQueue[_PrioritizedTask] = queue.PriorityQueue()
        self._platform_limits = _load_platform_concurrency()
        self._crawler_platform_limits = _load_crawler_platform_concurrency()
        self._platform_semaphores: dict[str, threading.Semaphore] = {}
        self._crawler_platform_semaphores: dict[str, threading.Semaphore] = {}
        self._seq_counter = 0
        self._seq_lock = threading.Lock()
        self._shutdown = False

        # Create PUBLISH-side per-platform semaphores (pre-existing)
        for platform, limit in self._platform_limits.items():
            self._platform_semaphores[platform] = threading.Semaphore(limit)
        # Default publish-side semaphore for unknown platforms
        self._default_semaphore = threading.Semaphore(2)

        # CRAWLER-side per-platform semaphores (mediacrawler-integration).
        # The crawl default (1 worker) is intentionally tighter than
        # publish's default (2) because each crawl task can spawn
        # PER-COMMENT daemon threads via ``saulite_store.store_comment``
        # AND each comment AI call is an OpenRouter HTTP round trip.
        # Aliases share their short-form keys' Semaphore instance —
        # e.g. ``xhs`` and ``xiaohongshu`` resolve to the SAME lock
        # so an operator mixing naming forms doesn't double the
        # effective concurrency for the same physical platform.
        for platform, limit in self._crawler_platform_limits.items():
            if platform in self._crawler_platform_semaphores:
                # Skip aliases that we already bound to a short-form
                # Semaphore instance below. Reverse pass fills in
                # the long-form keys pointing at the same lock.
                continue
            self._crawler_platform_semaphores[platform] = threading.Semaphore(limit)
        for short, long in (
            ("xhs", "xiaohongshu"),
            ("dy", "douyin"),
            ("ks", "kuaishou"),
            ("bili", "bilibili"),
            ("wb", "weibo"),
        ):
            short_sem = self._crawler_platform_semaphores.get(short)
            if short_sem is not None and long in self._crawler_platform_limits:
                self._crawler_platform_semaphores[long] = short_sem
        # Crawler default semaphore for unknown platforms — conservative 1
        # because ``PlatformExecutor`` can't reason about whether an
        # unknown platform is LLM-heavy or rate-limited.
        self._crawler_default_semaphore = threading.Semaphore(1)

        # TWO thread pools (added in mediacrawler-integration round).
        # Why split: with ONE shared pool, a burst of 14 publish tasks
        # would each hold one of the 14 workers while waiting on
        # publish-side semaphores, leaving zero free workers for ANY
        # crawler task. Splitting prevents cross-domain starvation so
        # a long publish backlog doesn't delay crawls (and vice versa).
        # Pool sizing: sum of the publish-side semaphore caps for
        # the publish pool; sum of UNIQUE short-form caps for the
        # crawl pool (because aliases map to the SAME Semaphore —
        # counting them twice would double-count).
        publish_total_workers = sum(self._platform_limits.values())
        self._publish_pool = ThreadPoolExecutor(
            max_workers=publish_total_workers,
            thread_name_prefix="sau-publish",
        )
        short_form_crawl_workers = sum(
            limit
            for platform, limit in self._crawler_platform_limits.items()
            # Only count the short-form keys; long-form aliases are
            # just additional dict entries pointing at the same lock.
            if platform in ("xhs", "dy", "ks", "bili", "wb", "tieba", "zhihu")
        )
        self._crawl_pool = ThreadPoolExecutor(
            max_workers=max(1, short_form_crawl_workers),
            thread_name_prefix="sau-crawl",
        )

        # Back-compat alias so any pre-existing caller that still
        # references ``self._pool`` (e.g. a follow-up test that
        # references the historical pool) keeps working. Default
        # to the publish pool. Caller MUST explicitly pass ``pool``
        # to :meth:`submit` to route to crawl.
        self._pool = self._publish_pool

        # Supervisor thread
        self._supervisor = threading.Thread(
            target=self._supervisor_loop,
            name="sau-supervisor",
            daemon=True,
        )
        self._supervisor.start()

        _task_logger.info(
            f"[executor] initialized: publish pool={publish_total_workers} workers, "
            f"crawl pool={max(1, short_form_crawl_workers)} workers, "
            f"publish platform limits={self._platform_limits}, "
            f"crawl platform limits={self._crawler_platform_limits}"
        )

    def _next_seq(self) -> int:
        with self._seq_lock:
            self._seq_counter += 1
            return self._seq_counter

    def _get_semaphore(self, platform: str) -> threading.Semaphore:
        return self._platform_semaphores.get(platform, self._default_semaphore)

    def _get_crawler_semaphore(self, platform: str) -> threading.Semaphore:
        """Look up the per-platform crawler semaphore (capped tighter than publish).

        Alias-resolved: ``xiaohongshu`` shares the same lock instance
        as ``xhs`` (set up in :meth:`__init__`), so an operator
        mixing naming forms still counts toward a single cap.
        Unknown platforms fall back to :attr:`_crawler_default_semaphore`
        (size 1).
        """
        return self._crawler_platform_semaphores.get(
            platform, self._crawler_default_semaphore
        )

    def submit(
        self,
        fn: Callable,
        *args: Any,
        priority: int = PRIORITY_NORMAL,
        platform: str = "",
        task_id: str = "",
        pool: str = "publish",
    ) -> None:
        """Submit a task to the priority queue.

        ``pool`` is one of ``"publish"`` (default — pre-existing
        callers, backward-compat) or ``"crawl"`` (mediacrawler-integration).
        The supervisor loop routes :attr:`_PrioritizedTask.pool`
        to either :attr:`_publish_pool` or :attr:`_crawl_pool`, so
        a saturated publish pool does NOT block a crawl task (and
        vice versa). Field validation happens in
        ``_PrioritizedTask.__init__`` so a bad string raises loudly
        rather than silently mis-routing.
        """
        task = _PrioritizedTask(
            priority=priority,
            seq=self._next_seq(),
            fn=fn,
            args=args,
            platform=platform,
            task_id=task_id,
            pool=pool,
        )
        self._queue.put(task)

    def _execute_with_semaphore(self, task: _PrioritizedTask) -> None:
        """Acquire the proper domain's platform semaphore, run task, release.

        Pool-aware dispatch: a ``task.pool == "crawl"`` task uses
        :meth:`_get_crawler_semaphore` (tighter cap, alias-aware).
        A publish task uses the original :meth:`_get_semaphore`.
        Each domain has its own dedicated thread pool so a
        saturated publish backlog cannot hold all workers hostage
        and starve the crawl lane (thinker pitfall A).
        """
        if task.pool == "crawl":
            sem = self._get_crawler_semaphore(task.platform)
        else:
            sem = self._get_semaphore(task.platform)
        sem.acquire()
        try:
            task.fn(*task.args)
        finally:
            sem.release()

    def _supervisor_loop(self) -> None:
        """Main supervisor loop: polls queue and dispatches tasks.

        Routes each task to the right :class:`ThreadPoolExecutor`
        based on :attr:`_PrioritizedTask.pool`. The two pools are
        size-bounded independently (publish: ``sum(publish limits)``;
        crawl: ``sum(unique short-form caps)``), so a burst of
        publish tasks cannot starve the crawl lane or vice versa.
        """
        while not self._shutdown:
            try:
                task = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            target_pool = (
                self._crawl_pool if task.pool == "crawl" else self._publish_pool
            )
            target_pool.submit(self._execute_with_semaphore, task)

    def load_pending_tasks(self) -> None:
        """Recover pending + scheduled tasks from DB on startup
        (round-OPT-async-202 + mediacrawler-integration).

        Three classes of work to re-queue:

        1. **Unscheduled pending tasks** — the user submitted an
           ``/api/upload/*`` or ``/api/tasks/add`` and got a 202 back,
           but the server crashed/restarted before the in-process
           executor picked the task off the priority queue. The row
           sits in ``status='pending'`` with ``scheduled_at IS NULL``.
           The prior ``load_scheduled_tasks`` query ignored these,
           effectively losing the work on restart. Round-OPT-async-202
           fixes that gap.

        2. **Due scheduled tasks** — any ``status='pending'`` row
           whose ``scheduled_at <= now`` (in-flight scheduling
           window).

        3. **Due scheduled tasks in ``status='scheduled'``** — the
           pre-existing gap surfaced by this round: ``reschedule``
           and ``copy`` set ``status='scheduled'``, and a server
           restart loses the in-memory ``threading.Timer`` for those
           tasks. The orphan watchdog only handles ``running``, so
           without the ``status='scheduled'`` half of the WHERE
           clause a scheduled task past its time would sit forever.
           This round adds it to the recovery query.

        All three classes are submitted with ``priority=PRIORITY_NORMAL``,
        NOT ``PRIORITY_RETRY``. A restart-recovered task is a
        continuation of the original (the user did NOT explicitly
        ask for it to be retried), so giving it the RETRY priority
        would unfairly starve a real user-initiated retry. Future
        reviewer: do NOT "fix" this to ``PRIORITY_RETRY``.

        Re-submission is idempotent at the DB level (a single
        ``task_id`` row can only be running in one subprocess at a
        time; the executor's per-platform semaphore serializes the
        pool). The CLI subprocess itself is the atomic boundary —
        on completion it overwrites ``status`` to
        ``success``/``failed``/``error`` regardless of how many
        times we enqueued it.

        Mediacrawler-integration dispatch (round-MC-2024):
        The ``argv`` shape distinguishes publish tasks
        (``list[str]`` — CLI subprocess args) from crawl tasks
        (``dict`` — JSON-encoded payload from
        :func:`crawler.create_crawl_task`). The MUST-HAVE argv-dict
        trap is fixed here: pre-existing code walked ``argv`` with
        ``enumerate(argv)`` to find the platform at index 0. If
        ``argv`` was a dict (for a crawl row), this would pick the
        FIRST DICT KEY (``"kind"``) as the platform and dispatch
        to the publish pool with a bogus semaphore key. The fix
        below inspects the type and routes accordingly:

            * ``dict`` → ``_run_crawl`` + crawler semantics + pool
              ``"crawl"`` + platform from dict.
            * ``list`` → ``_run_sau`` + publish semantics + pool
              ``"publish"`` + platform from argv[0].

        Both dispatchers update the task row's status / result /
        error columns when they finish, so a re-dispatch of the
        same ``task_id`` is idempotent at the row level (the
        update overwrites whatever the previous lifecycle wrote).
        """
        try:
            import json as _json
            from web_runner.db import get_database
            from web_runner.utils import _run_crawl, _run_sau

            db = get_database()
            now = datetime.now().isoformat(timespec="seconds")
            # Also SELECT ``action`` so a publish task with a
            # pre-canonical argv shape (legacy migration-in-flight)
            # is reliably distinguishable from a crawl task even
            # if argv was NULL or malformed at write time.
            rows = db.fetch_all(
                "SELECT task_id, argv, action FROM tasks "
                "WHERE status IN ('pending', 'scheduled') "
                "AND (scheduled_at IS NULL OR scheduled_at <= ?)",
                (now,),
            )
            count_publish = 0
            count_crawl = 0
            for row in rows:
                task_id = row["task_id"]
                action_raw = (row.get("action") or "")
                argv_raw = row.get("argv")

                # Decode argv string → dict/list payload.
                argv: list | dict | None = None
                if isinstance(argv_raw, str):
                    try:
                        argv = _json.loads(argv_raw)
                    except (_json.JSONDecodeError, TypeError, ValueError):
                        argv = None
                elif isinstance(argv_raw, (dict, list)):
                    argv = argv_raw
                # Note: ``argv`` may be None when the row was written
                # by a legacy path or never had argv populated.

                # ── Branch by argv shape + action prefix ────────────────────
                # MUST-HAVE: argv type detection blocks the publish pool
                # from receiving a crawl payload (which would have set
                # platform="kind", the first dict key).
                is_crawl = (
                    isinstance(argv, dict)
                    and argv.get("kind") == "crawl"
                ) or (
                    # Backup signal for malformed argv: fall back to
                    # the ``tasks.action`` column which records the
                    # dispatch verb (``crawl_search`` /
                    # ``crawl_detail`` / ``crawl_comments``).
                    isinstance(action_raw, str)
                    and action_raw.startswith("crawl_")
                )

                if is_crawl:
                    platform = ""
                    if isinstance(argv, dict):
                        platform = (argv.get("platform") or "").strip()
                    # Pass the ORIGINAL raw argv so _run_crawl can
                    # JSON-decode it again (defends against predecoded
                    # dict paths the dispatcher might not see).
                    self.submit(
                        _run_crawl,
                        task_id,
                        argv_raw,
                        priority=PRIORITY_NORMAL,
                        platform=platform,
                        task_id=task_id,
                        pool="crawl",
                    )
                    count_crawl += 1
                else:
                    # Publish path. argv is the legacy CLI list;
                    # extract platform from argv[0] (pre-existing pattern).
                    platform = ""
                    if isinstance(argv, list) and argv and not str(argv[0]).startswith("-"):
                        platform = str(argv[0])
                    self.submit(
                        _run_sau,
                        task_id,
                        argv if isinstance(argv, list) else [],
                        priority=PRIORITY_NORMAL,
                        platform=platform,
                        task_id=task_id,
                        pool="publish",
                    )
                    count_publish += 1

            if count_publish or count_crawl:
                _task_logger.info(
                    f"[executor] recovered {count_publish} publish + "
                    f"{count_crawl} crawl task(s) from DB on startup"
                )
        except Exception as exc:
            _task_logger.warning(f"[executor] failed to recover pending tasks: {exc}")

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
        # Renamed in round-OPT-async-202: the loader now picks up
        # ALL pending tasks (unscheduled + due-scheduled), not just
        # the scheduled slice. See ``PlatformExecutor.load_pending_tasks``
        # docstring for the full rationale.
        _executor.load_pending_tasks()
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
        limit = max(1, int(os.environ.get("SAU_INBOX_MAX_CONCURRENT", str(_INBOX_DEFAULT_LIMIT))))
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
