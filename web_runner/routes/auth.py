"""Authentication routes — email verification code login."""
from __future__ import annotations

import os
import re
import secrets
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from functools import wraps

from flask import Blueprint, jsonify, request, session

from utils.log import logger as _task_logger
from web_runner.db import get_database

bp = Blueprint("auth", __name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ── Helpers ────────────────────────────────────────────────────────


def _is_auth_enabled() -> bool:
    """Return True if authentication should be enforced.

    Set SAU_AUTH_ENABLED=false to disable authentication entirely.
    When disabled, all endpoints are accessible without login and
    /api/auth/me returns a synthetic admin user.
    """
    return os.environ.get("SAU_AUTH_ENABLED", "true").lower() != "false"


def _current_user_id() -> int | None:
    """Return the user_id from the current session, or None."""
    return session.get("user_id")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _expire_iso(seconds: int = 300) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat(timespec="seconds")


# ── Decorators ─────────────────────────────────────────────────────


def login_required(fn):
    """Decorator: reject unauthenticated requests with 401."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _is_auth_enabled():
            return fn(*args, **kwargs)
        if _current_user_id() is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        return fn(*args, **kwargs)

    return wrapper


def admin_required(fn):
    """Decorator: reject non-admin requests with 403."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _is_auth_enabled():
            return fn(*args, **kwargs)
        if _current_user_id() is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        if session.get("role") != "admin":
            return jsonify({"success": False, "message": "权限不足"}), 403
        return fn(*args, **kwargs)

    return wrapper


# ── SSE authentication helper ──────────────────────────────────────


def authenticate_sse_request(req: request) -> int | None:
    """Authenticate an SSE request via session cookie or one-time token.

    Returns user_id if authenticated, None otherwise.
    When auth is disabled, returns the synthetic admin user id (0)
    so SSE endpoints can proceed without a real session.
    """
    if not _is_auth_enabled():
        return 0

    # 1. Try session
    uid = _current_user_id()
    if uid is not None:
        return uid

    # 2. Try sse_token query param
    token = req.args.get("sse_token", "")
    if not token:
        return None

    db = get_database()
    row = db.fetch_one(
        "SELECT id, email FROM verification_codes "
        "WHERE code = ? AND purpose = 'sse' AND used = 0 AND expires_at > ?",
        (token, _now_iso()),
    )
    if row:
        # Mark token as used
        db.execute("UPDATE verification_codes SET used = 1 WHERE id = ?", (row["id"],))
        # Look up user by email
        user = db.fetch_one("SELECT id FROM users WHERE email = ?", (row["email"],))
        if user:
            return user["id"]
    return None


# ── SMTP ───────────────────────────────────────────────────────────


def _send_smtp_email(to_email: str, subject: str, body: str) -> tuple[bool, str]:
    """Send an email via SMTP. Returns (success, message)."""
    host = os.environ.get("SAU_SMTP_HOST")
    port = int(os.environ.get("SAU_SMTP_PORT", "465"))
    user = os.environ.get("SAU_SMTP_USER")
    password = os.environ.get("SAU_SMTP_PASS")
    from_addr = os.environ.get("SAU_SMTP_FROM", user)

    if not all([host, user, password]):
        return False, "邮件服务未配置"

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email

    try:
        with smtplib.SMTP_SSL(host, port, timeout=15) as server:
            server.login(user, password)
            server.send_message(msg)
        return True, "发送成功"
    except Exception as exc:
        _task_logger.error(f"[auth] SMTP send failed: {exc}")
        return False, f"邮件发送失败: {exc}"


# ── Routes ─────────────────────────────────────────────────────────


@bp.post("/api/auth/send-code")
def send_code():
    """Send a verification code to the specified email."""
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()

    if not email or not _EMAIL_RE.match(email):
        return jsonify({"success": False, "message": "邮箱格式不正确"}), 400

    db = get_database()

    # Cleanup expired codes for this email
    db.execute(
        "DELETE FROM verification_codes WHERE email = ? AND expires_at < ? AND purpose = 'login'",
        (email, _now_iso()),
    )

    # Rate limit: 60s cooldown
    recent = db.fetch_one(
        "SELECT created_at FROM verification_codes "
        "WHERE email = ? AND purpose = 'login' AND created_at > ? "
        "ORDER BY created_at DESC LIMIT 1",
        (email, (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat(timespec="seconds")),
    )
    if recent:
        return jsonify({"success": False, "message": "请等待 60 秒后重试"}), 429

    # Generate code
    code = f"{secrets.randbelow(900000) + 100000:06d}"
    now = _now_iso()
    db.execute(
        "INSERT INTO verification_codes (email, code, purpose, expires_at, used, created_at) "
        "VALUES (?, ?, 'login', ?, 0, ?)",
        (email, code, _expire_iso(300), now),
    )

    # Send email
    ok, msg = _send_smtp_email(email, "登录验证码", f"您的登录验证码是：{code}，5分钟内有效。")
    if ok:
        return jsonify({"success": True, "message": "验证码已发送"})
    return jsonify({"success": False, "message": msg}), 500


@bp.post("/api/auth/login")
def login():
    """Verify code and create session."""
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    code = (payload.get("code") or "").strip()

    if not email or not _EMAIL_RE.match(email):
        return jsonify({"success": False, "message": "邮箱格式不正确"}), 400
    if not code or len(code) != 6 or not code.isdigit():
        return jsonify({"success": False, "message": "验证码格式不正确"}), 400

    db = get_database()

    # Check brute force: 5 failed attempts in 15 minutes → lock 30 min
    lock_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat(timespec="seconds")
    recent_fails = db.fetch_one(
        "SELECT COUNT(*) as cnt FROM verification_codes "
        "WHERE email = ? AND purpose = 'login' AND used = 1 AND created_at > ?",
        (email, lock_cutoff),
    )
    if recent_fails and recent_fails["cnt"] >= 5:
        lock_until = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(timespec="seconds")
        db.execute("UPDATE users SET locked_until = ? WHERE email = ?", (lock_until, email))
        return jsonify({"success": False, "message": "登录尝试次数过多，请 30 分钟后重试"}), 429

    # Check if account is locked
    user_row = db.fetch_one("SELECT locked_until FROM users WHERE email = ?", (email,))
    if user_row and user_row.get("locked_until"):
        if user_row["locked_until"] > _now_iso():
            return jsonify({"success": False, "message": "账号已锁定，请稍后重试"}), 429

    # Find the latest unused, non-expired code
    row = db.fetch_one(
        "SELECT id, code, expires_at FROM verification_codes "
        "WHERE email = ? AND purpose = 'login' AND used = 0 AND expires_at > ? "
        "ORDER BY created_at DESC LIMIT 1",
        (email, _now_iso()),
    )
    if not row:
        return jsonify({"success": False, "message": "验证码已过期，请重新获取"}), 401
    if row["code"] != code:
        # Mark as used to prevent replay
        db.execute("UPDATE verification_codes SET used = 1 WHERE id = ?", (row["id"],))
        return jsonify({"success": False, "message": "验证码错误"}), 401

    # Mark code as used
    db.execute("UPDATE verification_codes SET used = 1 WHERE id = ?", (row["id"],))

    # Find or create user (in transaction for race-condition safety)
    with db.transaction() as tx:
        user = tx.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
        if not user:
            # First user becomes admin
            count_row = tx.fetch_one("SELECT COUNT(*) as cnt FROM users")
            role = "admin" if (count_row and count_row["cnt"] == 0) else "user"
            now = _now_iso()
            tx.execute(
                "INSERT INTO users (email, role, created_at, last_login) VALUES (?, ?, ?, ?)",
                (email, role, now, now),
            )
            user = tx.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
        else:
            tx.execute(
                "UPDATE users SET last_login = ?, login_attempts = 0, locked_until = NULL WHERE id = ?",
                (_now_iso(), user["id"]),
            )
            user = tx.fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))

    # Regenerate session (prevent session fixation)
    session.clear()
    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session.permanent = True

    return jsonify({
        "success": True,
        "data": {
            "user": {
                "id": user["id"],
                "email": user["email"],
                "role": user["role"],
            }
        },
    })


@bp.post("/api/auth/logout")
def logout():
    """Clear session."""
    session.clear()
    return jsonify({"success": True, "message": "已登出"})


@bp.get("/api/auth/me")
def me():
    """Return current user info.

    Response shape (round 7, profile contract):
      { id, email, role, name, avatar, tier, created_at, last_login }

    The auth-disabled branch returns the SAME shape via
    `_serialize_user(synthetic_user_row)` so the wire shape stays
    in lockstep with the auth-enabled branch automatically — a
    future PR that adds a field to `_serialize_user` sees the new
    field propagate to both branches without a separate edit here.
    This is round-7's reviewer finding #2 fix; pre-fix the synthetic
    branch was a literal dict that drifted from `_serialize_user`
    silently (the next-added field would have shown for real users
    but not for the synthetic SAU_AUTH_ENABLED=false path).
    """
    if not _is_auth_enabled():
        # Synthetic users-row dict shaped like a real `users` row so
        # `_serialize_user` can read it via the same `.get(...)` +
        # fallback chain as the auth-enabled branch. Keeping the
        # field shape identical (not flattening to the response
        # shape) means future additions like `phone`, `locale`,
        # `bio` only need to be wired into `_serialize_user` and the
        # synthetic row's defaults — this branch auto-tracks.
        synthetic_user_row = {
            "id": 0,
            "email": "local@sau.dev",
            "role": "admin",
            # `local` matches the email local-part for dev
            # convenience — ProfilePage 显示名 row reads "local"
            # instead of "—" for SAU_AUTH_ENABLED=false runs.
            "name": "local",
            "avatar": None,
            "license_tier": "legacy",
            "created_at": _now_iso(),
            "last_login": _now_iso(),
        }
        return jsonify({
            "success": True,
            "data": {"user": _serialize_user(synthetic_user_row)},
        })

    uid = _current_user_id()
    if uid is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    db = get_database()
    user = db.fetch_one("SELECT * FROM users WHERE id = ?", (uid,))
    if not user:
        session.clear()
        return jsonify({"success": False, "message": "用户不存在"}), 401

    return jsonify({
        "success": True,
        "data": {
            "user": _serialize_user(user),
        },
    })


