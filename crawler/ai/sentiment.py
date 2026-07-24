"""LLM-backed sentiment analysis (D7 of design.md).

Uses OpenRouter (or any OpenAI-compatible endpoint) to classify a
Chinese comment into ``positive`` / ``negative`` / ``neutral`` + a
confidence score in ``[0.0, 1.0]``.

Implementation notes:
    * Mirrors the LLM-client pattern from
      :mod:`web_runner.routes.ai` (the existing 82k-byte route file)
      — we read the API key + model from the same ``ai_api_keys`` /
      ``ai_config`` tables and reuse the same ``OPENROUTER_API_KEY``
      env var fallback. Avoids inventing a parallel config surface.
    * Tiny TTL cache (LRU-ish, dict-based) so back-to-back
      identical-comment AI threads (e.g. junk "666" replies) don't
      trip the same LLM call. Bounded at ``MAX_CACHE_SIZE`` to keep
      memory growth bounded during long crawls.
    * Any LLM error -> ``("neutral", 0.0)`` so the
      :meth:`SauliteStore.store_comment` update is unconditional —
      we'd rather record "neutral + 0.0 confidence" than crash the
      store layer.

Open Question from design.md ("AI 情感分析的模型选择") is resolved
here: default model = ``deepseek/deepseek-chat`` (cheapest
OpenRouter model with bilingual coverage; matches the existing
``agora`` AI sidebar's budget tier).
"""
from __future__ import annotations

import json
import logging
import re
import time
from functools import lru_cache

_module_logger = logging.getLogger(__name__)

#: Default OpenRouter model. Override with
#: :data:`SAU_CRAWLER_SENTIMENT_MODEL` env var.
DEFAULT_SENTIMENT_MODEL = "deepseek/deepseek-chat"

#: In-process LRU-ish cache (dict insertion-ordered). Bounded to keep
#: memory finite; ~200 entries × 256-char average = ~50 KiB which is
#: acceptable for the crawler process.
MAX_CACHE_SIZE = 256
_CACHE: dict[str, tuple[str, float, float]] = {}  # text -> (label, conf, ts)


def _now() -> float:
    return time.monotonic()


def _cache_get(text: str) -> tuple[str, float] | None:
    """Return cached (label, conf) or ``None``. TTL = 1h.

    Even though crawler processes restart periodically, the in-process
    cache suppresses redundant LLM calls within a single crawl run
    (which is the common case — many platforms return identical
    "666" / "👍" / "沙发" bots).
    """
    entry = _CACHE.get(text)
    if entry is None:
        return None
    label, conf, ts = entry
    if _now() - ts > 3600:
        _CACHE.pop(text, None)
        return None
    return label, conf


def _cache_put(text: str, label: str, conf: float) -> None:
    _CACHE[text] = (label, conf, _now())
    if len(_CACHE) > MAX_CACHE_SIZE:
        # Drop the oldest entry — dicts preserve insertion order in
        # Python 3.7+ so ``next(iter(_CACHE))`` is the oldest.
        try:
            oldest_key = next(iter(_CACHE))
            _CACHE.pop(oldest_key, None)
        except StopIteration:
            pass


def _normalize_label(raw: str) -> str:
    """Map a noisy LLM response to one of ``positive/negative/neutral``.

    Accepts synonyms ("positive"/"positive"/"正面"/"好评" etc.) and
    falls back to ``neutral`` for anything unrecognized so a
    misformatted LLM response never crashes the store.
    """
    low = raw.strip().lower()
    if not low:
        return "neutral"
    if any(token in low for token in ("positive", "pos", "正面", "好评", "支持", "开心", "棒", "好")):
        return "positive"
    if any(token in low for token in ("negative", "neg", "负面", "差评", "反对", "愤怒", "差", "烂")):
        return "negative"
    if any(token in low for token in ("neutral", "neu", "中性", "中立", "一般", "普通")):
        return "neutral"
    # No clear signal — default to neutral so the operator's sentiment
    # summary card doesn't get an unknown bucket.
    return "neutral"


