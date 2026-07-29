"""Thin entry for the web shell.

The Flask app lives in the ``web_runner`` package (``create_app()``).
This file only exists so ``python web_runner.py`` keeps working.

Prefer: ``python run.py`` (Waitress by default) or ``from web_runner import create_app``.
"""
from __future__ import annotations

# Delegate to the canonical entry so both paths share WSGI / debug logic.
from run import app, main

if __name__ == "__main__":
    main()
