"""Unified LLM + Image/Video provider for Studio / AI routes.

**Dual-provider design**:

1. **Local LLM** — default; matches local proxy at
    ``http://127.0.0.1:8317/v1/``::

        base_url = http://127.0.0.1:8317/v1/
        api_key = sk-my-secret-key-12345

    - Chat: ``POST {base}/chat/completions``
    - Images: ``POST {base}/images/generations`` → ``{request_id, data: [{url: ...}]}``
    - Video:  ``POST {base}/videos/generations`` → ``{request_id}``
    - Poll:   ``GET {base}/videos/{request_id}`` → until ``status=done``

2. **Agnes AI (remote)** — set env vars to activate:
    ``SAU_MEDIA_BASE_URL=https://apihub.agnes-ai.com``
    ``SAU_IMAGE_MODEL=agnes-image-2.1-flash``
    ``SAU_VIDEO_MODEL=agnes-video-v2.0``

    - Images: ``POST /v1/images/generations`` (OpenAI-compatible, same shape)
    - Video:  ``POST /v1/videos`` → ``{video_id, status="queued", ...}``
    - Poll:   ``GET /agnesapi?video_id=...&model_name=...`` → until ``status=completed``

    Register API key at https://platform.agnes-ai.com/ ; set ``AGNES_API_KEY``
    or ``SAU_MEDIA_API_KEY``.

Env knobs:

* ``SAU_LLM_BASE_URL`` / ``SAU_LLM_API_KEY`` / ``SAU_LLM_MODEL``
* ``SAU_MEDIA_BASE_URL`` / ``SAU_MEDIA_API_KEY`` (default = same as LLM = local)
* ``SAU_IMAGE_MODEL`` (default ``agnes-image-2.1-flash``)
* ``SAU_VIDEO_MODEL`` (default ``agnes-video-v2.0``)
* ``SAU_LLM_LOCAL_ONLY=1`` (default on loopback) — skip OpenRouter fallback
* ``AGNES_API_KEY`` / ``AGNES_API_TOKEN`` / ``APIHUB_AGNES_API_KEY`` — auto-detected for Agnes
* Optional OpenRouter fallback only when *not* local-only:
  ``OPENROUTE_API_KEY`` / ``OPENROUTER_API_KEY``
"""
from __future__ import annotations

import base64
import os
import threading
import time
from pathlib import Path
from typing import Any

import requests as http_requests

from web_runner.db import BASE_DIR

DEFAULT_LLM_BASE = "http://127.0.0.1:8317/v1"
DEFAULT_LLM_MODEL = "local-chat"
DEFAULT_LLM_KEY = "sk-my-secret-key-12345"
DEFAULT_IMAGE_MODEL = "local-image"
# Default video model for local proxy.
DEFAULT_VIDEO_MODEL = "local-video"
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
OPENROUTER_DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free"

# Models advertised by local 8317 (screenshot / GET /models).
LOCAL_CHAT_MODELS = ()
LOCAL_IMAGE_MODELS = ()
LOCAL_VIDEO_MODELS = ()

# ── Agnes AI models (remote, via apihub.agnes-ai.com) ────────────────
AGNES_IMAGE_MODELS = (
    "agnes-image-2.1-flash",
)
AGNES_VIDEO_MODELS = (
    "agnes-video-v2.0",
)
AGNES_MODEL_PREFIX = "agnes-"

STUDIO_MEDIA_DIR = BASE_DIR / "media" / "studio"

# Local proxy often serialises Imagine; concurrent hangs starve the queue.
_media_lock = threading.Lock()


def _strip_slash(url: str) -> str:
    return (url or "").rstrip("/")


def llm_config() -> dict[str, str]:
    base = (
        os.environ.get("SAU_LLM_BASE_URL")
        or DEFAULT_LLM_BASE
    )
    key = (
        os.environ.get("SAU_LLM_API_KEY")
        or os.environ.get("OPENROUTE_API_KEY")
        or os.environ.get("OPENROUTER_API_KEY")
        or ""
    )
    # Local proxy default key when base is loopback.
    if not key and ("127.0.0.1" in base or "localhost" in base):
        key = DEFAULT_LLM_KEY
    model = os.environ.get("SAU_LLM_MODEL") or DEFAULT_LLM_MODEL
    return {
        "base_url": _strip_slash(base),
        "api_key": key,
        "model": model,
    }


