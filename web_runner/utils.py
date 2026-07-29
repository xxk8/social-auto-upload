"""Shared utilities for web_runner routes."""
from __future__ import annotations

import atexit
import base64
import binascii
import json
import os
import queue
import re
import sys
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from utils.log import logger as _task_logger

from web_runner.db import BASE_DIR, db_lock, get_connection
from web_runner.error_events import _db_get_error_events, _log_error_event
from web_runner.scheduler import (
    _normalise_schedule,
    _schedule_task,
    _scheduled_timers,
    _timer_lock,
)

COOKIES_DIR = BASE_DIR / "cookies"
COOKIES_DIR.mkdir(exist_ok=True)

UPLOADS_DIR = BASE_DIR / ".sau_uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# Share-link downloads (inbox page) — public download centre root.
INBOX_DIR = BASE_DIR / "videos" / "inbox"
INBOX_DIR.mkdir(parents=True, exist_ok=True)

# ── Dual thread pools ────────────────────────────────────────────────
# short: cookie checks / light CLI  ·  upload: long browser upload jobs
# Isolated so a full upload backlog never starves quick health checks.
_SHORT_WORKERS = max(1, int(os.environ.get("SAU_SHORT_WORKERS", "4")))
_UPLOAD_WORKERS = max(1, int(os.environ.get("SAU_UPLOAD_WORKERS", "4")))
_TASK_QUEUE_MAX = max(8, int(os.environ.get("SAU_TASK_QUEUE_MAX", "64")))


def worker_mode_enabled() -> bool:
    """When true, web process only enqueues DB rows; ``sau-worker`` executes CLI."""
    return os.environ.get("SAU_TASK_MODE", "inline").strip().lower() in (
        "worker",
        "external",
        "pg",
        "queue",
    )


_short_executor = ThreadPoolExecutor(
    max_workers=_SHORT_WORKERS, thread_name_prefix="sau-short"
)
_upload_executor = ThreadPoolExecutor(
    max_workers=_UPLOAD_WORKERS, thread_name_prefix="sau-upload"
)
_pending_tasks = 0
_pending_lock = threading.Lock()


def _is_heavy_argv(argv: list[str]) -> bool:
    joined = " ".join(str(a) for a in argv).lower()
    return any(
        token in joined
        for token in (
            "upload",
            "publish",
            "login",
            "render",
            "studio",
            "crawl",
        )
    )


def _completed_future(result: Any = None) -> Future:
    fut: Future = Future()
    fut.set_result(result)
    return fut


def _enqueue_run_sau(task_id: str, argv: list[str]) -> Future:
    """Submit a CLI job with back-pressure and pool selection.

    In ``SAU_TASK_MODE=worker`` the web process does **not** run the CLI —
    a separate ``python -m web_runner.worker`` claims pending rows from Postgres.
    """
    global _pending_tasks

    if worker_mode_enabled():
        # Ensure row is claimable; callers usually insert as pending already.
        try:
            row = _db_get_task(task_id)
            if row and (row.get("status") or "") == "scheduled":
                _db_update_task(task_id, status="pending")
        except Exception:
            pass
        log(f"[{task_id}] queued for external worker (SAU_TASK_MODE=worker)")
        return _completed_future(None)

    def _reject() -> None:
        _db_update_task(
            task_id,
            status="error",
            error=f"Task queue full (max {_TASK_QUEUE_MAX} pending)",
        )
        log(f"[{task_id}] rejected: task queue full")

    with _pending_lock:
        if _pending_tasks >= _TASK_QUEUE_MAX:
            return _short_executor.submit(_reject)
        _pending_tasks += 1

    pool = _upload_executor if _is_heavy_argv(argv) else _short_executor

    def _runner() -> None:
        global _pending_tasks
        try:
            _run_sau(task_id, argv)
        finally:
            with _pending_lock:
                _pending_tasks = max(0, _pending_tasks - 1)

    return pool.submit(_runner)


