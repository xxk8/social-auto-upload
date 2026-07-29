"""Auto-subtitle APIs via stable-ts + faster-whisper (Phase 2b).

Stack (open-source, not hand-rolled segmentation):
  * ``stable-ts`` / ``stable-ts-whisperless`` — word timestamps, silence
    suppression, punctuation/gap regroup → SRT
    (https://github.com/jianfch/stable-ts)
  * ``faster-whisper`` — ASR backend used by stable-ts
  * ``deep-translator`` — per-cue ``translate_batch`` for zh/en/bilingual

Without media extras, endpoints return 501.

Shared helpers are also used by ``web_runner.routes.inbox`` for the
download-centre「添加字幕」flow (zh / en / bilingual + optional burn-in).
"""
from __future__ import annotations

import os
import platform
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, request, send_from_directory

from web_runner.utils import UPLOADS_DIR, BASE_DIR, log

bp = Blueprint("subtitle", __name__)

SUB_DIR = BASE_DIR / "media" / "subtitles"
SUB_DIR.mkdir(parents=True, exist_ok=True)

_stable_model = None

# Segment-like dict used across generate / translate / srt writers.
Seg = dict[str, Any]  # {start: float, end: float, text: str}


def _deps_ok() -> tuple[bool, str]:
    try:
        import stable_whisper  # noqa: F401
        import faster_whisper  # noqa: F401
        return True, ""
    except ImportError as exc:
        return False, (
            f"缺少字幕依赖: {exc}. 安装: pip install 'social-auto-upload[media]' "
            "（含 stable-ts-whisperless + faster-whisper）"
        )


def _get_model():
    """stable-ts wrapper around faster-whisper (word-level timestamps + regroup)."""
    global _stable_model
    if _stable_model is None:
        import stable_whisper

        size = os.environ.get("SAU_WHISPER_MODEL", "base")
        device = os.environ.get("SAU_WHISPER_DEVICE", "cpu")
        compute = os.environ.get("SAU_WHISPER_COMPUTE", "int8")
        log(f"[subtitle] loading stable-ts/faster-whisper model={size} device={device}")
        _stable_model = stable_whisper.load_faster_whisper(
            size, device=device, compute_type=compute,
        )
    return _stable_model


