"""Authentication routes — email verification code login."""
from __future__ import annotations

import os
import re
import secrets
import smtplib
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import wraps

from flask import Blueprint, jsonify, request, session
from werkzeug.security import generate_password_hash, check_password_hash

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


def _current_user_is_founder() -> bool:
    """Return True if the current session's user is the project founder.

    Single source of truth: the persisted ``users.is_founder`` column.
    We deliberately do NOT cache founder status in ``session`` — a
    session cached at login time would make a founder transfer
    revocable only by force-relogin, leaking prior-founder privilege
    for the remainder of the cookie TTL (round ai-api-keys-founder
    reviewer finding #2 fix).

    Mirrors the `_is_auth_enabled()` → synthetic-admin convention
    used by other auth-aware helpers: when authentication is disabled,
    the synthetic admin user (id=0) is treated as the founder so
    dev/CI tooling can exercise the same code paths as a real
    founder without a session.

    Used by the ``founder_required`` decorator and by callers that
    need to gate write-side feature access (ai-keys, webhook
    secrets, etc.) before blasting a 403 to the client.
    """
    if not _is_auth_enabled():
        # Auth disabled → synthetic id=0 admin. Synthetic-admin is
        # implicitly founder for dev convenience so SAU_AUTH_ENABLED=false
        # CI runs don't trip on founder-gated writes.
        return True
    uid = _current_user_id()
    if uid is None:
        return False
    db = get_database()
    row = db.fetch_one("SELECT is_founder FROM users WHERE id = ?", (uid,))
    # PG returns bool (True/False); SQLite returns int (1/0). Both
    # are truthy/falsy under bool() so a single coercion handles
    # both backends; explicit get() fallback handles rows whose
    # is_founder column is NULL (legacy pre-migration users).
    raw_is_founder = (row or {}).get("is_founder")
    if raw_is_founder is None:
        return False
    return bool(raw_is_founder)


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


def founder_required(fn):
    """Decorator: reject non-founder requests with 403.

    Distinct from ``admin_required`` (broader role-gate covering the
    admin dashboard / user-list / audit-log surface). The founder
    gate is narrower — only the single project founder can mutate
    AI API keys, batch-import keys, list masked keys, or transfer
    founder status. Implemented as a separate decorator so the
    intent of the route is self-documenting at the call site, and
    so a future reviewer can grep ``@founder_required`` without
    also seeing the dozen admin-gated routes it's not meant to
    cover.

    Auth-disabled path: synthetic-admin counts as founder so dev /
    CI runs don't 403 on founder-gated writes (mirrors the same
    convention used by ``admin_required``).
    """

    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _is_auth_enabled():
            return fn(*args, **kwargs)
        if _current_user_id() is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        if not _current_user_is_founder():
            return jsonify({"success": False, "message": "仅项目创始人可执行此操作"}), 403
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
        "WHERE code = ? AND purpose = 'sse' AND used = FALSE AND expires_at > ?",
        (token, _now_iso()),
    )
    if row:
        # Mark token as used
        db.execute("UPDATE verification_codes SET used = TRUE WHERE id = ?", (row["id"],))
        # Look up user by email
        user = db.fetch_one("SELECT id FROM users WHERE email = ?", (row["email"],))
        if user:
            return user["id"]
    return None


# ── SMTP ───────────────────────────────────────────────────────────


