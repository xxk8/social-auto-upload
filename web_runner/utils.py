"""Shared utilities for web_runner routes (post-SQLite-removal: PG-only Database)."""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from utils.log import logger as _task_logger
from web_runner.db import get_database

BASE_DIR = Path(__file__).parent.parent.resolve()
import psycopg  # narrow exception for the orphan-recovery watchdog loop

dbi = get_database  # alias for shorter call-site reads

COOKIES_DIR = BASE_DIR / "cookies"
COOKIES_DIR.mkdir(exist_ok=True)

UPLOADS_DIR = BASE_DIR / ".sau_uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# /api/inbox/download writes here (yt-dlp + patchright fallback). Canonical
# `BASE_DIR`-derived path so a Docker / systemd / uwsgi CWD change can't make
# the writer and the cleanup sweep disagree on which dir to walk.
INBOX_DIR = BASE_DIR / "videos" / "inbox"
INBOX_DIR.mkdir(parents=True, exist_ok=True)

# Back-compat: keep task_executor for any external callers, but primary
# task submission now goes through web_runner.executor.submit_task()
task_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="sau-task")
_scheduled_timers: dict[str, threading.Timer] = {}
_timer_lock = threading.Lock()
_progress_subscribers: dict[str, list] = {}
_progress_sub_lock = threading.Lock()
_MAX_SSE_CONNECTIONS = 5
_SSE_TIMEOUT_SECONDS = 300

sys.path.insert(0, str(BASE_DIR))

LOG_MAX_ROWS = 10_000
_log_trim_counter = 0
_error_event_trim_counter = 0
MIN_UPLOAD_BYTES = 10240


# Columns that hold JSON-encoded payloads. On PG, ``argv`` / ``result``
# / ``publish_detail`` are stored as TEXT (canonical JSON) for
# cross-dialect uniformity. ``db.json_dump`` is the identity passthrough
# on PG; on the prior SQLite backend it serialized Python dicts to
# JSON strings. When `_db_update_task` writes one of these keys it
# still routes the value through `db.json_dump` for contract symmetry.
_JSON_COLUMNS = frozenset({"argv", "result", "publish_detail"})

_TASK_COLUMNS = frozenset({
    "status", "platform", "action", "account", "code", "error",
    "argv", "result", "publish_detail", "priority", "scheduled_at",
})


class _LogCapture:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def write(self, message: str) -> None:
        text = message.strip()
        if text:
            self.messages.append(text)

    def flush(self) -> None:
        pass


def log(message: str) -> None:
    _task_logger.info(message)
    _db_insert_log(datetime.now().isoformat(timespec="milliseconds"), message)


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
    import ipaddress
    import urllib.error
    import urllib.request
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        log(f"[upload] rejected url with scheme: {parsed.scheme}")
        return None

    hostname = parsed.hostname or ""
    try:
        addr = ipaddress.ip_address(hostname)
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            log(f"[upload] rejected private/loopback ip: {hostname}")
            return None
    except ValueError:
        if hostname in ("localhost",):
            log("[upload] rejected localhost url")
            return None

    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            content_length = resp.headers.get("Content-Length")
            if content_length and int(content_length) > 50 * 1024 * 1024:
                log(f"[upload] rejected url: Content-Length {content_length} exceeds 50MB")
                return None
            raw = resp.read(50 * 1024 * 1024 + 1)
            if len(raw) > 50 * 1024 * 1024:
                log("[upload] rejected url: response exceeds 50MB")
                return None
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
) -> None:
    db = dbi()
    db.execute(
        "INSERT INTO tasks (task_id, status, platform, action, account, created, argv) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (task_id, status, platform, action, account, created, db.json_dump(argv)),
    )


def _db_get_task(task_id: str) -> dict | None:
    db = dbi()
    return db.fetch_one("SELECT * FROM tasks WHERE task_id = ?", (task_id,))


def _db_update_task(task_id: str, **kwargs: str | int | None) -> None:
    if not kwargs:
        return
    invalid = set(kwargs) - _TASK_COLUMNS
    if invalid:
        raise ValueError(f"Invalid task columns: {invalid}")
    db = dbi()
    set_clause = ", ".join(f"{k} = ?" for k in kwargs)
    payload: list = []
    for k, v in kwargs.items():
        if k in _JSON_COLUMNS:
            payload.append(db.json_dump(v))
        else:
            payload.append(v)
    values = payload + [task_id]
    db.execute(f"UPDATE tasks SET {set_clause} WHERE task_id = ?", tuple(values))


