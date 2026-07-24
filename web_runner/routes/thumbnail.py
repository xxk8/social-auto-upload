"""Cover / thumbnail generation (Phase 2b) — OpenCV + Pillow (already project deps)."""
from __future__ import annotations

import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory

from web_runner.utils import UPLOADS_DIR, BASE_DIR, log

bp = Blueprint("thumbnail", __name__)

THUMB_DIR = BASE_DIR / "media" / "thumbnails"
THUMB_DIR.mkdir(parents=True, exist_ok=True)


def _save_upload() -> Path | None:
    f = request.files.get("file")
    if f and f.filename:
        ext = Path(f.filename).suffix or ".mp4"
        path = UPLOADS_DIR / f"thumb_{uuid.uuid4().hex}{ext}"
        f.save(path)
        return path
    data = request.get_json(silent=True) or {}
    p = data.get("path") or data.get("file_path")
    if p and Path(p).exists():
        return Path(p)
    return None


def _extract_best_frame(video_path: Path) -> "object":
    import cv2
    from PIL import Image

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {video_path}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    # Sample mid-frame (good default without expensive analysis)
    target = max(0, total // 2) if total > 0 else 0
    cap.set(cv2.CAP_PROP_POS_FRAMES, target)
    ok, frame = cap.read()
    if not ok or frame is None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        raise RuntimeError("未能从视频提取帧")
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


def _add_text_overlay(image, text: str, *, position: str = "bottom"):
    from PIL import ImageDraw, ImageFont

    img = image.copy()
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 36)
    except OSError:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
        except OSError:
            font = ImageFont.load_default()
    w, h = img.size
    # simple shadow text
    margin = 24
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = max(margin, (w - tw) // 2)
    y = h - th - margin if position == "bottom" else margin
    for dx, dy in ((1, 1), (0, 0)):
        draw.text((x + dx, y + dy), text, font=font, fill=(0, 0, 0) if dx else (255, 255, 255))
    return img


def _add_watermark(image, watermark_path: Path, *, opacity: float = 0.45):
    from PIL import Image

    base = image.convert("RGBA")
    mark = Image.open(watermark_path).convert("RGBA")
    # scale watermark to ~18% of base width
    target_w = max(32, int(base.width * 0.18))
    ratio = target_w / mark.width
    mark = mark.resize((target_w, max(16, int(mark.height * ratio))), Image.Resampling.LANCZOS)
    if opacity < 1:
        alpha = mark.split()[3]
        alpha = alpha.point(lambda p: int(p * opacity))
        mark.putalpha(alpha)
    pos = (base.width - mark.width - 16, base.height - mark.height - 16)
    base.alpha_composite(mark, dest=pos)
    return base.convert("RGB")


@bp.get("/api/thumbnail/health")
def thumbnail_health():
    return jsonify({"success": True, "data": {"available": True}})


@bp.post("/api/thumbnail/generate")
def generate_thumbnail():
    path = _save_upload()
    if not path:
        return jsonify({"success": False, "message": "需要上传 file 或提供 path"}), 400
    data = request.form.to_dict() if request.form else (request.get_json(silent=True) or {})
    text = (data.get("text") or data.get("title") or "").strip()
    try:
        img = _extract_best_frame(path)
        if text:
            img = _add_text_overlay(img, text)
        out = THUMB_DIR / f"{path.stem}_{uuid.uuid4().hex[:8]}.jpg"
        img.save(out, quality=90)
        log(f"[thumbnail] {path.name} → {out.name}")
        return jsonify({
            "success": True,
            "data": {"path": str(out), "url": f"/api/thumbnail/file/{out.name}"},
        })
    except Exception as exc:  # strict-exceptions: allow
        return jsonify({"success": False, "message": f"{type(exc).__name__}: {exc}"}), 500


@bp.post("/api/thumbnail/batch-watermark")
def batch_watermark():
    """Apply one watermark image onto many cover images."""
    mark = request.files.get("watermark")
    if not mark or not mark.filename:
        return jsonify({"success": False, "message": "需要 watermark 文件"}), 400
    mark_path = UPLOADS_DIR / f"wm_{uuid.uuid4().hex}{Path(mark.filename).suffix or '.png'}"
    mark.save(mark_path)
    images = request.files.getlist("images") or request.files.getlist("files")
    if not images:
        return jsonify({"success": False, "message": "需要 images 文件列表"}), 400
    from PIL import Image

    results = []
    for img_f in images:
        if not img_f.filename:
            continue
        src = UPLOADS_DIR / f"wm_src_{uuid.uuid4().hex}{Path(img_f.filename).suffix}"
        img_f.save(src)
        try:
            base = Image.open(src).convert("RGB")
            out_img = _add_watermark(base, mark_path)
            out = THUMB_DIR / f"wm_{uuid.uuid4().hex[:10]}.jpg"
            out_img.save(out, quality=90)
            results.append({"path": str(out), "url": f"/api/thumbnail/file/{out.name}"})
        except Exception as exc:  # strict-exceptions: allow
            results.append({"error": f"{type(exc).__name__}: {exc}", "source": img_f.filename})
    return jsonify({"success": True, "data": {"items": results}})


@bp.get("/api/thumbnail/file/<path:filename>")
def thumbnail_file(filename: str):
    return send_from_directory(THUMB_DIR, Path(filename).name)
