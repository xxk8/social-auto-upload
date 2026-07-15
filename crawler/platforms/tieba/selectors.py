"""Tieba (百度贴吧) consumer-site selectors (``tieba.baidu.com``).

These selectors are designed for Tieba's server-rendered pages. Unlike
Douyin/Kuaishou, Tieba uses relatively stable CSS class names
(``threadlist_title``, ``j_thread_list``, ``p_postlist``, etc.) mixed
with Baidu's internal naming conventions. We still use loose
``[class*='...']`` attribute selectors for robustness, but also include
specific class selectors where the DOM is known to be stable.

Tieba consumer-site structure:

    * **Forum page** (``tieba.baidu.com/f?kw=...``): a list of thread
      cards. Each card has a title, author, reply count, and last-reply
      timestamp.
    * **Thread detail** (``tieba.baidu.com/p/{thread_id}``): the OP's
      post content followed by reply posts (floor replies).
    * **Comments** (per-floor): each floor may have sub-comments
      (楼中楼), loaded via a separate API or expandable in-page.

Note on IDs:
    Tieba thread IDs are numeric (e.g. ``9876543210``). Post (floor)
    IDs are also numeric. The ``thread_id_from_url`` helper extracts
    the thread ID from ``/p/{thread_id}`` URLs.

Note on login:
    Tieba uses the unified Baidu passport login at
    ``passport.baidu.com/v2/?login``. This project has NO dedicated
    tieba uploader, so the login module in this package implements a
    standalone QR-code login flow. See
    :file:`crawler/platforms/tieba/login.py`.
"""
from __future__ import annotations

import re


