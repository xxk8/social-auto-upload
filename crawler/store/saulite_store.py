"""PostgreSQL-backed store for crawled content (``SauliteStore``).

Replaces MediaCrawler's original :class:`store.LocalStorage` (writes
JSON files to disk) and the optional :class:`store.DBStore` (writes
to SQLite). All persistence flows through
:func:`web_runner.db.get_database` so crawler data lands in the same
PostgreSQL instance the rest of ``social-auto-upload`` uses.

Schema contract (added to ``web_runner/db.py::_init_db_postgres`` by
Tasks 5.1 + 5.2):

    ``crawled_content`` columns:
        id, platform, post_id, raw_payload JSONB, crawled_at TIMESTAMP

    ``crawled_comments`` columns:
        id, platform, post_id, raw_payload JSONB, ai_sentiment TEXT,
        ai_sentiment_confidence REAL, ai_reply_suggestion TEXT,
        crawled_at TIMESTAMP

Why JSONB for ``raw_payload`` rather than 7 per-platform tables or a
wide :class:`crawled_content_with_<x>_columns` table:
    * Each platform's row schema is so different that a wide table
      would have ~80% NULLable columns. JSONB pays the same storage
      cost and lets an operator add a NEW platform (say, xiaohongshu
      adds a new field) without an ``ALTER TABLE`` migration.
    * Forward-compat: even pre-existing JSON keys are queryable via
      PG's containment operators (``raw_payload @> '{...}'``), so a
      power user can run ``SELECT ... WHERE raw_payload @>
      '{"verified": true}'`` without schema writes.

AI hooks (Tasks 9 + 10 of tasks.md):
    :meth:`store_comment` triggers a background :class:`threading.Thread`
    that calls :func:`crawler.ai.sentiment.analyze_sentiment` and
    :func:`crawler.ai.reply.generate_reply_suggestion` and then
    :sql:`UPDATE crawled_comments SET ai_sentiment=?, ...`. Comments
    are stored "immediately visible, AI-augmented later" so the route
    can return ``GET /api/crawl/data?platform=...`` with rows that
    are either blank or annotated — never stuck on a slow LLM round
    trip. The threading model matches the existing notification
    worker (``web_runner/notifications.py::start_worker``).
"""
from __future__ import annotations

import atexit
import concurrent.futures
import json
import logging
from datetime import datetime, timezone
from typing import Any

# Reuse the project's logging setup so crawler-side log lines land
# in the same ``.sau-logs/`` directory the rest of the app writes to.
from utils.log import logger as _shared_logger

_module_logger = logging.getLogger(__name__)

# Round-MC-2024-threadpool (13.5): module-level ThreadPoolExecutor
# replaces the per-comment ``threading.Thread`` spawn. max_workers=8
# keeps concurrency bounded even when a high-volume crawl dumps
# 500 comments at once — previously each comment launched a bare
# daemon thread, risking O(500) simultaneous LLM calls + DB pool
# exhaustion.
#
# atexit.shutdown(wait=False) avoids a 2-second block on interpreter
# exit (the LLM HTTP calls are disruptive to shut down cleanly).
_AI_EXECUTOR: concurrent.futures.ThreadPoolExecutor = (
    concurrent.futures.ThreadPoolExecutor(
        max_workers=8,
        thread_name_prefix="crawler-ai",
    )
)


def _shutdown_executor() -> None:
    """atexit handler — don't block on in-flight LLM calls."""
    _AI_EXECUTOR.shutdown(wait=False)


atexit.register(_shutdown_executor)


