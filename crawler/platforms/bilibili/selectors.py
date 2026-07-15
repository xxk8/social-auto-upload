"""Bilibili (B站) consumer-site selectors (``search.bilibili.com`` + ``www.bilibili.com``).

These selectors are **DIFFERENT** from the publish-side selectors in
``uploader/bilibili_uploader/locators.py::BilibiliLocators``, which target
``member.bilibili.com`` / ``passport.bilibili.com``. The three sites have
distinct DOM structures — selector reuse between them is incorrect.

When Bilibili's consumer frontend changes its DOM, update ONLY this file
(do NOT touch the uploader-side locators). The selectors below are
**loose / robust** to A/B-test variations: we anchor on stable attribute
selectors (``[class*='...']``, ``href`` patterns) and text content rather
than hashed class names.

Bilibili consumer-site structure:

    * **Search** (``search.bilibili.com/all?keyword=...``): renders a grid of
      video result cards. Each card has a thumbnail, title, UP主 name, play
      count, and a link to ``/video/BV...``.
    * **Video detail** (``www.bilibili.com/video/{bv_id}``): video player with
      title, UP主 info, action buttons (like/coin/collect/share), and a
      comment section loaded dynamically below the fold.

Note on cookie format:
    Bilibili uploader stores cookies in biliup format (list of cookie dicts),
    NOT Playwright ``storage_state`` JSON. The login helper converts between
    formats using the uploader's ``_convert_biliup_cookies_to_storage_state``
    function. See :file:`crawler/platforms/bilibili/login.py`.
"""
from __future__ import annotations

import re


class BiliCrawlSelectors:
    """All Bilibili consumer-site selector constants for crawl flows.

    Organized by page: search results, video detail, comments. Each
    constant is a Playwright-friendly CSS selector. Page-level URL
    templates expose ``format()``-style substitution.
    """

    # ── URLs ────────────────────────────────────────────────────────────
    #: Search result page — Bilibili's search is hosted on a separate
    #: subdomain ``search.bilibili.com``. The ``order=click`` sort is
    #: relevance-based (most-clicked first). ``duration=0`` means all
    #: durations; ``tids_1=0`` means all categories.
    SEARCH_URL = (
        "https://search.bilibili.com/all"
        "?keyword={keyword}&order=click&duration=0&tids_1=0"
    )

    #: Video detail page by ``bv_id`` (e.g. ``BV1GJ411x7h7``).
    VIDEO_DETAIL_URL = "https://www.bilibili.com/video/{bv_id}"

    # ── Search results page (search.bilibili.com) ──────────────────────
    # Bilibili's search page renders results in a list/grid. Each result
    # is a video card with thumbnail, title, author, and stats.
    SEARCH_RESULTS_CONTAINER = (
        "#search-result, "
        "[class*='search-result'], "
        "[class*='video-list']"
    )
    SEARCH_RESULT_CARD = (
        "[class*='video-list-item'], "
        "[class*='search-video'], "
        "[class*='video-item']"
    )
    SEARCH_RESULT_LINK = "a[href*='/video/BV']"
    SEARCH_RESULT_TITLE = (
        "[class*='title'], "
        "[class*='Title'], "
        "[class*='video-title'], "
        "a[title]"
    )
    SEARCH_RESULT_AUTHOR = (
        "[class*='author'], "
        "[class*='up-name'], "
        "[class*='username'], "
        "[class*='up-name']"
    )
    # Bilibili shows play/view count on search result cards
    SEARCH_RESULT_PLAY_COUNT = (
        "[class*='play-count'], "
        "[class*='view-count'], "
        "[class*='play'], "
        "[class*='watch-info']"
    )
    SEARCH_RESULT_COVER = "img[class*='cover'], img[class*='Cover']"

    #: BV ID extraction from the card's ``href``.
    #: Format: ``/video/BV1GJ411x7h7``
    BV_ID_HREF_PATTERN = re.compile(r"/video/(BV[a-zA-Z0-9]+)")

    # ── Video detail page (www.bilibili.com/video) ─────────────────────
    # The video detail page shows the player + metadata + comments.
    # Most fields are rendered server-side or hydrated via SSR.
    VIDEO_DETAIL_TITLE = (
        "#video-title, "
        "[class*='video-title'], "
        "h1[class*='title'], "
        "[class*='VideoTitle']"
    )
    VIDEO_DETAIL_DESC = (
        "[class*='video-desc'], "
        "[class*='desc-text'], "
        "[class*='description'], "
        "[class*='basic-desc']"
    )
    VIDEO_DETAIL_AUTHOR = (
        "[class*='up-name'], "
        "[class*='author'], "
        "[class*='username'], "
        "[class*='name']"
    )
    VIDEO_DETAIL_LIKES = (
        "[class*='like'], "
        "[class*='video-like'], "
        "[data-text*='赞'], "
        "[class*='action']"
    )

    # ── Comments section ───────────────────────────────────────────────
    # Bilibili comments are loaded via a sub-app within the video page.
    # They may appear in a dedicated container or be lazy-loaded.
    COMMENTS_CONTAINER = (
        "#commentapp, "
        "[class*='comment-app'], "
        "[class*='comment-container'], "
        "[class*='CommentContainer']"
    )
    COMMENT_ITEM = (
        "[class*='comment-item'], "
        "[class*='reply-item'], "
        "[class*='CommentItem']"
    )
    COMMENT_ITEM_TEXT = (
        "[class*='comment-content'], "
        "[class*='reply-content'], "
        "[class*='text']"
    )
    COMMENT_ITEM_AUTHOR = (
        "[class*='user-name'], "
        "[class*='reply-name'], "
        "[class*='author']"
    )
    COMMENT_ITEM_LIKES = (
        "[class*='like-count'], "
        "[class*='like-info'], "
        "[class*='digg']"
    )
    # "Show more" / "展开回复" button
    COMMENTS_SHOW_MORE = (
        "[class*='show-more'], "
        "[class*='load-more'], "
        "[class*='more-btn'], "
        "[class*='reply-more']"
    )

    # ── Login-state probe selectors ────────────────────────────────────
    # When cookie is missing/expired, Bilibili may redirect to login
    # or show a login modal on the video page.
    LOGIN_MODAL = (
        "[class*='login-container'], "
        "[class*='login-modal'], "
        ".login-panel"
    )


def bv_id_from_url(href: str) -> str:
    """Extract Bilibili BV id from a ``/video/BV...`` URL.

    Returns ``""`` if the URL doesn't match — the caller should
    treat empty ids as a soft skip.
    """
    if not href:
        return ""
    m = BiliCrawlSelectors.BV_ID_HREF_PATTERN.search(href)
    return m.group(1) if m else ""


def parse_count(raw: str) -> int:
    """Parse a Bilibili count text like ``1.2万`` / ``3,456`` / ``789`` → integer.

    Bilibili serves Chinese-localized counts:
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
    "BiliCrawlSelectors",
    "bv_id_from_url",
    "parse_count",
]
