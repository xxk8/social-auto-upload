"""Auto-subtitle APIs via faster-whisper (Phase 2b).

Optional dep: ``faster-whisper``. Without it, endpoints return 501.
"""
from __future__ import annotations

import subprocess
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory

from web_runner.utils import UPLOADS_DIR, BASE_DIR, log

bp = Blueprint("subtitle", __name__)

SUB_DIR = BASE_DIR / "media" / "subtitles"
SUB_DIR.mkdir(parents=True, exist_ok=True)

_whisper_model = None


def _deps_ok() -> tuple[bool, str]:
    try:
        import faster_whisper  # noqa: F401
        return True, ""
    except ImportError as exc:
        return False, (
            f"缺少 faster-whisper: {exc}. 安装: pip install 'social-auto-upload[media]' "
            "或 pip install faster-whisper"
        )


def _get_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel

        size = __import__("os").environ.get("SAU_WHISPER_MODEL", "base")
        _whisper_model = WhisperModel(size, device="cpu", compute_type="int8")
    return _whisper_model


def _save_upload() -> Path | None:
    f = request.files.get("file")
    if f and f.filename:
        ext = Path(f.filename).suffix or ".mp4"
        path = UPLOADS_DIR / f"sub_{uuid.uuid4().hex}{ext}"
        f.save(path)
        return path
    data = request.get_json(silent=True) or {}
    p = data.get("path") or data.get("file_path")
    if p and Path(p).exists():
        return Path(p)
    return None


def _extract_audio(video_path: Path) -> Path:
    audio_path = UPLOADS_DIR / f"{video_path.stem}_{uuid.uuid4().hex[:8]}.wav"
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(audio_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0 or not audio_path.exists():
        raise RuntimeError(f"ffmpeg audio extract failed: {proc.stderr[-400:]}")
    return audio_path


def _segments_to_srt(segments) -> str:
    def _ts(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int((seconds - int(seconds)) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    lines = []
    for i, seg in enumerate(segments, start=1):
        lines.append(str(i))
        lines.append(f"{_ts(seg.start)} --> {_ts(seg.end)}")
        lines.append(seg.text.strip())
        lines.append("")
    return "\n".join(lines)


@bp.get("/api/subtitle/health")
def subtitle_health():
    ok, msg = _deps_ok()
    return jsonify({"success": True, "data": {"available": ok, "message": msg or None}})


@bp.post("/api/subtitle/generate")
def generate_subtitle():
    ok, msg = _deps_ok()
    if not ok:
        return jsonify({"success": False, "message": msg}), 501
    path = _save_upload()
    if not path:
        return jsonify({"success": False, "message": "需要上传 file 或提供 path"}), 400
    try:
        audio = _extract_audio(path)
        model = _get_model()
        segments, info = model.transcribe(str(audio), beam_size=5)
        segs = list(segments)
        srt = _segments_to_srt(segs)
        out = SUB_DIR / f"{path.stem}_{uuid.uuid4().hex[:8]}.srt"
        out.write_text(srt, encoding="utf-8")
        log(f"[subtitle] {path.name} → {out.name} lang={getattr(info, 'language', '?')}")
        return jsonify({
            "success": True,
            "data": {
                "srt": srt,
                "path": str(out),
                "url": f"/api/subtitle/file/{out.name}",
                "language": getattr(info, "language", None),
                "segments": [
                    {"start": s.start, "end": s.end, "text": s.text.strip()}
                    for s in segs
                ],
            },
        })
    except Exception as exc:  # strict-exceptions: allow
        return jsonify({"success": False, "message": f"{type(exc).__name__}: {exc}"}), 500


@bp.post("/api/subtitle/burn")
def burn_subtitle():
    """Optional hard-burn via ffmpeg subtitles filter."""
    ok, msg = _deps_ok()
    if not ok:
        return jsonify({"success": False, "message": msg}), 501
    data = request.get_json(silent=True) or {}
    video = data.get("video_path") or data.get("path")
    srt = data.get("srt_path")
    if not video or not srt or not Path(video).exists() or not Path(srt).exists():
        return jsonify({"success": False, "message": "video_path 与 srt_path 必填且文件存在"}), 400
    out = SUB_DIR / f"burn_{uuid.uuid4().hex[:10]}.mp4"
    # Escape path for subtitles filter
    srt_esc = str(Path(srt).resolve()).replace("\\", "/").replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y", "-i", str(video),
        "-vf", f"subtitles='{srt_esc}'",
        "-c:a", "copy", str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if proc.returncode != 0 or not out.exists():
        return jsonify({"success": False, "message": f"burn failed: {proc.stderr[-400:]}"}), 500
    return jsonify({
        "success": True,
        "data": {"path": str(out), "url": f"/api/subtitle/file/{out.name}"},
    })


@bp.get("/api/subtitle/file/<path:filename>")
def subtitle_file(filename: str):
    return send_from_directory(SUB_DIR, Path(filename).name)
