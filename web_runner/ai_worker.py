"""AI model config, media content helpers, and OpenRouter key pool."""
from __future__ import annotations

import os
import threading

from web_runner.db import db_lock, get_connection

_ai_request_semaphore = threading.Semaphore(2)

AI_MODELS = {
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
            conn.row_factory = __import__("sqlite3").Row
            rows = conn.execute("SELECT * FROM ai_api_keys ORDER BY id ASC").fetchall()
            return [dict(r) for r in rows]


# Alias used by unit tests / older patch targets (``web_runner._get_all_keys``).
_get_all_keys = _get_all_keys_cached


def _get_next_key() -> str:
    keys = _get_all_keys_cached()
    if not keys:
        return os.environ.get("OPENROUTE_API_KEY", "")
    for k in keys:
        if not k.get("rate_limited_at"):
            return k["api_key"]
    return keys[0]["api_key"] if keys else ""


def _mark_rate_limited(key: str) -> None:
    from datetime import datetime

    now = datetime.now().isoformat(timespec="seconds")
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "UPDATE ai_api_keys SET rate_limited_at = ? WHERE api_key = ?",
                (now, key),
            )
            conn.commit()


def _has_any_api_key() -> bool:
    keys = _get_all_keys_cached()
    if keys:
        return True
    return bool(os.environ.get("OPENROUTE_API_KEY", ""))


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
