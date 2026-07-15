"""Kuaishou (快手) consumer-site selectors (``www.kuaishou.com``).

These selectors are **DIFFERENT** from the publish-side selectors in
``uploader/ks_uploader/locators.py::KsLocators``, which target
``cp.kuaishou.com``. The two sites have distinct DOM structures and
CSS class names — selector reuse between them is incorrect.

When ``www.kuaishou.com`` changes its DOM, update ONLY this file
(do NOT touch the uploader-side locators). The selectors below are
**loose / robust** to A/B-test variations: we anchor on stable
attribute selectors (``[class*='...']``, ``href`` patterns) and text
content rather than hashed class names that Kuaishou regenerates
per build.

Reference: MediaCrawler's ``media_platform/kuaishou/extractor.py``
selector conventions + ``field.py`` URL templates, adjusted for the
current www.kuaishou.com DOM structure. Kuaishou's web client is a
React SPA — the search page renders video cards in a waterfall grid,
and the video detail page loads comments dynamically below the player.
"""
from __future__ import annotations

import re


class KsCrawlSelectors:
    """All ``www.kuaishou.com`` selector constants for crawl flows.

    Organized by page: search results, video detail, comments. Each
    constant is a Playwright-friendly CSS selector. Page-level URL
    templates expose ``format()``-style substitution.
    """

    # ── URLs ────────────────────────────────────────────────────────────
    #: Search result page — ``visionnew`` is the current search SPA
    #: route. The ``type=general`` tab is the default relevance ranking.
    #: Kuaishou also supports ``type=video`` / ``type=user`` / ``type=image``
    #: but we only need ``general`` for mixed content discovery.
    SEARCH_URL = "https://www.kuaishou.com/search/visionnew?keyword={keyword}&type=general"

    #: Video detail page by ``photo_id`` (numeric string).
    #: Format: ``/short-video/3xf4knxyzabc1234``
    VIDEO_DETAIL_URL = "https://www.kuaishou.com/short-video/{photo_id}"

    # ── Search results page ────────────────────────────────────────────
    # Kuaishou renders search results as a vertically-scrollable
    # waterfall grid of video cards. The class names are hashed per
    # build; we anchor on stable semantic attribute selectors.
    SEARCH_RESULTS_CONTAINER = (
        "#app, "
        "[class*='search-result'], "
        "[class*='SearchResult']"
    )
    SEARCH_RESULT_CARD = (
        "[class*='video-card'], "
        "[class*='VideoCard'], "
        "[class*='search-item'], "
        "a[href*='/short-video/']"
    )
    SEARCH_RESULT_LINK = "a[href*='/short-video/']"
    SEARCH_RESULT_TITLE = (
        "[class*='title'], "
        "[class*='Title'], "
        "[class*='video-title']"
    )
    SEARCH_RESULT_AUTHOR = (
        "[class*='author'], "
        "[class*='nickname'], "
        "[class*='user-name']"
    )
    # Kuaishou shows view/play count on search result cards
    SEARCH_RESULT_PLAY_COUNT = (
        "[class*='view-count'], "
        "[class*='play-count'], "
        "[class*='watch-count']"
    )
    # Cover image thumbnail
    SEARCH_RESULT_COVER = "img[class*='cover'], img[class*='Cover']"

    #: Photo ID extraction from the card's ``href``.
    #: Format: ``/short-video/3xf4knxyzabc1234``
    PHOTO_ID_HREF_PATTERN = re.compile(r"/short-video/([a-zA-Z0-9]+)")

    # ── Video detail page ──────────────────────────────────────────────
    # The video detail page shows the player + description + author info
    # + comment section. Most metadata is rendered client-side via React
    # hydration.
    VIDEO_DETAIL_TITLE = (
        "[class*='video-info-title'], "
        "[class*='detail-title'], "
        "h1[class*='title']"
    )
    VIDEO_DETAIL_DESC = (
        "[class*='video-info-desc'], "
        "[class*='desc-text'], "
        "[class*='description'], "
        "[class*='caption']"
    )
    VIDEO_DETAIL_AUTHOR = (
        "[class*='author-info'], "
        "[class*='user-info'], "
        "[class*='creator-name'], "
        "[class*='profile-name']"
    )
    VIDEO_DETAIL_LIKES = (
        "[class*='like-count'], "
        "[class*='digg-count'], "
        "[class*='action-item']"
    )

    # ── Comments section ───────────────────────────────────────────────
    # Kuaishou comments are loaded dynamically below the video player.
    # They appear after a brief scroll or after the page stabilizes.
    COMMENTS_CONTAINER = (
        "[class*='comment-container'], "
        "[class*='CommentContainer'], "
        "[class*='comment-list'], "
        "#comment"
    )
    COMMENT_ITEM = (
        "[class*='comment-item'], "
        "[class*='CommentItem'], "
        "[class*='comment']:not([class*='container']):not([class*='list'])"
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
    # "Show more" / "查看全部回复" button
    COMMENTS_SHOW_MORE = (
        "[class*='show-more'], "
        "[class*='load-more'], "
        "[class*='more-btn'], "
        "text=查看全部"
    )

    # ── Login-state probe selectors ────────────────────────────────────
    # When cookie is missing/expired, Kuaishou redirects to login.
    LOGIN_MODAL = (
        "[class*='login-container'], "
        "[class*='login-modal'], "
        "div[class*='captcha']"
    )
    COOKIE_OK_MARKER = "[class*='app'], #app, #root"


def photo_id_from_url(href: str) -> str:
    """Extract Kuaishou photo_id from a ``/short-video/<id>`` URL.

    Returns ``""`` if the URL doesn't match — the caller should
    treat empty ids as a soft skip.
    """
    if not href:
        return ""
    m = KsCrawlSelectors.PHOTO_ID_HREF_PATTERN.search(href)
    return m.group(1) if m else ""


def parse_count(raw: str) -> int:
    """Parse a Kuaishou count text like ``1.2w`` / ``3,456`` / ``789`` → integer.

    Kuaishou serves Chinese-localized counts:
      * ``1234``    → 1234
      * ``1.2w``    → 12000 (w = 万)
      * ``1.2万``   → 12000
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
    "KsCrawlSelectors",
    "photo_id_from_url",
    "parse_count",
]
