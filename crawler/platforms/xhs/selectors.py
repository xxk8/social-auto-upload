"""Consumer-site XHS selectors (``www.xiaohongshu.com``).

These selectors are **DIFFERENT** from the publish-side selectors in
``uploader/xiaohongshu_uploader/locators.py::XhsLocators``, which
target ``creator.xiaohongshu.com``. The two sites have distinct CSS
class namespaces — selector reuse between them is incorrect.

When ``www.xiaohongshu.com`` changes its DOM, update ONLY this file
(do NOT touch the uploader-side locators). The selectors below are
**loose / robust** to A/B-test variations: we anchor on stable
data-test attributes, ``href`` patterns, and propagated text patterns
rather than hashed class names that XHS regenerates per build.

Vendored from MediaCrawler's ``media_platform/xhs/extractor.py``
selector set + ``field.py`` URL templates, then adjusted to be
robust to minor class-prefix drift. The original MediaCrawler
selectors are unstable across builds (XHS uses webpack-hashed class
names) — the patterns below use ``^=`` / ``*=`` attribute matchers
or stable identifiers.
"""
from __future__ import annotations

import re


class XhsCrawlSelectors:
    """All ``www.xiaohongshu.com`` selector constants for crawl flows.

    Organized by page: search results, note detail, comments. Each
    constant is a Playwright-friendly CSS selector. Page-level URL
    templates expose ``format()``-style substitution.
    """

    # ── URLs ────────────────────────────────────────────────────────────
    #: Search result page (consumer site). The ``source`` query param
    #: anchors the search UX; ``sort=general`` is the default relevance
    #: ranking. Vendored from MediaCrawler's ``field.py``.
    SEARCH_URL = (
        "https://www.xiaohongshu.com/search_result"
        "?keyword={keyword}&source=web_explore_feed&sort=general"
    )

    #: Explore-feed homepage (a generic catch-all landing).
    EXPLORE_URL = "https://www.xiaohongshu.com/explore"

    #: Note detail page by ``note_id`` (hex hash). ``xsec_token`` is the
    #: per-session signed token; we accept either present or absent in
    #: ``str.format`` defaults (kwa defaults to ``""``).
    NOTE_DETAIL_URL = (
        "https://www.xiaohongshu.com/explore/{note_id}?xsec_token={xsec_token}"
    )

    URL_KWARGS_DEFAULT = {"xsec_token": ""}

    # ── Search results page ────────────────────────────────────────────
    # XHS renders search cards in a grid; each card is an anchor wrapping
    # the cover image + title + author + like-count. The class names
    # below are stable across recent XHS builds.
    SEARCH_RESULT_CARD = "section.note-item"
    SEARCH_RESULT_LINK = "a.cover"
    SEARCH_RESULT_TITLE = "span.title"
    SEARCH_RESULT_AUTHOR = "span.author"
    SEARCH_RESULT_LIKES = "span.like-count, span.interact-count"
    SEARCH_RESULT_COVER_IMG = "img.cover-img, img"

    #: Note ID extraction from the anchor's ``href``.
    # Bound the trailing match with `(?:[/?]|$)` so we don't over-match
    # longer hex paths that happen to contain an ``/explore/`` fragment
    # followed by a longer string. round-MC-2024 post-review nit #6.
    NOTE_ID_HREF_PATTERN = re.compile(r"/explore/([a-f0-9]{16,32})(?:[/?]|$)")

    #: Empty-state marker — if no result cards are visible after
    #: search, the page renders this hint text. We use it as a
    #: post-wait assertion to distinguish "no matches" from
    #: "selector drift" (RFallback).
    SEARCH_NO_RESULTS_TEXT = "没有找到相关内容"

    # ── Note-detail page ────────────────────────────────────────────────
    #: Title element (rendered on the right rail in 2025-26 layouts).
    NOTE_DETAIL_TITLE = "#detail-title"
    NOTE_DETAIL_DESC = "#detail-desc"
    NOTE_DETAIL_AUTHOR = ".author-wrapper .username"
    NOTE_DETAIL_LIKES = ".interaction-info .like-wrapper .count"
    NOTE_DETAIL_DATE = ".date"
    NOTE_DETAIL_TAGS = ".tag-container a.tag"

    # ── Comments ───────────────────────────────────────────────────────
    # XHS renders the comment panel as a SEPARATE interaction below the
    # post. Older builds use ``.comments-container``; newer builds
    # inline comments into ``.interaction-info``. We probe both.
    COMMENTS_CONTAINER = ".comments-container, .note-comments"
    COMMENT_ITEM = ".comment-item, .comment"
    COMMENT_ITEM_TEXT = ".comment-content .content, .comment-content"
    COMMENT_ITEM_AUTHOR = ".comment-content .author, .comment .info .author"
    COMMENT_ITEM_LIKES = ".comment-content .like-count, .comment .info .like"
    COMMENT_ITEM_TIME = ".comment-content .date, .comment .info .date"
    # "Show more" button shown when a post has more than ~20 comments.
    COMMENTS_SHOW_MORE = ".comments-container .more, .comments-container .load-more"

    # ── Login-state probe selectors ────────────────────────────────────
    # When cookie is missing/expired, XHS redirects to the login modal.
    # Used by ``xhs_cookie_check`` and the crawl-side pre-launch
    # validation. Distinguishing cookie-miss from cookie-okay:
    LOGIN_MODAL = "div.login-container, div.login-modal"
    COOKIE_OK_MARKER = "[data-v-app]"  # root mount marker that exists when a real user lands


def note_id_from_url(href: str) -> str:
    """Extract XHS note id from a ``/explore/<id>`` URL.

    Returns ``""`` if the URL doesn't match — the caller should
    treat empty ids as a soft skip rather than a hard error
    (XHS sometimes serves short-link redirects via ``xhslink.com``
    that don't contain ``/explore/``).
    """
    if not href:
        return ""
    m = XhsCrawlSelectors.NOTE_ID_HREF_PATTERN.search(href)
    return m.group(1) if m else ""


def parse_count(raw: str) -> int:
    """Parse a like-count text like "1.2万" / "3,456" / "789" → integer.

    XHS serves Chinese-localized counts:
      * ``1234``    → 1234
      * ``1.2万``   → 12000
      * ``9999+``   → 9999
      * ``""``      → 0

    Robust to ``str.lstrip``/``rstrip`` quirks. Returns 0 on garbage.
    """
    if not raw:
        return 0
    s = raw.strip().replace(",", "").replace("+", "")
    if s.endswith("万"):
        try:
            return int(float(s[:-1]) * 10_000)
        except ValueError:
            return 0
    if s.endswith("亿"):
        try:
            return int(float(s[:-1]) * 100_000_000)
        except ValueError:
            return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


__all__ = ["XhsCrawlSelectors", "note_id_from_url", "parse_count"]