def _ts(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms >= 1000:
        ms = 0
        s += 1
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _norm_lang(code: str | None) -> str:
    if not code:
        return ""
    c = code.lower().strip()
    if c in ("zh", "zh-cn", "zh-tw", "yue", "chinese", "mandarin", "cantonese"):
        return "zh"
    if c in ("en", "en-us", "en-gb", "english"):
        return "en"
    return c[:8]


def _result_to_segs(result: Any) -> list[Seg]:
    segs: list[Seg] = []
    for s in getattr(result, "segments", None) or []:
        text = (getattr(s, "text", None) or "").strip()
        if not text:
            continue
        segs.append({
            "start": float(s.start),
            "end": float(s.end),
            "text": text,
        })
    return segs


def _result_to_srt(result: Any) -> str:
    """Use stable-ts built-in SRT writer (segment-level cues)."""
    srt = result.to_srt_vtt(filepath=None, segment_level=True, word_level=False)
    return (srt or "").strip() + ("\n" if srt else "")


def _run_whisper(
    audio_path: Path,
    *,
    language: str | None = None,
    task: str = "transcribe",
) -> tuple[list[Seg], str | None, Any]:
    """Run stable-ts (faster-whisper backend); return (segs, lang, raw_result).

    Timestamps / cue splits come from stable-ts defaults (word timestamps,
    VAD silence adjust, punctuation/gap regroup) — not hand-rolled.
    """
    model = _get_model()
    kwargs: dict[str, Any] = {
        "task": task,
        "word_timestamps": True,
        "vad_filter": True,
        "regroup": True,  # stable-ts default algorithm
        "verbose": False,
    }
    if language:
        kwargs["language"] = language
    result = model.transcribe(str(audio_path), **kwargs)
    segs = _result_to_segs(result)
    detected = getattr(result, "language", None)
    return segs, detected, result


def _segments_to_srt(segments) -> str:
    """Fallback SRT writer for translated Seg lists (timings already fixed)."""
    lines: list[str] = []
    for i, seg in enumerate(segments, start=1):
        if isinstance(seg, dict):
            start, end, text = seg["start"], seg["end"], seg.get("text", "")
        else:
            start, end, text = seg.start, seg.end, (seg.text or "").strip()
        text = str(text).strip()
        if not text:
            continue
        lines.append(str(i))
        lines.append(f"{_ts(float(start))} --> {_ts(float(end))}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def _bilingual_srt(primary: list[Seg], secondary: list[Seg]) -> str:
    """Pair by index (same whisper pass timings preferred). Fallback: primary only."""
    lines: list[str] = []
    n = max(len(primary), len(secondary))
    idx = 0
    for i in range(n):
        a = primary[i] if i < len(primary) else None
        b = secondary[i] if i < len(secondary) else None
        if not a and not b:
            continue
        base = a or b
        assert base is not None
        t1 = (a or {}).get("text", "") if a else ""
        t2 = (b or {}).get("text", "") if b else ""
        # Prefer 原文在上、译文在下 when both exist
        body = "\n".join(x for x in (t1, t2) if x)
        if not body:
            continue
        idx += 1
        lines.append(str(idx))
        lines.append(f"{_ts(float(base['start']))} --> {_ts(float(base['end']))}")
        lines.append(body)
        lines.append("")
    return "\n".join(lines)


def _translate_texts(texts: list[str], source: str, target: str) -> list[str]:
    """1:1 cue translation via deep-translator ``translate_batch`` (no newline pad)."""
    if not texts:
        return []
    src = _norm_lang(source) or "auto"
    tgt = _norm_lang(target) or "en"
    if src == tgt:
        return list(texts)
    try:
        from deep_translator import GoogleTranslator  # type: ignore

        g_src = "auto" if src in ("", "auto") else ("zh-CN" if src == "zh" else src)
        g_tgt = "zh-CN" if tgt == "zh" else tgt
        tr = GoogleTranslator(source=g_src, target=g_tgt)
        # Keep cues as separate list items so timestamps stay aligned 1:1.
        # translate_batch is the library API; fall back to per-line translate.
        try:
            out = tr.translate_batch(list(texts))
        except Exception:
            out = [tr.translate(t) or t for t in texts]
        if not isinstance(out, list):
            out = [str(out)]
        # Strict length: never invent / pad with last line
        cleaned: list[str] = []
        for i, original in enumerate(texts):
            if i < len(out) and out[i] is not None and str(out[i]).strip():
                cleaned.append(str(out[i]).strip())
            else:
                try:
                    cleaned.append((tr.translate(original) or original).strip())
                except Exception:
                    cleaned.append(original)
        return cleaned
    except ImportError:
        log("[subtitle] deep-translator not installed; keeping source text for translation")
        return list(texts)
    except Exception as exc:
        log(f"[subtitle] translate failed: {type(exc).__name__}: {exc}")
        return list(texts)


def _map_translated(segs: list[Seg], translated: list[str]) -> list[Seg]:
    out: list[Seg] = []
    for i, seg in enumerate(segs):
        text = translated[i] if i < len(translated) else seg["text"]
        out.append({"start": seg["start"], "end": seg["end"], "text": text})
    return out


def build_subtitle_tracks(
    audio_path: Path,
    mode: str,
    on_progress: Any | None = None,
) -> tuple[str, list[Seg], str | None, dict[str, Any]]:
    """Build final SRT text for mode in {source, zh, en, bilingual}.

    ``on_progress(phase, pct, label)`` is optional for streaming UIs.
    Returns (srt_text, display_segments, detected_lang, meta).
    """
    def _p(phase: str, pct: int, label: str) -> None:
        if on_progress:
            try:
                on_progress(phase, pct, label)
            except Exception:
                pass

    mode = (mode or "bilingual").lower().strip()
    if mode not in ("source", "zh", "en", "bilingual"):
        mode = "bilingual"

    _p("transcribe", 20, "正在识别语音（stable-ts）…")
    src_segs, detected, src_result = _run_whisper(audio_path, task="transcribe")
    if not src_segs:
        raise RuntimeError("未识别到有效语音，无法生成字幕")

    det = _norm_lang(detected)
    meta: dict[str, Any] = {
        "detected_language": detected,
        "mode": mode,
        "engine": "stable-ts+faster-whisper",
        "segment_count": len(src_segs),
    }

    if mode == "source":
        _p("compose", 90, "生成字幕文件…")
        return _result_to_srt(src_result), src_segs, detected, meta

    if mode == "en":
        if det == "en":
            _p("compose", 90, "生成英文字幕…")
            return _result_to_srt(src_result), src_segs, detected, meta
        _p("translate", 55, "Whisper 译为英文…")
        en_segs, _, en_result = _run_whisper(audio_path, task="translate")
        if not en_segs:
            en_segs, en_result = src_segs, src_result
        meta["engine"] = "stable-ts+whisper-translate"
        _p("compose", 90, "生成英文字幕…")
        return _result_to_srt(en_result), en_segs, detected, meta

    if mode == "zh":
        if det == "zh":
            _p("compose", 90, "生成中文字幕…")
            return _result_to_srt(src_result), src_segs, detected, meta
        if det != "en":
            _p("translate", 50, "先译为英文再转中文…")
            en_segs, _, _ = _run_whisper(audio_path, task="translate")
            pivot = en_segs if en_segs else src_segs
            pivot_lang = "en"
        else:
            pivot = src_segs
            pivot_lang = "en"
        _p("translate", 70, "翻译为中文…")
        zh_texts = _translate_texts([s["text"] for s in pivot], pivot_lang, "zh")
        zh_segs = _map_translated(pivot, zh_texts)
        meta["engine"] = "stable-ts+translate"
        meta["segment_count"] = len(zh_segs)
        _p("compose", 90, "生成中文字幕…")
        return _segments_to_srt(zh_segs), zh_segs, detected, meta

    # bilingual
    if det == "zh":
        _p("translate", 55, "生成中英双语…")
        en_segs, _, _ = _run_whisper(audio_path, task="translate")
        if not en_segs or len(en_segs) != len(src_segs):
            en_texts = _translate_texts([s["text"] for s in src_segs], "zh", "en")
            en_segs = _map_translated(src_segs, en_texts)
        srt = _bilingual_srt(src_segs, en_segs)
        meta["engine"] = "stable-ts+bilingual-zh-en"
        _p("compose", 90, "生成双语字幕…")
        return srt, src_segs, detected, meta

    if det == "en":
        top = src_segs
    else:
        _p("translate", 45, "识别外语并转英文…")
        en_segs, _, _ = _run_whisper(audio_path, task="translate")
        top = en_segs if en_segs else src_segs
    _p("translate", 70, "翻译为中文（双语）…")
    zh_texts = _translate_texts([s["text"] for s in top], "en" if det != "zh" else det, "zh")
    bottom = _map_translated(top, zh_texts)
    srt = _bilingual_srt(top, bottom)
    meta["engine"] = "stable-ts+bilingual-en-zh"
    meta["segment_count"] = len(top)
    _p("compose", 90, "生成双语字幕…")
    return srt, top, detected, meta


def _subtitle_font() -> str:
    """Font family name for libass force_style (must exist on the machine)."""
    system = platform.system()
    if system == "Darwin":
        # Arial Unicode is present on stock macOS; PingFang.ttc path varies by version.
        return "Arial Unicode MS"
    if system == "Windows":
        return "Microsoft YaHei"
    return "Noto Sans CJK SC"


def _fonts_dir() -> str | None:
    """Optional fontsdir for libass (macOS system fonts)."""
    system = platform.system()
    if system == "Darwin":
        for d in ("/Library/Fonts", "/System/Library/Fonts/Supplemental", "/System/Library/Fonts"):
            if Path(d).is_dir():
                return d
    if system == "Windows":
        windir = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
        if windir.is_dir():
            return str(windir)
    return None


# ── ffmpeg binary selection ──────────────────────────────────────────────
# Homebrew's default ``ffmpeg`` bottle often omits libass (no subtitles filter).
# moviepy pulls in ``imageio-ffmpeg`` which ships a static build *with* libass.
# Prefer that binary for hard-burn; keep system ffmpeg for soft-mux / audio extract.

_ffmpeg_bin_cache: str | None = None
_ffmpeg_hard_bin_cache: str | None = None


def _system_ffmpeg() -> str:
    return "ffmpeg"


def _resolve_ffmpeg(prefer_libass: bool = False) -> str:
    """Return path to an ffmpeg executable.

    When ``prefer_libass`` is True, try imageio-ffmpeg's static binary first
    (ships ``--enable-libass``), then fall back to system ffmpeg.
    """
    global _ffmpeg_bin_cache, _ffmpeg_hard_bin_cache
    if prefer_libass:
        if _ffmpeg_hard_bin_cache:
            return _ffmpeg_hard_bin_cache
        # 1) env override
        env = os.environ.get("SAU_FFMPEG_LIBASS") or os.environ.get("SAU_FFMPEG")
        if env and Path(env).is_file():
            _ffmpeg_hard_bin_cache = env
            return env
        # 2) imageio-ffmpeg static build (libass-enabled)
        try:
            import imageio_ffmpeg  # type: ignore

            exe = imageio_ffmpeg.get_ffmpeg_exe()
            if exe and Path(exe).is_file() and _ffmpeg_bin_has_filter(exe, "subtitles"):
                _ffmpeg_hard_bin_cache = exe
                log(f"[subtitle] hard-burn ffmpeg: {exe}")
                return exe
        except Exception as exc:
            log(f"[subtitle] imageio-ffmpeg unavailable: {exc}")
        # 3) system ffmpeg if it happens to have libass
        if _ffmpeg_bin_has_filter(_system_ffmpeg(), "subtitles"):
            _ffmpeg_hard_bin_cache = _system_ffmpeg()
            return _ffmpeg_hard_bin_cache
        _ffmpeg_hard_bin_cache = _system_ffmpeg()
        return _ffmpeg_hard_bin_cache

    if _ffmpeg_bin_cache:
        return _ffmpeg_bin_cache
    env = os.environ.get("SAU_FFMPEG")
    if env and Path(env).is_file():
        _ffmpeg_bin_cache = env
        return env
    _ffmpeg_bin_cache = _system_ffmpeg()
    return _ffmpeg_bin_cache


def _ffmpeg_bin_has_filter(ffmpeg_bin: str, name: str) -> bool:
    try:
        proc = subprocess.run(
            [ffmpeg_bin, "-hide_banner", "-filters"],
            capture_output=True, text=True, timeout=30,
        )
        blob = (proc.stdout or "") + "\n" + (proc.stderr or "")
        # Filter table rows look like: " ... subtitles         V->V  ..."
        return bool(re.search(rf"\b{re.escape(name)}\b", blob))
    except Exception:
        return False


def _ffmpeg_has_filter(name: str) -> bool:
    """True if *some* available ffmpeg can hard-burn (libass subtitles filter)."""
    return _ffmpeg_bin_has_filter(_resolve_ffmpeg(prefer_libass=True), name)


def _escape_subtitles_path(path: Path) -> str:
    """Escape a filesystem path for the ffmpeg ``subtitles`` filter."""
    raw = str(path.resolve()).replace("\\", "/")
    return raw.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _video_size(video_path: Path) -> tuple[int | None, int | None]:
    """Return (width, height) of the primary video stream, or (None, None)."""
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0:s=x",
                str(video_path),
            ],
            capture_output=True, text=True, timeout=30,
        )
        raw = (proc.stdout or "").strip().split("\n")[0]
        if "x" in raw:
            a, b = raw.split("x", 1)
            if a.isdigit() and b.isdigit():
                return int(a), int(b)
    except Exception:
        pass
    try:
        proc = subprocess.run(
            [
                _resolve_ffmpeg(False), "-hide_banner", "-i", str(video_path),
            ],
            capture_output=True, text=True, timeout=30,
        )
        # Parse from stderr: "Stream #0:0: Video: h264, ..., 3840x2160,"
        m = re.search(r"Video:.*?\s(\d{2,5})x(\d{2,5})", proc.stderr or "")
        if m:
            return int(m.group(1)), int(m.group(2))
    except Exception:
        pass
    return None, None


