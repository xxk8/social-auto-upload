"""Public-inbox kill-criteria status endpoint.

Exposes the daily verdict written by `scripts/public_inbox_kill_criteria.py`
to the web_runner dashboard via `GET /api/public-inbox/kill-criteria`. The
dashboard renders `result.banner` verbatim with severity-keyed background
color (mirrors `web_runner/routes/monitor.py` consumer contract).

Intentionally separate from `/api/monitor/status` (TBF-018 CDP throttling)
because the two verdicts have different semantics:

  * `/api/monitor/status`           — system STOP-SHIP gate (5-min SLA)
  * `/api/public-inbox/kill-criteria` — business-metric kill switch
                                       (next-business-day SLA)

Read-only filesystem consumer of `.sau-logs/public-inbox-kill-criteria.json`.
Does NOT spawn subprocesses (security + WSGI latency risk).

Routes:
  GET /api/public-inbox/kill-criteria  -> JSON verdict (200/304/500)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, make_response

from web_runner.routes.auth import admin_required

bp = Blueprint("public_inbox_kill_criteria", __name__)

# Path resolution: defer to current working directory. The artifact is written
# by the daily cron job launched from the repo root
# (see scripts/deploy-public-inbox-kill-criteria-cron.sh).
ARTIFACT_PATH = Path(".sau-logs/public-inbox-kill-criteria.json")


# Synthetic fallback shape used when the artifact is missing OR its JSON is
# malformed. Kept structurally identical to the cron-emitted shape so the
# frontend can bind blindly to `response.overall_verdict` +
# `response.banner.{severity,text}` + `response.metrics.*`.
def _synthetic_verdict(verdict: str, severity: str, text: str) -> dict[str, Any]:
    return {
        "snapshot_at": None,
        "tool": "web_runner.routes.public_inbox_kill_criteria",
        "version": 1,
        "overall_verdict": verdict,
        "banner": {"severity": severity, "text": text},
        "metrics": {},
        "_synthetic": True,
    }


@bp.get("/api/public-inbox/kill-criteria")
@admin_required
def kill_criteria_status():
    """Return the daily verdict JSON written by
    `scripts/public_inbox_kill_criteria.py`.

    Missing artifact -> synthetic INSUFFICIENT_DATA 200 (cron hasn't emitted yet).
    Malformed JSON   -> synthetic PARSE_ERROR 500 (artifact corruption).
    Valid artifact   -> passthrough 200 + Cache-Control: max-age=300.
    """
    if not ARTIFACT_PATH.exists():
        resp = jsonify(_synthetic_verdict(
            "INSUFFICIENT_DATA",
            "info",
            "Daily kill-criteria artifact missing (.sau-logs/public-inbox-kill-criteria.json). "
            "Daily cron at 07:00 UTC has not emitted yet. Run scripts/public_inbox_kill_criteria.py "
            "manually to seed.",
        ))
        # Lower TTL: synthetic responses are transient; cron emission will replace shortly.
        resp.headers["Cache-Control"] = "public, max-age=60"
        return resp

    try:
        data = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        resp = jsonify(_synthetic_verdict(
            "PARSE_ERROR",
            "error",
            f"Daily kill-criteria artifact JSON malformed: {e}. "
            "Investigation: re-run scripts/public_inbox_kill_criteria.py "
            "--logs-dir .sau-logs/ to overwrite.",
        ))
        resp.headers["Cache-Control"] = "public, max-age=30"
        return resp, 500

    resp = make_response(jsonify(data), 200)
    # 5-minute freshness heuristic — daily cron emission is daily cadence, but
    # manual resets (operator overrides, post-incident re-runs) should populate
    # the banner within a few minutes. Cache-Control: public allows shared
    # caches (Varnish, Cloudflare) to mirror the verdict.
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp
