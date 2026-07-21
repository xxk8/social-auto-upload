"""Studio AI script generation engine.

OpenSpec ref: ``openspec/changes/studio-ai-script-generation``.

This module generates four-act short-video scripts (起/承/转/合) from a
project's title, synopsis and style.  It streams the LLM output back as
Server-Sent Events so the frontend can show progress, and falls back
from Agnes AI to OpenRouter automatically when Agnes is unavailable.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Generator

import requests

from utils.log import logger as _task_logger

# ── Constants ────────────────────────────────────────────────────────

AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1"
AGNES_MODEL = "agnes-2.0-flash"
OPENROUTER_FALLBACK_MODEL = "google/gemma-4-26b-a4b-it:free"

AGNES_CHAT_ENDPOINT = f"{AGNES_BASE_URL}/chat/completions"

SYSTEM_PROMPT = """你是一位专业的短视频剧本编剧。根据用户提供的故事梗概，生成四幕结构的短视频分集剧本。

四幕结构说明：
- 起（开端）：介绍主角和背景，建立世界观，设置悬念或冲突的起点
- 承（发展）：推进剧情，深化矛盾，角色面临挑战或抉择
- 转（转折）：剧情出现意外转折，高潮前的关键反转或突破
- 合（结局）：解决冲突，收束故事，留下余韵或启示

每一幕生成一个分集，包含：
1. 集标题（简洁有力，10-15字）
2. 场景列表（每个场景包含场景描述、画面提示、时长建议）
3. 台词列表（角色对白或旁白）

输出格式要求（严格JSON）：
你必须返回一个JSON对象，格式如下：
{
  "episodes": [
    {
      "act": "起",
      "title": "集标题",
      "scenes": [
        {"title": "场景名", "body": "场景描述", "duration_sec": 3}
      ],
      "dialogues": [
        {"speaker": "角色名", "text": "台词内容"}
      ]
    },
    {"act": "承", ...},
    {"act": "转", ...},
    {"act": "合", ...}
  ]
}

