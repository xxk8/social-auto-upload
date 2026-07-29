"""AI model config, media content helpers, and OpenRouter key pool."""
from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta
from typing import Any

import requests as http_requests

from web_runner.db import db_lock, get_connection

_ai_request_semaphore = threading.Semaphore(2)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# After a 429, skip the key for this many seconds, then allow retry.
RATE_LIMIT_COOLDOWN_SEC = int(os.environ.get("SAU_AI_KEY_COOLDOWN_SEC", "90"))

AI_MODELS = {
    # Agnes AI (remote)
    "agnes-image-2.1-flash": "Agnes Image 2.1 Flash",
    "agnes-video-v2.0": "Agnes Video V2.0",
    # OpenRouter free models
    "google/gemma-4-26b-a4b-it:free": "Gemma 4 26B",
    "deepseek/deepseek-chat-v3-0324:free": "DeepSeek V3",
    "qwen/qwen3-235b-a22b:free": "Qwen3 235B",
}

DEFAULT_SYSTEM_PROMPT = """你是一个专业的社交媒体内容创作者。请根据用户的要求生成高质量的社交媒体内容。
要求：
- 内容要有吸引力和互动性
- 适合中国社交媒体平台
- 语言自然、亲切
- 包含适当的emoji"""

PLATFORM_PROMPTS = {
    "douyin": "你是抖音内容创作专家。生成适合短视频平台的吸引人文案，要简洁有力，有hook。",
    "xiaohongshu": "你是小红书内容创作专家。生成种草风格的笔记内容，要有真实感和分享感。",
    "kuaishou": "你是快手内容创作专家。生成接地气、有温度的内容。",
    "bilibili": "你是B站内容创作专家。生成适合年轻用户群体的创意内容。",
    "youtube": (
        "You are a YouTube packaging expert. Write an English (or bilingual) title, "
        "description, and tags optimized for search + retention: strong hook in the "
        "first line, timestamps-friendly structure, 8–15 tags, CTA for like/subscribe."
    ),
    "tiktok": "You are a TikTok caption expert. Short, punchy, hashtag-heavy hooks.",
    "tencent": "你是微信视频号内容专家。文案偏生活化、信任感强，适合私域触达。",
    "baijiahao": "你是百家号内容专家。偏资讯/知识科普风格，标题清晰、信息密度适中。",
}


def _get_all_keys_cached() -> list[dict]:
    with db_lock:
        with get_connection() as conn:
            rows = conn.execute("SELECT * FROM ai_api_keys ORDER BY id ASC").fetchall()
            return [dict(r) if not isinstance(r, dict) else r for r in rows]


# Alias used by unit tests / older patch targets (``web_runner._get_all_keys``).
_get_all_keys = _get_all_keys_cached


def _parse_rate_limited_at(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00").split("+")[0])
    except (TypeError, ValueError):
        return None


def _is_key_cooling_down(key_row: dict) -> bool:
    """True while the key is still inside the post-429 cooldown window."""
    limited_at = _parse_rate_limited_at(key_row.get("rate_limited_at"))
    if limited_at is None:
        return False
    return datetime.now() - limited_at < timedelta(seconds=RATE_LIMIT_COOLDOWN_SEC)


def _get_next_key() -> str:
    """
    Round-robin-ish pick: first non-cooling key, then env fallback.
    When every key is cooling, return the least-recently-limited one so
    the stream layer can still try (and re-mark if still 429).
    """
    keys = _get_all_keys_cached()
    if not keys:
        return (
            os.environ.get("OPENROUTE_API_KEY", "")
            or os.environ.get("OPENROUTER_API_KEY", "")
        )
    available = [k for k in keys if not _is_key_cooling_down(k)]
    if available:
        return available[0]["api_key"]
    # All cooling — pick oldest rate_limited_at (soonest to recover).
    def _sort_key(k: dict) -> datetime:
        return _parse_rate_limited_at(k.get("rate_limited_at")) or datetime.min

    oldest = sorted(keys, key=_sort_key)[0]
    return oldest["api_key"]


def _mark_rate_limited(key: str) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "UPDATE ai_api_keys SET rate_limited_at = ? WHERE api_key = ?",
                (now, key),
            )
            conn.commit()


def _clear_rate_limited(key: str) -> None:
    """Clear cooldown after a successful request so the key re-enters rotation."""
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "UPDATE ai_api_keys SET rate_limited_at = NULL WHERE api_key = ?",
                (key,),
            )
            conn.commit()


def _validate_openrouter_key(api_key: str) -> dict:
    """
    Probe OpenRouter with the candidate key (GET /auth/key).
    Returns {ok: bool, message?: str, data?: {...}}.
    Never stores the key.
    """
    key = (api_key or "").strip()
    if not key:
        return {"ok": False, "message": "API key 为空"}
    if not key.startswith("sk-"):
        return {"ok": False, "message": "OpenRouter key 应以 sk- 开头"}
    try:
        resp = http_requests.get(
            f"{OPENROUTER_BASE_URL}/auth/key",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            timeout=15,
        )
    except (http_requests.RequestException, OSError, TimeoutError) as e:
        return {"ok": False, "message": f"网络错误：{type(e).__name__}"}

    if resp.status_code == 200:
        body = resp.json() if resp.content else {}
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            data = body if isinstance(body, dict) else {}
        return {
            "ok": True,
            "message": "Key 有效",
            "data": {
                "label": data.get("label") or data.get("name") or "",
                "usage": data.get("usage"),
                "limit": data.get("limit"),
                "is_free_tier": data.get("is_free_tier"),
                "rate_limit": data.get("rate_limit"),
            },
        }
    if resp.status_code == 401:
        return {"ok": False, "message": "Key 无效或已吊销"}
    if resp.status_code == 402:
        return {"ok": False, "message": "账户余额不足 / 需要充值"}
    if resp.status_code == 429:
        return {"ok": False, "message": "该 Key 当前被限流，稍后再试"}
    try:
        err = resp.json().get("error", {}).get("message") or resp.text[:200]
    except Exception:
        err = f"HTTP {resp.status_code}"
    return {"ok": False, "message": str(err) or f"校验失败 HTTP {resp.status_code}"}


def _has_any_api_key() -> bool:
    keys = _get_all_keys_cached()
    if keys:
        return True
    if os.environ.get("OPENROUTE_API_KEY") or os.environ.get("OPENROUTER_API_KEY"):
        return True
    if os.environ.get("SAU_LLM_API_KEY"):
        return True
    # Local proxy default key (see web_runner.llm_provider.llm_config).
    try:
        from web_runner.llm_provider import llm_config

        return bool(llm_config().get("api_key"))
    except Exception:
        return False


def _build_media_content(images: list, prompt: str = "") -> list:
    content = []
    for img in images:
        if img.startswith("data:image"):
            content.append({"type": "image_url", "image_url": {"url": img}})
        elif img.startswith("http"):
            content.append({"type": "image_url", "image_url": {"url": img}})
    if prompt:
        content.append({"type": "text", "text": prompt})
    return content
