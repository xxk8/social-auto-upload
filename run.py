"""Entry point for the web server.

Thin wrapper around the web_runner package's create_app() factory.

  # Production-ish (default): Waitress WSGI, multi-threaded
  python run.py

  # Dev with Flask reloader
  SAU_DEBUG=1 python run.py

Requires PostgreSQL: set DATABASE_URL (see .env / docs/install.md).

Env:
  SAU_HOST          bind host (default 0.0.0.0)
  SAU_PORT          bind port (default 6001)
  SAU_DEBUG         1/true → Flask debug server
  SAU_HTTP_THREADS  Waitress thread count (default 8)
  SAU_SHORT_WORKERS / SAU_UPLOAD_WORKERS / SAU_TASK_QUEUE_MAX
                    CLI task pool knobs (see web_runner.utils)
"""
from __future__ import annotations

import atexit
import os
import sys

# Ensure web_runner.db loads .env before create_app
import web_runner.db  # noqa: F401
from web_runner import create_app
from web_runner.utils import task_executor

app = create_app()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def main() -> None:
    host = os.environ.get("SAU_HOST", "0.0.0.0").strip() or "0.0.0.0"
    port = int(os.environ.get("SAU_PORT", "6001"))
    debug = _env_bool("SAU_DEBUG", False)
    threads = max(2, int(os.environ.get("SAU_HTTP_THREADS", "8")))

    atexit.register(task_executor.shutdown, wait=False)

    if debug:
        # Dev only. use_reloader=False avoids double-spawn of the task pools.
        print(f"[run] Flask debug server on http://{host}:{port}", file=sys.stderr)
        app.run(host=host, port=port, debug=True, use_reloader=False, threaded=True)
        return

    try:
        from waitress import serve
    except ImportError:
        print(
            "[run] waitress not installed — falling back to Flask threaded server. "
            "Install with: uv pip install -e '.[web]'",
            file=sys.stderr,
        )
        app.run(host=host, port=port, debug=False, threaded=True)
        return

    print(
        f"[run] Waitress WSGI on http://{host}:{port} (threads={threads})",
        file=sys.stderr,
    )
    serve(app, host=host, port=port, threads=threads, ident="sau-web")


if __name__ == "__main__":
    main()
