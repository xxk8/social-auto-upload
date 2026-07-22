"""Thin entry for the web shell.

The Flask app lives in the ``web_runner`` package (``create_app()``).
This file only exists so ``python web_runner.py`` keeps working.

Prefer: ``python run.py`` or ``from web_runner import create_app``.
"""
from __future__ import annotations

import atexit

from web_runner import create_app
from web_runner.utils import task_executor

app = create_app()

if __name__ == "__main__":
    atexit.register(task_executor.shutdown, wait=False)
    app.run(host="0.0.0.0", port=6001, debug=True)
