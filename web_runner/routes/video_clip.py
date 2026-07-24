"""Video scene-detect + clip APIs (Phase 2b).

Optional deps: ``scenedetect``, ``moviepy``. Without them endpoints return 501
with a clear message so the SPA can degrade gracefully.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request

from web_runner.utils import UPLOADS_DIR, BASE_DIR, log

bp = Blueprint("video_clip", __name__)

CLIPS_DIR = BASE_DIR / "media" / "clips"
CLIPS_DIR.mkdir(parents=True, exist_ok=True)


def _optional_deps_ok() -> tuple[bool, str]:
    try:
        import scenedetect  # noqa: F401
        import moviepy  # noqa: F401
        return True, ""
    except ImportError as exc:
        return False, (
            f"缺少媒体依赖: {exc}. 安装: pip install 'social-auto-upload[media]' "
            "或 pip install moviepy scenedetect"
        )


def _save_upload() -> Path | None:
    f = request.files.get("file")
    if f and f.filename:
        ext = Path(f.filename).suffix or ".mp4"
        path = UPLOADS_DIR / f"clip_{uuid.uuid4().hex}{ext}"
        f.save(path)
        return path
    data = request.get_json(silent=True) or {}
    p = data.get("path") or data.get("file_path")
    if p and Path(p).exists():
        return Path(p)
    return None


def _detect_scenes(video_path: Path) -> list[dict]:
    from scenedetect import open_video, SceneManager
    from scenedetect.detectors import ContentDetector

    video = open_video(str(video_path))
    manager = SceneManager()
    manager.add_detector(ContentDetector(threshold=27.0))
    manager.detect_scenes(video)
    scenes = manager.get_scene_list()
    out = []
    for i, (start, end) in enumerate(scenes):
        out.append({
            "index": i,
            "start": start.get_seconds(),
            "end": end.get_seconds(),
            "duration": max(0.0, end.get_seconds() - start.get_seconds()),
        })
    if not out:
        # Single scene fallback: whole video
        try:
            from moviepy import VideoFileClip
            with VideoFileClip(str(video_path)) as clip:
                dur = float(clip.duration or 0)
        except Exception:
            dur = 0.0
        out = [{"index": 0, "start": 0.0, "end": dur, "duration": dur}]
    return out


def _clip_video(video_path: Path, scenes: list[dict]) -> list[dict]:
    from moviepy import VideoFileClip

    results = []
    with VideoFileClip(str(video_path)) as clip:
        for sc in scenes:
            start, end = float(sc["start"]), float(sc["end"])
            if end <= start:
                continue
            out_path = CLIPS_DIR / f"{video_path.stem}_{sc['index']}_{uuid.uuid4().hex[:8]}.mp4"
            sub = clip.subclipped(start, min(end, clip.duration or end))
            try:
                sub.write_videofile(
                    str(out_path),
                    codec="libx264",
                    audio_codec="aac",
                    logger=None,
                )
            finally:
                sub.close()
            results.append({
                **sc,
                "path": str(out_path),
                "url": f"/api/video/clip/file/{out_path.name}",
            })
    return results


@bp.get("/api/video/clip/health")
def clip_health():
    ok, msg = _optional_deps_ok()
    return jsonify({"success": True, "data": {"available": ok, "message": msg or None}})


@bp.post("/api/video/clip")
def clip_auto():
    ok, msg = _optional_deps_ok()
    if not ok:
        return jsonify({"success": False, "message": msg}), 501
    path = _save_upload()
    if not path:
        return jsonify({"success": False, "message": "需要上传 file 或提供 path"}), 400
    try:
        scenes = _detect_scenes(path)
        clips = _clip_video(path, scenes)
        log(f"[video_clip] {path.name} → {len(clips)} clips")
        return jsonify({"success": True, "data": {"scenes": scenes, "clips": clips}})
    except Exception as exc:  # strict-exceptions: allow — media pipeline
        return jsonify({"success": False, "message": f"{type(exc).__name__}: {exc}"}), 500


@bp.post("/api/video/clip/manual")
def clip_manual():
    ok, msg = _optional_deps_ok()
    if not ok:
        return jsonify({"success": False, "message": msg}), 501
    path = _save_upload()
    payload = request.get_json(silent=True) or {}
    if not path:
        return jsonify({"success": False, "message": "需要上传 file 或提供 path"}), 400
    cuts = payload.get("scenes") or payload.get("cuts") or []
    if not cuts:
        return jsonify({"success": False, "message": "scenes 不能为空"}), 400
    scenes = []
    for i, c in enumerate(cuts):
        scenes.append({
            "index": i,
            "start": float(c.get("start", 0)),
            "end": float(c.get("end", 0)),
            "duration": float(c.get("end", 0)) - float(c.get("start", 0)),
        })
    try:
        clips = _clip_video(path, scenes)
        return jsonify({"success": True, "data": {"scenes": scenes, "clips": clips}})
    except Exception as exc:  # strict-exceptions: allow
        return jsonify({"success": False, "message": f"{type(exc).__name__}: {exc}"}), 500


@bp.get("/api/video/clip/file/<path:filename>")
def clip_file(filename: str):
    from flask import send_from_directory

    safe = Path(filename).name
    return send_from_directory(CLIPS_DIR, safe)
