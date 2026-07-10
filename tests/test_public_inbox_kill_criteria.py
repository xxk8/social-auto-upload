Coverage:
  * _evaluate: per-metric threshold rule + min_sample_size floor + NOT_IMPLEMENTED
  * _cascade_overall: CRUISE / WATCHFUL / STOP-SHIP / INSUFFICIENT_DATA verdict cascade
  * _compute_metrics: 6 metrics with mixed sample sizes + NOT_IMPLEMENTED handling
  * _build_banner: severity + text generation per verdict
  * _send_webhook: success + failure paths (mocked urllib)
  * Endpoint synthetic fallback: missing file + malformed JSON
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Make scripts/ importable as a package-less module.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "scripts"))
sys.path.insert(0, str(_REPO_ROOT))

import public_inbox_kill_criteria as kc  # noqa: E402

from web_runner.routes import public_inbox_kill_criteria as route_module  # noqa: E402

# ── Test fixtures ─────────────────────────────────────────────────




# ── Test isolation: clean public-inbox tables per-test ──────────────────


@pytest.fixture(autouse=True)
def _clean_kc_tables():
    """Wipe the public-inbox tables before AND after each test.

    Post-SQLite-removal: name preserved for back-compat with the prior
    in-memory sqlite fixture. Now returns ``get_database()`` (production
    PG) so the existing ``_seed_recent`` + test method signatures work
    unchanged. Tests use the production PG via ``get_database()`` and rely on
    per-test cleanup for isolation.
    """
    from web_runner.db import get_database
    db = get_database()
    for sql in (
        "DELETE FROM guest_usage_logs",
        "DELETE FROM reward_events",
        "DELETE FROM users",
    ):
        try:
            db.execute(sql)
        except Exception:
            pass
    yield
    for sql in (
        "DELETE FROM guest_usage_logs",
        "DELETE FROM reward_events",
        "DELETE FROM users",
    ):
        try:
            db.execute(sql)
        except Exception:
            pass


@pytest.fixture
def in_memory_db():
    """In-memory SQLite with the schema the script queries.

    Mirrors the public-inbox-monetization change's `guest_usage_logs` +
    `reward_events` tables. `users` table mirrors `web_runner/db.py::init_db()`.
    """
    conn = sqlite3.connect(":memory:")
    conn.executescript("""
        CREATE TABLE guest_usage_logs (
            id INTEGER PRIMARY KEY,
            guest_uuid TEXT NOT NULL,
            ip TEXT,
            action TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE reward_events (
            id INTEGER PRIMARY KEY,
            guest_uuid TEXT NOT NULL,
            ip TEXT,
            event TEXT NOT NULL,
            elapsed_ms INTEGER,
            created_at TEXT NOT NULL
        );
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    """)
    conn.row_factory = sqlite3.Row
    return conn


def _seed_recent(conn: sqlite3.Connection, days_ago: int, **rows) -> None:
    """Insert rows with `created_at` = (now - days_ago) ISO timestamp."""
    iso = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    for table, payloads in [
        ("guest_usage_logs", rows.get("usage", [])),
        ("reward_events", rows.get("events", [])),
        ("users", rows.get("users", [])),
    ]:
        for p in payloads:
            p = {**p, "created_at": iso}
            cols = ", ".join(p.keys())
            placeholders = ", ".join("?" for _unused in p)
            conn.execute(
                f"INSERT INTO {table} ({cols}) VALUES ({placeholders})",
                tuple(p.values()),
            )
    conn.commit()


# ── _evaluate tests ───────────────────────────────────────────────