def get_runtime_stats() -> dict[str, Any]:
    """Lightweight process stats for /health and /api/system/stats."""
    with _pending_lock:
        in_flight = _pending_tasks
    with _log_sub_lock:
        log_subs = len(_log_subscribers)
    db_pending = 0
    db_running = 0
    db_scheduled = 0
    def _count(row: Any) -> int:
        if row is None:
            return 0
        if isinstance(row, dict):
            for k in ("cnt", "count", "COUNT"):
                if k in row and row[k] is not None:
                    return int(row[k])
            return int(next(iter(row.values()), 0) or 0)
        try:
            return int(row[0])
        except Exception:
            return 0

    try:
        with get_connection() as conn:
            db_pending = _count(
                conn.execute(
                    "SELECT COUNT(*) AS cnt FROM tasks WHERE status = ?",
                    ("pending",),
                ).fetchone()
            )
            db_running = _count(
                conn.execute(
                    "SELECT COUNT(*) AS cnt FROM tasks WHERE status = ?",
                    ("running",),
                ).fetchone()
            )
            db_scheduled = _count(
                conn.execute(
                    "SELECT COUNT(*) AS cnt FROM tasks WHERE status = ?",
                    ("scheduled",),
                ).fetchone()
            )
    except Exception:
        pass
    return {
        "task_mode": "worker" if worker_mode_enabled() else "inline",
        "in_flight_local": in_flight,
        "queue_max": _TASK_QUEUE_MAX,
        "short_workers": _SHORT_WORKERS,
        "upload_workers": _UPLOAD_WORKERS,
        "log_sse_subscribers": log_subs,
        "db_pending": db_pending,
        "db_running": db_running,
        "db_scheduled": db_scheduled,
    }


class _TaskExecutorFacade:
    """Backward-compatible ``task_executor.submit(_run_sau, id, argv)`` API.

    Routes ``_run_sau`` through the dual-pool queue; other callables go to
    the short pool. Tests that patch ``task_executor.submit`` keep working.
    """

    def submit(self, fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future:
        name = getattr(fn, "__name__", "")
        if name == "_run_sau" and len(args) >= 2 and not kwargs:
            return _enqueue_run_sau(args[0], args[1])
        return _short_executor.submit(fn, *args, **kwargs)

    def shutdown(self, wait: bool = True, cancel_futures: bool = False) -> None:
        kwargs: dict[str, Any] = {"wait": wait}
        # cancel_futures is 3.9+; keep call sites portable.
        try:
            _short_executor.shutdown(wait=wait, cancel_futures=cancel_futures)
            _upload_executor.shutdown(wait=wait, cancel_futures=cancel_futures)
        except TypeError:
            _short_executor.shutdown(wait=wait)
            _upload_executor.shutdown(wait=wait)


task_executor = _TaskExecutorFacade()
_progress_subscribers: dict[str, list] = {}
_progress_sub_lock = threading.Lock()
_MAX_SSE_CONNECTIONS = 8
_SSE_TIMEOUT_SECONDS = 300

# Live log fan-out for ``GET /api/logs/stream``.
_log_subscribers: list[queue.Queue] = []
_log_sub_lock = threading.Lock()
_LOG_SUB_QUEUE_SIZE = 256

sys.path.insert(0, str(BASE_DIR))

LOG_MAX_ROWS = 10_000
_log_trim_counter = 0
MIN_UPLOAD_BYTES = 10240

# Default list-API caps (overridable via query params, hard-capped).
DEFAULT_TASK_LIST_LIMIT = 100
MAX_TASK_LIST_LIMIT = 500
DEFAULT_LOG_LIST_LIMIT = 200
MAX_LOG_LIST_LIMIT = 1000

# Buffered log writes — coalesce high-frequency CLI chatter into fewer
# Postgres round-trips. Flushed on batch size, timer, or log read.
_LOG_BATCH_SIZE = 24
_LOG_FLUSH_SECONDS = 0.12
_log_queue: list[tuple[str, str]] = []
_log_queue_lock = threading.Lock()
_log_flush_timer: threading.Timer | None = None


class _LogCapture:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def write(self, message: str) -> None:
        text = message.strip()
        if text:
            self.messages.append(text)

    def flush(self) -> None:
        pass


def _publish_log_event(ts: str, message: str) -> None:
    """Push a log line to all SSE subscribers (best-effort, non-blocking)."""
    payload = {"ts": ts, "message": message}
    with _log_sub_lock:
        dead: list[queue.Queue] = []
        for q in _log_subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                # Drop oldest to keep the stream moving for slow clients.
                try:
                    q.get_nowait()
                except queue.Empty:
                    pass
                try:
                    q.put_nowait(payload)
                except queue.Full:
                    dead.append(q)
        for q in dead:
            try:
                _log_subscribers.remove(q)
            except ValueError:
                pass


def subscribe_logs() -> queue.Queue:
    """Register a subscriber queue for live log SSE. Raises if at capacity."""
    q: queue.Queue = queue.Queue(maxsize=_LOG_SUB_QUEUE_SIZE)
    with _log_sub_lock:
        if len(_log_subscribers) >= _MAX_SSE_CONNECTIONS:
            raise RuntimeError("too many log stream subscribers")
        _log_subscribers.append(q)
    return q


def unsubscribe_logs(q: queue.Queue) -> None:
    with _log_sub_lock:
        try:
            _log_subscribers.remove(q)
        except ValueError:
            pass


def log(message: str) -> None:
    ts = datetime.now().isoformat(timespec="milliseconds")
    _task_logger.info(message)
    _db_insert_log(ts, message)
    _publish_log_event(ts, message)


def _save_data_uri(data_uri: str) -> Path | None:
    if not data_uri:
        return None
    try:
        if "," in data_uri:
            header, raw = data_uri.split(",", 1)
            ext_part = header.split(";")[0].split("/")[1] if "/" in header else ""
            ext = f".{ext_part}" if ext_part else ""
        else:
            raw = data_uri
            ext = ""
        if not raw.strip():
            return None
        decoded = base64.b64decode(raw)
        return _write_upload(decoded, ext)
    except (binascii.Error, UnicodeEncodeError, OSError, ValueError, TypeError) as exc:
        log(f"[upload] failed to save data uri: {type(exc).__name__}")
        return None


def _download_url(url: str) -> Path | None:
    import http.client
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            raw = resp.read()
        ext = Path(url.split("?")[0]).suffix or ".jpg"
        return _write_upload(raw, ext)
    except (http.client.HTTPException, urllib.error.HTTPError, urllib.error.URLError, OSError, TimeoutError, ValueError, TypeError) as exc:
        log(f"[upload] failed to download url {url[:60]}: {type(exc).__name__}")
        return None


def _write_upload(raw: bytes, ext: str = "") -> Path | None:
    if len(raw) < MIN_UPLOAD_BYTES:
        log(f"[upload] rejected file: payload is only {len(raw)} bytes (min {MIN_UPLOAD_BYTES})")
        return None
    name = f"{uuid.uuid4().hex}{ext}"
    path = UPLOADS_DIR / name
    path.write_bytes(raw)
    log(f"[upload] saved temp file: {path} ({len(raw)} bytes)")
    return path


def _db_insert_task(
    task_id: str,
    status: str,
    platform: str,
    action: str,
    account: str,
    created: str,
    argv: list[str] | None = None,
    scheduled_at: str | None = None,
    title: str | None = None,
) -> None:
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO tasks "
                "(task_id, status, platform, action, account, created, argv, scheduled_at, title) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    task_id,
                    status,
                    platform,
                    action,
                    account,
                    created,
                    json.dumps(argv) if argv else None,
                    scheduled_at,
                    title,
                ),
            )
            conn.commit()


