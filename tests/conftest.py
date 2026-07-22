"""Pytest conftest for the modular ``web_runner`` package.

Previously this module patched ``sqlite3.connect`` before import so the
monolith's module-level DB init would not crash collection. The package
uses ``create_app()`` / ``init_db()`` on demand against a real SQLite file,
so that global mock is intentionally removed.
"""
