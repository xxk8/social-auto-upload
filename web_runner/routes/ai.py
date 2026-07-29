"""AI content generation routes."""
from __future__ import annotations

import json
import os
import queue as _queue
import threading
from typing import Generator

from flask import Blueprint, Response, jsonify, request
import requests as http_requests

from web_runner.ai_worker import (
    AI_MODELS,
    DEFAULT_SYSTEM_PROMPT,
    PLATFORM_PROMPTS,
    _ai_request_semaphore,
    _build_media_content,
    _clear_rate_limited,
    _get_all_keys,
    _get_all_keys_cached,
    _get_next_key,
    _has_any_api_key,
    _mark_rate_limited,
    _validate_openrouter_key,
)
from web_runner.db import db_lock, get_connection
from web_runner.utils import log

bp = Blueprint("ai", __name__)

OPENROUTE_BASE_URL = "https://openrouter.ai/api/v1"

_ai_request_queue: _queue.Queue = _queue.Queue()
_ai_queue_lock = threading.Lock()
_ai_queue_worker_started = False

# Hard cap on multi-turn messages array length — bounds LLM cost and
# context-window abuse. See specs/ai-stream-multimessage.
MAX_MESSAGES_PER_REQUEST = 30


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
                            try:
                                _clear_rate_limited(current_key)
                            except Exception:
                                pass
                            break
                        elif resp.status_code in (429, 402):
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


def _stream_openrouter(model: str, messages: list[dict], max_tokens: int = 2000, temperature: float = 0.7) -> Generator[str, None, None]:
    """Shared SSE streaming generator with key rotation on 429/402."""
    all_keys = _get_all_keys()
    max_attempts = max(len(all_keys), 1)
    tried: set[str] = set()
    current_key = _get_next_key()

    for _ in range(max_attempts):
        if not current_key:
            yield f"event: error\ndata: {json.dumps({'message': 'No API keys available.'})}\n\n"
            return
        if current_key in tried:
            # Pool exhausted unique keys — pick any remaining untried from DB.
            remaining = [k["api_key"] for k in all_keys if k["api_key"] not in tried]
            if not remaining:
                break
            current_key = remaining[0]
        tried.add(current_key)

        key_info = None
        for k in _get_all_keys():
            if k["api_key"] == current_key:
                key_info = {"id": k["id"], "masked": k["masked"]}
                break
        if key_info:
            yield f"event: key_info\ndata: {json.dumps(key_info)}\n\n"

        try:
            resp = http_requests.post(
                f"{OPENROUTE_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {current_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": True,
                },
                timeout=(10, 120),
                stream=True,
            )

            # Rate limit / quota — mark and rotate to next key.
            if resp.status_code in (429, 402):
                _mark_rate_limited(current_key)
                nxt = _get_next_key()
                # Prefer a key we have not tried this request.
                if nxt in tried:
                    untried = [k["api_key"] for k in _get_all_keys() if k["api_key"] not in tried]
                    nxt = untried[0] if untried else ""
                current_key = nxt
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

            # Success — re-enable key for future rotation.
            try:
                _clear_rate_limited(current_key)
            except Exception:
                pass
            yield f"event: done\ndata: {json.dumps({'content': full_content.strip()})}\n\n"
            return

        except (http_requests.RequestException, OSError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError, ValueError, KeyError) as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e) or type(e).__name__})}\n\n"
            return

    yield f"event: error\ndata: {json.dumps({'message': 'All API keys rate-limited. Please wait a few minutes and try again.'})}\n\n"


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
    with db_lock:
        with get_connection() as conn:
            rows = conn.execute("SELECT * FROM ai_api_keys").fetchall()
    configured = bool(rows) or bool(os.environ.get("OPENROUTE_API_KEY", ""))
    return jsonify({"success": True, "data": {"configured": configured, "key_count": len(rows)}})


@bp.get("/api/ai/keys")
def ai_keys_list():
    from web_runner.ai_worker import _is_key_cooling_down

    keys = _get_all_keys_cached()
    return jsonify(
        {
            "success": True,
            "data": [
                {
                    "id": k["id"],
                    "masked": k["masked"],
                    "created": k["created"],
                    "rate_limited": _is_key_cooling_down(k),
                    "rate_limited_at": k.get("rate_limited_at"),
                }
                for k in keys
            ],
        }
    )


@bp.post("/api/ai/keys/validate")
def ai_keys_validate():
    """Probe a key against OpenRouter (快捷测活). Pass api_key or key_id."""
    data = request.get_json(silent=True) or {}
    key = (data.get("api_key") or "").strip()
    key_id = data.get("key_id")
    if not key and key_id is not None:
        with db_lock:
            with get_connection() as conn:
                row = conn.execute(
                    "SELECT api_key FROM ai_api_keys WHERE id = ?",
                    (int(key_id),),
                ).fetchone()
        if not row:
            return jsonify({"success": False, "message": "Key not found."}), 404
        key = row["api_key"] if not isinstance(row, dict) else row.get("api_key", "")
    result = _validate_openrouter_key(key)
    if result.get("ok"):
        # Live key — clear any stale cooldown so rotation can use it.
        try:
            _clear_rate_limited(key)
        except Exception:
            pass
        return jsonify(
            {
                "success": True,
                "message": result.get("message", "Key 有效"),
                "data": result.get("data") or {},
            }
        )
    return jsonify({"success": False, "message": result.get("message") or "Key 无效"}), 400


