"""AI content generation routes (PR2: dialect-aware Database)."""
from __future__ import annotations

import concurrent.futures
import json
import os
import queue as _queue
import sqlite3
import threading
import time
from collections import deque
from collections.abc import Generator

import requests as http_requests
from flask import Blueprint, Response, jsonify, request

# NOTE: `web_runner.utils.log` is a function-like helper `def log(msg)` —
# it does NOT expose `.warning()` etc. To emit a real python-logging
# WARNING-level message we instead import the logger object that
# `web_runner.utils` itself uses via `_task_logger`. Alias as `logger`
# so call sites read `logger.warning(...)`. The legacy `log(msg)`
# function (used elsewhere in ai.py for INFO-level DB-backed logging)
# is unaffected.
from utils.log import logger  # noqa: E402  (after stdlib + 3rd-party imports)
from web_runner.db import get_database
from web_runner.utils import log

bp = Blueprint("ai", __name__)

OPENROUTE_BASE_URL = "https://openrouter.ai/api/v1"


def _web_search(query: str, max_results: int = 5) -> list[dict]:
    """Search the web using DuckDuckGo. Returns list of {title, snippet, url}."""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
            return [
                {"title": r.get("title", ""), "snippet": r.get("body", ""), "url": r.get("href", "")}
                for r in results
            ]
    except Exception as e:
        log.warning(f"[ai] Web search failed: {e}")
        return []


# ── Image search helpers (openspec ai-sidebar-material-search §1) ───
# Two-source aggregator: Pexels (api_key 200/h) + Pixabay (api_key 5000/h)
# free tier. Both sources are paid API-only; neither key set → 503, never
# silently fall back to DuckDuckGo (text-quality too low for publishing
# imagery). Pure-function normalizers below + ThreadPoolExecutor
# concurrent caller + per-user sliding-window rate limit + binary proxy
# with SSRF gates via inbox._is_public_url + inbox._resolve_is_public.
def _has_image_source() -> bool:
    """True iff at least one image-source API key is configured.

    Treated as build-time / .env-controlled (operator config), not
    user-managed like AI_MODELS. See docs/ai-material-search.md for
    how to obtain PEXELS_API_KEY / PIXABAY_API_KEY.
    """
    return bool(os.environ.get("PEXELS_API_KEY", "").strip()) or bool(
        os.environ.get("PIXABAY_API_KEY", "").strip()
    )


def _search_pexels(query: str, count: int) -> list[dict]:
    """Raw Pexels photo search. Returns the upstream `photos` list (or []).

    Silent-failure-by-design: 401 / 429 / 5xx / timeout / JSONDecodeError
    all collapse to `[]` so the merge layer can still surface Pixabay
    results. Rationale: aggregator should not cascade one source's
    transient failure onto the other.
    """
    api_key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not api_key:
        return []
    try:
        resp = http_requests.get(
            "https://api.pexels.com/v1/search",
            headers={"Authorization": api_key},
            params={"query": query, "per_page": max(1, count), "page": 1},
            timeout=(5, 8),
        )
    except (http_requests.RequestException, OSError, TimeoutError) as e:
        logger.warning(f"[ai] Pexels connect failed: {type(e).__name__}: {e}")
        return []
    if resp.status_code != 200:
        logger.warning(f"[ai] Pexels search returned {resp.status_code} for query={query!r}")
        return []
    try:
        return resp.json().get("photos") or []
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"[ai] Pexels search JSON decode failed: {type(e).__name__}: {e}")
        return []


def _search_pixabay(query: str, count: int) -> list[dict]:
    """Raw Pixabay hit search. Returns the upstream `hits` list (or [])."""
    api_key = os.environ.get("PIXABAY_API_KEY", "").strip()
    if not api_key:
        return []
    try:
        resp = http_requests.get(
            "https://pixabay.com/api/",
            params={
                "key": api_key,
                "q": query,
                "per_page": max(3, count),
                "page": 1,
                "image_type": "photo",
            },
            timeout=(5, 8),
        )
    except (http_requests.RequestException, OSError, TimeoutError) as e:
        logger.warning(f"[ai] Pixabay connect failed: {type(e).__name__}: {e}")
        return []
    if resp.status_code != 200:
        logger.warning(f"[ai] Pixabay search returned {resp.status_code} for query={query!r}")
        return []
    try:
        return resp.json().get("hits") or []
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"[ai] Pixabay search JSON decode failed: {type(e).__name__}: {e}")
        return []


def _normalize_pexels_photo(p: dict) -> dict:
    """Pexels raw photo → uniform `NormalizedImage` schema (pure function).

    `thumb` / `preview` / `full` map onto a 3-tier size contract so the
    frontend can pick per surface. `id` is stringified as
    `f"pexels:{photo_id}"` so the merge layer can dedupe against
    `f"pixabay:{hit_id}"` without collisions.
    """
    src = p.get("src") or {}
    photographer = p.get("photographer") or ""
    photo_id = p.get("id")
    str_id = f"pexels:{photo_id}" if photo_id is not None else ""
    return {
        "id": str_id,
        "source": "pexels",
        "thumb": src.get("medium") or src.get("small") or src.get("tiny") or "",
        "preview": src.get("large2x") or src.get("large") or src.get("original") or "",
        "full": src.get("original") or "",
        "photographer": photographer,
        "photographerUrl": p.get("photographer_url"),
        "pageUrl": p.get("url") or "",
        "alt": p.get("alt") or "",
    }


def _normalize_pixabay_hit(h: dict) -> dict:
    """Pixabay raw hit → uniform `NormalizedImage` schema (pure function).

    Pixabay's `fullHDURL` is only set on hits that actually upload a UHD
    version (subset of `largeImageURL`); fall back progressively so a
    missing field doesn't strand `full === ""`.
    """
    user = h.get("user") or ""
    user_id = h.get("user_id", "")
    hit_id = h.get("id")
    str_id = f"pixabay:{hit_id}" if hit_id is not None else ""
    photographer_url = (
        f"https://pixabay.com/users/{user}-{user_id}/" if user and user_id is not None else None
    )
    return {
        "id": str_id,
        "source": "pixabay",
        "thumb": h.get("webformatURL") or h.get("previewURL") or "",
        "preview": h.get("largeImageURL") or h.get("webformatURL") or "",
        "full": h.get("fullHDURL") or h.get("largeImageURL") or h.get("webformatURL") or "",
        "photographer": user,
        "photographerUrl": photographer_url,
        "pageUrl": h.get("pageURL") or "",
        "alt": h.get("tags") or "",
    }


