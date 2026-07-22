"""Minimal authentication routes for the modular web shell.

Supports two modes (env ``SAU_AUTH_ENABLED``):

* ``false`` (default for local ``sau_web/start.sh``) — every privileged
  check is bypassed and ``GET /api/auth/me`` returns a synthetic local
  admin so the React ``AuthGuard`` can pass without SMTP / user tables.
* ``true`` — session-based email verification-code login against the
  SQLite ``users`` / ``verification_codes`` tables created by ``init_db``.

This is intentionally smaller than the freebuff/product auth surface
(OAuth, founder transfer, license). Those land when the full product
backend is merged; this module only unblocks the SPA shell on mainline.
"""
from __future__ import annotations

import os
import re
import secrets
import smtplib
import time
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from functools import wraps

from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from utils.log import logger as _task_logger
from web_runner.db import db_lock, get_connection

bp = Blueprint("auth", __name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CODE_TTL_MINUTES = 10
_CODE_LENGTH = 6


def _is_auth_enabled() -> bool:
    # Default OFF for local CLI Web Shell (matches sau_web/start.sh).
    # Set SAU_AUTH_ENABLED=true to require multi-user session login.
    return os.environ.get("SAU_AUTH_ENABLED", "false").lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _current_user_id() -> int | None:
    return session.get("user_id")


def _serialize_user(user: dict) -> dict:
    """Wire shape for ``/api/auth/me`` (matches frontend ``AuthUser``)."""
    return {
        "id": user.get("id", 0),
        "email": user.get("email") or "",
        "role": user.get("role") or "user",
        "name": user.get("name"),
        "avatar": user.get("avatar"),
        "tier": user.get("license_tier") or user.get("tier") or "legacy",
        "created_at": user.get("created_at"),
        "last_login": user.get("last_login"),
        "is_founder": bool(user.get("is_founder")),
        "has_password": bool(user.get("password_hash")),
        "notify_health_email": bool(user.get("notify_health_email", False)),
        "notify_health_webhook": bool(user.get("notify_health_webhook", False)),
    }


def _synthetic_user() -> dict:
    now = _now_iso()
    return {
        "id": 0,
        "email": "local@sau.dev",
        "role": "admin",
        "name": "local",
        "avatar": None,
        "license_tier": "legacy",
        "created_at": now,
        "last_login": now,
        "is_founder": True,
        "password_hash": None,
        "notify_health_email": False,
        "notify_health_webhook": False,
    }


def login_required(fn):
    """Decorator: 401 unless session has a user (or auth is disabled)."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _is_auth_enabled():
            return fn(*args, **kwargs)
        if _current_user_id() is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        return fn(*args, **kwargs)

    return wrapper


def _fetch_user(user_id: int) -> dict | None:
    with db_lock:
        with get_connection() as conn:
            conn.row_factory = __import__("sqlite3").Row
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None


def _fetch_user_by_email(email: str) -> dict | None:
    with db_lock:
        with get_connection() as conn:
            conn.row_factory = __import__("sqlite3").Row
            row = conn.execute(
                "SELECT * FROM users WHERE email = ?", (email.lower().strip(),)
            ).fetchone()
            return dict(row) if row else None


def _send_email(to_email: str, subject: str, body: str) -> bool:
    host = os.environ.get("SAU_SMTP_HOST", "")
    port = int(os.environ.get("SAU_SMTP_PORT", "587") or 587)
    user = os.environ.get("SAU_SMTP_USER", "")
    password = os.environ.get("SAU_SMTP_PASSWORD", "")
    from_addr = os.environ.get("SAU_SMTP_FROM", user or "noreply@sau.local")
    if not host:
        _task_logger.warning(f"[auth] SMTP not configured; code for {to_email}: {body}")
        return True  # dev: log-only is "success"
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to_email
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            if user and password:
                smtp.login(user, password)
            smtp.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException) as exc:
        _task_logger.error(f"[auth] SMTP failed: {type(exc).__name__}: {exc}")
        return False


@bp.get("/api/auth/me")
def me():
    if not _is_auth_enabled():
        return jsonify({"success": True, "data": {"user": _serialize_user(_synthetic_user())}})

    uid = _current_user_id()
    if uid is None:
        return jsonify({"success": False, "message": "未登录"}), 401
    user = _fetch_user(uid)
    if not user:
        session.clear()
        return jsonify({"success": False, "message": "用户不存在"}), 401
    return jsonify({"success": True, "data": {"user": _serialize_user(user)}})


@bp.patch("/api/auth/me")
@login_required
def update_me():
    if not _is_auth_enabled():
        return jsonify({"success": True, "data": {"user": _serialize_user(_synthetic_user())}})

    uid = _current_user_id()
    assert uid is not None
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", ...)
    avatar = payload.get("avatar", ...)

    sets: list[str] = []
    vals: list = []
    if name is not ...:
        if name is not None and not isinstance(name, str):
            return jsonify({"success": False, "message": "name 必须是字符串"}), 422
        if isinstance(name, str) and len(name) > 64:
            return jsonify({"success": False, "message": "name 过长"}), 422
        sets.append("name = ?")
        vals.append(name if name else None)
    if avatar is not ...:
        if avatar is not None and not isinstance(avatar, str):
            return jsonify({"success": False, "message": "avatar 必须是字符串"}), 422
        sets.append("avatar = ?")
        vals.append(avatar if avatar else None)
    if sets:
        vals.append(uid)
        with db_lock:
            with get_connection() as conn:
                conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", vals)
                conn.commit()
    user = _fetch_user(uid)
    return jsonify({"success": True, "data": {"user": _serialize_user(user or {})}})


@bp.post("/api/auth/send-code")
def send_code():
    if not _is_auth_enabled():
        return jsonify({"success": True, "message": "认证已关闭（本地模式）"})

    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    if not _EMAIL_RE.match(email):
        return jsonify({"success": False, "message": "邮箱格式无效"}), 400

    code = "".join(secrets.choice("0123456789") for _ in range(_CODE_LENGTH))
    expires = (datetime.now(timezone.utc) + timedelta(minutes=_CODE_TTL_MINUTES)).replace(
        tzinfo=None
    ).isoformat(timespec="seconds")
    with db_lock:
        with get_connection() as conn:
            conn.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
            conn.execute(
                "INSERT INTO verification_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)",
                (email, code, expires, _now_iso()),
            )
            conn.commit()

    ok = _send_email(email, "SAU 登录验证码", f"您的验证码是 {code}，{ _CODE_TTL_MINUTES } 分钟内有效。")
    if not ok:
        return jsonify({"success": False, "message": "邮件发送失败，请检查 SMTP 配置"}), 503
    return jsonify({"success": True, "message": "验证码已发送"})


@bp.post("/api/auth/login")
def login():
    if not _is_auth_enabled():
        return jsonify({"success": True, "data": {"user": _serialize_user(_synthetic_user())}})

    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    code = (payload.get("code") or "").strip()
    if not _EMAIL_RE.match(email) or not code:
        return jsonify({"success": False, "message": "邮箱与验证码必填"}), 400

    with db_lock:
        with get_connection() as conn:
            conn.row_factory = __import__("sqlite3").Row
            row = conn.execute(
                "SELECT * FROM verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1",
                (email,),
            ).fetchone()
            if not row or row["code"] != code:
                return jsonify({"success": False, "message": "验证码错误"}), 400
            if row["expires_at"] < _now_iso():
                return jsonify({"success": False, "message": "验证码已过期"}), 400
            conn.execute("DELETE FROM verification_codes WHERE email = ?", (email,))

            user_row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            now = _now_iso()
            if user_row is None:
                # First user becomes admin.
                count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
                role = "admin" if count == 0 else "user"
                is_founder = 1 if count == 0 else 0
                cur = conn.execute(
                    "INSERT INTO users (email, role, name, created_at, last_login, is_founder) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (email, role, email.split("@")[0], now, now, is_founder),
                )
                user_id = cur.lastrowid
            else:
                user_id = user_row["id"]
                conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (now, user_id))
            conn.commit()

    user = _fetch_user(int(user_id))
    session["user_id"] = int(user_id)
    session.permanent = True
    return jsonify({"success": True, "data": {"user": _serialize_user(user or {})}})


@bp.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"success": True, "message": "已退出"})


@bp.post("/api/auth/login-by-password")
def login_by_password():
    if not _is_auth_enabled():
        return jsonify({"success": True, "data": {"user": _serialize_user(_synthetic_user())}})

    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    user = _fetch_user_by_email(email)
    if not user or not user.get("password_hash"):
        return jsonify({"success": False, "message": "邮箱或密码错误"}), 401
    if not check_password_hash(user["password_hash"], password):
        return jsonify({"success": False, "message": "邮箱或密码错误"}), 401
    session["user_id"] = user["id"]
    session.permanent = True
    with db_lock:
        with get_connection() as conn:
            conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (_now_iso(), user["id"]))
            conn.commit()
    return jsonify({"success": True, "data": {"user": _serialize_user(user)}})


@bp.post("/api/auth/set-password")
@login_required
def set_password():
    if not _is_auth_enabled():
        return jsonify({"success": True, "message": "本地模式无需设置密码"})
    uid = _current_user_id()
    payload = request.get_json(silent=True) or {}
    password = payload.get("password") or ""
    if len(password) < 8:
        return jsonify({"success": False, "message": "密码至少 8 位"}), 400
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (generate_password_hash(password), uid),
            )
            conn.commit()
    return jsonify({"success": True, "message": "密码已设置"})


@bp.post("/api/auth/change-password")
@login_required
def change_password():
    if not _is_auth_enabled():
        return jsonify({"success": True, "message": "本地模式无需改密"})
    uid = _current_user_id()
    payload = request.get_json(silent=True) or {}
    old_pw = payload.get("old_password") or ""
    new_pw = payload.get("new_password") or ""
    user = _fetch_user(uid) if uid else None
    if not user or not user.get("password_hash"):
        return jsonify({"success": False, "message": "尚未设置密码"}), 400
    if not check_password_hash(user["password_hash"], old_pw):
        return jsonify({"success": False, "message": "原密码错误"}), 400
    if len(new_pw) < 8:
        return jsonify({"success": False, "message": "新密码至少 8 位"}), 400
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (generate_password_hash(new_pw), uid),
            )
            conn.commit()
    return jsonify({"success": True, "message": "密码已更新"})


@bp.post("/api/auth/forgot-password")
def forgot_password():
    # Reuse verification-code path; frontend then calls reset-password.
    return send_code()


@bp.post("/api/auth/reset-password")
def reset_password():
    if not _is_auth_enabled():
        return jsonify({"success": True, "message": "本地模式无需重置"})
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    code = (payload.get("code") or "").strip()
    new_pw = payload.get("new_password") or ""
    if len(new_pw) < 8:
        return jsonify({"success": False, "message": "新密码至少 8 位"}), 400
    with db_lock:
        with get_connection() as conn:
            conn.row_factory = __import__("sqlite3").Row
            row = conn.execute(
                "SELECT * FROM verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1",
                (email,),
            ).fetchone()
            if not row or row["code"] != code:
                return jsonify({"success": False, "message": "验证码错误"}), 400
            if row["expires_at"] < _now_iso():
                return jsonify({"success": False, "message": "验证码已过期"}), 400
            user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if not user:
                return jsonify({"success": False, "message": "用户不存在"}), 404
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (generate_password_hash(new_pw), user["id"]),
            )
            conn.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
            conn.commit()
    return jsonify({"success": True, "message": "密码已重置"})


@bp.get("/api/auth/sse-token")
def sse_token():
    if not _is_auth_enabled():
        return jsonify(
            {"success": True, "data": {"token": "local-dev", "expires_in": 3600}}
        )
    if _current_user_id() is None:
        return jsonify({"success": False, "message": "未登录"}), 401
    token = secrets.token_urlsafe(24)
    return jsonify({"success": True, "data": {"token": token, "expires_in": 3600}})


@bp.get("/api/auth/users")
@login_required
def list_users():
    if not _is_auth_enabled():
        return jsonify({"success": True, "data": [_serialize_user(_synthetic_user())]})
    with db_lock:
        with get_connection() as conn:
            conn.row_factory = __import__("sqlite3").Row
            rows = conn.execute("SELECT * FROM users ORDER BY id ASC").fetchall()
            data = [_serialize_user(dict(r)) for r in rows]
    return jsonify({"success": True, "data": data})


@bp.put("/api/auth/users/<int:user_id>/role")
@login_required
def update_user_role(user_id: int):
    if not _is_auth_enabled():
        return jsonify({"success": True, "message": "本地模式忽略角色变更"})
    payload = request.get_json(silent=True) or {}
    role = payload.get("role")
    if role not in ("admin", "user"):
        return jsonify({"success": False, "message": "role 必须是 admin 或 user"}), 400
    caller = _fetch_user(_current_user_id() or -1)
    if not caller or caller.get("role") != "admin":
        return jsonify({"success": False, "message": "需要管理员权限"}), 403
    with db_lock:
        with get_connection() as conn:
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
            conn.commit()
    return jsonify({"success": True, "message": "角色已更新"})
