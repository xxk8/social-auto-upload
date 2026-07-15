"""LLM-backed reply suggestion (D8 of design.md).

The AI generates a suggested reply text for a given comment + post
context. The operator reviews the suggestion in the Frontend
(``CrawlPage.tsx``) and pastes it manually — we do NOT auto-send.
This is by design (D8 justifications): brand-reputation risk +
operator review requirement.

Implementation notes:
    * Same client pattern as :mod:`crawler.ai.sentiment` — small
      in-process TTL cache, ``OPENROUTER_API_KEY`` reuse, no SSE.
    * Platform "tone" is rough: xhs = warm + emoji, douyin = short
      + punchy, weibo = witty, tieba = 贴吧风, zhihu = 知乎 风.
      The exact style guide lives in the prompt below; operators
      tune by editing the ``PLATFORM_TONE`` dict.
    * Failure mode: any LLM error -> empty ``""`` reply suggestion.
      Empty is better than ``NULL`` because the UI's "copy" button
      behaves consistently (button shows but copies ``""``).
"""
from __future__ import annotations

import json
import logging
import os
import time

_module_logger = logging.getLogger(__name__)

DEFAULT_REPLY_MODEL = "deepseek/deepseek-chat"

#: Rough platform-specific tone guide. Operators tune by editing
#: these short style hints — the LLM does the actual heavy lifting.
PLATFORM_TONE: dict[str, str] = {
    "xhs": "warm, friendly, with 1-2 emoji, 2-3 sentences, lowercase",
    "dy": "very short (under 30 chars), punchy, 1 emoji",
    "douyin": "very short (under 30 chars), punchy, 1 emoji",
    "ks": "very short, friendly, 1 emoji",
    "kuaishou": "very short, friendly, 1 emoji",
    "bili": "casual, technical-aware, 2-3 sentences",
    "bilibili": "casual, technical-aware, 2-3 sentences",
    "weibo": "witty, 1-2 sentences, may include a hashtag",
    "wb": "witty, 1-2 sentences, may include a hashtag",
    "tieba": "贴吧风, 短句, may use 233 / doge / 🤣 emoji",
    "zhihu": "neutral, citation-friendly, 2-3 sentences",
}

# Cache to avoid re-running LLM for identical (text, platform) tuples
# within a single crawl run.
MAX_REPLY_CACHE_SIZE = 256
_REPLY_CACHE: dict[tuple[str, str], tuple[str, float]] = {}
_REPLY_CACHE_TTL = 3600.0


def _cache_get_replay(text: str, platform: str) -> str | None:
    key = (text, platform)
    entry = _REPLY_CACHE.get(key)
    if entry is None:
        return None
    value, ts = entry
    if time.monotonic() - ts > _REPLY_CACHE_TTL:
        _REPLY_CACHE.pop(key, None)
        return None
    return value


def _cache_put_replay(text: str, platform: str, value: str) -> None:
    _REPLY_CACHE[(text, platform)] = (value, time.monotonic())
    if len(_REPLY_CACHE) > MAX_REPLY_CACHE_SIZE:
        try:
            oldest_key = next(iter(_REPLY_CACHE))
            _REPLY_CACHE.pop(oldest_key, None)
        except StopIteration:
            pass


def generate_reply_suggestion(
    *,
    comment_text: str,
    platform: str,
    post_id: str = "",
) -> str:
    """Return a suggested reply text, or ``""`` if the LLM call fails.

    Caller (the store's AI-augmentation thread) writes the result
    into ``crawled_comments.ai_reply_suggestion``. Empty string ("")
    is the documented "no suggestion yet" sentinel — UI's "copy"
    button is unconditional on the row's existence; the rendered
    card simply hides the copy button when the value is ``""``.

    Args:
        comment_text: the original comment text to reply to.
        platform:     MediaCrawler-style short key (``"xhs"``, ``"dy"``, ...).
                      Looked up in :data:`PLATFORM_TONE`; falls back to a
                      neutral tone for unknown platforms.
        post_id:      optional — currently not threaded into the prompt
                      (post context would require a JOIN with
                      ``crawled_content``); kept in the signature for
                      future PRs that want post title context.
    """
    comment_text = (comment_text or "").strip()
    if not comment_text:
        return ""

    cached = _cache_get_replay(comment_text, platform)
    if cached is not None:
        return cached

    tone = PLATFORM_TONE.get(platform.lower(), "neutral, 2-3 sentences")
    api_key = (
        os.environ.get("OPENROUTER_API_KEY", "").strip()
        or os.environ.get("SAU_CRAWLER_OPENROUTER_API_KEY", "").strip()
    )
    if not api_key:
        _module_logger.warning(
            "[crawler] reply-suggestion LLM skipped: OPENROUTER_API_KEY is unset."
        )
        return ""

    model = (
        os.environ.get("SAU_CRAWLER_REPLY_MODEL", DEFAULT_REPLY_MODEL).strip()
        or DEFAULT_REPLY_MODEL
    )
    base_url = os.environ.get(
        "SAU_CRAWLER_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
    ).strip()
    url = f"{base_url.rstrip('/')}/chat/completions"

    import requests  # installed transitively

    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    f"You suggest short reply text for a Chinese social-media "
                    f"comment. Tone: {tone}. Output ONLY the reply text, "
                    f"no quotes, no preamble, no JSON wrapper."
                ),
            },
            {
                "role": "user",
                "content": f"Original comment: {comment_text!r}\nReply:",
            },
        ],
        "temperature": 0.7,
        "max_tokens": 80,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=20.0)
    except requests.RequestException as exc:
        _module_logger.warning("[crawler] reply-suggest POST failed: %s", exc)
        return ""
    if resp.status_code != 200:
        _module_logger.warning(
            "[crawler] reply-suggest non-200: %s body=%s",
            resp.status_code,
            resp.text[:200],
        )
        return ""
    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        _module_logger.warning("[crawler] reply-suggest shape error: %s", exc)
        return ""
    text = (content or "").strip().strip('"').strip("'")
    if not text:
        return ""
    _cache_put_replay(comment_text, platform, text)
    return text


def serialize_reply_for_json(value: str) -> str:
    """JSON-safe encode of a reply text (escape-only, no truncation).

    Used by the Web API when embedding the suggestion in the
    ``GET /api/crawl/data?platform=...`` JSON response so the
    frontend's JSON parser doesn't choke on embedded newlines.
    """
    return json.dumps(value, ensure_ascii=False)[1:-1]  # strip surrounding quotes
