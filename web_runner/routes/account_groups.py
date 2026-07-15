"""Account groups routes."""
from __future__ import annotations

import os
import time
from datetime import datetime
from pathlib import Path

import psycopg.errors
from flask import Blueprint, jsonify, request

from web_runner.db import get_database
from web_runner.routes.auth import _current_user_id
from web_runner.utils import (
    COOKIES_DIR,
    _quick_check_cookie,
    _validate_group_name,
    log,
)

bp = Blueprint("account_groups", __name__)


@bp.get("/api/account-groups")
def list_account_groups():
    db = get_database()
    with db.transaction() as tx:
        groups = tx.fetch_all(
            "SELECT * FROM account_groups ORDER BY sort_order ASC, created DESC"
        )
        if not groups:
            return jsonify({"success": True, "data": []})
        all_auths = tx.fetch_all(
            "SELECT * FROM account_authorizations ORDER BY sort_order ASC"
        )
        auths_by_group: dict[int, list[dict]] = {}
        for auth in all_auths:
            auths_by_group.setdefault(auth["group_id"], []).append(auth)
        result = []
        for group in groups:
            authorizations = []
            for auth in auths_by_group.get(group["id"], []):
                cookie_path = Path(auth["cookie_file"])
                quick = (
                    _quick_check_cookie(auth["platform"], group["name"])
                    if cookie_path.exists()
                    else {"valid": False, "reason": "no_file"}
                )
                authorizations.append({
                    "id": auth["id"],
                    "platform": auth["platform"],
                    "cookie_file": auth["cookie_file"],
                    "valid": quick["valid"],
                    "reason": quick.get("reason"),
                    "age_hours": quick.get("age_hours"),
                    "stale": quick.get("stale", False),
                    "health": auth.get("last_health") or "unknown",
                    "last_check_at": auth.get("last_check_at"),
                    "consecutive_failures": auth.get("consecutive_failures") or 0,
                })
            result.append({
                "id": group["id"],
                "name": group["name"],
                "created": group["created"],
                "authorizations": authorizations,
            })
    return jsonify({"success": True, "data": result})


@bp.post("/api/account-groups")
def create_account_group():
    payload = request.get_json(silent=True) or {}
    valid, cleaned_or_msg = _validate_group_name(payload.get("name"))
    if not valid:
        return jsonify({"success": False, "message": cleaned_or_msg}), 400
    name = cleaned_or_msg
    db = get_database()
    owner_id = _current_user_id()
    try:
        group_id = db.insert_returning_id(
            "INSERT INTO account_groups (name, created, owner_user_id) VALUES (?, ?, ?)",
            (name, datetime.now().isoformat(timespec="seconds"), owner_id),
        )
    except psycopg.errors.IntegrityError:
        # UNIQUE collision on account_groups.name — surface 409 so the
        # client can distinguish from a logic bug. (psycopg's
        # IntegrityError is the parent of UniqueViolation.)
        return jsonify({"success": False, "message": "分组名已存在"}), 409
    log(f"[account-groups] created: {name}")
    return jsonify({"success": True, "data": {"id": group_id, "name": name}})


@bp.delete("/api/account-groups/<int:group_id>")
def delete_account_group(group_id: int):
    db = get_database()
    with db.transaction() as tx:
        group = tx.fetch_one("SELECT * FROM account_groups WHERE id = ?", (group_id,))
        if not group:
            return jsonify({"success": False, "message": "Group not found"}), 404
        auths = tx.fetch_all(
            "SELECT * FROM account_authorizations WHERE group_id = ?",
            (group_id,),
        )
        for auth in auths:
            cookie_path = Path(auth["cookie_file"])
            if cookie_path.exists():
                cookie_path.unlink()
        tx.execute(
            "DELETE FROM account_authorizations WHERE group_id = ?",
            (group_id,),
        )
        tx.execute("DELETE FROM account_groups WHERE id = ?", (group_id,))
    log(f"[account-groups] deleted: {group['name']}")
    return jsonify({"success": True, "message": f"Group '{group['name']}' deleted"})