class TestEvaluate:
    def test_pass_when_above_lower_bound(self):
        # reward_button_ctr: 0.10 (10%) > 0.05 threshold → PASS
        assert kc._evaluate("reward_button_ctr", 0.10, 500) == kc.STATUS_PASS

    def test_fail_when_below_lower_bound(self):
        # reward_button_ctr: 0.03 (3%) < 0.05 threshold → FAIL
        assert kc._evaluate("reward_button_ctr", 0.03, 500) == kc.STATUS_FAIL

    def test_fail_when_above_upper_bound(self):
        # reward_abandon_rate: 0.80 (80%) > 0.70 threshold → FAIL
        assert kc._evaluate("reward_abandon_rate", 0.80, 500) == kc.STATUS_FAIL

    def test_pass_when_below_upper_bound(self):
        # reward_abandon_rate: 0.50 (50%) < 0.70 threshold → PASS
        assert kc._evaluate("reward_abandon_rate", 0.50, 500) == kc.STATUS_PASS

    def test_insufficient_when_below_min_sample_size(self):
        # 50 samples < 100 floor → INSUFFICIENT_DATA (don't alert on noise)
        assert kc._evaluate("reward_button_ctr", 0.01, 50) == kc.STATUS_INSUFFICIENT

    def test_insufficient_when_value_none(self):
        assert kc._evaluate("reward_button_ctr", None, 500) == kc.STATUS_INSUFFICIENT

    def test_not_implemented_for_unwired_metric(self):
        # affiliate_ctr / platform_failure_rate have implemented=False
        assert kc._evaluate("affiliate_ctr", 0.05, 500) == kc.STATUS_NOT_IMPLEMENTED
        assert kc._evaluate("platform_failure_rate", 0.05, 500) == kc.STATUS_NOT_IMPLEMENTED


# ── _cascade_overall tests ────────────────────────────────────────


class TestCascadeOverall:
    def _metrics(self, **overrides):
        """Build a metrics dict where every metric is PASS by default;
        override keys/values to flip individual statuses."""
        base = {
            "reward_button_ctr": {"status": kc.STATUS_PASS, "sample_size": 500, "value": 0.10},
            "reward_abandon_rate": {"status": kc.STATUS_PASS, "sample_size": 500, "value": 0.50},
            "affiliate_ctr": {"status": kc.STATUS_NOT_IMPLEMENTED, "sample_size": 0, "value": None},
            "registration_conversion": {"status": kc.STATUS_PASS, "sample_size": 500, "value": 0.05},
            "monthly_uv_avg": {"status": kc.STATUS_PASS, "sample_size": 100, "value": 7000},
            "platform_failure_rate": {"status": kc.STATUS_NOT_IMPLEMENTED, "sample_size": 0, "value": None},
        }
        for k, v in overrides.items():
            base[k]["status"] = v
        return base

    def test_cruise_when_all_pass(self):
        assert kc._cascade_overall(self._metrics()) == kc.VERDICT_CRUISE

    def test_watchful_when_one_non_killswitch_fails(self):
        m = self._metrics(reward_button_ctr=kc.STATUS_FAIL)
        assert kc._cascade_overall(m) == kc.VERDICT_WATCHFUL

    def test_stopship_when_monthly_uv_fails(self):
        m = self._metrics(monthly_uv_avg=kc.STATUS_FAIL)
        assert kc._cascade_overall(m) == kc.VERDICT_STOPSHIP

    def test_stopship_when_platform_failure_fails(self):
        m = self._metrics(platform_failure_rate=kc.STATUS_FAIL)
        assert kc._cascade_overall(m) == kc.VERDICT_STOPSHIP

    def test_insufficient_when_all_metrics_lack_signal(self):
        # Every metric is INSUFFICIENT or NOT_IMPLEMENTED (no PASS, no FAIL)
        m = self._metrics(
            reward_button_ctr=kc.STATUS_INSUFFICIENT,
            reward_abandon_rate=kc.STATUS_INSUFFICIENT,
            registration_conversion=kc.STATUS_INSUFFICIENT,
            monthly_uv_avg=kc.STATUS_INSUFFICIENT,
        )
        assert kc._cascade_overall(m) == kc.VERDICT_INSUFFICIENT


# ── _compute_metrics integration test ─────────────────────────────


