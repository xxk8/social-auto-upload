"""Content templates routes (openspec/changes/product-roadmap-2026q3 Phase 2).

Reusable copy templates (好物推荐 / 教程分享 / 日常记录 …). Mounted at
``/api/content-templates`` — the existing ``/api/templates`` route is the
*publish* template feature (name/mode/snapshot) and must not be broken.

A template's ``template`` JSONB carries a free-form structure the frontend
renders as a form:

    {
      "type": "product" | "tutorial" | "daily",
      "prompt": "围绕 {product} 写一段种草文案…",
      "fields": [{"key": "product", "label": "产品名", "placeholder": "…"}]
    }

``POST /{id}/apply`` substitutes user-filled ``variables`` into ``prompt``
and runs it through the same AI generator used by ``/api/ai/generate``.
"""
from __future__ import annotations

import json

from flask import Blueprint, jsonify, request

from web_runner.db import (
    create_content_template,
    delete_content_template,
    get_content_template,
    list_content_templates,
)

bp = Blueprint("content_templates", __name__, url_prefix="/api/content-templates")

# Default model used by the apply endpoint when the caller doesn't supply
# one. Mirrors the ai.py multi-platform default loosely; the underlying
# generator falls back to the user's configured keys.
_DEFAULT_MODEL = "openai/gpt-4o-mini"


def _current_user_id_safe() -> int:
    """Resolve the calling user; fall back to 1 when auth is disabled
    (dev) so templates still persist under a stable owner."""
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    if not _is_auth_enabled():
        return 1
    uid = _current_user_id()
    return uid if uid is not None else 1


@bp.get("")
def list_templates():
    uid = _current_user_id_safe()
    platform = request.args.get("platform")
    rows = list_content_templates(uid, platform)
    templates = []
    for r in rows:
        template = r.get("template")
        if isinstance(template, str):
            try:
                template = json.loads(template)
            except (json.JSONDecodeError, TypeError):
                template = {}
        templates.append({
            "id": r["id"],
            "name": r["name"],
            "platform": r.get("platform"),
            "template": template,
            "created_at": r.get("created_at"),
            "updated_at": r.get("updated_at"),
        })
    return jsonify({"success": True, "data": templates})


@bp.post("")
def create_template():
    uid = _current_user_id_safe()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    platform = (body.get("platform") or "").strip() or None
    template = body.get("template") or {}
    if not name:
        return jsonify({"success": False, "message": "name is required"}), 400
    if not isinstance(template, dict):
        return jsonify({"success": False, "message": "template must be an object"}), 400

    template_id = create_content_template(uid, name, template, platform)
    return jsonify({
        "success": True,
        "data": {"id": template_id, "name": name, "platform": platform, "template": template},
    })


@bp.delete("/<int:template_id>")
def delete_template(template_id: int):
    existing = get_content_template(template_id)
    if not existing:
        return jsonify({"success": False, "message": "Template not found"}), 404
    delete_content_template(template_id)
    return jsonify({"success": True})


@bp.post("/<int:template_id>/apply")
def apply_template(template_id: int):
    """Substitute user variables into the template prompt and generate
    copy via the shared AI generator (``_generate_single_platform``)."""
    existing = get_content_template(template_id)
    if not existing:
        return jsonify({"success": False, "message": "Template not found"}), 404

    template = existing.get("template")
    if isinstance(template, str):
        try:
            template = json.loads(template)
        except (json.JSONDecodeError, TypeError):
            template = {}

    body = request.get_json(silent=True) or {}
    variables = body.get("variables") or {}
    platform = (body.get("platform") or existing.get("platform") or "").strip()
    model = (body.get("model") or _DEFAULT_MODEL).strip()

    if not platform:
        return jsonify({"success": False, "message": "platform is required"}), 400

    prompt = template.get("prompt", "")
    if isinstance(variables, dict):
        for k, v in variables.items():
            prompt = prompt.replace("{" + str(k) + "}", str(v))
    # Strip any unresolved placeholders so the model gets a clean brief.
    import re
    prompt = re.sub(r"\{[^{}]+\}", "", prompt).strip()

    try:
        from web_runner.routes.ai import _generate_single_platform

        result = _generate_single_platform(model, prompt, platform)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "message": f"AI 生成失败: {exc}"}), 502

    return jsonify({"success": True, "data": result})