def _db_get_task(task_id: str) -> dict | None:
    with db_lock:
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            return dict(row) if row else None


def _db_update_task(task_id: str, **kwargs: str | int | None) -> None:
    if not kwargs:
        return
    set_clause = ", ".join(f"{k} = ?" for k in kwargs)
    values = list(kwargs.values()) + [task_id]
    with db_lock:
        with get_connection() as conn:
            conn.execute(f"UPDATE tasks SET {set_clause} WHERE task_id = ?", values)
            conn.commit()


def _clamp_limit(value: int | None, default: int, hard_max: int) -> int:
    if value is None:
        return default
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(n, hard_max))


def _db_get_all_tasks(limit: int | None = None, offset: int = 0) -> list[dict]:
    # List omits `result` / `publish_detail` (large JSON blobs). Keep `argv`
    # so the Tasks drawer can show the CLI command; retry still uses task_id.
    capped = _clamp_limit(limit, DEFAULT_TASK_LIST_LIMIT, MAX_TASK_LIST_LIMIT)
    off = max(0, int(offset or 0))
    with db_lock:
        with get_connection() as conn:
            query = (
                "SELECT task_id, status, platform, action, account, created, "
                "code, error, argv, scheduled_at, title "
                "FROM tasks ORDER BY created DESC LIMIT ? OFFSET ?"
            )
            rows = conn.execute(query, (capped, off)).fetchall()
            return [dict(r) for r in rows]