class TestComputeMetrics:
    def test_returns_6_metric_keys(self, in_memory_db):
        result = kc._compute_metrics(in_memory_db)
        assert set(result["metrics"].keys()) == {
            "reward_button_ctr",
            "reward_abandon_rate",
            "affiliate_ctr",
            "registration_conversion",
            "monthly_uv_avg",
            "platform_failure_rate",
        }

    def test_handles_empty_db(self, in_memory_db):
        result = kc._compute_metrics(in_memory_db)
        for _k, v in result["metrics"].items():
            # Empty DB → all values None / 0; status INSUFFICIENT or NOT_IMPLEMENTED
            assert v["status"] in (kc.STATUS_INSUFFICIENT, kc.STATUS_NOT_IMPLEMENTED)
            assert v["sample_size"] == 0

    def test_ctr_computation_with_realistic_data(self, in_memory_db):
        # 200 downloaders, 5 reward grants → 2.5% CTR (below 5% threshold)
        _seed_recent(
            in_memory_db,
            days_ago=5,
            usage=[{"guest_uuid": f"u{i}", "ip": "1.1.1.1", "action": "download"} for i in range(200)],
        )
        _seed_recent(
            in_memory_db,
            days_ago=5,
            usage=[{"guest_uuid": f"r{i}", "ip": "1.1.1.1", "action": "reward"} for i in range(5)],
        )
        result = kc._compute_metrics(in_memory_db)
        ctr = result["metrics"]["reward_button_ctr"]
        assert ctr["value"] == pytest.approx(5 / 200, rel=1e-3)
        assert ctr["sample_size"] == 200  # unique downloaders
        assert ctr["status"] == kc.STATUS_FAIL  # 2.5% < 5% threshold

    def test_5s_abandon_with_realistic_data(self, in_memory_db):
        # 100 clicks, 80 abandons → 80% abandon rate (above 70% threshold)
        _seed_recent(
            in_memory_db,
            days_ago=5,
            events=[{"guest_uuid": f"c{i}", "ip": "1.1.1.1", "event": "reward_button_click", "elapsed_ms": 0} for i in range(100)],
        )
        _seed_recent(
            in_memory_db,
            days_ago=5,
            events=[{"guest_uuid": f"a{i}", "ip": "1.1.1.1", "event": "reward_abandon", "elapsed_ms": 4000} for i in range(80)],
        )
        result = kc._compute_metrics(in_memory_db)
        abandon = result["metrics"]["reward_abandon_rate"]
        assert abandon["value"] == pytest.approx(80 / 100, rel=1e-3)
        assert abandon["status"] == kc.STATUS_FAIL  # 80% > 70% threshold

    def test_old_data_excluded_from_30d_window(self, in_memory_db):
        # 200 downloaders 60 days ago → should NOT count in 30d window
        _seed_recent(
            in_memory_db,
            days_ago=60,
            usage=[{"guest_uuid": f"u{i}", "ip": "1.1.1.1", "action": "download"} for i in range(200)],
        )
        result = kc._compute_metrics(in_memory_db)
        ctr = result["metrics"]["reward_button_ctr"]
        assert ctr["sample_size"] == 0  # outside window
        assert ctr["status"] == kc.STATUS_INSUFFICIENT


# ── _build_banner tests ───────────────────────────────────────────


class TestBuildBanner:
    def _metrics_for_verdict(self, verdict: str) -> dict:
        if verdict == kc.VERDICT_STOPSHIP:
            return {
                "monthly_uv_avg": {"status": kc.STATUS_FAIL, "value": 1000, "operator": "<", "threshold": 5000},
            }
        if verdict == kc.VERDICT_WATCHFUL:
            return {
                "reward_button_ctr": {"status": kc.STATUS_FAIL, "value": 0.03, "operator": "<", "threshold": 0.05},
            }
        return {}

    def test_stopship_banner_uses_error_severity(self):
        banner = kc._build_banner(kc.VERDICT_STOPSHIP, self._metrics_for_verdict(kc.VERDICT_STOPSHIP))
        assert banner["severity"] == "error"
        assert "🚨" in banner["text"]
        assert "monthly_uv_avg" in banner["text"]

    def test_watchful_banner_uses_warning_severity(self):
        banner = kc._build_banner(kc.VERDICT_WATCHFUL, self._metrics_for_verdict(kc.VERDICT_WATCHFUL))
        assert banner["severity"] == "warning"
        assert "⚠️" in banner["text"]

    def test_cruise_banner_uses_info_severity(self):
        banner = kc._build_banner(kc.VERDICT_CRUISE, self._metrics_for_verdict(kc.VERDICT_CRUISE))
        assert banner["severity"] == "info"
        assert "✅" in banner["text"]

    def test_insufficient_banner_uses_info_severity(self):
        banner = kc._build_banner(kc.VERDICT_INSUFFICIENT, {})
        assert banner["severity"] == "info"
        assert "数据不足" in banner["text"]