def _is_loopback(url: str) -> bool:
    u = (url or "").lower()
    return "127.0.0.1" in u or "localhost" in u


def _agnes_api_key() -> str:
    """Return Agnes AI key from env, or empty string."""
    for name in ("AGNES_API_KEY", "AGNES_API_TOKEN", "APIHUB_AGNES_API_KEY"):
        val = os.environ.get(name)
        if val:
            return val.strip()
    return ""


def _is_agnes(model: str | None = None) -> bool:
    """True when configured for Agnes AI (by model prefix or env key).

    Checks:
    1. If `model` is given and starts with ``agnes-`` → Agnes.
    2. If no model, checks ``SAU_IMAGE_MODEL`` / ``SAU_VIDEO_MODEL``.
    3. Falls back to ``_agnes_api_key()`` presence.
    """
    if model and isinstance(model, str):
        if model.startswith(AGNES_MODEL_PREFIX):
            return True
    media = media_config()
    for m in (media.get("image_model"), media.get("video_model")):
        if m and m.startswith(AGNES_MODEL_PREFIX):
            return True
    if _agnes_api_key():
        return True
    if "agnes" in (media.get("base_url") or "").lower():
        return True
    return False


def local_only() -> bool:
    """Prefer pure local 8317 — no OpenRouter fallback."""
    flag = (os.environ.get("SAU_LLM_LOCAL_ONLY") or "").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    if flag in ("1", "true", "yes", "on"):
        return True
    # Default: local-only when base is loopback.
    return _is_loopback(llm_config()["base_url"])


def media_config() -> dict[str, str]:
    """Image/video endpoint — defaults to **same local base** as chat."""
    llm = llm_config()
    # Local-first: do not silently jump to api.x.ai unless explicitly set.
    base = os.environ.get("SAU_MEDIA_BASE_URL") or llm["base_url"]
    key = (
        os.environ.get("SAU_MEDIA_API_KEY")
        or llm["api_key"]
    )    # If we detect Agnes env vars, auto-set defaults.
    # Note: Agnes base URL is stored WITHOUT /v1 because:
    #   - Image/video creation: ``{base}/v1/images/generations``, ``{base}/v1/videos`` (needs /v1)
    #   - Video polling:        ``{base}/agnesapi?video_id=...`` (no /v1)
    agnes_key = _agnes_api_key()
    if agnes_key and not os.environ.get("SAU_MEDIA_API_KEY"):
        key = agnes_key
    if agnes_key and not os.environ.get("SAU_MEDIA_BASE_URL"):
        base = "https://apihub.agnes-ai.com"
        key = agnes_key
    image_model = os.environ.get("SAU_IMAGE_MODEL") or DEFAULT_IMAGE_MODEL
    video_model = os.environ.get("SAU_VIDEO_MODEL") or DEFAULT_VIDEO_MODEL
    # Auto-set Agnes models when base URL or key is Agnes.
    if agnes_key or "agnes" in base.lower():
        if not os.environ.get("SAU_IMAGE_MODEL"):
            image_model = AGNES_IMAGE_MODELS[0]
        if not os.environ.get("SAU_VIDEO_MODEL"):
            video_model = AGNES_VIDEO_MODELS[0]
    # Validate against known local ids when on loopback.
    if _is_loopback(base):
        if image_model not in LOCAL_IMAGE_MODELS:
            image_model = DEFAULT_IMAGE_MODEL
        if video_model not in LOCAL_VIDEO_MODELS:
            video_model = DEFAULT_VIDEO_MODEL
    return {
        "base_url": _strip_slash(base),
        "api_key": key,
        "image_model": image_model,
        "video_model": video_model,
    }


