"""
End-to-end smoke test for ``scripts/public-inbox-monetization-pre-deploy.sh``.

This is the post-PR-A successor to the TBF-018 ``scripts/pre-deploy-dry-run.sh``;
its semantic is "verify the public-inbox daily cron can be deployed right now".

Mirrors the runbook §6 Mode A pattern: a temp SQLite file with injected
fixture rows drives the kill-criteria cascade, the bash script is invoked
via subprocess, and we assert on exit code + verdict JSON.

Covers:

* Schema check: post-PR-A dev DB (3 tables present) → OK + exit 0
* Schema check: pre-PR-A dev DB (0 public-inbox tables) → FATAL + exit 2
* End-to-end: CRUISE scenario → exit 0 + verdict=CRUISE + DEPLOY recommendation
* End-to-end: WATCHFUL scenario → exit 0 + verdict=WATCHFUL
* End-to-end: STOP-SHIP scenario → exit 1 + verdict=STOP-SHIP + DO NOT DEPLOY
* Artifact materialization: dry-run artifact JSON is persisted + annotated
* Live emission NOT clobbered: the temp logs dir keeps daily emission clean
"""
import json
import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "public-inbox-monetization-pre-deploy.sh"


# ==================== fixtures ====================

PUBLIC_INBOX_SCHEMA = """
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
"""


def _bootstrap_temp_db(tmp_path: Path, with_tables: bool = True) -> Path:
    """Create a temp SQLite file at ``tmp_path/smoke.db``.

    If ``with_tables`` is True, the public-inbox schema is created (post-PR-A
    state). If False, only an unrelated table is created (pre-PR-A state).
    """
    db_path = tmp_path / "smoke.db"
    c = sqlite3.connect(db_path)
    if with_tables:
        c.executescript(PUBLIC_INBOX_SCHEMA)
    else:
        c.executescript("CREATE TABLE some_other_table (id INTEGER PRIMARY KEY, name TEXT);")
    c.commit()
    return db_path


def _inject_30d_window_activity(c: sqlite3.Connection, n_downloaders: int, n_reward_grants: int) -> None:
    """Inject downloader + reward grant rows at -5 days (inside 30d window)."""
    c.executescript(f"""
        INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
        SELECT 'd' || x, '10.0.0.1', 'download', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<{n_downloaders}) SELECT x FROM cnt);

        INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
        SELECT 'r' || x, '10.0.0.1', 'reward', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<{n_reward_grants}) SELECT x FROM cnt);
    """)


def _inject_clicks_abandons(c: sqlite3.Connection, n_clicks: int, n_abandons: int) -> None:
    """Inject reward_button_click + reward_abandon rows at -5 days."""
    c.executescript(f"""
        INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
        SELECT 'c' || x, '10.0.0.1', 'reward_button_click', 0, datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<{n_clicks}) SELECT x FROM cnt);

        INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
        SELECT 'a' || x, '10.0.0.1', 'reward_abandon', 4000, datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<{n_abandons}) SELECT x FROM cnt);
    """)


def _inject_users(c: sqlite3.Connection, n_users: int) -> None:
    c.executescript(f"""
        INSERT INTO users (email, role, created_at)
        SELECT 'u' || x || '@smoke.test', 'user', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<{n_users}) SELECT x FROM cnt);
    """)


def _inject_90d_padding(c: sqlite3.Connection, n: int) -> None:
    """Inject 90d-window downloaders placed at days 31-89 (OUTSIDE the 30d window,
    so they only contribute to uv_3m, not 30d sample_size).
    """
    c.executescript(f"""
        INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
        SELECT 'h' || x, '10.0.0.1', 'download', datetime('now', '-' || (30 + (x % 60)) || ' days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<{n}) SELECT x FROM cnt);
    """)