# ── _send_webhook tests ───────────────────────────────────────────


class TestSendWebhook:
    def test_success_path(self):
        fake_resp = MagicMock()
        fake_resp.status = 200
        fake_resp.__enter__ = MagicMock(return_value=fake_resp)
        fake_resp.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=fake_resp):
            ok, msg = kc._send_webhook("https://example.com/hook", {"x": 1})
        assert ok is True
        assert "200" in msg

    def test_network_error_path(self):
        with patch("urllib.request.urlopen", side_effect=OSError("dns failed")):
            ok, msg = kc._send_webhook("https://example.com/hook", {"x": 1})
        assert ok is False
        assert "dns failed" in msg


# ── Route synthetic fallback tests ───────────────────────────────


class TestRouteSyntheticFallback:
    def test_missing_artifact_returns_200_insufficient(self, tmp_path, monkeypatch):
        # Re-route the artifact path to a non-existent file via cwd swap.
        monkeypatch.chdir(tmp_path)
        with patch.object(route_module, "admin_required", lambda f: f):
            from flask import Flask
            app = Flask(__name__)
            app.register_blueprint(route_module.bp)
            client = app.test_client()
            resp = client.get("/api/public-inbox/kill-criteria")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["overall_verdict"] == "INSUFFICIENT_DATA"
        assert data["_synthetic"] is True

    def test_malformed_artifact_returns_500_parse_error(self, tmp_path, monkeypatch):
        (tmp_path / ".sau-logs").mkdir()
        (tmp_path / ".sau-logs" / "public-inbox-kill-criteria.json").write_text("{ broken json", encoding="utf-8")
        monkeypatch.chdir(tmp_path)
        with patch.object(route_module, "admin_required", lambda f: f):
            from flask import Flask
            app = Flask(__name__)
            app.register_blueprint(route_module.bp)
            client = app.test_client()
            resp = client.get("/api/public-inbox/kill-criteria")
        assert resp.status_code == 500
        data = resp.get_json()
        assert data["overall_verdict"] == "PARSE_ERROR"

    def test_valid_artifact_passthrough(self, tmp_path, monkeypatch):
        (tmp_path / ".sau-logs").mkdir()
        verdict = {
            "snapshot_at": "2026-07-02T07:00:00+00:00",
            "tool": "scripts.public_inbox_kill_criteria",
            "version": 1,
            "overall_verdict": "CRUISE",
            "banner": {"severity": "info", "text": "✅ all pass"},
            "metrics": {},
        }
        (tmp_path / ".sau-logs" / "public-inbox-kill-criteria.json").write_text(
            json.dumps(verdict), encoding="utf-8"
        )
        monkeypatch.chdir(tmp_path)
        with patch.object(route_module, "admin_required", lambda f: f):
            from flask import Flask
            app = Flask(__name__)
            app.register_blueprint(route_module.bp)
            client = app.test_client()
            resp = client.get("/api/public-inbox/kill-criteria")
        assert resp.status_code == 200
        assert resp.get_json()["overall_verdict"] == "CRUISE"
        # Cache-Control header applied for fresh artifact
        assert "max-age=300" in resp.headers.get("Cache-Control", "")


# ── Three-way lockstep: THRESHOLDS ↔ _index.json ↔ baseline file ──
#
# The kill-criteria thresholds live in 3 places that must stay in lockstep:
#   1. scripts/public_inbox_kill_criteria.py :: THRESHOLDS (runtime source of truth)
#   2. openspec/changes/public-inbox-monetization/_index.json :: killCriteria
#      (design-doc source of truth — threshold values only)
#   3. .sau-logs/.public-inbox-kill-criteria-baseline-<date>.json
#      (deploy-time snapshot — full THRESHOLDS dict, all 3 fields per metric)
#
# Future threshold-tune: if a dev edits one source but forgets the other two,
# this test fails immediately so the drift is caught before merge.

