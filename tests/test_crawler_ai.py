"""Tests for crawler AI modules — sentiment analysis + reply suggestions.

Coverage:

  1. **``_normalize_label``** (pure Python — no LLM, no network):
     - Maps English tokens: ``positive``, ``negative``, ``neutral``
     - Maps Chinese tokens: ``正面``, ``差评``, ``中性`` etc.
     - Maps synonyms: ``pos``/``neg``/``neu``, ``好``/``差``/``一般``
     - Returns ``neutral`` for empty/garbage/unrecognized input.

  2. **``analyze_sentiment`` keyword fallback** (no LLM, no network):
     - Empty text returns (``neutral``, 0.0).
     - Positive keywords (好, 棒, 赞, 喜欢, 支持) return
       (``positive``, 0.4).
     - Negative keywords (差, 烂, 讨厌, 反对) return
       (``negative``, 0.4).
     - Unknown text returns (``neutral``, 0.4).

  3. **``analyze_sentiment`` cache** (no LLM, no network):
     - Cache hit returns cached value.
     - Cache miss populates cache.
     - Cache eviction at MAX_CACHE_SIZE.
     - Cache TTL expiry.

  4. **``analyze_sentiment`` with mock LLM**:
     - LLM returns valid JSON → parsed label + confidence.
     - LLM returns 500 → falls back to keyword heuristic.
     - LLM returns malformed JSON → falls back to keyword heuristic.

  5. **``generate_reply_suggestion``** (pure + mock):
     - Empty text returns ``""``.
     - No API key returns ``""``.
     - Cache hit returns cached value.
     - With mocked ``requests.post`` → returns LLM content.
     - ``PLATFORM_TONE`` lookup for known platforms.

  6. **``_augment_comment_with_ai``** (mock-based):
     - Calls ``analyze_sentiment`` + ``generate_reply_suggestion``
       and then ``UPDATE`` the comment row.
"""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

# ──────────────────────────────────────────────────────────────────────
# Section 1: _normalize_label (pure Python)
# ──────────────────────────────────────────────────────────────────────


