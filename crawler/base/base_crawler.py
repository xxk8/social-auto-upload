"""Base crawler contract (vendored from MediaCrawler ``base/base_crawler.py``).

Every platform-specific crawler (:class:`XiaoHongShuCrawler`,
:class:`DouyinCrawler`, etc.) extends :class:`AbstractCrawler` and
implements three methods:

    * :meth:`search`     — platform's search-by-keyword API/playwright flow
    * :meth:`detail`     — fetch a single post's full content + metadata
    * :meth:`comments`   — recursively walk a post's comment tree

The base class wires every method to the shared :class:`SauliteStore`
so a successful fetch persists results to PostgreSQL via
:func:`web_runner.db.get_database`. Real Playwright-driven
:attr:`platform_id` -> ``search``/``detail``/``comments`` flows live
in the per-platform ``core.py`` (vendored in this round, real browser
driver in a follow-up PR — Tasks 5.1–5.4 / 4.4 defer the actual
Playwright codepaths).

Honest scaffold commit: this round's per-platform ``core.py``
files declare the contract and emit a "not implemented" log line,
returning empty rows. The infrastructure (route, CLI, schema, AI
hookpoints) is fully wired so an operator / power-user can drop in
real Playwright selector chains without touching anything outside
``crawler/platforms/<x>/core.py``.

Why a vendored abstract class instead of inheriting the upstream
MediaCrawler one?
    * Upstream's ``AbstractCrawler`` constructors expect a
      :class:`store.LocalStorage` instance whose interface is
      tightly coupled to JSON-on-disk. Our :class:`SauliteStore` is
      PG-backed and shares its API with ``web_runner/db.py`` helpers.
      Vendor + override is cheaper than monkey-patching at runtime.
    * Upstream's class also reaches into ``constant`` / ``var`` import
      hooks that would drag in MediaCrawler's global config —
      putting it behind our own base class lets us control exactly
      what each platform module sees.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from crawler.store.saulite_store import SauliteStore

_module_logger = logging.getLogger(__name__)


class AbstractCrawler(ABC):
    """Shared base for every MediaCrawler-style platform crawler.

    Subclasses MUST define :attr:`platform_id`. The three abstract
    methods are the contract; everything else (logging, persistence)
    is provided here so per-platform code stays short.
    """

    #: Short, lowercase platform key (e.g. ``"xhs"``). Used as the
    #: primary lookup into :data:`crawler.PLATFORM_REGISTRY` and as
    #: the ``platform`` column value in ``crawled_content`` /
    #: ``crawled_comments``.
    platform_id: str = ""

    def __init__(self, *, store: SauliteStore | None = None,
                 headless: bool = True,
                 proxy_url: str | None = None) -> None:
        # Lazy store initialization — defer ``get_database()`` until
        # first persist call so importing a crawler module does NOT
        # pull a TCP connection into the host process at import-time
        # (matches the existing ``web_runner/health_monitor.py`` /
        # ``web_runner/notifications.py`` discipline).
        if store is None:
            store = SauliteStore()
        self._store = store
        self._headless = headless
        self._proxy_url = proxy_url

    @staticmethod
    def _not_implemented_log(op: str, **ctx: Any) -> None:
        """Single source of truth for the "scaffold" warning.

        Per-platform ``core.py`` invokes this on every unimplemented
        abstract method so an operator running the CLI / API sees a
        consistent ``[crawler] <op> not yet implemented`` log line.
        """
        kv = " ".join(f"{k}={v!r}" for k, v in ctx.items())
        _module_logger.warning(
            "[crawler] %s not yet implemented (%s); returning empty rows",
            op,
            kv or "no-ctx",
        )

    @abstractmethod
    def search(self, keyword: str, *,
               max_count: int = 20,
               page_num: int = 1) -> list[dict[str, Any]]:
        """Search by keyword; return a list of raw post-row dicts."""

    def search_stream(self, keyword: str, *,
                      max_count: int = 20,
                      page_num: int = 1) -> Any:
        """Stream search results one row at a time.

        Default implementation delegates to :meth:`search` and yields
        each row. Subclasses can override this to yield rows as they
        are scraped for true incremental streaming.
        """
        yield from self.search(keyword, max_count=max_count, page_num=page_num)

    @abstractmethod
    def detail(self, post_id: str) -> dict[str, Any] | None:
        """Return one post's full content + metadata, or ``None``."""

    @abstractmethod
    def comments(self, post_id: str, *,
                 max_count: int = 100) -> list[dict[str, Any]]:
        """Return a flat list of comments (and 2nd-level replies) for one post."""

    # ── Persistence helpers (provided so subclasses don't re-wire
    # the SauliteStore call everywhere). They forward to the store,
    # which is the only place that knows the SQL + JSONB layout.
    def _persist_content(self, raw_payload: dict[str, Any]) -> int:
        """Insert a row into ``crawled_content``. Returns row id."""
        # Normalize the dict so every platform's payload lands in the
        # same column shape (``raw_payload JSONB``, plus the
        # ``platform`` + ``post_id`` extracted from the payload if
        # present). The store does the JSONB encoding.
        post_id = raw_payload.get("post_id") or raw_payload.get("id") or raw_payload.get("note_id")
        return self._store.store_content(
            platform=self.platform_id,
            post_id=str(post_id) if post_id else "",
            raw_payload=raw_payload,
        )

    def _persist_comment(self, raw_payload: dict[str, Any]) -> int:
        """Insert a row into ``crawled_comments`` (with AI hooks)."""
        post_id = raw_payload.get("post_id") or raw_payload.get("note_id") or raw_payload.get("content_id")
        return self._store.store_comment(
            platform=self.platform_id,
            post_id=str(post_id) if post_id else "",
            raw_payload=raw_payload,
        )