@bp.post("/api/account-groups/<int:group_id>/rename")
def rename_account_group(group_id: int):
    payload = request.get_json(silent=True) or {}
    valid, cleaned_or_msg = _validate_group_name(payload.get("name"))
    if not valid:
        return jsonify({"success": False, "message": cleaned_or_msg}), 400
    new_name = cleaned_or_msg
    db = get_database()
    group = db.fetch_one(
        "SELECT id, name FROM account_groups WHERE id = ?", (group_id,)
    )
    if not group:
        return jsonify({"success": False, "message": "分组不存在"}), 404
    old_name = group["name"]
    if old_name == new_name:
        return jsonify({"success": True, "data": {"id": group_id, "name": new_name}})
    auth_rows = db.fetch_all(
        "SELECT id, platform, cookie_file FROM account_authorizations WHERE group_id = ?",
        (group_id,),
    )
    rename_plan: list[tuple[Path, Path]] = []
    for auth in auth_rows:
        old_path = Path(auth["cookie_file"])
        new_path = COOKIES_DIR / f"{auth['platform']}_{new_name}.json"
        if old_path.exists():
            rename_plan.append((old_path, new_path))
    renamed_so_far: list[tuple[Path, Path]] = []
    for old_path, new_path in rename_plan:
        try:
            os.rename(old_path, new_path)
            renamed_so_far.append((old_path, new_path))
        except OSError as e:
            for op, np in reversed(renamed_so_far):
                try:
                    os.rename(np, op)
                except OSError:
                    pass
            log(f"[account-groups] rename FAIL: {old_path} -> {new_path}: {e}")
            return jsonify({
                "success": False,
                "message": f"无法移动 cookie 文件 {old_path.name}，文件可能正在被使用",
            }), 409
    # Disk moves succeeded; commit DB atomically. If the DB raises
    # IntegrityError (e.g. duplicate name from a concurrent request),
    # the transaction() ctx-mgr rolls back the group + authorizations
    # update and we revert the disk renames below.
    try:
        with db.transaction() as tx:
            tx.execute(
                "UPDATE account_groups SET name = ? WHERE id = ?",
                (new_name, group_id),
            )
            for auth in auth_rows:
                new_path = COOKIES_DIR / f"{auth['platform']}_{new_name}.json"
                tx.execute(
                    "UPDATE account_authorizations SET cookie_file = ? WHERE id = ?",
                    (str(new_path), auth["id"]),
                )
    except psycopg.errors.IntegrityError:
        for op, np in reversed(renamed_so_far):
            try:
                os.rename(np, op)
            except OSError as revert_exc:
                # OS-guarded reverse rename failed (e.g. another
                # process is now locking the file). Surface a log
                # entry so an operator can see when half-renames
                # leaked through — don't try to fix here because
                # the operator can manually clean up while we return
                # the API error.
                log(
                    f"[account-groups] rename-reversal FAIL: "
                    f"group_id={group_id}, name={old_name!r}->{new_name!r}, "
                    f"file {op} -> {np}: {revert_exc}"
                )
        return jsonify({"success": False, "message": "分组名已存在"}), 409
    log(f"[account-groups] renamed: {old_name} -> {new_name} (id={group_id})")
    return jsonify({"success": True, "data": {"id": group_id, "name": new_name}})


@bp.post("/api/account-groups/<int:group_id>/authorize")
def authorize_account_group(group_id: int):
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform")
    if not platform:
        return jsonify({"success": False, "message": "platform is required"}), 400

    # Development bypass: SAU_MOCK_AUTHORIZE=true skips the
    # "already authorized" guard and returns a synthetic success
    # so manual browser testing can exercise the full authorize
    # flow without real platform credentials.
    if os.environ.get("SAU_MOCK_AUTHORIZE", "").lower() == "true":
        db = get_database()
        group = db.fetch_one(
            "SELECT * FROM account_groups WHERE id = ?", (group_id,)
        )
        group_name = group["name"] if group else "mock-group"
        cookie_file = COOKIES_DIR / f"{platform}_{group_name}.json"
        log(f"[account-groups] mock-authorize: {group_name} -> {platform}")
        return jsonify({
            "success": True,
            "data": {
                "group_name": group_name,
                "platform": platform,
                "cookie_file": str(cookie_file),
            },
        })
    # Check account quota before allowing new authorization
    try:
        from web_runner.middleware.usage_metering import check_account_quota
        from web_runner.routes.auth import _current_user_id, _is_auth_enabled
        if _is_auth_enabled():
            uid = _current_user_id()
            if uid:
                allowed, limit, used = check_account_quota(uid)
                if not allowed:
                    return jsonify({
                        "success": False,
                        "error": "quota_exceeded",
                        "action": "accounts",
                        "limit": limit,
                        "used": used,
                        "message": f"已达到账号数量上限 ({limit}个)，升级 Pro 解锁无限账号",
                    }), 429
    except Exception:
        pass
    db = get_database()
    with db.transaction() as tx:
        group = tx.fetch_one(
            "SELECT * FROM account_groups WHERE id = ?", (group_id,)
        )
        if not group:
            return jsonify({"success": False, "message": "Group not found"}), 404
        existing = tx.fetch_one(
            "SELECT * FROM account_authorizations "
            "WHERE group_id = ? AND platform = ?",
            (group_id, platform),
        )
        if existing:
            return jsonify({
                "success": False,
                "message": f"Platform '{platform}' already authorized",
            }), 409
    cookie_file = COOKIES_DIR / f"{platform}_{group['name']}.json"
    return jsonify({
        "success": True,
        "data": {
            "group_name": group["name"],
            "platform": platform,
            "cookie_file": str(cookie_file),
        },
    })


@bp.post("/api/account-groups/<int:group_id>/confirm-authorize")
def confirm_authorize_account_group(group_id: int):
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform")
    if not platform:
        return jsonify({"success": False, "message": "platform is required"}), 400
    db = get_database()
    group = db.fetch_one(
        "SELECT * FROM account_groups WHERE id = ?", (group_id,)
    )
    if not group:
        return jsonify({"success": False, "message": "Group not found"}), 404
    cookie_file = COOKIES_DIR / f"{platform}_{group['name']}.json"
    for _ in range(10):
        if cookie_file.exists():
            quick = _quick_check_cookie(platform, group["name"])
            if quick["valid"]:
                break
        time.sleep(0.5)
    else:
        return jsonify({
            "success": False,
            "message": "Cookie file not found or invalid after login",
        }), 400
    # INSERT-or-UPDATE (last-writer-wins by design). PK collision on
    # INSERT falls through to UPDATE which targets the existing row.
    # This is intentionally NOT wrapped in a tx block: concurrent
    # duplicate-confirms WILL race on the bare INSERT/UPDATE pair,
    # and the race outcome is "last-writer cookie_file wins" — a
    # cookie-path overwrite is acceptable for this endpoint because
    # the cookie content is still valid for either writer. If you
    # need stricter serialization, wrap both calls in
    # `with db.transaction() as tx:` so concurrent readers see the
    # same row state and the upsert serializes on the `(group_id,
    # platform)` UNIQUE constraint instead.
    #
    # DO NOT generalize this pattern to other endpoints without
    # re-evaluating the race semantics for that route — the trade-off
    # here is endpoint-specific (cookie overwrite is harmless; data
    # corruption elsewhere is not).
    try:
        db.execute(
            "INSERT INTO account_authorizations "
            "(group_id, platform, cookie_file, created) VALUES (?, ?, ?, ?)",
            (group_id, platform, str(cookie_file), datetime.now().isoformat(timespec="seconds")),
        )
    except psycopg.errors.IntegrityError:
        # Pre-existing row — fall through to UPDATE which targets
        # the existing row by (group_id, platform). The psycopg
        # IntegrityError is the parent of UniqueViolation, so this
        # catches the PK collision cleanly.
        db.execute(
            "UPDATE account_authorizations SET cookie_file = ?, created = ? "
            "WHERE group_id = ? AND platform = ?",
            (
                str(cookie_file),
                datetime.now().isoformat(timespec="seconds"),
                group_id,
                platform,
            ),
        )
    log(f"[account-groups] authorized: {group['name']} -> {platform}")
    return jsonify({
        "success": True,
        "message": f"Platform '{platform}' authorized for group '{group['name']}'",
    })


