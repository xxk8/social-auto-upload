"""Entry point for the web server.

Thin wrapper around the web_runner package's create_app() factory.
Run with: python run.py
"""
from __future__ import annotations

import atexit
import os

from dotenv import load_dotenv

load_dotenv()

# Round-Video-Backgrounds-v1 — D-7 audio fix.
# Inject the project's local `.venv/bin/` to PATH so subprocess
# `edge-tts` (and any other CLI shipped in the project's venv) is
# callable from inside the Flask process.
#
# Without this, `shutil.which("edge-tts")` returns None when the
# operator runs `.venv/bin/python run.py` directly (without
# `source .venv/bin/activate`) — and `web_runner.studio_tts::has_edge_tts_cli`
# falls through to silent-degrade, producing MP4s with no audio
# stream. We're now prepending once at module import so every
# downstream `subprocess.run([..., "edge-tts", ...])` finds the
# CLI on PATH.
#
# Idempotent: the `_TARGET not in PATH` guard skips re-injection on
# module reload (debug autoreload, pytest). The guard also short-
# circuits when `.venv/bin/` is missing (a bare-metal deploy without
# venv) so the script keeps working in that case — `edge-tts` will
# simply be missing from PATH, and the existing silent-degrade
# helper still handles it without a 500.
#
# Cross-platform: targets the Linux/macOS venv layout `.venv/bin/`.
# Windows deploys use `.venv\Scripts\`; that path is out of scope
# for this round (the project runs macOS/Linux per CLAUDE.md).
_TARGET_VENV_BIN = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".venv", "bin"
)
if os.path.isdir(_TARGET_VENV_BIN) and _TARGET_VENV_BIN not in os.environ.get(
    "PATH", ""
):
    os.environ["PATH"] = _TARGET_VENV_BIN + os.pathsep + os.environ["PATH"]

from web_runner import create_app  # noqa: E402  (load_dotenv + PATH inject must run first)
from web_runner.utils import task_executor  # noqa: E402

app = create_app()

if __name__ == "__main__":
    atexit.register(task_executor.shutdown, wait=False)
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=6001, debug=debug)