def _db_get_all_tasks(limit: int | None = None, offset: int = 0) -> list[dict]:
    """Return tasks ordered by newest-first; tiebreaker on task_id DESC so
    pagination is deterministic when multiple tasks share the same
    `created` ISO string (e.g. scheduled jobs appended in the same second).
    """
    db = dbi()
    query = "SELECT * FROM tasks ORDER BY created DESC, task_id DESC"
    params: list = []
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)
    if offset:
        query += " OFFSET ?"
        params.append(offset)
    return db.fetch_all(query, tuple(params))


def _new_task_id(prefix: str) -> str:
    ts = datetime.now().strftime("%H%M%S")
    short_uuid = uuid.uuid4().hex[:6]
    return f"{prefix}-{ts}-{short_uuid}"


def _db_insert_log(ts: str, message: str) -> None:
    """Insert a log row + opportunistically trim to `LOG_MAX_ROWS` rows."""
    global _log_trim_counter
    db = dbi()
    db.execute("INSERT INTO logs (ts, message) VALUES (?, ?)", (ts, message))
    _log_trim_counter += 1
    if _log_trim_counter >= 200:
        _log_trim_counter = 0
        # PG-only path: trim by `id` (SERIAL PRIMARY KEY on logs.id).
        #
        # post-cutover.
        db.execute(
            "DELETE FROM logs WHERE id < (SELECT id FROM logs "
            "ORDER BY id DESC LIMIT 1 OFFSET ?)",
            (LOG_MAX_ROWS,),
        )


def _db_get_logs(after: str | None = None, task_id: str | None = None, limit: int | None = None, offset: int = 0) -> list[dict]:
    """Return log rows. Filters:
      - `after`: ISO ts; keeps rows strictly newer.
      - `task_id`: prefix match `[{task_id}]`, leveraging the canonical
        log message format used by `_run_sau(...)`. The `[...]` braces
        prevent `run-1` from accidentally matching `[run-12] ...`. Tied
        with `ORDER BY ts ASC, id ASC` for deterministic pagination.
    """
    db = dbi()
    query = "SELECT ts, message FROM logs"
    conditions: list[str] = []
    params: list = []
    if after:
        conditions.append("ts > ?")
        params.append(after)
    if task_id:
        conditions.append("message LIKE ?")
        params.append(f"[{task_id}]%")
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    # PG-only: order by SERIAL `id` (no `id` concept after SQLite
    # removal). The `(ts, id)` composite guarantees deterministic
    # pagination when many rows share the same `ts` ISO string.
    query += " ORDER BY ts ASC, id ASC"
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)
    if offset:
        query += " OFFSET ?"
        params.append(offset)
    return db.fetch_all(query, tuple(params))