def _merge_image_results(
    pexels_raw_list: list[dict],
    pixabay_raw_list: list[dict],
    count: int,
) -> list[dict]:
    """Two raw-source lists → normalized + dedupe + cap-to-count.

    Dedup key is `f"{source}:{upstream_id}"`. Cross-source collisions
    don't occur naturally (different CDNs) but the prefix prevents an
    accidental upstream-int collision (e.g. if both APIs ever share
    pool IDs after a future refactor).

    Iteration order: pexels first then pixabay, so the user's most-
    likely-source (Pexels for stock) leads the visible grid.
    Caps early at `count` to avoid allocating past-the-end Tailwind cards.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for raw in pexels_raw_list or []:
        try:
            norm = _normalize_pexels_photo(raw)
        except (KeyError, TypeError, AttributeError):
            continue
        if not norm["id"] or norm["id"] in seen:
            continue
        seen.add(norm["id"])
        out.append(norm)
        if len(out) >= count:
            return out
    for raw in pixabay_raw_list or []:
        try:
            norm = _normalize_pixabay_hit(raw)
        except (KeyError, TypeError, AttributeError):
            continue
        if not norm["id"] or norm["id"] in seen:
            continue
        seen.add(norm["id"])
        out.append(norm)
        if len(out) >= count:
            return out
    return out


def _search_images(query: str, count: int = 9) -> tuple[list[dict], dict]:
    """Concurrent two-source aggregator → (merged_results, debug).

    Both calls run on a `max_workers=2` ThreadPoolExecutor with an 8s
    per-source timeout. Either source's exception is logged + added
    to `debug.errors` but does NOT raise to the caller — the merge
    silently degrades. Returns empty when both fail. UI-side debug
    keys are surfaced in the response so the user can read "pexels:
    ConnectionError · pixabay: TimeoutError" without grep-shipping logs.
    """
    debug: dict = {"pexels_count": 0, "pixabay_count": 0, "merged_count": 0, "errors": []}
    pexels_raw: list[dict] = []
    pixabay_raw: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        f_pex = ex.submit(_search_pexels, query, count)
        f_pix = ex.submit(_search_pixabay, query, count)
        try:
            pexels_raw = f_pex.result(timeout=8) or []
            debug["pexels_count"] = len(pexels_raw)
        except concurrent.futures.TimeoutError:
            debug["errors"].append("pexels: TimeoutError")
            logger.warning("[ai] Pexels search timed out after 8s")
        except Exception as e:  # noqa: BLE001 — bounded by ThreadPoolExecutor's wall-clock budget
            debug["errors"].append(f"pexels: {type(e).__name__}")
            logger.warning(f"[ai] Pexels search raised: {type(e).__name__}: {e}")
        try:
            pixabay_raw = f_pix.result(timeout=8) or []
            debug["pixabay_count"] = len(pixabay_raw)
        except concurrent.futures.TimeoutError:
            debug["errors"].append("pixabay: TimeoutError")
            logger.warning("[ai] Pixabay search timed out after 8s")
        except Exception as e:  # noqa: BLE001
            debug["errors"].append(f"pixabay: {type(e).__name__}")
            logger.warning(f"[ai] Pixabay search raised: {type(e).__name__}: {e}")
    merged = _merge_image_results(pexels_raw, pixabay_raw, count)
    debug["merged_count"] = len(merged)
    return merged, debug


# ── Soft per-user rate limit (openspec §1.7) ─────────────────────────
# Sliding window per uid. Auth-disabled `authenticate_sse_request`
# returns 0 so all auth-disabled calls cluster in bucket 0 (mirrors
# inbox `_inbox_sem`'s monotonic shape). Uses `time.monotonic()`
# (NOT `time.time()`) so NTP clock jumps don't accidentally
# invalidate in-window entries. Plain `dict` + `setdefault` keeps
# the bucket creation explicit — a `defaultdict` would silently
# materialize buckets from `__contains__` lookups in tests,
# defeating the per-test cleanup pattern.
_IMAGE_CALL_LOG: dict[int, deque] = {}
_IMAGE_RATE_WINDOW_SEC = 60
_IMAGE_RATE_MAX_CALLS = 30


def _check_image_rate_limit(uid: int) -> bool:
    """Sliding-window image-search limiter.

    Returns True and appends `now` to the bucket if the caller is under
    the cap; False (no append) if at/over cap. Trims entries that
    slid out of the 60s window before counting so the boundary is
    continuous rather than fixed-clock-aligned (avoids burst-at-:00
    reset thrash).
    """
    now = time.monotonic()
    bucket = _IMAGE_CALL_LOG.setdefault(uid, deque(maxlen=64))
    while bucket and (now - bucket[0]) > _IMAGE_RATE_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= _IMAGE_RATE_MAX_CALLS:
        return False
    bucket.append(now)
    return True


# ── Image binary fetch proxy cap (openspec §1.10) ────────────────────
# Front-end CORS-unsafe to fetch Pexels/Pixabay CDNs directly + convert
# to File (Pixabay sometimes ratelimits origins; mixed-content warnings
# if dev HTTPS over localhost). Backend proxies by streaming bytes
# with a 10MB cap; the SSRF gates + iterator live inline in the
# /api/ai/images/fetch route below.
_IMAGE_FETCH_MAX_BYTES = 10 * 1024 * 1024  # 10 MB — adequate for 图文 mode (<=9 × 1 MB)


_ai_request_queue: _queue.Queue = _queue.Queue()
_ai_request_semaphore = threading.Semaphore(2)
_ai_queue_lock = threading.Lock()
_ai_queue_worker_started = False

# Hard cap on multi-turn messages array length — bounds LLM cost and
# context-window abuse. See specs/ai-stream-multimessage.
MAX_MESSAGES_PER_REQUEST = 30

AI_MODELS = {
    "google/gemma-4-26b-a4b-it:free": "Gemma 4 26B",
    "deepseek/deepseek-chat-v3-0324:free": "DeepSeek V3",
    "qwen/qwen3-235b-a22b-it:free": "Qwen3 235B",
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
    "bilibili": "你是B站内容创建专家。生成适合年轻用户群体的创意内容。",
}

SUPPORTED_PLATFORMS = {"douyin", "xiaohongshu", "kuaishou", "bilibili", "tencent", "tiktok", "baijiahao"}

PLATFORM_VARIANT_LABELS: dict[str, str] = {
    "douyin": "抖音",
    "kuaishou": "快手",
    "xiaohongshu": "小红书",
    "bilibili": "Bilibili",
    "tencent": "视频号",
    "tiktok": "TikTok",
    "baijiahao": "百家号",
}

PLATFORM_STYLE_PROMPTS: dict[str, str] = {
    "douyin": (
        "你是抖音内容创作专家。抖音的核心特征：\n"
        "- 前3秒必须有强hook，抓住用户注意力\n"
        "- 标题简短有力，10-15字为佳，可用悬念/数字/反转\n"
        "- 描述口语化，引导互动（'你觉得呢？''双击点赞'）\n"
        "- 标签用短关键词，如 #教程 #干货 #生活小技巧\n"
        "- 整体风格：快节奏、有冲击力、接地气"
    ),
    "xiaohongshu": (
        "你是小红书内容创作专家。小红书的核心特征：\n"
        "- 标题要有emoji开头，用'！''？'增强表达感\n"
        "- 种草风格，真实分享感，像朋友推荐\n"
        "- 描述分段，用emoji作为段落标记\n"
        "- 标签用#号标签，带emoji更佳，如 #好物推荐 #必买清单\n"
        "- 整体风格：精致、有生活感、女性友好"
    ),
    "kuaishou": (
        "你是快手内容创作专家。快手的核心特征：\n"
        "- 标题接地气，用家人们/老铁们等亲切称呼\n"
        "- 内容真实不做作，强调'真实记录'\n"
        "- 描述朴实真诚，少用花哨修辞\n"
        "- 标签偏生活化，如 #日常生活 #真实记录\n"
        "- 整体风格：真实、有温度、老铁文化"
    ),
    "bilibili": (
        "你是B站内容创作专家。B站的核心特征：\n"
        "- 标题可以稍微标题党，用【】包裹关键词\n"
        "- 了解弹幕文化，内容要有梗、有趣\n"
        "- 描述详细，可以加时间戳章节\n"
        "- 标签偏二次元/科技/学习，如 #知识分享 #硬核科普\n"
        "- 整体风格：年轻化、有深度、玩梗"
    ),
    "tencent": (
        "你是微信视频号内容创作专家。视频号的核心特征：\n"
        "- 标题中规中矩，适合微信生态传播\n"
        "- 内容偏正能量、知识分享、生活技巧\n"
        "- 描述简洁明了，引导转发朋友圈\n"
        "- 标签用通用关键词\n"
        "- 整体风格：稳重、正能量、适合社交传播"
    ),
    "tiktok": (
        "你是TikTok内容创作专家。TikTok的核心特征：\n"
        "- 标题用英文，简洁有冲击力\n"
        "- 前3秒hook至关重要\n"
        "- 描述简短，用英文hashtag\n"
        "- 标签用英文热门标签，如 #fyp #viral #tutorial\n"
        "- 整体风格：国际化、快节奏、娱乐性强"
    ),
    "baijiahao": (
        "你是百家号内容创作专家。百家号的核心特征：\n"
        "- 标题SEO友好，包含关键词，15-25字\n"
        "- 内容偏资讯/知识/深度分析\n"
        "- 描述正式，信息量大\n"
        "- 标签用行业关键词\n"
        "- 整体风格：专业、权威、信息密度高"
    ),
}

MULTI_PLATFORM_JSON_INSTRUCTION = (
    "\n\n请根据以上平台特征，为用户提供的主题生成内容。\n"
    "你必须严格返回一个JSON对象，格式如下：\n"
    '{"title": "生成的标题", "description": "生成的描述/正文", "tags": ["标签1", "标签2", "标签3"]}\n'
    "不要返回任何其他文字，只返回JSON对象。tags数组至少3个标签，最多10个。"
)

STYLE_VARIANTS: dict[str, str] = {
    "attention": (
        "你是内容创作专家，擅长写吸引力强的文案。你的风格特征：\n"
        "- 标题简短有力，10-15字，善用悬念、数字、反转\n"
        "- 前3秒必须有强hook，抓住用户注意力\n"
        "- 描述口语化，引导互动（'你觉得呢？''双击点赞'）\n"
        "- 标签用短关键词，如 #教程 #干货 #生活小技巧\n"
        "- 整体风格：快节奏、有冲击力、接地气"
    ),
    "professional": (
        "你是内容创作专家，擅长写专业权威的文案。你的风格特征：\n"
        "- 标题信息密度高，包含核心关键词，15-25字\n"
        "- 内容结构清晰，有条理，逻辑性强\n"
        "- 描述详细，提供有价值的信息和见解\n"
        "- 标签用行业关键词和专业术语\n"
        "- 整体风格：专业、权威、值得信赖"
    ),
    "friendly": (
        "你是内容创作专家，擅长写亲切自然的文案。你的风格特征：\n"
        "- 标题像朋友聊天一样自然，用'分享''推荐'等词\n"
        "- 内容真实不做作，有真实感和分享感\n"
        "- 描述分段，用emoji作为段落标记，增强表达感\n"
        "- 标签用生活化、有温度的关键词\n"
        "- 整体风格：亲切、自然、有温度、像朋友推荐"
    ),
    "creative": (
        "你是内容创作专家，擅长写创意有趣的文案。你的风格特征：\n"
        "- 标题可以稍微标题党，用【】包裹关键词或用有趣表达\n"
        "- 内容有梗、有趣、出人意料，能引发共鸣\n"
        "- 描述有创意，善用比喻、拟人等修辞手法\n"
        "- 标签用有趣、有网感的关键词\n"
        "- 整体风格：年轻化、有创意、有趣味、有记忆点"
    ),
}

STYLE_VARIANT_LABELS: dict[str, str] = {
    "attention": "吸引力型",
    "professional": "专业型",
    "friendly": "亲切型",
    "creative": "创意型",
}

VARIANT_JSON_INSTRUCTION = (
    "\n\n请根据以上写作风格，为用户提供的主题生成内容。\n"
    "你必须严格返回一个JSON对象，格式如下：\n"
    '{"title": "生成的标题", "description": "生成的描述/正文", "tags": ["标签1", "标签2", "标签3"]}\n'
    "不要返回任何其他文字，只返回JSON对象。tags数组至少3个标签，最多10个。"
)


def _get_all_keys_cached() -> list[dict]:
    db = get_database()
    return db.fetch_all("SELECT * FROM ai_api_keys ORDER BY id ASC")


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
    db = get_database()
    db.execute("UPDATE ai_api_keys SET rate_limited_at = ? WHERE api_key = ?", (now, key))


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


def _ai_queue_worker():
    while True:
        item = _ai_request_queue.get()
        if item is None:
            break
        result_event, payload, result_holder = item
        with _ai_request_semaphore:
            try:
                images = payload.get("images", [])
                prompt = payload.get("prompt", "")
                system_prompt = payload.get("system_prompt", DEFAULT_SYSTEM_PROMPT)
                if images:
                    user_content = _build_media_content(images, prompt)
                    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_content}]
                else:
                    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}]
                all_keys = _get_all_keys_cached()
                max_attempts = max(len(all_keys), 1)
                current_key = _get_next_key()
                result_holder["success"] = False
                result_holder["message"] = "All API keys exhausted"
                for _ in range(max_attempts):
                    if not current_key:
                        break
                    try:
                        resp = http_requests.post(
                            f"{OPENROUTE_BASE_URL}/chat/completions",
                            headers={"Authorization": f"Bearer {current_key}", "Content-Type": "application/json"},
                            json={"model": payload.get("model", "google/gemma-4-26b-a4b-it:free"), "messages": messages, "max_tokens": 2000, "temperature": 0.7},
                            timeout=(10, 120),
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                            result_holder["success"] = True
                            result_holder["data"] = {"content": content.strip()}
                            break
                        elif resp.status_code == 429:
                            _mark_rate_limited(current_key)
                            current_key = _get_next_key()
                            continue
                        else:
                            result_holder["message"] = resp.json().get("error", {}).get("message", f"API error: {resp.status_code}")
                            break
                    except (json.JSONDecodeError, ValueError):
                        result_holder["message"] = "Failed to parse API response"
                        break
            except (http_requests.RequestException, OSError, TimeoutError, json.JSONDecodeError, ValueError, KeyError) as e:
                result_holder["success"] = False
                result_holder["message"] = type(e).__name__
            finally:
                result_event.set()
                _ai_request_queue.task_done()


def _ensure_ai_worker():
    global _ai_queue_worker_started
    with _ai_queue_lock:
        if not _ai_queue_worker_started:
            t = threading.Thread(target=_ai_queue_worker, daemon=True, name="ai-queue-worker")
            t.start()
            _ai_queue_worker_started = True


def _stream_openrouter(model: str, messages: list[dict], max_tokens: int = 2000, temperature: float = 0.7, json_mode: bool = False) -> Generator[str, None, None]:
    all_keys = _get_all_keys_cached()
    max_attempts = max(len(all_keys), 1)
    current_key = _get_next_key()
    for _ in range(max_attempts):
        if not current_key:
            yield f"event: error\ndata: {json.dumps({'message': 'No API keys available.'})}\n\n"
            return
        try:
            payload: dict = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature, "stream": True}
            if json_mode:
                payload["response_format"] = {"type": "json_object"}
            resp = http_requests.post(
                f"{OPENROUTE_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {current_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=(10, 120), stream=True,
            )
            if resp.status_code == 429:
                _mark_rate_limited(current_key)
                current_key = _get_next_key()
                continue
            if resp.status_code != 200:
                error_msg = resp.json().get("error", {}).get("message", f"API error: {resp.status_code}")
                yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"
                return
            full_content = ""
            for line in resp.iter_lines():
                if not line:
                    continue
                line_str = line.decode("utf-8", errors="replace")
                if not line_str.startswith("data: "):
                    continue
                chunk_str = line_str[6:]
                if chunk_str.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(chunk_str)
                    content = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if content:
                        full_content += content
                        yield f"event: data\ndata: {json.dumps({'content': content})}\n\n"
                except json.JSONDecodeError:
                    continue
            yield f"event: done\ndata: {json.dumps({'content': full_content.strip()})}\n\n"
            return
        except (http_requests.RequestException, OSError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError, ValueError, KeyError) as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e) or type(e).__name__})}\n\n"
            return
    yield f"event: error\ndata: {json.dumps({'message': 'All API keys rate-limited. Please wait a few minutes and try again.'})}\n\n"


def _parse_json_from_text(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    import re
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def _generate_single_platform(model: str, topic: str, platform: str) -> dict:
    style_prompt = PLATFORM_STYLE_PROMPTS.get(platform, DEFAULT_SYSTEM_PROMPT)
    system_msg = style_prompt + MULTI_PLATFORM_JSON_INSTRUCTION
    messages = [{"role": "system", "content": system_msg}, {"role": "user", "content": f"主题：{topic}"}]
    full_content = ""
    for chunk in _stream_openrouter(model, messages, max_tokens=1500, temperature=0.7, json_mode=False):
        if chunk.startswith("event: data"):
            try:
                data = json.loads(chunk.split("data: ", 1)[1])
                full_content += data.get("content", "")
            except (json.JSONDecodeError, IndexError):
                pass
        elif chunk.startswith("event: error"):
            try:
                err = json.loads(chunk.split("data: ", 1)[1])
                return {"platform": platform, "title": "", "description": "", "tags": [], "error": err.get("message", "Unknown error")}
            except (json.JSONDecodeError, IndexError):
                return {"platform": platform, "title": "", "description": "", "tags": [], "error": "Stream error"}
    full_content = full_content.strip()
    parsed = _parse_json_from_text(full_content)
    if parsed and isinstance(parsed, dict):
        return {
            "platform": platform,
            "title": parsed.get("title", ""),
            "description": parsed.get("description", ""),
            "tags": parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else [],
        }
    return {"platform": platform, "title": "", "description": full_content, "tags": [], "parseError": True}


@bp.post("/api/ai/generate/multi-platform")
def ai_multi_platform():
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
    if not _has_any_api_key():
        return jsonify({"success": False, "message": "AI service not configured."})
    data = request.get_json(silent=True) or {}
    topic = data.get("topic", "").strip()
    platforms = data.get("platforms", [])
    model = data.get("model", "google/gemma-4-26b-a4b-it:free")
    if not topic:
        return jsonify({"success": False, "message": "Topic is required."}), 400
    if not isinstance(platforms, list) or len(platforms) == 0:
        return jsonify({"success": False, "message": "At least one platform is required."}), 400
    invalid = [p for p in platforms if p not in SUPPORTED_PLATFORMS]
    if invalid:
        return jsonify({"success": False, "message": f"Unsupported platform: {', '.join(invalid)}"}), 400

    def generate():
        from concurrent.futures import ThreadPoolExecutor, as_completed
        results: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=min(len(platforms), 4)) as executor:
            futures = {executor.submit(_generate_single_platform, model, topic, p): p for p in platforms}
            for future in as_completed(futures):
                platform = futures[future]
                try:
                    result = future.result()
                except Exception as e:
                    result = {"platform": platform, "title": "", "description": "", "tags": [], "error": str(e)}
                results[platform] = result
                if result.get("error"):
                    yield f"event: platform_error\ndata: {json.dumps(result)}\n\n"
                else:
                    yield f"event: platform_result\ndata: {json.dumps(result)}\n\n"
        yield f"event: done\ndata: {json.dumps({'results': results})}\n\n"

    try:
        from web_runner.middleware.usage_metering import log_action
        if _is_auth_enabled() and _sse_uid:
            log_action(_sse_uid, "ai_generate")
    except Exception:
        pass
    return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _generate_single_platform_variant(model: str, topic: str, platform: str, search_context: str = "") -> dict:
    """
    Single-platform variant generator — used by `/api/ai/generate/variants`
    when the request supplies `platforms`. Reuses per-platform persona
    prompts (PLATFORM_STYLE_PROMPTS) + the multi-platform JSON envelope
    so the LLM emits the structured title/description/tags payload.

    Returns a dict shaped like:

        {"platform": str, "platformLabel": str, "title": str,
         "description": str, "tags": list[str]}

    On error path the same shape with `error: str` instead of
    `title/description/tags`. The frontend consumer keys the chat-assistant
    bubble by the platform field directly (each platform = one bubble).
    """
    platform_prompt = PLATFORM_STYLE_PROMPTS.get(platform, DEFAULT_SYSTEM_PROMPT)
    system_msg = platform_prompt + MULTI_PLATFORM_JSON_INSTRUCTION
    user_msg = f"主题：{topic}"
    if search_context:
        user_msg = f"主题：{topic}\n\n以下是关于该主题的最新网络搜索结果，请参考这些真实信息来生成更准确、更有价值的内容：\n{search_context}"
    messages = [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}]
    full_content = ""
    label = PLATFORM_VARIANT_LABELS.get(platform, platform)
    for chunk in _stream_openrouter(model, messages, max_tokens=1500, temperature=0.7, json_mode=False):
        if chunk.startswith("event: data"):
            try:
                data = json.loads(chunk.split("data: ", 1)[1])
                full_content += data.get("content", "")
            except (json.JSONDecodeError, IndexError):
                pass
        elif chunk.startswith("event: error"):
            try:
                err = json.loads(chunk.split("data: ", 1)[1])
                return {"platform": platform, "platformLabel": label, "title": "", "description": "", "tags": [], "error": err.get("message", "Unknown error")}
            except (json.JSONDecodeError, IndexError):
                return {"platform": platform, "platformLabel": label, "title": "", "description": "", "tags": [], "error": "Stream error"}
    full_content = full_content.strip()
    label = PLATFORM_VARIANT_LABELS.get(platform, platform)
    parsed = _parse_json_from_text(full_content)
    if parsed and isinstance(parsed, dict):
        return {
            "platform": platform,
            "platformLabel": label,
            "title": parsed.get("title", ""),
            "description": parsed.get("description", ""),
            "tags": parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else [],
        }
    return {"platform": platform, "platformLabel": label, "title": "", "description": full_content, "tags": [], "parseError": True}


def _generate_single_variant(model: str, topic: str, style: str, search_context: str = "") -> dict:
    style_prompt = STYLE_VARIANTS.get(style, STYLE_VARIANTS["friendly"])
    system_msg = style_prompt + VARIANT_JSON_INSTRUCTION
    user_msg = f"主题：{topic}"
    if search_context:
        user_msg = f"主题：{topic}\n\n以下是关于该主题的最新网络搜索结果，请参考这些真实信息来生成更准确、更有价值的内容：\n{search_context}"
    messages = [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}]
    full_content = ""
    for chunk in _stream_openrouter(model, messages, max_tokens=1500, temperature=0.7, json_mode=False):
        if chunk.startswith("event: data"):
            try:
                data = json.loads(chunk.split("data: ", 1)[1])
                full_content += data.get("content", "")
            except (json.JSONDecodeError, IndexError):
                pass
        elif chunk.startswith("event: error"):
            try:
                err = json.loads(chunk.split("data: ", 1)[1])
                return {"style": style, "styleLabel": STYLE_VARIANT_LABELS.get(style, style), "title": "", "description": "", "tags": [], "error": err.get("message", "Unknown error")}
            except (json.JSONDecodeError, IndexError):
                return {"style": style, "styleLabel": STYLE_VARIANT_LABELS.get(style, style), "title": "", "description": "", "tags": [], "error": "Stream error"}
    full_content = full_content.strip()
    parsed = _parse_json_from_text(full_content)
    if parsed and isinstance(parsed, dict):
        return {
            "style": style,
            "styleLabel": STYLE_VARIANT_LABELS.get(style, style),
            "title": parsed.get("title", ""),
            "description": parsed.get("description", ""),
            "tags": parsed.get("tags", []) if isinstance(parsed.get("tags"), list) else [],
        }
    return {"style": style, "styleLabel": STYLE_VARIANT_LABELS.get(style, style), "title": "", "description": full_content, "tags": [], "parseError": True}


@bp.post("/api/ai/generate/variants")
def ai_variants():
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
    if not _has_any_api_key():
        return jsonify({"success": False, "message": "AI service not configured."})
    data = request.get_json(silent=True) or {}
    topic = data.get("topic", "").strip()
    model = data.get("model", "google/gemma-4-26b-a4b-it:free")
    use_search = data.get("search", False)
    # Per-platform mode: when caller passes `platforms`, switch the
    # generator from style-variants (4 personas) to per-platform
    # variants (one assistant turn per platform id). Both modes emit
    # the same `variant_result` / `variant_error` / `done` events so
    # the frontend `readSSEStream` consumer dispatches one shared
    # onVariantResult callback — the discriminator is the payload
    # shape (presence of `platform` field).
    platforms_param = data.get("platforms")
    if not topic:
        return jsonify({"success": False, "message": "Topic is required."}), 400

    platform_mode = False
    targets: list[str] = []
    if isinstance(platforms_param, list) and len(platforms_param) > 0:
        invalid = [p for p in platforms_param if p not in SUPPORTED_PLATFORMS]
        if invalid:
            return jsonify({"success": False, "message": f"Unsupported platform: {', '.join(invalid)}"}), 400
        platform_mode = True
        targets = list(platforms_param)

    search_context = ""
    if use_search:
        search_results = _web_search(topic, max_results=5)
        if search_results:
            search_context = "\n".join(
                f"- {r['title']}: {r['snippet']}" for r in search_results
            )

    def generate():
        from concurrent.futures import ThreadPoolExecutor, as_completed
        results: dict[str, dict] = {}
        if platform_mode:
            units = [(p, _generate_single_platform_variant) for p in targets]
        else:
            units = [(s, _generate_single_variant) for s in STYLE_VARIANTS.keys()]
        with ThreadPoolExecutor(max_workers=min(len(units), 4)) as executor:
            futures = {executor.submit(worker, model, topic, key, search_context): key for (key, worker) in units}
            for future in as_completed(futures):
                key = futures[future]
                try:
                    result = future.result()
                except Exception as e:
                    if platform_mode:
                        result = {"platform": key, "platformLabel": PLATFORM_VARIANT_LABELS.get(key, key), "title": "", "description": "", "tags": [], "error": str(e)}
                    else:
                        result = {"style": key, "styleLabel": STYLE_VARIANT_LABELS.get(key, key), "title": "", "description": "", "tags": [], "error": str(e)}
                results[key] = result
                if result.get("error"):
                    yield f"event: variant_error\ndata: {json.dumps(result)}\n\n"
                else:
                    yield f"event: variant_result\ndata: {json.dumps(result)}\n\n"
        yield f"event: done\ndata: {json.dumps({'results': results})}\n\n"

    try:
        from web_runner.middleware.usage_metering import log_action
        if _is_auth_enabled() and _sse_uid:
            log_action(_sse_uid, "ai_generate")
    except Exception:
        pass
    return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@bp.post("/api/ai/search")
def ai_search():
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
    data = request.get_json(silent=True) or {}
    query = data.get("query", "").strip()
    max_results = data.get("max_results", 5)
    if not query:
        return jsonify({"success": False, "message": "Query is required."}), 400
    results = _web_search(query, max_results=max_results)
    return jsonify({"success": True, "data": results})


@bp.post("/api/ai/generate")
def ai_generate():
    _ensure_ai_worker()
    if not _has_any_api_key():
        return jsonify({"success": False, "message": "AI service not configured. Please set your OpenRouter API key in the AI sidebar settings."})
    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt", "").strip()
    model = data.get("model", "google/gemma-4-26b-a4b-it:free")
    system_prompt = data.get("system_prompt", "")
    platform = data.get("platform", "")
    images = data.get("images", [])
    if not prompt and not images:
        return jsonify({"success": False, "message": "Prompt or image is required."})
    if not system_prompt:
        system_prompt = PLATFORM_PROMPTS.get(platform, DEFAULT_SYSTEM_PROMPT)
    result_holder: dict = {}
    result_event = threading.Event()
    _ai_request_queue.put((result_event, {"prompt": prompt, "model": model, "system_prompt": system_prompt, "images": images}, result_holder))
    result_event.wait(timeout=120)
    if not result_event.is_set():
        return jsonify({"success": False, "message": "Request timed out."})
    # Log AI usage for quota tracking
    try:
        from web_runner.middleware.usage_metering import log_action
        from web_runner.routes.auth import _current_user_id
        uid = _current_user_id()
        if uid:
            log_action(uid, "ai_generate")
    except Exception:
        pass
    return jsonify(result_holder)


@bp.get("/api/ai/models")
def ai_models():
    try:
        resp = http_requests.get("https://openrouter.ai/api/v1/models", headers={"Content-Type": "application/json"}, timeout=10)
        if resp.status_code == 200:
            all_models = resp.json().get("data", [])
            free_models = []
            for m in all_models:
                if ":free" not in m["id"]:
                    continue
                arch = m.get("architecture", {})
                input_mods = arch.get("input_modalities", ["text"])
                tags = []
                if "text" in input_mods:
                    tags.append("text")
                if "image" in input_mods:
                    tags.append("image")
                free_models.append({"id": m["id"], "name": m.get("name", m["id"]).replace(" (free)", "").replace(":free", ""), "context_length": m.get("context_length", 0), "tags": tags})
            free_models.sort(key=lambda x: x.get("context_length", 0), reverse=True)
            if free_models:
                return jsonify({"success": True, "data": free_models, "source": "live"})
    except (http_requests.RequestException, OSError, TimeoutError, json.JSONDecodeError, ValueError):
        pass
    models = [{"id": k, "name": v, "tags": ["text"]} for k, v in AI_MODELS.items()]
    return jsonify({"success": True, "data": models, "source": "fallback"})


@bp.get("/api/ai/config")
def ai_config_get():
    db = get_database()
    rows = db.fetch_all("SELECT * FROM ai_api_keys")
    configured = bool(rows) or bool(os.environ.get("OPENROUTE_API_KEY", ""))
    return jsonify({"success": True, "data": {"configured": configured, "key_count": len(rows)}})


@bp.get("/api/ai/keys")
def ai_keys_list():
    keys = _get_all_keys_cached()
    return jsonify({"success": True, "data": [{"id": k["id"], "masked": k["masked"], "created": k["created"], "rate_limited": bool(k.get("rate_limited_at"))} for k in keys]})


@bp.post("/api/ai/config")
def ai_config_set():
    from datetime import datetime
    data = request.get_json(silent=True) or {}
    key = data.get("api_key", "").strip()
    if not key:
        return jsonify({"success": False, "message": "API key is required."})
    masked = key[:8] + "****" + key[-4:] if len(key) > 12 else "****"
    now = datetime.now().isoformat(timespec="seconds")
    db = get_database()
    try:
        # Thread-safe vs. concurrent worker-thread INSERTs:
        # insert_returning_id reads the id directly from the INSERT row
        # instead of crossing instance state.
        row_id = db.insert_returning_id(
            "INSERT INTO ai_api_keys (api_key, masked, created) VALUES (?, ?, ?)",
            (key, masked, now),
        )
        return jsonify({"success": True, "data": {"configured": True, "key_masked": masked, "key_id": row_id}})
    except sqlite3.IntegrityError:
        # PR3 (postgres) layer will catch psycopg.errors.UniqueViolation
        # via Database.duplicate_key contract, so the API response stays
        # identical under both backends.
        return jsonify({"success": False, "message": "该 Key 已经添加过了。"}), 409


@bp.delete("/api/ai/config")
def ai_config_delete():
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled
    if _is_auth_enabled():
        uid = _current_user_id()
        if uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
    data = request.get_json(silent=True) or {}
    key_id = data.get("key_id")
    db = get_database()
    if key_id is not None:
        db.execute("DELETE FROM ai_api_keys WHERE id = ?", (int(key_id),))
        return jsonify({"success": True, "message": "Key removed."})
    # Only admin can delete all keys
    if _is_auth_enabled():
        from flask import session

        from web_runner.routes.auth import _current_user_id
        if session.get("role") != "admin":
            return jsonify({"success": False, "message": "权限不足"}), 403
    db.execute("DELETE FROM ai_api_keys")
    return jsonify({"success": True, "message": "All API keys removed."})


@bp.post("/api/ai/keys/batch")
def ai_keys_batch():
    from flask import session

    from web_runner.routes.auth import _current_user_id, _is_auth_enabled
    if _is_auth_enabled():
        uid = _current_user_id()
        if uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        if session.get("role") != "admin":
            return jsonify({"success": False, "message": "权限不足"}), 403
    from datetime import datetime
    data = request.get_json(silent=True) or {}
    raw = data.get("keys", [])
    if not isinstance(raw, list):
        return jsonify({"success": False, "message": "keys must be an array."}), 400

    now = datetime.now().isoformat(timespec="seconds")
    added = 0
    skipped = 0
    errors: list[str] = []
    db = get_database()
    for entry in raw:
        key = (entry if isinstance(entry, str) else str(entry)).strip()
        if not key or not key.startswith("sk-"):
            skipped += 1
            continue
        masked = key[:8] + "****" + key[-4:] if len(key) > 12 else "****"
        try:
            db.execute(
                "INSERT INTO ai_api_keys (api_key, masked, created) VALUES (?, ?, ?)",
                (key, masked, now),
            )
            added += 1
        except Exception as exc:
            exc_name = type(exc).__name__
            if "IntegrityError" in exc_name or "unique" in str(exc).lower():
                skipped += 1
            else:
                errors.append(exc_name)
    return jsonify({"success": True, "data": {"added": added, "skipped": skipped, "errors": errors}})


@bp.post("/api/ai/enhance-prompt")
def ai_enhance_prompt():
    if not _has_any_api_key():
        return jsonify({"success": False, "message": "AI service not configured."})
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    images = data.get("images", [])
    model = data.get("model", "google/gemma-4-26b-a4b-it:free")
    platform = data.get("platform", "")
    if not text and not images:
        return jsonify({"success": False, "message": "请输入文字或上传图片。"})

    ENHANCE_SYSTEM = "You are a world-class prompt engineer. Transform the user's rough idea into a detailed, vivid content brief. Output in the SAME language as the input. Output ONLY the enhanced prompt."
    if platform:
        ENHANCE_SYSTEM += f"\n\n目标平台：{platform}"

    if images:
        user_content = _build_media_content(images)
        user_content.append({"type": "text", "text": f"用户的补充说明：{text}" if text else "请根据这些图片生成社交媒体内容的详细提示词。"})
        messages = [{"role": "system", "content": ENHANCE_SYSTEM}, {"role": "user", "content": user_content}]
    else:
        messages = [{"role": "system", "content": ENHANCE_SYSTEM}, {"role": "user", "content": f"请增强以下内容描述：\n\n{text}"}]

    return Response(
        _stream_openrouter(model, messages, max_tokens=1500, temperature=0.8),
        mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@bp.post("/api/ai/generate/stream")
def ai_generate_stream():
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
    # Log AI usage for quota tracking (before streaming starts)
    try:
        from web_runner.middleware.usage_metering import log_action
        if _is_auth_enabled() and _sse_uid:
            log_action(_sse_uid, "ai_generate")
    except Exception:
        pass
    if not _has_any_api_key():
        def err():
            yield f"event: error\ndata: {json.dumps({'message': 'AI service not configured.'})}\n\n"
        return Response(err(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    data = request.get_json(silent=True) or {}
    model = data.get("model", "google/gemma-4-26b-a4b-it:free")

    # Multi-turn entry-point: when the client supplies a non-empty
    # `messages` array, forward it verbatim to OpenRouter. The legacy
    # single-turn `prompt` / `system_prompt` / `images` path is the
    # fallback for clients that haven't been upgraded yet.
    raw_messages = data.get("messages")
    if isinstance(raw_messages, list) and len(raw_messages) > 0:
        if len(raw_messages) > MAX_MESSAGES_PER_REQUEST:
            def cap_err():
                yield f"event: error\ndata: {json.dumps({'message': f'Too many messages in conversation (max {MAX_MESSAGES_PER_REQUEST}).'})}\n\n"
            return Response(cap_err(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        return Response(
            _stream_openrouter(model, raw_messages),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Legacy single-turn fallback.
    prompt = data.get("prompt", "").strip()
    system_prompt = data.get("system_prompt", "")
    platform = data.get("platform", "")
    images = data.get("images", [])
    if not prompt and not images:
        def err():
            yield f"event: error\ndata: {json.dumps({'message': 'Prompt or image is required.'})}\n\n"
        return Response(err(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    if not system_prompt:
        system_prompt = PLATFORM_PROMPTS.get(platform, DEFAULT_SYSTEM_PROMPT)
    if images:
        user_content = _build_media_content(images, prompt)
        fallback_messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_content}]
    else:
        fallback_messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}]
    return Response(
        _stream_openrouter(model, fallback_messages),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Image search routes (openspec ai-sidebar-material-search §1.7 + §1.8 + §1.10) ──


@bp.post("/api/ai/images/search")
def ai_images_search():
    """Keyword → Pexels + Pixabay merged + deduped image list.

    Auth-aware (mirrors /api/ai/search contract): when
    SAU_AUTH_ENABLED=true, returns 401 if not logged in. Soft per-user
    rate limit (30/min) fires BEFORE the external API call so Pexels's
    200/hour free tier cannot be exhausted by a single-burst clicker.
    503 response carries `code: "IMAGE_SOURCE_NOT_CONFIGURED"` so the
    frontend can branch on a stable identifier instead of parsing the
    Chinese human-readable message. The `debug` block surfaces per-
    source counts + error labels so a 0-result response still tells
    the user WHICH source failed.
    """
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    uid = 0
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        uid = _sse_uid
    if not _check_image_rate_limit(uid):
        return jsonify({
            "success": False,
            "message": "image search rate-limited; retry after 60s",
            "retry_after_sec": 60,
        }), 429
    if not _has_image_source():
        return jsonify({
            "success": False,
            "message": "未配置图片搜索 API key。请在 .env 设置 PEXELS_API_KEY 或 PIXABAY_API_KEY 后重启 run.py。",
            "code": "IMAGE_SOURCE_NOT_CONFIGURED",
        }), 503
    data = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()
    count = int(data.get("count") or 9)
    if not query:
        return jsonify({"success": False, "message": "query required"}), 400
    # Cap count to Pexels's per_page ceiling so we don't ask for more
    # than upstream will return. 9 is the default 3x3 grid size.
    count = max(1, min(count, 80))
    try:
        from web_runner.middleware.usage_metering import log_action
        log_action(uid, "ai_image_search")
    except Exception:  # noqa: BLE001
        pass
    merged, debug = _search_images(query, count)
    return jsonify({"success": True, "data": merged, "debug": debug})


@bp.post("/api/ai/recommend-images")
def ai_recommend_images():
    """Title → keyword-derived image recommendation. Re-uses _search_images.

    Accepts `{topic}` (preferred) OR `{query}` (alias — same field name
    as /api/ai/images/search for client-side uniformity) for input. Same
    auth + rate-limit + 503 contracts. The 9-result default mirrors
    the manual-search default so the user doesn't have to learn a second
    count value when switching modes.
    """
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    uid = 0
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        uid = _sse_uid
    if not _check_image_rate_limit(uid):
        return jsonify({
            "success": False,
            "message": "image search rate-limited; retry after 60s",
            "retry_after_sec": 60,
        }), 429
    if not _has_image_source():
        return jsonify({
            "success": False,
            "message": "未配置图片搜索 API key。请在 .env 设置 PEXELS_API_KEY 或 PIXABAY_API_KEY 后重启 run.py。",
            "code": "IMAGE_SOURCE_NOT_CONFIGURED",
        }), 503
    data = request.get_json(silent=True) or {}
    topic = (data.get("topic") or data.get("query") or "").strip()
    count = int(data.get("count") or 9)
    if not topic:
        return jsonify({"success": False, "message": "topic required"}), 400
    count = max(1, min(count, 80))
    try:
        from web_runner.middleware.usage_metering import log_action
        log_action(uid, "ai_image_search")
    except Exception:  # noqa: BLE001
        pass
    merged, debug = _search_images(topic, count)
    return jsonify({"success": True, "data": merged, "debug": debug})


@bp.get("/api/ai/images/fetch")
def ai_images_fetch():
    """SSRF-gated 10MB binary-image proxy for frontend File conversion.

    Validates URL via inbox._is_public_url + inbox._resolve_is_public
    *before* opening a streaming connection — DNS-rebinding rejection
    comes from inbox.py round-19 hardening, mirrored here for the same
    defense-in-depth. The 10MB cap fires inside the generator so the
    underlying socket is released cleanly when truncation fires.

    Auth: when SAU_AUTH_ENABLED, login is enforced. Auth-disabled
    mirrors the same "synthetic admin id = 0" path as other AI routes.
    """
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    from web_runner.routes.inbox import _is_public_url, _resolve_is_public
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
    url = (request.args.get("url") or "").strip()
    if not url:
        return jsonify({"success": False, "message": "url required"}), 400
    if not _is_public_url(url):
        return jsonify({"success": False, "message": "url rejected (private/loopback)"}), 400
    if not _resolve_is_public(url):
        return jsonify({"success": False, "message": "url rejected (dns private/loopback)"}), 400

    # Open streaming connection now (NOT inside generator) so we can
    # capture upstream Content-Type for Response.mimetype BEFORE
    # iteration starts — Flask's Response needs the mimetype at
    # construction time, not after the first chunk has streamed.
    try:
        resp = http_requests.get(url, stream=True, timeout=(5, 8))
    except (http_requests.RequestException, OSError, TimeoutError) as e:
        return jsonify({
            "success": False,
            "message": f"upstream connection failed: {type(e).__name__}",
        }), 502
    if resp.status_code != 200:
        try:
            resp.close()
        except Exception:  # noqa: BLE001
            pass
        return jsonify({
            "success": False,
            "message": f"upstream returned {resp.status_code}",
        }), 502
    # Parse mimetype: strip "; charset=..." suffix so the spec stays
    # narrow ("image/png" not "image/png; charset=binary").
    upstream_ct = (
        (resp.headers.get("Content-Type") or "image/jpeg").split(";")[0].strip()
        or "image/jpeg"
    )

    def _generate():
        bytes_yielded = 0
        try:
            for chunk in resp.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                bytes_yielded += len(chunk)
                if bytes_yielded > _IMAGE_FETCH_MAX_BYTES:
                    logger.warning(
                        f"[ai] image fetch exceeded 10MB cap, truncated at {url[:80]}"
                    )
                    break
                yield chunk
        finally:
            try:
                resp.close()
            except Exception:  # noqa: BLE001
                pass

    return Response(
        _generate(),
        mimetype=upstream_ct,
        # 1h public cache: Pexels/Pixabay photos are immutable in URL
        # but the upstream can swap the file under the same URL on
        # rare retag events. 1h strikes a balance between browser
        # re-fetch pressure vs. stale-image risk; bump to 24h only
        # after adding an upstream-ETag/Last-Modified revalidate hook.
        headers={"Cache-Control": "public, max-age=3600"},
    )