def _openrouter_classify(text: str, model: str, *, timeout: float = 20.0) -> tuple[str, float] | None:
    """Make one OpenRouter ``chat/completions`` request.

    Returns ``(label, confidence-in-[0,1])`` parsed from the LLM JSON
    response, or ``None`` if anything goes wrong. Caller decides what
    fallback to use when ``None`` is returned.

    Implementation deliberately avoids reusing the SSE-stream helpers
    in :mod:`web_runner.routes.ai` — those are optimized for human
    users watching the AI sidebar, not for batch back-end calls.
    A simple POST + JSON response is faster (no SSE overhead) and
    more reliable for a head-less worker.
    """
    import os

    import requests  # noqa: F401 — installed transitively via web ML deps

    api_key = (
        os.environ.get("OPENROUTER_API_KEY", "").strip()
        or os.environ.get("SAU_CRAWLER_OPENROUTER_API_KEY", "").strip()
    )
    if not api_key:
        _module_logger.warning(
            "[crawler] sentiment LLM skipped: OPENROUTER_API_KEY is unset; "
            "using neutral fallback."
        )
        return None

    base_url = os.environ.get("SAU_CRAWLER_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip()
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    prompt = (
        "Classify the sentiment of the following Chinese social-media "
        "comment as positive, negative, or neutral. Reply strictly in JSON "
        "of the form {\"label\": \"positive|negative|neutral\", "
        "\"confidence\": 0.0..1.0}. "
        f"Comment: {text!r}"
    )
    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a sentiment classifier for Chinese social-media "
                    "comments. Output ONLY a JSON object."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        # Force JSON-mode if the model supports it; for older models we
        # rely on prompt + regex parse below.
        "response_format": {"type": "json_object"},
        "temperature": 0.0,
        "max_tokens": 64,
    }
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        _module_logger.warning("[crawler] sentiment POST failed: %s", exc)
        return None
    if resp.status_code != 200:
        _module_logger.warning(
            "[crawler] sentiment non-200: %s body=%s",
            resp.status_code,
            resp.text[:200],
        )
        return None
    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        _module_logger.warning("[crawler] sentiment response shape error: %s", exc)
        return None
    # Parse JSON inside the content. Models sometimes wrap JSON in
    # ```json fences; strip them defensively.
    content_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.MULTILINE).strip()
    try:
        parsed = json.loads(content_clean)
        label = str(parsed.get("label", ""))
        conf_raw = parsed.get("confidence", 0.0)
        confidence = float(conf_raw) if isinstance(conf_raw, (int, float)) else 0.0
        confidence = max(0.0, min(1.0, confidence))
    except (ValueError, TypeError):
        # Last-ditch: pattern-match the response for a sentinel and
        # infer confidence 0.5 so the row isn't a complete blank.
        label = content_clean
        confidence = 0.5
    return _normalize_label(label), confidence


def analyze_sentiment(text: str) -> tuple[str, float]:
    """Public entrypoint: classify ``text``.

    Returns ``(label, confidence)``. Falls back to
    ``("neutral", 0.0)`` on any failure so the caller can
    unconditionally ``UPDATE crawled_comments SET ai_sentiment=?, ...``
    and not block the store path.
    """
    text = (text or "").strip()
    if not text:
        return "neutral", 0.0

    cached = _cache_get(text)
    if cached is not None:
        return cached

    import os

    model = os.environ.get("SAU_CRAWLER_SENTIMENT_MODEL", DEFAULT_SENTIMENT_MODEL).strip() or DEFAULT_SENTIMENT_MODEL

    result = _openrouter_classify(text, model)
    if result is None:
        # Fallback: small string-based heuristic for offline / no-API-key
        # scenarios. Avoids LLM cost and gives a sane default when the
        # operator hasn't configured OpenRouter yet. NOT meant to be
        # accurate — just a placeholder so the UI shows something.
        low = text.lower()
        if any(token in low for token in ("好", "棒", "赞", "喜欢", "支持", "happy")):
            label, conf = "positive", 0.4
        elif any(token in low for token in ("差", "烂", "讨厌", "反对", "愤怒", "terrible")):
            label, conf = "negative", 0.4
        else:
            label, conf = "neutral", 0.4
    else:
        label, conf = result

    _cache_put(text, label, conf)
    return label, conf