def _new_task_id(prefix: str = "task") -> str:
    """Return a UUID string (required when ``tasks.task_id`` is UUID on Postgres)."""
    # prefix retained for call-site readability only; not embedded in the id.
    _ = prefix
    return str(uuid.uuid4())


def _flush_log_queue() -> None:
    """Drain the in-memory log buffer into Postgres (idempotent)."""
    global _log_flush_timer, _log_trim_counter
    with _log_queue_lock:
        _log_flush_timer = None
        if not _log_queue:
            return
        batch = list(_log_queue)
        _log_queue.clear()

    with db_lock:
        with get_connection() as conn:
            for ts, message in batch:
                conn.execute(
                    "INSERT INTO logs (ts, message) VALUES (?, ?)",
                    (ts, message),
                )
            conn.commit()
            _log_trim_counter += len(batch)
            if _log_trim_counter >= 200:
                _log_trim_counter = 0
                # Keep newest LOG_MAX_ROWS by deleting older than the Nth row.
                conn.execute(
                    "DELETE FROM logs WHERE ts < ("
                    "  SELECT ts FROM logs ORDER BY ts DESC "
                    "  OFFSET ? LIMIT 1"
                    ")",
                    (LOG_MAX_ROWS,),
                )
                conn.commit()


def _schedule_log_flush() -> None:
    global _log_flush_timer
    with _log_queue_lock:
        if _log_flush_timer is not None:
            return
        timer = threading.Timer(_LOG_FLUSH_SECONDS, _flush_log_queue)
        timer.daemon = True
        _log_flush_timer = timer
        timer.start()


def _db_insert_log(ts: str, message: str) -> None:
    """Queue a log row; flushes in batches to cut DB connection churn."""
    with _log_queue_lock:
        _log_queue.append((ts, message))
        if len(_log_queue) >= _LOG_BATCH_SIZE:
            # Flush on a worker so the hot path returns quickly.
            should_flush_now = True
        else:
            should_flush_now = False
    if should_flush_now:
        _flush_log_queue()
    else:
        _schedule_log_flush()


def _db_get_logs(after: str | None = None, task_id: str | None = None, limit: int | None = None, offset: int = 0) -> list[dict]:
    # Make buffered rows visible to API consumers before SELECT.
    _flush_log_queue()
    capped = _clamp_limit(limit, DEFAULT_LOG_LIST_LIMIT, MAX_LOG_LIST_LIMIT)
    off = max(0, int(offset or 0))
    with db_lock:
        with get_connection() as conn:
            query = "SELECT ts, message FROM logs"
            conditions: list[str] = []
            params: list = []
            if after:
                conditions.append("ts > ?")
                params.append(after)
            if task_id:
                conditions.append("message LIKE ?")
                params.append(f"%{task_id}%")
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            # Incremental tail reads (`after=`) want ascending; full page
            # loads prefer newest-first then reverse for stable UI.
            if after:
                query += " ORDER BY ts ASC LIMIT ? OFFSET ?"
                params.extend([capped, off])
                rows = conn.execute(query, params).fetchall()
                return [dict(r) for r in rows]
            query += " ORDER BY ts DESC LIMIT ? OFFSET ?"
            params.extend([capped, off])
            rows = conn.execute(query, params).fetchall()
            # Ascending order for consumers that append chronologically.
            return [dict(r) for r in reversed(rows)]


def _recover_orphaned_tasks() -> None:
    with db_lock:
        with get_connection() as conn:
            orphans = conn.execute(
                "SELECT task_id, argv FROM tasks WHERE status = 'running'"
            ).fetchall()
            for row in orphans:
                task_id, argv_json = row
                conn.execute(
                    "UPDATE tasks SET status = 'error', error = ? WHERE task_id = ?",
                    ("Orphaned: server restarted while task was running", task_id),
                )
                log(f"[recover] marked orphaned task as error: {task_id}")
            conn.commit()


def _start_orphan_watchdog(interval_seconds: int = 120) -> None:
    def _watchdog() -> None:
        while True:
            time.sleep(interval_seconds)
            try:
                _recover_orphaned_tasks()
            except (OSError, Exception) as exc:
                log(f"[watchdog] error: {exc}")

    t = threading.Thread(target=_watchdog, daemon=True, name="orphan-watchdog")
    t.start()


