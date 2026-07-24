"""Web runner package — Flask application factory.

Canonical entry: ``from web_runner import create_app`` then ``app = create_app()``.
The root ``web_runner.py`` / ``run.py`` are thin wrappers around this factory.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from flask import Flask, Response, jsonify
from flask_cors import CORS

from utils.log import logger as _task_logger
from web_runner.db import BASE_DIR, DB_PATH, db_lock, init_db

# Re-exports for tests / legacy ``import web_runner as wr`` call sites.
# Prefer importing from ``web_runner.utils`` / ``web_runner.db`` / ``web_runner.routes.ai``
# in new code; these aliases keep older patch targets working during the migration.
from web_runner.utils import (  # noqa: E402
    COOKIES_DIR,
    DESC_PLATFORMS,
    MIN_UPLOAD_BYTES,
    NOTE_PLATFORMS,
    PLATFORM_CONFIG,
    THUMBNAIL_DUAL_PLATFORMS,
    THUMBNAIL_PLATFORMS,
    UPLOADS_DIR,
    _account_files,
    _db_get_error_events,
    _log_error_event,
    _run_sau,
    _schedule_task,
    log,
    task_executor,
)


def _get_secret_key() -> str:
    """Return Flask SECRET_KEY: env → .sau_secret_key → auto-generate."""
    key = os.environ.get("SAU_SECRET_KEY")
    if key:
        return key
    key_file = BASE_DIR / ".sau_secret_key"
    if key_file.exists() and key_file.stat().st_size > 0:
        return key_file.read_text().strip()
    key = secrets.token_hex(32)
    key_file.write_text(key)
    try:
        key_file.chmod(0o600)
    except OSError:
        pass
    _task_logger.info(f"[auth] generated SECRET_KEY -> {key_file}")
    return key


def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config["SECRET_KEY"] = _get_secret_key()
    app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024

    _setup_cors(app)
    init_db()

    # Startup side-effects (best-effort; never block boot).
    try:
        from web_runner.utils import _sync_cookie_files_to_db

        _sync_cookie_files_to_db()
    except Exception as exc:  # strict-exceptions: allow
        _task_logger.warning(f"[startup] _sync_cookie_files_to_db failed: {type(exc).__name__}")

    try:
        from web_runner.utils import _cleanup_old_uploads

        _cleanup_old_uploads()
    except Exception as exc:  # strict-exceptions: allow
        _task_logger.warning(f"[startup] _cleanup_old_uploads failed: {type(exc).__name__}")

    try:
        from web_runner.utils import _start_orphan_watchdog

        _start_orphan_watchdog()
    except Exception as exc:  # strict-exceptions: allow
        _task_logger.warning(f"[startup] orphan watchdog failed: {type(exc).__name__}")

    from web_runner.routes.account_groups import bp as account_groups_bp
    from web_runner.routes.accounts import bp as accounts_bp
    from web_runner.routes.admin import bp as admin_bp
    from web_runner.routes.ai import bp as ai_bp
    from web_runner.routes.analytics import bp as analytics_bp
    from web_runner.routes.auth import bp as auth_bp
    from web_runner.routes.calendar import bp as calendar_bp
    from web_runner.routes.crawl import bp as crawl_bp
    from web_runner.routes.hotlist import bp as hotlist_bp
    from web_runner.routes.inbox import bp as inbox_bp
    from web_runner.routes.license import bp as license_bp
    from web_runner.routes.notifications import bp as notifications_bp
    from web_runner.routes.oauth import bp as oauth_bp
    from web_runner.routes.scheduling import bp as scheduling_bp
    from web_runner.routes.studio import bp as studio_bp
    from web_runner.routes.tasks import bp as tasks_bp
    from web_runner.routes.templates import bp as templates_bp
    from web_runner.routes.upload import bp as upload_bp
    from web_runner.routes.usage import bp as usage_bp

    # Core shell (accounts / upload / tasks / AI / groups / auth)
    app.register_blueprint(auth_bp)
    app.register_blueprint(oauth_bp)
    app.register_blueprint(accounts_bp)
    app.register_blueprint(upload_bp)
    app.register_blueprint(tasks_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(account_groups_bp)
    # Restored SPA surfaces — SQLite-backed, aligned with frontend api/*
    app.register_blueprint(calendar_bp)
    app.register_blueprint(inbox_bp)
    app.register_blueprint(crawl_bp)
    app.register_blueprint(hotlist_bp)
    app.register_blueprint(studio_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(templates_bp)
    app.register_blueprint(license_bp)
    app.register_blueprint(usage_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(scheduling_bp)

    @app.get("/health")
    def health():
        # Contract locked by tests/test_web_shell.py::TestHealth
        return jsonify({"ok": True})

    @app.get("/")
    def index():
        dist = _frontend_dist()
        if dist:
            return Response(
                (dist / "index.html").read_text(encoding="utf-8"),
                mimetype="text/html",
            )
        return Response(
            "<h1>social-auto-upload web shell</h1><p>frontend not built yet.</p>",
            mimetype="text/html",
        )

    @app.errorhandler(Exception)
    def _handle_unexpected_error(exc):
        from werkzeug.exceptions import HTTPException

        if isinstance(exc, HTTPException):
            return exc.get_response()
        _task_logger.error(f"[error] unhandled exception: {exc}")
        return jsonify({"success": False, "message": "Internal server error"}), 500

    @app.errorhandler(413)
    def _handle_request_too_large(exc):
        return jsonify(
            {"success": False, "message": "Request entity too large (max 200MB)"}
        ), 413

    return app


def _frontend_dist() -> Path | None:
    dist = BASE_DIR / "sau_web" / "frontend" / "dist"
    return dist if (dist / "index.html").exists() else None


def _setup_cors(app: Flask) -> None:
    raw = os.environ.get("SAU_CORS_ALLOWED_ORIGINS")
    if not raw:
        _task_logger.warning(
            "[web] CORS disabled (SAU_CORS_ALLOWED_ORIGINS is unset/empty). "
            "Set e.g. SAU_CORS_ALLOWED_ORIGINS='http://localhost:5173,http://localhost:5174' "
            "to allow cross-origin clients."
        )
        return
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if origins:
        CORS(app, resources={r"/api/*": {"origins": origins}}, supports_credentials=True)
        _task_logger.info(
            f"[web] CORS enabled for /api/* origins: {origins} (credentials=True)"
        )


# Lazy AI re-exports so ``from web_runner import _stream_openrouter`` still works
# without importing routes at package import time (avoids circular imports).
def __getattr__(name: str):
    if name in {
        "_stream_openrouter",
        "_get_all_keys",
        "_get_all_keys_cached",
        "_get_next_key",
        "_mark_rate_limited",
        "http_requests",
        "AI_MODELS",
        "PLATFORM_PROMPTS",
        "DEFAULT_SYSTEM_PROMPT",
        "_build_media_content",
        "_ai_request_semaphore",
    }:
        if name == "http_requests" or name == "_stream_openrouter":
            from web_runner.routes import ai as _ai

            return getattr(_ai, name)
        from web_runner import ai_worker as _aw

        mapping = {
            "_get_all_keys": _aw._get_all_keys,
            "_get_all_keys_cached": _aw._get_all_keys_cached,
            "_get_next_key": _aw._get_next_key,
            "_mark_rate_limited": _aw._mark_rate_limited,
            "AI_MODELS": _aw.AI_MODELS,
            "PLATFORM_PROMPTS": _aw.PLATFORM_PROMPTS,
            "DEFAULT_SYSTEM_PROMPT": _aw.DEFAULT_SYSTEM_PROMPT,
            "_build_media_content": _aw._build_media_content,
            "_ai_request_semaphore": _aw._ai_request_semaphore,
        }
        return mapping[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "BASE_DIR",
    "COOKIES_DIR",
    "DB_PATH",
    "DESC_PLATFORMS",
    "MIN_UPLOAD_BYTES",
    "NOTE_PLATFORMS",
    "PLATFORM_CONFIG",
    "THUMBNAIL_DUAL_PLATFORMS",
    "THUMBNAIL_PLATFORMS",
    "UPLOADS_DIR",
    "_account_files",
    "_db_get_error_events",
    "_log_error_event",
    "_run_sau",
    "_schedule_task",
    "create_app",
    "db_lock",
    "log",
    "task_executor",
]