def _render_verification_email(code: str, public_url: str) -> tuple[str, str]:
    """Build the (text/plain, text/html) pair for the verification-code email.

    Returns ``(plain, html)`` so the caller can hand both to
    ``_send_smtp_email`` which assembles them into a multipart/alternative
    envelope. The plain body is the fallback for clients without HTML
    rendering (rare on personal mail clients, common when forwarding
    through enterprise gateways or RSS-to-mail pipelines).

    Visual language mirrors `/login/auth` (LoginAuthPage.tsx):
      * cold-neutral canvas, hairline borders, sodium-amber accent
      * brand glyph `>_` rendered as monospace text in a dark chip
        (NO SVG / NO embedded PNG — these get filtered by Gmail App
        + 国产邮箱 + many corporate gateways)
      * IBM Plex Mono system-fallback font stack (web fonts are
        unreliable inside HTML email)
      * 420px max-width (matches the React card)

    Email-client pitfalls actively avoided (round-email-html-upgrade):
      * NO flexbox / grid — many Outlook desktop builds use the Word
        rendering engine and ignore modern layout primitives
      * NO CSS variables / no `oklch()` — needs hex everywhere, since
        ~70% of email clients strip ``<style>``-tag rules and never
        resolve nested custom properties
      * NO animation — `.brand-cursor` keyframe from `LoginAuthPage`
        does NOT translate; the underscore stays static here
      * NO ``opacity`` — many Outlook versions render alpha-laden
        text fully black; pre-mixed hex greys used instead
      * NO images for brand or code (clients strip by default)

    Sodium-amber choice: ``#d97706`` (Tailwind amber-600). The CSS-side
    ``oklch(0.55 0.17 45)`` token (`src/index.css`) is the sRGB
    equivalent at L=0.55 / C=0.17 / H=45, which is perceptually
    indistinguishable from ``#d97706``. amber-500 (#f59e0b) reads too
    bright on white backgrounds; amber-700 (#b45309) reads muddy. The
    600-step matches the brand's "warm but not loud" aesthetic.
    """
    plain = (
        f"您的登录验证码是：{code}\n\n"
        f"· 若丢失项目入口，请通过官网找回：{public_url}\n"
        f"· 验证码 5 分钟内有效，过期请重新获取\n"
        f"· 妥善保管，请勿告知任何人\n\n"
        f"— social-auto-upload"
    )
    # All hex colors are lockstep with `src/index.css` token
    # --primary (effective #d97706 in sRGB); see comment above.
    # Mono stack = same chain as `LoginAuthPage` so the visual reads
    # like a true twin of the in-app UI even when web fonts are
    # unavailable on the MUA side.
    mono = (
        "'IBM Plex Mono', ui-monospace, SFMono-Regular, "
        "Menlo, Monaco, Consolas, monospace"
    )
    sans = (
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
        "'IBM Plex Sans', 'PingFang SC', 'Hiragino Sans GB', "
        "'Microsoft YaHei', sans-serif"
    )
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:32px 16px; background-color:#fafafa; font-family:{sans}; -webkit-font-smoothing:antialiased; color:#1c1f22;">
  <!-- Inbox preheader (hidden). Gmail/Outlook render the body-opener as the
       inbox-list preview line; without this they show generic empty box.
       Standard preheader idiom: display:none + mso-hide:all (Outlook) +
       1px font + same color as canvas so even leaky renderers don't see text.
       Includes both the code AND the recovery URL so the preview carries
       the full breadcrumb — the recipient sees "verify + way back" before
       opening. -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#fafafa;opacity:0;">
     您的登录验证码是 {code}，5 分钟内有效。若丢失项目入口，请通过官网找回：{public_url}
  </div>
  <!-- Outlook padding trick: trailing invisible span with 20
       &nbsp;&zwnj; pairs. Outlook uses Word's renderer which would
       otherwise consume the visible <table> below as the preheader's
       continuation, pushing our message out of the preview window.
       The ZWNJ keeps the client from collapsing the embedded
       whitespace; the &nbsp; belt-and-suspenders any renderer that
       drops ZWNJ. -->
  <span style="display:none;">&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:420px; margin:0 auto; background-color:#ffffff; border:1px solid #e5e7eb; border-radius:8px;">
    <tr>
      <td style="padding:24px 24px 20px 24px; text-align:center; border-bottom:1px solid #f3f4f6;">
        <!-- Brand glyph chip. Uses single-cell table (NOT span+inline-block)
             because Outlook 2007–2016 (Word rendering engine) renders
             `display:inline-block` inconsistently — the chip reads as
             full-width with no padding. A nested <table>/<td> with the
             padding on the cell itself is the bullet-proof idiom. The
             cursor underscore is static here — `.brand-cursor` keyframe
             from `LoginAuthPage.tsx` doesn't translate to email clients. -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
          <tr>
            <td align="center" valign="middle" style="padding:3px 9px; background-color:#1c1f22; color:#ffffff; border-radius:3px; font-family:{mono}; font-size:14px; font-weight:600; line-height:1.4;">&gt;_</td>
          </tr>
        </table>
        <div style="margin-top:12px; font-family:{mono}; font-size:14px; color:#1c1f22; letter-spacing:0.02em;">sau@main</div>
      </td>
    </tr>
    <tr>
      <td style="padding:40px 32px 12px 32px; text-align:center;">
        <div style="font-size:13px; color:#5c6066; margin-bottom:20px; letter-spacing:0.04em;">您的登录验证码是</div>
        <!-- Code display. Round 2 sizing: 30px / letter-spacing:0.2em fits
             the 420px card with 32px×2 padding (= 356px content) AND the
             320px Gmail iOS viewport with 32px×2 (= 256px content).
             Pre-fix 36px + 0.3em overflowed narrow screens because
             `padding-left:0.3em` was added to compensate for trailing
             track, which inflated total visual width beyond content box.
             Centered `text-align:center` on the parent <td> handles the
             optical centering without the padding hack. -->
        <div style="font-family:{mono}; font-size:30px; font-weight:700; letter-spacing:0.2em; color:#d97706;">{code}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 32px 36px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px; color:#5c6066; line-height:1.6;">
          <tr>
            <td valign="top" style="width:18px; padding-top:1px; font-family:{mono}; color:#d97706; font-size:14px; line-height:1.6;">·</td>
            <td valign="top" style="padding-bottom:10px;">若丢失项目入口，请通过官网找回：<a href="{public_url}" style="color:#d97706; text-decoration:none; word-break:break-all;">{public_url}</a></td>
          </tr>
          <tr>
            <td valign="top" style="width:18px; padding-top:1px; font-family:{mono}; color:#d97706; font-size:14px; line-height:1.6;">·</td>
            <td valign="top" style="padding-bottom:10px;">验证码 5 分钟内有效，过期请重新获取</td>
          </tr>
          <tr>
            <td valign="top" style="width:18px; padding-top:1px; font-family:{mono}; color:#d97706; font-size:14px; line-height:1.6;">·</td>
            <td valign="top">妥善保管，请勿告知任何人</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px; text-align:center; background-color:#f9fafb; border-top:1px solid #f3f4f6; font-size:11px; color:#9ca0a6; font-family:{mono}; letter-spacing:0.02em;">
         social-auto-upload · identity verification
      </td>
    </tr>
  </table>