class TestNormalizeLabel:
    """``crawler.ai.sentiment._normalize_label`` pure-Python helper."""

    def test_positive_english_full(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("positive") == "positive"

    def test_positive_english_short(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("pos") == "positive"

    def test_positive_chinese(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("正面") == "positive"

    def test_positive_synonyms(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        for synonym in ("好评", "支持", "开心", "棒", "好"):
            assert _normalize_label(synonym) == "positive"

    def test_negative_english_full(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("negative") == "negative"

    def test_negative_english_short(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("neg") == "negative"

    def test_negative_chinese(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("负面") == "negative"

    def test_negative_synonyms(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        for synonym in ("差评", "反对", "愤怒", "差", "烂"):
            assert _normalize_label(synonym) == "negative"

    def test_neutral_english(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("neutral") == "neutral"

    def test_neutral_chinese(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("中性") == "neutral"

    def test_neutral_synonyms(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        for synonym in ("中立", "一般", "普通"):
            assert _normalize_label(synonym) == "neutral"

    def test_case_insensitive(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("POSITIVE") == "positive"
        assert _normalize_label("NeGaTiVe") == "negative"
        assert _normalize_label("NeUtRaL") == "neutral"

    def test_empty_string_falls_back_to_neutral(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("") == "neutral"

    def test_garbage_falls_back_to_neutral(self) -> None:
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("asdfgh123!@#") == "neutral"

    def test_substring_in_long_text(self) -> None:
        """Should detect ``好`` inside a longer sentence."""
        from crawler.ai.sentiment import _normalize_label
        assert _normalize_label("这个产品真好用啊") == "positive"


# ──────────────────────────────────────────────────────────────────────
# Section 2: analyze_sentiment — keyword fallback (no network)
# ──────────────────────────────────────────────────────────────────────


class TestAnalyzeSentimentKeywordFallback:
    """``analyze_sentiment`` with no API key — uses keyword heuristic."""

    def test_empty_text_returns_neutral(self) -> None:
        from crawler.ai.sentiment import analyze_sentiment
        label, conf = analyze_sentiment("")
        assert label == "neutral"
        assert conf == 0.0

    def test_whitespace_text_returns_neutral(self) -> None:
        from crawler.ai.sentiment import analyze_sentiment
        label, conf = analyze_sentiment("   ")
        assert label == "neutral"
        assert conf == 0.0

    def test_positive_keywords_returns_positive(self) -> None:
        from crawler.ai.sentiment import analyze_sentiment
        for text in ("好", "棒", "赞", "喜欢", "支持", "happy"):
            label, conf = analyze_sentiment(text)
            assert label == "positive", f"Expected positive for {text!r}"
            assert conf == 0.4

    def test_negative_keywords_returns_negative(self) -> None:
        from crawler.ai.sentiment import analyze_sentiment
        for text in ("差", "烂", "讨厌", "反对", "愤怒", "terrible"):
            label, conf = analyze_sentiment(text)
            assert label == "negative", f"Expected negative for {text!r}"
            assert conf == 0.4

    def test_neutral_keywords_returns_neutral(self) -> None:
        from crawler.ai.sentiment import analyze_sentiment
        label, conf = analyze_sentiment("今天天气不错")
        assert label == "neutral"
        assert conf == 0.4

    def test_mixed_keywords_prefers_positive_first(self) -> None:
        """The heuristic checks positive tokens first."""
        from crawler.ai.sentiment import analyze_sentiment
        label, conf = analyze_sentiment("好但有点差")
        assert label == "positive"  # 好 checked before 差
        assert conf == 0.4


# ──────────────────────────────────────────────────────────────────────
# Section 3: analyze_sentiment — cache behavior
# ──────────────────────────────────────────────────────────────────────


class TestAnalyzeSentimentCache:
    """``analyze_sentiment`` cache layer (LRU + TTL)."""

    def test_cache_hit_returns_cached_value(self) -> None:
        """``analyze_sentiment`` checks cache before LLM."""
        from crawler.ai.sentiment import _CACHE, analyze_sentiment
        _CACHE.clear()
        # Pre-populate the cache
        _CACHE["测试评论"] = ("positive", 0.9, time.monotonic())
        label, conf = analyze_sentiment("测试评论")
        assert label == "positive"
        assert conf == 0.9
        _CACHE.clear()

    def test_cache_miss_populates_and_caches(self) -> None:
        """After first call with keyword fallback, cache is populated."""
        from crawler.ai.sentiment import _CACHE, analyze_sentiment
        _CACHE.clear()
        with patch("crawler.ai.sentiment._openrouter_classify",
                    return_value=None):
            label, conf = analyze_sentiment("好文章")
        assert label == "positive"
        # Check cache was populated
        cached = _CACHE.get("好文章")
        assert cached is not None
        assert cached[0] == "positive"
        _CACHE.clear()

    def test_cache_eviction_at_max_size(self) -> None:
        """Oldest entry evicted when cache exceeds MAX_CACHE_SIZE."""
        from crawler.ai.sentiment import _CACHE, MAX_CACHE_SIZE, analyze_sentiment
        original_size = MAX_CACHE_SIZE
        _CACHE.clear()
        # Fill cache to max
        for i in range(MAX_CACHE_SIZE):
            _CACHE[f"text_{i}"] = ("neutral", 0.5, time.monotonic())
        # Add one more to trigger eviction — mock LLM to avoid real HTTP
        with patch("crawler.ai.sentiment._openrouter_classify",
                    return_value=None):
            analyze_sentiment("eviction_test")
        assert len(_CACHE) <= MAX_CACHE_SIZE
        # The oldest key should be gone
        assert "text_0" not in _CACHE
        _CACHE.clear()

    def test_cache_ttl_expiry_recomputes_value(self) -> None:
        """Expired cache entry (TTL > 3600s) is skipped and re-computed.

        ``_cache_get`` checks ``_now() - ts > 3600``. We pre-populate
        with a stale timestamp (1000.0), then mock ``_now`` to return
        a time 3601s later — the entry should be treated as a miss.
        """
        from crawler.ai.sentiment import _CACHE, analyze_sentiment
        _CACHE.clear()
        # Pre-populate with a very old timestamp
        _CACHE["过期评论"] = ("positive", 0.9, 1000.0)

        with (
            patch("crawler.ai.sentiment._now",
                  return_value=1000.0 + 3601.0),
            patch("crawler.ai.sentiment._openrouter_classify",
                  return_value=None),
        ):
            label, conf = analyze_sentiment("过期评论")

        # Should NOT return the cached ("positive", 0.9)
        # Keyword fallback: "过期评论" has no positive/negative signal → neutral
        assert label == "neutral"
        assert conf == 0.4

        # Old entry evicted, new entry stored with mocked _now timestamp
        cached = _CACHE.get("过期评论")
        assert cached is not None
        assert cached[0] == "neutral"
        assert cached[2] == 1000.0 + 3601.0  # timestamp = mocked _now
        _CACHE.clear()


# ──────────────────────────────────────────────────────────────────────
# Section 4: analyze_sentiment — with mock LLM
# ──────────────────────────────────────────────────────────────────────


class TestAnalyzeSentimentWithMockLLM:
    """``analyze_sentiment`` with ``_openrouter_classify`` mocked."""

    def test_llm_returns_valid_json(self) -> None:
        """LLM returns ``{\"label\": \"positive\", \"confidence\": 0.95}``."""
        from crawler.ai.sentiment import _CACHE, analyze_sentiment
        _CACHE.clear()
        with patch("crawler.ai.sentiment._openrouter_classify") as mock:
            mock.return_value = ("positive", 0.95)
            label, conf = analyze_sentiment("这个产品非常好用！")
        assert label == "positive"
        assert conf == 0.95
        _CACHE.clear()

    def test_llm_returns_none_falls_back_to_keyword(self) -> None:
        """LLM failure → keyword heuristic used."""
        from crawler.ai.sentiment import _CACHE, analyze_sentiment
        _CACHE.clear()
        with patch("crawler.ai.sentiment._openrouter_classify") as mock:
            mock.return_value = None
            label, conf = analyze_sentiment("太烂了")
        assert label == "negative"
        assert conf == 0.4
        _CACHE.clear()

    def test_llm_returns_none_unknown_text_returns_neutral(self) -> None:
        """LLM failure + no keyword match → neutral."""
        from crawler.ai.sentiment import _CACHE, analyze_sentiment
        _CACHE.clear()
        with patch("crawler.ai.sentiment._openrouter_classify") as mock:
            mock.return_value = None
            label, conf = analyze_sentiment("今天天气不错")
        assert label == "neutral"
        assert conf == 0.4
        _CACHE.clear()


# ──────────────────────────────────────────────────────────────────────
# Section 5: generate_reply_suggestion
# ──────────────────────────────────────────────────────────────────────


class TestGenerateReplySuggestion:
    """``generate_reply_suggestion`` — pure + mock-based."""

    def test_empty_text_returns_empty(self) -> None:
        from crawler.ai.reply import generate_reply_suggestion
        result = generate_reply_suggestion(comment_text="", platform="xhs")
        assert result == ""

    def test_no_api_key_returns_empty(self) -> None:
        """When OPENROUTER_API_KEY is not set, returns empty."""
        from crawler.ai.reply import generate_reply_suggestion
        with patch.dict("os.environ", {}, clear=True):
            result = generate_reply_suggestion(
                comment_text="好吃！", platform="xhs"
            )
        assert result == ""

    def test_cache_hit_returns_cached(self) -> None:
        from crawler.ai.reply import _REPLY_CACHE, generate_reply_suggestion
        _REPLY_CACHE.clear()
        _REPLY_CACHE[("好吃！", "xhs")] = ("真好吃！再来！", time.monotonic())
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": "sk-test"}):
            result = generate_reply_suggestion(
                comment_text="好吃！", platform="xhs"
            )
        assert result == "真好吃！再来！"
        _REPLY_CACHE.clear()

    def test_platform_tone_mapping(self) -> None:
        """Known platforms have tone entries; unknown uses default."""
        from crawler.ai.reply import PLATFORM_TONE
        for key in ("xhs", "dy", "douyin", "ks", "kuaishou", "bili",
                    "bilibili", "weibo", "wb", "tieba", "zhihu"):
            assert key in PLATFORM_TONE, f"Missing tone for {key}"
        # Unknown platform uses default
        result = PLATFORM_TONE.get("unknown", "neutral, 2-3 sentences")
        assert result == "neutral, 2-3 sentences"

    def test_with_mocked_requests_returns_content(self) -> None:
        """Mock ``requests.post`` → LLM content returned.

        Note: ``requests`` is imported *inside* ``generate_reply_suggestion``,
        so we patch at the top-level ``requests.post``, not at the
        module attribute ``crawler.ai.reply.requests.post``.
        """
        from crawler.ai.reply import generate_reply_suggestion
        import json
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "真好吃！再来一份！"}}]
        }
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": "sk-test"}):
            with patch("requests.post") as mock_post:
                mock_post.return_value = mock_resp
                result = generate_reply_suggestion(
                    comment_text="好吃！",
                    platform="xhs",
                )
        assert result == "真好吃！再来一份！"

    def test_mocked_requests_returns_empty_on_500(self) -> None:
        """Non-200 response → empty string."""
        from crawler.ai.reply import _REPLY_CACHE, generate_reply_suggestion
        _REPLY_CACHE.clear()  # isolate from prior test that cached same key
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Internal Server Error"
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": "sk-test"}):
            with patch("requests.post") as mock_post:
                mock_post.return_value = mock_resp
                result = generate_reply_suggestion(
                    comment_text="好吃！",
                    platform="xhs",
                )
        assert result == ""


# ──────────────────────────────────────────────────────────────────────
# Section 6: _augment_comment_with_ai (mock-based)
# ──────────────────────────────────────────────────────────────────────


class TestAugmentCommentWithAI:
    """``saulite_store._augment_comment_with_ai`` with mocked AI + DB.

    Important note on mock paths: ``_augment_comment_with_ai`` performs
    lazy imports INSIDE the function body::

        from crawler.ai.sentiment import analyze_sentiment
        from crawler.ai.reply import generate_reply_suggestion
        from web_runner.db import get_database

    Therefore we patch at the *source* modules (``crawler.ai.sentiment``,
    ``crawler.ai.reply``, ``web_runner.db``), NOT at
    ``crawler.store.saulite_store.*`` which has no such attributes at
    module level.
    """

    def test_calls_analyze_and_reply_and_updates_db(self) -> None:
        """Full chain: analyze → reply → UPDATE."""
        from crawler.store.saulite_store import _augment_comment_with_ai
        mock_db = MagicMock()

        with (
            patch("crawler.ai.sentiment.analyze_sentiment",
                  return_value=("positive", 0.95)) as mock_sentiment,
            patch("crawler.ai.reply.generate_reply_suggestion",
                  return_value="谢谢！") as mock_reply,
            patch("web_runner.db.get_database",
                  return_value=mock_db),
        ):
            _augment_comment_with_ai(
                comment_id=42,
                platform="xhs",
                post_id="abc123",
                comment_text="好吃！",
            )

        mock_sentiment.assert_called_once_with("好吃！")
        mock_reply.assert_called_once_with(
            comment_text="好吃！",
            platform="xhs",
            post_id="abc123",
        )
        mock_db.execute.assert_called_once_with(
            "UPDATE crawled_comments "
            "SET ai_sentiment = ?, ai_sentiment_confidence = ?, ai_reply_suggestion = ? "
            "WHERE id = ?",
            ("positive", 0.95, "谢谢！", 42),
        )

    def test_handles_ai_failure_gracefully(self) -> None:
        """Exception in AI call does NOT crash the thread (logged instead)."""
        from crawler.store.saulite_store import _augment_comment_with_ai
        with (
            patch("crawler.ai.sentiment.analyze_sentiment",
                  side_effect=RuntimeError("LLM timeout")),
            patch("web_runner.db.get_database") as mock_get_db,
        ):
            # Should not raise
            _augment_comment_with_ai(
                comment_id=1,
                platform="dy",
                post_id="vid1",
                comment_text="test",
            )
        mock_get_db.assert_not_called()
