"""Founder identity management — single-owner privilege for AI API keys.

Add ``POST /api/admin/founder/transfer`` that lets the current
project founder hand the founder role over to another user. Strict
narrower-than-admin privilege: founders TOUCH AI API keys (add /
delete / list / batch) but the dashboard surface — user-list, audit
log, system overview, trends — stays admin-gated. The two roles
overlap on ``role == 'admin'`` (the founder is always an admin) but
the founder gate is enforced independently via the
``users.is_founder`` column.

Why a dedicated blueprint:
  * ``web_runner/routes/admin.py`` enforces ``@admin_required`` as
    the surface contract — every endpoint there is admin-gated.
    Putting ``@founder_required`` next to ``@admin_required`` would
    muddle that invariant for future reviewers.
  * Founder transfer requires a stronger audit story than admin
    user-list operations — the request needs to (a) verify the
    caller is the current founder, (b) atomically swap founder
    status, (c) write an immutable audit-log row with the full
    before/after pair. Keeping it isolated makes the audit story
    easier to grep when reviewing future founder-related changes.

Endpoints
---------
  POST /api/admin/founder/transfer
    Body: ``{"target_user_id": <int>}``
    Caller gate: ``@login_required`` + inline founder check
    Effect:   - self.is_founder = FALSE
              - target.is_founder = TRUE
              - audit_log row with action='founder_transfer'
    Atomicity: wrapped in ``db.transaction()`` so the swap is
      either fully applied or fully rolled back; partial-unique-
      index on `users(is_founder) WHERE is_founder = TRUE` adds
      a defense-in-depth uniqueness guarantee at the schema layer.

The endpoint intentionally mirrors the CREATE/DELETE pairs in the
admin role-mutation flow (``/api/auth/users/<id>/role``) so an
operator reviewing the founder transfer doesn't have to context-
switch between two different audit-log call shapes — both write
JSON-formatted ``detail`` + ``target_user_id`` + ``admin_user_id``
into the same ``admin_audit_log`` table.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import psycopg.errors
from flask import Blueprint, jsonify, request

from web_runner.db import get_database
from web_runner.routes.auth import _current_user_id, _current_user_is_founder, _is_auth_enabled

bp = Blueprint("founder", __name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@bp.post("/api/admin/founder/transfer")
def transfer_founder():
    """Atomically transfer founder ownership to ``target_user_id``.

    Caller must be the current founder (or the synthetic-admin when
    ``SAU_AUTH_ENABLED=false``). Returns 403 to non-founders, 400 to
    bad input, 404 if the target user doesn't exist, 409 if the
    caller is somehow NOT marked founder despite the role check
    passing (defensive — should never fire), 200 with the post-
    transfer user pair on success.

    Audit log:
      ``action='founder_transfer'`` with ``detail`` JSON containing
      ``old_founder_id``, ``old_founder_email``, ``new_founder_id``,
      ``new_founder_email``. The audit row is written AFTER the
      transaction commits — if the mutation failed (e.g. unique
      index violation on a concurrent transfer) the audit row is
      NOT written, so an operator reviewing the log sees a 1:1
      correspondence between "I see an audit row" and "the swap
      actually landed."

    Atomicity:
      ``with db.transaction() as tx`` wraps both UPDATEs so a
      partial unique-index violation (e.g. a racing concurrent
      transfer attempt) rolls back the would-be partial state
      instead of leaving the system with two founders. The schema
      constraint ``uniq_users_one_founder`` catches this at DB
      level; the transaction wraps so the rollback happens cleanly.
    """
    if _is_auth_enabled():
        if _current_user_id() is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        if not _current_user_is_founder():
            return jsonify({"success": False, "message": "仅项目创始人可执行此操作"}), 403

    payload = request.get_json(silent=True) or {}
    raw_target = payload.get("target_user_id")
    try:
        target_id = int(raw_target)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "target_user_id 必须是整数"}), 400
    if target_id <= 0:
        return jsonify({"success": False, "message": "target_user_id 必须大于 0"}), 400

    db = get_database()

    # Authenticated caller — look up the canonical uid + email pair.
    # When auth is disabled the synthetic caller (id=0, email=local@
    # sau.dev) ends up as the prior founder; in that branch we still
    # permit the transfer so dev/CI tooling can swap the synthetic
    # founder to a non-existent user without a real session.
    caller_uid = _current_user_id() or 0

    if target_id == caller_uid and _is_auth_enabled():
        return jsonify({"success": False, "message": "不能将 Founder 身份移交给自己"}), 400

    # Fetch the target row BEFORE the transaction opens so 404 is
    # surfaced as a clean response (not as a tx rollback log noise).
    target = db.fetch_one(
        "SELECT id, email, role, is_founder FROM users WHERE id = ?",
        (target_id,),
    )
    if not target:
        return jsonify({"success": False, "message": "目标用户不存在"}), 404

    if bool(target.get("is_founder")):
        return jsonify({"success": False, "message": "目标用户已经是 Founder"}), 400

    # Capture prior-founder before-state for the audit row.
    prior_founder = db.fetch_one(
        "SELECT id, email, is_founder FROM users WHERE is_founder = TRUE LIMIT 1"
    )

    try:
        with db.transaction() as tx:
            # Disable the prior founder first so a concurrent rival
            # attempt hits a transient 0-founder state rather than a
            # 2-founder state. PG transaction isolation (READ
            # COMMITTED default) lets the partial-unique index
            # reject racing writers before this transaction commits.
            # The race-conflict 409 path below catches IntegrityError
            # on the partial-unique index when a rival transfer lands
            # between our pre-fetch and our UPDATE — at which point
            # the transaction rolls back and we surface a clean 409.
            if prior_founder and prior_founder["id"] != target_id:
                tx.execute(
                    "UPDATE users SET is_founder = FALSE WHERE id = ?",
                    (prior_founder["id"],),
                )
            tx.execute(
                "UPDATE users SET is_founder = TRUE WHERE id = ?",
                (target_id,),
            )
    except psycopg.errors.IntegrityError as exc:
        # Partial-unique-index violation on users(is_founder) — the
        # schema's partial UNIQUE index catches concurrent rival
        # transfers; the txn already rolled back. Log + respond 409
        # so the client knows it's a concurrency conflict rather than
        # a logic bug.
        from utils.log import logger

        logger.warning(
            f"[founder] transfer conflict (target_id={target_id}, "
            f"psycopg_class={type(exc).__name__}): {exc}",
        )
        return jsonify({
            "success": False,
            "message": "Founder 移交失败：并发冲突，请重试",
        }), 409

    # Audit log post-commit — guarantees 1:1 with the actual swap.
    now = _now_iso()
    # ``actor_email`` derives from the prior-founder row when auth is
    # disabled (synthetic session) rather than dropping in a literal
    # placeholder; if the prior-founder row was None (cold-transfer on
    # a system with no prior founder), we use the synthetic-admin
    # canonical email so the audit row is still grep-friendly.
    actor_email = (prior_founder or {}).get("email") or "local@sau.dev"
    detail = json.dumps({
        "old_founder_id": (prior_founder or {}).get("id"),
        "old_founder_email": (prior_founder or {}).get("email"),
        "new_founder_id": target["id"],
        "new_founder_email": target["email"],
        "actor_user_id": caller_uid,
        "actor_email": actor_email,
    }, ensure_ascii=False)
    db.execute(
        "INSERT INTO admin_audit_log "
        "(admin_user_id, target_user_id, action, detail, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (caller_uid, target_id, "founder_transfer", detail, now),
    )

    return jsonify({
        "success": True,
        "data": {
            "prior_founder": {
                "id": (prior_founder or {}).get("id"),
                "email": (prior_founder or {}).get("email"),
            },
            "new_founder": {
                "id": target["id"],
                "email": target["email"],
            },
            "transferred_at": now,
        },
    })
