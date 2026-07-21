import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from web_runner import create_app
from web_runner import utils as wr_utils
from web_runner.db import get_database


@pytest.fixture
def app():
    with tempfile.TemporaryDirectory() as tmp_dir:
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = Path(tmp_dir)
        try:
            application = create_app()
            application.config["TESTING"] = True
            get_database().execute("DELETE FROM ai_api_keys")
            get_database().execute(
                "INSERT INTO ai_api_keys (api_key, masked, created) VALUES (?, ?, ?)",
                ("test-key-1234", "test-****-1234", "2026-01-01"),
            )
            with application.test_client() as client:
                yield client
        finally:
            wr_utils.COOKIES_DIR = orig_cookies_dir
            get_database().execute("DELETE FROM ai_api_keys")


class TestMultiPlatformEndpoint:
    def test_empty_topic_returns_400(self, app):
        with patch("web_runner.routes.auth._is_auth_enabled", return_value=False):
            resp = app.post("/api/ai/generate/multi-platform", json={"topic": "", "platforms": ["douyin"]})
        assert resp.status_code == 400
        assert "Topic is required" in resp.get_json()["message"]

    def test_empty_platforms_returns_400(self, app):
        with patch("web_runner.routes.auth._is_auth_enabled", return_value=False):
            resp = app.post("/api/ai/generate/multi-platform", json={"topic": "test", "platforms": []})
        assert resp.status_code == 400
        assert "At least one platform" in resp.get_json()["message"]

    def test_invalid_platform_returns_400(self, app):
        with patch("web_runner.routes.auth._is_auth_enabled", return_value=False):
            resp = app.post("/api/ai/generate/multi-platform", json={"topic": "test", "platforms": ["unknown"]})
        assert resp.status_code == 400
        assert "Unsupported platform" in resp.get_json()["message"]

    def test_mixed_valid_invalid_platforms_returns_400(self, app):
        with patch("web_runner.routes.auth._is_auth_enabled", return_value=False):
            resp = app.post(
                "/api/ai/generate/multi-platform", json={"topic": "test", "platforms": ["douyin", "bad_one"]}
            )
        assert resp.status_code == 400
        assert "bad_one" in resp.get_json()["message"]

    def test_no_api_key_returns_error(self, app):
        get_database().execute("DELETE FROM ai_api_keys")
        with patch("web_runner.routes.auth._is_auth_enabled", return_value=False):
            resp = app.post("/api/ai/generate/multi-platform", json={"topic": "test", "platforms": ["douyin"]})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is False


class TestParseJsonFromText:
    def test_clean_json(self):
        from web_runner.routes.ai import _parse_json_from_text

        result = _parse_json_from_text('{"title": "t", "description": "d", "tags": ["a"]}')
        assert result == {"title": "t", "description": "d", "tags": ["a"]}

    def test_json_in_code_fence(self):
        from web_runner.routes.ai import _parse_json_from_text

        text = '```json\n{"title": "t", "description": "d", "tags": ["a"]}\n```'
        result = _parse_json_from_text(text)
        assert result == {"title": "t", "description": "d", "tags": ["a"]}

    def test_json_with_surrounding_text(self):
        from web_runner.routes.ai import _parse_json_from_text

        text = 'Here is the result:\n{"title": "t", "description": "d", "tags": ["a"]}\nHope this helps!'
        result = _parse_json_from_text(text)
        assert result == {"title": "t", "description": "d", "tags": ["a"]}

    def test_unparseable_returns_none(self):
        from web_runner.routes.ai import _parse_json_from_text

        result = _parse_json_from_text("This is not JSON at all")
        assert result is None

    def test_empty_string_returns_none(self):
        from web_runner.routes.ai import _parse_json_from_text

        result = _parse_json_from_text("")
        assert result is None


class TestSupportedPlatforms:
    def test_all_seven_platforms_in_supported_set(self):
        from web_runner.routes.ai import SUPPORTED_PLATFORMS

        expected = {"douyin", "xiaohongshu", "kuaishou", "bilibili", "tencent", "tiktok", "baijiahao"}
        assert SUPPORTED_PLATFORMS == expected

    def test_all_platforms_have_style_prompts(self):
        from web_runner.routes.ai import PLATFORM_STYLE_PROMPTS, SUPPORTED_PLATFORMS

        for p in SUPPORTED_PLATFORMS:
            assert p in PLATFORM_STYLE_PROMPTS, f"Missing style prompt for {p}"


class TestVariantsEndpoint:
    def test_empty_topic_returns_400(self, app):
        with patch("web_runner.routes.auth._is_auth_enabled", return_value=False):
            resp = app.post("/api/ai/generate/variants", json={"topic": ""})
        assert resp.status_code == 400
        assert "Topic is required" in resp.get_json()["message"]

    def test_no_api_key_returns_error(self, app):
        get_database().execute("DELETE FROM ai_api_keys")
        with patch("web_runner.routes.auth._is_auth_enabled", return_value=False):
            resp = app.post("/api/ai/generate/variants", json={"topic": "test"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is False


class TestSearchEndpoint:
    def test_empty_query_returns_400(self, app):
        with patch("web_runner.routes.auth._is_auth_enabled", return_value=False):
            resp = app.post("/api/ai/search", json={"query": ""})
        assert resp.status_code == 400
        assert "Query is required" in resp.get_json()["message"]

    def test_search_returns_results(self, app):
        with (
            patch("web_runner.routes.auth._is_auth_enabled", return_value=False),
            patch(
                "web_runner.routes.ai._web_search",
                return_value=[{"title": "Test Title", "snippet": "Test snippet", "url": "https://example.com"}],
            ),
        ):
            resp = app.post("/api/ai/search", json={"query": "test topic"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert len(data["data"]) == 1
        assert data["data"][0]["title"] == "Test Title"


class TestStyleVariants:
    def test_all_four_styles_defined(self):
        from web_runner.routes.ai import STYLE_VARIANT_LABELS, STYLE_VARIANTS

        expected = {"attention", "professional", "friendly", "creative"}
        assert set(STYLE_VARIANTS.keys()) == expected
        assert set(STYLE_VARIANT_LABELS.keys()) == expected

    def test_all_style_prompts_are_substantial(self):
        from web_runner.routes.ai import STYLE_VARIANTS

        for style, prompt in STYLE_VARIANTS.items():
            assert len(prompt) > 50, f"Style prompt for {style} is too short"

    def test_style_labels_are_chinese(self):
        from web_runner.routes.ai import STYLE_VARIANT_LABELS

        for style, label in STYLE_VARIANT_LABELS.items():
            assert any("\u4e00" <= c <= "\u9fff" for c in label), f"Label for {style} should contain Chinese characters"