def _log_error_event(
    phase: str,
    platform: str = "",
    account: str = "",
    action: str = "",
    task_id: str | None = None,
    exc: BaseException | None = None,
    exc_type: str = "",
    exc_message: str = "",
    tb: str | None = None,
    argv: list[str] | None = None,
    attempt_no: int | None = None,
    retry_count: int | None = None,
    status_code: int | None = None,
) -> None:
    global _error_event_trim_counter
    now = datetime.now().isoformat(timespec="seconds")
    if exc is not None and not exc_type:
        exc_type = type(exc).__name__
    if exc is not None and not exc_message:
        exc_message = str(exc)
    if tb is None and exc is not None:
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    db = dbi()
    db.execute(
        """INSERT INTO error_events
           (ts, task_id, level, phase, platform, account, action,
            exc_type, exc_message, traceback, argv, attempt_no, retry_count, status_code)
           VALUES (?, ?, 'error', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            now, task_id, phase, platform, account, action,
            exc_type, exc_message, tb,
            db.json_dump(argv),
            attempt_no, retry_count, status_code,
        ),
    )
    _error_event_trim_counter += 1
    if _error_event_trim_counter >= 100:
        _error_event_trim_counter = 0
        db.execute(
            "DELETE FROM error_events WHERE id < "
            "(SELECT id FROM error_events ORDER BY id DESC LIMIT 1 OFFSET ?)",
            (LOG_MAX_ROWS,),
        )


def _db_get_error_events(
    after: str | None = None,
    platform: str | None = None,
    account: str | None = None,
    action: str | None = None,
    exc_type: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict]:
    db = dbi()
    query = "SELECT * FROM error_events"
    conditions: list[str] = []
    params: list = []
    if after:
        conditions.append("ts > ?")
        params.append(after)
    if platform:
        conditions.append("platform = ?")
        params.append(platform)
    if account:
        conditions.append("account = ?")
        params.append(account)
    if action:
        conditions.append("action = ?")
        params.append(action)
    if exc_type:
        conditions.append("exc_type = ?")
        params.append(exc_type)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY ts DESC, id DESC"
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)
    if offset:
        query += " OFFSET ?"
        params.append(offset)
    return db.fetch_all(query, tuple(params))


def _recover_orphaned_tasks() -> None:
    db = dbi()
    orphans = db.fetch_all("SELECT task_id FROM tasks WHERE status = 'running'")
    if not orphans:
        return
    db.execute(
        "UPDATE tasks SET status = 'error', error = ? WHERE status = 'running'",
        ("Orphaned: server restarted while task was running",),
    )
    for row in orphans:
        log(f"[recover] marked orphaned task as error: {row['task_id']}")


def _start_orphan_watchdog(interval_seconds: int = 120) -> None:
    def _watchdog() -> None:
        while True:
            time.sleep(interval_seconds)
            try:
                _recover_orphaned_tasks()
            except psycopg.Error as exc:
                # Narrow catch: only DB-layer errors. ``RuntimeError``
                # was previously listed but is too broad (it would
                # swallow any Python runtime error, masking real bugs
                # in the recovery path). The watchdog is best-effort,
                # so we log and continue — the operator-visible trail
                # is the log line below.
                log(f"[watchdog] DB error: {exc}")

    t = threading.Thread(target=_watchdog, daemon=True, name="orphan-watchdog")
    t.start()


def _sync_cookie_files_to_db() -> None:
    """Reconcile on-disk `COOKIES_DIR/*.json` into `account_authorizations`.

    Each call is autocommit (`db.execute` + `db.last_insert_id`) — partial
    failures are surfaced via the row-id return; we don't aggregate into
    one big txn because legacy code didn't either, and the openspec §2.8
    callable-style migration simplifies control flow.
    """
    if not COOKIES_DIR.exists():
        return
    db = dbi()
    for cookie_file in COOKIES_DIR.glob("*.json"):
        name = cookie_file.stem
        parts = name.split("_", 1)
        if len(parts) != 2:
            continue
        platform, account_name = parts
        existing = db.fetch_one(
            "SELECT aa.id FROM account_authorizations aa "
            "JOIN account_groups ag ON aa.group_id = ag.id "
            "WHERE ag.name = ? AND aa.platform = ?",
            (account_name, platform),
        )
        if existing:
            continue
        group = db.fetch_one("SELECT id FROM account_groups WHERE name = ?", (account_name,))
        if group:
            group_id = group["id"]
        else:
            # INSERT-or-IGNORE + SELECT-by-name harden (final reopen-path fix;
            # supersedes the prior UPSERT-with-RETURNING approach). The UPSERT-
            # RETURNING pattern is fragile to SQLite's documented `RETURNING`
            # quirk: when `ON CONFLICT DO UPDATE` doesn't actually change any
            # column values (no-op UPDATE — values identical), `RETURNING`
            # yields zero rows even though the row exists in the DB. Even with
            # microsecond precision, N concurrent walkers can occasionally
            # collide on identical microsecond timestamps when the system
            # clock's resolution collapses under heavy concurrent load.
            # Empirical evidence: `scripts/audit_account_groups_unique_collision.py
            # --threads 8` captured this pattern under the UPSERT-RETURNING
            # harden (1/8 thread raised `RuntimeError("INSERT did not return id")`
            # from `web_runner/db.py::PostgresDatabase.insert_returning_id`'s
            # `if not row` fallback).
            #
            # The INSERT-or-IGNORE + SELECT-by-name pair is bulletproof
            # because (a) `ON CONFLICT (name) DO NOTHING` is atomic and
            # idempotent — never raises on UNIQUE match; (b) the subsequent
            # SELECT-by-unique-key is deterministic — exactly one row matches
            # `WHERE name = ?` after the atomic INSERT-or-IGNORE step, by
            # construction. Cross-dialect correctness: `INSERT ... ON
            # CONFLICT DO NOTHING` is native PG syntax AND SQLite 3.24+
            # standard form — a single statement handles both dialects
            # without `_IS_POSTGRES` branching (the `account_authorizations`
            # INSERT below still uses dialect branching because SQLite's
            # The PG-native ``INSERT ... ON CONFLICT (name) DO NOTHING``
            # is atomic + idempotent — never raises on UNIQUE match;
            # the subsequent SELECT-by-unique-key is deterministic —
            # exactly one row matches ``WHERE name = ?`` after the
            # atomic INSERT-or-IGNORE step, by construction.
            #
            # Bonus semantic: ``account_groups.created`` is now locked
            # at row-creation time (the first walker to INSERT wins),
            # making it a stable "first_seen" timestamp. The prior
            # DO-UPDATE pattern artificially bumped ``created`` on
            # every reconciliation pass which obscured the audit trail.
            db.execute(
                "INSERT INTO account_groups (name, created) VALUES (?, ?) "
                "ON CONFLICT (name) DO NOTHING",
                (account_name, datetime.now().isoformat(timespec="microseconds")),
            )
            group = db.fetch_one(
                "SELECT id FROM account_groups WHERE name = ?",
                (account_name,),
            )
            if group is None:
                # Should be impossible: the atomic INSERT-or-IGNORE step
                # either inserted a fresh row OR no-op'd on the existing
                # one — both branches guarantee at least one row now
                # matches `WHERE name = ?`. Theoretically unreachable;
                # surface as a hard error so it shows up in CI / on-call
                # if invariant ever breaks (e.g. schema migration drops
                # the UNIQUE constraint).
                raise RuntimeError(
                    f"INSERT-or-IGNORE + SELECT returned no row for "
                    f"account_groups(name={account_name!r}); UNIQUE-invariant broken"
                )
            group_id = group["id"]  # noqa: PLW2901 — rebind to outer-scope name for symmetry with the prior branch
        db.execute(
            "INSERT INTO account_authorizations (group_id, platform, cookie_file, created) "
            "VALUES (?, ?, ?, ?) ON CONFLICT (group_id, platform) DO NOTHING",
            (group_id, platform, str(cookie_file), datetime.now().isoformat(timespec="seconds")),
        )


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


_COOKIE_STALE_HOURS = 24


def _quick_check_cookie(platform: str, account: str) -> dict:
    cookie_path = COOKIES_DIR / f"{platform}_{account}.json"
    if not cookie_path.exists():
        return {"valid": False, "reason": "no_file", "age_hours": None, "file_size": None, "stale": False}
    try:
        stat = cookie_path.stat()
        age_hours = (time.time() - stat.st_mtime) / 3600
        file_size = stat.st_size
        if file_size < 10:
            return {"valid": False, "reason": "empty_file", "age_hours": round(age_hours, 1), "file_size": file_size, "stale": False}
        with open(cookie_path) as f:
            data = json.load(f)
        if not data:
            return {"valid": False, "reason": "empty_json", "age_hours": round(age_hours, 1), "file_size": file_size, "stale": False}
        stale = age_hours > _COOKIE_STALE_HOURS
        reason = "stale" if stale else "ok"
        return {"valid": True, "reason": reason, "age_hours": round(age_hours, 1), "file_size": file_size, "stale": stale}
    except (json.JSONDecodeError, OSError):
        return {"valid": False, "reason": "invalid_json", "age_hours": None, "file_size": None, "stale": False}


def _parse_upload_result(stdout: str) -> str | None:
    for line in stdout.splitlines():
        if line.startswith("[UPLOAD_RESULT]"):
            return line[len("[UPLOAD_RESULT]"):]
    return None


def _store_result(task_id: str, stdout: str) -> None:
    """Persist the upstream CLI's ``[UPLOAD_RESULT]<json>`` payload verbatim.

    The extracted text is already valid JSON; route it through
    ``db.json_dump`` (string passthrough branch) for symmetry with the
    test-side ``json.loads``.
    """
    result_json = _parse_upload_result(stdout)
    if result_json:
        _db_update_task(task_id, result=result_json.strip())


def _run_sau(task_id: str, argv: list[str]) -> None:
    import subprocess

    # Local import avoids a circular import at module load time
    # (web_runner.notifications lazily imports utils._db_get_task).
    from web_runner.notifications import emit_event, build_event_from_result

    _db_update_task(task_id, status="running")
    log(f"[{task_id}] starting: sau {' '.join(argv)}")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "sau_cli"] + argv,
            capture_output=True,
            text=True,
            timeout=600,
            cwd=str(BASE_DIR),
        )
        if result.returncode == 0:
            _db_update_task(task_id, status="success", code=0)
            _store_result(task_id, result.stdout)
            log(f"[{task_id}] completed successfully")
            emit_event(build_event_from_result(task_id, "upload.success", result.stdout))
        else:
            error_msg = result.stderr.strip() or result.stdout.strip() or "Unknown error"
            _db_update_task(task_id, status="failed", code=result.returncode, error=error_msg)
            log(f"[{task_id}] failed with code {result.returncode}: {error_msg[:200]}")
            emit_event(
                build_event_from_result(task_id, "upload.failed", result.stdout)
            )
            _log_error_event(
                phase="cli",
                task_id=task_id,
                exc_type="NonZeroExit",
                exc_message=error_msg[:500],
                tb=result.stderr[-2000:] if result.stderr else None,
                argv=argv,
                status_code=result.returncode,
            )
    except subprocess.TimeoutExpired:
        _db_update_task(task_id, status="error", error="Task timed out after 600 seconds")
        log(f"[{task_id}] timed out")
        emit_event(
            build_event_from_result(task_id, "upload.failed", "", status="error")
        )
        _log_error_event(
            phase="cli",
            task_id=task_id,
            exc_type="TimeoutExpired",
            exc_message="Task timed out after 600 seconds",
            argv=argv,
        )
    except (OSError, ValueError) as exc:
        _db_update_task(task_id, status="error", error=str(exc))
        log(f"[{task_id}] error: {exc}")
        emit_event(
            build_event_from_result(task_id, "upload.failed", "", status="error")
        )
        _log_error_event(
            phase="cli",
            task_id=task_id,
            exc=exc,
            argv=argv,
        )


def _schedule_task(task_id: str, argv: list[str], schedule_time: datetime) -> None:
    """Schedule a task for future execution.

    Persists scheduled_at to DB so tasks survive restarts. Also sets
    a Timer as a best-effort immediate trigger if the server stays up.
    """
    # Persist to DB
    try:
        db = get_database()
        db.execute(
            "UPDATE tasks SET scheduled_at = ? WHERE task_id = ?",
            (schedule_time.isoformat(timespec="seconds"), task_id),
        )
    except Exception as exc:
        log(f"[{task_id}] warning: failed to persist scheduled_at: {exc}")

    delay = (schedule_time - datetime.now()).total_seconds()
    if delay <= 0:
        # Use new executor if available, fall back to legacy
        try:
            from web_runner.executor import PRIORITY_NORMAL, submit_task
            # Extract platform from argv
            platform = argv[0] if argv and not argv[0].startswith("-") else ""
            submit_task(_run_sau, task_id, argv, priority=PRIORITY_NORMAL, platform=platform, task_id=task_id)
        except Exception:
            task_executor.submit(_run_sau, task_id, argv)
        return
    log(f"[{task_id}] scheduled for {schedule_time.isoformat()} (in {delay:.0f}s)")
    # Best-effort timer (DB persistence is the source of truth)
    timer = threading.Timer(delay, lambda: task_executor.submit(_run_sau, task_id, argv))
    timer.daemon = True
    with _timer_lock:
        _scheduled_timers[task_id] = timer
    timer.start()


def _normalise_schedule(schedule: str | None) -> str | None:
    if not schedule:
        return None
    return schedule.replace("T", " ").strip()


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
    # ponytail: sweep BOTH upload dirs. INBOX_DIR is canonical in this
    # module (`BASE_DIR` / "videos" / "inbox", see above) so CWD-relative
    # surprises can't desync writer vs. cleanup.
    for root in (UPLOADS_DIR, INBOX_DIR):
        if not root.exists():
            continue
        for f in root.iterdir():
            if f.is_file() and (now - f.stat().st_mtime) > max_age:
                f.unlink(missing_ok=True)
                count += 1
    if count:
        print(f"[startup] cleaned {count} old temp files from {UPLOADS_DIR} + {INBOX_DIR}")


PLATFORM_CONFIG: dict[str, dict] = {
    "douyin": {"video": True, "note": True, "thumbnail": True, "thumbnail_dual": True, "product": True},
    "kuaishou": {"video": True, "note": True, "thumbnail": True},
    "xiaohongshu": {"video": True, "note": True, "thumbnail": True},
    "bilibili": {"video": True, "note": True},
    "tencent": {"video": True, "note": True, "thumbnail": True, "thumbnail_dual": True, "tencent_extra": True},
    "tiktok": {"video": True},
    "baijiahao": {"video": True},
}

DESC_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "bilibili", "tencent"}
THUMBNAIL_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "tencent"}
THUMBNAIL_DUAL_PLATFORMS = {"douyin", "tencent"}
NOTE_PLATFORMS = {p for p, cfg in PLATFORM_CONFIG.items() if cfg.get("note")}
_QR_LOGIN_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "tencent", "tiktok", "baijiahao"}
