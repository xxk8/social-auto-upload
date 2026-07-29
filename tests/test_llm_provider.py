"""Unit tests for llm_provider (no live network except optional local)."""
from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

from web_runner.llm_provider import (
    _extract_chat_text,
    complete_chat,
    has_chat_provider,
    llm_config,
    media_config,
)


def test_llm_config_defaults_local(monkeypatch):
    monkeypatch.delenv("SAU_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("SAU_LLM_API_KEY", raising=False)
    monkeypatch.delenv("SAU_LLM_MODEL", raising=False)
    monkeypatch.delenv("OPENROUTE_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    cfg = llm_config()
    assert "127.0.0.1:8317" in cfg["base_url"]
    assert cfg["model"] == "local-chat"
    assert cfg["api_key"]  # default local key
    assert has_chat_provider()


def test_media_defaults_same_local_base(monkeypatch):
    monkeypatch.setenv("SAU_LLM_BASE_URL", "http://127.0.0.1:8317/v1")
    monkeypatch.delenv("SAU_MEDIA_BASE_URL", raising=False)
    monkeypatch.delenv("SAU_IMAGE_MODEL", raising=False)
    monkeypatch.delenv("SAU_VIDEO_MODEL", raising=False)
    for k in ("AGNES_API_KEY", "AGNES_API_TOKEN", "APIHUB_AGNES_API_KEY"):
        monkeypatch.setenv(k, "")
    m = media_config()
    assert m["base_url"] == "http://127.0.0.1:8317/v1"
    assert m["image_model"] == "local-image"
    assert m["video_model"] == "local-video"


def test_media_config_can_diverge(monkeypatch):
    monkeypatch.setenv("SAU_LLM_BASE_URL", "http://127.0.0.1:8317/v1")
    monkeypatch.setenv("SAU_MEDIA_BASE_URL", "https://api.x.ai/v1")
    monkeypatch.setenv("SAU_MEDIA_API_KEY", "xai-test")
    m = media_config()
    assert m["base_url"] == "https://api.x.ai/v1"
    assert m["api_key"] == "xai-test"


def test_local_only_default_on_loopback(monkeypatch):
    from web_runner.llm_provider import local_only

    monkeypatch.setenv("SAU_LLM_BASE_URL", "http://127.0.0.1:8317/v1")
    monkeypatch.delenv("SAU_LLM_LOCAL_ONLY", raising=False)
    assert local_only() is True
    monkeypatch.setenv("SAU_LLM_LOCAL_ONLY", "0")
    assert local_only() is False


def test_extract_chat_completions():
    data = {
        "choices": [{"message": {"role": "assistant", "content": "  hello  "}}]
    }
    assert _extract_chat_text(data) == "hello"


def test_extract_responses_api():
    data = {
        "output": [
            {"type": "reasoning", "summary": [{"text": "think"}]},
            {
                "type": "message",
                "content": [{"type": "output_text", "text": "pong"}],
            },
        ]
    }
    assert _extract_chat_text(data) == "pong"


def test_complete_chat_uses_primary(monkeypatch):
    monkeypatch.setenv("SAU_LLM_BASE_URL", "http://127.0.0.1:8317/v1")
    monkeypatch.setenv("SAU_LLM_API_KEY", "sk-test")
    monkeypatch.setenv("SAU_LLM_MODEL", "local-chat")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": '{"ok":true}'}}]
    }

    with patch("web_runner.llm_provider.http_requests.post", return_value=mock_resp) as post:
        text = complete_chat(
            [{"role": "user", "content": "hi"}],
            max_tokens=10,
        )
        assert text == '{"ok":true}'
        assert post.called
        url = post.call_args[0][0]
        assert url.endswith("/chat/completions")
        body = post.call_args[1]["json"]
        assert body["model"] == "local-chat"
        # Loopback must disable system HTTP_PROXY (Clash 108x etc.)
        assert post.call_args[1].get("proxies") == {"http": None, "https": None}


def test_request_kwargs_bypass_proxy_on_loopback():
    from web_runner.llm_provider import _request_kwargs

    kw = _request_kwargs("http://127.0.0.1:8317/v1", timeout=(1, 2))
    assert kw["proxies"] == {"http": None, "https": None}
    kw2 = _request_kwargs("https://api.x.ai/v1", timeout=5)
    assert "proxies" not in kw2