# Field-name mapping: THRESHOLDS uses snake_case, openspec uses camelCase.
# The pattern is consistent: snake → camel + "Threshold" suffix.
_METRIC_TO_OPENSPEC_FIELD = {
    "reward_button_ctr": "rewardButtonCtrThreshold",
    "reward_abandon_rate": "rewardAbandonThreshold",
    "affiliate_ctr": "affiliateCtrThreshold",
    "registration_conversion": "registrationConversionThreshold",
    "monthly_uv_avg": "monthlyUvThreshold",
    "platform_failure_rate": "platformFailureRateThreshold",
}


def _load_openspec_kill_criteria() -> dict:
    """Read openspec/changes/public-inbox-monetization/_index.json :: killCriteria."""
    openspec_path = _REPO_ROOT / "openspec" / "changes" / "public-inbox-monetization" / "_index.json"
    return json.loads(openspec_path.read_text(encoding="utf-8"))["killCriteria"]


def _load_latest_baseline_thresholds() -> tuple[dict, Path]:
    """Find the most recent .public-inbox-kill-criteria-baseline-*.json file
    in .sau-logs/ and return its `thresholds` block + the file path.

    Raises FileNotFoundError if no baseline exists (operator must run the
    pre-deploy first to generate it).
    """
    logs_dir = _REPO_ROOT / ".sau-logs"
    baselines = sorted(logs_dir.glob(".public-inbox-kill-criteria-baseline-*.json"))
    if not baselines:
        raise FileNotFoundError(
            f"No baseline file found in {logs_dir}. "
            f"Run: bash scripts/public-inbox-monetization-pre-deploy.sh to generate it. "
            f"(Or in test/CI: the baseline is generated as a side-effect of the pre-deploy dry-run.)"
        )
    latest = baselines[-1]
    return json.loads(latest.read_text(encoding="utf-8"))["thresholds"], latest


