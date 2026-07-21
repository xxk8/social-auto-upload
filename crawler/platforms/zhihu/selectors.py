"""Zhihu (知乎) consumer-site selectors (``www.zhihu.com`` + ``zhuanlan.zhihu.com``).

These selectors are designed for the Zhihu consumer site's React SPA.
When ``www.zhihu.com`` changes its DOM, update ONLY this file.
The selectors are **loose / robust** to A/B-test variations: we anchor
on stable attribute selectors (``[class*='...']``, ``href`` patterns)
rather than hashed class names.

Zhihu consumer-site structure:

    * **Search** (``www.zhihu.com/search?type=content&q=...``): renders
      a list of content cards (questions, articles, videos). Each card
      has a title, excerpt, vote count, and a link to the content.
    * **Question detail** (``www.zhihu.com/question/{id}``): shows the
      question title, description, answers, and a comment section.
    * **Article detail** (``zhuanlan.zhihu.com/p/{id}``): standalone
      article with comments.

Note on IDs:
    Zhihu uses numeric IDs for questions (e.g. ``123456789``) and
    alphanumeric slugs for articles (e.g. ``p/abc123def``). The
    ``question_id_from_url`` helper extracts either format from the
    ``/question/{id}`` or ``/p/{id}`` URL pattern.

Note on login:
    Zhihu has no dedicated uploader in this project. The login module
    implements a standalone QR-code login flow at
    ``www.zhihu.com/signin``. See :file:`crawler/platforms/zhihu/login.py`.
"""
from __future__ import annotations

import re


class ZhihuCrawlSelectors:
    """All ``www.zhihu.com`` selector constants for crawl flows.

    Organized by page: search results, content detail, comments. Each
    constant is a Playwright-friendly CSS selector. Page-level URL
    templates expose ``format()``-style substitution.
    """

    # ── URLs ────────────────────────────────────────────────────────────
    #: Search result page — ``type=content`` is the default, showing
    #: mixed results (questions + articles + videos). ``type=answer``
    #: filters to answers only; ``type=zhuanlan`` to articles only.
    SEARCH_URL = (
        "https://www.zhihu.com/search"
        "?type=content&q={keyword}"
    )

    #: Question detail page by numeric ``question_id``.
    QUESTION_DETAIL_URL = "https://www.zhihu.com/question/{question_id}"

    #: Article detail page by ``article_id`` (zhuanlan slug).
    ARTICLE_DETAIL_URL = "https://zhuanlan.zhihu.com/p/{article_id}"

    # ── Search results page ────────────────────────────────────────────
    # Zhihu's search page renders results in a list. Each result card
    # has a title, excerpt, vote count, and metadata.
    SEARCH_RESULTS_CONTAINER = (
        "[class*='SearchResult'], "
        "[class*='search-result'], "
        "#search-result"
    )
    SEARCH_RESULT_CARD = (
        "[class*='SearchResult-card'], "
        "[class*='search-result-item'], "
        "[class*='ContentItem']"
    )
    SEARCH_RESULT_LINK = "a[href*='/question/'], a[href*='/p/']"
    SEARCH_RESULT_TITLE = (
        "[class*='title'], "
        "[class*='Title'], "
        "[class*='content-title'], "
        "h2[class*='title']"
    )
    SEARCH_RESULT_EXCERPT = (
        "[class*='excerpt'], "
        "[class*='summary'], "
        "[class*='content']"
    )
    SEARCH_RESULT_AUTHOR = (
        "[class*='author'], "
        "[class*='Author'], "
        "[class*='user-link'], "
        "[class*='name']"
    )
    # Zhihu shows vote count on search result cards
    SEARCH_RESULT_VOTE_COUNT = (
        "[class*='vote'], "
        "[class*='Vote'], "
        "[class*='vote-count'], "
        "[class*='upvote']"
    )
    SEARCH_RESULT_ANSWER_COUNT = (
        "[class*='answer-count'], "
        "[class*='meta']"
    )

    #: Content ID extraction from the card's ``href``.
    #: Format: ``/question/123456789`` or ``/p/abc123def``
    CONTENT_ID_HREF_PATTERN = re.compile(
        r"/(?:question|p)/([a-zA-Z0-9]+)"
    )

    # ── Question / Article detail page ─────────────────────────────────
    # The detail page shows the content and metadata.
    CONTENT_TITLE = (
        "[class*='question-title'], "
        "[class*='QuestionTitle'], "
        "[class*='title'], "
        "h1[class*='title']"
    )
    CONTENT_BODY = (
        "[class*='content'], "
        "[class*='detail'], "
        "[class*='rich-text'], "
        "[class*='RichText']"
    )
    CONTENT_AUTHOR = (
        "[class*='author'], "
        "[class*='Author'], "
        "[class*='user-info'], "
        "[class*='UserInfo']"
    )
    CONTENT_VOTE_COUNT = (
        "[class*='vote-count'], "
        "[class*='VoteCount'], "
        "[class*='upvote']"
    )
    # Answer section on question pages
    ANSWERS_CONTAINER = (
        "[class*='answers'], "
        "[class*='Answers'], "
        "[class*='answer-list']"
    )

    # ── Comments section ───────────────────────────────────────────────
    # Zhihu comments are loaded dynamically, often via an API call.
    # The DOM container wraps the rendered comments.
    COMMENTS_CONTAINER = (
        "[class*='comments'], "
        "[class*='Comments'], "
        "[class*='comment-list'], "
        "#comment"
    )
    COMMENT_ITEM = (
        "[class*='comment-item'], "
        "[class*='CommentItem'], "
        "[class*='comment']:not([class*='list']):not([class*='container'])"
    )
    COMMENT_ITEM_TEXT = (
        "[class*='comment-text'], "
        "[class*='CommentText'], "
        "[class*='content'], "
        "[class*='text']"
    )
    COMMENT_ITEM_AUTHOR = (
        "[class*='comment-author'], "
        "[class*='CommentAuthor'], "
        "[class*='user-name'], "
        "[class*='author']"
    )
    COMMENT_ITEM_LIKES = (
        "[class*='comment-like'], "
        "[class*='CommentDigg'], "
        "[class*='like-count'], "
        "[class*='digg']"
    )
    # "Show more" button
    COMMENTS_SHOW_MORE = (
        "[class*='show-more'], "
        "[class*='load-more'], "
        "[class*='more-btn'], "
        "[class*='view-all']"
    )

    # ── Login-state probe selectors ────────────────────────────────────
    LOGIN_MODAL = (
        "[class*='login-modal'], "
        "[class*='LoginModal'], "
        ".SignFlow, "
        "[class*='sign-flow']"
    )
    # Marker that the user is logged in (personal feed elements)
    LOGGED_IN_MARKER = (
        "[class*='Topstory'], "
        "[class*='topstory'], "
        "[class*='personal-feed']"
    )


def content_id_from_url(href: str) -> str:
    """Extract Zhihu content id from a ``/question/<id>`` or ``/p/<id>`` URL.

    Returns ``""`` if the URL doesn't match.
    """
    if not href:
        return ""
    m = ZhihuCrawlSelectors.CONTENT_ID_HREF_PATTERN.search(href)
    return m.group(1) if m else ""


def parse_count(raw: str) -> int:
    """Parse a Zhihu count text like ``1.2万`` / ``3,456`` / ``789`` → integer.

    Zhihu serves Chinese-localized counts:
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
    "ZhihuCrawlSelectors",
    "content_id_from_url",
    "parse_count",
]
