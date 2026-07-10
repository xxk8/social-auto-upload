"""Studio TTS engine — synthesize per-scene voiceover via ``edge-tts``.

Round-Video-Backgrounds-v1: each rendered scene plays a synthesized
voiceover clip via Remotion ``<Audio>``. We use Microsoft Edge's online
TTS service (free, no API key, BYO internet) via the ``edge-tts`` CLI
shipped as a standalone Python package (``pip install edge-tts``).

The voiceover is synthesised lazily during
:func:`web_runner.routes.studio._resolve_scene_voiceovers` which runs
alongside the image / video resolvers in the Studio render pipeline.
Each scene's body is one TTS call: a single line of body text produces
a single MP3 roughly equal to the scene duration (the existing
``utils/pacing.ts::sceneDurationSec`` floors at ``MIN_SCENE_SEC=3`` and
caps at ``MAX_SCENE_SEC=8``). When edge-tts is unavailable (operator's
image is missing the CLI), this module degrades silently — every
``synthesize_voiceover`` call returns ``(False, "...")`` and the Studio
pipeline keeps the cache row out, so SceneCard omits ``<Audio>`` and
the rendered MP4 is silent (but still valid).

WHY EDGE-TTS (vs ElevenLabs / OpenAI TTS / Speechify):

* Free (Online): the user's spec mirrors
  https://github.com/itsPremkumar/Automated-Video-Generator which
  similarly leans on Edge-TTS as the "free tier matching the rest of
  the Studio asset pipeline" trade-off.
* No API key: Microsoft Edge's free endpoint (api.msedgeservices.ai)
  is invoked via the ``edge-tts`` CLI's internal session bootstrap.
  No operator signup is required — ``pip install edge-tts`` and the
  CLI Just Works.
* Quality: zh-CN-XiaoxiaoNeural reads naturally for Simplified
  Chinese storyboard copy at speech-rate (≈14 chars/sec noise floor)
  with no obvious robotic artefacts. en-US-AriaNeural covers the
  English fallback the Studio render form might pick for
  cross-locale content.
* Latency: ~3-6 s per 50-80 char body on a typical residential
  connection. Our ThreadPoolExecutor caps concurrent TTS at 2
  workers so a 7-scene storyboard completes serially in ~25 s,
  comfortably under the Studio render's 600 s default timeout.

LIMITATIONS / known caveats (operator-side):

* Edge-TTS is online. An offline-deploy loses the operator's
  voiceover half of the round-Video-Backgrounds-v1 feature; the
  rest (real video clips) still ships.
* Edge-TTS silently rejects unsupported voice ids with a 0-byte
  MP3. The post-call size guard below catches that and deletes the
  empty file so the Studio ``studio_assets.kind='voiceover'`` row
  never pins a broken path.
* The CLI is process-isolated from the Flask process, which means
  one subprocess per scene. A future round could batch N scenes
  into a single ``edge-tts --text '...' ; edge-tts --text '...'``
  shell session via ``-e`` (``--text-pipe``); not implemented yet
  because the current latency is well within budget.
"""

from __future__ import annotations

import os
import shutil
import subprocess


# Default voice — Chinese Mandarin (zh-CN) female neural voice.
# Override with SAU_STUDIO_TTS_VOICE env var or the per-call
# ``voice`` argument. Microsoft Edge's online TTS service ships
# ~20 zh voices (Xiaoxiao / Yunyang / Yunjian / ...). The Studio
# render form's preset picker may eventually surface a
# "voice" sub-dropdown; that future round reads from the same env.
_DEFAULT_VOICE = os.environ.get("SAU_STUDIO_TTS_VOICE", "zh-CN-XiaoxiaoNeural")
_TTS_TIMEOUT_SEC = int(os.environ.get("SAU_STUDIO_TTS_TIMEOUT", "60"))


