"""Content templates — Postgres-backed publish templates.

Front-end: ``api.templates.*`` / ``useTemplatesStore``.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from flask import Blueprint, Response, jsonify, request

from web_runner.db import get_connection

bp = Blueprint("templates", __name__)


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _row(r: dict) -> dict:
    snap = r.get("snapshot") or "{}"
    try:
        snapshot = json.loads(snap) if isinstance(snap, str) else snap
    except json.JSONDecodeError:
        snapshot = {}
    return {
        "id": r["id"],
        "name": r["name"],
        "mode": r.get("mode") or "video",
        "snapshot": snapshot,
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
    }


@bp.get("/api/templates")
def list_templates():
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT * FROM content_templates ORDER BY updated_at DESC, id DESC"
        ).fetchall()
    return jsonify({"success": True, "data": [_row(r) for r in rows]})


@bp.post("/api/templates")
def create_template():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    mode = (payload.get("mode") or "video").strip()
    snapshot = payload.get("snapshot") or {}
    if not name:
        return jsonify({"success": False, "message": "name is required"}), 400
    now = _now()
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO content_templates (name, mode, snapshot, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, mode, json.dumps(snapshot, ensure_ascii=False), now, now),
        )
        conn.commit()
        tid = cur.lastrowid
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        row = conn.execute("SELECT * FROM content_templates WHERE id = ?", (tid,)).fetchone()
    return jsonify({"success": True, "data": _row(row)})


@bp.put("/api/templates/<int:template_id>")
def update_template(template_id: int):
    payload = request.get_json(silent=True) or {}
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        row = conn.execute("SELECT * FROM content_templates WHERE id = ?", (template_id,)).fetchone()
        if not row:
            return jsonify({"success": False, "message": "not found"}), 404
        name = payload.get("name", row["name"])
        snapshot = payload.get("snapshot")
        if snapshot is None:
            snap_s = row["snapshot"]
        else:
            snap_s = json.dumps(snapshot, ensure_ascii=False)
        conn.execute(
            "UPDATE content_templates SET name = ?, snapshot = ?, updated_at = ? WHERE id = ?",
            (name, snap_s, _now(), template_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM content_templates WHERE id = ?", (template_id,)).fetchone()
    return jsonify({"success": True, "data": _row(row)})


@bp.delete("/api/templates/<int:template_id>")
def delete_template(template_id: int):
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM content_templates WHERE id = ?", (template_id,))
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({"success": False, "message": "not found"}), 404
    return jsonify({"success": True, "data": {"id": template_id}})


@bp.post("/api/templates/import")
def import_templates():
    payload = request.get_json(silent=True) or []
    if not isinstance(payload, list):
        return jsonify({"success": False, "message": "expected array"}), 400
    now = _now()
    created = 0
    with get_connection() as conn:
        for item in payload:
            name = (item.get("name") or "").strip()
            if not name:
                continue
            mode = item.get("mode") or "video"
            snapshot = item.get("snapshot") or {}
            conn.execute(
                "INSERT INTO content_templates (name, mode, snapshot, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (name, mode, json.dumps(snapshot, ensure_ascii=False), now, now),
            )
            created += 1
        conn.commit()
    return jsonify({"success": True, "data": {"imported": created}})


@bp.get("/api/templates/export")
def export_templates():
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute("SELECT * FROM content_templates ORDER BY id").fetchall()
    data = json.dumps([_row(r) for r in rows], ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        data,
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=templates.json"},
    )


@bp.post("/api/templates/<int:template_id>/apply")
def apply_template(template_id: int):
    """Fill template prompt with variables; optional AI polish if keys exist."""
    payload = request.get_json(silent=True) or {}
    variables = payload.get("variables") or {}
    platform = payload.get("platform") or ""
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        row = conn.execute("SELECT * FROM content_templates WHERE id = ?", (template_id,)).fetchone()
        if not row:
            return jsonify({"success": False, "message": "not found"}), 404
        try:
            snapshot = json.loads(row["snapshot"] or "{}")
        except json.JSONDecodeError:
            snapshot = {}

    prompt = snapshot.get("prompt") or snapshot.get("template") or ""
    if isinstance(prompt, dict):
        prompt = prompt.get("prompt") or ""
    text = str(prompt)
    for k, v in variables.items():
        text = text.replace("{" + str(k) + "}", str(v))
        text = text.replace("{{" + str(k) + "}}", str(v))

    title = snapshot.get("title") or row.get("name") or "未命名"
    tags = snapshot.get("tags") or []
    if isinstance(tags, str):
        tags = [t for t in tags.replace("，", ",").split(",") if t.strip()]
    description = text or snapshot.get("description") or snapshot.get("desc") or ""

    # Optional AI rewrite
    try:
        from web_runner.routes.studio import _complete_openrouter

        ai = _complete_openrouter(
            [
                {
                    "role": "system",
                    "content": "你是社交媒体文案助手。根据用户材料输出 JSON："
                    '{"title":"...","description":"...","tags":["a","b"]} 不要其它文字。',
                },
                {
                    "role": "user",
                    "content": f"平台：{platform}\n模板名：{row.get('name')}\n素材：\n{text or description}",
                },
            ],
            max_tokens=800,
        )
        if ai:
            import re
            m = re.search(r"\{[\s\S]*\}", ai)
            if m:
                data = json.loads(m.group(0))
                title = data.get("title") or title
                description = data.get("description") or description
                if isinstance(data.get("tags"), list):
                    tags = data["tags"]
    except Exception:
        pass

    return jsonify({
        "success": True,
        "data": {
            "title": title,
            "description": description,
            "tags": tags,
            "platform": platform,
        },
    })
