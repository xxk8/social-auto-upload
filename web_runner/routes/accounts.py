"""Account management routes."""
from __future__ import annotations

import asyncio
import json
import os
import queue as _queue
import threading
from collections.abc import Generator
from datetime import datetime
from pathlib import Path

import patchright
from flask import Blueprint, Response, jsonify, request

from web_runner.utils import (
    _QR_LOGIN_PLATFORMS,
    _account_files,
    _db_insert_task,
    _headless_flag,
    _log_error_event,
    _new_task_id,
    _quick_check_cookie,
    _run_sau,
    log,
    task_executor,
)

bp = Blueprint("accounts", __name__)


@bp.get("/api/accounts")
def list_accounts():
    platform = request.args.get("platform")
    return jsonify({"success": True, "data": _account_files(platform)})


@bp.post("/api/accounts/delete")
def delete_account():
    from web_runner.db import get_database
    from web_runner.utils import COOKIES_DIR
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform")
    account = payload.get("account")
    if not platform or not account:
        return jsonify({"success": False, "message": "platform and account are required"}), 400
    cookie_path = COOKIES_DIR / f"{platform}_{account}.json"
    if not cookie_path.exists():
        return jsonify({"success": False, "message": f"Account file not found: {cookie_path}"}), 404
    cookie_path.unlink()
    db = get_database()
    group = db.fetch_one("SELECT id FROM account_groups WHERE name = ?", (account,))
    if group:
        db.execute("DELETE FROM account_authorizations WHERE group_id = ? AND platform = ?", (group["id"], platform))
        remaining = db.fetch_one(
            "SELECT COUNT(*) as cnt FROM account_authorizations WHERE group_id = ?", (group["id"],)
        )
        if remaining and remaining["cnt"] == 0:
            db.execute("DELETE FROM account_groups WHERE id = ?", (group["id"],))
    log(f"[accounts] deleted: {platform}_{account}.json")
    return jsonify({"success": True, "message": f"已删除 {platform}/{account}"})


@bp.post("/api/accounts/check")
def check_account():
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform")
    account = payload.get("account")
    deep = payload.get("deep", False)
    if not platform or not account:
        return jsonify({"success": False, "message": "platform and account are required"}), 400
    quick_result = _quick_check_cookie(platform, account)
    if not quick_result.get("valid"):
        # Cookie 失效：独立通道发 cookie.expired（不混进上传结果）
        try:
            from web_runner.notifications import emit_event, UploadEvent

            emit_event(
                UploadEvent(
                    event_type="cookie.expired",
                    platform=platform,
                    account=account,
                    title=f"{platform} / {account} 登录态失效（{quick_result.get('reason')}）",
                    status="error",
                )
            )
        except Exception as exc:  # noqa: BLE001 — notification must not break check
            _task_logger.warning("[notifications] cookie.expired emit failed: %s", exc)
    if not deep:
        return jsonify({"success": True, "data": {"quick": quick_result, "deep_check": None, "task_id": None}})
    argv = [platform, "check", "--account", account]
    task_id = _new_task_id("check")
    _db_insert_task(
        task_id=task_id, status="pending", platform=platform,
        action="check", account=account,
        created=datetime.now().isoformat(timespec="seconds"), argv=argv,
    )
    task_executor.submit(_run_sau, task_id, argv)
    return jsonify({"success": True, "data": {"quick": quick_result, "deep_check": "pending", "task_id": task_id}})


@bp.post("/api/accounts/check-all")
def check_all_accounts():
    accounts = _account_files()
    results = []
    for acct in accounts:
        quick_result = _quick_check_cookie(acct["platform"], acct["account_name"])
        results.append({"platform": acct["platform"], "account": acct["account_name"], "quick": quick_result})
    return jsonify({"success": True, "data": results})


