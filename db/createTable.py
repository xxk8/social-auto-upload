"""
DEPRECATED — SQLite helper. Do not run.

Database schema is initialized only via ``web_runner.db.init_db()`` against
**PostgreSQL** (requires ``DATABASE_URL``).
"""
raise SystemExit(
    "db/createTable.py is deprecated. Use PostgreSQL:\n"
    "  export DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/sau\n"
    "  python -c 'from web_runner.db import init_db; init_db()'\n"
)
