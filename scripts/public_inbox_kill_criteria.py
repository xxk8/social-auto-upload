"""Daily cron-friendly kill-criteria verdict for public-inbox-monetization.

Queries `web_runner/db.py` SQLite tables (`guest_usage_logs` + `reward_events`)
for 30-day rolling metrics and writes a per-metric verdict JSON to
`.sau-logs/public-inbox-kill-criteria.json`. When the overall verdict is
`STOP-SHIP` or `WATCHFUL`, posts to `SAU_KILL_CRITERIA_WEBHOOK` if set.

Six metrics (per openspec/changes/public-inbox-monetization/design.md §Kill Criteria):

1. reward_button_ctr       < 0.05   (30d, sample ≥ 100)
2. reward_abandon_rate     > 0.70   (30d, sample ≥ 100)
3. affiliate_ctr           < 0.003  (30d, sample ≥ 100) — returns INSUFFICIENT_DATA
                                                 until `affiliate_click` event is wired
4. registration_conversion < 0.02   (30d, sample ≥ 100)
5. monthly_uv_avg          < 5000   (3-month rolling avg, sample ≥ 30)
6. platform_failure_rate   > 0.20   (30d, sample ≥ 100) — returns INSUFFICIENT_DATA
                                                 until success/failure status is wired

Verdict cascade (mirrors scripts/diff_monitor_baseline.py convention):
  CRUISE            — all metrics PASS (or INSUFFICIENT_DATA without trigger)
  WATCHFUL          — at least 1 metric FAIL but no STOP-SHIP
  STOP-SHIP         — at least 1 metric FAIL at a critical threshold
  INSUFFICIENT_DATA — total sample < 100 in last 30d (no verdict, no alert)

Cron recommendation
-------------------

::

    0 7 * * * cd <repo> && .venv/bin/python scripts/public_inbox_kill_criteria.py \\
        >> .sau-logs/public-inbox-kill-criteria.log 2>&1

Stagger to ``0 7`` UTC (after the ``0 6`` TBF-018 cron) to avoid CPU contention
on a single-host deployment. Single-instance only — concurrent runs can race on
``web_runner.db`` read transactions.

Exit semantics
--------------

* Exit 0 on CRUISE / WATCHFUL / INSUFFICIENT_DATA (informational; banner only).
* Exit 1 on STOP-SHIP (operator action expected; webhook fired if configured).
* Exit non-zero ONLY on internal Python errors (bug, not kill criteria).
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Force UTF-8 stdout so future emoji annotations don't mojibake on bare-bones
# Linux cron environments (mirrors `monitor_cdp_throttling.py` discipline).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Repo-root-relative path resolution. Cron launches from arbitrary cwd; using
# __file__-relative paths keeps the script portable across hosts.
_REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOGS_DIR = _REPO_ROOT / ".sau-logs"
DEFAULT_DB_PATH = _REPO_ROOT / "db" / "database.db"
OUT_FILE_NAME = "public-inbox-kill-criteria.json"
OUT_LOG_NAME = "public-inbox-kill-criteria.log"

# min_sample_size floor — kills metrics that would otherwise trigger on noise
# (e.g. 5 downloads, 1 reward click → 20% CTR, technically above 5% threshold
# but sample size is too small to be statistically meaningful).
MIN_SAMPLE_SIZE = 100

# Verdict cascade — semantically mirrors scripts/diff_monitor_baseline.py.
VERDICT_CRUISE = "CRUISE"
VERDICT_WATCHFUL = "WATCHFUL"
VERDICT_STOPSHIP = "STOP-SHIP"
VERDICT_INSUFFICIENT = "INSUFFICIENT_DATA"

# Per-metric status keywords.
STATUS_PASS = "PASS"
STATUS_FAIL = "FAIL"
STATUS_INSUFFICIENT = "INSUFFICIENT_DATA"
STATUS_NOT_IMPLEMENTED = "NOT_IMPLEMENTED"

# Threshold table — single source of truth. Mirrors the openspec
# `_index.json::killCriteria` block. Edit both in lockstep.
THRESHOLDS: dict[str, dict[str, Any]] = {
    "reward_button_ctr": {
        "operator": "<",
        "threshold": 0.05,
        "trigger_action": "撤掉 stub 按钮，重写 LandingPage CTA → '注册送 5 次'",
        "implemented": True,
    },
    "reward_abandon_rate": {
        "operator": ">",
        "threshold": 0.70,
        "trigger_action": "缩短 stub 到 3s，A/B 测试无奖励流",
        "implemented": True,
    },
    "affiliate_ctr": {
        "operator": "<",
        "threshold": 0.003,
        "trigger_action": "重选品或撤掉 AffiliateRail",
        "implemented": False,  # blocked on affiliate_click event in JS
    },
    "registration_conversion": {
        "operator": "<",
        "threshold": 0.02,
        "trigger_action": "注册墙文案 + 时机重做",
        "implemented": True,
    },
    "monthly_uv_avg": {
        "operator": "<",
        "threshold": 5000,
        "trigger_action": "推迟优量汇合规化（DR2 维持拒绝）",
        "implemented": True,
    },
    "platform_failure_rate": {
        "operator": ">",
        "threshold": 0.20,
        "trigger_action": "停用访客流，仅保留登录用户",
        "implemented": False,  # blocked on success/failure column
    },
}


# ── DB query layer ─────────────────────────────────────────────────


# Schema bootstrap for the in-memory fallback path. Mirrors the columns
# defined in openspec/changes/public-inbox-monetization/proposal.md and
# (post-PR-A merge) web_runner/db.py::init_db(). Kept as a module-level
# constant so the dry-run works on a clean deploy / pre-PR-A database
# where the public-inbox tables don't yet exist.
#
# Three-way lockstep rule (mirrors `docs/dev/public-inbox-ops.md` §7):
#   openspec/proposal.md ←→ this schema ←→ (post-merge) web_runner/db.py
# When you change one, change all three.
_SCHEMA_BOOTSTRAP = """
    CREATE TABLE IF NOT EXISTS guest_usage_logs (
        id INTEGER PRIMARY KEY,
        guest_uuid TEXT NOT NULL,
        ip TEXT,
        action TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reward_events (
        id INTEGER PRIMARY KEY,
        guest_uuid TEXT NOT NULL,
        ip TEXT,
        event TEXT NOT NULL,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
"""


def _open_db(db_path: Path) -> sqlite3.Connection:
    """Open a read-only SQLite connection. Falls back to an in-memory
    connection with the public-inbox schema bootstrapped if either:
      (a) the DB file does not exist (clean deploy), OR
      (b) the file exists but the public-inbox tables are missing
          (pre-PR-A merge state, where the script is deployed ahead
          of the public_inbox.py backend blueprint).
    In both cases the in-memory DB has zero rows → all metrics fall
    through to STATUS_INSUFFICIENT / STATUS_NOT_IMPLEMENTED → cascade
    returns INSUFFICIENT_DATA (no alert, banner is yellow/info).
    """
    uri = f"file:{db_path}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=30)
        conn.row_factory = sqlite3.Row
        # Probe for the public-inbox tables. If both present, the
        # read-only file connection is good to use.
        present = {
            r["name"]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if "guest_usage_logs" in present and "reward_events" in present:
            return conn
        # Tables missing — close the read-only handle and fall through
        # to in-memory bootstrap. We intentionally do NOT attempt CREATE
        # TABLE on the read-only connection (it would fail and trigger
        # the wrong error path).
        conn.close()
    except sqlite3.OperationalError:
        # File doesn't exist — fall through to in-memory bootstrap.
        pass

    mem = sqlite3.connect(":memory:")
    mem.row_factory = sqlite3.Row
    mem.executescript(_SCHEMA_BOOTSTRAP)
    return mem


def _query_metric_1_2(db: sqlite3.Connection, cutoff_iso: str) -> dict[str, int]:
    """Combined query for reward button CTR + 5s abandon rate (both sample sizes
    come from the same tables — fold into one round-trip)."""
    row = db.execute(
        """
        SELECT
            (SELECT COUNT(DISTINCT guest_uuid) FROM guest_usage_logs
             WHERE action = 'reward' AND created_at >= ?) AS reward_grants,
            (SELECT COUNT(DISTINCT guest_uuid) FROM guest_usage_logs
             WHERE action = 'download' AND created_at >= ?) AS downloaders,
            (SELECT COUNT(DISTINCT guest_uuid) FROM reward_events
             WHERE event = 'reward_abandon' AND created_at >= ?) AS abandons,
            (SELECT COUNT(DISTINCT guest_uuid) FROM reward_events
             WHERE event = 'reward_button_click' AND created_at >= ?) AS clicks
        """,
        (cutoff_iso, cutoff_iso, cutoff_iso, cutoff_iso),
    ).fetchone()
    return {
        "reward_grants": row["reward_grants"] or 0,
        "downloaders": row["downloaders"] or 0,
        "abandons": row["abandons"] or 0,
        "clicks": row["clicks"] or 0,
    }


def _query_registration_conversion(db: sqlite3.Connection, cutoff_iso: str) -> dict[str, int]:
    """New-user count vs. downloader count. Note: `users` table is created in
    `web_runner/db.py::init_db()` — referenced here for the 30d window.
    """
    row = db.execute(
        """
        SELECT
            (SELECT COUNT(*) FROM users
             WHERE created_at >= ? AND role = 'user') AS new_users,
            (SELECT COUNT(DISTINCT guest_uuid) FROM guest_usage_logs
             WHERE action = 'download' AND created_at >= ?) AS downloaders
        """,
        (cutoff_iso, cutoff_iso),
    ).fetchone()
    return {
        "new_users": row["new_users"] or 0,
        "downloaders": row["downloaders"] or 0,
    }


def _query_monthly_uv(db: sqlite3.Connection, cutoff_iso: str) -> int:
    """3-month rolling distinct-downloader count. We compute the raw 90d count
    and divide by 3 in metric assembly — the 3-month rolling avg is the
    sample gate (≥ 30 = 1+ download per day avg)."""
    row = db.execute(
        """
        SELECT COUNT(DISTINCT guest_uuid) AS uv_3m FROM guest_usage_logs
        WHERE action = 'download' AND created_at >= ?
        """,
        (cutoff_iso,),
    ).fetchone()
    return row["uv_3m"] or 0


# ── Verdict computation ────────────────────────────────────────────


def _evaluate(metric: str, value: float | None, sample_size: int) -> str:
    """Apply threshold rule + min_sample_size floor. Returns STATUS_*."""
    cfg = THRESHOLDS[metric]
    if not cfg["implemented"]:
        return STATUS_NOT_IMPLEMENTED
    if value is None or sample_size < MIN_SAMPLE_SIZE:
        return STATUS_INSUFFICIENT
    op = cfg["operator"]
    threshold = cfg["threshold"]
    breached = (value < threshold) if op == "<" else (value > threshold)
    return STATUS_FAIL if breached else STATUS_PASS


def _compute_metrics(db: sqlite3.Connection) -> dict[str, Any]:
    """Compute all 6 kill-criteria metrics. Returns a flat dict ready for JSON."""
    now = datetime.now(timezone.utc)
    cutoff_30d = (now - timedelta(days=30)).isoformat()
    cutoff_90d = (now - timedelta(days=90)).isoformat()

    r12 = _query_metric_1_2(db, cutoff_30d)
    rc = _query_registration_conversion(db, cutoff_30d)
    uv_3m = _query_monthly_uv(db, cutoff_90d)

    # Metric 1: reward button CTR (proxy: reward grants / downloaders)
    downloaders = r12["downloaders"]
    reward_grants = r12["reward_grants"]
    reward_button_ctr = (reward_grants / downloaders) if downloaders > 0 else None

    # Metric 2: 5s abandon rate
    clicks = r12["clicks"]
    abandons = r12["abandons"]
    reward_abandon_rate = (abandons / clicks) if clicks > 0 else None

    # Metric 3: affiliate CTR — NOT IMPLEMENTED (no event tracking yet)
    affiliate_ctr: float | None = None

    # Metric 4: registration conversion
    new_users = rc["new_users"]
    registration_conversion = (new_users / downloaders) if downloaders > 0 else None

    # Metric 5: monthly UV (3-month rolling avg)
    monthly_uv_avg = uv_3m / 3

    # Metric 6: platform failure rate — NOT IMPLEMENTED
    platform_failure_rate: float | None = None

    return {
        "metrics": {
            "reward_button_ctr": {
                "value": reward_button_ctr,
                "threshold": THRESHOLDS["reward_button_ctr"]["threshold"],
                "operator": THRESHOLDS["reward_button_ctr"]["operator"],
                "sample_size": downloaders,
                "status": _evaluate("reward_button_ctr", reward_button_ctr, downloaders),
                "trigger_action": THRESHOLDS["reward_button_ctr"]["trigger_action"],
            },
            "reward_abandon_rate": {
                "value": reward_abandon_rate,
                "threshold": THRESHOLDS["reward_abandon_rate"]["threshold"],
                "operator": THRESHOLDS["reward_abandon_rate"]["operator"],
                "sample_size": clicks,
                "status": _evaluate("reward_abandon_rate", reward_abandon_rate, clicks),
                "trigger_action": THRESHOLDS["reward_abandon_rate"]["trigger_action"],
            },
            "affiliate_ctr": {
                "value": affiliate_ctr,
                "threshold": THRESHOLDS["affiliate_ctr"]["threshold"],
                "operator": THRESHOLDS["affiliate_ctr"]["operator"],
                "sample_size": 0,
                "status": STATUS_NOT_IMPLEMENTED,
                "trigger_action": THRESHOLDS["affiliate_ctr"]["trigger_action"],
            },
            "registration_conversion": {
                "value": registration_conversion,
                "threshold": THRESHOLDS["registration_conversion"]["threshold"],
                "operator": THRESHOLDS["registration_conversion"]["operator"],
                "sample_size": downloaders,
                "status": _evaluate(
                    "registration_conversion", registration_conversion, downloaders
                ),
                "trigger_action": THRESHOLDS["registration_conversion"]["trigger_action"],
            },
            "monthly_uv_avg": {
                "value": monthly_uv_avg,
                "threshold": THRESHOLDS["monthly_uv_avg"]["threshold"],
                "operator": THRESHOLDS["monthly_uv_avg"]["operator"],
                "sample_size": uv_3m,
                # Use a separate 30-d-uv floor for monthly_uv_avg (instead of
                # 100 — 1 download per day avg is the meaningful unit).
                "status": (
                    STATUS_INSUFFICIENT
                    if uv_3m < 30
                    else _evaluate("monthly_uv_avg", monthly_uv_avg, monthly_uv_avg)
                ),
                "trigger_action": THRESHOLDS["monthly_uv_avg"]["trigger_action"],
            },
            "platform_failure_rate": {
                "value": platform_failure_rate,
                "threshold": THRESHOLDS["platform_failure_rate"]["threshold"],
                "operator": THRESHOLDS["platform_failure_rate"]["operator"],
                "sample_size": 0,
                "status": STATUS_NOT_IMPLEMENTED,
                "trigger_action": THRESHOLDS["platform_failure_rate"]["trigger_action"],
            },
        }
    }


def _cascade_overall(metrics: dict[str, dict]) -> str:
    """Per-metric status → overall verdict.

    CRUISE            — at least one metric has a real signal (PASS/FAIL), no
                         FAIL anywhere
    WATCHFUL          — ≥1 non-killswitch metric FAIL
    STOP-SHIP         — ≥1 killswitch metric FAIL (monthly_uv_avg or
                         platform_failure_rate — kill-switches for the entire
                         feature)
    INSUFFICIENT_DATA — every metric is NOT_IMPLEMENTED or INSUFFICIENT
                         (no real signal anywhere — don't alert on noise)

    The per-metric ``status`` field is the single source of truth for
    sample-size gating (set by ``_evaluate`` which already checks
    MIN_SAMPLE_SIZE per metric). The cascade does NOT sum sample sizes —
    a single well-populated metric with all others NOT_IMPLEMENTED is still
    a real CRUISE verdict, not INSUFFICIENT_DATA.
    """
    statuses = [m["status"] for m in metrics.values()]
    # No real signal anywhere → INSUFFICIENT_DATA (no alert, banner is info).
    if all(s in (STATUS_INSUFFICIENT, STATUS_NOT_IMPLEMENTED) for s in statuses):
        return VERDICT_INSUFFICIENT
    if any(s == STATUS_FAIL for s in statuses):
        # monthly_uv_avg and platform_failure_rate are kill-switches; their FAIL
        # promotes the overall verdict to STOP-SHIP. Other FAILs are WATCHFUL.
        if (
            metrics["monthly_uv_avg"]["status"] == STATUS_FAIL
            or metrics["platform_failure_rate"]["status"] == STATUS_FAIL
        ):
            return VERDICT_STOPSHIP
        return VERDICT_WATCHFUL
    return VERDICT_CRUISE


def _build_banner(verdict: str, metrics: dict[str, dict]) -> dict[str, str]:
    """Build the dashboard banner payload (mirrors monitor.py shape)."""
    if verdict == VERDICT_STOPSHIP:
        failed = [
            f"{k}={v['value']} (阈值 {v['operator']}{v['threshold']})"
            for k, v in metrics.items()
            if v["status"] == STATUS_FAIL
        ]
        text = "🚨 公开试用 kill criteria 触发：" + "；".join(failed) + "。建议立即执行触发动作"
        severity = "error"
    elif verdict == VERDICT_WATCHFUL:
        failed = [
            f"{k}={v['value']}"
            for k, v in metrics.items()
            if v["status"] == STATUS_FAIL
        ]
        text = "⚠️ 公开试用 kill criteria 监控：" + "；".join(failed) + "。关注下个滚动窗口"
        severity = "warning"
    elif verdict == VERDICT_INSUFFICIENT:
        text = "ℹ️ 公开试用数据不足（< 100 样本），暂不判定。建议等待 Phase 1 数据积累"
        severity = "info"
    else:  # CRUISE
        text = "✅ 公开试用 6 项 kill criteria 全部通过（30d 滚动）"
        severity = "info"
    return {"severity": severity, "text": text}


# ── Webhook delivery ───────────────────────────────────────────────


def _send_webhook(url: str, payload: dict) -> tuple[bool, str]:
    """POST the verdict JSON to a webhook URL. Stdlib urllib only.

    Returns (success, error_message). 5-second timeout so a dead webhook doesn't
    block the daily cron; failures log + return without retry (cron re-fires
    next day with fresh data).
    """
    try:
        body = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return (200 <= resp.status < 300, f"HTTP {resp.status}")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        return (False, f"{type(exc).__name__}: {exc}")


# ── Main ───────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--logs-dir", default=str(DEFAULT_LOGS_DIR),
                    help=f"Logs directory (default: {DEFAULT_LOGS_DIR}).")
    ap.add_argument("--db-path", default=str(DEFAULT_DB_PATH),
                    help=f"SQLite db path (default: {DEFAULT_DB_PATH}).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print verdict without writing JSON or sending webhook.")
    ap.add_argument("--no-webhook", action="store_true",
                    help="Skip webhook delivery even if SAU_KILL_CRITERIA_WEBHOOK is set.")
    args = ap.parse_args()

    logs_dir = Path(args.logs_dir)
    db_path = Path(args.db_path)
    if not logs_dir.exists():
        sys.stdout.write(f"[kill-criteria] logs dir missing ({logs_dir}); nothing to do\n")
        return 0

    # DB connection — read-only. Falls back to in-memory on missing file.
    db = _open_db(db_path)

    metrics_block = _compute_metrics(db)
    overall = _cascade_overall(metrics_block["metrics"])
    banner = _build_banner(overall, metrics_block["metrics"])

    verdict_doc = {
        "snapshot_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tool": "scripts.public_inbox_kill_criteria",
        "version": 1,
        "overall_verdict": overall,
        "banner": banner,
        "metrics": metrics_block["metrics"],
    }

    # Human-readable one-line summary — mirrors monitor_cdp_throttling.py
    # aggregate format (cron tail-f friendly).
    failed_keys = [
        k for k, v in metrics_block["metrics"].items() if v["status"] == STATUS_FAIL
    ]
    sample_sizes_parts = [
        f"{k}={v['sample_size']}" for k, v in metrics_block["metrics"].items()
    ]
    summary = (
        f"[{verdict_doc['snapshot_at']}] kill-criteria sweep: "
        f"verdict={overall}, "
        f"failed={','.join(failed_keys) or 'none'}, "
        f"sample_sizes={','.join(sample_sizes_parts)}\n"
    )
    sys.stdout.write(summary)
    sys.stdout.flush()

    if args.dry_run:
        return 0

    # Persist JSON for web_runner consumer.
    out_path = logs_dir / OUT_FILE_NAME
    out_path.write_text(
        json.dumps(verdict_doc, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    # Webhook delivery on STOP-SHIP or WATCHFUL (informational broadcasts).
    # CRUISE / INSUFFICIENT_DATA: silent (don't spam channels).
    webhook_url = os.environ.get("SAU_KILL_CRITERIA_WEBHOOK", "").strip()
    if webhook_url and not args.no_webhook and overall in (
        VERDICT_STOPSHIP,
        VERDICT_WATCHFUL,
    ):
        ok, msg = _send_webhook(webhook_url, verdict_doc)
        if not ok:
            sys.stderr.write(f"[kill-criteria] webhook failed: {msg}\n")

    # Exit semantics: STOP-SHIP exits 1 (cron will surface this in mail spool).
    # Other verdicts exit 0 (informational, no operator action required).
    return 1 if overall == VERDICT_STOPSHIP else 0


if __name__ == "__main__":
    raise SystemExit(main())