def _sync_cookie_files_to_db() -> None:
    if not COOKIES_DIR.exists():
        return
    with db_lock:
        with get_connection() as conn:
            for cookie_file in COOKIES_DIR.glob("*.json"):
                name = cookie_file.stem
                parts = name.split("_", 1)
                if len(parts) != 2:
                    continue
                platform, account_name = parts
                existing = conn.execute(
                    "SELECT aa.id FROM account_authorizations aa "
                    "JOIN account_groups ag ON aa.group_id = ag.id "
                    "WHERE ag.name = ? AND aa.platform = ?",
                    (account_name, platform),
                ).fetchone()
                if existing:
                    continue
                group = conn.execute(
                    "SELECT id FROM account_groups WHERE name = ?",
                    (account_name,),
                ).fetchone()
                if group:
                    group_id = group[0]
                else:
                    conn.execute(
                        "INSERT INTO account_groups (name, created) VALUES (?, ?)",
                        (account_name, datetime.now().isoformat(timespec="seconds")),
                    )
                    group_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                conn.execute(
                    "INSERT OR IGNORE INTO account_authorizations (group_id, platform, cookie_file, created) VALUES (?, ?, ?, ?)",
                    (group_id, platform, str(cookie_file), datetime.now().isoformat(timespec="seconds")),
                )
            conn.commit()


def _account_files(platform: str | None = None) -> list[dict]:
    if not COOKIES_DIR.exists():
        return []
    results: list[dict] = []
    for f in sorted(COOKIES_DIR.glob("*.json")):
        name = f.stem
        parts = name.split("_", 1)
        if len(parts) != 2:
            continue
        plat, acct = parts
        if platform and plat != platform:
            continue
        results.append({"platform": plat, "account_name": acct, "path": str(f)})
    return results


def _quick_check_cookie(platform: str, account: str) -> dict:
    cookie_path = COOKIES_DIR / f"{platform}_{account}.json"
    if not cookie_path.exists():
        return {"valid": False, "reason": "no_file", "age_hours": None, "file_size": None}
    try:
        stat = cookie_path.stat()
        age_hours = (time.time() - stat.st_mtime) / 3600
        file_size = stat.st_size
        if file_size < 10:
            return {"valid": False, "reason": "empty_file", "age_hours": round(age_hours, 1), "file_size": file_size}
        with open(cookie_path) as f:
            data = json.load(f)
        if not data:
            return {"valid": False, "reason": "empty_json", "age_hours": round(age_hours, 1), "file_size": file_size}
        return {"valid": True, "reason": "ok", "age_hours": round(age_hours, 1), "file_size": file_size}
    except (json.JSONDecodeError, OSError):
        return {"valid": False, "reason": "invalid_json", "age_hours": None, "file_size": None}


def _parse_upload_result(stdout: str) -> str | None:
    for line in stdout.splitlines():
        if line.startswith("[UPLOAD_RESULT]"):
            return line[len("[UPLOAD_RESULT]"):]
    return None


def _store_result(task_id: str, stdout: str) -> None:
    result_json = _parse_upload_result(stdout)
    if result_json:
        _db_update_task(task_id, result=result_json)