@bp.post("/api/ai/config")
def ai_config_set():
    from datetime import datetime

    data = request.get_json(silent=True) or {}
    key = data.get("api_key", "").strip()
    skip_validate = bool(data.get("skip_validate"))
    if not key:
        return jsonify({"success": False, "message": "API key is required."})

    # Default: probe OpenRouter so we never store dead keys.
    if not skip_validate:
        probe = _validate_openrouter_key(key)
        if not probe.get("ok"):
            return jsonify({"success": False, "message": probe.get("message") or "Key 校验失败"}), 400

    masked = key[:8] + "****" + key[-4:] if len(key) > 12 else "****"
    now = datetime.now().isoformat(timespec="seconds")
    try:
        with db_lock:
            with get_connection() as conn:
                conn.execute(
                    "INSERT INTO ai_api_keys (api_key, masked, created) VALUES (?, ?, ?)",
                    (key, masked, now),
                )
                conn.commit()
                row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        return jsonify(
            {
                "success": True,
                "data": {
                    "configured": True,
                    "key_masked": masked,
                    "key_id": row_id,
                    "validated": not skip_validate,
                },
            }
        )
    except Exception as _int_exc:  # unique violation
        return jsonify({"success": False, "message": "该 Key 已经添加过了。"}), 409


@bp.delete("/api/ai/config")
def ai_config_delete():
    data = request.get_json(silent=True) or {}
    key_id = data.get("key_id")
    if key_id is not None:
        with db_lock:
            with get_connection() as conn:
                cur = conn.execute("DELETE FROM ai_api_keys WHERE id = ?", (int(key_id),))
                conn.commit()
                if cur.rowcount == 0:
                    return jsonify({"success": False, "message": "Key not found."}), 404
        return jsonify({"success": True, "message": "Key removed."})
    with db_lock:
        with get_connection() as conn:
            conn.execute("DELETE FROM ai_api_keys")
            conn.commit()
    return jsonify({"success": True, "message": "All API keys removed."})


@bp.post("/api/ai/keys/batch")
def ai_keys_batch():
    from datetime import datetime

    data = request.get_json(silent=True) or {}
    raw = data.get("keys", [])
    skip_validate = bool(data.get("skip_validate"))
    if not isinstance(raw, list):
        return jsonify({"success": False, "message": "keys must be an array."}), 400

    now = datetime.now().isoformat(timespec="seconds")
    added = 0
    skipped = 0
    invalid: list[dict] = []
    with db_lock:
        with get_connection() as conn:
            for entry in raw:
                key = (entry if isinstance(entry, str) else str(entry)).strip()
                if not key or not key.startswith("sk-"):
                    skipped += 1
                    continue
                if not skip_validate:
                    probe = _validate_openrouter_key(key)
                    if not probe.get("ok"):
                        invalid.append(
                            {
                                "masked": (key[:8] + "****" + key[-4:]) if len(key) > 12 else "****",
                                "message": probe.get("message") or "无效",
                            }
                        )
                        skipped += 1
                        continue
                masked = key[:8] + "****" + key[-4:] if len(key) > 12 else "****"
                try:
                    conn.execute(
                        "INSERT INTO ai_api_keys (api_key, masked, created) VALUES (?, ?, ?)",
                        (key, masked, now),
                    )
                    added += 1
                except Exception as _int_exc:  # unique violation
                    skipped += 1
            conn.commit()
    return jsonify(
        {
            "success": True,
            "data": {
                "added": added,
                "skipped": skipped,
                "invalid": invalid,
                "validated": not skip_validate,
            },
        }
    )


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


# ── Optional AI endpoints used by restored SPA (best-effort stubs) ──

@bp.post("/api/ai/generate/variants")
def ai_generate_variants():
    if not _has_any_api_key():
        def err():
            yield f"event: error\ndata: {json.dumps({'message': 'AI service not configured.'})}\n\n"
        return Response(err(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    data = request.get_json(silent=True) or {}
    model = data.get("model", "google/gemma-4-26b-a4b-it:free")
    prompt = (data.get("prompt") or data.get("instruction") or "").strip()
    system_prompt = data.get("system_prompt") or DEFAULT_SYSTEM_PROMPT
    messages = data.get("messages")
    if not isinstance(messages, list) or not messages:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt or "请生成一组标题、描述、标签"},
        ]
    return Response(
        _stream_openrouter(model, messages),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@bp.post("/api/ai/generate/multi-platform")
def ai_generate_multi_platform():
    return ai_generate_variants()


@bp.post("/api/ai/search")
def ai_search():
    data = request.get_json(silent=True) or {}
    q = data.get("q") or data.get("query") or ""
    return jsonify({
        "success": True,
        "data": {"query": q, "results": [], "message": "web search not configured in local shell"},
    })


@bp.post("/api/ai/images/search")
def ai_images_search():
    data = request.get_json(silent=True) or {}
    q = data.get("q") or data.get("query") or data.get("keyword") or ""
    return jsonify({
        "success": True,
        "data": {"query": q, "images": [], "message": "image search not configured"},
    })


@bp.post("/api/ai/recommend-images")
def ai_recommend_images():
    return jsonify({"success": True, "data": {"images": []}})


@bp.get("/api/ai/images/fetch")
def ai_images_fetch():
    """Proxy-fetch a remote image URL into a binary response (best-effort)."""
    import requests as http_requests

    url = request.args.get("url") or ""
    if not url.startswith("http"):
        return jsonify({"success": False, "message": "invalid url"}), 400
    try:
        resp = http_requests.get(url, timeout=20)
        resp.raise_for_status()
        return Response(
            resp.content,
            mimetype=resp.headers.get("Content-Type", "application/octet-stream"),
        )
    except Exception as exc:  # strict-exceptions: allow
        return jsonify({"success": False, "message": str(exc)}), 502
