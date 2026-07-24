"""Inbox — share-link download (yt-dlp) + file serve + reveal + transcribe stub.

Front-end: ``sau_web/frontend/src/api/inbox.ts``
"""
from __future__ import annotations

import hashlib
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
    base = Path(name).name
    if not base or base in (".", ".."):
        return None
    # Allow slightly broader charset by sanitizing instead of rejecting.
    cleaned = re.sub(r"[^\w.\- +\u4e00-\u9fff]", "_", base)
    return cleaned or None


def _url_fingerprint(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]


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
    fp = _url_fingerprint(url)
    # Restrict filenames for shell safety; keep title readable.
    outtmpl = str(INBOX_DIR / f"%(title).60s_{ts}_{fp}.%(ext)s")

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
        "restrictfilenames": True,
        "retries": 3,
        "fragment_retries": 3,
        "socket_timeout": 60,
        "ignoreerrors": False,
        # Prefer a single progressive file when possible.
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if info is None:
                return jsonify({"success": False, "message": "extractor returned empty info"}), 502
            # playlist → take first entry
            if info.get("_type") == "playlist" and info.get("entries"):
                entries = [e for e in info["entries"] if e]
                info = entries[0] if entries else info
            filename = ydl.prepare_filename(info)
            # after merge, ext may be mp4
            path = Path(filename)
            if not path.exists():
                alt = path.with_suffix(".mp4")
                if alt.exists():
                    path = alt
        if not path.exists():
            candidates = sorted(
                INBOX_DIR.glob(f"*_{ts}_{fp}.*"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if not candidates:
                candidates = sorted(
                    INBOX_DIR.glob(f"*_{ts}_*"),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True,
                )
            if not candidates:
                return jsonify({"success": False, "message": "download finished but file missing"}), 502
            path = candidates[0]

        # Normalize weird characters for subsequent /file/<name> fetches
        safe = _safe_filename(path.name) or path.name
        final = INBOX_DIR / safe
        if final != path:
            try:
                if final.exists():
                    final.unlink()
                path.rename(final)
                path = final
            except OSError:
                path = path  # keep original

        size = path.stat().st_size if path.exists() else 0
        log(f"[inbox] downloaded {path.name} ({size} bytes) from {url}")
        return jsonify({
            "success": True,
            "filename": path.name,
            "engine": "yt-dlp",
            "dir": str(INBOX_DIR),
            "size": size,
            "data": {
                "filename": path.name,
                "engine": "yt-dlp",
                "dir": str(INBOX_DIR),
                "size": size,
                "title": (info or {}).get("title") if isinstance(info, dict) else None,
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
    # also try original if sanitization changed nothing but file uses other name
    if not path.is_file():
        # fuzzy: match suffix fingerprint / basename
        matches = list(INBOX_DIR.glob(f"*{Path(filename).name}"))
        if matches:
            path = matches[0]
            safe = path.name
        else:
            return jsonify({"success": False, "message": "file not found"}), 404
    return send_from_directory(INBOX_DIR, safe, as_attachment=False)


@bp.get("/api/inbox/list")
def inbox_list():
    """List downloaded files for the inbox UI."""
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for p in sorted(INBOX_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if not p.is_file() or p.name.startswith("."):
            continue
        st = p.stat()
        files.append({
            "filename": p.name,
            "size": st.st_size,
            "mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(st.st_mtime)),
        })
    return jsonify({"success": True, "data": files})


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

    def generate():
        msg = (
            f"[transcribe] 本地壳未内置语音识别引擎。"
            f"文件: {filename or '(none)'}。"
            f"可后续接入 whisper 等 STT。\n"
        )
        yield msg

    return Response(generate(), mimetype="text/plain; charset=utf-8")
