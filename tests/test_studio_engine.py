"""Tests for ``web_runner.studio_engine`` — Studio AI script generation engine.

OpenSpec ref: ``openspec/changes/studio-ai-script-generation/tasks.md §7.1``.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from web_runner.studio_engine import (
    _parse_episodes_json,
    _has_agnes_key,
    _yield_data_event,
    _yield_done_event,
    _yield_error_event,
    generate_episodes_sse,
)


class TestParseEpisodesJson:
    """``_parse_episodes_json`` extraction strategies."""

    def test_parse_valid_json(self):
        text = json.dumps(
            {
                "episodes": [
                    {"act": "起", "title": "开端", "scenes": [], "dialogues": []},
                    {"act": "合", "title": "结局", "scenes": [], "dialogues": []},
                ]
            },
            ensure_ascii=False,
        )
        result = _parse_episodes_json(text)
        assert result is not None
        assert len(result) == 2
        assert result[0]["act"] == "起"
        assert result[1]["act"] == "合"

    def test_parse_code_fenced_json(self):
        inner = json.dumps(
            {"episodes": [{"act": "起", "title": "开端"}]},
            ensure_ascii=False,
        )
        text = f"```json\n{inner}\n```"
        result = _parse_episodes_json(text)
        assert result is not None
        assert result[0]["act"] == "起"

    def test_parse_json_in_text(self):
        inner = json.dumps({"episodes": [{"act": "转", "title": "转折"}]}, ensure_ascii=False)
        text = f"AI 生成的剧本如下：{inner} 请查收。"
        result = _parse_episodes_json(text)
        assert result is not None
        assert result[0]["act"] == "转"

    def test_parse_invalid_returns_none(self):
        assert _parse_episodes_json("not json") is None

    def test_parse_missing_episodes_key(self):
        text = json.dumps({"scenes": []}, ensure_ascii=False)
        assert _parse_episodes_json(text) is None


class TestHasAgnesKey:
    """Environment-driven key detection."""

    def test_has_agnes_key_true(self):
        with patch.dict("os.environ", {"AGNES_API_KEY": "sk-agnes"}, clear=False):
            assert _has_agnes_key() is True

    def test_has_agnes_key_false(self):
        with patch.dict("os.environ", {"AGNES_API_KEY": ""}, clear=True):
            assert _has_agnes_key() is False


class TestSSEEventHelpers:
    """Low-level SSE event formatting."""

    def test_yield_data_event(self):
        event = _yield_data_event("hello")
        assert event.startswith("event: data\ndata: ")
        data = json.loads(event.split("data: ", 1)[1])
        assert data["content"] == "hello"

    def test_yield_done_event(self):
        event = _yield_done_event("full")
        assert event.startswith("event: done\ndata: ")
        data = json.loads(event.split("data: ", 1)[1])
        assert data["content"] == "full"

    def test_yield_error_event(self):
        event = _yield_error_event("boom")
        assert event.startswith("event: error\ndata: ")
        data = json.loads(event.split("data: ", 1)[1])
        assert data["message"] == "boom"


class TestGenerateEpisodesSSE:
    """End-to-end generator behaviour with mocked upstreams."""

    def _make_valid_done_event(self) -> str:
        payload = {
            "episodes": [
                {"act": "起", "title": "开端", "scenes": [], "dialogues": []},
                {"act": "承", "title": "递进", "scenes": [], "dialogues": []},
                {"act": "转", "title": "转折", "scenes": [], "dialogues": []},
                {"act": "合", "title": "结局", "scenes": [], "dialogues": []},
            ]
        }
        full = json.dumps(payload, ensure_ascii=False)
        return _yield_done_event(full)

    def test_no_key_yields_error(self):
        with patch.dict("os.environ", {"AGNES_API_KEY": ""}, clear=True):
            with patch("web_runner.routes.ai._get_next_key", return_value=""):
                events = list(generate_episodes_sse("标题", "梗概", None))
        assert any("未配置 AI API key" in e for e in events)

    def test_agnes_success_yields_generation_done(self):
        done_event = self._make_valid_done_event()

        def fake_agnes(*args, **kwargs):
            yield _yield_data_event("思考中")
            yield done_event

        with patch.dict("os.environ", {"AGNES_API_KEY": "sk-agnes"}, clear=False):
            with patch("web_runner.studio_engine._stream_agnes", fake_agnes):
                events = list(generate_episodes_sse("标题", "梗概", None))

        types = [e.split("\n", 1)[0] for e in events]
        assert "event: data" in types
        assert "event: generation_done" in types

    def test_agnes_error_falls_back_to_openrouter(self):
        done_event = self._make_valid_done_event()

        def fake_agnes(*args, **kwargs):
            yield _yield_error_event("agnes down")

        def fake_openrouter(*args, **kwargs):
            yield _yield_data_event("fallback")
            yield done_event

        with patch.dict("os.environ", {"AGNES_API_KEY": "sk-agnes"}, clear=False):
            with patch("web_runner.studio_engine._stream_agnes", fake_agnes):
                with patch("web_runner.studio_engine._stream_openrouter_fallback", fake_openrouter):
                    events = list(generate_episodes_sse("标题", "梗概", None))

        assert any("fallback" in e for e in events)
        assert any("event: generation_done" in e for e in events)

    def test_invalid_json_yields_error(self):
        def fake_openrouter(*args, **kwargs):
            yield _yield_done_event("not json")

        with patch.dict("os.environ", {"AGNES_API_KEY": ""}, clear=True):
            with patch("web_runner.routes.ai._get_next_key", return_value="sk-or"):
                with patch("web_runner.studio_engine._stream_openrouter_fallback", fake_openrouter):
                    events = list(generate_episodes_sse("标题", "梗概", None))

        assert any("格式异常" in e for e in events)