def has_chat_provider() -> bool:
    """True when primary LLM config has a key (incl. local 8317 default)."""
    return bool(llm_config().get("api_key"))


def provider_status() -> dict[str, Any]:
    """Lightweight status for Studio UI / health."""
    llm = llm_config()
    media = media_config()
    chat_ok = False
    chat_error = ""
    r: Any = None
    try:
        r = http_requests.get(
            f"{llm['base_url']}/models",
            headers={"Authorization": f"Bearer {llm['api_key']}"},
            **_request_kwargs(llm["base_url"], timeout=(2, 5)),
        )
        chat_ok = r.status_code == 200
        if not chat_ok:
            chat_error = f"HTTP {r.status_code}"
    except Exception as exc:
        chat_error = type(exc).__name__

    models: list[str] = []
    if chat_ok and r is not None:
        try:
            data = r.json()
            models = [m.get("id", "") for m in (data.get("data") or []) if m.get("id")]
        except Exception:
            pass

    image_models = [m for m in models if m in LOCAL_IMAGE_MODELS or "imagine-image" in m]
    video_models = [m for m in models if m in LOCAL_VIDEO_MODELS or "imagine-video" in m]
    chat_models = [m for m in models if m in LOCAL_CHAT_MODELS]
    agnes_image_models = [m for m in models if m in AGNES_IMAGE_MODELS or m.startswith("agnes-image")]
    agnes_video_models = [m for m in models if m in AGNES_VIDEO_MODELS or m.startswith("agnes-video")]
    is_ag = _is_agnes()

    return {
        "local_only": local_only(),
        "provider": "agnes" if is_ag else "local-imagine",
        "chat": {
            "base_url": llm["base_url"],
            "model": llm["model"],
            "ok": chat_ok,
            "error": chat_error or None,
            "has_imagine_image": bool(image_models),
            "has_imagine_video": bool(video_models),
            "models": chat_models or list(LOCAL_CHAT_MODELS[:4]),
        },
        "media": {
            "base_url": media["base_url"],
            "image_model": media["image_model"],
            "video_model": media["video_model"],
            "same_as_chat": media["base_url"] == llm["base_url"],
            "image_models": image_models or list(LOCAL_IMAGE_MODELS),
            "video_models": video_models or list(LOCAL_VIDEO_MODELS),
            "agnes_image_models": agnes_image_models or (list(AGNES_IMAGE_MODELS) if is_ag else []),
            "agnes_video_models": agnes_video_models or (list(AGNES_VIDEO_MODELS) if is_ag else []),
            "local": _is_loopback(media["base_url"]),
            "has_agnes": is_ag,
        },
        "catalog": {
            "chat": list(LOCAL_CHAT_MODELS),
            "image": list(LOCAL_IMAGE_MODELS),
            "video": list(LOCAL_VIDEO_MODELS),
        },
    }


def _auth_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _request_kwargs(base_url: str, *, timeout: tuple[float, float] | float) -> dict[str, Any]:
    """Common requests kwargs. Always bypass system HTTP(S)_PROXY for loopback.

    macOS / Clash 等会把 ``HTTP_PROXY=127.0.0.1:108x`` 注入环境；
    若不关闭，对 ``127.0.0.1:8317`` 的 Imagine 会长超时到代理端口
    （日志形如 ``port=1082: Read timed out``），chat 偶尔还能通。
    """
    kw: dict[str, Any] = {"timeout": timeout}
    if _is_loopback(base_url):
        kw["proxies"] = {"http": None, "https": None}
    return kw


