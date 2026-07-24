"""Pytest conftest — PostgreSQL required.

Loads repo ``.env`` so ``DATABASE_URL`` is available, then ensures schema exists.
"""
from __future__ import annotations

import os
from pathlib import Path

# Ensure DATABASE_URL is visible before any web_runner.db import.
_ROOT = Path(__file__).resolve().parents[1]
_env = _ROOT / ".env"
if _env.is_file():
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = val

# Default local DSN if still unset (matches docs/install.md example).
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:admin123@127.0.0.1:5432/sau",
)

import pytest


@pytest.fixture(scope="session", autouse=True)
def _ensure_pg_schema():
    from web_runner.db import init_db, require_database_url

    require_database_url()
    init_db()
