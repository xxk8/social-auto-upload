"""Studio (script studio) — Postgres project CRUD for local shell.

Front-end: ``sau_web/frontend/src/api/studio.ts``

Contract notes (post-拷打 fix):
  * All INSERTs use ``RETURNING`` so PG lastrowid is populated
    (``web_runner.db._PgCursor`` only sets lastrowid when RETURNING
    is present).
  * ``studio_episodes`` live schema uses ``scenes_json`` /
    ``dialogues_json`` (jsonb) + ``status`` — not the legacy
    ``content`` column from an earlier draft.
  * Project ``status`` is normalised to the front-end whitelist
    ``draft | generating | ready | exported``.
"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from flask import Blueprint, Response, jsonify, request

from web_runner.db import get_connection
from web_runner.studio_scriptcraft import (
    build_package,
    episode_markdown,
    get_pipeline,
    merge_pipeline,
    system_prompt as _script_system_prompt,
    user_prompt as _script_user_prompt,
)

bp = Blueprint("studio", __name__)

_VALID_ACTS = frozenset({"起", "承", "转", "合"})
_VALID_PROJECT_STATUS = frozenset({"draft", "generating", "ready", "exported"})
# Legacy / internal status values → front-end whitelist.
_STATUS_NORMALIZE = {
    "rendered": "exported",
    "completed": "exported",
    "complete": "exported",
    "exported": "exported",
    "generated": "ready",
    "ready": "ready",
    "generating": "generating",
    "draft": "draft",
}


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _user_id() -> int:
    # Local shell has no session user; owner_user_id defaults to 0.
    from flask import session

    return int(session.get("user_id") or 0)


def _as_list(val: Any) -> list:
    if val is None:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            return parsed if isinstance(parsed, list) else [s]
        except Exception:
            return [s]
    return [val]


def _json_param(val: Any) -> str:
    """Serialize a Python value for a jsonb column (psycopg accepts JSON text)."""
    if val is None:
        return "[]"
    if isinstance(val, str):
        # Already JSON text — keep if parseable, else wrap as one string item.
        try:
            json.loads(val)
            return val
        except Exception:
            return json.dumps([val], ensure_ascii=False)
    return json.dumps(val if isinstance(val, (list, dict)) else [val], ensure_ascii=False)


def _parse_render_config(raw: Any) -> dict | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


def _normalize_project_status(raw: Any) -> str:
    s = str(raw or "draft").strip().lower()
    mapped = _STATUS_NORMALIZE.get(s, s)
    return mapped if mapped in _VALID_PROJECT_STATUS else "draft"


def _episode_body_text(r: dict) -> str:
    """Markdown body for zip/md export from structured scenes/dialogues."""
    scenes = _as_list(r.get("scenes_json") if "scenes_json" in r else r.get("scenes"))
    dialogues = _as_list(
        r.get("dialogues_json") if "dialogues_json" in r else r.get("dialogues")
    )
    # Prefer structured markdown when scenes look like craft objects.
    if scenes and any(isinstance(s, dict) and ("action" in s or "visual" in s) for s in scenes):
        return episode_markdown(
            {
                "act": r.get("act"),
                "title": r.get("title") or "",
                "scenes": scenes,
                "dialogues": dialogues,
            }
        )
    if scenes:
        parts = []
        for item in scenes:
            if isinstance(item, dict):
                parts.append(json.dumps(item, ensure_ascii=False))
            else:
                parts.append(str(item))
        body = "\n\n".join(parts)
        if dialogues:
            body += "\n\n## 对白\n\n" + "\n".join(
                (
                    f"- **{d.get('speaker', '旁白')}**：{d.get('line', '')}"
                    if isinstance(d, dict)
                    else f"- {d}"
                )
                for d in dialogues
            )
        return body
    return str(r.get("content") or "")


def _project_row(
    r: dict,
    episodes: list | None = None,
    assets: list | None = None,
) -> dict:
    rc = _parse_render_config(r.get("render_config"))
    return {
        "id": r["id"],
        "title": r["title"],
        "synopsis": r.get("synopsis") or "",
        "style": r.get("style"),
        "status": _normalize_project_status(r.get("status")),
        "owner_user_id": int(r.get("owner_user_id") or 0),
        "render_config": rc,
        "pipeline": get_pipeline(rc),
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
        "episodes": episodes if episodes is not None else [],
        "assets": assets if assets is not None else [],
    }


def _insert_asset(
    conn,
    *,
    project_id: int,
    kind: str,
    code: str,
    name: str,
    prompt: str,
    now: str,
    ref_image_url: str | None = None,
) -> dict | None:
    try:
        cur = conn.execute(
            "INSERT INTO studio_assets "
            "(project_id, kind, code, name, prompt, ref_image_url, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "RETURNING *",
            (project_id, kind, code, name, prompt, ref_image_url, now),
        )
        return cur.fetchone()
    except Exception:
        return None


def _episode_row(r: dict) -> dict:
    scenes = _as_list(r.get("scenes_json") if r.get("scenes_json") is not None else r.get("scenes"))
    dialogues = _as_list(
        r.get("dialogues_json") if r.get("dialogues_json") is not None else r.get("dialogues")
    )
    # Legacy ``content`` column → single scene paragraph.
    if not scenes and r.get("content"):
        scenes = [r["content"]] if isinstance(r["content"], str) else _as_list(r["content"])
    status = r.get("status") or "draft"
    if status not in ("draft", "generating", "complete"):
        status = "draft"
    return {
        "id": r["id"],
        "project_id": r["project_id"],
        "episode_no": r["episode_no"],
        "act": r.get("act"),
        "title": r.get("title") or "",
        "scenes": scenes,
        "dialogues": dialogues,
        "status": status,
        "created_at": r.get("created_at"),
    }


def _asset_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "project_id": r["project_id"],
        "kind": r.get("kind") or "prop",
        "code": r.get("code") or "",
        "name": r.get("name") or "",
        "prompt": r.get("prompt") or "",
        "ref_image_url": r.get("ref_image_url"),
        "created_at": r.get("created_at"),
    }


def _dict_rows(conn) -> None:
    conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}


def _insert_episode(
    conn,
    *,
    project_id: int,
    episode_no: int,
    act: str | None,
    title: str,
    scenes: list,
    dialogues: list,
    now: str,
    status: str = "draft",
) -> dict:
    cur = conn.execute(
        "INSERT INTO studio_episodes "
        "(project_id, episode_no, act, title, scenes_json, dialogues_json, status, created_at) "
        "VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?) "
        "RETURNING *",
        (
            project_id,
            episode_no,
            act,
            title,
            _json_param(scenes),
            _json_param(dialogues),
            status,
            now,
        ),
    )
    row = cur.fetchone()
    if row is None:
        # Fallback if RETURNING mapping failed — should not happen on PG.
        eid = cur.lastrowid
        row = conn.execute(
            "SELECT * FROM studio_episodes WHERE id = ?", (eid,)
        ).fetchone()
    return row


@bp.get("/api/studio/projects")
def list_projects():
    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
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
    if len(title) > 80:
        return jsonify({"success": False, "message": "title max 80 chars"}), 400
    if len(synopsis) > 500:
        return jsonify({"success": False, "message": "synopsis max 500 chars"}), 400
    now = _now()
    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
        cur = conn.execute(
            "INSERT INTO studio_projects "
            "(owner_user_id, title, synopsis, style, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'draft', ?, ?) "
            "RETURNING *",
            (uid, title, synopsis, style, now, now),
        )
        row = cur.fetchone()
        conn.commit()
        if row is None:
            return jsonify({"success": False, "message": "create failed"}), 500
    return jsonify({"success": True, "data": _project_row(row)})


@bp.get("/api/studio/projects/<int:project_id>")
def get_project(project_id: int):
    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
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
        try:
            assets = conn.execute(
                "SELECT * FROM studio_assets WHERE project_id = ? ORDER BY id",
                (project_id,),
            ).fetchall()
        except Exception:
            assets = []
    return jsonify({
        "success": True,
        "data": _project_row(
            row,
            [_episode_row(e) for e in eps],
            [_asset_row(a) for a in assets],
        ),
    })


@bp.patch("/api/studio/projects/<int:project_id>")
def update_project(project_id: int):
    payload = request.get_json(silent=True) or {}
    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
        row = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not row:
            return jsonify({"success": False, "message": "not found"}), 404
        title = payload["title"] if "title" in payload else row["title"]
        synopsis = payload["synopsis"] if "synopsis" in payload else row["synopsis"]
        style = payload["style"] if "style" in payload else row["style"]
        if "status" in payload:
            status = _normalize_project_status(payload.get("status"))
        else:
            status = row["status"]
        if "render_config" in payload:
            rc = payload.get("render_config")
            if rc is None:
                rc_sql = None
            elif isinstance(rc, dict):
                # Merge into existing so a preset-only PATCH does not
                # wipe ``pipeline`` (script/cast gates + logline).
                prev = _parse_render_config(row.get("render_config")) or {}
                merged = {**prev, **rc}
                if isinstance(prev.get("pipeline"), dict) and "pipeline" not in rc:
                    merged["pipeline"] = prev["pipeline"]
                elif isinstance(prev.get("pipeline"), dict) and isinstance(
                    rc.get("pipeline"), dict
                ):
                    merged["pipeline"] = {**prev["pipeline"], **rc["pipeline"]}
                rc_sql = json.dumps(merged, ensure_ascii=False)
            else:
                rc_sql = json.dumps(_parse_render_config(rc) or {}, ensure_ascii=False)
            conn.execute(
                "UPDATE studio_projects SET title=?, synopsis=?, style=?, status=?, "
                "render_config=?::jsonb, updated_at=? WHERE id=?",
                (title, synopsis, style, status, rc_sql, _now(), project_id),
            )
        else:
            conn.execute(
                "UPDATE studio_projects SET title=?, synopsis=?, style=?, status=?, updated_at=? "
                "WHERE id=?",
                (title, synopsis, style, status, _now(), project_id),
            )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ?", (project_id,)
        ).fetchone()
    return jsonify({"success": True, "data": _project_row(row)})


@bp.delete("/api/studio/projects/<int:project_id>")
def delete_project(project_id: int):
    uid = _user_id()
    with get_connection() as conn:
        # Cascade-friendly: delete children first if FK is not ON DELETE CASCADE
        # on every deploy (init_db declares CASCADE; older DBs may not).
        try:
            conn.execute("DELETE FROM studio_episodes WHERE project_id = ?", (project_id,))
            conn.execute("DELETE FROM studio_assets WHERE project_id = ?", (project_id,))
        except Exception:
            pass
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
        _dict_rows(conn)
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
                f"# {ep.get('title') or ''}\n\n{_episode_body_text(ep)}\n",
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
            ("exported", _now(), project_id),
        )
        conn.commit()

    return jsonify({
        "success": True,
        "data": {
            "project_id": project_id,
            "status": "exported",
            "url": f"/api/studio/render/{project_id}/render_package.zip",
            "message": "已生成脚本导出包（本地壳；完整视频渲染可接 Remotion）",
            "episodes": len(eps),
            # Front-end render mutation historically expected media fields;
            # keep harmless defaults for local zip path.
            "duration": 0,
            "width": 0,
            "height": 0,
            "captions_ass": "",
            "captions_srt": "",
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


def _coerce_episode_items(payload: dict) -> list[dict] | tuple[None, str, int]:
    """Accept batch list OR a single episode object (act required)."""
    episodes = payload.get("episodes") or payload.get("items")
    if isinstance(episodes, list) and episodes:
        return [e for e in episodes if isinstance(e, dict)]
    # Single-item body from StudioDetailPage / EpisodeAppendDialog.
    if (
        payload.get("act")
        or payload.get("title")
        or payload.get("content")
        or payload.get("scenes_json")
        or payload.get("dialogues_json")
        or payload.get("scenes")
        or payload.get("dialogues")
    ):
        return [payload]
    return None, "episodes required (need act, or episodes[])", 400  # type: ignore[return-value]


@bp.post("/api/studio/projects/<int:project_id>/episodes")
def append_episodes(project_id: int):
    payload = request.get_json(silent=True) or {}
    coerced = _coerce_episode_items(payload)
    if isinstance(coerced, tuple):
        _, msg, code = coerced
        return jsonify({"success": False, "message": msg}), code
    episodes: list[dict] = coerced  # type: ignore[assignment]

    for i, ep in enumerate(episodes):
        act = (ep.get("act") or "").strip()
        if act not in _VALID_ACTS:
            return jsonify({
                "success": False,
                "message": f"act 必须是 {', '.join(sorted(_VALID_ACTS))} 之一 (item {i})",
            }), 400
        title = ep.get("title")
        if title is not None and len(str(title)) > 200:
            return jsonify({
                "success": False,
                "message": f"title max 200 chars (item {i})",
            }), 400

    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
        proj = conn.execute(
            "SELECT id FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        max_row = conn.execute(
            "SELECT COALESCE(MAX(episode_no), 0) AS m FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        max_no = int(max_row["m"] if max_row else 0)
        created = []
        now = _now()
        for ep in episodes:
            max_no += 1
            act = (ep.get("act") or "").strip()
            title = (ep.get("title") or "").strip() or f"第{max_no}集"
            scenes = ep.get("scenes_json")
            if scenes is None:
                scenes = ep.get("scenes")
            if scenes is None and ep.get("content"):
                scenes = [ep["content"]] if isinstance(ep["content"], str) else ep["content"]
            scenes = _as_list(scenes)
            dialogues = ep.get("dialogues_json")
            if dialogues is None:
                dialogues = ep.get("dialogues")
            dialogues = _as_list(dialogues)
            row = _insert_episode(
                conn,
                project_id=project_id,
                episode_no=int(ep.get("episode_no") or max_no),
                act=act,
                title=title,
                scenes=scenes,
                dialogues=dialogues,
                now=now,
            )
            created.append(row)
        conn.execute(
            "UPDATE studio_projects SET updated_at = ? WHERE id = ?",
            (now, project_id),
        )
        conn.commit()
    return jsonify({
        "success": True,
        "data": [_episode_row(e) for e in created if e],
    })


@bp.get("/api/studio/tts/health")
def tts_health():
    # Shape matches StudioDetailPage discriminated union (available:false → reason required).
    return jsonify({
        "success": True,
        "data": {
            "available": False,
            "voice": "",
            "default_voice": "zh-CN-XiaoxiaoNeural",
            "install_hint": "pip install edge-tts  # optional for local shell",
            "reason": "本地 Web Shell 未启用 edge-tts 配音",
            "engine": None,
            "message": "edge-tts optional; not required for local shell",
        },
    })


@bp.get("/api/studio/projects/<int:project_id>/episodes/<int:episode_no>/export")
def export_episode(project_id: int, episode_no: int):
    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
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
        f"{_episode_body_text(ep)}\n"
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
        _dict_rows(conn)
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
            body = f"# {ep.get('title') or ''}\n\n{_episode_body_text(ep)}\n"
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
    """Non-streaming chat — prefers local LLM (8317 / local-chat), then OpenRouter.

    Kept name for templates.py / historical call sites.
    """
    try:
        from web_runner.llm_provider import complete_chat

        return complete_chat(messages, model=model, max_tokens=max_tokens, temperature=0.75)
    except Exception:
        return None


@bp.get("/api/studio/provider")
def studio_provider_status():
    """Grok / Imagine connectivity for the Studio UI pill."""
    try:
        from web_runner.llm_provider import llm_config, media_config, provider_status

        st = provider_status()
        st["llm"] = llm_config()
        # never echo full key
        st["llm"] = {
            **st["llm"],
            "api_key": ("***" + st["llm"]["api_key"][-4:]) if st["llm"].get("api_key") else "",
        }
        mc = media_config()
        st["media_key"] = ("***" + mc["api_key"][-4:]) if mc.get("api_key") else ""
        return jsonify({"success": True, "data": st})
    except Exception as exc:
        return jsonify({"success": False, "message": type(exc).__name__}), 500


@bp.get("/api/studio/media/<int:project_id>/<path:filename>")
def studio_media_file(project_id: int, filename: str):
    from flask import send_from_directory

    from web_runner.llm_provider import STUDIO_MEDIA_DIR, resolve_studio_media_file

    path = resolve_studio_media_file(project_id, filename)
    if not path:
        return jsonify({"success": False, "message": "not found"}), 404
    return send_from_directory(STUDIO_MEDIA_DIR / str(project_id), path.name)


@bp.post("/api/studio/projects/<int:project_id>/assets/<int:asset_id>/imagine")
def imagine_asset(project_id: int, asset_id: int):
    """Generate a reference image for one character/scene asset via Grok Imagine."""
    from web_runner.llm_provider import generate_image, save_image_result

    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
        proj = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        asset = conn.execute(
            "SELECT * FROM studio_assets WHERE id = ? AND project_id = ?",
            (asset_id, project_id),
        ).fetchone()
        if not asset:
            return jsonify({"success": False, "message": "asset not found"}), 404

        prompt = (asset.get("prompt") or asset.get("name") or "").strip()
        if not prompt:
            return jsonify({"success": False, "message": "asset prompt empty"}), 400
        # Portrait-friendly framing for characters; wider for scenes.
        kind = asset.get("kind") or "prop"
        aspect = "3:4" if kind == "character" else "9:16"
        style = proj.get("style") or ""
        full_prompt = (
            f"{prompt}。竖屏短剧定妆参考图，写实光影，面部清晰，无水印。"
            if kind == "character"
            else f"{prompt}。竖屏短剧场景概念图，电影感光影，无人物特写干扰，无水印。"
        )
        if style:
            full_prompt += f" 风格：{style}。"

        result = generate_image(full_prompt, aspect_ratio=aspect, n=1)
        if not result or result.get("error"):
            return jsonify({
                "success": False,
                "message": (result or {}).get("message") or "imagine failed",
                "hint": (result or {}).get("hint"),
            }), 502

        local_url = save_image_result(
            result,
            project_id=project_id,
            stem=f"{kind}_{asset.get('code') or asset_id}",
        )
        ref = local_url or result.get("url")
        if not ref:
            return jsonify({"success": False, "message": "no image url"}), 502

        conn.execute(
            "UPDATE studio_assets SET ref_image_url = ? WHERE id = ?",
            (ref, asset_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM studio_assets WHERE id = ?", (asset_id,)
        ).fetchone()
    return jsonify({"success": True, "data": _asset_row(row)})


@bp.post("/api/studio/projects/<int:project_id>/assets/imagine-cast")
def imagine_cast(project_id: int):
    """Batch-generate ref images for all character assets (cap 5)."""
    from web_runner.llm_provider import generate_image, save_image_result

    uid = _user_id()
    payload = request.get_json(silent=True) or {}
    limit = min(5, max(1, int(payload.get("limit") or 5)))
    with get_connection() as conn:
        _dict_rows(conn)
        proj = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        rows = conn.execute(
            "SELECT * FROM studio_assets WHERE project_id = ? AND kind = 'character' "
            "ORDER BY id LIMIT ?",
            (project_id, limit),
        ).fetchall()
        if not rows:
            return jsonify({"success": False, "message": "no character assets"}), 400

        updated = []
        errors = []
        style = proj.get("style") or ""
        for asset in rows:
            prompt = (asset.get("prompt") or asset.get("name") or "").strip()
            if not prompt:
                continue
            full_prompt = (
                f"{prompt}。竖屏短剧定妆参考图，写实光影，面部清晰，无水印。"
            )
            if style:
                full_prompt += f" 风格：{style}。"
            result = generate_image(full_prompt, aspect_ratio="3:4", n=1)
            if not result or result.get("error"):
                errors.append({
                    "asset_id": asset["id"],
                    "message": (result or {}).get("message") or "failed",
                    "hint": (result or {}).get("hint"),
                })
                continue
            local_url = save_image_result(
                result,
                project_id=project_id,
                stem=f"character_{asset.get('code') or asset['id']}",
            )
            ref = local_url or result.get("url")
            if not ref:
                errors.append({"asset_id": asset["id"], "message": "no image url"})
                continue
            conn.execute(
                "UPDATE studio_assets SET ref_image_url = ? WHERE id = ?",
                (ref, asset["id"]),
            )
            row = conn.execute(
                "SELECT * FROM studio_assets WHERE id = ?", (asset["id"],)
            ).fetchone()
            if row:
                updated.append(_asset_row(row))
        conn.commit()
    return jsonify({
        "success": True,
        "data": {"updated": updated, "errors": errors},
    })


@bp.post("/api/studio/projects/<int:project_id>/episodes/<int:episode_no>/video")
def start_episode_video(project_id: int, episode_no: int):
    """Start Grok Imagine video for one episode (first structured scene by default).

    Body optional: ``{ scene_id?, duration?, resolution?, use_cast_ref? }``
    Returns async ``request_id`` — poll ``GET /api/studio/video-jobs/<id>``.
    """
    from web_runner.llm_provider import start_video

    uid = _user_id()
    payload = request.get_json(silent=True) or {}
    with get_connection() as conn:
        _dict_rows(conn)
        proj = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        pipe = get_pipeline(proj.get("render_config"))
        if not pipe.get("script_approved"):
            return jsonify({
                "success": False,
                "message": "请先批准剧本再生成视频（避免在错误剧本上烧额度）",
            }), 400
        ep = conn.execute(
            "SELECT * FROM studio_episodes WHERE project_id = ? AND episode_no = ?",
            (project_id, episode_no),
        ).fetchone()
        if not ep:
            return jsonify({"success": False, "message": "episode not found"}), 404

        scenes = _as_list(
            ep.get("scenes_json") if ep.get("scenes_json") is not None else ep.get("scenes")
        )
        scene_id = payload.get("scene_id")
        scene = None
        if scene_id:
            for s in scenes:
                if isinstance(s, dict) and str(s.get("id")) == str(scene_id):
                    scene = s
                    break
        if scene is None and scenes:
            scene = scenes[0] if isinstance(scenes[0], dict) else {"action": str(scenes[0])}
        if not scene:
            return jsonify({"success": False, "message": "no scenes"}), 400

        action = str(scene.get("action") or "")
        visual = str(scene.get("visual") or "")
        location = str(scene.get("location") or "")
        prompt = (
            f"竖屏短剧镜头。场景：{location}。画面：{visual}。动作：{action}。"
            f"电影感运镜，自然光影，无字幕水印。"
        ).strip()

        image_url = None
        if payload.get("use_cast_ref", True):
            # Prefer first character asset with a ref image.
            try:
                char = conn.execute(
                    "SELECT ref_image_url FROM studio_assets "
                    "WHERE project_id = ? AND kind = 'character' "
                    "AND ref_image_url IS NOT NULL AND ref_image_url != '' "
                    "ORDER BY id LIMIT 1",
                    (project_id,),
                ).fetchone()
                if char and char.get("ref_image_url"):
                    ref = char["ref_image_url"]
                    # Local paths need absolute URL for remote Imagine — skip, use remote only.
                    if str(ref).startswith("http"):
                        image_url = ref
            except Exception:
                pass

        duration = int(payload.get("duration") or scene.get("duration_s") or 6)
        resolution = str(payload.get("resolution") or "480p")
        result = start_video(
            prompt,
            duration=duration,
            aspect_ratio="9:16",
            resolution=resolution,
            image_url=image_url,
        )
        if result.get("error"):
            return jsonify({
                "success": False,
                "message": result.get("message") or "video start failed",
                "hint": result.get("hint"),
            }), 502

        # Stash job id on pipeline for UI recovery.
        rc = merge_pipeline(
            proj.get("render_config"),
            source=pipe.get("source") or "",
            logline=pipe.get("logline") or "",
            genre_tags=list(pipe.get("genre_tags") or []),
        )
        jobs = rc.get("video_jobs")
        if not isinstance(jobs, list):
            jobs = []
        jobs = list(jobs)[-19:] + [{
            "request_id": result["request_id"],
            "episode_no": episode_no,
            "scene_id": scene.get("id") if isinstance(scene, dict) else None,
            "created_at": _now(),
        }]
        rc["video_jobs"] = jobs
        conn.execute(
            "UPDATE studio_projects SET render_config=?::jsonb, updated_at=? WHERE id=?",
            (json.dumps(rc, ensure_ascii=False), _now(), project_id),
        )
        conn.commit()

    return jsonify({
        "success": True,
        "data": {
            "request_id": result["request_id"],
            "episode_no": episode_no,
            "poll_url": f"/api/studio/video-jobs/{result['request_id']}",
        },
    })


@bp.get("/api/studio/video-jobs/<path:request_id>")
def poll_studio_video_job(request_id: str):
    from web_runner.llm_provider import poll_video

    result = poll_video(request_id, timeout_s=0)
    if result.get("error") and result.get("status") not in (None, 200):
        return jsonify({"success": False, "data": result, "message": result.get("message")}), 502
    return jsonify({"success": True, "data": result})


@bp.post("/api/studio/projects/<int:project_id>/pipeline")
def update_pipeline(project_id: int):
    """Approve / un-approve script or cast (pipeline gates).

    Body: ``{ "script_approved": bool? , "cast_approved": bool? }``

    Rules (shortdrama-pipeline style):
      * cast_approved=true forces script_approved=true
      * script_approved=false clears cast_approved
      * script_approved=true requires at least one episode
      * cast_approved=true requires at least one character asset
    """
    payload = request.get_json(silent=True) or {}
    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
        proj = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404

        want_script = payload.get("script_approved")
        want_cast = payload.get("cast_approved")
        if want_script is None and want_cast is None:
            return jsonify({"success": False, "message": "no pipeline fields"}), 400

        eps = conn.execute(
            "SELECT COUNT(*) AS c FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        ep_count = int((eps or {}).get("c") or 0)
        try:
            assets = conn.execute(
                "SELECT COUNT(*) AS c FROM studio_assets "
                "WHERE project_id = ? AND kind = 'character'",
                (project_id,),
            ).fetchone()
            char_count = int((assets or {}).get("c") or 0)
        except Exception:
            char_count = 0

        if want_script is True and ep_count < 1:
            return jsonify({
                "success": False,
                "message": "请先生成分集再批准剧本",
            }), 400
        if want_cast is True and char_count < 1:
            return jsonify({
                "success": False,
                "message": "请先生成角色定妆（AI 生成会自动写入素材）再批准定妆",
            }), 400

        pipe = get_pipeline(proj.get("render_config"))
        rc = merge_pipeline(
            proj.get("render_config"),
            source=pipe.get("source") or "",
            logline=pipe.get("logline") or "",
            genre_tags=list(pipe.get("genre_tags") or []),
            script_approved=bool(want_script) if want_script is not None else None,
            cast_approved=bool(want_cast) if want_cast is not None else None,
        )
        conn.execute(
            "UPDATE studio_projects SET render_config=?::jsonb, updated_at=? WHERE id=?",
            (json.dumps(rc, ensure_ascii=False), _now(), project_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ?", (project_id,)
        ).fetchone()
        eps_rows = conn.execute(
            "SELECT * FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
            (project_id,),
        ).fetchall()
        try:
            asset_rows = conn.execute(
                "SELECT * FROM studio_assets WHERE project_id = ? ORDER BY id",
                (project_id,),
            ).fetchall()
        except Exception:
            asset_rows = []
    return jsonify({
        "success": True,
        "data": _project_row(
            row,
            [_episode_row(e) for e in eps_rows],
            [_asset_row(a) for a in asset_rows],
        ),
    })


@bp.post("/api/studio/projects/<int:project_id>/generate")
def generate_episodes(project_id: int):
    """SSE: structured 起承转合 craft package (scenes + dialogues + assets).

    Front-end listens for ``event: generation_done`` then invalidates
    the project query. See ``sse.ts`` + StudioDetailPage.
    """
    import json as _json

    uid = _user_id()
    with get_connection() as conn:
        _dict_rows(conn)
        proj = conn.execute(
            "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
            (project_id, uid),
        ).fetchone()
        if not proj:
            return jsonify({"success": False, "message": "not found"}), 404
        title = proj.get("title") or "未命名项目"
        synopsis = (proj.get("synopsis") or "").strip() or "（无简介）"
        style = proj.get("style") or "默认"

        # Rebuild episodes + assets from a fresh package.
        conn.execute("DELETE FROM studio_episodes WHERE project_id = ?", (project_id,))
        try:
            conn.execute("DELETE FROM studio_assets WHERE project_id = ?", (project_id,))
        except Exception:
            pass

        ai_text = _complete_openrouter(
            [
                {"role": "system", "content": _script_system_prompt()},
                {
                    "role": "user",
                    "content": _script_user_prompt(
                        title=title, synopsis=synopsis, style=style
                    ),
                },
            ],
            max_tokens=4500,
        )
        pkg = build_package(ai_text, title=title, synopsis=synopsis, style=style)
        gen_source = str(pkg.get("source") or "scaffold")

        now = _now()
        created = []
        for i, ep in enumerate(pkg.get("episodes") or [], start=1):
            if not isinstance(ep, dict):
                continue
            row = _insert_episode(
                conn,
                project_id=project_id,
                episode_no=i,
                act=ep.get("act"),
                title=str(ep.get("title") or f"{title} · {ep.get('act') or i}"),
                scenes=list(ep.get("scenes") or []),
                dialogues=list(ep.get("dialogues") or []),
                now=now,
                status="complete",
            )
            created.append(row)

        assets_created = 0
        for ch in pkg.get("characters") or []:
            if not isinstance(ch, dict):
                continue
            if _insert_asset(
                conn,
                project_id=project_id,
                kind="character",
                code=str(ch.get("code") or ""),
                name=str(ch.get("name") or ""),
                prompt=str(ch.get("prompt") or ch.get("visual") or ""),
                now=now,
            ):
                assets_created += 1
        for loc in pkg.get("locations") or []:
            if not isinstance(loc, dict):
                continue
            if _insert_asset(
                conn,
                project_id=project_id,
                kind="scene",
                code=str(loc.get("code") or ""),
                name=str(loc.get("name") or ""),
                prompt=str(loc.get("prompt") or loc.get("visual") or ""),
                now=now,
            ):
                assets_created += 1

        rc = merge_pipeline(
            proj.get("render_config"),
            source=gen_source,
            logline=str(pkg.get("logline") or ""),
            genre_tags=list(pkg.get("genre_tags") or []),
            reset_approvals=True,
        )
        conn.execute(
            "UPDATE studio_projects SET updated_at = ?, status = ?, "
            "render_config = ?::jsonb WHERE id = ?",
            (now, "ready", json.dumps(rc, ensure_ascii=False), project_id),
        )
        conn.commit()

    episodes = [_episode_row(e) for e in created if e]
    # Re-fetch pipeline for SSE payload.
    pipeline = get_pipeline(rc)

    def stream():
        src_label = {
            "ai": "AI 结构化剧本",
            "ai-legacy": "AI（兼容旧格式）",
            "scaffold": "本地模板",
        }.get(gen_source, gen_source)
        yield (
            "event: data\ndata: "
            + _json.dumps(
                {
                    "content": (
                        f"正在生成结构化四幕…（{src_label}）"
                        f" · 角色/场景素材 {assets_created} 条"
                    )
                },
                ensure_ascii=False,
            )
            + "\n\n"
        )
        if pipeline.get("logline"):
            yield (
                "event: data\ndata: "
                + _json.dumps(
                    {"content": f"故事线：{pipeline['logline']}\n"},
                    ensure_ascii=False,
                )
                + "\n\n"
            )
        for ep in episodes:
            n_sc = len(ep.get("scenes") or [])
            n_dl = len(ep.get("dialogues") or [])
            line = f"已生成 {ep['act']}：{ep['title']}（{n_sc} 镜 · {n_dl} 句对白）\n"
            yield "event: data\ndata: " + _json.dumps({"content": line}, ensure_ascii=False) + "\n\n"
        yield (
            "event: generation_done\ndata: "
            + _json.dumps(
                {
                    "episodes": episodes,
                    "pipeline": pipeline,
                    "assets_count": assets_created,
                },
                ensure_ascii=False,
            )
            + "\n\n"
        )
        yield (
            "event: done\ndata: "
            + _json.dumps({"content": "ok", "source": gen_source}, ensure_ascii=False)
            + "\n\n"
        )

    return Response(stream(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
