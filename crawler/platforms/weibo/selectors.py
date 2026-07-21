"""Weibo (微博) consumer-site selectors (``weibo.com`` + ``s.weibo.com``).

These selectors are designed for the two pages the crawler touches:

    * **Search** (``s.weibo.com/weibo?q=...``): a server-rendered search
      result page with cards. Weibo's search uses relatively stable
      class names (``card-wrap``, ``info``, ``name``, etc.).
    * **Detail + Comments** (``weibo.com/{uid}/{mid}``): the main
      weibo.com React SPA. Class names here are hashed, so we use
      loose ``[class*='...']`` attribute selectors.

Note on IDs:
    Weibo status IDs are alphanumeric strings (e.g. ``5049871234567890``).
    The ``mid_from_url`` helper extracts the mid from
    ``/weibo.com/{uid}/{mid}`` and ``/detail/{mid}`` URLs.

Note on login:
    Weibo has NO dedicated uploader in this project (``uploader/weibo_uploader``
    was never built). The login module implements a standalone QR-code
    login flow via ``passport.weibo.com``.
    See :file:`crawler/platforms/weibo/login.py`.
"""
from __future__ import annotations

import re


class WeiboCrawlSelectors:
    """All Weibo selector constants for crawl flows.

    Organized by page: search results, content detail, comments. Each
    constant is a Playwright-friendly CSS selector. Page-level URL
    templates expose ``format()``-style substitution.
    """

    # ── URLs ────────────────────────────────────────────────────────────
    #: Search result page on ``s.weibo.com``.
    SEARCH_URL = "https://s.weibo.com/weibo?q={keyword}&typeall=1"

    #: Status detail page on ``weibo.com``. ``uid`` is the user ID,
    #: ``mid`` is the status/weibo ID.
    STATUS_DETAIL_URL = "https://weibo.com/{uid}/{mid}"

    # ── Search results page (s.weibo.com) ───────────────────────────────
    SEARCH_RESULT_CARD = (
        "[class*='card-wrap'], "
        "[class*='CardWrap'], "
        "[class*='card']:not([class*='other']):not([class*='head'])"
    )
    SEARCH_RESULT_LINK = (
        "a[href*='/detail/'], "
        "a[href*='weibo.com/']"
    )
    SEARCH_RESULT_TITLE = (
        "[class*='title'], "
        "[class*='Title'], "
        "[class*='text']"
    )
    SEARCH_RESULT_AUTHOR = (
        "[class*='name'], "
        "[class*='username'], "
        "[class*='author']"
    )
    SEARCH_RESULT_REPLY_COUNT = (
        "[class*='reply'], "
        "[class*='comment'], "
        "[class*='act']"
    )
    SEARCH_RESULT_LIKE_COUNT = (
        "[class*='like'], "
        "[class*='digg'], "
        "[class*='star']"
    )

    #: Post ID extraction from s.weibo.com search cards.
    #: Format: ``/detail/5049871234567890`` or ``weibo.com/uid/504987...``
    MID_HREF_PATTERN = re.compile(
        r"/(?:detail|weibo\.com/\w+)/([a-zA-Z0-9]+)"
    )

    # ── Status detail page (weibo.com) ──────────────────────────────────
    # Weibo.com is a React SPA with hashed class names.
    STATUS_TEXT = (
        "[class*='content'], "
        "[class*='text'], "
        "[class*='WB_text'], "
        "[class*='weibo-text']"
    )
    STATUS_AUTHOR = (
        "[class*='username'], "
        "[class*='name'], "
        "[class*='author'], "
        "[class*='S_func1']"
    )
    STATUS_PUBLISH_TIME = (
        "[class*='time'], "
        "[class*='date'], "
        "[class*='WB_time']"
    )
    STATUS_LIKE_COUNT = (
        "[class*='like'], "
        "[class*='digg'], "
        "[class*='praised'], "
        "[class*='woo-like']"
    )
    STATUS_REPOST_COUNT = (
        "[class*='repost'], "
        "[class*='forward'], "
        "[class*='retweet']"
    )
    STATUS_COMMENT_COUNT = (
        "[class*='comment'], "
        "[class*='reply'], "
        "[class*='woo-comment']"
    )

    # ── Comments section ────────────────────────────────────────────────
    COMMENTS_CONTAINER = (
        "[class*='comment-list'], "
        "[class*='CommentList'], "
        "[class*='list_li'], "
        "[class*='feed_list']"
    )
    COMMENT_ITEM = (
        "[class*='list_li'], "
        "[class*='comment-item'], "
        "[class*='CommentItem'], "
        "[class*='WB_feed']"
    )
    COMMENT_ITEM_TEXT = (
        "[class*='comment-text'], "
        "[class*='CommentText'], "
        "[class*='text'], "
        "[class*='WB_text']"
    )
    COMMENT_ITEM_AUTHOR = (
        "[class*='comment-author'], "
        "[class*='CommentAuthor'], "
        "[class*='name'], "
        "[class*='username']"
    )
    COMMENT_ITEM_LIKES = (
        "[class*='comment-like'], "
        "[class*='like'], "
        "[class*='praised'], "
        "[class*='digg']"
    )
    # "Load more" buttons
    COMMENTS_SHOW_MORE = (
        "[class*='more'], "
        "[class*='load-more'], "
        "[class*='loadmore'], "
        "a[action-type='click_more_comment']"
    )

    # ── Login-state probe selectors ────────────────────────────────────
    LOGIN_BUTTON = (
        "a[href*='passport.weibo.com'], "
        "a[href*='login'], "
        "[node-type='login']"
    )
    LOGGED_IN_MARKER = (
        "[class*='user-info'], "
        "[class*='userInfo'], "
        "[class*='avatar']"
    )


def mid_from_url(href: str) -> str:
    """Extract Weibo status mid from a URL.

    Handles both:
      * ``/detail/5049871234567890`` (s.weibo.com search)
      * ``https://weibo.com/{uid}/5049871234567890`` (detail page)

    Returns ``""`` if the URL doesn't match.
    """
    if not href:
        return ""
    m = WeiboCrawlSelectors.MID_HREF_PATTERN.search(href)
    return m.group(1) if m else ""


def parse_count(raw: str) -> int:
    """Parse a Weibo count text like ``1.2万`` / ``3,456`` / ``789`` → integer.

    Weibo serves Chinese-localized counts:
      * ``1234``    → 1234
      * ``1.2万``   → 12000
      * ``9999+``   → 9999
      * ``--``      → 0 (no-data placeholder)
      * ``""``      → 0

    Returns 0 on garbage.
    """
    if not raw:
        return 0
    s = raw.strip().replace(",", "").replace("+", "")
    if s == "--":
        return 0
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
    if s.endswith("w"):
        try:
            return int(float(s[:-1]) * 10_000)
        except ValueError:
            return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


__all__ = [
    "WeiboCrawlSelectors",
    "mid_from_url",
    "parse_count",
]