def _extract_chat_text(data: dict) -> str | None:
    """Support chat.completions + responses API shapes."""
    # OpenAI chat.completions
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            parts = []
            for p in content:
                if isinstance(p, dict) and p.get("type") in ("text", "output_text"):
                    parts.append(str(p.get("text") or ""))
                elif isinstance(p, str):
                    parts.append(p)
            joined = "".join(parts).strip()
            if joined:
                return joined
    # Responses API
    output = data.get("output")
    if isinstance(output, list):
        texts: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "message":
                for c in item.get("content") or []:
                    if isinstance(c, dict) and c.get("type") in ("output_text", "text"):
                        texts.append(str(c.get("text") or ""))
        joined = "".join(texts).strip()
        if joined:
            return joined
    # Some proxies put text at top-level
    for key in ("output_text", "content", "text"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def complete_chat(
    messages: list[dict],
    *,
    model: str | None = None,
    max_tokens: int = 4500,
    temperature: float = 0.75,
) -> str | None:
    """Non-streaming chat completion. Prefer local LLM, then OpenRouter pool."""
    cfg = llm_config()
    model = model or cfg["model"]

    # 1) Primary (local Grok / custom)
    if cfg["api_key"]:
        text = _post_chat_completions(
            base_url=cfg["base_url"],
            api_key=cfg["api_key"],
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        if text:
            return text
        # Responses API fallback (api_backend = responses in local proxy config)
        text = _post_responses(
            base_url=cfg["base_url"],
            api_key=cfg["api_key"],
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        if text:
            return text

    # 2) OpenRouter only when not local-only
    if local_only():
        return None
    try:
        from web_runner.ai_worker import _get_next_key, _has_any_api_key

        if not _has_any_api_key():
            return None
        key = _get_next_key()
        if not key:
            return None
        return _post_chat_completions(
            base_url=OPENROUTER_BASE,
            api_key=key,
            model=model if "/" in model else OPENROUTER_DEFAULT_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    except Exception:
        return None


def _post_chat_completions(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int,
    temperature: float,
) -> str | None:
    try:
        resp = http_requests.post(
            f"{_strip_slash(base_url)}/chat/completions",
            headers=_auth_headers(api_key),
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
            **_request_kwargs(base_url, timeout=(10, 180)),
        )
        if resp.status_code != 200:
            return None
        return _extract_chat_text(resp.json())
    except Exception:
        return None


def _messages_to_input(messages: list[dict]) -> str:
    """Flatten messages for Responses API ``input`` string form."""
    parts: list[str] = []
    for m in messages:
        role = m.get("role") or "user"
        content = m.get("content")
        if isinstance(content, list):
            text = " ".join(
                str(p.get("text") or "") if isinstance(p, dict) else str(p)
                for p in content
            )
        else:
            text = str(content or "")
        parts.append(f"{role}: {text}")
    return "\n\n".join(parts)


def _post_responses(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int,
    temperature: float,
) -> str | None:
    try:
        # Prefer structured input array if simple string fails — try both.
        payload: dict[str, Any] = {
            "model": model,
            "input": _messages_to_input(messages),
            "temperature": temperature,
        }
        if max_tokens:
            payload["max_output_tokens"] = max_tokens
        resp = http_requests.post(
            f"{_strip_slash(base_url)}/responses",
            headers=_auth_headers(api_key),
            json=payload,
            **_request_kwargs(base_url, timeout=(10, 180)),
        )
        if resp.status_code != 200:
            return None
        return _extract_chat_text(resp.json())
    except Exception:
        return None


# ── Imagine: image ──────────────────────────────────────────────────────────


def generate_image(
    prompt: str,
    *,
    model: str | None = None,
    aspect_ratio: str = "9:16",
    resolution: str = "1k",
    n: int = 1,
    response_format: str = "url",
    quality: bool = False,
) -> dict[str, Any] | None:
    """POST /v1/images/generations against the configured provider.

    **Local Imagine (local):** uses ``{base}/images/generations``
    (base already includes ``/v1``).

    **Agnes AI (remote):** uses ``{base}/v1/images/generations``
    (base does NOT include ``/v1`` — ``_agnes_path()`` adds it).

    Serialised via ``_media_lock``.
    """
    media = media_config()
    if not media["api_key"]:
        return None
    model = model or media["image_model"]
    is_ag = _is_agnes(model)
    # Build correct endpoint: Local base has /v1, Agnes needs /v1 added.
    image_endpoint = (
        f"{media['base_url']}{_agnes_path('/images/generations')}"
        if is_ag
        else f"{media['base_url']}/images/generations"
    )
    # Minimal body first — extra fields have hung some proxy builds.
    bodies: list[dict[str, Any]] = [
        {
            "model": model,
            "prompt": prompt,
            "n": max(1, min(4, int(n))),
        },
        {
            "model": model,
            "prompt": prompt,
            "n": max(1, min(4, int(n))),
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "response_format": response_format,
        },
    ]
    last_err: dict[str, Any] | None = None
    with _media_lock:
        for body in bodies:
            try:
                resp = http_requests.post(
                    image_endpoint,
                    headers=_auth_headers(media["api_key"]),
                    json=body,
                    **_request_kwargs(media["base_url"], timeout=(15, 300)),
                )
                if resp.status_code != 200:
                    last_err = {
                        "error": True,
                        "status": resp.status_code,
                        "message": _safe_err(resp),
                        "hint": _media_hint(media, is_agnes=is_ag),
                    }
                    # 4xx on first (minimal) body → try richer body once
                    if resp.status_code >= 500:
                        break
                    continue
                data = resp.json()
                parsed = _parse_image_response(data)
                if parsed:
                    return parsed
                last_err = {
                    "error": True,
                    "message": "empty image response",
                    "raw": data,
                }
            except http_requests.Timeout:
                hint = (
                    "Agnes image timeout — 确认 AGNES_API_KEY 与网络连接。"
                    if is_ag
                    else "image generation timeout (local Imagine 可能排队中，请稍后重试)"
                )
                last_err = {
                    "error": True,
                    "message": "image generation timeout",
                    "hint": hint,
                }
                break
            except Exception as exc:
                last_err = {
                    "error": True,
                    "message": f"{type(exc).__name__}: {exc}",
                    "hint": _media_hint(media, is_agnes=is_ag),
                }
                break
    return last_err


def _parse_image_response(data: dict[str, Any]) -> dict[str, Any] | None:
    items = data.get("data") or []
    if not items and isinstance(data, dict):
        if isinstance(data.get("url"), str):
            return {"url": data["url"], "raw": data}
        if data.get("b64_json"):
            return {"b64_json": data["b64_json"], "raw": data}
    if not items:
        return None
    first = items[0] if isinstance(items[0], dict) else {}
    if not first.get("url") and not first.get("b64_json"):
        return None
    return {
        "url": first.get("url"),
        "b64_json": first.get("b64_json"),
        "raw": data,
    }


def _media_hint(media: dict[str, str], *, is_agnes: bool | None = None) -> str:
    is_ag = _is_agnes() if is_agnes is None else is_agnes
    if is_ag:
        return (
            f"使用 Agnes AI（{media.get('base_url')}，模型："
            f"{media.get('image_model')}/{media.get('video_model')}）。"
            "确认 AGNES_API_KEY 有效、账户余额充足。"
            "官网：https://platform.agnes-ai.com/ 。"
        )
    if _is_loopback(media["base_url"]):
        return (
            "使用本地 8317 Imagine（模型："
            f"{media.get('image_model')}/{media.get('video_model')}）。"
            "若超时：确认本地代理在跑、勿并发多路生图，"
            "可用 GET /api/studio/provider 查看模型列表。"
        )
    return "检查 SAU_MEDIA_API_KEY 与模型名是否在 /v1/models 中。"


def _agnes_path(path: str) -> str:
    """Prepend ``/v1`` to a path segment for Agnes API calls.

    Agnes uses ``/v1/images/generations`` and ``/v1/videos``
    for creation, but ``/agnesapi...`` for polling (no ``/v1``).
    """
    p = path.lstrip("/")
    if p.startswith("agnesapi") or p.startswith("v1/"):
        return path
    return f"/v1/{p}"


def _safe_err(resp: http_requests.Response) -> str:
    try:
        j = resp.json()
        err = j.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err)
        if isinstance(err, str):
            return err
        return str(j)[:300]
    except Exception:
        return (resp.text or "")[:300] or f"HTTP {resp.status_code}"


def save_image_result(
    result: dict[str, Any],
    *,
    project_id: int,
    stem: str,
) -> str | None:
    """Persist image URL or b64 to ``media/studio/<project_id>/``; return public path."""
    if not result or result.get("error"):
        return None
    out_dir = STUDIO_MEDIA_DIR / str(project_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem)[:80] or "img"
    path = out_dir / f"{safe}.jpg"

    b64 = result.get("b64_json")
    if b64:
        raw = base64.b64decode(b64)
        path.write_bytes(raw)
        return f"/api/studio/media/{project_id}/{path.name}"

    url = result.get("url")
    if isinstance(url, str) and url.startswith("http"):
        try:
            # Image CDN URLs are remote — allow system proxy for those.
            r = http_requests.get(url, timeout=(10, 60))
            if r.status_code == 200 and r.content:
                # sniff extension
                ctype = "jpg"
                ct = r.headers.get("content-type", "")
                if "png" in ct:
                    ctype = "png"
                elif "webp" in ct:
                    ctype = "webp"
                path = out_dir / f"{safe}.{ctype}"
                path.write_bytes(r.content)
                return f"/api/studio/media/{project_id}/{path.name}"
        except Exception:
            # Keep remote URL as last resort (may expire).
            return url
    return None


# ── Imagine: video (async) ──────────────────────────────────────────────────


def start_video(
    prompt: str,
    *,
    model: str | None = None,
    duration: int = 6,
    aspect_ratio: str = "9:16",
    resolution: str = "480p",
    image_url: str | None = None,
) -> dict[str, Any]:
    """Create a video generation task.

    **Local Imagine (local):**
        ``POST {base}/videos/generations`` → ``{request_id}``

    **Agnes AI (remote):**
        ``POST {base}/v1/videos`` → ``{video_id, id, status, ...}``

    Returns ``{request_id, raw, model}`` on success, ``{error, message}`` on failure.
    """
    media = media_config()
    if not media["api_key"]:
        return {"error": True, "message": "no media api key"}
    model = model or media["video_model"]
    is_ag = _is_agnes(model)
    duration = max(1, min(15, int(duration)))

    # Build request body (provider-specific).
    if is_ag:
        # Agnes uses POST /v1/videos (base has no /v1 — _agnes_path adds it).
        body: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
        }
        if image_url:
            body["image"] = image_url
        video_endpoint = f"{media['base_url']}{_agnes_path('/videos')}"
    else:
        # Local Imagine uses POST /videos/generations.
        body = {
            "model": model,
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
        }
        if image_url:
            body["image"] = {"url": image_url}
        video_endpoint = f"{media['base_url']}/videos/generations"

    with _media_lock:
        try:
            req_kw = _request_kwargs(media["base_url"], timeout=(15, 120))
            resp = http_requests.post(
                video_endpoint,
                headers=_auth_headers(media["api_key"]),
                json=body,
                **req_kw,
            )

            if resp.status_code not in (200, 201, 202):
                return {
                    "error": True,
                    "status": resp.status_code,
                    "message": _safe_err(resp),
                    "hint": _media_hint(media, is_agnes=is_ag),
                }
            data = resp.json()

            if is_ag:
                # Agnes response: {video_id, id, status, ...}
                rid = data.get("video_id") or data.get("id")
                if not rid:
                    return {
                        "error": True,
                        "message": "no video_id in Agnes video response",
                        "raw": data,
                        "hint": _media_hint(media, is_agnes=is_ag),
                    }
                return {"request_id": str(rid), "raw": data, "model": model, "provider": "agnes"}
            else:
                # Local response: {request_id, id, ...}
                rid = data.get("request_id") or data.get("id")
                if not rid:
                    return {
                        "error": True,
                        "message": "no request_id in video response",
                        "raw": data,
                        "hint": _media_hint(media, is_agnes=is_ag),
                    }
                return {"request_id": str(rid), "raw": data, "model": body["model"], "provider": "local"}

        except http_requests.Timeout:
            hint = "Agnes video timeout — 确认 AGNES_API_KEY 与网络连接。" if is_ag else (
                "video start timeout (local Imagine 排队中)"
            )
            return {
                "error": True,
                "message": "video start timeout",
                "hint": hint,
            }
        except Exception as exc:
            return {
                "error": True,
                "message": f"{type(exc).__name__}: {exc}",
                "hint": _media_hint(media, is_agnes=is_ag),
            }


def poll_video(request_id: str, *, timeout_s: float = 0) -> dict[str, Any]:
    """Poll a video generation task until completion.

    **Local Imagine (local):**
        ``GET {base}/videos/{request_id}`` → ``{status: "done", video: {url}, ...}``

    **Agnes AI (remote):**
        ``GET /agnesapi?video_id=...&model_name=...`` → ``{status: "completed", video_url, url, ...}``

    If ``timeout_s > 0``, polls in a 3-second loop until done/failed/expired.
    """
    media = media_config()
    if not media["api_key"]:
        return {"error": True, "message": "no media api key"}
    is_ag = _is_agnes()

    def _url() -> str:
        """Build polling URL based on detected provider."""
        if is_ag:
            import urllib.parse

            params = {"video_id": request_id}
            if media.get("video_model"):
                params["model_name"] = media["video_model"]
            return f"{media['base_url']}/agnesapi?{urllib.parse.urlencode(params)}"
        return f"{media['base_url']}/videos/{request_id}"

    def _once() -> dict[str, Any]:
        try:
            url = _url()
            resp = http_requests.get(
                url,
                headers={"Authorization": f"Bearer {media['api_key']}"},
                **_request_kwargs(media["base_url"], timeout=(10, 30)),
            )
            if resp.status_code != 200:
                # Fallback: for Agnes, try legacy task_id endpoint under /v1/.
                if is_ag and resp.status_code == 404:
                    fallback_url = f"{media['base_url']}/v1/videos/{request_id}"
                    fallback_resp = http_requests.get(
                        fallback_url,
                        headers={"Authorization": f"Bearer {media['api_key']}"},
                        **_request_kwargs(media["base_url"], timeout=(10, 30)),
                    )
                    if fallback_resp.status_code == 200:
                        data = fallback_resp.json()
                        status = str(data.get("status") or "").lower()
                        url_val = (
                            data.get("video_url")
                            or data.get("url")
                            or data.get("remixed_from_video_id")
                        )
                        return {
                            "request_id": request_id,
                            "status": status or "unknown",
                            "url": url_val,
                            "raw": data,
                            "provider": "agnes",
                        }
                return {
                    "error": True,
                    "status": resp.status_code,
                    "message": _safe_err(resp),
                }
            data = resp.json()
            status = str(data.get("status") or "").lower()
            if is_ag:
                # Agnes fields: video_url, url, remixed_from_video_id
                url_val = (
                    data.get("video_url")
                    or data.get("url")
                    or data.get("remixed_from_video_id")
                )
                return {
                    "request_id": request_id,
                    "status": status or "unknown",
                    "url": url_val,
                    "raw": data,
                    "provider": "agnes",
                }
            # Local fields: video.url, url
            video = data.get("video") if isinstance(data.get("video"), dict) else {}
            url_val = video.get("url") or data.get("url")
            return {
                "request_id": request_id,
                "status": status or "unknown",
                "url": url_val,
                "raw": data,
            }
        except Exception as exc:
            return {"error": True, "message": f"{type(exc).__name__}: {exc}"}

    if timeout_s <= 0:
        return _once()

    deadline = time.time() + timeout_s
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = _once()
        if last.get("error"):
            return last
        st = last.get("status")
        if st in ("done", "completed", "succeeded", "success"):
            return last
        if st in ("failed", "expired", "error", "cancelled"):
            return last
        time.sleep(3)
    last["error"] = True
    last["message"] = last.get("message") or "video poll timeout"
    return last


def resolve_studio_media_file(project_id: int, filename: str) -> Path | None:
    safe = Path(filename).name
    path = STUDIO_MEDIA_DIR / str(project_id) / safe
    if path.is_file():
        return path
    return None
