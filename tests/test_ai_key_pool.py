"""Unit tests for OpenRouter key validate + rotation helpers."""

from datetime import datetime, timedelta
from unittest.mock import Mock, patch

import pytest


class TestValidateOpenrouterKey:
    def test_empty_key(self):
        from web_runner.ai_worker import _validate_openrouter_key

        assert _validate_openrouter_key("")["ok"] is False
        assert _validate_openrouter_key("   ")["ok"] is False

    def test_rejects_non_sk_prefix(self):
        from web_runner.ai_worker import _validate_openrouter_key

        r = _validate_openrouter_key("or-v1-nope")
        assert r["ok"] is False
        assert "sk-" in r["message"]

    @patch("web_runner.ai_worker.http_requests.get")
    def test_200_ok(self, mock_get):
        from web_runner.ai_worker import _validate_openrouter_key

        mock_get.return_value = Mock(
            status_code=200,
            content=b'{"data":{"label":"main","usage":1.2,"limit":null,"is_free_tier":true}}',
            json=lambda: {
                "data": {
                    "label": "main",
                    "usage": 1.2,
                    "limit": None,
                    "is_free_tier": True,
                }
            },
        )
        r = _validate_openrouter_key("sk-or-v1-testkey")
        assert r["ok"] is True
        assert r["data"]["label"] == "main"

    @patch("web_runner.ai_worker.http_requests.get")
    def test_401_invalid(self, mock_get):
        from web_runner.ai_worker import _validate_openrouter_key

        mock_get.return_value = Mock(status_code=401, content=b"{}", json=lambda: {})
        r = _validate_openrouter_key("sk-or-v1-dead")
        assert r["ok"] is False
        assert "无效" in r["message"]

    @patch("web_runner.ai_worker.http_requests.get")
    def test_429_rate_limited(self, mock_get):
        from web_runner.ai_worker import _validate_openrouter_key

        mock_get.return_value = Mock(status_code=429, content=b"{}", json=lambda: {})
        r = _validate_openrouter_key("sk-or-v1-hot")
        assert r["ok"] is False
        assert "限流" in r["message"]


class TestKeyCooldown:
    def test_not_cooling_without_timestamp(self):
        from web_runner.ai_worker import _is_key_cooling_down

        assert _is_key_cooling_down({"rate_limited_at": None}) is False
        assert _is_key_cooling_down({}) is False

    def test_cooling_within_window(self):
        from web_runner.ai_worker import _is_key_cooling_down

        recent = (datetime.now() - timedelta(seconds=10)).isoformat(timespec="seconds")
        assert _is_key_cooling_down({"rate_limited_at": recent}) is True

    def test_recovered_after_window(self):
        from web_runner.ai_worker import RATE_LIMIT_COOLDOWN_SEC, _is_key_cooling_down

        old = (
            datetime.now() - timedelta(seconds=RATE_LIMIT_COOLDOWN_SEC + 5)
        ).isoformat(timespec="seconds")
        assert _is_key_cooling_down({"rate_limited_at": old}) is False

    @patch("web_runner.ai_worker._get_all_keys_cached")
    def test_get_next_key_skips_cooling(self, mock_keys):
        from web_runner.ai_worker import _get_next_key

        recent = (datetime.now() - timedelta(seconds=5)).isoformat(timespec="seconds")
        mock_keys.return_value = [
            {"id": 1, "api_key": "sk-hot", "rate_limited_at": recent},
            {"id": 2, "api_key": "sk-ok", "rate_limited_at": None},
        ]
        assert _get_next_key() == "sk-ok"

    @patch("web_runner.ai_worker._get_all_keys_cached")
    def test_get_next_key_falls_back_to_oldest_when_all_cooling(self, mock_keys):
        from web_runner.ai_worker import _get_next_key

        older = (datetime.now() - timedelta(seconds=60)).isoformat(timespec="seconds")
        newer = (datetime.now() - timedelta(seconds=5)).isoformat(timespec="seconds")
        mock_keys.return_value = [
            {"id": 1, "api_key": "sk-newer", "rate_limited_at": newer},
            {"id": 2, "api_key": "sk-older", "rate_limited_at": older},
        ]
        assert _get_next_key() == "sk-older"


class TestStreamClearsRateLimitOnSuccess:
    @patch("web_runner.routes.ai._clear_rate_limited")
    @patch("web_runner.routes.ai._get_all_keys")
    @patch("web_runner.routes.ai._get_next_key")
    @patch("web_runner.routes.ai.http_requests.post")
    @patch("web_runner.routes.ai._mark_rate_limited")
    def test_success_clears_cooldown(
        self, mock_mark, mock_post, mock_next_key, mock_all_keys, mock_clear
    ):
        from web_runner.routes.ai import _stream_openrouter

        mock_all_keys.return_value = [
            {"id": 1, "api_key": "sk-key-1", "masked": "sk-****abcd"}
        ]
        mock_next_key.return_value = "sk-key-1"
        resp = Mock()
        resp.status_code = 200
        resp.iter_lines.return_value = [b"data: [DONE]"]
        mock_post.return_value = resp

        list(_stream_openrouter("test/model", [{"role": "user", "content": "hi"}]))
        mock_clear.assert_called_once_with("sk-key-1")
        assert mock_mark.call_count == 0
