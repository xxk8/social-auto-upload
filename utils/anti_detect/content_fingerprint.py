"""Content fingerprint obfuscation for video and image uploads.

Platforms (Douyin, Xiaohongshu, Kuaishou, etc.) detect duplicate / reposted
content via perceptual hash, MD5, frame-level features, and encoding fingerprints.

This module provides lightweight ffmpeg-based obfuscation that:

* Changes the file MD5 / SHA-256.
* Alters encoding parameters (bitrate, GOP, pixel format, encoder settings).
* Optionally adds imperceptible spatial noise or 1-2 px crop.
* Strips metadata (EXIF, XMP, encoder tags).

Usage::

    from utils.anti_detect.content_fingerprint import obfuscate_video

    obfuscate_video(
        "input.mp4",
        "output.mp4",
        crop_pixels=2,
        bitrate_variation=0.08,
        add_noise=True,
    )
"""
from __future__ import annotations

import logging
import random
import shutil
import subprocess
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)


def is_ffmpeg_available() -> bool:
    """Return True if ``ffmpeg`` is on the system PATH."""
    return shutil.which("ffmpeg") is not None


def _run_ffmpeg(args: list[str], timeout: int = 300) -> subprocess.CompletedProcess:
    """Run ffmpeg with the given argument list."""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + args
    logger.debug("Running: %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=True)


def strip_media_metadata(input_path: str | Path, output_path: str | Path) -> Path:
    """Strip all metadata (EXIF, XMP, encoder comments) from a media file.

    Falls back to a simple copy if ffmpeg is unavailable.
    """
    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not is_ffmpeg_available():
        logger.warning("ffmpeg not found; falling back to shutil.copy for metadata stripping")
        shutil.copy2(input_path, output_path)
        return output_path

    _run_ffmpeg([
        "-i", str(input_path),
        "-map_metadata", "-1",
        "-c", "copy",
        str(output_path),
    ])
    logger.info("Metadata stripped: %s -> %s", input_path.name, output_path.name)
    return output_path


def obfuscate_video(
    input_path: str | Path,
    output_path: str | Path,
    crop_pixels: int = 2,
    bitrate_variation: float = 0.08,
    add_noise: bool = True,
    target_codec: Literal["libx264", "libx265", "copy"] = "libx264",
    brightness_range: float = 0.02,
    contrast_range: float = 0.02,
    min_bitrate_mbps: float = 1.0,
    fast_mode: bool = False,
) -> Path:
    """Obfuscate a video file to defeat content-hash / perceptual-hash detection.

    The obfuscation is **visually imperceptible** but changes every fingerprint
    vector platforms use (MD5, frame hash, encoding parameters, metadata).

    Args:
        input_path: Source video file.
        output_path: Destination path.
        crop_pixels: Number of pixels to crop from right/bottom edges (1–4).
            A 2-px crop is invisible at 1080p but changes the frame dimensions
            and therefore the MD5 / perceptual hash.
        bitrate_variation: Fractional variation applied to the detected bitrate
            (±8% by default). This alters the encoding fingerprint.
        add_noise: If True, adds imperceptible spatial noise via ffmpeg's
            ``noise`` filter.
        target_codec: Encoder to use. ``"libx264"`` is safest for platform
            compatibility. ``"copy"`` skips re-encoding (only metadata / crop).
        brightness_range: Brightness adjustment range (±), default 0.02 (2%).
        contrast_range: Contrast adjustment range (±), default 0.02 (2%).
        min_bitrate_mbps: Minimum bitrate in Mbps to ensure quality.
        fast_mode: If True, skip noise filter and use copy codec for faster processing.

    Returns:
        Path to the output file.
    """
    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        raise FileNotFoundError(f"Input video not found: {input_path}")

    if not is_ffmpeg_available():
        logger.warning("ffmpeg not found; falling back to copy (metadata-only change)")
        shutil.copy2(input_path, output_path)
        return output_path

    # ── Fast mode: skip re-encoding ─────────────────────────────────────────
    if fast_mode:
        target_codec = "copy"
        add_noise = False

    # ── Probe source bitrate ────────────────────────────────────────────────
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=bit_rate", "-of",
             "default=noprint_wrappers=1:nokey=1", str(input_path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        src_bitrate = int(probe.stdout.strip())
    except (subprocess.CalledProcessError, ValueError):
        src_bitrate = 4_000_000  # fallback 4 Mbps

    # Randomise bitrate ±bitrate_variation
    new_bitrate = int(src_bitrate * (1 + random.uniform(-bitrate_variation, bitrate_variation)))
    new_bitrate = max(int(min_bitrate_mbps * 1_000_000), new_bitrate)  # floor at min_bitrate_mbps

    # ── Probe original dimensions ───────────────────────────────────────────
    _probed_w = _probed_h = ""
    try:
        dim_probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of",
             "csv=s=x:p=0", str(input_path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        _probed_w, _probed_h = dim_probe.stdout.strip().split("x")
    except (subprocess.CalledProcessError, ValueError):
        pass  # If probing fails, skip scale/pad to avoid distorting unknown dimensions

    # ── Build filter graph ──────────────────────────────────────────────────
    filters: list[str] = []

    # 1. Imperceptible crop (changes frame dimensions → hash changes)
    if crop_pixels > 0:
        filters.append(f"crop=iw-{crop_pixels}:ih-{crop_pixels}:0:0")
        # Scale back to original dimensions so platforms don't reject odd sizes
        if _probed_w and _probed_h:
            filters.append(f"scale={_probed_w}:{_probed_h}:force_original_aspect_ratio=decrease")
            filters.append(f"pad={_probed_w}:{_probed_h}:(ow-iw)/2:(oh-ih)/2")

    # 2. Imperceptible noise (all=0 means no noise; we use a tiny amount)
    if add_noise and not fast_mode:
        # all=1:1:1 means uniform noise of 1 pixel value on each channel — invisible
        filters.append("noise=alls=1:allf=t+u")

    # 4. Slight brightness/contrast jitter (imperceptible)
    brightness = random.uniform(-brightness_range, brightness_range)
    contrast = random.uniform(1 - contrast_range, 1 + contrast_range)
    filters.append(f"eq=brightness={brightness}:contrast={contrast}")

    filter_str = ",".join(filters)

    # ── Build ffmpeg args ───────────────────────────────────────────────────
    args: list[str] = ["-i", str(input_path)]

    if filter_str:
        args += ["-vf", filter_str]

    if target_codec != "copy":
        args += [
            "-c:v", target_codec,
            "-b:v", f"{new_bitrate}",
            "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-g", str(random.randint(48, 72)),  # GOP size jitter
            "-movflags", "+faststart",
        ]
    else:
        args += ["-c:v", "copy"]

    # Audio: always re-encode slightly to change audio hash too
    args += [
        "-c:a", "aac",
        "-b:a", f"{random.choice([128_000, 160_000, 192_000])}",
        "-ar", "48000",
    ]

    # Strip metadata
    args += ["-map_metadata", "-1"]

    args.append(str(output_path))

    _run_ffmpeg(args)
    logger.info(
        "Video obfuscated: %s -> %s (crop=%d, bitrate=%d, noise=%s)",
        input_path.name, output_path.name, crop_pixels, new_bitrate, add_noise,
    )
    return output_path


def obfuscate_image(
    input_path: str | Path,
    output_path: str | Path,
    quality: int = 92,
    crop_pixels: int = 1,
    brightness_range: float = 0.01,
) -> Path:
    """Obfuscate an image file to defeat exact-match / perceptual-hash detection.

    Args:
        input_path: Source image.
        output_path: Destination path.
        quality: JPEG/WebP output quality (slight quality jitter changes encoding).
        crop_pixels: Pixels to crop from right/bottom (1 px is invisible).
        brightness_range: Brightness adjustment range (±), default 0.01 (1%).
    """
    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        raise FileNotFoundError(f"Input image not found: {input_path}")

    if not is_ffmpeg_available():
        logger.warning("ffmpeg not found; falling back to copy")
        shutil.copy2(input_path, output_path)
        return output_path

    # Jitter quality ±3
    actual_quality = max(75, min(100, quality + random.randint(-3, 3)))

    filters: list[str] = []
    if crop_pixels > 0:
        filters.append(f"crop=iw-{crop_pixels}:ih-{crop_pixels}:0:0")

    # Tiny brightness jitter (imperceptible)
    filters.append(f"eq=brightness={random.uniform(-brightness_range, brightness_range)}")

    filter_str = ",".join(filters) if filters else None

    args: list[str] = ["-i", str(input_path)]
    if filter_str:
        args += ["-vf", filter_str]

    # Force output to common format; metadata stripped
    args += [
        "-q:v", str(actual_quality),
        "-map_metadata", "-1",
        "-frames:v", "1",
        str(output_path),
    ]

    _run_ffmpeg(args)
    logger.info(
        "Image obfuscated: %s -> %s (quality=%d, crop=%d)",
        input_path.name, output_path.name, actual_quality, crop_pixels,
    )
    return output_path