class TiebaCrawlSelectors:
    """All ``tieba.baidu.com`` selector constants for crawl flows.

    Organized by page: forum (search), thread detail, per-floor
    comments. Each constant is a Playwright-friendly CSS selector.
    Page-level URL templates expose ``format()``-style substitution.
    """

    # ── URLs ────────────────────────────────────────────────────────────
    #: Forum (贴吧) page — shows a list of threads. ``kw`` is the
    #: keyword / bar name (e.g. ``美食``, ``摄影``).
    FORUM_URL = (
        "https://tieba.baidu.com/f?kw={keyword}&ie=utf-8"
    )

    #: Thread detail page by numeric ``thread_id``.
    THREAD_DETAIL_URL = "https://tieba.baidu.com/p/{thread_id}"

    # ── Forum / search results page ─────────────────────────────────────
    # Tieba's forum page is a server-rendered list. Thread cards use
    # relatively stable class names.
    FORUM_THREAD_LIST = (
        "#thread_list, "
        "[class*='thread-list'], "
        "[class*='threadlist']"
    )
    THREAD_CARD = (
        "li.j_thread_list, "
        "li[class*='thread'], "
        "[class*='threadlist_item'], "
        "[class*='thread-item']"
    )
    THREAD_LINK = "a[href*='/p/']"
    THREAD_TITLE = (
        "a.j_th_tit, "
        "a[class*='title'], "
        "[class*='threadlist_title'], "
        "[class*='thread-title'], "
        "a[class*='thread_name']"
    )
    THREAD_AUTHOR = (
        "span.frs-author-name, "
        "a[class*='author'], "
        "[class*='threadlist_author'], "
        "[class*='author-name']"
    )
    THREAD_REPLY_COUNT = (
        "span.threadlist_rep_num, "
        "[class*='reply-num'], "
        "[class*='reply_count'], "
        "[class*='rep-count']"
    )
    # Last reply time — used for sorting but optional in parsing.
    THREAD_LAST_REPLY_TIME = (
        "span.threadlist_reply_date, "
        "[class*='last-reply'], "
        "[class*='lastreply']"
    )

    #: Thread ID extraction from the card's ``href``.
    #: Format: ``/p/9876543210``
    THREAD_ID_HREF_PATTERN = re.compile(r"/p/(\d+)")

    # ── Thread detail page ──────────────────────────────────────────────
    # The detail page shows the original post (OP) followed by replies.
    # Each floor is a ``div.l_post`` or similar.
    THREAD_TITLE = (
        ".core_title, "
        "[class*='core-title'], "
        "[class*='thread-title'], "
        "h1[class*='title'], "
        "h3[class*='title']"
    )
    # OP content — the original post body
    OP_CONTENT = (
        "div.p_content, "
        "div.d_post_content, "
        "[class*='post_content'], "
        "[class*='post-content'], "
        "[class*='d_post']"
    )
    THREAD_AUTHOR_DETAIL = (
        "a.p_author_name, "
        "[class*='author-name'], "
        "[class*='poster-name'], "
        "a[class*='username']"
    )
    THREAD_POST_TIME = (
        "span.p_date, "
        "[class*='post-date'], "
        "[class*='date_']"
    )

    # ── Replies / floors ────────────────────────────────────────────────
    # Each reply floor is a ``div.l_post`` or similar container. Tieba
    # floors contain the reply content, author, and floor number.
    REPLY_LIST = (
        "div.l_post, "
        "div[class*='post'], "
        "[class*='floor-list'], "
        "[class*='reply-list']"
    )
    REPLY_ITEM = (
        "div.l_post, "
        "div[class*='post_'], "
        "[class*='floor-item'], "
        "[class*='reply-item']"
    )
    REPLY_CONTENT = (
        "div.d_post_content, "
        "[class*='post-content'], "
        "[class*='post_content'], "
        "div.p_content"
    )
    REPLY_AUTHOR = (
        "a.p_author_name, "
        "[class*='author-name'], "
        "[class*='poster-name']"
    )
    REPLY_FLOOR_NUM = (
        "span.floor_num, "
        "[class*='floor'], "
        "a[class*='floor']"
    )

    # ── Sub-comments (楼中楼) ──────────────────────────────────────────
    # Tieba supports nested comments within a floor (楼中楼). They
    # are usually loaded via a ``span.loadomore`` or similar trigger.
    SUB_COMMENT_CONTAINER = (
        "[class*='sub-comment'], "
        "[class*='subcomment'], "
        "[class*='lzl_content'], "
        "[class*='lzl']"
    )
    SUB_COMMENT_TEXT = (
        "[class*='sub-comment-text'], "
        "[class*='lzl_content'], "
        "span[class*='content']"
    )
    SUB_COMMENT_AUTHOR = (
        "[class*='sub-comment-author'], "
        "[class*='lzl_author'], "
        "a[class*='username']"
    )
    LOAD_MORE_SUB_COMMENTS = (
        "span.loadomore, "
        "[class*='load-more'], "
        "a[class*='more']"
    )

    # ── Login-state probe selectors ────────────────────────────────────
    # When logged in, tieba shows a username in the top-right corner.
    # When logged out, it shows "登录" or redirects to passport.
    LOGIN_BUTTON = (
        "a[href*='passport'], "
        "a[href*='login'], "
        "[class*='login-btn'], "
        "a[class*='username']"
    )
    LOGGED_IN_USERNAME = (
        "span.user-name, "
        "a[class*='name'], "
        "[class*='userinfo'] a[class*='name']"
    )


def thread_id_from_url(href: str) -> str:
    """Extract tieba thread ID from a ``/p/<id>`` URL.

    Returns ``""`` if the URL doesn't match.
    """
    if not href:
        return ""
    m = TiebaCrawlSelectors.THREAD_ID_HREF_PATTERN.search(href)
    return m.group(1) if m else ""


def parse_count(raw: str) -> int:
    """Parse a tieba count text like ``1.2万`` / ``3,456`` / ``789`` → integer.

    Tieba serves Chinese-localized counts:
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
    "TiebaCrawlSelectors",
    "thread_id_from_url",
    "parse_count",
]
