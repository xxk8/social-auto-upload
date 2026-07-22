"""Studio (script studio) — SQLite project CRUD for local shell.

Front-end: ``sau_web/frontend/src/api/studio.ts``
"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from flask import Blueprint, Response, jsonify, request

from web_runner.db import get_connection

bp = Blueprint("studio", __name__)


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _user_id() -> int:
    # Local shell has no session user; owner_user_id defaults to 0.
    from flask import session

    return int(session.get("user_id") or 0)


def _project_row(r: dict, episodes: list | None = None) -> dict:
    return {
        "id": r["id"],
        "title": r["title"],
        "synopsis": r.get("synopsis") or "",
        "style": r.get("style"),
        "status": r.get("status") or "draft",
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
        "episodes": episodes if episodes is not None else [],
    }


def _episode_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "project_id": r["project_id"],
        "episode_no": r["episode_no"],
        "act": r.get("act"),
        "title": r.get("title") or "",
        "content": r.get("content") or "",
        "created_at": r.get("created_at"),
    }


@bp.get("/api/studio/projects")
def list_projects():
    uid = _user_id()
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT * FROM studio_projects WHERE owner_user_id = ? "
            "ORDER BY updated_at DESC, id DESC",
            (uid,),
        ).fetchall()
    return jsonify({
        "success": True,
        "data": [_project_row(r) for r in rows],
    })


@bp.post("/api/studio/projects")
def create_project():
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    synopsis = (payload.get("synopsis") or "").strip()
    style = payload.get("style")
    if not title:
        return jsonify({"success": False, "message": "title is required"}), 400
    now = _now()
    uid = _user_id()
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO studio_projects "
            "(owner_user_id, title, synopsis, style, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'draft', ?, ?)",
            (uid, title, synopsis, style, now, now),
        )
        conn.commit()
        pid = cur.lastrowid
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        row = conn.execute("SELECT * FROM studio_projects WHERE id = ?", (pid,)).fetchone()
    return jsonify({"success": True, "data": _project_row(row)})


@bp.get("/api/studio/projects/<int:project_id>")
def get_project(project_id: int):
    uid = _user_id()
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        row = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not row:
            return jsonify({"success": False, "message": "not found"}), 404
        eps = conn.execute(
            "SELECT * FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
            (project_id,),
        ).fetchall()
    return jsonify({
        "success": True,
        "data": _project_row(row, [_episode_row(e) for e in eps]),
    })


@bp.patch("/api/studio/projects/<int:project_id>")
def update_project(project_id: int):
    payload = request.get_json(silent=True) or {}
    uid = _user_id()
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        row = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not row:
            return jsonify({"success": False, "message": "not found"}), 404
        title = payload.get("title", row["title"])
        synopsis = payload.get("synopsis", row["synopsis"])
        style = payload.get("style", row["style"])
        status = payload.get("status", row["status"])
        conn.execute(
            "UPDATE studio_projects SET title=?, synopsis=?, style=?, status=?, updated_at=? "
            "WHERE id=?",
            (title, synopsis, style, status, _now(), project_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM studio_projects WHERE id = ?", (project_id,)).fetchone()
    return jsonify({"success": True, "data": _project_row(row)})


@bp.delete("/api/studio/projects/<int:project_id>")
def delete_project(project_id: int):
    uid = _user_id()
    with get_connection() as conn:
        cur = conn.execute(
            "DELETE FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({"success": False, "message": "not found"}), 404
    return jsonify({"success": True, "data": {"id": project_id}})


@bp.post("/api/studio/projects/<int:project_id>/render")
def render_project(project_id: int):
    uid = _user_id()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not row:
            return jsonify({"success": False, "message": "not found"}), 404
    return jsonify({
        "success": True,
        "data": {
            "project_id": project_id,
            "status": "queued",
            "message": "本地壳未内置 Remotion 渲染；请在本机 Remotion Studio 导出",
        },
    })


@bp.post("/api/studio/projects/<int:project_id>/episodes")
def append_episodes(project_id: int):
    payload = request.get_json(silent=True) or {}
    episodes = payload.get("episodes") or payload.get("items") or []
    if not isinstance(episodes, list) or not episodes:
        # allow single episode fields
        if payload.get("title") or payload.get("content"):
            episodes = [payload]
        else:
            return jsonify({"success": False, "message": "episodes required"}), 400
    uid = _user_id()
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        proj = conn.execute(
            "SELECT id FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        max_no = conn.execute(
            "SELECT COALESCE(MAX(episode_no), 0) AS m FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        ).fetchone()["m"]
        created = []
        now = _now()
        for ep in episodes:
            max_no += 1
            cur = conn.execute(
                "INSERT INTO studio_episodes "
                "(project_id, episode_no, act, title, content, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    project_id,
                    int(ep.get("episode_no") or max_no),
                    ep.get("act"),
                    ep.get("title") or f"第{max_no}集",
                    ep.get("content") or "",
                    now,
                ),
            )
            eid = cur.lastrowid
            created.append(conn.execute(
                "SELECT * FROM studio_episodes WHERE id = ?", (eid,)
            ).fetchone())
        conn.execute(
            "UPDATE studio_projects SET updated_at = ? WHERE id = ?",
            (now, project_id),
        )
        conn.commit()
    return jsonify({
        "success": True,
        "data": [_episode_row(e) for e in created],
    })


@bp.get("/api/studio/tts/health")
def tts_health():
    return jsonify({
        "success": True,
        "data": {
            "available": False,
            "engine": None,
            "message": "edge-tts optional; not required for local shell",
        },
    })


@bp.get("/api/studio/projects/<int:project_id>/episodes/<int:episode_no>/export")
def export_episode(project_id: int, episode_no: int):
    uid = _user_id()
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        proj = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        ep = conn.execute(
            "SELECT * FROM studio_episodes WHERE project_id = ? AND episode_no = ?",
            (project_id, episode_no),
        ).fetchone()
        if not ep:
            return jsonify({"success": False, "message": "episode not found"}), 404
    text = (
        f"# {proj['title']} — EP{episode_no}\n\n"
        f"## {ep.get('title') or ''}\n\n"
        f"{ep.get('content') or ''}\n"
    )
    return Response(
        text.encode("utf-8"),
        mimetype="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename=project_{project_id}_ep{episode_no}.md"
        },
    )


@bp.get("/api/studio/projects/<int:project_id>/export")
def export_project(project_id: int):
    uid = _user_id()
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        proj = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        eps = conn.execute(
            "SELECT * FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
            (project_id,),
        ).fetchall()
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        meta = {
            "id": proj["id"],
            "title": proj["title"],
            "synopsis": proj.get("synopsis"),
            "style": proj.get("style"),
        }
        zf.writestr("project.json", json.dumps(meta, ensure_ascii=False, indent=2))
        for ep in eps:
            name = f"episodes/ep{ep['episode_no']:02d}.md"
            body = f"# {ep.get('title') or ''}\n\n{ep.get('content') or ''}\n"
            zf.writestr(name, body)
    buf.seek(0)
    return Response(
        buf.read(),
        mimetype="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=studio_project_{project_id}.zip"
        },
    )


@bp.post("/api/studio/projects/<int:project_id>/generate")
def generate_episodes_stub(project_id: int):
    """SSE stub for AI episode generation."""
    uid = _user_id()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not row:
            return jsonify({"success": False, "message": "not found"}), 404

    def stream():
        yield 'data: {"type":"status","message":"local shell: AI generate not wired"}\n\n'
        yield 'data: {"type":"done","episodes":[]}\n\n'

    return Response(stream(), mimetype="text/event-stream")