class TestThreeWayLockstep:
    """Verify the 3 sources of truth stay in sync.

    Compares:
      * THRESHOLDS dict  (scripts/public_inbox_kill_criteria.py)
      * _index.json :: killCriteria  (openspec design doc)
      * Baseline file  (.sau-logs/.public-inbox-kill-criteria-baseline-*.json)

    Field comparison:
      * THRESHOLDS ↔ baseline: threshold / operator / implemented
      * THRESHOLDS ↔ openspec: threshold only (openspec has no operator/implemented)
      * openspec ↔ baseline:   threshold only (same reason)
    """

    def test_threshold_values_match_across_all_three_sources(self):
        """The `threshold` value for each of the 6 metrics must match across
        THRESHOLDS dict / openspec killCriteria / baseline file.

        Catches the most common drift: tuning a threshold in one place and
        forgetting the other two.
        """
        openspec = _load_openspec_kill_criteria()
        baseline, baseline_path = _load_latest_baseline_thresholds()

        mismatches = []
        for metric, openspec_field in _METRIC_TO_OPENSPEC_FIELD.items():
            thresh_value = kc.THRESHOLDS[metric]["threshold"]
            openspec_value = openspec[openspec_field]
            baseline_value = baseline[metric]["threshold"]

            if thresh_value != openspec_value:
                mismatches.append(
                    f"  {metric} THRESHOLDS.threshold={thresh_value} ≠ "
                    f"openspec.{openspec_field}={openspec_value}"
                )
            if thresh_value != baseline_value:
                mismatches.append(
                    f"  {metric} THRESHOLDS.threshold={thresh_value} ≠ "
                    f"baseline[{metric}].threshold={baseline_value} (from {baseline_path.name})"
                )

        assert not mismatches, (
            "Threshold drift detected across 3 sources of truth. "
            "When re-tuning a threshold, update ALL THREE:\n"
            "  1. scripts/public_inbox_kill_criteria.py :: THRESHOLDS\n"
            "  2. openspec/changes/public-inbox-monetization/_index.json :: killCriteria\n"
            "  3. Re-run scripts/public-inbox-monetization-pre-deploy.sh to regenerate the baseline\n"
            "\nMismatches:\n" + "\n".join(mismatches)
        )

    def test_operator_and_implemented_match_between_thresholds_and_baseline(self):
        """The `operator` and `implemented` fields are NOT in openspec, so
        they're only compared between THRESHOLDS (runtime) and the baseline
        (deploy-time snapshot).

        Catches drift where the operator is flipped (e.g. `<` vs `>`) or
        a metric's `implemented` flag is toggled but the baseline wasn't
        regenerated.
        """
        baseline, baseline_path = _load_latest_baseline_thresholds()

        mismatches = []
        for metric in kc.THRESHOLDS:
            thresh_op = kc.THRESHOLDS[metric]["operator"]
            thresh_impl = kc.THRESHOLDS[metric]["implemented"]
            baseline_op = baseline[metric]["operator"]
            baseline_impl = baseline[metric]["implemented"]

            if thresh_op != baseline_op:
                mismatches.append(
                    f"  {metric} THRESHOLDS.operator={thresh_op!r} ≠ "
                    f"baseline.operator={baseline_op!r}"
                )
            if thresh_impl != baseline_impl:
                mismatches.append(
                    f"  {metric} THRESHOLDS.implemented={thresh_impl} ≠ "
                    f"baseline.implemented={baseline_impl}"
                )

        assert not mismatches, (
            "Operator/implemented drift between THRESHOLDS and baseline. "
            "Re-run scripts/public-inbox-monetization-pre-deploy.sh to regenerate "
            f"the baseline ({baseline_path.name}).\n"
            "\nMismatches:\n" + "\n".join(mismatches)
        )

    def test_all_six_metrics_present_in_all_three_sources(self):
        """All 3 sources must have the same 6 metric keys. Catches the case
        where a dev adds a new metric to THRESHOLDS but forgets to add it
        to openspec or vice versa.

        Uses the canonical _METRIC_TO_OPENSPEC_FIELD mapping to iterate,
        not a reverse-map — each metric is checked per-source, and missing
        keys are reported individually.
        """
        openspec = _load_openspec_kill_criteria()
        baseline, _ = _load_latest_baseline_thresholds()

        problems = []
        for metric, openspec_field in _METRIC_TO_OPENSPEC_FIELD.items():
            if metric not in kc.THRESHOLDS:
                problems.append(f"  THRESHOLDS missing metric: {metric}")
            if metric not in baseline:
                problems.append(f"  baseline missing metric: {metric}")
            if openspec_field not in openspec:
                problems.append(
                    f"  openspec killCriteria missing field '{openspec_field}' (for metric '{metric}')"
                )

        assert not problems, (
            "Metric key drift across the 3 sources. New metrics must be added "
            "to ALL THREE in lockstep.\n" + "\n".join(problems)
        )

    def test_baseline_metadata_present(self):
        """The baseline file must carry the expected metadata fields
        (created_at / tool / version / purpose) so a future operator
        can identify what generated it and when.

        Note: this test globs directly for the baseline file rather than
        calling _load_latest_baseline_thresholds() because that helper only
        returns the .thresholds block. We need the raw metadata dict here.
        """
        from tests.test_public_inbox_kill_criteria import _REPO_ROOT
        logs_dir = _REPO_ROOT / ".sau-logs"
        baselines = sorted(logs_dir.glob(".public-inbox-kill-criteria-baseline-*.json"))
        assert baselines, f"no baseline file in {logs_dir}"
        # Read the full baseline doc (not just .thresholds) for metadata inspection
        raw = json.loads(baselines[-1].read_text(encoding="utf-8"))
        for key in ("created_at", "tool", "version", "purpose", "thresholds"):
            assert key in raw, f"baseline missing metadata key: {key}"
        assert raw["tool"] == "scripts.public_inbox_kill_criteria"
        assert isinstance(raw["version"], int)