# ── Profile contract helpers (round 7) ───────────────────
#
# `_serialize_user` is the single source of truth for the
# `/api/auth/me` response shape. Both GET (line above) and PATCH
# (line below) reuse it so the wire contract stays consistent
# across read + write paths.


def _serialize_user(user: dict) -> dict:
    """Convert a `users` row dict into the `/api/auth/me` response shape.

    Pass-through keys: id, email, role, created_at, last_login.
    Derived / nullable keys:
      * `name` — raw `users.name` value or None (frontend uses
        `name ?? '—'` for the ProfilePage row).
      * `avatar` — raw `users.avatar` URL string or None. Frontend
        UserMenu renders <img src> when present, falls back to
        emailInitial glyph when None.
      * `tier` — coerced from `license_tier` (DB column) so the wire
        contract uses the consumer-facing key name regardless of the
        storage column. Defaults to 'legacy' if NULL (covers pre-
        tier-gating users who never had license_tier set).

    The `_serialize_user` indirection lets PATCH /api/auth/me
    return the freshly-updated row in the SAME shape as GET
    /api/auth/me, so the frontend's `onSuccess: invalidateQueries`
    flow sees a populated cache without a second GET round-trip.
    """
    return {
        "id": user["id"],
        "email": user["email"],
        "role": user["role"],
        "name": user.get("name"),
        "avatar": user.get("avatar"),
        "tier": user.get("license_tier") or "legacy",
        "created_at": user.get("created_at"),
        "last_login": user.get("last_login"),
    }


# PATCH /api/auth/me — partial-update profile contract (round 7).
#
# Mutates the authed user's own record. Rejects every field that
# could enable privilege escalation or impersonation:
#   * `role`, `tier`, `license_tier` — admin-only (= PUT /api/auth/
#     users/<id>/role / POST /api/auth/license/activate). Frontend
#     never sends these. PATCH silently dropping them would let a
#     misbehaving client think self-role-escalation worked; we
#     422 explicitly with a message so the bug surfaces loudly.
#   * `id`, `email` — identity-bound; cannot be changed via PATCH.
#     Email-change would require re-verification flow (out of scope).
#
# Mutable + validated:
#   * `name`   — non-empty stripped string OR null (clear),
#                 max 80 chars. Stored as-is; safe for the
#                 ProfilePage 显示名 row.
#   * `avatar` — http:// or https:// URL OR null (clear),
#                 max 2048 chars. Rejects javascript:, data:,
#                 file:, ftp:, and other scheme vectors. Stored
#                 as-is; UserMenu wraps in <img src>.
#
# Response: 200 with full updated user (via _serialize_user). 422
# on validation failure, 401 on auth-disabled-or-gone, 400 on
# empty payload.
#
# Auth gating: @login_required enforces session check (401 for
# missing session); the route always operates on the session's
# own uid (no path param), so a user can only PATCH their own
# record — no horizontal-privilege surface.

_ALLOWED_PATCH_FIELDS = frozenset({"name", "avatar"})

_FORBIDDEN_PATCH_FIELDS = frozenset({
    "role", "tier", "license_tier", "license_key",
    "id", "email", "created_at", "last_login",
})

_NAME_MAX_LEN = 80
_AVATAR_MAX_LEN = 2048

_AVATAR_ALLOWED_SCHEMES = ("http://", "https://")


@bp.patch("/api/auth/me")
@login_required
def update_me():
    """Partial update of the current user's profile (name, avatar)."""
    payload = request.get_json(silent=True) or {}

    # Mass-assignment guard: reject any forbidden key that the
    # client tries to PATCH. Frontend code never sends these
    # (the form only emits name + avatar), but a misconfigured
    # client could, so we 422 instead of silently dropping.
    forbidden_present = sorted(set(payload.keys()) & _FORBIDDEN_PATCH_FIELDS)
    if forbidden_present:
        return jsonify({
            "success": False,
            "message": f"不允许修改以下字段: {', '.join(forbidden_present)}",
        }), 422

    # Filter to the allowed set so an unknown key like
    # `displayName` (camelCase typo) is silently dropped —
    # additive tolerance is fine for forward-compat (frontend
    # can ship newer clients without backend deploy), but
    # mutation attempts get the explicit 422 above.
    fields = {k: v for k, v in payload.items() if k in _ALLOWED_PATCH_FIELDS}
    if not fields:
        return jsonify({
            "success": False,
            "message": "无更新字段，可修改字段: name, avatar",
        }), 400

    # Field-by-field validation. Each branch returns 422 with a
    # descriptive Chinese message matching the rest of auth.py's
    # tone.
    if "name" in fields:
        raw = fields["name"]
        if raw is None or (isinstance(raw, str) and raw.strip() == ""):
            # Explicit empty / null → clear the column. Lets the
            # frontend `ProfilePage 清除显示名` button reset to NULL
            # without a DELETE round-trip.
            fields["name"] = None
        elif not isinstance(raw, str):
            return jsonify({
                "success": False,
                "message": "name 必须是字符串",
            }), 422
        elif len(raw) > _NAME_MAX_LEN:
            return jsonify({
                "success": False,
                "message": f"name 长度不能超过 {_NAME_MAX_LEN} 个字符",
            }), 422
        else:
            fields["name"] = raw.strip()

    if "avatar" in fields:
        raw = fields["avatar"]
        if raw is None or (isinstance(raw, str) and raw.strip() == ""):
            fields["avatar"] = None
        elif not isinstance(raw, str):
            return jsonify({
                "success": False,
                "message": "avatar 必须是字符串 URL",
            }), 422
        elif len(raw) > _AVATAR_MAX_LEN:
            return jsonify({
                "success": False,
                "message": f"avatar URL 长度不能超过 {_AVATAR_MAX_LEN} 个字符",
            }), 422
        # Scheme allow-list. Blocks javascript:, data:, vbscript:,
        # file:, ftp: + any non-http(s) payload that UserMenu
        # would render as <img src={...}>. String.startswith
        # covers the prefix; the route keeps it simple against
        # the rodmap of common attack vectors (no URL parser
        # needed — if a future protocol gets added, extend
        # _AVATAR_ALLOWED_SCHEMES in lockstep).
        elif not any(raw.startswith(scheme) for scheme in _AVATAR_ALLOWED_SCHEMES):
            return jsonify({
                "success": False,
                "message": "avatar 必须以 http:// 或 https:// 开头",
            }), 422
        else:
            fields["avatar"] = raw.strip()

    db = get_database()
    uid = _current_user_id()

    # SQL identifier injection guard (round-7 reviewer finding):
    # `set_clause` interpolates the field name verbatim. While
    # `_ALLOWED_PATCH_FIELDS` is currently `{"name", "avatar"}`
    # (both SQL-safe identifiers), a future PR that extends the
    # frozenset with anything non-identifier-safe — e.g. an
    # accidental `"name; DROP TABLE users; --"` typo or a key from
    # an untrusted source — would turn this join into an injection
    # vector. Regex-gate each key against the SQL identifier
    # pattern ^[a-zA-Z_][a-zA-Z0-9_]*$ (matching
    # `_validate_savepoint_name` from db.py) before interpolating.
    # Reject the whole PATCH if ANY key fails — fail-loud beats
    # silent-skip.
    identifier_pattern = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    bad_keys = sorted(k for k in fields.keys() if not identifier_pattern.match(k))
    if bad_keys:
        return jsonify({
            "success": False,
            "message": f"非法字段名: {', '.join(bad_keys)}",
        }), 422

    set_clause = ", ".join(f"{k} = ?" for k in fields.keys())
    values = list(fields.values()) + [uid]
    db.execute(
        f"UPDATE users SET {set_clause} WHERE id = ?",
        tuple(values),
    )

    user = db.fetch_one("SELECT * FROM users WHERE id = ?", (uid,))
    if not user:
        # auth.py guarantee: session['user_id'] either matches a
        # real row or is None. If the row vanished (DBA action /
        # cascading delete), treat as 401 so the frontend clears
        # the auth store.
        session.clear()
        return jsonify({"success": False, "message": "用户不存在"}), 401

    return jsonify({
        "success": True,
        "data": {"user": _serialize_user(user)},
    })


