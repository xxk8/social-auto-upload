"""
monitor.py — Daily cron verdict endpoint for TBF-018 monitoring window.

Exposes the daily verdict written by `scripts/diff_monitor_baseline.py` to web_runner
dashboard via `GET /api/monitor/status`. The dashboard's existing error-banner template
renders `result.banner` verbatim with severity-keyed background color.

Read-only filesystem consumer of `.sau-logs/monitor-baseline-diff.json`. Does NOT spawn
subprocesses (security + WSGI latency risk).

Routes:
  GET /api/monitor/status   -> JSON verdict (200/304/500)
"""

import json
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, make_response

from web_runner.routes.auth import admin_required

bp = Blueprint("monitor", __name__)

# Path resolution: defer to current working directory. The artifact is written by the
# daily cron job launched from the repo root (see scripts/deploy-monitor-cdp-throttling-cron.sh).
ARTIFACT_PATH = Path(".sau-logs/monitor-baseline-diff.json")

# Synthetic fallback shape used when the artifact is missing OR its JSON is malformed.
# Kept structurally identical to diff_monitor_baseline.py's emit() shape so the frontend
# can bind blindly to `response.overall_verdict` + `response.banner.{severity,text}`.
# Empty `counters` + `current_sweep: {}` (NOT None — frontend may render .files_scanned/bytes_scanned
# for hover/details; None would crash .files_scanned access with AttributeError).
def _synthetic_verdict(verdict: str, severity: str, text: str) -> dict[str, Any]:
    return {
        "snapshot_at": None,
        "tool": "web_runner.routes.monitor",
        "version": 1,
        "overall_verdict": verdict,
        "banner": {"severity": severity, "text": text},
        "counters": {},
        "current_sweep": {},
        "_synthetic": True,
    }


@bp.get("/api/monitor/status")
@admin_required
def monitor_status():
    """Return the daily verdict JSON written by scripts/diff_monitor_baseline.py.

    Missing artifact -> synthetic CRUISE_NO_BASELINE 200 (cron hasn't emitted yet).
    Malformed JSON   -> synthetic CRUISE_PARSE_ERROR 500 (artifact corruption).
    Valid artifact   -> passthrough 200 + Cache-Control: max-age=300.
    """
    if not ARTIFACT_PATH.exists():
        resp = jsonify(_synthetic_verdict(
            "CRUISE_NO_BASELINE",
            "warning",
            "Daily monitoring artifact missing (.sau-logs/monitor-baseline-diff.json). "
            "Daily cron at 06:00 UTC has not emitted yet. Run scripts/diff_monitor_baseline.py "
            "manually to seed.",
        ))
        # Lower TTL: synthetic responses are transient; cron emission will replace shortly.
        resp.headers["Cache-Control"] = "public, max-age=60"
        return resp

    try:
        data = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        # Log the error server-side and return a safe synthetic 500.
        # The frontend shows the synthetic banner; operators inspect logs for root cause.
        resp = jsonify(_synthetic_verdict(
            "CRUISE_PARSE_ERROR",
            "error",
            f"Daily monitoring artifact JSON malformed: {e}. "
            "Investigation: re-run scripts/pre-deploy-dry-run.sh to refresh. "
            "Or scripts/diff_monitor_baseline.py --verdict-output .sau-logs/monitor-baseline-diff.json to overwrite.",
        ))
        resp.headers["Cache-Control"] = "public, max-age=30"
        return resp, 500

    resp = make_response(jsonify(data), 200)
    # 5-minute freshness heuristic. Daily cron emission ~24h cadence, but manual resets
    # (operator overrides, post-incident) should populate the banner within a few minutes.
    # Cache-Control: public allows shared caches (Varnish, Cloudflare) to mirror the verdict.
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp
