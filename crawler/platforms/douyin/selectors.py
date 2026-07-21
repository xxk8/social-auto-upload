"""Douyin (抖音) consumer-site selectors (``www.douyin.com``).

These selectors are **DIFFERENT** from the publish-side selectors in
``uploader/douyin_uploader/locators.py::DouyinLocators``, which target
``creator.douyin.com``. The two sites have distinct DOM structures
and CSS class names — selector reuse between them is incorrect.

When ``www.douyin.com`` changes its DOM, update ONLY this file
(do NOT touch the uploader-side locators). The selectors below are
**loose / robust** to A/B-test variations: we anchor on stable
attribute selectors (``data-*``, ``href`` patterns) and text content
rather than hashed class names that Douyin regenerates per build.

Reference: MediaCrawler's ``media_platform/douyin/extractor.py``
selector conventions + ``field.py`` URL templates, adjusted for the
current www.douyin.com DOM structure. Douyin's web client is a
React SPA that renders video cards in a grid/list layout with
lazy-loaded comment sections.
"""
from __future__ import annotations

import re


class DouyinCrawlSelectors:
    """All ``www.douyin.com`` selector constants for crawl flows.

    Organized by page: search results, video detail, comments. Each
    constant is a Playwright-friendly CSS selector. Page-level URL
    templates expose ``format()``-style substitution.
    """

    # ── URLs ────────────────────────────────────────────────────────────
    #: Search result page — the ``type=general`` tab is the default
    #: relevance ranking. Douyin also supports ``type=user`` /
    #: ``type=live`` / ``type=video`` but we only need ``general``
    #: for mixed content discovery.
    SEARCH_URL = "https://www.douyin.com/search/{keyword}?type=general"

    #: Video detail page by ``aweme_id`` (numeric string).
    VIDEO_DETAIL_URL = "https://www.douyin.com/video/{aweme_id}"

    # ── Search results page ────────────────────────────────────────────
    # Douyin renders search results as a vertically-scrollable list of
    # video cards inside a container. The class names are hashed per
    # build; we anchor on stable semantic attribute selectors.
    SEARCH_RESULTS_CONTAINER = (
        "#search-content-area, "
        ".search-result-container, "
        "[class*='search-content']"
    )
    SEARCH_RESULT_CARD = (
        "[class*='search-item'], "
        "[class*='SearchVideoItem'], "
        "[class*='search-result-item']"
    )
    SEARCH_RESULT_LINK = "a[href*='/video/']"
    SEARCH_RESULT_TITLE = (
        "[class*='title'], "
        "[class*='Title'], "
        "p[class*='title']"
    )
    SEARCH_RESULT_AUTHOR = (
        "[class*='author'], "
        "[class*='nickname'], "
        "[class*='creator-name']"
    )
    # Douyin shows view/play count instead of likes in search results
    SEARCH_RESULT_PLAY_COUNT = (
        "[class*='play-count'], "
        "[class*='view-count'], "
        "[class*='number']"
    )
    # Cover image thumbnail
    SEARCH_RESULT_COVER = "img[class*='cover'], img[class*='Cover']"

    #: Aweme ID extraction from the card's ``href``.
    # Format: ``/video/7451234567890123456``
    AWEME_ID_HREF_PATTERN = re.compile(r"/video/(\d+)")

    # ── Video detail page ──────────────────────────────────────────────
    # The video detail page shows the player + description + author info
    # + comment section. Most of the metadata is rendered client-side
    # via React hydration.
    VIDEO_DETAIL_TITLE = (
        "[class*='video-info-title'], "
        "[class*='detail-title'], "
        "h1[class*='title']"
    )
    VIDEO_DETAIL_DESC = (
        "[class*='video-info-desc'], "
        "[class*='desc-text'], "
        "[class*='description']"
    )
    VIDEO_DETAIL_AUTHOR = (
        "[class*='author-info'], "
        "[class*='user-info'], "
        "[class*='creator-name']"
    )
    VIDEO_DETAIL_LIKES = (
        "[class*='digg-count'], "
        "[class*='like-count'], "
        "[class*='action-item']:has-text('赞')"
    )
    VIDEO_DETAIL_COMMENTS_COUNT = (
        "[class*='comment-count'], "
        "[class*='action-item']:has-text('评论')"
    )

    # ── Comments section ───────────────────────────────────────────────
    # Douyin comments are loaded dynamically below the video player.
    # They're inside a container that appears after scrolling or after
    # the page has fully loaded.
    COMMENTS_CONTAINER = (
        "[class*='comment-container'], "
        "[class*='CommentContainer'], "
        "[class*='comment-list']"
    )
    COMMENT_ITEM = (
        "[class*='comment-item'], "
        "[class*='CommentItem'], "
        "[class*='comment']:not([class*='container'])"
    )
    COMMENT_ITEM_TEXT = (
        "[class*='comment-text'], "
        "[class*='CommentText'], "
        "[class*='content']"
    )
    COMMENT_ITEM_AUTHOR = (
        "[class*='comment-author'], "
        "[class*='CommentAuthor'], "
        "[class*='user-name']"
    )
    COMMENT_ITEM_LIKES = (
        "[class*='comment-like'], "
        "[class*='CommentDigg'], "
        "[class*='digg']"
    )
    # "Show more" / "展开更多回复" button
    COMMENTS_SHOW_MORE = (
        "[class*='show-more'], "
        "[class*='load-more'], "
        "text=展开更多"
    )

    # ── Login-state probe selectors ────────────────────────────────────
    # When cookie is missing/expired, Douyin redirects to login.
    LOGIN_MODAL = (
        "[class*='login-container'], "
        "[class*='login-modal'], "
        "div[class*='captcha']"
    )
    COOKIE_OK_MARKER = "[class*='app'], #root"


def aweme_id_from_href(href: str) -> str:
    """Extract Douyin aweme_id from a ``/video/<id>`` URL.

    Returns ``""`` if the URL doesn't match — the caller should
    treat empty ids as a soft skip.
    """
    if not href:
        return ""
    m = DouyinCrawlSelectors.AWEME_ID_HREF_PATTERN.search(href)
    return m.group(1) if m else ""


def parse_count(raw: str) -> int:
    """Parse a Douyin count text like ``1.2w`` / ``3,456`` / ``789`` → integer.

    Douyin serves Chinese-localized counts:
      * ``1234``    → 1234
      * ``1.2w``    → 12000 (w = 万)
      * ``1.2亿``   → 120000000
      * ``9999+``   → 9999
      * ``""``      → 0

    Returns 0 on garbage.
    """
    if not raw:
        return 0
    s = raw.strip().replace(",", "").replace("+", "")
    if s.endswith("w") or s.endswith("万"):
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


__all__ = [
    "DouyinCrawlSelectors",
    "aweme_id_from_href",
    "parse_count",
]