def has_edge_tts_cli() -> bool:
    """True iff ``edge-tts`` is on PATH.

    Operator must ``pip install edge-tts`` (or include it via the
    project's ``pyproject.toml`` ``web`` extras). We intentionally
    do NOT import the ``edge_tts`` Python module directly here
    because that pulls a more invasive dependency surface (vs the
    slim CLI), and the CLI is sufficient for our per-scene
    sequential use case — the Studio pipeline already has its own
    :class:`concurrent.futures.ThreadPoolExecutor` on the caller
    side, capping concurrent subprocesses at 2.
    """
    return shutil.which("edge-tts") is not None


def synthesize_voiceover(
    text: str,
    out_path: str,
    voice: str | None = None,
) -> tuple[bool, str]:
    """Convert a scene's body text to an MP3 file at ``out_path``.

    Returns ``(success, error_message)``. When
    :func:`has_edge_tts_cli` returns False the helper degrades
    silently (returns ``(False, "edge-tts not installed")``) so
    the Studio render pipeline can still ship a silent video
    output rather than a 500.

    The output directory MUST already exist; this helper does NOT
    ``os.makedirs`` the parent so a failed render never
    accidentally creates stray parent dirs under the operator's
    media root. The Studio caller
    (:func:`web_runner.routes.studio._resolve_scene_voiceovers`)
    creates the ``media/studio/<id>/media/`` directory once per
    render call and reuses it across all N scene synthesises.

    Output post-condition on success: ``out_path`` exists with
    ``> 0`` bytes. Edge-TTS silently rejects unsupported voice
    ids with a 0-byte output; the post-call size guard catches
    that and unlinks the empty file so the Studio
    ``studio_assets.kind='voiceover'`` row never pins a broken
    MP3 path that ``<Audio>`` would refuse to play.

    Failure modes (returned as ``(False, message)``):

      * ``"edge-tts not installed"`` — ``pip install edge-tts``
        (or include it via the ``web`` extras in
        ``pyproject.toml``).
      * ``"empty text"`` — the Studio pipeline passes
        ``scene.body.strip()`` so this means a malformed scene
        row (no body), not user-error.
      * ``"edge-tts timed out (>Ns)"`` — network stall or
        Microsoft endpoint rate-limit. Bump
        ``SAU_STUDIO_TTS_TIMEOUT`` if a deploy sees this
        repeatedly.
      * ``"edge-tts rc=N: <stderr>"`` — surfacing the subprocess
        stderr for triage. Common cause: voice id typo (`zh-CN-
        XIAOXIAONEURAL` upper-case is rejected silently → 0-byte
        output, but a non-existent locale like `xx-XX-Foo` returns
        a non-zero exit with stderr).
    """
    if not has_edge_tts_cli():
        return False, "edge-tts not installed"
    text = (text or "").strip()
    if not text:
        return False, "empty text"
    chosen_voice = voice or _DEFAULT_VOICE
    try:
        proc = subprocess.run(
            [
                "edge-tts",
                "--voice", chosen_voice,
                "--text", text,
                "--write-media", out_path,
            ],
            capture_output=True,
            timeout=_TTS_TIMEOUT_SEC,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"edge-tts timed out (>{_TTS_TIMEOUT_SEC}s)"
    except FileNotFoundError as exc:
        return False, f"edge-tts not on PATH: {exc}"
    except OSError as exc:
        return False, f"edge-tts spawn failed: {type(exc).__name__}: {exc}"
    if proc.returncode != 0:
        err = (
            proc.stderr.decode("utf-8", errors="replace").strip()
            or proc.stdout.decode("utf-8", errors="replace").strip()
            or "non-zero exit"
        )
        return False, f"edge-tts rc={proc.returncode}: {err}"
    if not os.path.isfile(out_path):
        return False, "edge-tts did not write output file"
    if os.path.getsize(out_path) == 0:
        # Edge-TTS silently rejects unsupported voice ids with a
        # 0-byte MP3 (e.g. de-DE-BarfooNeural) — destroy the
        # empty file so the Studio cache UPSERT path doesn't pin
        # a broken path that <Audio> would refuse to play.
        try:
            os.unlink(out_path)
        except OSError:
            pass
        return False, "edge-tts wrote 0-byte MP3 (likely unsupported voice)"
    return True, ""
