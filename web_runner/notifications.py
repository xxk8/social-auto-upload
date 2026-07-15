"""Webhook notifications (openspec/changes/webhook-notifications).

Event bus + platform adapters that push upload / system events to
Feishu / DingTalk / WeWork / custom webhooks, plus the in-app
notification store. Designed to integrate with the existing
dialect-agnostic DB layer (web_runner.db) and the existing SSE
infrastructure (web_runner.utils._progress_subscribers).

The single result-decision point is ``web_runner.utils._run_sau``;
``emit_event`` is called from its success/failure/error branches.
``cookie.expired`` is emitted from the ``check`` path instead.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import queue
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from web_runner.db import get_database

# Reuse the existing logger so notification logs land in the same stream.
from utils.log import logger as _log

# ── Event bus ────────────────────────────────────────────────────────────
_event_queue: "queue.Queue[UploadEvent]" = queue.Queue()
_worker_started = False
_worker_lock = threading.Lock()

# SSE subscribers for the in-app notification center. Mirrors the
# _progress_subscribers pattern in web_runner.utils (shared 5-conn cap is
# enforced at the route layer, not here).
_notification_subscribers: dict[str, list[queue.Queue]] = {}
_notification_sub_lock = threading.Lock()

# In-process rate-limit token buckets, keyed by channel url.
_rate_limit_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}

DEFAULT_RATE_LIMIT = 20          # deliveries per window per channel
DEFAULT_AGG_WINDOW = 60          # seconds


@dataclass
class UploadEvent:
    """Structured notification event emitted at a single decision point."""

    event_type: str               # upload.success | upload.failed | cookie.expired | system.webhook_failed
    task_id: str | None = None
    platform: str = ""
    account: str = ""
    title: str = ""
    status: str = ""              # success | failed | error
    error_message: str | None = None
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    video_file: str | None = None
    scheduled_time: str | None = None


# ── DB helpers (dialect-agnostic) ──────────────────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db_insert_notification(event: UploadEvent, webhook_url: str | None = None) -> int:
    """Persist an event as a notification row; return its id."""
    db = get_database()
    payload = db.json_dump(
        {
            "event_type": event.event_type,
            "task_id": event.task_id,
            "platform": event.platform,
            "account": event.account,
            "title": event.title,
            "status": event.status,
            "error_message": event.error_message,
            "timestamp": event.timestamp,
        }
    )
    sql = (
        "INSERT INTO notifications "
        "(event_type, task_id, platform, account, title, status, error_msg, payload, webhook_url, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    return db.insert_returning_id(
        sql,
        (
            event.event_type,
            event.task_id,
            event.platform,
            event.account,
            event.title,
            event.status,
            event.error_message,
            payload,
            webhook_url,
            _now_iso(),
        ),
    )


def db_notification_exists(task_id: str, event_type: str) -> bool:
    """Idempotent dedup check: an already-delivered row for this (task_id, event_type)."""
    if not task_id:
        return False
    db = get_database()
    row = db.fetch_one(
        "SELECT id FROM notifications WHERE task_id = ? AND event_type = ? AND delivered = 1 LIMIT 1",
        (task_id, event_type),
    )
    return row is not None


def db_mark_delivered(notification_id: int) -> None:
    db = get_database()
    db.execute(
        "UPDATE notifications SET delivered = 1, delivered_at = ? WHERE id = ?",
        (_now_iso(), notification_id),
    )


def db_mark_final_failed(notification_id: int) -> None:
    db = get_database()
    db.execute(
        "UPDATE notifications SET final_failed = 1 WHERE id = ?",
        (notification_id,),
    )


def db_incr_retry(notification_id: int) -> None:
    db = get_database()
    db.execute(
        "UPDATE notifications SET retry_count = retry_count + 1 WHERE id = ?",
        (notification_id,),
    )


def db_get_webhook_config() -> list[dict]:
    """Return DB-stored routing rows (platform/account/url/secret/enabled)."""
    db = get_database()
    return db.fetch_all(
        "SELECT id, platform, account, url, secret, enabled FROM webhooks_config ORDER BY id"
    )


def db_upsert_webhook_config(rows: list[dict]) -> None:
    """Replace all routing rows with the provided list (page-edited config)."""
    db = get_database()
    with db.transaction() as tx:
        tx.execute("DELETE FROM webhooks_config")
        for r in rows:
            tx.execute(
                "INSERT INTO webhooks_config (platform, account, url, secret, enabled) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    r.get("platform") or None,
                    r.get("account") or None,
                    r["url"],
                    r.get("secret") or None,
                    1 if r.get("enabled", True) else 0,
                ),
            )


def db_list_notifications(event_type: str | None = None, page: int = 1, page_size: int = 20) -> list[dict]:
    db = get_database()
    params: list[Any] = []
    where = ""
    if event_type:
        where = "WHERE event_type = ?"
        params.append(event_type)
    params.extend([page_size, (page - 1) * page_size])
    return db.fetch_all(
        f"SELECT * FROM notifications {where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        tuple(params),
    )


def db_count_unread() -> int:
    db = get_database()
    row = db.fetch_one(
        "SELECT COUNT(*) AS c FROM notifications WHERE delivered = 0 OR final_failed = 1",
        (),
    )
    return int(row["c"]) if row else 0


def db_mark_read(ids: list[int] | None = None) -> int:
    db = get_database()
    if ids:
        placeholders = ", ".join("?" for _ in ids)
        db.execute(
            f"UPDATE notifications SET delivered = 1 WHERE id IN ({placeholders})",
            tuple(ids),
        )
    else:
        db.execute("UPDATE notifications SET delivered = 1 WHERE delivered = 0", ())
    return db_count_unread()


# ── Config resolution (.env baseline + DB override) ───────────────────────
def _env_webhooks() -> list[dict]:
    """Baseline routing from .env (read-only at startup)."""
    out: list[dict] = []
    mapping = [
        ("feishu", os.environ.get("SAU_FEISHU_WEBHOOK_URL"), os.environ.get("SAU_FEISHU_WEBHOOK_SECRET")),
        ("dingtalk", os.environ.get("SAU_DINGTALK_WEBHOOK_URL"), os.environ.get("SAU_DINGTALK_WEBHOOK_SECRET")),
        ("wework", os.environ.get("SAU_WEWORK_WEBHOOK_URL"), None),
        ("custom", os.environ.get("SAU_WEBHOOK_URL"), None),
    ]
    for channel, url, secret in mapping:
        if url:
            out.append({"channel": channel, "platform": None, "account": None, "url": url, "secret": secret})
    return out


def resolve_webhooks(platform: str, account: str) -> list[dict]:
    """Merge .env baseline with DB rows; most-specific match wins per channel.

    Matching precedence for a channel: account+platform > platform > global(.env).
    """
    db_rows = db_get_webhook_config()
    candidates: list[dict] = []
    for r in db_rows:
        candidates.append(
            {
                "channel": _classify_url(r["url"]),
                "platform": r.get("platform"),
                "account": r.get("account"),
                "url": r["url"],
                "secret": r.get("secret"),
                "enabled": bool(r.get("enabled", 1)),
            }
        )
    candidates.extend(_env_webhooks())

    # Pick best match per channel.
    best: dict[str, dict] = {}
    for c in candidates:
        if not c.get("enabled", True) or not c.get("url"):
            continue
        score = 0
        if c.get("platform") and c["platform"] == platform:
            score += 2
        if c.get("account") and c["account"] == account:
            score += 1
        if c["channel"] not in best or score > best[c["channel"]].get("_score", -1):
            c["_score"] = score
            best[c["channel"]] = c
    return [c for c in best.values() if c.get("url")]


def _classify_url(url: str) -> str:
    u = url.lower()
    if "open.feishu.com" in u or "feishu" in u:
        return "feishu"
    if "dingtalk.com" in u or "dingtalk" in u:
        return "dingtalk"
    if "qyapi.weixin.qq.com" in u or "wework" in u:
        return "wework"
    return "custom"


# ── Adapters (per-platform signing) ───────────────────────────────────────
def _feishu_sign(secret: str, timestamp_ms: str) -> str:
    """Feishu: base64(HMAC-SHA256(key=timestamp+"\n"+secret, msg=timestamp+"\n"+secret))."""
    string_to_sign = f"{timestamp_ms}\n{secret}"
    hmac_code = hmac.new(secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(hmac_code).decode("utf-8")


def _dingtalk_sign(secret: str, timestamp_ms: str) -> str:
    """DingTalk: HMAC-SHA256(key=secret, msg=timestamp+"\n"+secret), urlencoded in query."""
    string_to_sign = f"{timestamp_ms}\n{secret}"
    return urllib.parse.quote_plus(
        hmac.new(secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    )


def _build_payload(channel: str, event: UploadEvent, secret: str | None) -> tuple[str, dict]:
    """Return (url, json_body) for a channel. Raises ValueError on replay-window rejection."""
    ts_ms = str(int(time.time() * 1000))
    if channel == "feishu":
        color = "green" if event.status == "success" else "red"
        body = {
            "msg_type": "interactive",
            "card": {
                "header": {
                    "title": {"tag": "plain_text", "content": _title(event)},
                    "template": color,
                },
                "elements": [
                    {
                        "tag": "div",
                        "fields": [
                            {"is_short": True, "text": {"tag": "lark_md", "content": f"**任务ID**\n{event.task_id or '-'}"}},
                            {"is_short": True, "text": {"tag": "lark_md", "content": f"**平台**\n{event.platform or '-'}"}},
                            {"is_short": True, "text": {"tag": "lark_md", "content": f"**账号**\n{event.account or '-'}"}},
                            {"is_short": True, "text": {"tag": "lark_md", "content": f"**标题**\n{event.title or '-'}"}},
                        ],
                    }
                ],
            },
        }
        if secret:
            body["timestamp"] = ts_ms
            body["sign"] = _feishu_sign(secret, ts_ms)
        return "", body
    # markdown-style for dingtalk / wework / custom
    text = _markdown(event)
    if channel == "dingtalk":
        body = {"msgtype": "markdown", "markdown": {"title": _title(event), "text": text}}
        if secret:
            sign = _dingtalk_sign(secret, ts_ms)
            return f"?timestamp={ts_ms}&sign={sign}", body
        return "", body
    # wework / custom
    body = {"msgtype": "markdown", "markdown": {"content": text}}
    return "", body


def _title(event: UploadEvent) -> str:
    icon = "✅" if event.status == "success" else ("⚠️" if event.event_type == "cookie.expired" else "❌")
    kind = {
        "upload.success": "上传成功",
        "upload.failed": "上传失败",
        "cookie.expired": "Cookie 过期",
        "cookie.expiring_soon": "Cookie 即将过期",
        "system.webhook_failed": "Webhook 投递失败",
    }.get(event.event_type, event.event_type)
    return f"{icon} {event.platform or ''}{kind}"


def _markdown(event: UploadEvent) -> str:
    lines = [
        f"### {_title(event)}",
        "",
        f"- **任务ID**: {event.task_id or '-'}",
        f"- **平台**: {event.platform or '-'}",
        f"- **账号**: {event.account or '-'}",
        f"- **标题**: {event.title or '-'}",
    ]
    if event.error_message:
        lines.append(f"- **错误**: {event.error_message[:200]}")
    lines.append("")
    lines.append("*social-auto-upload*")
    return "\n".join(lines)


# ── HTTP dispatch ───────────────────────────────────────────────────────────
def _http_post(url: str, body: dict) -> None:
    if not url.startswith("https://"):
        raise ValueError("Webhook URL must use HTTPS")
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 — url validated https-only
        if resp.status >= 400:
            raise RuntimeError(f"webhook HTTP {resp.status}")


# ── Rate limiting + aggregation ────────────────────────────────────────────
def _rate_limited(url: str) -> bool:
    window = int(os.environ.get("SAU_WEBHOOK_AGG_WINDOW", DEFAULT_AGG_WINDOW))
    limit = DEFAULT_RATE_LIMIT
    now = time.time()
    with _rate_limit_lock:
        hits = _rate_buckets.setdefault(url, [])
        hits[:] = [t for t in hits if now - t < window]
        if len(hits) >= limit:
            return True
        hits.append(now)
    return False


# ── Core emit + worker ─────────────────────────────────────────────────────
def emit_event(event: UploadEvent) -> None:
    """Enqueue an event for async delivery + in-app persistence + SSE push."""
    # In-app notification (persist + SSE) for all events including internal ones.
    try:
        nid = db_insert_notification(event)
        _push_sse(event)
    except Exception as exc:  # noqa: BLE001 — notification must never break the caller
        _log.warning("[notifications] persist failed: %s", exc)
        nid = None

    # Webhook delivery (skipped for internal-only events).
    if event.event_type == "system.webhook_failed":
        return

    if event.task_id and db_notification_exists(event.task_id, event.event_type):
        _log.info("[notifications] dedup skip %s/%s", event.task_id, event.event_type)
        return

    _event_queue.put(event)


def _deliver_one(event: UploadEvent, nid: int | None) -> None:
    webhooks = resolve_webhooks(event.platform, event.account)
    if not webhooks:
        return
    aggregated = False
    for wh in webhooks:
        url = wh["url"]
        if _rate_limited(url):
            aggregated = True
            continue
        channel = wh["channel"]
        secret = wh.get("secret")
        try:
            query, body = _build_payload(channel, event, secret)
            _http_post(url + query, body)
            if nid is not None:
                db_mark_delivered(nid)
            _log.info("[notifications] delivered %s -> %s", event.event_type, channel)
        except Exception as exc:  # noqa: BLE001 — retry with backoff
            _log.warning("[notifications] deliver failed (%s): %s", channel, exc)
            _retry(event, nid)


def _retry(event: UploadEvent, nid: int | None) -> None:
    backoff = [1, 2, 4]
    attempt = 0
    while attempt < len(backoff):
        time.sleep(backoff[attempt])
        attempt += 1
        if nid is not None:
            db_incr_retry(nid)
        try:
            for wh in resolve_webhooks(event.platform, event.account):
                query, body = _build_payload(wh["channel"], event, wh.get("secret"))
                _http_post(wh["url"] + query, body)
            if nid is not None:
                db_mark_delivered(nid)
            return
        except Exception as exc:  # noqa: BLE001
            _log.warning("[notifications] retry %d failed: %s", attempt, exc)
    # Exhausted: dead-letter.
    if nid is not None:
        db_mark_final_failed(nid)
    emit_event(
        UploadEvent(
            event_type="system.webhook_failed",
            platform=event.platform,
            account=event.account,
            title=event.title,
            error_message=f"delivery exhausted for {event.event_type}",
        )
    )


def _worker_loop() -> None:
    while True:
        try:
            event = _event_queue.get()
            _deliver_one(event, None)
        except Exception as exc:  # noqa: BLE001
            _log.warning("[notifications] worker error: %s", exc)


def start_worker() -> None:
    """Idempotent: start the background delivery worker once per process."""
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True
    t = threading.Thread(target=_worker_loop, name="sau-notify", daemon=True)
    t.start()


# ── SSE fan-out for the in-app notification center ─────────────────────────
def _push_sse(event: UploadEvent) -> None:
    with _notification_sub_lock:
        for q in list(_notification_subscribers.values()):
            try:
                q.put({"event": "notification", "data": event.__dict__})
            except Exception:  # noqa: BLE001
                pass


def subscribe() -> "queue.Queue":
    """Register an SSE subscriber queue; returns the queue to yield from."""
    q: "queue.Queue" = queue.Queue()
    with _notification_sub_lock:
        _notification_subscribers.setdefault("_global", []).append(q)
    return q


def unsubscribe(q: "queue.Queue") -> None:
    with _notification_sub_lock:
        subs = _notification_subscribers.get("_global", [])
        if q in subs:
            subs.remove(q)
        if not subs:
            _notification_subscribers.pop("_global", None)


# ── Bridge helpers used by callers ─────────────────────────────────────────
def build_event_from_result(task_id: str, event_type: str, stdout: str, status: str | None = None) -> UploadEvent:
    """Build an UploadEvent from a task row + parsed [UPLOAD_RESULT] stdout.

    platform/account come from the tasks table, NOT from argv parsing.
    """
    from web_runner.utils import _db_get_task

    task = _db_get_task(task_id) or {}
    platform = task.get("platform", "") or ""
    account = task.get("account", "") or ""
    title = ""
    result_json = None
    for line in stdout.splitlines():
        if line.startswith("[UPLOAD_RESULT]"):
            result_json = line[len("[UPLOAD_RESULT]"):].strip()
            break
    if result_json:
        try:
            data = json.loads(result_json)
            title = data.get("title") or data.get("video_title") or ""
        except (json.JSONDecodeError, TypeError):
            pass
    if status is None:
        status = "success" if event_type == "upload.success" else "failed"
    return UploadEvent(
        event_type=event_type,
        task_id=task_id,
        platform=platform,
        account=account,
        title=title,
        status=status,
    )
