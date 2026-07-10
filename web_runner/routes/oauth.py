"""OAuth routes — Google/GitHub social login.

All endpoints are public (no auth required) — they handle the OAuth
authorization-code flow and create sessions for new/existing users.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from flask import Blueprint, redirect, url_for, session

from web_runner.db import get_database
from web_runner.oauth import oauth

if TYPE_CHECKING:
    from authlib.integrations.flask_client import FlaskOAuth2App

bp = Blueprint("oauth", __name__)

# ── Frontend base URL ─────────────────────────────────────────────────
#
# The 10 `redirect()` calls below MUST send the browser to the
# FRONTEND origin (Vite at :5180 in dev), not the backend origin
# (Flask at :6001). If they target :6001, the browser hits the
# backend's 404 for frontend routes like `/dashboard` and `/login`
# (those paths are not registered as Flask routes — they're
# React Router routes served by the SPA).
#
# `SAU_FRONTEND_URL` overrides the dev default `http://localhost:5180`
# for staging / production deployments.
#
# Round-OAuth-callback-redirect bug fix: previously these redirects
# used relative paths (`redirect("/app")`), which the browser resolved
# against the backend origin (the OAuth callback came back to :6001),
# so users saw "Not Found" even after a successful Google/GitHub
# login. The fix: route every redirect through `_frontend_url(...)`
# so the browser receives an absolute `http://localhost:5180/...`
# URL.
# Use `or` (not the `, default` arg of get) so an explicit
# `SAU_FRONTEND_URL=""` in .env (e.g. user commented it out by
# setting it to empty) still falls back to the dev default.
# `os.environ.get(name, default)` returns `""` when the key
# EXISTS with an empty value — the `, default` is ignored.
FRONTEND_URL = (os.environ.get("SAU_FRONTEND_URL") or "http://localhost:5180").rstrip("/")


def _frontend_url(path: str) -> str:
    """Return an absolute frontend URL for a path like '/dashboard' or '/login?error=...'.

    Strips a leading slash from `path` so callers can pass either
    '/dashboard' or 'app' without double-slash. The query string portion
    (after `?`) is passed through untouched.
    """
    return f"{FRONTEND_URL}/{path.lstrip('/')}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _find_or_create_user(
    email: str, name: str | None = None, avatar: str | None = None
) -> dict:
    """Look up user by email; create if not found.

    First user becomes admin; subsequent users are regular users.
    """
    db = get_database()
    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))

    if not user:
        now = _now_iso()
        count_row = db.fetch_one("SELECT COUNT(*) AS cnt FROM users")
        role = "admin" if (count_row and count_row["cnt"] == 0) else "user"
        db.execute(
            "INSERT INTO users (email, role, created_at, last_login, name, avatar) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (email, role, now, now, name, avatar),
        )
        user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    else:
        now = _now_iso()
        db.execute(
            "UPDATE users SET last_login = ?, name = COALESCE(?, name), "
            "avatar = COALESCE(?, avatar) WHERE id = ?",
            (now, name, avatar, user["id"]),
        )
        user = db.fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))

    return user or {}


def _create_session(user: dict) -> None:
    """Create Flask session for the authenticated user."""
    session.clear()
    session["user_id"] = user.get("id")
    session["role"] = user.get("role")
    session.permanent = True


@bp.get("/api/auth/google/login")
def google_login():
    """Redirect to Google authorization page."""
    client: FlaskOAuth2App = oauth.create_client("google")  # type: ignore[assignment]
    if not client:
        return redirect(_frontend_url("/login?error=oauth_not_configured"))
    redirect_uri = url_for("oauth.google_callback", _external=True)
    return client.authorize_redirect(redirect_uri)


@bp.get("/api/auth/google/callback")
def google_callback():
    """Handle Google OAuth callback."""
    client: FlaskOAuth2App = oauth.create_client("google")  # type: ignore[assignment]
    if not client:
        return redirect(_frontend_url("/login?error=oauth_not_configured"))

    try:
        token = client.authorize_access_token()
        userinfo = token.get("userinfo", {})
        email = userinfo.get("email")
        if not email:
            return redirect(_frontend_url("/login?error=no_email"))

        user = _find_or_create_user(
            email=email,
            name=userinfo.get("name"),
            avatar=userinfo.get("picture"),
        )
        _create_session(user)
        return redirect(_frontend_url("/dashboard"))
    except Exception as exc:
        from utils.log import logger as _task_logger
        _task_logger.warning(f"[oauth] Google callback failed: {exc}")
        return redirect(_frontend_url("/login?error=google_failed"))


@bp.get("/api/auth/github/login")
def github_login():
    """Redirect to GitHub authorization page."""
    client: FlaskOAuth2App = oauth.create_client("github")  # type: ignore[assignment]
    if not client:
        return redirect(_frontend_url("/login?error=oauth_not_configured"))
    redirect_uri = url_for("oauth.github_callback", _external=True)
    return client.authorize_redirect(redirect_uri)


@bp.get("/api/auth/github/callback")
def github_callback():
    """Handle GitHub OAuth callback."""
    client: FlaskOAuth2App = oauth.create_client("github")  # type: ignore[assignment]
    if not client:
        return redirect(_frontend_url("/login?error=oauth_not_configured"))

    try:
        token = client.authorize_access_token()
        resp = client.get("user", token=token)
        profile = resp.json()

        # Get primary email (may require separate call)
        email_resp = client.get("user/emails", token=token)
        emails = email_resp.json()
        email = None
        if isinstance(emails, list):
            email = next((e["email"] for e in emails if e.get("primary")), None)
            if not email:
                email = next((e["email"] for e in emails if e.get("verified")), None)
            if not email and emails:
                email = emails[0].get("email")

        if not email:
            return redirect(_frontend_url("/login?error=no_email"))

        user = _find_or_create_user(
            email=email,
            name=profile.get("name") or profile.get("login"),
            avatar=profile.get("avatar_url"),
        )
        _create_session(user)
        return redirect(_frontend_url("/dashboard"))
    except Exception as exc:
        from utils.log import logger as _task_logger
        _task_logger.warning(f"[oauth] GitHub callback failed: {exc}")
        return redirect(_frontend_url("/login?error=github_failed"))
