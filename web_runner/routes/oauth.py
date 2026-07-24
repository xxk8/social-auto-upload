"""OAuth stubs — Google/GitHub social login is intentionally not wired in the local shell.

Even if ``GOOGLE_CLIENT_*`` / ``GITHUB_CLIENT_*`` appear in ``.env``, this module
always returns 501 / redirects with ``oauth_not_configured`` so the SPA never 404s
and never pretends OAuth works. Frontend buttons on ``/login/auth`` are disabled
with the same copy. Full OAuth lives in product deployments only.
"""
from __future__ import annotations

import os

from flask import Blueprint, jsonify, redirect, request

bp = Blueprint("oauth", __name__)

FRONTEND_URL = (os.environ.get("SAU_FRONTEND_URL") or "http://localhost:5174").rstrip("/")


def _oauth_disabled(provider: str):
    message = (
        f"{provider} OAuth 在本地壳未启用。"
        "请使用邮箱验证码 / 密码登录，或设置 SAU_AUTH_ENABLED=false 做本地开发。"
    )
    if request.args.get("format") == "json" or "application/json" in (
        request.headers.get("Accept") or ""
    ):
        return jsonify({"success": False, "message": message, "configured": False}), 501
    return redirect(f"{FRONTEND_URL}/login?error=oauth_not_configured&provider={provider.lower()}")


@bp.get("/api/auth/oauth/status")
def oauth_status():
    """SPA can poll this; always ``configured: false`` on local shell stubs."""
    return jsonify({
        "success": True,
        "data": {
            "google": False,
            "github": False,
            "message": "本地壳 OAuth 为占位实现，未启用。",
        },
    })


@bp.get("/api/auth/google/login")
def google_login():
    return _oauth_disabled("Google")


@bp.get("/api/auth/github/login")
def github_login():
    return _oauth_disabled("GitHub")


@bp.get("/api/auth/google/callback")
@bp.get("/api/auth/github/callback")
def oauth_callback():
    return redirect(f"{FRONTEND_URL}/login?error=oauth_not_configured")
