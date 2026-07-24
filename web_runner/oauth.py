"""OAuth configuration — Authlib integration for Google/GitHub login.

Env vars required (both of a pair must be non-empty to enable that provider):
  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
"""
from __future__ import annotations

import os

from authlib.integrations.flask_client import OAuth

oauth = OAuth()

_GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
_GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
_GITHUB_CLIENT_ID = os.environ.get("GITHUB_CLIENT_ID", "")
_GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET", "")


def google_configured() -> bool:
    return bool(_GOOGLE_CLIENT_ID and _GOOGLE_CLIENT_SECRET)


def github_configured() -> bool:
    return bool(_GITHUB_CLIENT_ID and _GITHUB_CLIENT_SECRET)


def init_oauth(app) -> None:
    """Bind Authlib to Flask and register providers that have credentials."""
    oauth.init_app(app)
    if google_configured():
        oauth.register(
            name="google",
            client_id=_GOOGLE_CLIENT_ID,
            client_secret=_GOOGLE_CLIENT_SECRET,
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )
    if github_configured():
        oauth.register(
            name="github",
            client_id=_GITHUB_CLIENT_ID,
            client_secret=_GITHUB_CLIENT_SECRET,
            access_token_url="https://github.com/login/oauth/access_token",
            access_token_params=None,
            authorize_url="https://github.com/login/oauth/authorize",
            authorize_params=None,
            api_base_url="https://api.github.com/",
            client_kwargs={"scope": "user:email"},
        )