注意事项：
- 每幕2-4个场景，每场景3-5秒画面
- 台词简短有力，适合短视频节奏
- 场景描述要具体，包含画面元素（人物、动作、环境）
- 整体故事要有起承转合的完整弧线
- 语言自然生动，适合中国社交媒体平台"""

_VALID_ACTS = frozenset({"起", "承", "转", "合"})


# ── Key management ───────────────────────────────────────────────────

def _get_agnes_key() -> str:
    return os.environ.get("AGNES_API_KEY", "").strip()


def _has_agnes_key() -> bool:
    return bool(_get_agnes_key())


def _has_any_key() -> bool:
    # OpenRouter fallback is considered available if the global env key
    # is set OR if any key is stored in the ai_api_keys table.  The
    # helper ``_get_next_key`` in ai.py already encapsulates this logic.
    # Import lazily so this module can be imported in environments
    # where psycopg (a transitive dependency of ai.py) is absent.
    from web_runner.routes.ai import _get_next_key
    return _has_agnes_key() or bool(_get_next_key())


# ── SSE helpers ──────────────────────────────────────────────────────

def _yield_data_event(content: str) -> str:
    return f"event: data\ndata: {json.dumps({'content': content}, ensure_ascii=False)}\n\n"


def _yield_done_event(full_content: str) -> str:
    return f"event: done\ndata: {json.dumps({'content': full_content}, ensure_ascii=False)}\n\n"


def _yield_error_event(message: str) -> str:
    return f"event: error\ndata: {json.dumps({'message': message}, ensure_ascii=False)}\n\n"


# ── Agnes AI streaming ───────────────────────────────────────────────

def _stream_agnes(
    messages: list[dict],
    max_tokens: int = 4000,
    temperature: float = 0.7,
) -> Generator[str, None, None]:
    """Stream chat completions from Agnes AI.

    Yields SSE event strings.  On success the stream ends with
    ``event: done``; on failure it yields ``event: error`` and
    returns.
    """
    api_key = _get_agnes_key()
    payload = {
        "model": AGNES_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            AGNES_CHAT_ENDPOINT,
            headers=headers,
            json=payload,
            timeout=(10, 120),
            stream=True,
        )
    except (requests.RequestException, TimeoutError, OSError) as exc:
        yield _yield_error_event(f"Agnes AI 请求失败: {type(exc).__name__}: {exc}")
        return

    if resp.status_code != 200:
        try:
            err = resp.json().get("error", {}).get("message", f"HTTP {resp.status_code}")
        except (ValueError, AttributeError):
            err = f"HTTP {resp.status_code}"
        yield _yield_error_event(f"Agnes AI 错误: {err}")
        return

    full_content = ""
    try:
        for line in resp.iter_lines():
            if not line:
                continue
            line_str = line.decode("utf-8", errors="replace")
            if not line_str.startswith("data: "):
                continue
            data_str = line_str[6:].strip()
            if data_str == "[DONE]":
                break
            try:
                chunk = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            content = delta.get("content") or ""
            if content:
                full_content += content
                yield _yield_data_event(content)
    except (requests.RequestException, TimeoutError, OSError) as exc:
        yield _yield_error_event(f"Agnes AI 流中断: {type(exc).__name__}: {exc}")
        return
    finally:
        try:
            resp.close()
        except Exception:
            pass

    yield _yield_done_event(full_content)


# ── Fallback orchestration ───────────────────────────────────────────

def _stream_openrouter_fallback(
    messages: list[dict],
    max_tokens: int = 4000,
    temperature: float = 0.7,
) -> Generator[str, None, None]:
    """Yield SSE events from the existing OpenRouter streaming helper.

    ``_stream_openrouter`` already emits ``event: data`` / ``event: done``
    / ``event: error`` formatted strings, so this is a thin wrapper.
    Import lazily so this module can be imported in environments
    where psycopg (a transitive dependency of ai.py) is absent.
    """
    from web_runner.routes.ai import _stream_openrouter
    yield from _stream_openrouter(
        OPENROUTER_FALLBACK_MODEL,
        messages,
        max_tokens=max_tokens,
        temperature=temperature,
        json_mode=False,
    )


def _stream_with_fallback(
    messages: list[dict],
    max_tokens: int = 4000,
    temperature: float = 0.7,
) -> Generator[str, None, None]:
    """Try Agnes AI first; on error fall back to OpenRouter.

    The function yields SSE event strings.  If Agnes succeeds (no
    ``event: error`` is emitted), the stream ends there.  If Agnes
    yields an error, we drain the remainder of its generator, then
    yield from the OpenRouter fallback.  If no key is configured at
    all, we yield a single error event.
    """
    if _has_agnes_key():
        error_seen = False
        for event in _stream_agnes(messages, max_tokens, temperature):
            if event.startswith("event: error"):
                error_seen = True
            yield event
        if not error_seen:
            return
        # Agnes failed — try OpenRouter if possible.
        if _has_any_key():
            yield from _stream_openrouter_fallback(messages, max_tokens, temperature)
        else:
            yield _yield_error_event("Agnes AI 失败且未配置 OpenRouter API key")
        return

    if _has_any_key():
        yield from _stream_openrouter_fallback(messages, max_tokens, temperature)
        return

    yield _yield_error_event("未配置 AI API key，请在 .env 设置 AGNES_API_KEY 或 OpenRouter key")


# ── JSON extraction ───────────────────────────────────────────────────

def _parse_episodes_json(text: str) -> list[dict] | None:
    """Extract the ``episodes`` array from an LLM output.

    Tries three strategies in order:
      1. Direct JSON parse and look for ``episodes``.
      2. Strip markdown code fences and retry.
      3. Regex-extract the first JSON object containing ``"episodes"``.

    Returns ``None`` when extraction fails or the result is not a list.
    """
    text = text.strip()
    # Strategy 1: direct parse.
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and isinstance(parsed.get("episodes"), list):
            return parsed["episodes"]
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 2: strip code fences.
    fenced = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    fenced = re.sub(r"\s*```$", "", fenced)
    fenced = fenced.strip()
    try:
        parsed = json.loads(fenced)
        if isinstance(parsed, dict) and isinstance(parsed.get("episodes"), list):
            return parsed["episodes"]
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 3: regex extract.
    match = re.search(r"\{[\s\S]*\"episodes\"[\s\S]*\}", text)
    if match:
        try:
            parsed = json.loads(match.group())
            if isinstance(parsed, dict) and isinstance(parsed.get("episodes"), list):
                return parsed["episodes"]
        except (json.JSONDecodeError, ValueError):
            pass

    return None


# ── Public entry point ────────────────────────────────────────────────

def generate_episodes_sse(
    title: str,
    synopsis: str,
    style: str | None,
    max_tokens: int = 4000,
    temperature: float = 0.7,
) -> Generator[str, None, None]:
    """Generate a four-act script and yield SSE events.

    The stream emits:
      * ``event: data`` for each text chunk.
      * ``event: done`` with the full LLM output.
      * ``event: generation_done`` with the parsed episodes array.
      * ``event: error`` on any failure.
    """
    parts = [f"项目标题：{title}", f"故事梗概：{synopsis}"]
    if style:
        parts.append(f"视觉风格：{style}")
    user_msg = "\n\n".join(parts)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    full_text = ""
    # Collect the full text from the fallback stream.  Both Agnes and
    # OpenRouter paths emit ``event: done`` with the complete content.
    for event in _stream_with_fallback(messages, max_tokens, temperature):
        yield event
        if event.startswith("event: done"):
            try:
                data = json.loads(event.split("data: ", 1)[1])
                full_text = data.get("content", "")
            except (json.JSONDecodeError, IndexError):
                full_text = ""

    # If the stream already emitted an error, stop here.  The caller can
    # inspect the yielded events; we don't also need to emit another
    # error for an empty result.
    if not full_text.strip():
        return

    episodes = _parse_episodes_json(full_text)
    if episodes is None:
        yield _yield_error_event("AI 生成结果格式异常，请重试")
        return

    # Filter to valid acts and ensure each episode has the expected shape.
    valid_episodes: list[dict] = []
    for ep in episodes:
        if not isinstance(ep, dict):
            continue
        act = (ep.get("act") or "").strip()
        if act not in _VALID_ACTS:
            continue
        valid_episodes.append({
            "act": act,
            "title": (ep.get("title") or "").strip() or "未命名",
            "scenes": ep.get("scenes") if isinstance(ep.get("scenes"), list) else [],
            "dialogues": ep.get("dialogues") if isinstance(ep.get("dialogues"), list) else [],
        })

    yield f"event: generation_done\ndata: {json.dumps({'episodes': valid_episodes}, ensure_ascii=False)}\n\n"
