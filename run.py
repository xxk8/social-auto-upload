"""Entry point for the web server.

Thin wrapper around the web_runner package's create_app() factory.
Run with: python run.py
"""
from __future__ import annotations

import atexit
import os

from dotenv import load_dotenv

load_dotenv()

from web_runner import create_app  # noqa: E402  (load_dotenv must run first)
from web_runner.utils import task_executor  # noqa: E402

app = create_app()

if __name__ == "__main__":
    atexit.register(task_executor.shutdown, wait=False)
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=6001, debug=debug)