def _video_width(video_path: Path) -> int | None:
    w, _ = _video_size(video_path)
    return w


# Prefer break after these when wrapping long CJK/Latin cue lines for burn-in.
_WRAP_BREAK_CHARS = set("，。！？；、,.!?;: …—- ")


def _wrap_cue_text(text: str, max_chars: int) -> str:
    """Insert newlines so each visual line fits the frame (CJK has no spaces).

    Square / portrait clips (e.g. 720×720) easily clip a single long Chinese
    line when libass does not hard-wrap; pre-wrapping is the reliable fix.
    """
    max_chars = max(8, int(max_chars))
    out_lines: list[str] = []
    for para in text.replace("\r\n", "\n").split("\n"):
        para = para.strip()
        if not para:
            continue
        while len(para) > max_chars:
            window = para[: max_chars + 1]
            cut = max_chars
            # Prefer punctuation in the last third of the window
            start = max(1, max_chars - max(4, max_chars // 3))
            for i in range(max_chars, start - 1, -1):
                if i <= len(window) and window[i - 1] in _WRAP_BREAK_CHARS:
                    cut = i
                    break
            chunk = para[:cut].rstrip()
            rest = para[cut:].lstrip()
            # Avoid orphan punctuation-only next line (e.g. trailing "。")
            if rest and len(rest) <= 2 and all(c in _WRAP_BREAK_CHARS for c in rest):
                chunk = (chunk + rest).rstrip()
                rest = ""
            if chunk:
                out_lines.append(chunk)
            para = rest
        if para:
            out_lines.append(para)
    return "\n".join(out_lines)


def _prepare_srt_for_burn(srt_text: str, max_chars: int) -> str:
    """Rewrite each SRT cue body with frame-safe line wraps; keep timings."""
    blocks = re.split(r"\n\s*\n", srt_text.strip())
    rebuilt: list[str] = []
    idx = 0
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 2:
            continue
        # index line optional
        if re.fullmatch(r"\d+", lines[0].strip()):
            time_line = lines[1] if len(lines) > 1 else ""
            body = "\n".join(lines[2:])
        else:
            time_line = lines[0]
            body = "\n".join(lines[1:])
        if "-->" not in time_line:
            continue
        body = _wrap_cue_text(body, max_chars)
        if not body.strip():
            continue
        idx += 1
        rebuilt.append(f"{idx}\n{time_line.strip()}\n{body}")
    return "\n\n".join(rebuilt) + ("\n" if rebuilt else "")


def _burn_layout(width: int | None, height: int | None) -> dict[str, int | str]:
    """Pixel-accurate layout when ASS PlayResX/Y == output frame size.

    FontSize is true pixels (PlayRes matches video), not default ~288-tall SRT script.
    """
    w = max(16, int(width or 1280))
    h = max(16, int(height or 720))
    w -= w % 2
    h -= h % 2
    short = min(w, h)
    # ~4% of short side — readable but not dominant on 9:16
    font_size = max(16, min(64, int(short * 0.04)))
    if short <= 480:
        font_size = max(14, min(font_size, 18))
    elif short <= 720:
        font_size = max(16, min(font_size, 28))
    margin_h = max(24, int(w * 0.06))
    margin_v = max(28, int(h * 0.05))
    # keep multi-line blocks in lower band on very tall clips
    margin_v = min(margin_v, max(28, h // 12))
    usable = max(64, w - 2 * margin_h)
    # CJK advance ≈ font_size px when PlayRes == frame
    max_chars = max(8, int(usable / max(font_size * 1.05, 1)))
    if w <= 720:
        max_chars = min(max_chars, 18)
    return {
        "font": _subtitle_font(),
        "font_size": font_size,
        "margin_l": margin_h,
        "margin_r": margin_h,
        "margin_v": margin_v,
        "max_chars": max_chars,
        "play_w": w,
        "play_h": h,
    }


def _srt_ts_to_ass(ts: str) -> str:
    """``00:00:01,234`` → ``0:00:01.23`` (ASS centiseconds)."""
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    if len(parts) != 3:
        return "0:00:00.00"
    h, m, rest = parts
    if "." in rest:
        s, frac = rest.split(".", 1)
        cs = int((frac + "00")[:2])
    else:
        s, cs = rest, 0
    return f"{int(h)}:{int(m):02d}:{int(s):02d}.{cs:02d}"


def _parse_srt_cues(srt_text: str) -> list[tuple[str, str, str]]:
    """Return list of (start_ass, end_ass, body_text) from SRT."""
    cues: list[tuple[str, str, str]] = []
    blocks = re.split(r"\n\s*\n", (srt_text or "").strip())
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 2:
            continue
        if re.fullmatch(r"\d+", lines[0].strip()):
            time_line = lines[1] if len(lines) > 1 else ""
            body = "\n".join(lines[2:])
        else:
            time_line = lines[0]
            body = "\n".join(lines[1:])
        if "-->" not in time_line:
            continue
        left, right = [x.strip() for x in time_line.split("-->", 1)]
        body = body.strip()
        if not body:
            continue
        cues.append((_srt_ts_to_ass(left), _srt_ts_to_ass(right), body))
    return cues


def _srt_to_ass_for_burn(srt_text: str, layout: dict[str, int | str]) -> str:
    """ASS with PlayRes = frame size — correct scale on any aspect ratio.

    SRT + force_style uses a default ~384×288 script resolution, so the same
    FontSize explodes on 1080×1920 and undersizes on small clips.
    """
    play_w = int(layout["play_w"])
    play_h = int(layout["play_h"])
    font_esc = str(layout["font"]).replace(",", " ")
    fs = int(layout["font_size"])
    ml = int(layout["margin_l"])
    mr = int(layout["margin_r"])
    mv = int(layout["margin_v"])
    max_chars = int(layout["max_chars"])

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {play_w}\n"
        f"PlayResY: {play_h}\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n"
        "YCbCr Matrix: None\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        # BorderStyle 3 = opaque box; Alignment 2 = bottom-center
        f"Style: Default,{font_esc},{fs},"
        f"&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        f"0,0,0,0,100,100,0,0,3,2,0,2,{ml},{mr},{mv},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    events: list[str] = []
    for start, end, body in _parse_srt_cues(srt_text):
        wrapped = _wrap_cue_text(body, max_chars)
        text = (
            wrapped.replace("\\", "\\\\")
            .replace("{", "(")
            .replace("}", ")")
            .replace("\n", r"\N")
        )
        events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")
    return header + "\n".join(events) + ("\n" if events else "")


def _soft_mux_srt(video_path: Path, srt_path: Path, out_path: Path, lang: str = "zho") -> Path:
    """Embed SRT as a soft subtitle track (mov_text) — no libass required."""
    lang_map = {"zh": "zho", "en": "eng", "bilingual": "zho", "source": "und"}
    meta_lang = lang_map.get((lang or "").lower(), lang or "und")
    ff = _resolve_ffmpeg(prefer_libass=False)
    cmd = [
        ff, "-y",
        "-i", str(video_path),
        "-i", str(srt_path),
        "-c", "copy",
        "-c:s", "mov_text",
        "-metadata:s:s:0", f"language={meta_lang}",
        "-disposition:s:0", "default",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0 or not out_path.exists():
        err = (proc.stderr or "")[-500:]
        raise RuntimeError(f"嵌入字幕轨失败: {err}")
    return out_path


def _hard_burn_srt(
    video_path: Path,
    srt_path: Path,
    out_path: Path,
    *,
    max_width: int | None = None,
) -> Path:
    """Hard-burn via libass ``subtitles`` filter using a libass-capable ffmpeg.

    ``max_width``: 0 = keep source resolution; None = env default (1920).
    """
    ff = _resolve_ffmpeg(prefer_libass=True)
    if not _ffmpeg_bin_has_filter(ff, "subtitles"):
        raise RuntimeError(
            "当前环境没有可用的 libass 字幕滤镜。"
            "已安装 moviepy/imageio-ffmpeg 时应自动可用；"
            "也可 brew install ffmpeg-full 或设置 SAU_FFMPEG_LIBASS=/path/to/ffmpeg"
        )

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    # Short ASCII path — long stems / unicode break some libass builds.
    tmp_ass = UPLOADS_DIR / f"burn_{uuid.uuid4().hex[:10]}.ass"
    try:
        raw_srt = srt_path.read_text(encoding="utf-8")
        width, height = _video_size(video_path)
        if max_width is None:
            max_w = int(os.environ.get("SAU_SUBTITLE_MAX_WIDTH", "1920") or "1920")
        else:
            max_w = int(max_width)

        scale_part = ""
        out_w, out_h = width, height
        # Scale *before* subtitles so ASS PlayRes matches output pixels.
        if max_w > 0 and width and width > max_w:
            out_w = max_w
            out_h = int(round((height or max_w) * (max_w / width))) if height else max_w
            out_h = out_h - (out_h % 2)
            scale_part = f"scale={max_w}:-2,"

        layout = _burn_layout(out_w, out_h)
        ass_text = _srt_to_ass_for_burn(raw_srt, layout)
        if not ass_text.strip() or "[Events]" not in ass_text:
            # fallback: wrap SRT only
            wrapped = _prepare_srt_for_burn(raw_srt, int(layout["max_chars"]))
            tmp_ass = tmp_ass.with_suffix(".srt")
            tmp_ass.write_text(wrapped or raw_srt, encoding="utf-8")
        else:
            tmp_ass.write_text(ass_text, encoding="utf-8")

        sub_esc = _escape_subtitles_path(tmp_ass)
        fonts_dir = _fonts_dir()
        sub_opts = f"filename={sub_esc}"
        if fonts_dir:
            fd = fonts_dir.replace("\\", "/").replace(":", "\\:")
            sub_opts += f":fontsdir={fd}"

        vf = f"{scale_part}subtitles={sub_opts}"
        preset = os.environ.get("SAU_SUBTITLE_PRESET", "veryfast")
        crf = os.environ.get("SAU_SUBTITLE_CRF", "20")
        cmd = [
            ff, "-y", "-i", str(video_path),
            "-vf", vf,
            "-c:v", "libx264", "-preset", preset, "-crf", crf,
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            str(out_path),
        ]
        log(
            f"[subtitle] hard-burn {width}x{height}→{layout['play_w']}x{layout['play_h']} "
            f"fs={layout['font_size']} max_chars={layout['max_chars']} bin={ff}"
        )
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
            return out_path

        # Retry: bare path only
        vf2 = f"{scale_part}subtitles={sub_esc}"
        cmd2 = [
            ff, "-y", "-i", str(video_path),
            "-vf", vf2,
            "-c:v", "libx264", "-preset", preset, "-crf", crf,
            "-c:a", "copy",
            str(out_path),
        ]
        proc2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=3600)
        if proc2.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
            err = (proc2.stderr or proc.stderr or "")[-600:]
            raise RuntimeError(f"硬烧录失败: {err}")
        return out_path
    finally:
        try:
            tmp_ass.unlink(missing_ok=True)
        except OSError:
            pass


def quality_to_max_width(quality: str | None) -> int | None:
    """Map product quality preset → max encode width (None = env default)."""
    q = (quality or "1080").lower().strip()
    if q in ("original", "source", "full", "0"):
        return 0
    if q in ("720", "720p", "hd"):
        return 1280
    if q in ("1080", "1080p", "fhd"):
        return 1920
    if q in ("480", "480p"):
        return 854
    return None


def burn_srt_onto_video(
    video_path: Path,
    srt_path: Path,
    out_path: Path,
    *,
    lang: str = "zho",
    style: str = "auto",
    quality: str | None = "1080",
) -> tuple[Path, str]:
    """Attach subtitles to a video.

    ``style``:
      * ``hard`` — pixel burn-in (needs libass-capable ffmpeg; uses imageio-ffmpeg)
      * ``soft`` — mov_text track (fast, toggleable in players)
      * ``auto`` — hard if possible, else soft
    ``quality``: original | 1080 | 720 (only for hard burn)

    Returns ``(output_path, method)`` where method is ``\"hard\"`` or ``\"soft\"``.
    """
    style = (style or "auto").lower().strip()
    if style not in ("hard", "soft", "auto"):
        style = "auto"
    max_w = quality_to_max_width(quality)

    want_hard = style in ("hard", "auto")
    if want_hard and _ffmpeg_has_filter("subtitles"):
        try:
            _hard_burn_srt(video_path, srt_path, out_path, max_width=max_w)
            return out_path, "hard"
        except Exception as exc:
            log(f"[subtitle] hard burn failed: {exc}")
            try:
                out_path.unlink(missing_ok=True)
            except OSError:
                pass
            if style == "hard":
                # User explicitly asked for hard — surface the error, don't silently soft.
                raise

    if style == "hard":
        raise RuntimeError(
            "无法硬烧录：缺少 libass 字幕滤镜。"
            "请确保已安装 media 依赖（含 imageio-ffmpeg），"
            "或 brew install ffmpeg-full / 设置 SAU_FFMPEG_LIBASS。"
        )

    _soft_mux_srt(video_path, srt_path, out_path, lang=lang)
    return out_path, "soft"


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


def _has_audio_stream(media_path: Path) -> bool:
    """Return True if ffprobe finds at least one audio stream."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "csv=p=0",
        str(media_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        # No ffprobe — assume audio exists and let later steps fail clearly.
        return True
    if proc.returncode != 0:
        return True  # don't block; extractor will report the real error
    return bool((proc.stdout or "").strip())


def _extract_audio(video_path: Path) -> Path:
    """Extract mono 16 kHz WAV for STT. Raises RuntimeError with a clear message."""
    if not _has_audio_stream(video_path):
        raise RuntimeError(
            "视频没有音轨，无法转写文案。请换一个带人声/旁白的视频。"
        )
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    audio_path = UPLOADS_DIR / f"{video_path.stem}_{uuid.uuid4().hex[:8]}.wav"
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(audio_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0 or not audio_path.exists():
        err = (proc.stderr or "")[-400:]
        if "does not contain any stream" in err or "Output file does not contain any stream" in err:
            raise RuntimeError(
                "视频没有音轨，无法转写文案。请换一个带人声/旁白的视频。"
            )
        raise RuntimeError(f"ffmpeg 抽取音频失败: {err}")
    return audio_path


@bp.get("/api/subtitle/health")
def subtitle_health():
    ok, msg = _deps_ok()
    translate_ok = False
    try:
        import deep_translator  # noqa: F401
        translate_ok = True
    except ImportError:
        pass
    hard_ok = _ffmpeg_has_filter("subtitles")
    hard_bin = _resolve_ffmpeg(prefer_libass=True) if hard_ok else None
    return jsonify({
        "success": True,
        "data": {
            "available": ok,
            "message": msg or None,
            "translate_available": translate_ok,
            "hard_burn_available": hard_ok,
            "hard_burn_ffmpeg": hard_bin,
            "modes": ["source", "zh", "en", "bilingual"],
            "burn_styles": ["auto", "hard", "soft"],
            "hint": None if hard_ok else (
                "未检测到 libass 硬烧录能力，将使用软字幕轨。"
                "安装 media 依赖（imageio-ffmpeg）或 ffmpeg-full 可启用硬烧录。"
            ),
        },
    })


@bp.post("/api/subtitle/generate")
def generate_subtitle():
    ok, msg = _deps_ok()
    if not ok:
        return jsonify({"success": False, "message": msg}), 501
    path = _save_upload()
    if not path:
        return jsonify({"success": False, "message": "需要上传 file 或提供 path"}), 400
    data = request.get_json(silent=True) or {}
    mode = (data.get("mode") or data.get("lang") or "source").strip()
    audio = None
    try:
        audio = _extract_audio(path)
        srt, segs, detected, meta = build_subtitle_tracks(audio, mode)
        out = SUB_DIR / f"{path.stem}_{mode}_{uuid.uuid4().hex[:8]}.srt"
        out.write_text(srt, encoding="utf-8")
        log(f"[subtitle] {path.name} → {out.name} mode={mode} lang={detected}")
        return jsonify({
            "success": True,
            "data": {
                "srt": srt,
                "path": str(out),
                "url": f"/api/subtitle/file/{out.name}",
                "language": detected,
                "mode": mode,
                "meta": meta,
                "segments": segs,
            },
        })
    except Exception as exc:  # strict-exceptions: allow
        return jsonify({"success": False, "message": f"{type(exc).__name__}: {exc}"}), 500
    finally:
        if audio is not None:
            try:
                Path(audio).unlink(missing_ok=True)
            except OSError:
                pass


@bp.post("/api/subtitle/burn")
def burn_subtitle():
    """Attach SRT to video (hard-burn if libass available, else soft mux)."""
    ok, msg = _deps_ok()
    if not ok:
        return jsonify({"success": False, "message": msg}), 501
    data = request.get_json(silent=True) or {}
    video = data.get("video_path") or data.get("path")
    srt = data.get("srt_path")
    if not video or not srt or not Path(video).exists() or not Path(srt).exists():
        return jsonify({"success": False, "message": "video_path 与 srt_path 必填且文件存在"}), 400
    out = SUB_DIR / f"burn_{uuid.uuid4().hex[:10]}.mp4"
    style = (data.get("style") or data.get("burn_style") or "auto").strip().lower()
    try:
        path, method = burn_srt_onto_video(Path(video), Path(srt), out, style=style)
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 500
    return jsonify({
        "success": True,
        "data": {
            "path": str(path),
            "url": f"/api/subtitle/file/{path.name}",
            "method": method,
        },
    })


@bp.get("/api/subtitle/file/<path:filename>")
def subtitle_file(filename: str):
    return send_from_directory(SUB_DIR, Path(filename).name)