@bp.post("/api/accounts/refresh-stale")
def refresh_stale_accounts():
    """SSE endpoint: find all stale/invalid authorizations and run login for each.

    Streams progress events:
      - event: start   { total, items: [{platform, account, group_name}] }
      - event: progress { index, total, platform, account, status: "running"|"success"|"failed", message? }
      - event: done    { succeeded, failed, total }
    """
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401

    from web_runner.db import get_database
    from web_runner.utils import COOKIES_DIR

    db = get_database()
    groups = db.fetch_all("SELECT * FROM account_groups ORDER BY sort_order ASC, created DESC")
    auths_by_group: dict[int, list[dict]] = {}
    if groups:
        all_auths = db.fetch_all("SELECT * FROM account_authorizations ORDER BY sort_order ASC")
        for auth in all_auths:
            auths_by_group.setdefault(auth["group_id"], []).append(auth)

    stale_items = []
    for group in groups:
        for auth in auths_by_group.get(group["id"], []):
            cookie_path = Path(auth["cookie_file"])
            quick = (
                _quick_check_cookie(auth["platform"], group["name"])
                if cookie_path.exists()
                else {"valid": False, "reason": "no_file"}
            )
            if not quick["valid"] or quick.get("stale", False):
                stale_items.append({
                    "platform": auth["platform"],
                    "account": group["name"],
                    "group_name": group["name"],
                })

    if not stale_items:
        def _empty_gen():
            yield f": {' ' * 4096}\n\n"
            yield f"event: done\ndata: {json.dumps({'succeeded': 0, 'failed': 0, 'total': 0})}\n\n"
        return Response(
            _empty_gen(), mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
        )

    q: _queue.Queue = _queue.Queue()

    def _run_batch() -> None:
        succeeded = 0
        failed = 0
        for idx, item in enumerate(stale_items):
            platform = item["platform"]
            account = item["account"]
            q.put({"event": "progress", "data": {
                "index": idx, "total": len(stale_items),
                "platform": platform, "account": account,
                "status": "running",
            }})
            try:
                argv = [platform, "login", "--account", account, "--headless"]
                task_id = _new_task_id("refresh")
                _db_insert_task(
                    task_id=task_id, status="pending", platform=platform,
                    action="refresh", account=account,
                    created=datetime.now().isoformat(timespec="seconds"), argv=argv,
                )
                _run_sau(task_id, argv)
                from web_runner.db import get_database as _gd
                _db = _gd()
                task_row = _db.fetch_one("SELECT status FROM tasks WHERE task_id = ?", (task_id,))
                if task_row and task_row["status"] == "success":
                    succeeded += 1
                    q.put({"event": "progress", "data": {
                        "index": idx, "total": len(stale_items),
                        "platform": platform, "account": account,
                        "status": "success",
                    }})
                else:
                    failed += 1
                    q.put({"event": "progress", "data": {
                        "index": idx, "total": len(stale_items),
                        "platform": platform, "account": account,
                        "status": "failed", "message": "登录失败",
                    }})
            except Exception as exc:
                failed += 1
                q.put({"event": "progress", "data": {
                    "index": idx, "total": len(stale_items),
                    "platform": platform, "account": account,
                    "status": "failed", "message": str(exc),
                }})
        q.put({"event": "done", "data": {"succeeded": succeeded, "failed": failed, "total": len(stale_items)}})

    thread = threading.Thread(target=_run_batch, daemon=True)
    thread.start()

    def generate() -> Generator:
        yield f": {' ' * 4096}\n\n"
        yield f"event: start\ndata: {json.dumps({'total': len(stale_items), 'items': stale_items}, ensure_ascii=False)}\n\n"
        while thread.is_alive() or not q.empty():
            try:
                msg = q.get(timeout=2)
                yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'], ensure_ascii=False)}\n\n"
                if msg["event"] == "done":
                    break
            except _queue.Empty:
                yield f"event: ping\ndata: {json.dumps({'ts': datetime.now().isoformat()})}\n\n"

    return Response(
        generate(), mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@bp.post("/api/accounts/login")
def login_account():
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform")
    account = payload.get("account")
    if not platform or not account:
        return jsonify({"success": False, "message": "platform and account are required"}), 400
    argv = [platform, "login", "--account", account]
    hflag = _headless_flag(payload.get("headless", True))
    if hflag == "true":
        argv.append("--headless")
    elif hflag == "false":
        argv.append("--headed")
    task_id = _new_task_id("login")
    _db_insert_task(
        task_id=task_id, status="pending", platform=platform,
        action="login", account=account,
        created=datetime.now().isoformat(timespec="seconds"), argv=argv,
    )
    task_executor.submit(_run_sau, task_id, argv)
    return jsonify({"success": True, "data": {"task_id": task_id}})


@bp.get("/api/accounts/login/sse")
def login_account_sse():
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request
    if _is_auth_enabled():
        _sse_uid = authenticate_sse_request(request)
        if _sse_uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
    platform = request.args.get("platform", "")
    account = request.args.get("account", "")
    headless_str = request.args.get("headless", "true")
    if not platform or not account:
        return jsonify({"success": False, "message": "platform and account are required"}), 400

    # Development bypass: SAU_MOCK_AUTHORIZE=true returns a synthetic
    # SSE stream so manual browser testing can exercise the full dialog
    # flow without a real browser-automation backend.
    if os.environ.get("SAU_MOCK_AUTHORIZE", "").lower() == "true":
        if platform not in _QR_LOGIN_PLATFORMS:
            # Non-QR platform — return an error SSE event so the frontend
            # falls through to the CLI manual-login path (renders the
            # CLI command block with select-text enabled, gating the
            # select-text coverage assertion in the e2e test).
            def _mock_error_generate() -> Generator:
                import time as _time
                # Audit hook for non-QR-platform SSE attempts (legitimate
                # "use CLI" probes or exploits scanning outside the QR
                # allowlist, including batch-period CI / scanner hits).
                #
                # NOTE — opt-in + dashboard discipline:
                #   • Gated behind SAU_MOCK_AUTHORIZE_LOG=true (default off).
                #     Otherwise every dev hand-test against the bilibili
                #     SSE endpoint silently writes a row into the real
                #     error_event table.
                #   • Dashboards and on-call alerts MUST query that table
                #     with `phase = 'sse_login'` STRICTLY, never
                #     `phase LIKE 'sse_login%'`, or broadening later will
                #     silently leak these `sse_login_mock` rows into
                #     production-facing alerts.
                if os.environ.get("SAU_MOCK_AUTHORIZE_LOG", "").lower() == "true":
                    _log_error_event(
                        phase="sse_login_mock",
                        platform=platform,
                        account=account,
                        action="login",
                        exc_type="NonQrPlatformAttempt",
                        exc_message=f"Platform {platform} not in _QR_LOGIN_PLATFORMS — mock returned CLI-login error event",
                    )
                yield ": " + (" " * 4096) + "\n\n"
                yield (
                    "event: error\n"
                    f"data: {json.dumps({'message': f'Platform {platform} requires CLI login: sau {platform} login --account {account}'}, ensure_ascii=False)}\n\n"
                )
                # Brief pause so the browser's EventSource dispatches the
                # error event before Flask closes the socket when the
                # generator returns. Without this the EventSource fires
                # onerror first and the browser drops the error event.
                _time.sleep(0.5)

            return Response(
                _mock_error_generate(),
                mimetype="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                    "Connection": "keep-alive",
                },
            )

        # QR platform — return a synthetic SVG QR code as an SSE
        # stream so the qrcode event fires and the <img> renders.
        _QR_SVG = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">'
            '<rect width="200" height="200" fill="#dc2626"/>'
            '<text x="50%" y="50%" text-anchor="middle" dy=".3em" '
            'fill="white" font-size="14" font-family="sans-serif">'
            f'{platform} QR Mock</text></svg>'
        )
        import base64
        _qr_data_url = "data:image/svg+xml;base64," + base64.b64encode(
            _QR_SVG.encode("utf-8")
        ).decode("ascii")

        def _mock_generate() -> Generator:
            yield ": " + (" " * 4096) + "\n\n"
            yield (
                "event: qrcode\n"
                f"data: {json.dumps({'image_path': '', 'image_data_url': _qr_data_url}, ensure_ascii=False)}\n\n"
            )
            # Keep the connection alive so the browser's EventSource
            # receives and dispatches the qrcode event BEFORE the
            # connection closes. Without this keepalive loop, Flask
            # closes the socket immediately after the generator exits,
            # EventSource fires onerror, and the frontend hides the
            # QR image behind the !errorMessage gate.
            #
            # Mirror the real `generate()` shape: non-blocking
            # _queue.get(timeout=2) as a 2s heartbeat. queue.get releases
            # the GIL during the wait AND is interruptible by a sentinel
            # `_keepalive_q.put(None)` from another thread (for graceful
            # teardown / future test cleanup), unlike `time.sleep(N)` which
            # is uninterruptible. Per-connection cost is now at most 2s of
            # worker thread occupancy instead of 30s × N connections.
            _keepalive_q: _queue.Queue = _queue.Queue()
            while True:
                try:
                    _keepalive_q.get(timeout=2)
                    break  # sentinel received → exit cleanly
                except _queue.Empty:
                    yield ": keepalive\n\n"

        return Response(
            _mock_generate(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    if platform not in _QR_LOGIN_PLATFORMS:
        return jsonify({
            "success": False,
            "message": f"Platform {platform} does not support QR-code login in web UI. Please use CLI: sau {platform} login --account {account}"
        }), 400

    q: _queue.Queue = _queue.Queue()

    def _qrcode_callback(qrcode_info: dict) -> None:
        q.put({"event": "qrcode", "data": qrcode_info})

    def _run_login() -> None:
        try:
            from cli.platforms import baijiahao, bilibili, douyin, kuaishou, tencent, tiktok, xiaohongshu
            headless = headless_str.lower() in ("true", "1", "yes")
            _LOGIN_FN_MAP = {
                "douyin": douyin.login, "kuaishou": kuaishou.login,
                "xiaohongshu": xiaohongshu.login, "tencent": tencent.login,
                "bilibili": bilibili.login, "tiktok": tiktok.login,
                "baijiahao": baijiahao.login,
            }
            login_fn = _LOGIN_FN_MAP.get(platform)
            if not login_fn:
                q.put({"event": "error", "data": {"message": f"Unsupported platform: {platform}"}})
                return
            result: dict = asyncio.run(login_fn(account, headless=headless, qrcode_callback=_qrcode_callback))
            q.put({"event": "result", "data": result})
            if not result.get("success", True):
                _log_error_event(
                    phase="sse_login", platform=platform, account=account,
                    action="login", exc_type=f'LoginFailed[{result.get("status", "unknown")}]',
                    exc_message=result.get("message", ""),
                )
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError, RuntimeError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            q.put({"event": "result", "data": {"success": False, "message": str(exc)}})
            _log_error_event(phase="sse_login", platform=platform, account=account, action="login", exc=exc)

    thread = threading.Thread(target=_run_login, daemon=True)
    thread.start()

    def generate() -> Generator:
        yield f": {' ' * 4096}\n\n"
        while thread.is_alive() or not q.empty():
            try:
                msg = q.get(timeout=2)
                yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'], ensure_ascii=False)}\n\n"
                if msg["event"] in ("result", "error"):
                    break
            except _queue.Empty:
                yield f"event: ping\ndata: {json.dumps({'ts': datetime.now().isoformat()})}\n\n"

    return Response(
        generate(), mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
