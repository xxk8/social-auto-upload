"""Web runner package — Flask application factory."""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from flask import Flask
from flask_cors import CORS

from utils.log import logger as _task_logger
from web_runner.db import _init_db_postgres, get_database

BASE_DIR = Path(__file__).parent.parent.resolve()


def _get_secret_key() -> str:
    """Return a SECRET_KEY for Flask session signing.

    Priority: SAU_SECRET_KEY env var → .sau_secret_key file → auto-generate.

    Migration note: the legacy location was ``db/.secret_key``. On
    first read after this change, if the new file is absent and the
    old one exists, the old key is moved to the new location (and
    the old file is unlinked) so in-flight deployments don't lose
    their session key. Idempotent — re-runs on an already-migrated
    install skip the migration branch and read the new file directly.
    """
    key = os.environ.get("SAU_SECRET_KEY")
    if key:
        return key
    base_dir = Path(__file__).parent.parent.resolve()
    new_key_file = base_dir / ".sau_secret_key"
    old_key_file = base_dir / "db" / ".secret_key"
    # Auto-migrate the legacy db/.secret_key → .sau_secret_key.
    # Read first, write second, unlink last: a partial migration
    # (crash between write and unlink) leaves a stale .secret_key
    # that the next read still uses — no data loss.
    if not new_key_file.exists() and old_key_file.exists():
        key = old_key_file.read_text().strip()
        new_key_file.write_text(key)
        try:
            old_key_file.unlink()
        except OSError:
            # Best-effort cleanup; the migration succeeded even if
            # unlink failed (the new file holds the canonical key).
            pass
    # Guard against an empty file: `Path.exists()` returns True for a
    # 0-byte file, but ``secrets.compare_digest`` against an empty
    # key would silently produce a broken app. Treat empty contents
    # the same as a missing file so we re-generate.
    if new_key_file.exists() and new_key_file.stat().st_size > 0:
        return new_key_file.read_text().strip()
    key = secrets.token_hex(32)
    new_key_file.write_text(key)
    try:
        new_key_file.chmod(0o600)
    except OSError:
        pass
    _task_logger.info(f"[auth] generated SECRET_KEY -> {new_key_file}")
    return key