</body>
</html>"""
    return plain, html


def _public_url() -> str:
    """The user-facing project URL surfaced in transactional emails.

    Reads ``SAU_PUBLIC_URL`` so operators (production / staging deploys
    that have a real domain) can override it. The fallback of
    ``http://localhost:5180`` mirrors ``sau_web/start.sh``'s Vite default
    port so a fresh dev install gets a self-consistent loopback URL out
    of the box (no env wiring required).

    Purpose: when a user loses access to a saved project URL, the
    verification-code email IS the only durable breadcrumb back to the
    product. A local placeholder beats no URL — once the team ships a
    real domain, the env var swap is one line.

    FRONTEND MIRROR (do not break): the same default string is read by
    `sau_web/frontend/src/Pages/LoginAuthPage.tsx` via
    `import.meta.env.VITE_PUBLIC_URL ?? 'http://localhost:5180'`. Drift
    between the two would defeat the whole "in-app URL matches email
    URL" guarantee. If you change THIS string, change the TS fallback
    in lockstep (and the doc-string at the `PUBLIC_URL` constant) so a
    grep for "localhost:5180" finds both call sites.
    """
    return os.environ.get("SAU_PUBLIC_URL", "http://localhost:5180").rstrip("/")


def _send_smtp_email(
    to_email: str, subject: str, body: str, html_body: str | None = None
) -> tuple[bool, str]:
    """Send an email via SMTP. Returns ``(success, message)``.

    When ``html_body`` is supplied the message becomes a
    ``multipart/alternative`` envelope containing both the plain
    fallback (``body``) and the HTML version (``html_body``). MUA
    rendering rules choose: HTML-capable clients show the HTML;
    legacy / corporate / RSS-to-mail gateways fall back to plain.
    The plain body MUST always be the first part — RFC 2046 §5.1.4
    ordering invariant — so the fallback is reachable.

    When ``html_body`` is omitted the message stays a single
    ``text/plain`` ``MIMEText``. Backward-compatible with predround
    callers (test patches with positional 4-arg ``MagicMock``
    AutoArgs keep working without test churn).
    """
    # Dev bypass: SAU_MOCK_SMTP=true skips the real SMTP round-trip
    # and writes the rendered email to the backend log instead. Lets
    # an operator (or E2E browser test) read the verification code
    # from `tail -f .sau-logs/backend.log` without standing up MailHog
    # / a real SMTP server. The code is STILL persisted to
    # `verification_codes` (send_code INSERT runs before the email
    # send), so the dev user can read the code from the DB too.
    # Production never sets this; the env-var gate keeps it inert.
    #
    # Round-email-html-upgrade: when html_body is supplied we ALSO
    # persist it as `.sau-logs/mock_email_preview.html` so the dev
    # (or the browser-use E2E agent) can open it in a real browser
    # and visually verify the card layout matches LoginAuthPage. The
    # `.sau-logs/` directory is in `.gitignore`, so commit-time
    # hygiene is automatic.
    if os.environ.get("SAU_MOCK_SMTP", "").lower() == "true":
        _task_logger.info(
            f"[MOCK SMTP] to={to_email!r} subject={subject!r}\n{body}"
        )
        # Whitespace-only html_body still counts as truthy under a bare
        # `if html_body:` check; tightening to `and html_body.strip()`
        # avoids accidentally sending an empty-html multipart envelope.
        if html_body and html_body.strip():
            try:
                # Hardcode .sau-logs path (matches `.gitignore`'d run-log
                # directory used by `sau_web/start.sh`). `pathlib`-aware
                # dirname juggling was dead code — `os.makedirs` directly
                # on the scalar string is cleaner.
                os.makedirs(".sau-logs", exist_ok=True)
                preview_path = ".sau-logs/mock_email_preview.html"
                with open(preview_path, "w", encoding="utf-8") as f:
                    f.write(html_body)
                _task_logger.info(
                    f"[MOCK SMTP] HTML preview written: {preview_path}"
                )
            except OSError as exc:
                # Disk full / read-only FS — multimodal render is a
                # developer convenience, not a critical path. Log
                # loud-but-non-fatal so dev still gets the .log entry.
                _task_logger.warning(
                    f"[MOCK SMTP] HTML preview write skipped: {exc}"
                )
        return True, "已发送 (mock)"

    host = os.environ.get("SAU_SMTP_HOST")
    port = int(os.environ.get("SAU_SMTP_PORT", "465"))
    user = os.environ.get("SAU_SMTP_USER")
    password = os.environ.get("SAU_SMTP_PASS")
    from_addr = os.environ.get("SAU_SMTP_FROM", user)

    if not all([host, user, password]):
        return False, "邮件服务未配置"

    if html_body:
        # multipart/alternative — RFC 2046 §5.1.4: text/plain MUST be
        # the first part. The MUA walks parts bottom-up and renders
        # the LAST format it understands; placing plain first means
        # a stripped-MUA still sees the readable fallback. Inverse
        # ordering breaks Outlook web (which trims parts >2 in
        # legacy compatibility mode).
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to_email
        msg.attach(MIMEText(body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
    else:
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
        "VALUES (?, ?, 'login', ?, FALSE, ?)",
        (email, code, _expire_iso(300), now),
    )

    # Send email. The body is plain-text ASCII + CJK + a hand-curated
    # bullet glyph (·, U+00B7) which renders in 100% of MUA fonts that
    # already render Chinese glyphs. NO HTML: keeping the body as plain
    # text avoids the MIMEMultipart/SMTP body-folding gotcha where
    # some transports drop the text/plain alternative or garble CJK
    # in multipart, AND keeps the user's copy-paste breadcrumb (the
    # URL line) trivially selectable. The two-stage flow visual is
    # handled in frontend (/login → /login/auth), not in mail.
    #
    # The URL line is the durable recovery hint: if a user deletes
    # bookmarks / local config / etc., the verification-code email is
    # the one piece of mail they retained. Surfacing the project URL
    # there turns it into a low-cost "way back" link.
    public_url = _public_url()
    # Delegate the (text, html) pair to `_render_verification_email`
    # so this route stays at "send the email" concern level and the
    # template can be swapped / previewed in isolation. Round
    # -email-html-upgrade: the HTML twin mirrors `/login/auth`
    # (LoginAuthPage.tsx)'s sodium-amber accent + `>_` brand glyph
    # + 420px card, with hex-only inline styling that survives
    # Gmail / Outlook / 国产邮箱 clients.
    plain_body, html_body = _render_verification_email(code, public_url)
    ok, msg = _send_smtp_email(email, "登录验证码", plain_body, html_body)
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
        "WHERE email = ? AND purpose = 'login' AND used = TRUE AND created_at > ?",
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
        "WHERE email = ? AND purpose = 'login' AND used = FALSE AND expires_at > ? "
        "ORDER BY created_at DESC LIMIT 1",
        (email, _now_iso()),
    )
    if not row:
        return jsonify({"success": False, "message": "验证码已过期，请重新获取"}), 401
    if row["code"] != code:
        # Mark as used to prevent replay
        db.execute("UPDATE verification_codes SET used = TRUE WHERE id = ?", (row["id"],))
        return jsonify({"success": False, "message": "验证码错误"}), 401

    # Mark code as used
    db.execute("UPDATE verification_codes SET used = TRUE WHERE id = ?", (row["id"],))

    # Find or create user (in transaction for race-condition safety)
    with db.transaction() as tx:
        user = tx.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
        if not user:
            # First user becomes admin AND founder (ai-api-keys-founder):
            # mirrors the cold-start founder rule documented in
            # docs/ai-api-keys-founder.md. ``init_db``'s backfill
            # only fires when ``EXISTS (SELECT 1 FROM users)`` is
            # true — i.e. on a fresh DB with no users, the backfill
            # skips. So the first login is the single boots-trap
            # moment: without this INSERT-time is_founder=True, a
            # fresh deploy ends up admin-but-not-founder until
            # manual DB intervention.
            count_row = tx.fetch_one("SELECT COUNT(*) as cnt FROM users")
            is_first_user = bool(count_row and count_row["cnt"] == 0)
            role = "admin" if is_first_user else "user"
            now = _now_iso()
            tx.execute(
                "INSERT INTO users (email, role, created_at, last_login, is_founder) "
                "VALUES (?, ?, ?, ?, ?)",
                (email, role, now, now, is_first_user),
            )
            user = tx.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
        else:
            tx.execute(
                "UPDATE users SET last_login = ?, login_attempts = 0, locked_until = NULL WHERE id = ?",
                (_now_iso(), user["id"]),
            )
            user = tx.fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))

    # Regenerate session (prevent session fixation). We deliberately
    # do NOT cache ``is_founder`` in the session — see
    # ``_current_user_is_founder`` for the rationale (DB is the
    # single source of truth so a founder transfer takes effect on
    # the very next request without forcing a re-login).
    session.clear()
    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session.permanent = True

    return jsonify({
        "success": True,
        "data": {
            "user": _serialize_user(user),
        },
    })


@bp.post("/api/auth/logout")
def logout():
    """Clear session."""
    session.clear()
    return jsonify({"success": True, "message": "已登出"})


@bp.post("/api/auth/dev-login")
def dev_login():
    """Dev-only: 直接登录指定用户，跳过验证码。仅在 DEBUG_MODE 下可用。"""
    try:
        from conf import DEBUG_MODE
    except ImportError:
        DEBUG_MODE = False

    if not DEBUG_MODE:
        return jsonify({"success": False, "message": "仅开发模式可用"}), 403

    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()

    if not email:
        return jsonify({"success": False, "message": "邮箱不能为空"}), 400

    db = get_database()
    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user:
        return jsonify({"success": False, "message": "用户不存在"}), 404

    # 直接创建会话
    session.clear()
    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session.permanent = True

    # 更新最后登录时间
    db.execute("UPDATE users SET last_login = ? WHERE id = ?", (_now_iso(), user["id"]))

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


@bp.get("/api/auth/me")
def me():
    """Return current user info.

    Verification helper: set ``SAU_AUTH_ME_DELAY=<seconds>`` to make this
    endpoint sleep before responding. Used by the browser-use skeleton-
    frame capture flow in dev — a 4s delay gives the React
    ``AuthLoadingSkeleton`` enough exposure to screenshot the chrome +
    sketched content area + verify the aria-hidden contract. Zero
    impact when unset (default 0 = no sleep). Production never sets it.

    Response shape (round 7, profile contract):
      { id, email, role, name, avatar, tier, created_at, last_login }

    The auth-disabled branch returns the SAME shape via
    `_serialize_user(synthetic_user_row)` so the wire shape stays
    in lockstep with the auth-enabled branch automatically — a
    future PR that adds a field to `_serialize_user` sees the new
    field propagate to both branches without a separate edit here.
    This is round-7's reviewer finding #2 fix; pre-fix the synthetic
    branch was a literal dict that drifted from `_serialize_user`
    silently (the next-added field would have shown for real users      but not for the synthetic SAU_AUTH_ENABLED=false path).
    """
    _me_delay = float(os.environ.get("SAU_AUTH_ME_DELAY", "0") or "0")
    if _me_delay > 0:
        time.sleep(_me_delay)

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
    out: dict = {
        "id": user["id"],
        "email": user["email"],
        "role": user["role"],
        "name": user.get("name"),
        "avatar": user.get("avatar"),
        "tier": user.get("license_tier") or "legacy",
        "created_at": user.get("created_at"),
        "last_login": user.get("last_login"),
    }
    # Founder status (ai-api-keys-founder feature): surfaced on
    # /api/auth/me so the frontend can render founder-specific UI
    # surfaces (AI sidebar key-management popover, transfer card
    # in /dashboard/admin/users) without a separate round-trip.
    # Backend storage is mixed (PG: bool, SQLite: int 0/1); both
    # pass cleanly through ``bool()``. Always emit the key (even
    # when False) so the wire shape stays stable for a frontend
    # that does ``u.is_founder ?? false`` instead of probing for
    # the key's presence.
    out["is_founder"] = bool(user.get("is_founder"))
    out["has_password"] = bool(user.get("password_hash"))
    return out


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
    rows = db.fetch_all(
        "SELECT id, email, role, COALESCE(license_tier, 'legacy') AS tier, created_at, last_login "
        "FROM users ORDER BY id"
    )
    return jsonify({"success": True, "data": rows})


@bp.put("/api/auth/users/<int:user_id>/role")
@admin_required
def update_user_role(user_id: int):
    """Change a user's role (admin only).

    Prevents self-demotion (an admin cannot downgrade themselves).
    """
    payload = request.get_json(silent=True) or {}
    new_role = payload.get("role")
    if new_role not in ("admin", "user"):
        return jsonify({"success": False, "message": "role 必须是 admin 或 user"}), 400

    current_admin_id = session.get("user_id")
    if current_admin_id == user_id:
        return jsonify({"success": False, "message": "不能修改自己的角色"}), 403

    db = get_database()
    user = db.fetch_one("SELECT id, role, email FROM users WHERE id = ?", (user_id,))
    if not user:
        return jsonify({"success": False, "message": "用户不存在"}), 404

    old_role = user["role"]
    if old_role == new_role:
        return jsonify({"success": False, "message": "新角色与当前角色相同"}), 400

    db.execute("UPDATE users SET role = ? WHERE id = ?", (new_role, user_id))

    # Write audit log
    import json
    now = _now_iso()
    db.execute(
        "INSERT INTO admin_audit_log (admin_user_id, target_user_id, action, detail, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (
            current_admin_id,
            user_id,
            "role_change",
            json.dumps({"old_role": old_role, "new_role": new_role}),
            now,
        ),
    )

    return jsonify({
        "success": True,
        "data": {
            "id": user_id,
            "role": new_role,
            "email": user["email"],
        },
    })


# ── Password authentication ─────────────────────────────────────────

_PASSWORD_MIN_LEN = 8


def _validate_password(password: str) -> str | None:
    """Validate password strength. Returns error message or None."""
    if len(password) < _PASSWORD_MIN_LEN:
        return f"密码长度不能少于 {_PASSWORD_MIN_LEN} 位"
    if not re.search(r"[a-zA-Z]", password):
        return "密码必须包含字母"
    if not re.search(r"\d", password):
        return "密码必须包含数字"
    return None


@bp.post("/api/auth/set-password")
@login_required
def set_password():
    """Set password for the first time (only when password_hash is NULL)."""
    payload = request.get_json(silent=True) or {}
    password = (payload.get("password") or "").strip()

    if not password:
        return jsonify({"success": False, "message": "密码不能为空"}), 400

    err = _validate_password(password)
    if err:
        return jsonify({"success": False, "message": err}), 400

    db = get_database()
    uid = _current_user_id()
    user = db.fetch_one("SELECT password_hash FROM users WHERE id = ?", (uid,))
    if not user:
        session.clear()
        return jsonify({"success": False, "message": "用户不存在"}), 401

    if user.get("password_hash"):
        return jsonify({"success": False, "message": "密码已设置，请使用修改密码功能"}), 400

    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(password), uid),
    )
    return jsonify({"success": True, "message": "密码设置成功"})


@bp.post("/api/auth/change-password")
@login_required
def change_password():
    """Change password (requires old password verification)."""
    payload = request.get_json(silent=True) or {}
    old_password = (payload.get("old_password") or "").strip()
    new_password = (payload.get("new_password") or "").strip()

    if not old_password or not new_password:
        return jsonify({"success": False, "message": "旧密码和新密码不能为空"}), 400

    err = _validate_password(new_password)
    if err:
        return jsonify({"success": False, "message": err}), 400

    db = get_database()
    uid = _current_user_id()
    user = db.fetch_one("SELECT password_hash FROM users WHERE id = ?", (uid,))
    if not user:
        session.clear()
        return jsonify({"success": False, "message": "用户不存在"}), 401

    if not user.get("password_hash"):
        return jsonify({"success": False, "message": "尚未设置密码，请先设置密码"}), 400

    if not check_password_hash(user["password_hash"], old_password):
        return jsonify({"success": False, "message": "旧密码错误"}), 401

    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(new_password), uid),
    )
    return jsonify({"success": True, "message": "密码修改成功"})


@bp.post("/api/auth/login-by-password")
def login_by_password():
    """Login with email and password."""
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = (payload.get("password") or "").strip()

    if not email or not _EMAIL_RE.match(email):
        return jsonify({"success": False, "message": "邮箱格式不正确"}), 400
    if not password:
        return jsonify({"success": False, "message": "密码不能为空"}), 400

    db = get_database()

    # Check if account is locked
    user_row = db.fetch_one(
        "SELECT id, locked_until FROM users WHERE email = ?", (email,)
    )
    if user_row and user_row.get("locked_until"):
        if user_row["locked_until"] > _now_iso():
            return jsonify({"success": False, "message": "账号已锁定，请稍后重试"}), 429

    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user:
        return jsonify({"success": False, "message": "邮箱或密码错误"}), 401

    if not user.get("password_hash"):
        return jsonify({"success": False, "message": "尚未设置密码，请使用验证码登录"}), 401

    if not check_password_hash(user["password_hash"], password):
        # Increment login attempts
        attempts = (user.get("login_attempts") or 0) + 1
        if attempts >= 5:
            lock_until = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(timespec="seconds")
            db.execute(
                "UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?",
                (attempts, lock_until, user["id"]),
            )
            return jsonify({"success": False, "message": "登录尝试次数过多，请 30 分钟后重试"}), 429
        db.execute(
            "UPDATE users SET login_attempts = ? WHERE id = ?",
            (attempts, user["id"]),
        )
        return jsonify({"success": False, "message": "邮箱或密码错误"}), 401

    # Success — reset attempts and update last_login
    db.execute(
        "UPDATE users SET last_login = ?, login_attempts = 0, locked_until = NULL WHERE id = ?",
        (_now_iso(), user["id"]),
    )
    user = db.fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))

    # Regenerate session
    session.clear()
    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session.permanent = True

    return jsonify({
        "success": True,
        "data": {"user": _serialize_user(user)},
    })


@bp.post("/api/auth/forgot-password")
def forgot_password():
    """Send a reset-password code to the specified email."""
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()

    if not email or not _EMAIL_RE.match(email):
        return jsonify({"success": False, "message": "邮箱格式不正确"}), 400

    db = get_database()

    # Check user exists
    user = db.fetch_one("SELECT id FROM users WHERE email = ?", (email,))
    if not user:
        # Return success even if user not found (don't leak existence)
        return jsonify({"success": True, "message": "如果该邮箱已注册，重置码已发送"})

    # Cleanup expired codes for this email
    db.execute(
        "DELETE FROM verification_codes WHERE email = ? AND expires_at < ? AND purpose = 'reset_password'",
        (email, _now_iso()),
    )

    # Rate limit: 60s cooldown
    recent = db.fetch_one(
        "SELECT created_at FROM verification_codes "
        "WHERE email = ? AND purpose = 'reset_password' AND created_at > ? "
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
        "VALUES (?, ?, 'reset_password', ?, FALSE, ?)",
        (email, code, _expire_iso(300), now),
    )

    # Send email
    public_url = _public_url()
    plain_body = (
        f"您的密码重置验证码是：{code}\n\n"
        f"· 若非本人操作，请忽略此邮件\n"
        f"· 验证码 5 分钟内有效，过期请重新获取\n\n"
        f"— social-auto-upload"
    )
    ok, msg = _send_smtp_email(email, "密码重置验证码", plain_body)
    if ok:
        return jsonify({"success": True, "message": "如果该邮箱已注册，重置码已发送"})
    return jsonify({"success": False, "message": msg}), 500


@bp.post("/api/auth/reset-password")
def reset_password():
    """Verify reset code and set new password."""
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    code = (payload.get("code") or "").strip()
    new_password = (payload.get("new_password") or "").strip()

    if not email or not _EMAIL_RE.match(email):
        return jsonify({"success": False, "message": "邮箱格式不正确"}), 400
    if not code or len(code) != 6 or not code.isdigit():
        return jsonify({"success": False, "message": "验证码格式不正确"}), 400
    if not new_password:
        return jsonify({"success": False, "message": "新密码不能为空"}), 400

    err = _validate_password(new_password)
    if err:
        return jsonify({"success": False, "message": err}), 400

    db = get_database()

    # Find the latest unused, non-expired reset code
    row = db.fetch_one(
        "SELECT id, code FROM verification_codes "
        "WHERE email = ? AND purpose = 'reset_password' AND used = FALSE AND expires_at > ? "
        "ORDER BY created_at DESC LIMIT 1",
        (email, _now_iso()),
    )
    if not row:
        return jsonify({"success": False, "message": "验证码已过期，请重新获取"}), 401
    if row["code"] != code:
        db.execute("UPDATE verification_codes SET used = TRUE WHERE id = ?", (row["id"],))
        return jsonify({"success": False, "message": "验证码错误"}), 401

    # Mark code as used
    db.execute("UPDATE verification_codes SET used = TRUE WHERE id = ?", (row["id"],))

    # Find user
    user = db.fetch_one("SELECT id FROM users WHERE email = ?", (email,))
    if not user:
        return jsonify({"success": False, "message": "用户不存在"}), 404

    # Update password
    db.execute(
        "UPDATE users SET password_hash = ?, login_attempts = 0, locked_until = NULL WHERE id = ?",
        (generate_password_hash(new_password), user["id"]),
    )
    return jsonify({"success": True, "message": "密码重置成功"})


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
        "VALUES (?, ?, 'sse', ?, FALSE, ?)",
        (user["email"], token, _expire_iso(300), now),
    )

    return jsonify({"success": True, "data": {"token": token, "expires_in": 300}})
