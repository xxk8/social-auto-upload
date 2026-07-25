"""Studio (script studio) — Postgres project CRUD for local shell.

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
    """Produce a local export package (zip of episode scripts).

    Full Remotion headless render is optional and requires
    ``sau_web/frontend/remotion_studio/render.mjs``. Local shell always
    returns a downloadable zip so the UI flow completes.
    """
    import json as _json
    from pathlib import Path as _Path

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

    out_dir = _Path(__file__).resolve().parents[2] / "media" / "studio" / str(project_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / "render_package.zip"
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "project.json",
            _json.dumps(
                {
                    "id": proj["id"],
                    "title": proj["title"],
                    "synopsis": proj.get("synopsis"),
                    "style": proj.get("style"),
                    "episodes": [_episode_row(e) for e in eps],
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
        for ep in eps:
            zf.writestr(
                f"episodes/ep{ep['episode_no']:02d}_{ep.get('act') or ''}.md",
                f"# {ep.get('title') or ''}\n\n{ep.get('content') or ''}\n",
            )
        zf.writestr(
            "README.txt",
            "Local shell render package.\n"
            "Open episode markdown in any editor, or plug into Remotion later.\n",
        )
    zip_path.write_bytes(buf.getvalue())
    with get_connection() as conn:
        conn.execute(
            "UPDATE studio_projects SET status = ?, updated_at = ? WHERE id = ?",
            ("rendered", _now(), project_id),
        )
        conn.commit()

    return jsonify({
        "success": True,
        "data": {
            "project_id": project_id,
            "status": "completed",
            "url": f"/api/studio/render/{project_id}/render_package.zip",
            "message": "已生成脚本导出包（本地壳；完整视频渲染可接 Remotion）",
            "episodes": len(eps),
        },
    })


@bp.get("/api/studio/render/<int:project_id>/<path:filename>")
def studio_render_file(project_id: int, filename: str):
    from pathlib import Path as _Path
    from flask import send_from_directory

    out_dir = _Path(__file__).resolve().parents[2] / "media" / "studio" / str(project_id)
    safe = _Path(filename).name
    if not (out_dir / safe).is_file():
        return jsonify({"success": False, "message": "file not found"}), 404
    return send_from_directory(out_dir, safe, as_attachment=True)



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



def _complete_openrouter(messages: list[dict], model: str | None = None, max_tokens: int = 2500) -> str | None:
    """Non-streaming chat completion using the same OpenRouter keys as AI routes."""
    try:
        from web_runner.routes import ai as ai_mod
        import requests as http_requests
    except Exception:
        return None
    if not ai_mod._has_any_api_key():
        return None
    key = ai_mod._get_next_key()
    if not key:
        return None
    model = model or "google/gemma-4-26b-a4b-it:free"
    try:
        resp = http_requests.post(
            f"{ai_mod.OPENROUTE_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.8,
            },
            timeout=(10, 120),
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        return (data.get("choices") or [{}])[0].get("message", {}).get("content") or None
    except Exception:
        return None


def _parse_four_acts(text: str, title: str, synopsis: str, style: str) -> list[tuple[str, str, str]]:
    """Best-effort parse of AI markdown into 起承转合; always returns 4 acts."""
    import re
    acts_order = ["起", "承", "转", "合"]
    found: dict[str, str] = {}
    # Split on headings that contain 起/承/转/合
    parts = re.split(r"(?m)^(?:#+\s*)?(?:【)?([起承转合])(?:】)?(?:\s*[·.\-—:].*)?$", text or "")
    # parts: [pre, act, body, act, body, ...]
    i = 1
    while i + 1 < len(parts):
        act = parts[i].strip()
        body = (parts[i + 1] or "").strip()
        if act in acts_order and body:
            found[act] = body
        i += 2
    result = []
    defaults = {
        "起": f"开篇。主题：{synopsis}\n风格：{style}\n建立人物与冲突。",
        "承": f"发展。在「{synopsis}」之上推进情节，信息量递进。",
        "转": f"转折。围绕「{synopsis}」制造反转与高潮。",
        "合": f"收束。呼应主题「{synopsis}」，给出明确结局。",
    }
    for act in acts_order:
        content = found.get(act) or defaults[act]
        # strip leading title lines
        content = re.sub(r"^(?:#+\s*)?.{0,40}\n+", "", content, count=1).strip() or defaults[act]
        result.append((act, f"{title} · {act}", content[:4000]))
    return result


@bp.post("/api/studio/projects/<int:project_id>/generate")
def generate_episodes(project_id: int):
    """SSE: scaffold 起承转合 episodes.

    Front-end listens for ``event: generation_done`` then invalidates
    the project query. See ``sse.ts`` + StudioDetailPage.
    """
    import json as _json

    uid = _user_id()
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        proj = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        title = proj.get("title") or "未命名项目"
        synopsis = (proj.get("synopsis") or "").strip() or "（无简介）"
        style = proj.get("style") or "默认"

        conn.execute("DELETE FROM studio_episodes WHERE project_id = ?", (project_id,))

        ai_text = _complete_openrouter(
            [
                {
                    "role": "system",
                    "content": (
                        "你是短视频/短剧分集编剧。请严格用中文输出四幕：起、承、转、合。"
                        "每一幕用单独标题行以「起」「承」「转」「合」开头，下面写 80-200 字正文。"
                        "不要输出其它解释。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"项目标题：{title}\n"
                        f"简介：{synopsis}\n"
                        f"风格：{style}\n"
                        "请生成四幕分集文案。"
                    ),
                },
            ]
        )
        if ai_text:
            acts = _parse_four_acts(ai_text, title, synopsis, style)
            gen_source = "ai"
        else:
            acts = [
                ("起", f"{title} · 起", f"开篇。主题：{synopsis}\n风格：{style}\n建立人物与冲突。"),
                ("承", f"{title} · 承", f"发展。在「{synopsis}」之上推进情节，信息量递进。"),
                ("转", f"{title} · 转", f"转折。围绕「{synopsis}」制造反转与高潮。"),
                ("合", f"{title} · 合", f"收束。呼应主题「{synopsis}」，给出明确结局。"),
            ]
            gen_source = "scaffold"

        now = _now()
        created = []
        for i, (act, etitle, content) in enumerate(acts, start=1):
            cur = conn.execute(
                "INSERT INTO studio_episodes "
                "(project_id, episode_no, act, title, content, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (project_id, i, act, etitle, content, now),
            )
            eid = cur.lastrowid
            created.append(conn.execute(
                "SELECT * FROM studio_episodes WHERE id = ?", (eid,)
            ).fetchone())
        conn.execute(
            "UPDATE studio_projects SET updated_at = ?, status = ? WHERE id = ?",
            (now, "generated", project_id),
        )
        conn.commit()

    episodes = [_episode_row(e) for e in created]

    def stream():
        src_label = "AI" if gen_source == "ai" else "本地模板"
        yield (
            "event: data\ndata: "
            + _json.dumps({"content": f"正在生成四幕分集…（{src_label}）"}, ensure_ascii=False)
            + "\n\n"
        )
        for ep in episodes:
            line = f"已生成 {ep['act']}：{ep['title']}\n"
            yield "event: data\ndata: " + _json.dumps({"content": line}, ensure_ascii=False) + "\n\n"
        yield "event: generation_done\ndata: " + _json.dumps({"episodes": episodes}, ensure_ascii=False) + "\n\n"
        yield "event: done\ndata: " + _json.dumps({"content": "ok", "source": gen_source}, ensure_ascii=False) + "\n\n"

    return Response(stream(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })

