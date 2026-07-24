"""Storage layer for crawled content (PG-backed, replaces MediaCrawler's JSON/SQLite)."""
from __future__ import annotations

from crawler.store.saulite_store import SauliteStore

__all__ = ["SauliteStore"]