class SauliteStore:
    """PG-backed persistence facade for crawler results.

    Thread-safety: psycopg's ``ConnectionPool`` is thread-safe and the
    ``store_content`` / ``store_comment`` calls are stateless wrappers
    around ``db.execute`` — no instance-level locks required. The
    AI-augmentation thread spawned by :meth:`store_comment` is
    short-lived (one LLM round trip per comment) and uses its own
    pool borrow, so concurrent calls don't collide.
    """

    #: How many comments to batch in one LLM call. Bigger = fewer
    #: HTTP round trips; smaller = more responsive UI feedback.
    #: The sentiment function (Tasks 9) accepts a list of strings
    #: and returns a parallel list of classifications; passing a
    #: single-item list per ``store_comment`` call is wasteful, so
    #: the store keeps a small in-memory queue flushed on a timer.
    #: For now, the implementation is one-LLM-call-per-comment to
    #: keep the surface simple — operators can tune this later.
    SENTIMENT_BATCH_SIZE = 1

    def __init__(self) -> None:
        # No eager connection — ``store_content`` / ``store_comment``
        # borrow from the pool on each call. Mirrors the rest of the
        # codebase's lazy-DB discipline.
        pass

    # ── crawled_content ────────────────────────────────────────────
    def store_content(
        self,
        *,
        platform: str,
        post_id: str,
        raw_payload: dict[str, Any],
    ) -> int:
        """Insert a row into ``crawled_content`` and return its id.

        ``raw_payload`` is JSONB-encoded by psycopg automatically (no
        need for ``json.dumps`` here — psycopg's parameter binding
        maps Python ``dict`` to JSONB when the column type is JSONB).
        Empty ``post_id`` rows are kept (so a failed detail() call's
        placeholder still gets logged) — the unique index
        ``idx_crawled_content_post`` is a regular (non-unique) btree
        so duplicate inserts are tolerated during retry storms.
        """
        from web_runner.db import get_database

        db = get_database()
        created = datetime.now(timezone.utc).isoformat()
        # psycopg's parameter binding does NOT auto-adapt Python dicts
        # to JSONB when using ``?`` placeholders (translated to %s).
        # Serialize explicitly so the JSONB column receives a valid
        # JSON string regardless of caller shape.
        payload_json = json.dumps(raw_payload) if isinstance(raw_payload, dict) else raw_payload
        # Use ``insert_returning_id`` rather than ``db.execute(...)``
        # so the actual row id is returned verbatim, not the rowcount.
        # ``db.execute`` returns ``cur.rowcount`` (always 1 for a
        # successful INSERT) which would silently lie about the id
        # if a caller passed the value through. ``insert_returning_id``
        # reads the id directly from psycopg's RETURNING result.
        new_id = db.insert_returning_id(
            "INSERT INTO crawled_content "
            "(platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            (platform, post_id, payload_json, created),
        )
        return int(new_id)

    # ── crawled_comments (with async AI hooks) ─────────────────────
    def store_comment(
        self,
        *,
        platform: str,
        post_id: str,
        raw_payload: dict[str, Any],
    ) -> int:
        """Insert a row into ``crawled_comments``, then fire async AI hook.

        Returns the inserted row id.

        The AI work runs in a daemon :class:`threading.Thread` so the
        ``store_comment`` call always returns inside a few ms — the
        HTTP request handler that called ``store_comment`` doesn't
        pay the LLM round trip. The thread captures the ``post_id``
        and the raw comment text so when sentiment+reply come back,
        it can issue a single ``UPDATE`` to fill the
        ``ai_sentiment`` / ``ai_sentiment_confidence`` /
        ``ai_reply_suggestion`` columns.

        Failure mode: if the AI call raises (OpenRouter 500, invalid
        key, timeout, etc.) the thread logs and exits — the comment
        row stays in the table with the AI columns at their default
        (NULL / 0.0 / NULL). Retry is operator-driven: a follow-up
        task can issue ``UPDATE crawled_comments SET ai_sentiment=(
        SELECT ... analyze_sentiment(raw_payload->>'text') ...)``
        for the NULL rows.

        Cache discipline (Task 9.5 mention): ``raw_payload->>'text'``
        is the canonical text key for ``crawled_comments``. Two
        identical comments (same text + same platform) would produce
        two separate rows — we DON'T deduplicate because the
        upstream ``post_id`` pairs with the comment to give a unique
        (post, comment) tuple in real crawl data.
        """
        from web_runner.db import get_database

        db = get_database()
        created = datetime.now(timezone.utc).isoformat()
        # See store_content: explicit JSON serialization for JSONB.
        payload_json = json.dumps(raw_payload) if isinstance(raw_payload, dict) else raw_payload
        new_id = db.insert_returning_id(
            "INSERT INTO crawled_comments "
            "(platform, post_id, raw_payload, crawled_at) "
            "VALUES (?, ?, ?, ?)",
            (platform, post_id, payload_json, created),
        )

        # Round-MC-2024-threadpool (13.5): submit to the bounded
        # ThreadPoolExecutor instead of spawning a bare daemon thread.
        # The executor handles daemon semantics internally (worker
        # threads are daemon=True) and caps concurrency at
        # ``max_workers=8`` so a 500-comment crawl doesn't launch
        # 500 simultaneous LLM calls.
        try:
            comment_text = (
                raw_payload.get("text")
                or raw_payload.get("content")
                or raw_payload.get("comment")
                or ""
            )
            if comment_text:
                _AI_EXECUTOR.submit(
                    _augment_comment_with_ai,
                    new_id,
                    platform,
                    post_id,
                    comment_text,
                )
        except Exception as exc:  # pragma: no cover — defensive
            _module_logger.warning(
                "[crawler] failed to submit AI augmentation task: %s",
                type(exc).__name__,
            )
            _shared_logger.warning(
                "[crawler] failed to submit AI augmentation task: %s",
                type(exc).__name__,
            )

        return new_id

    # ── Read helpers (used by Web API + CLI) ────────────────────────
    def list_content(
        self,
        *,
        platform: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Return rows from ``crawled_content`` (optionally filtered).

        ``limit`` is server-side (no full-table scans); ``platform``
        filter uses the partial covering index ``idx_crawled_content_platform``.
        """
        from web_runner.db import get_database

        db = get_database()
        if platform:
            rows = db.fetch_all(
                "SELECT id, platform, post_id, raw_payload, crawled_at "
                "FROM crawled_content WHERE platform = ? "
                "ORDER BY crawled_at DESC LIMIT ?",
                (platform, int(limit)),
            )
        else:
            rows = db.fetch_all(
                "SELECT id, platform, post_id, raw_payload, crawled_at "
                "FROM crawled_content "
                "ORDER BY crawled_at DESC LIMIT ?",
                (int(limit),),
            )
        # psycopg's dict_row already decoded JSONB to dict — return
        # the row dicts unchanged.
        return list(rows) if rows else []

    def list_comments(
        self,
        *,
        platform: str | None = None,
        post_id: str | None = None,
        sentiment: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Return rows from ``crawled_comments`` with optional filters."""
        from web_runner.db import get_database

        db = get_database()
        # Build WHERE clause from optional filters. The triple-filter
        # combination is rare (operator-driven drill-down) so building
        # the SQL with placeholders is fine; the query-plan cache
        # amortizes across calls.
        conditions: list[str] = []
        params: list[Any] = []
        if platform:
            conditions.append("platform = ?")
            params.append(platform)
        if post_id:
            conditions.append("post_id = ?")
            params.append(post_id)
        if sentiment:
            conditions.append("ai_sentiment = ?")
            params.append(sentiment)
        params.append(int(limit))
        where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        sql = (
            f"SELECT id, platform, post_id, raw_payload, "
            f"ai_sentiment, ai_sentiment_confidence, ai_reply_suggestion, "
            f"crawled_at "
            f"FROM crawled_comments {where_sql} "
            f"ORDER BY crawled_at DESC LIMIT ?"
        )
        rows = db.fetch_all(sql, tuple(params))
        return list(rows) if rows else []

    def count_by_sentiment(self, *, platform: str | None = None) -> dict[str, int]:
        """Return counts ``{'positive': N, 'negative': N, 'neutral': N, 'pending': N}``.

        ``pending`` = rows where ``ai_sentiment IS NULL`` (AI
        augmentation in flight or failed). Used by Frontend's
        sentiment summary card.
        """
        from web_runner.db import get_database

        db = get_database()
        where_clause = "WHERE platform = ?" if platform else ""
        params: tuple = (platform,) if platform else ()
        rows = db.fetch_all(
            f"SELECT "
            f"  COALESCE(ai_sentiment, 'pending') AS bucket, "
            f"  COUNT(*) AS n "
            f"FROM crawled_comments {where_clause} "
            f"GROUP BY COALESCE(ai_sentiment, 'pending')",
            params,
        )
        buckets = {"positive": 0, "negative": 0, "neutral": 0, "pending": 0}
        for row in rows or []:
            b = row.get("bucket")
            n = row.get("n", 0)
            if b in buckets:
                buckets[b] = int(n)
        return buckets


def _augment_comment_with_ai(
    comment_id: int,
    platform: str,
    post_id: str,
    comment_text: str,
) -> None:
    """Module-private thread target — runs sentiment + reply suggestion.

    Imports :mod:`crawler.ai.sentiment` + :mod:`crawler.ai.reply`
    INSIDE the function to dodge an import-time cycle
    (the AI modules import the same store; lazy import breaks it).
    All exceptions are swallowed and logged — a flaky LLM call must
    never propagate to a daemon thread and crash the parent process.
    """
    try:
        from crawler.ai.sentiment import analyze_sentiment
        from crawler.ai.reply import generate_reply_suggestion
        from web_runner.db import get_database

        sentiment_label, confidence = analyze_sentiment(comment_text)
        reply_text = generate_reply_suggestion(
            comment_text=comment_text,
            platform=platform,
            post_id=post_id,
        )
        db = get_database()
        db.execute(
            "UPDATE crawled_comments "
            "SET ai_sentiment = ?, ai_sentiment_confidence = ?, ai_reply_suggestion = ? "
            "WHERE id = ?",
            (sentiment_label, float(confidence), reply_text, comment_id),
        )
    except Exception as exc:  # pragma: no cover — defensive
        _module_logger.warning(
            "[crawler] AI augmentation for comment_id=%s failed: %s: %s",
            comment_id,
            type(exc).__name__,
            exc,
        )