def _run_sau(task_id: str, argv: list[str]) -> None:
    """Run ``python -m sau_cli …`` streaming stdout into the live log bus.

    Uses a dual-pool worker (via ``task_executor``). Output is line-buffered
    so `/api/logs/stream` subscribers see progress without waiting for the
    whole 10-minute job to finish.
    """
    import subprocess

    _db_update_task(task_id, status="running")
    log(f"[{task_id}] starting: sau {' '.join(argv)}")
    timeout_s = int(os.environ.get("SAU_TASK_TIMEOUT", "600"))
    out_lines: list[str] = []
    proc: subprocess.Popen[str] | None = None
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "sau_cli"] + argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=str(BASE_DIR),
        )
        assert proc.stdout is not None
        deadline = time.time() + timeout_s
        while True:
            if time.time() > deadline:
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except Exception:
                    pass
                raise subprocess.TimeoutExpired(proc.args, timeout_s)
            line = proc.stdout.readline()
            if line == "" and proc.poll() is not None:
                break
            if not line:
                # Brief yield when pipe is momentarily empty but process lives.
                if proc.poll() is not None:
                    break
                time.sleep(0.05)
                continue
            text = line.rstrip("\n")
            out_lines.append(text)
            if text:
                # Avoid double-prefixing lines the CLI already tags with task id.
                if text.startswith(f"[{task_id}]"):
                    log(text)
                else:
                    log(f"[{task_id}] {text}")
        code = proc.wait(timeout=5)
        stdout = "\n".join(out_lines)
        if code == 0:
            _db_update_task(task_id, status="success", code=0)
            _store_result(task_id, stdout)
            log(f"[{task_id}] completed successfully")
        else:
            error_msg = stdout.strip() or "Unknown error"
            _db_update_task(task_id, status="failed", code=code, error=error_msg[-2000:])
            log(f"[{task_id}] failed with code {code}: {error_msg[:200]}")
            _log_error_event(
                phase="cli",
                task_id=task_id,
                exc_type="NonZeroExit",
                exc_message=error_msg[:500],
                tb=stdout[-2000:] if stdout else None,
                argv=argv,
                status_code=code,
            )
    except subprocess.TimeoutExpired:
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass
        _db_update_task(
            task_id, status="error", error=f"Task timed out after {timeout_s} seconds"
        )
        log(f"[{task_id}] timed out")
        _log_error_event(
            phase="cli",
            task_id=task_id,
            exc_type="TimeoutExpired",
            exc_message=f"Task timed out after {timeout_s} seconds",
            argv=argv,
        )
    except (OSError, ValueError) as exc:
        _db_update_task(task_id, status="error", error=str(exc))
        log(f"[{task_id}] error: {exc}")
        _log_error_event(
            phase="cli",
            task_id=task_id,
            exc=exc,
            argv=argv,
        )


def _headless_flag(headless: object) -> str | None:
    if headless is None:
        return None
    if isinstance(headless, bool):
        return "true" if headless else "false"
    s = str(headless).strip().lower()
    if s in ("true", "1", "yes"):
        return "true"
    if s in ("false", "0", "no"):
        return "false"
    return None


def _validate_group_name(raw: object) -> tuple[bool, str]:
    _FORBIDDEN_NAME_CHARS = re.compile(r'[/\\:*?"<>|\x00-\x1F\x7F]')
    _NAME_MAX_LEN = 64
    if not isinstance(raw, str):
        return False, "分组名不能为空"
    cleaned = raw.strip()
    if not cleaned:
        return False, "分组名不能为空"
    if len(cleaned) > _NAME_MAX_LEN:
        return False, f"分组名长度不能超过 {_NAME_MAX_LEN} 个字符"
    if _FORBIDDEN_NAME_CHARS.search(cleaned):
        return False, '分组名包含不允许的字符（/\\:*?"<>|）'
    return True, cleaned


def _cleanup_old_uploads() -> None:
    now = time.time()
    max_age = 24 * 60 * 60
    count = 0
    for f in UPLOADS_DIR.iterdir():
        if f.is_file() and (now - f.stat().st_mtime) > max_age:
            f.unlink(missing_ok=True)
            count += 1
    if count:
        _task_logger.info(f"[startup] cleaned {count} old temp files from {UPLOADS_DIR}")


PLATFORM_CONFIG: dict[str, dict] = {
    "douyin": {"video": True, "note": True, "thumbnail": True, "thumbnail_dual": True, "product": True},
    "kuaishou": {"video": True, "note": True, "thumbnail": True},
    "xiaohongshu": {"video": True, "note": True, "thumbnail": True},
    "bilibili": {"video": True, "note": True},
    "tencent": {"video": True, "note": True, "thumbnail": True, "thumbnail_dual": True, "tencent_extra": True},
    "tiktok": {"video": True},
    "baijiahao": {"video": True},
    "youtube": {"video": True, "thumbnail": True},
}

DESC_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "bilibili", "tencent", "youtube"}
THUMBNAIL_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "tencent", "youtube"}
THUMBNAIL_DUAL_PLATFORMS = {"douyin", "tencent"}
NOTE_PLATFORMS = {p for p, cfg in PLATFORM_CONFIG.items() if cfg.get("note")}
_QR_LOGIN_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "tencent", "bilibili", "tiktok", "baijiahao"}

# Backward-compatible re-exports (implementations live in dedicated modules)
__all_reexports__ = (
    "_schedule_task",
    "_scheduled_timers",
    "_timer_lock",
    "_normalise_schedule",
    "_log_error_event",
    "_db_get_error_events",
)

# Best-effort drain so process exit does not drop the last log batch.
atexit.register(_flush_log_queue)