def _run_pre_deploy(db_path: Path, logs_dir: Path) -> subprocess.CompletedProcess:
    """Invoke the bash pre-deploy script with env-var overrides for DB + logs."""
    return subprocess.run(
        ["bash", str(SCRIPT_PATH), str(REPO_ROOT)],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "SAU_DB_PATH_OVERRIDE": str(db_path),
            "SAU_LOGS_DIR_OVERRIDE": str(logs_dir),
        },
        cwd=str(REPO_ROOT),
        timeout=60,
    )


# ==================== schema check tests ====================

def test_post_pr_a_db_passes_validation(tmp_path):
    """Dev DB with all 3 public-inbox tables present → OK + exit 0."""
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    result = _run_pre_deploy(db_path, logs_dir)

    assert result.returncode == 0, (
        f"expected exit 0, got {result.returncode}\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    assert "OK: dev DB in post-PR-A state" in result.stdout
    assert "validation PASSED" in result.stdout


def test_pre_pr_a_db_fails_validation(tmp_path):
    """Dev DB WITHOUT public-inbox tables → FATAL + exit 2 (post-PR-A required)."""
    db_path = _bootstrap_temp_db(tmp_path, with_tables=False)
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    result = _run_pre_deploy(db_path, logs_dir)

    assert result.returncode == 2, f"expected exit 2, got {result.returncode}: {result.stderr}"
    assert "FATAL" in result.stderr
    assert "missing public-inbox tables" in result.stderr
    assert "pre-PR-A sibling" in result.stderr or "pre-deploy-dry-run.sh" in result.stderr


def test_missing_db_file_fails_validation(tmp_path):
    """DB file does not exist → FATAL + exit 2 (post-PR-A expected: DB must exist)."""
    db_path = tmp_path / "does_not_exist.db"  # never created
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    result = _run_pre_deploy(db_path, logs_dir)

    assert result.returncode == 2, f"expected exit 2, got {result.returncode}: {result.stderr}"
    assert "FATAL" in result.stderr
    assert "not found" in result.stderr


# ==================== end-to-end cascade scenarios ====================

def test_cruise_scenario_exits_0(tmp_path):
    """CRUISE fixture → exit 0 + verdict=CRUISE + DEPLOY recommendation."""
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    c = sqlite3.connect(db_path)
    _inject_30d_window_activity(c, n_downloaders=1000, n_reward_grants=60)
    _inject_clicks_abandons(c, n_clicks=100, n_abandons=10)
    _inject_users(c, n_users=50)
    _inject_90d_padding(c, n=15000)
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = _run_pre_deploy(db_path, logs_dir)

    assert result.returncode == 0, f"expected exit 0, got {result.returncode}: {result.stderr}"
    assert "verdict=CRUISE" in result.stdout.lower() or "Verdict:            CRUISE" in result.stdout

    # Verify the artifact
    artifacts = sorted(logs_dir.glob(".public-inbox-predeploy-dry-run-*.json"))
    assert len(artifacts) == 1, f"expected exactly 1 artifact, found {len(artifacts)}"
    artifact = json.loads(artifacts[0].read_text())
    assert artifact["overall_verdict"] == "CRUISE"
    assert artifact["pre_deploy_dry_run"]["deploy_recommendation"] == "DEPLOY"


def test_watchful_scenario_exits_0(tmp_path):
    """WATCHFUL fixture (reward_button_ctr < 5%) → exit 0 + verdict=WATCHFUL."""
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    c = sqlite3.connect(db_path)
    _inject_30d_window_activity(c, n_downloaders=1000, n_reward_grants=10)  # 1% CTR → FAIL
    _inject_clicks_abandons(c, n_clicks=100, n_abandons=10)  # 10% abandon → PASS
    _inject_users(c, n_users=50)  # 5% conv → PASS
    _inject_90d_padding(c, n=15000)  # uv_3m PASS
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = _run_pre_deploy(db_path, logs_dir)

    assert result.returncode == 0, f"expected exit 0, got {result.returncode}: {result.stderr}"
    assert "WATCHFUL" in result.stdout

    artifacts = sorted(logs_dir.glob(".public-inbox-predeploy-dry-run-*.json"))
    assert len(artifacts) == 1
    artifact = json.loads(artifacts[0].read_text())
    assert artifact["overall_verdict"] == "WATCHFUL"
    assert artifact["pre_deploy_dry_run"]["deploy_recommendation"] == "DEPLOY"  # WATCHFUL is still deploy


def test_stop_ship_scenario_exits_1(tmp_path):
    """STOP-SHIP fixture (monthly_uv_avg < 5000) → exit 1 + verdict=STOP-SHIP."""
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    c = sqlite3.connect(db_path)
    # 30d-window activity stays at CRUISE levels, but NO 90d padding
    _inject_30d_window_activity(c, n_downloaders=1000, n_reward_grants=60)
    _inject_clicks_abandons(c, n_clicks=100, n_abandons=10)
    _inject_users(c, n_users=50)
    # _inject_90d_padding: SKIP — monthly_uv_avg = 1000/3 = 333 < 5000 → killswitch FAIL
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = _run_pre_deploy(db_path, logs_dir)

    assert result.returncode == 1, f"expected exit 1, got {result.returncode}: {result.stderr}"
    assert "STOP-SHIP" in result.stdout

    artifacts = sorted(logs_dir.glob(".public-inbox-predeploy-dry-run-*.json"))
    assert len(artifacts) == 1
    artifact = json.loads(artifacts[0].read_text())
    assert artifact["overall_verdict"] == "STOP-SHIP"
    assert artifact["pre_deploy_dry_run"]["deploy_recommendation"] == "DO NOT DEPLOY"


def test_insufficient_data_scenario_exits_0(tmp_path):
    """INSUFFICIENT_DATA scenario (sample < 100) → exit 0 + verdict=INSUFFICIENT_DATA."""
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    c = sqlite3.connect(db_path)
    # Only 50 downloaders (sample < 100 → INSUFFICIENT_DATA across all metrics)
    _inject_30d_window_activity(c, n_downloaders=50, n_reward_grants=0)
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = _run_pre_deploy(db_path, logs_dir)

    assert result.returncode == 0, f"expected exit 0, got {result.returncode}: {result.stderr}"

    artifacts = sorted(logs_dir.glob(".public-inbox-predeploy-dry-run-*.json"))
    assert len(artifacts) == 1
    artifact = json.loads(artifacts[0].read_text())
    assert artifact["overall_verdict"] == "INSUFFICIENT_DATA"


# ==================== artifact + isolation tests ====================

def test_dry_run_does_not_clobber_live_emission(tmp_path):
    """The pre-deploy dry-run writes to a timestamped artifact, NOT
    .sau-logs/public-inbox-kill-criteria.json. This protects the live daily
    emission from being overwritten by the pre-deploy test.
    """
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    c = sqlite3.connect(db_path)
    _inject_30d_window_activity(c, n_downloaders=1000, n_reward_grants=60)
    _inject_clicks_abandons(c, n_clicks=100, n_abandons=10)
    _inject_users(c, n_users=50)
    _inject_90d_padding(c, n=15000)
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = _run_pre_deploy(db_path, logs_dir)
    assert result.returncode == 0, f"unexpected exit code: {result.returncode}: {result.stderr}"

    # Live daily emission should NOT exist (we use a temp logs dir for the dry-run)
    live_emission = logs_dir / "public-inbox-kill-criteria.json"
    assert not live_emission.exists(), (
        f"live emission {live_emission} should NOT be created by the pre-deploy dry-run; "
        f"the dry-run should write to a timestamped artifact only"
    )

    # Dry-run artifact should exist
    artifacts = sorted(logs_dir.glob(".public-inbox-predeploy-dry-run-*.json"))
    assert len(artifacts) == 1


def test_pre_deploy_dry_run_artifact_schema(tmp_path):
    """
    Schema lock for the dry-run artifact JSON.

    Top-level keys must be exactly:
      snapshot_at, overall_verdict, banner, metrics, pre_deploy_dry_run, tool, version

    Per-metric keys must be exactly:
      value, threshold, operator, sample_size, status, trigger_action

    Number of metrics must be exactly 6.

    If any field is added, removed, or renamed, this test fails immediately,
    forcing the developer to update this schema lock (preventing silent
    field drift between the pre-deploy pipeline and its consumers).
    """
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    c = sqlite3.connect(db_path)
    _inject_30d_window_activity(c, n_downloaders=1000, n_reward_grants=60)
    _inject_clicks_abandons(c, n_clicks=100, n_abandons=10)
    _inject_users(c, n_users=50)
    _inject_90d_padding(c, n=15000)
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = _run_pre_deploy(db_path, logs_dir)
    assert result.returncode == 0, (
        f"pre-deploy failed for CRUISE fixture (rc={result.returncode}):\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )

    artifacts = sorted(logs_dir.glob(".public-inbox-predeploy-dry-run-*.json"))
    assert len(artifacts) == 1
    artifact = json.loads(artifacts[0].read_text())

    # ── Top-level schema lock ────────────────────────────────────────────
    EXPECTED_TOP_KEYS = {
        "snapshot_at",
        "overall_verdict",
        "banner",
        "metrics",
        "pre_deploy_dry_run",
        "tool",
        "version",
    }
    actual_top_keys = set(artifact.keys())
    assert actual_top_keys == EXPECTED_TOP_KEYS, (
        f"dry-run artifact top-level keys mismatch\n"
        f"  unexpected: {actual_top_keys - EXPECTED_TOP_KEYS}\n"
        f"  missing:    {EXPECTED_TOP_KEYS - actual_top_keys}"
    )

    # ── Per-metric schema lock ───────────────────────────────────────────
    EXPECTED_METRIC_FIELDS = {"value", "threshold", "operator", "sample_size", "status", "trigger_action"}
    metrics = artifact["metrics"]
    assert len(metrics) == 6, (
        f"expected exactly 6 metrics, found {len(metrics)}: {list(metrics.keys())}"
    )
    EXPECTED_METRIC_NAMES = {
        "reward_button_ctr",
        "reward_abandon_rate",
        "affiliate_ctr",
        "registration_conversion",
        "monthly_uv_avg",
        "platform_failure_rate",
    }
    assert set(metrics.keys()) == EXPECTED_METRIC_NAMES, (
        f"metric name mismatch\n"
        f"  unexpected: {set(metrics.keys()) - EXPECTED_METRIC_NAMES}\n"
        f"  missing:    {EXPECTED_METRIC_NAMES - set(metrics.keys())}"
    )

    for metric_name, metric_data in metrics.items():
        actual_fields = set(metric_data.keys())
        assert actual_fields == EXPECTED_METRIC_FIELDS, (
            f"metric {metric_name!r} field mismatch\n"
            f"  unexpected: {actual_fields - EXPECTED_METRIC_FIELDS}\n"
            f"  missing:    {EXPECTED_METRIC_FIELDS - actual_fields}"
        )

    # ── Value-type sanity checks ─────────────────────────────────────────
    assert isinstance(artifact["snapshot_at"], str) and artifact["snapshot_at"], (
        "snapshot_at must be a non-empty string"
    )
    assert artifact["overall_verdict"] == "CRUISE", (
        f"expected CRUISE verdict, got {artifact['overall_verdict']}"
    )
    assert isinstance(artifact["banner"], dict) and "severity" in artifact["banner"] and "text" in artifact["banner"]
    assert artifact["tool"] == "scripts.public_inbox_kill_criteria"
    assert artifact["version"] == 1
    assert isinstance(artifact["pre_deploy_dry_run"], dict)
    assert artifact["pre_deploy_dry_run"]["deploy_recommendation"] == "DEPLOY"


def test_temp_logs_dir_cleaned_up(tmp_path):
    """The pre-deploy dry-run cleans up its own temp logs dir (.predeploy-dry-run-tmp)."""
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    c = sqlite3.connect(db_path)
    _inject_30d_window_activity(c, n_downloaders=1000, n_reward_grants=60)
    _inject_clicks_abandons(c, n_clicks=100, n_abandons=10)
    _inject_users(c, n_users=50)
    _inject_90d_padding(c, n=15000)
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = _run_pre_deploy(db_path, logs_dir)
    assert result.returncode == 0

    temp_logs = logs_dir / ".predeploy-dry-run-tmp"
    assert not temp_logs.exists(), f"temp logs dir {temp_logs} should be cleaned up"


# ==================== script contract tests ====================

def test_script_is_executable():
    """The pre-deploy script must be executable (matches the cron deploy convention)."""
    import stat
    mode = SCRIPT_PATH.stat().st_mode
    assert mode & stat.S_IXUSR, f"script {SCRIPT_PATH} is not user-executable (mode={oct(mode)})"


def test_script_references_correct_cron_deploy_in_help():
    """The script's success-path output should reference the actual deploy script.
    Pure text check — no DB bootstrap needed.
    """
    text = SCRIPT_PATH.read_text()
    assert "deploy-public-inbox-kill-criteria-cron.sh" in text


def test_pre_deploy_dry_run_todo_removed():
    """The TODO(2026-07-02) marker in the pre-PR-A sibling should be followed now."""
    pre_deploy_text = (REPO_ROOT / "scripts" / "pre-deploy-dry-run.sh").read_text()
    assert "TODO(2026-07-02)" not in pre_deploy_text, (
        "TODO(2026-07-02) marker should be removed once the public-inbox successor "
        "script exists. See tests/test_pre_deploy_dry_run_todo_guard.py for the rot check."
    )
    # And the pointer should be in place
    assert "public-inbox-monetization-pre-deploy.sh" in pre_deploy_text


def test_week_zero_baseline_placeholder_created(tmp_path):
    """The pre-deploy dry-run persists a Week-0 baseline placeholder file
    that snapshots the kill-criteria THRESHOLDS dict at deploy time.

    Pattern: ``.sau-logs/.public-inbox-kill-criteria-baseline-YYYY-MM-DD.json``
    (mirrors the TBF-018 ``.monitor-baseline-2026-06-29.json`` naming).
    """
    db_path = _bootstrap_temp_db(tmp_path, with_tables=True)
    c = sqlite3.connect(db_path)
    _inject_30d_window_activity(c, n_downloaders=1000, n_reward_grants=60)
    _inject_clicks_abandons(c, n_clicks=100, n_abandons=10)
    _inject_users(c, n_users=50)
    _inject_90d_padding(c, n=15000)
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = _run_pre_deploy(db_path, logs_dir)
    assert result.returncode == 0, f"unexpected exit: {result.returncode}: {result.stderr}"

    # Baseline file pattern: .public-inbox-kill-criteria-baseline-YYYY-MM-DD.json
    baselines = sorted(logs_dir.glob(".public-inbox-kill-criteria-baseline-*.json"))
    assert len(baselines) == 1, (
        f"expected exactly 1 baseline file, found {len(baselines)}: {baselines}"
    )

    # The baseline must contain a snapshot of all 6 kill-criteria thresholds
    baseline = json.loads(baselines[0].read_text())
    assert baseline["tool"] == "scripts.public_inbox_kill_criteria"
    assert baseline["version"] == 1
    assert "created_at" in baseline
    assert "purpose" in baseline
    assert set(baseline["thresholds"].keys()) == {
        "reward_button_ctr",
        "reward_abandon_rate",
        "affiliate_ctr",
        "registration_conversion",
        "monthly_uv_avg",
        "platform_failure_rate",
    }
    # Spot-check a few threshold values to ensure the snapshot is non-trivial
    assert baseline["thresholds"]["reward_button_ctr"]["threshold"] == 0.05
    assert baseline["thresholds"]["monthly_uv_avg"]["threshold"] == 5000
    assert baseline["thresholds"]["affiliate_ctr"]["implemented"] is False
    assert baseline["thresholds"]["platform_failure_rate"]["implemented"] is False
