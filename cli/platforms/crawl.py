"""CLI handlers for ``sau crawl <action>``.

Three subcommands per the change's acceptance criteria:

    * :func:`search`    — ``sau crawl search --platform xhs --keywords ...``
    * :func:`detail`    — ``sau crawl detail --platform dy --post-ids ...``
    * :func:`comments`  — ``sau crawl comments --platform bili --post-ids ...``

Each handler enqueues a crawl task and either polls for the result
inline (default) or returns the freshly created task_id (``--detach``)
so the user can plug in their own polling loop. The poll loop uses
the existing ``web_runner.db.get_database()`` connection directly —
this avoids an HTTP roundtrip to ``/api/crawl/status`` from a CLI
process that probably lives on the same host as the Postgres.
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any

from utils.log import logger as _cli_logger


def _enqueue_crawl(*, platform: str, action: str, params: dict[str, Any]) -> str:
    """Wrapper around :func:`crawler.create_crawl_task` that swallows
    the ``DATABASE_URL``-unset error and re-raises with a clearer
    operator-facing message.

    The bare :func:`crawler.create_crawl_task` raises ``RuntimeError``
    on a missing ``DATABASE_URL`` — this is the right behavior for
    the Web API (a 500 response with the message) but in CLI output
    it's noise. This wrapper prints a one-liner + a hint about how
    to set the env var, then sys.exits(1).
    """
    try:
        from crawler import create_crawl_task

        return create_crawl_task(
            user_id=None,
            platform=platform,
            action=action,
            params=params,
        )
    except RuntimeError as exc:
        msg = str(exc)
        if "DATABASE_URL" in msg:
            print(
                "[crawler] DATABASE_URL env var is not set; can't enqueue "
                "the crawl task. Set it (e.g. export "
                "DATABASE_URL=postgres://user:pass@host:5432/sau) and retry.",
                file=sys.stderr,
            )
            sys.exit(1)
        raise


def _poll_task(task_id: str, *, timeout: float = 30.0, interval: float = 1.0) -> dict[str, Any]:
    """Poll the ``tasks`` table for the crawl row to leave ``'pending'``.

    Returns the final row dict. Times out after ``timeout`` seconds
    and returns the last-seen row (which may still be ``pending``).
    """
    from web_runner.db import get_database

    db = get_database()
    deadline = time.monotonic() + timeout
    last_row: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        row = db.fetch_one(
            "SELECT task_id, status, code, error, result "
            "FROM tasks WHERE task_id = ?",
            (task_id,),
        )
        if row is None:
            time.sleep(interval)
            continue
        last_row = row
        if row.get("status") not in ("pending", "running"):
            return row
        time.sleep(interval)
    return last_row or {"status": "unknown", "task_id": task_id}


async def search(
    *,
    platform: str,
    keywords: list[str] | str,
    max_count: int = 20,
    page_num: int = 1,
    detach: bool = False,
    poll_timeout: float = 30.0,
) -> int:
    """Enqueue a search crawl. Returns shell exit code (0/1).

    ``keywords`` may be either a single string (``"a,b,c"``) or a list
    (``["a", "b", "c"]``). Each keyword produces a separate crawl
    task so a flaky platform doesn't take down the others.

    With ``detach=False`` (default), the CLI polls until completion
    (or ``poll_timeout``). With ``detach=True`` the CLI prints the
    created ``task_id`` and exits 0 — the operator can plug in
    their own polling loop (``watch -n 2 'sau crawl status ...'``).
    """
    if isinstance(keywords, str):
        keywords = [kw.strip() for kw in keywords.split(",") if kw.strip()]
    if not keywords:
        print("[crawler] no keywords provided; nothing to do.", file=sys.stderr)
        return 1

    task_ids: list[str] = []
    for kw in keywords:
        task_id = _enqueue_crawl(
            platform=platform,
            action="search",
            params={
                "keyword": kw,
                "max_count": int(max_count),
                "page_num": int(page_num),
            },
        )
        task_ids.append(task_id)
        print(f"[crawler] enqueued search {platform} kw={kw!r} -> task_id={task_id}")

    if detach:
        return 0

    print(f"[crawler] polling {len(task_ids)} task(s)…")
    rc = 0
    for task_id in task_ids:
        row = _poll_task(task_id, timeout=poll_timeout)
        status = row.get("status", "?")
        if status in ("failed", "error", "exception"):
            rc = 1
            print(
                f"[crawler] task_id={task_id} FAILED (status={status}, "
                f"error={row.get('error')!r})",
                file=sys.stderr,
            )
        else:
            print(f"[crawler] task_id={task_id} status={status}")
    return rc


async def detail(
    *,
    platform: str,
    post_ids: list[str] | str,
    detach: bool = False,
    poll_timeout: float = 30.0,
) -> int:
    """Enqueue a per-post detail fetch."""
    if isinstance(post_ids, str):
        post_ids = [pid.strip() for pid in post_ids.split(",") if pid.strip()]
    if not post_ids:
        print("[crawler] no post_ids provided; nothing to do.", file=sys.stderr)
        return 1

    task_ids: list[str] = []
    for pid in post_ids:
        task_id = _enqueue_crawl(
            platform=platform,
            action="detail",
            params={"post_id": pid},
        )
        task_ids.append(task_id)
        print(f"[crawler] enqueued detail {platform} post_id={pid!r} -> task_id={task_id}")

    if detach:
        return 0

    print(f"[crawler] polling {len(task_ids)} task(s)…")
    rc = 0
    for task_id in task_ids:
        row = _poll_task(task_id, timeout=poll_timeout)
        status = row.get("status", "?")
        if status in ("failed", "error", "exception"):
            rc = 1
            print(
                f"[crawler] task_id={task_id} FAILED (status={status}, "
                f"error={row.get('error')!r})",
                file=sys.stderr,
            )
        else:
            print(f"[crawler] task_id={task_id} status={status}")
    return rc


async def comments(
    *,
    platform: str,
    post_ids: list[str] | str,
    max_count: int = 100,
    detach: bool = False,
    poll_timeout: float = 60.0,
) -> int:
    """Enqueue a per-post comments fetch.

    Default ``poll_timeout=60`` is longer than search/detail because
    comment trees are typically much larger than single posts and
    the platform's API may rate-limit slower.
    """
    if isinstance(post_ids, str):
        post_ids = [pid.strip() for pid in post_ids.split(",") if pid.strip()]
    if not post_ids:
        print("[crawler] no post_ids provided; nothing to do.", file=sys.stderr)
        return 1

    task_ids: list[str] = []
    for pid in post_ids:
        task_id = _enqueue_crawl(
            platform=platform,
            action="comments",
            params={
                "post_id": pid,
                "max_count": int(max_count),
            },
        )
        task_ids.append(task_id)
        print(f"[crawler] enqueued comments {platform} post_id={pid!r} -> task_id={task_id}")

    if detach:
        return 0

    print(f"[crawler] polling {len(task_ids)} task(s)…")
    rc = 0
    for task_id in task_ids:
        row = _poll_task(task_id, timeout=poll_timeout)
        status = row.get("status", "?")
        if status in ("failed", "error", "exception"):
            rc = 1
            print(
                f"[crawler] task_id={task_id} FAILED (status={status}, "
                f"error={row.get('error')!r})",
                file=sys.stderr,
            )
        else:
            print(f"[crawler] task_id={task_id} status={status}")
    return rc