@bp.get("/api/auth/users")
@admin_required
def list_users():
    """List all users (admin only)."""
    db = get_database()
    rows = db.fetch_all("SELECT id, email, role, created_at, last_login FROM users ORDER BY id")
    return jsonify({"success": True, "data": rows})


@bp.put("/api/auth/users/<int:user_id>/role")
@admin_required
def update_user_role(user_id: int):
    """Change a user's role (admin only)."""
    payload = request.get_json(silent=True) or {}
    new_role = payload.get("role")
    if new_role not in ("admin", "user"):
        return jsonify({"success": False, "message": "role 必须是 admin 或 user"}), 400

    db = get_database()
    user = db.fetch_one("SELECT id FROM users WHERE id = ?", (user_id,))
    if not user:
        return jsonify({"success": False, "message": "用户不存在"}), 404

    db.execute("UPDATE users SET role = ? WHERE id = ?", (new_role, user_id))
    return jsonify({"success": True})


@bp.get("/api/auth/sse-token")
@login_required
def get_sse_token():
    """Generate a one-time SSE authentication token."""
    if not _is_auth_enabled():
        # Auth disabled: return a synthetic token so the frontend can
        # still append ?sse_token=... to SSE URLs.  The token value is
        # never validated when auth is off (authenticate_sse_request
        # short-circuits to 0), so any placeholder works.
        return jsonify({
            "success": True,
            "data": {"token": "disabled", "expires_in": 86400},
        })

    db = get_database()
    user = db.fetch_one("SELECT email FROM users WHERE id = ?", (_current_user_id(),))
    if not user:
        return jsonify({"success": False, "message": "用户不存在"}), 401

    token = str(uuid.uuid4())
    now = _now_iso()
    db.execute(
        "INSERT INTO verification_codes (email, code, purpose, expires_at, used, created_at) "
        "VALUES (?, ?, 'sse', ?, 0, ?)",
        (user["email"], token, _expire_iso(300), now),
    )

    return jsonify({"success": True, "data": {"token": token, "expires_in": 300}})
