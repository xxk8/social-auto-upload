"""OAuth routes — Google/GitHub social login (Authlib).

When provider credentials are missing, login endpoints return 501 / redirect
with ``oauth_not_configured`` so the SPA can disable buttons honestly.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from flask import Blueprint, jsonify, redirect, request, session, url_for

from web_runner.db import get_connection
from web_runner.oauth import github_configured, google_configured, oauth

bp = Blueprint("oauth", __name__)

FRONTEND_URL = (os.environ.get("SAU_FRONTEND_URL") or "http://localhost:5174").rstrip("/")


def _frontend_url(path: str) -> str:
    return f"{FRONTEND_URL}/{path.lstrip('/')}"


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _find_or_create_user(
    email: str, name: str | None = None, avatar: str | None = None
) -> dict:
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        now = _now()
        if not user:
            count = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
            role = "admin" if count and count.get("cnt", 0) == 0 else "user"
            conn.execute(
                "INSERT INTO users (email, role, created_at, last_login, name, avatar) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (email, role, now, now, name, avatar),
            )
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        else:
            conn.execute(
                "UPDATE users SET last_login = ?, name = COALESCE(?, name), "
                "avatar = COALESCE(?, avatar) WHERE id = ?",
                (now, name, avatar, user["id"]),
            )
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return user or {}


def _create_session(user: dict) -> None:
    session.clear()
    session["user_id"] = user.get("id")
    session["role"] = user.get("role")
    session.permanent = True


@bp.get("/api/auth/oauth/status")
def oauth_status():
    return jsonify({
        "success": True,
        "data": {
            "google": google_configured(),
            "github": github_configured(),
            "message": None
            if (google_configured() or github_configured())
            else "设置 GOOGLE_CLIENT_* / GITHUB_CLIENT_* 后启用社交登录。",
        },
    })


@bp.get("/api/auth/google/login")
def google_login():
    if not google_configured():
        if request.args.get("format") == "json" or "application/json" in (
            request.headers.get("Accept") or ""
        ):
            return jsonify({
                "success": False,
                "configured": False,
                "message": "Google OAuth 未配置（需要 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）。",
            }), 501
        return redirect(_frontend_url("/login?error=oauth_not_configured&provider=google"))
    client = oauth.create_client("google")
    if not client:
        return redirect(_frontend_url("/login?error=oauth_not_configured&provider=google"))
    redirect_uri = url_for("oauth.google_callback", _external=True)
    return client.authorize_redirect(redirect_uri)


@bp.get("/api/auth/google/callback")
def google_callback():
    if not google_configured():
        return redirect(_frontend_url("/login?error=oauth_not_configured&provider=google"))
    client = oauth.create_client("google")
    if not client:
        return redirect(_frontend_url("/login?error=oauth_not_configured&provider=google"))
    try:
        token = client.authorize_access_token()
        userinfo = token.get("userinfo") or {}
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
    except Exception as exc:  # strict-exceptions: allow — oauth provider surface
        from utils.log import logger as _task_logger

        _task_logger.warning(f"[oauth] Google callback failed: {exc}")
        return redirect(_frontend_url("/login?error=google_failed"))


@bp.get("/api/auth/github/login")
def github_login():
    if not github_configured():
        if request.args.get("format") == "json" or "application/json" in (
            request.headers.get("Accept") or ""
        ):
            return jsonify({
                "success": False,
                "configured": False,
                "message": "GitHub OAuth 未配置（需要 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）。",
            }), 501
        return redirect(_frontend_url("/login?error=oauth_not_configured&provider=github"))
    client = oauth.create_client("github")
    if not client:
        return redirect(_frontend_url("/login?error=oauth_not_configured&provider=github"))
    redirect_uri = url_for("oauth.github_callback", _external=True)
    return client.authorize_redirect(redirect_uri)


@bp.get("/api/auth/github/callback")
def github_callback():
    if not github_configured():
        return redirect(_frontend_url("/login?error=oauth_not_configured&provider=github"))
    client = oauth.create_client("github")
    if not client:
        return redirect(_frontend_url("/login?error=oauth_not_configured&provider=github"))
    try:
        token = client.authorize_access_token()
        resp = client.get("user", token=token)
        profile = resp.json()
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
    except Exception as exc:  # strict-exceptions: allow — oauth provider surface
        from utils.log import logger as _task_logger

        _task_logger.warning(f"[oauth] GitHub callback failed: {exc}")
        return redirect(_frontend_url("/login?error=github_failed"))
