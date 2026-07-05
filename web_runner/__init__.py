"""Web runner package — Flask application factory."""
from __future__ import annotations

import os
import secrets

from flask import Flask
from flask_cors import CORS

from utils.log import logger as _task_logger
from web_runner.db import DB_DIR, init_db


def _get_secret_key() -> str:
    """Return a SECRET_KEY for Flask session signing.

    Priority: SAU_SECRET_KEY env var → db/.secret_key file → auto-generate.
    """
    key = os.environ.get("SAU_SECRET_KEY")
    if key:
        return key
    key_file = DB_DIR / ".secret_key"
    if key_file.exists():
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

    from web_runner.utils import _sync_cookie_files_to_db
    _sync_cookie_files_to_db()

    from web_runner.middleware.usage_metering import bp as usage_bp
    from web_runner.middleware.usage_metering import register_usage_middleware
    from web_runner.routes.account_groups import bp as account_groups_bp
    from web_runner.routes.accounts import bp as accounts_bp
    from web_runner.routes.ai import bp as ai_bp
    from web_runner.routes.analytics import bp as analytics_bp
    from web_runner.routes.auth import bp as auth_bp
    from web_runner.routes.inbox import bp as inbox_bp
    from web_runner.routes.license import bp as license_bp
    from web_runner.routes.monitor import bp as monitor_bp
    from web_runner.routes.public_inbox_kill_criteria import (
        bp as public_inbox_kill_criteria_bp,
    )
    from web_runner.routes.tasks import bp as tasks_bp
    from web_runner.routes.templates import bp as templates_bp
    from web_runner.routes.upload import bp as upload_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(accounts_bp)
    app.register_blueprint(upload_bp)
    app.register_blueprint(tasks_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(account_groups_bp)
    app.register_blueprint(inbox_bp)
    app.register_blueprint(license_bp)
    app.register_blueprint(templates_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(monitor_bp)
    app.register_blueprint(public_inbox_kill_criteria_bp)
    app.register_blueprint(usage_bp)

    register_usage_middleware(app)

    # ── Auth gate: protect all /api/* except whitelist ──────────────
    _AUTH_WHITELIST = ("/api/auth/", "/health")

    @app.before_request
    def _check_auth():
        from web_runner.routes.auth import _current_user_id, _is_auth_enabled
        if not _is_auth_enabled():
            return None
        from flask import jsonify, request
        path = request.path
        if not path.startswith("/api/"):
            return None
        if any(path.startswith(w) for w in _AUTH_WHITELIST):
            return None
        uid = _current_user_id()
        if uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        return None

    # ── Startup cleanup: expired codes + temp uploads/inbox dir ─────
    try:
        from datetime import datetime

        from web_runner.db import get_database
        db = get_database()
        now = datetime.utcnow().isoformat()
        db.execute("DELETE FROM verification_codes WHERE expires_at < ?", (now,))
        _task_logger.info("[auth] cleaned up expired verification codes on startup")
    except Exception:
        pass  # table may not exist yet on first run

    # ponytail: explicit call. Without this the function is dead code
    # (no periodic caller exists). Idempotent — safe even if future
    # callers (e.g. a watchdog timer) also invoke it.
    try:
        from web_runner.utils import _cleanup_old_uploads
        _cleanup_old_uploads()
    except Exception as exc:
        _task_logger.warning(f"[startup] _cleanup_old_uploads failed: {type(exc).__name__}")

    # Round-30 v7.2 boot‑time privacy‑hygiene janitor (Reviewer
    # followup i): scrub stale `.yt_cookies_*.txt` tmp files left
    # over from orphaned/​crashed `_try_ytdlp` runs. Cookies are
    # plaintext session tokens — never let them survive a restart.
    # Same try/except discipline as `_cleanup_old_uploads` above:
    # failure logs + continues, never blocks boot.
    try:
        from web_runner.routes.inbox import _sweep_stale_yt_cookie_tmp_files
        removed = _sweep_stale_yt_cookie_tmp_files()
        if removed:
            _task_logger.info(f"[startup] janitor scrubbed {removed} stale .yt_cookies_*.tmp file(s)")
    except Exception as exc:
        _task_logger.warning(f"[startup] janitor sweep failed: {type(exc).__name__}")

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.errorhandler(Exception)
    def _handle_unexpected_error(exc):
        from werkzeug.exceptions import HTTPException
        if isinstance(exc, HTTPException):
            return exc.get_response()
        from flask import jsonify
        _task_logger.error(f"[error] unhandled exception: {exc}")
        return jsonify({"success": False, "message": "Internal server error"}), 500

    @app.errorhandler(413)
    def _handle_request_too_large(exc):
        from flask import jsonify
        return jsonify({"success": False, "message": "Request entity too large (max 200MB)"}), 413

    return app


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
        _task_logger.info(f"[web] CORS enabled for /api/* origins: {origins} (credentials=True)")
