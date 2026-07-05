"""Publish templates CRUD routes."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from flask import Blueprint, Response, jsonify, request

from web_runner.db import get_database

bp = Blueprint("templates", __name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@bp.get("/api/templates")
def list_templates():
    """List all publish templates."""
    db = get_database()
    rows = db.fetch_all(
        "SELECT id, name, mode, snapshot, created_at, updated_at "
        "FROM publish_templates ORDER BY updated_at DESC"
    )
    templates = []
    for row in rows:
        snapshot = row.get("snapshot")
        if isinstance(snapshot, str):
            try:
                snapshot = json.loads(snapshot)
            except (json.JSONDecodeError, TypeError):
                snapshot = {}
        templates.append({
            "id": row["id"],
            "name": row["name"],
            "mode": row["mode"],
            "snapshot": snapshot,
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        })
    return jsonify({"success": True, "data": templates})


@bp.post("/api/templates")
def create_template():
    """Create a new publish template."""
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    mode = data.get("mode", "").strip()
    snapshot = data.get("snapshot", {})

    if not name:
        return jsonify({"success": False, "message": "name is required"}), 400
    if mode not in ("video", "note"):
        return jsonify({"success": False, "message": "mode must be 'video' or 'note'"}), 400

    db = get_database()
    now = _now_iso()
    snapshot_json = db.json_dump(snapshot)

    template_id = db.insert_returning_id(
        "INSERT INTO publish_templates (name, mode, snapshot, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (name, mode, snapshot_json, now, now),
    )

    return jsonify({
        "success": True,
        "data": {
            "id": template_id,
            "name": name,
            "mode": mode,
            "snapshot": snapshot,
            "created_at": now,
            "updated_at": now,
        },
    })


@bp.put("/api/templates/<int:template_id>")
def update_template(template_id: int):
    """Update an existing template."""
    data = request.get_json(silent=True) or {}
    db = get_database()

    existing = db.fetch_one(
        "SELECT id FROM publish_templates WHERE id = ?", (template_id,)
    )
    if not existing:
        return jsonify({"success": False, "message": "Template not found"}), 404

    name = data.get("name")
    snapshot = data.get("snapshot")
    now = _now_iso()

    if name is not None and snapshot is not None:
        db.execute(
            "UPDATE publish_templates SET name = ?, snapshot = ?, updated_at = ? WHERE id = ?",
            (name.strip(), db.json_dump(snapshot), now, template_id),
        )
    elif name is not None:
        db.execute(
            "UPDATE publish_templates SET name = ?, updated_at = ? WHERE id = ?",
            (name.strip(), now, template_id),
        )
    elif snapshot is not None:
        db.execute(
            "UPDATE publish_templates SET snapshot = ?, updated_at = ? WHERE id = ?",
            (db.json_dump(snapshot), now, template_id),
        )
    else:
        return jsonify({"success": False, "message": "Nothing to update"}), 400

    return jsonify({"success": True, "data": {"id": template_id, "updated_at": now}})


@bp.delete("/api/templates/<int:template_id>")
def delete_template(template_id: int):
    """Delete a template."""
    db = get_database()
    existing = db.fetch_one(
        "SELECT id FROM publish_templates WHERE id = ?", (template_id,)
    )
    if not existing:
        return jsonify({"success": False, "message": "Template not found"}), 404

    db.execute("DELETE FROM publish_templates WHERE id = ?", (template_id,))
    return jsonify({"success": True})


@bp.post("/api/templates/import")
def import_templates():
    """Import templates from JSON array."""
    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return jsonify({"success": False, "message": "Expected JSON array"}), 400

    db = get_database()
    now = _now_iso()
    imported = 0

    for item in data:
        name = item.get("name", "").strip()
        mode = item.get("mode", "").strip()
        snapshot = item.get("snapshot", {})
        if not name or mode not in ("video", "note"):
            continue
        db.execute(
            "INSERT INTO publish_templates (name, mode, snapshot, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, mode, db.json_dump(snapshot), now, now),
        )
        imported += 1

    return jsonify({"success": True, "data": {"imported": imported}})


@bp.get("/api/templates/export")
def export_templates():
    """Export all templates as JSON file download."""
    db = get_database()
    rows = db.fetch_all(
        "SELECT name, mode, snapshot FROM publish_templates ORDER BY name"
    )
    templates = []
    for row in rows:
        snapshot = row.get("snapshot")
        if isinstance(snapshot, str):
            try:
                snapshot = json.loads(snapshot)
            except (json.JSONDecodeError, TypeError):
                snapshot = {}
        templates.append({
            "name": row["name"],
            "mode": row["mode"],
            "snapshot": snapshot,
        })

    json_str = json.dumps(templates, ensure_ascii=False, indent=2)
    return Response(
        json_str,
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=sau-templates.json"},
    )