@bp.delete("/api/account-groups/<int:group_id>/authorize/<platform>")
def remove_authorization(group_id: int, platform: str):
    db = get_database()
    with db.transaction() as tx:
        group = tx.fetch_one(
            "SELECT * FROM account_groups WHERE id = ?", (group_id,)
        )
        if not group:
            return jsonify({"success": False, "message": "Group not found"}), 404
        auth = tx.fetch_one(
            "SELECT * FROM account_authorizations "
            "WHERE group_id = ? AND platform = ?",
            (group_id, platform),
        )
        if not auth:
            return jsonify({
                "success": False,
                "message": "Authorization not found",
            }), 404
        cookie_path = Path(auth["cookie_file"])
        if cookie_path.exists():
            cookie_path.unlink()
        tx.execute(
            "DELETE FROM account_authorizations WHERE id = ?",
            (auth["id"],),
        )
    log(f"[account-groups] removed authorization: {group['name']} -> {platform}")
    return jsonify({
        "success": True,
        "message": f"Platform '{platform}' authorization removed",
    })


@bp.post("/api/account-groups/reorder")
def reorder_account_groups():
    payload = request.get_json(silent=True) or {}
    group_ids = payload.get("group_ids", [])
    if not group_ids:
        return jsonify({"success": False, "message": "group_ids is required"}), 400
    db = get_database()
    with db.transaction() as tx:
        for idx, group_id in enumerate(group_ids):
            tx.execute(
                "UPDATE account_groups SET sort_order = ? WHERE id = ?",
                (idx, group_id),
            )
    log(f"[account-groups] reordered: {len(group_ids)} groups")
    return jsonify({"success": True, "message": "Groups reordered successfully"})


@bp.post("/api/account-groups/<int:group_id>/reorder-authorizations")
def reorder_authorizations(group_id: int):
    payload = request.get_json(silent=True) or {}
    auth_ids = payload.get("auth_ids", [])
    if not auth_ids:
        return jsonify({"success": False, "message": "auth_ids is required"}), 400
    db = get_database()
    with db.transaction() as tx:
        for idx, auth_id in enumerate(auth_ids):
            tx.execute(
                "UPDATE account_authorizations SET sort_order = ? "
                "WHERE id = ? AND group_id = ?",
                (idx, auth_id, group_id),
            )
    log(
        f"[account-groups] reordered authorizations: group {group_id}, "
        f"{len(auth_ids)} items"
    )
    return jsonify({"success": True, "message": "Authorizations reordered successfully"})


@bp.get("/api/account-authorizations/<int:auth_id>/health")
def get_authorization_health(auth_id: int):
    """Return the persisted health status for a single authorization."""
    db = get_database()
    auth = db.fetch_one(
        "SELECT aa.id, aa.last_health, aa.last_check_at, aa.consecutive_failures, "
        "aa.next_check_at, ag.name as account_name, aa.platform "
        "FROM account_authorizations aa "
        "JOIN account_groups ag ON aa.group_id = ag.id "
        "WHERE aa.id = ?",
        (auth_id,),
    )
    if not auth:
        return jsonify({"success": False, "message": "Authorization not found"}), 404
    return jsonify({
        "success": True,
        "data": {
            "id": auth["id"],
            "platform": auth["platform"],
            "account": auth["account_name"],
            "health": auth.get("last_health") or "unknown",
            "last_check_at": auth.get("last_check_at"),
            "last_real_check_at": auth.get("last_real_check_at"),
            "consecutive_failures": auth.get("consecutive_failures") or 0,
            "next_check_at": auth.get("next_check_at"),
        },
    })


@bp.post("/api/account-authorizations/<int:auth_id>/health-check")
def trigger_authorization_health_check(auth_id: int):
    """Queue an immediate health check for a single authorization.

    Real browser checks can take tens of seconds, so the check is run
    in a background thread and the endpoint returns 202 Accepted
    immediately. The frontend can poll ``GET /api/account-authorizations/<id>/health``
    or refetch the account group list to see the updated status.
    """
    import threading

    from web_runner.health_monitor import check_authorization_now

    def _run_check() -> None:
        try:
            check_authorization_now(auth_id)
        except Exception as exc:  # noqa: BLE001
            log(f"[health] background check failed for auth {auth_id}: {exc}")

    try:
        db = get_database()
        auth = db.fetch_one(
            "SELECT id FROM account_authorizations WHERE id = ?",
            (auth_id,),
        )
        if not auth:
            return jsonify({"success": False, "message": "Authorization not found"}), 404
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "message": str(exc)}), 500

    threading.Thread(target=_run_check, daemon=True, name=f"sau-health-check-{auth_id}").start()
    return jsonify({
        "success": True,
        "message": "Health check queued",
        "data": {"auth_id": auth_id},
    }), 202
