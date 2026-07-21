"""Thin CLI shim — see cli/main.py for the real entry point.

Re-exports ``main`` for the ``sau`` console script in pyproject.toml.
"""
import sys

from cli.main import main

if __name__ == "__main__":
    sys.exit(main())
