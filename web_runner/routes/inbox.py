"""Inbox — share-link download (yt-dlp) + file serve + reveal + transcribe stub.

Front-end: ``sau_web/frontend/src/api/inbox.ts``
"""
from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from flask import Blueprint, Response, jsonify, request, send_from_directory

from web_runner.utils import INBOX_DIR, log

bp = Blueprint("inbox", __name__)

_SAFE_NAME = re.compile(r"^[\w.\- +\u4e00-\u9fff]+$")


def _safe_filename(name: str) -> str | None:
    name = (name or "").strip()
    if not name or ".." in name or "/" in name or "\\" in name:
        return None
    if not _SAFE_NAME.match(name):
        # still allow if pure basename without traversal
        base = Path(name).name
        if base != name or not base:
            return None
        return base
    return name


@bp.post("/api/inbox/download")
def inbox_download():
    payload = request.get_json(silent=True) or {}
    url = (payload.get("url") or "").strip()
    if not url:
        return jsonify({"success": False, "message": "url is required"}), 400
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return jsonify({"success": False, "message": "invalid url"}), 400

    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    outtmpl = str(INBOX_DIR / f"%(title).80B_{ts}.%(ext)s")

    try:
        import yt_dlp  # type: ignore
    except ImportError:
        return jsonify({
            "success": False,
            "message": "yt-dlp not installed; run: uv pip install yt-dlp",
        }), 503

    ydl_opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": False,
        "retries": 2,
        "socket_timeout": 60,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
        path = Path(filename)
        if not path.exists():
            # sometimes ext remux
            candidates = sorted(INBOX_DIR.glob(f"*_{ts}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
            if not candidates:
                return jsonify({"success": False, "message": "download finished but file missing"}), 502
            path = candidates[0]
        log(f"[inbox] downloaded {path.name} from {url}")
        return jsonify({
            "success": True,
            "filename": path.name,
            "engine": "yt-dlp",
            "dir": str(INBOX_DIR),
            "data": {
                "filename": path.name,
                "engine": "yt-dlp",
                "dir": str(INBOX_DIR),
            },
        })
    except Exception as exc:  # strict-exceptions: allow boundary
        log(f"[inbox] download failed: {type(exc).__name__}: {exc}")
        return jsonify({
            "success": False,
            "message": f"download failed: {type(exc).__name__}: {exc}",
        }), 502


@bp.get("/api/inbox/file/<path:filename>")
def inbox_file(filename: str):
    safe = _safe_filename(filename)
    if not safe:
        return jsonify({"success": False, "message": "invalid filename"}), 400
    path = INBOX_DIR / safe
    if not path.is_file():
        return jsonify({"success": False, "message": "file not found"}), 404
    return send_from_directory(INBOX_DIR, safe, as_attachment=False)


@bp.post("/api/inbox/reveal")
def inbox_reveal():
    """Open downloads folder in OS file manager (best-effort)."""
    payload = request.get_json(silent=True) or {}
    filename = payload.get("filename")
    target = INBOX_DIR
    if filename:
        safe = _safe_filename(str(filename))
        if safe and (INBOX_DIR / safe).is_file():
            target = INBOX_DIR / safe
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    try:
        system = os.uname().sysname if hasattr(os, "uname") else ""
        if system == "Darwin":
            subprocess.Popen(["open", str(target if target.is_dir() else target.parent)])
        elif system == "Linux":
            subprocess.Popen(["xdg-open", str(target if target.is_dir() else target.parent)])
        else:
            os.startfile(str(target if target.is_dir() else target.parent))  # type: ignore[attr-defined]
        return jsonify({"success": True, "message": "opened", "path": str(target)})
    except Exception as exc:  # strict-exceptions: allow
        return jsonify({"success": False, "message": str(exc)}), 500


@bp.post("/api/inbox/transcribe")
def inbox_transcribe():
    """Streaming text stub — full STT is optional; keep envelope for UI."""
    payload = request.get_json(silent=True) or {}
    filename = payload.get("filename") or ""

    def generate() -> Response:
        msg = (
            f"[transcribe] 本地壳未内置语音识别引擎。"
            f"文件: {filename or '(none)'}。"
            f"可后续接入 whisper/edge-tts 流水线。\n"
        )
        yield msg

    return Response(generate(), mimetype="text/plain; charset=utf-8")