def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config["SECRET_KEY"] = _get_secret_key()
    app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024

    _setup_cors(app)
    # Inline of the prior web_runner.db.init_db() wrapper. Schema
    # bootstrap runs once at app creation; the psycopg pool is
    # lazily connected on first use.
    _init_db_postgres(get_database())

    from web_runner.utils import _sync_cookie_files_to_db
    _sync_cookie_files_to_db()

    from web_runner.middleware.usage_metering import bp as usage_bp
    from web_runner.middleware.usage_metering import register_usage_middleware
    from web_runner.routes.account_groups import bp as account_groups_bp
    from web_runner.routes.accounts import bp as accounts_bp
    from web_runner.routes.ai import bp as ai_bp
    from web_runner.routes.analytics import bp as analytics_bp
    from web_runner.routes.auth import bp as auth_bp
    from web_runner.routes.crawl import bp as crawl_bp
    from web_runner.routes.founder import bp as founder_bp
    from web_runner.routes.inbox import bp as inbox_bp
    from web_runner.routes.license import bp as license_bp
    from web_runner.routes.monitor import bp as monitor_bp
    from web_runner.routes.admin import bp as admin_bp
    from web_runner.routes.oauth import bp as oauth_bp
    from web_runner.routes.public_inbox_kill_criteria import (
        bp as public_inbox_kill_criteria_bp,
    )
    from web_runner.routes.studio import bp as studio_bp
    from web_runner.routes.tasks import bp as tasks_bp
    from web_runner.routes.calendar import bp as calendar_bp
    from web_runner.routes.templates import bp as templates_bp
    from web_runner.routes.upload import bp as upload_bp
    from web_runner.routes.hotlist import bp as hotlist_bp
    from web_runner.routes.notifications import bp as notifications_bp
    from web_runner.routes.webhooks import bp as webhooks_bp

    # Init OAuth providers
    from web_runner.oauth import oauth, _register_providers
    oauth.init_app(app)
    _register_providers()

    app.register_blueprint(auth_bp)
    app.register_blueprint(oauth_bp)
    app.register_blueprint(admin_bp)
    # Crawler (openspec/changes/mediacrawler-integration): research
    # surface — comment monitoring, sentiment analysis, reply
    # suggestions. Goes BEFORE the auth gate so unauthenticated
    # callers get the standard 401 from ``_check_auth`` (NOT a 200
    # blind-dispatch that would let a unauthenticated caller
    # enqueue a crawl task).
    app.register_blueprint(crawl_bp)
    # Founder blueprint (ai-api-keys-founder feature): the
    # founder-transfer endpoint intentionally authenticates via
    # inline founder check inside the route (not
    # ``@founder_required``) so the response can layer in audit-log
    # evidence pre-flight. Same blueprint-registration protocol as
    # the rest of routes/* above.
    app.register_blueprint(founder_bp)
    app.register_blueprint(accounts_bp)
    app.register_blueprint(upload_bp)
    app.register_blueprint(tasks_bp)
    app.register_blueprint(calendar_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(webhooks_bp)
    app.register_blueprint(account_groups_bp)
    app.register_blueprint(inbox_bp)
    app.register_blueprint(license_bp)
    app.register_blueprint(templates_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(monitor_bp)
    app.register_blueprint(public_inbox_kill_criteria_bp)
    app.register_blueprint(studio_bp)
    app.register_blueprint(usage_bp)
    app.register_blueprint(hotlist_bp)

    register_usage_middleware(app)

    # ── Auth gate: protect all /api/* except whitelist ──────────────
    _AUTH_WHITELIST = ("/api/auth/", "/health", "/api/hotlist")

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

    # ── Race-window echo: tag 401s from the initial mounting window ──
    # The frontend sets `X-SAU-Auth-Pending: 1` on every axios request
    # while authStore.isLoading is true (see
    # sau_web/frontend/src/api/_appendAuthPendingHeader.ts). On 401
    # responses during that window we echo `X-SAU-Race-Window: 1` so
    # DevTools users can filter the noise:
    #
    #   > Network panel → filter: has-response-header:X-SAU-Race-Window
    #
    # The 401 itself is still returned unchanged (the response contract
    # for unauthenticated callers is preserved) — only the marker
    # header is added. This is a strict addition; existing canned
    # curl/Java code is unaffected because they don't request the
    # header.
    #
    # ## Why an after_request hook (not inline in _check_auth)
    #
    # `_check_auth` is ONE of multiple 401 sources: route-level
    # `@login_required` decorator, `@admin_required`, etc., all
    # return their own 401 too. An after_request hook catches ALL of
    # them in one place without needing to thread the marker logic
    # into every 401-producing decorator.
    #
    # ## Why the value is exactly "1"
    #
    # The frontend sets the header to the literal string "1". Any
    # other value (empty string, "true", "yes") is treated as
    # "header not present" so a misbehaving client can't accidentally
    # tag its real session-expired 401s as race-window noise.
    @app.after_request
    def _propagate_race_window_header(response):
        from flask import request
        if (request.headers.get("X-SAU-Auth-Pending") == "1"
                and response.status_code == 401):
            response.headers["X-SAU-Race-Window"] = "1"
        return response

    # ── Startup cleanup: expired codes + temp uploads/inbox dir ─────
    try:
        from datetime import datetime

        _db = get_database()
        db = _db
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

    # ── Startup: webhook notification delivery worker (idempotent) ──
    try:
        from web_runner.notifications import start_worker

        start_worker()
        _task_logger.info("[startup] webhook notification worker started")
    except Exception as exc:
        _task_logger.warning(f"[startup] notification worker failed: {type(exc).__name__}")

    # ── Startup: account health monitor (idempotent) ────────────────
    try:
        from web_runner.health_monitor import start_health_monitor

        start_health_monitor()
        _task_logger.info("[startup] account health monitor started")
    except Exception as exc:
        _task_logger.warning(f"[startup] health monitor failed: {type(exc).__name__}")

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
