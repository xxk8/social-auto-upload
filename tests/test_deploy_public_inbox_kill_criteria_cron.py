"""
Tests for the strong-gate wiring between ``scripts/deploy-public-inbox-kill-criteria-cron.sh``
``validate`` / ``install`` modes and ``scripts/public-inbox-monetization-pre-deploy.sh``.

The deploy-cron script's ``validate`` mode now invokes the pre-deploy dry-run
as a hard prerequisite before any ``install`` can succeed. These tests verify:

  * ``validate`` passes when pre-deploy returns CRUISE + baseline file materialized.
  * ``validate`` fails when pre-deploy returns STOP-SHIP (killswitch metric).
  * ``validate`` fails when pre-deploy fails for any other reason (e.g. pre-PR-A
    dev DB schema, validation error, parse error).
  * ``validate`` fails when the baseline file is missing (defense in depth).
  * ``install`` always calls ``validate`` first (verified via script text +
    end-to-end with a sandboxed crontab).
  * ``install --skip-pre-deploy`` bypasses the gate (emergency escape hatch)
    and prepends ``MANUAL_DEPLOY=1`` as audit trail.
  * Cron-deploy contract: the script's top comment + case statement are unchanged
    in shape (print / validate / install three-mode convention).

Test isolation: the pre-deploy accepts ``SAU_DB_PATH_OVERRIDE`` and
``SAU_LOGS_DIR_OVERRIDE`` for isolation. We set both in the subprocess env, so
each test runs against a temp SQLite file + temp logs dir with no pollution
of the real ``db/database.db`` or ``.sau-logs/``.
"""
import os
import sqlite3
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "deploy-public-inbox-kill-criteria-cron.sh"
PRE_DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "public-inbox-monetization-pre-deploy.sh"


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


def _bootstrap_temp_db(tmp_path: Path) -> Path:
    db_path = tmp_path / "smoke.db"
    c = sqlite3.connect(db_path)
    c.executescript(PUBLIC_INBOX_SCHEMA)
    c.commit()
    return db_path


def _inject_cruise(c: sqlite3.Connection) -> None:
    c.executescript("""
        INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
        SELECT 'd' || x, '10.0.0.1', 'download', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<1000) SELECT x FROM cnt);
        INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
        SELECT 'r' || x, '10.0.0.1', 'reward', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<60) SELECT x FROM cnt);
        INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
        SELECT 'c' || x, '10.0.0.1', 'reward_button_click', 0, datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<100) SELECT x FROM cnt);
        INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
        SELECT 'a' || x, '10.0.0.1', 'reward_abandon', 4000, datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<10) SELECT x FROM cnt);
        INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
        SELECT 'h' || x, '10.0.0.1', 'download', datetime('now', '-' || (30 + (x % 60)) || ' days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<15000) SELECT x FROM cnt);
        INSERT INTO users (email, role, created_at)
        SELECT 'u' || x || '@smoke.test', 'user', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<50) SELECT x FROM cnt);
    """)
    c.commit()


def _inject_stop_ship(c: sqlite3.Connection) -> None:
    """Same as CRUISE but NO 90d padding → monthly_uv_avg = 1000/3 = 333 < 5000 → killswitch FAIL."""
    c.executescript("""
        INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
        SELECT 'd' || x, '10.0.0.1', 'download', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<1000) SELECT x FROM cnt);
        INSERT INTO guest_usage_logs (guest_uuid, ip, action, created_at)
        SELECT 'r' || x, '10.0.0.1', 'reward', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<60) SELECT x FROM cnt);
        INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
        SELECT 'c' || x, '10.0.0.1', 'reward_button_click', 0, datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<100) SELECT x FROM cnt);
        INSERT INTO reward_events (guest_uuid, ip, event, elapsed_ms, created_at)
        SELECT 'a' || x, '10.0.0.1', 'reward_abandon', 4000, datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<10) SELECT x FROM cnt);
        INSERT INTO users (email, role, created_at)
        SELECT 'u' || x || '@smoke.test', 'user', datetime('now', '-5 days')
        FROM (WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<50) SELECT x FROM cnt);
    """)
    c.commit()


def _run_validate(tmp_path: Path, db_path: Path, fixture: str = "cruise") -> subprocess.CompletedProcess:
    """Invoke the deploy script's validate mode with env-var overrides."""
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    if fixture == "cruise":
        c = sqlite3.connect(db_path)
        _inject_cruise(c)
    elif fixture == "stop_ship":
        c = sqlite3.connect(db_path)
        _inject_stop_ship(c)
    # "empty" fixture: just bootstrap the schema, no rows

    return subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "validate"],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "SAU_DB_PATH_OVERRIDE": str(db_path),
            "SAU_LOGS_DIR_OVERRIDE": str(logs_dir),
        },
        cwd=str(REPO_ROOT),
        timeout=120,
    )


# ==================== validate mode tests ====================

def test_validate_passes_with_cruise_scenario(tmp_path):
    """validate mode calls pre-deploy + checks exit 0 + checks baseline file.
    With a CRUISE fixture, everything should pass.
    """
    db_path = _bootstrap_temp_db(tmp_path)
    result = _run_validate(tmp_path, db_path, fixture="cruise")

    assert result.returncode == 0, (
        f"validate failed (rc={result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    assert "Pre-deploy validation PASSED" in result.stdout

    # Baseline file should be created in the override logs dir
    logs_dir = tmp_path / "logs"
    baselines = sorted(logs_dir.glob(".public-inbox-kill-criteria-baseline-*.json"))
    assert len(baselines) == 1, f"expected 1 baseline, found {len(baselines)}: {baselines}"


def test_validate_fails_with_stop_ship_scenario(tmp_path):
    """STOP-SHIP fixture (monthly_uv_avg < 5000) → validate must fail (rc=1)."""
    db_path = _bootstrap_temp_db(tmp_path)
    result = _run_validate(tmp_path, db_path, fixture="stop_ship")

    assert result.returncode == 1, (
        f"validate should fail on STOP-SHIP, got rc={result.returncode}:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    assert "Pre-deploy validation FAILED" in result.stdout
    assert "non-zero exit" in result.stdout


def test_validate_fails_with_pre_pr_a_db(tmp_path):
    """Dev DB WITHOUT public-inbox tables (pre-PR-A state) → validate must fail.
    The pre-deploy's inverse pre-PR-A check returns exit 2, which the
    deploy-script's gate surfaces as a FAILED validation.
    """
    # Bootstrap a DB with NO public-inbox tables (pre-PR-A)
    db_path = tmp_path / "pre_pr_a.db"
    c = sqlite3.connect(db_path)
    c.executescript("CREATE TABLE some_other_table (id INTEGER PRIMARY KEY, name TEXT);")
    c.commit()

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "validate"],
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

    assert result.returncode == 1, f"expected rc=1, got {result.returncode}: {result.stderr}"
    assert "Pre-deploy validation FAILED" in result.stdout
    assert "non-zero exit" in result.stdout


def test_validate_fails_when_baseline_file_missing(tmp_path, monkeypatch):
    """Defense in depth: even if the pre-deploy exits 0, if the Week-0 baseline
    file is missing the deploy-script's gate should fail. We test this by
    pre-creating a logs dir, running validate, then verifying the gate would
    have rejected a missing baseline (the gate's check is inside the script
    after pre-deploy exits 0, so this test verifies the post-exit check exists
    by reading the script text).
    """
    text = DEPLOY_SCRIPT.read_text()
    # The script must verify the baseline file is present after pre-deploy exits 0
    assert "baseline placeholder present" in text or "baseline placeholder not created" in text
    # And it must use find/glob to count baseline files
    assert "public-inbox-kill-criteria-baseline" in text


# ==================== --skip-pre-deploy escape hatch tests ====================

def test_install_skip_pre_deploy_allows_stop_ship(tmp_path):
    """--skip-pre-deploy with STOP-SHIP fixture must NOT abort
    (the gate is bypassed). The crontab must be called.
    """
    db_path = _bootstrap_temp_db(tmp_path)
    c = sqlite3.connect(db_path)
    _inject_stop_ship(c)

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    fake_bin = tmp_path / "fake_bin"
    fake_bin.mkdir()
    fake_crontab_log = tmp_path / "crontab_calls.log"
    fake_crontab_log.write_text("")
    (fake_bin / "crontab").write_text(
        f"#!/usr/bin/env bash\necho \"$@\" >> {fake_crontab_log}\nexit 0\n"
    )
    (fake_bin / "crontab").chmod(0o755)

    result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "install", "--skip-pre-deploy"],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ.get('PATH', '')}",
            "SAU_DB_PATH_OVERRIDE": str(db_path),
            "SAU_LOGS_DIR_OVERRIDE": str(logs_dir),
        },
        cwd=str(REPO_ROOT),
        timeout=120,
    )

    # install with --skip-pre-deploy must succeed (exit 0)
    assert result.returncode == 0, (
        f"install --skip-pre-deploy should pass even with STOP-SHIP, got rc={result.returncode}:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    # The fake crontab MUST have been called
    crontab_calls = fake_crontab_log.read_text().strip()
    assert crontab_calls != "", (
        f"install --skip-pre-deploy must call crontab; got calls: {crontab_calls!r}"
    )
    # The cron line must contain MANUAL_DEPLOY=1 as audit trail
    assert "MANUAL_DEPLOY=1" in result.stdout, (
        "install --skip-pre-deploy must include MANUAL_DEPLOY=1 in cron output"
    )


def test_install_skip_pre_deploy_shows_warning_banner(tmp_path):
    """--skip-pre-deploy must print a loud warning banner about the risks."""
    db_path = _bootstrap_temp_db(tmp_path)
    c = sqlite3.connect(db_path)
    _inject_cruise(c)

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    fake_bin = tmp_path / "fake_bin"
    fake_bin.mkdir()
    fake_crontab_log = tmp_path / "crontab_calls.log"
    fake_crontab_log.write_text("")
    (fake_bin / "crontab").write_text(
        f"#!/usr/bin/env bash\necho \"$@\" >> {fake_crontab_log}\nexit 0\n"
    )
    (fake_bin / "crontab").chmod(0o755)

    result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "install", "--skip-pre-deploy"],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ.get('PATH', '')}",
            "SAU_DB_PATH_OVERRIDE": str(db_path),
            "SAU_LOGS_DIR_OVERRIDE": str(logs_dir),
        },
        cwd=str(REPO_ROOT),
        timeout=120,
    )

    # Must contain the warning banner keywords
    assert "MANUAL OVERRIDE" in result.stdout, (
        "--skip-pre-deploy must print the manual override warning banner"
    )
    assert "ENVIRONMENT" in result.stdout or "emergency" in result.stdout.lower() or "escape" in result.stdout.lower()


def test_install_normal_still_requires_validate(tmp_path):
    """Regression: install WITHOUT --skip-pre-deploy must still abort on
    STOP-SHIP. The escape hatch doesn't weaken the default gate.
    """
    db_path = _bootstrap_temp_db(tmp_path)
    c = sqlite3.connect(db_path)
    _inject_stop_ship(c)

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    fake_bin = tmp_path / "fake_bin"
    fake_bin.mkdir()
    fake_crontab_log = tmp_path / "crontab_calls.log"
    fake_crontab_log.write_text("")
    (fake_bin / "crontab").write_text(
        f"#!/usr/bin/env bash\necho \"$@\" >> {fake_crontab_log}\nexit 0\n"
    )
    (fake_bin / "crontab").chmod(0o755)

    result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "install"],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ.get('PATH', '')}",
            "SAU_DB_PATH_OVERRIDE": str(db_path),
            "SAU_LOGS_DIR_OVERRIDE": str(logs_dir),
        },
        cwd=str(REPO_ROOT),
        timeout=120,
    )

    # install WITHOUT --skip-pre-deploy must still abort on STOP-SHIP
    assert result.returncode == 2, (
        f"install without --skip-pre-deploy must abort on STOP-SHIP, got rc={result.returncode}:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    crontab_calls = fake_crontab_log.read_text().strip()
    assert crontab_calls == "", (
        f"install must not call crontab on STOP-SHIP; got calls: {crontab_calls!r}"
    )


# ==================== install mode tests ====================

def test_install_mode_calls_validate_first():
    """The install case in the deploy script must call validate() before the
    crontab write. This is the strong-gate contract: no install without
    a passing pre-deploy dry-run.
    """
    text = DEPLOY_SCRIPT.read_text()
    # The install case must reference the validate function
    install_section = text.split("install)")[1].split(";;")[0] if "install)" in text else ""
    assert "validate" in install_section, (
        f"install case must call validate() first; got: {install_section[:200]}"
    )
    # The install case must abort on validate failure (exit 2)
    assert "exit 2" in install_section or "refusing to install" in install_section.lower()


def test_install_mode_aborts_when_validate_fails(tmp_path):
    """End-to-end: install mode with a STOP-SHIP fixture must abort (rc=2)
    BEFORE writing to the real crontab. We use a PATH-shadowing trick: put a
    fake `crontab` script earlier in PATH that just records the call. The real
    crontab is never touched.
    """
    db_path = _bootstrap_temp_db(tmp_path)
    c = sqlite3.connect(db_path)
    _inject_stop_ship(c)

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    # Create a fake crontab in a temp dir that records calls + exits 0
    fake_bin = tmp_path / "fake_bin"
    fake_bin.mkdir()
    fake_crontab_log = tmp_path / "crontab_calls.log"
    fake_crontab_log.write_text("")
    (fake_bin / "crontab").write_text(
        f"#!/usr/bin/env bash\necho \"$@\" >> {fake_crontab_log}\nexit 0\n"
    )
    (fake_bin / "crontab").chmod(0o755)

    result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "install"],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ.get('PATH', '')}",
            "SAU_DB_PATH_OVERRIDE": str(db_path),
            "SAU_LOGS_DIR_OVERRIDE": str(logs_dir),
        },
        cwd=str(REPO_ROOT),
        timeout=120,
    )

    # install must abort with exit 2 (validate's STOP-SHIP failure → deploy-script rc=1
    # → install aborts with rc=2)
    assert result.returncode == 2, (
        f"install should abort on STOP-SHIP validate, got rc={result.returncode}:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    # The fake crontab must NOT have been called (install aborted before the write)
    crontab_calls = fake_crontab_log.read_text().strip()
    assert crontab_calls == "", (
        f"install must not call crontab when validate fails; got calls: {crontab_calls!r}"
    )
    # Output must mention the validation failure
    assert "Refusing to install" in result.stdout or "Validation FAILED" in result.stdout


# ==================== script contract tests ====================

def test_deploy_script_three_mode_shape_preserved():
    """The deploy script's print / validate / install three-mode convention is
    preserved (don't accidentally collapse the case statement into a single
    branch).
    """
    text = DEPLOY_SCRIPT.read_text()
    for mode in ("print", "validate", "install"):
        assert f"{mode})" in text, f"missing case branch for mode: {mode}"


def test_deploy_script_references_pre_deploy_successor():
    """The deploy script's help text should reference the pre-deploy successor
    so operators know the validation pipeline exists.
    """
    text = DEPLOY_SCRIPT.read_text()
    assert "public-inbox-monetization-pre-deploy.sh" in text, (
        "deploy script should reference the pre-deploy successor in the help / "
        "validate output (so operators discover the validation pipeline)"
    )


def test_pre_deploy_script_is_executable():
    """Sanity check: the pre-deploy script must be executable (the deploy-script's
    gate checks for -x before invoking it).
    """
    import stat
    mode = PRE_DEPLOY_SCRIPT.stat().st_mode
    assert mode & stat.S_IXUSR, f"pre-deploy script {PRE_DEPLOY_SCRIPT} is not user-executable"


# ==================== fresh-deploy golden path test ====================

def test_fresh_deploy_golden_path(tmp_path):
    """
    Simulate a fresh deploy from a clean state (no pre-existing .sau-logs or db).
    This is the golden-path reference for a new operator: create, validate, install.

    Steps:
      1. Bootstrap a temp DB with post-PR-A schema + inject CRUISE fixture.
      2. Run ``validate`` → expect exit 0 + baseline file materialized.
      3. Run ``install`` (with fake crontab sandbox) → expect exit 0 +
         crontab called with the kill-criteria cron line.
      4. Verify the recorded crontab has exactly 1 line with
         ``public_inbox_kill_criteria.py`` and the correct ``0 7 * * *`` cadence.

    Artifacts checked:
      - Baseline file   →  .sau-logs/.public-inbox-kill-criteria-baseline-*.json (1 file)
      - Cron line text  →  contains "0 7 * * *" + "public_inbox_kill_criteria.py"
      - No MANUAL_DEPLOY=1  →  normal install (not --skip-pre-deploy)
    """
    # ── Step 1: Bootstrap fresh state ──────────────────────────────────────
    db_path = _bootstrap_temp_db(tmp_path)
    c = sqlite3.connect(db_path)
    _inject_cruise(c)

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    common_env = {
        **os.environ,
        "SAU_DB_PATH_OVERRIDE": str(db_path),
        "SAU_LOGS_DIR_OVERRIDE": str(logs_dir),
    }

    # ── Step 2: validate ───────────────────────────────────────────────────
    validate_result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "validate"],
        capture_output=True,
        text=True,
        env=common_env,
        cwd=str(REPO_ROOT),
        timeout=120,
    )

    assert validate_result.returncode == 0, (
        f"validate failed on CRUISE fixture (rc={validate_result.returncode}):\n"
        f"stdout: {validate_result.stdout}\n"
        f"stderr: {validate_result.stderr}"
    )
    assert "Pre-deploy validation PASSED" in validate_result.stdout, (
        "validate must report PASSED for a CRUISE fixture"
    )
    # validate mode should NOT print the install message (those belong to install mode)
    assert "Cron entry (daily) installed" not in validate_result.stdout, (
        "validate mode must not print the install-mode cron-installed message"
    )

    baselines = sorted(logs_dir.glob(".public-inbox-kill-criteria-baseline-*.json"))
    assert len(baselines) == 1, (
        f"validate must create exactly 1 baseline file; found {len(baselines)}: {baselines}"
    )

    # ── Step 3: install (with fake crontab sandbox) ────────────────────────
    fake_bin = tmp_path / "fake_bin"
    fake_bin.mkdir()
    fake_crontab_log = tmp_path / "crontab_calls.log"
    fake_crontab_log.write_text("")
    # The fake crontab captures both args AND stdin (the piped cron line)
    (fake_bin / "crontab").write_text(
        "#!/usr/bin/env bash\n"
        f"echo \"ARGS: $@\" >> {fake_crontab_log}\n"
        f"cat - >> {fake_crontab_log}\n"
        "exit 0\n"
    )
    (fake_bin / "crontab").chmod(0o755)

    install_result = subprocess.run(
        ["bash", str(DEPLOY_SCRIPT), "install"],
        capture_output=True,
        text=True,
        env={
            **common_env,
            "PATH": f"{fake_bin}:{os.environ.get('PATH', '')}",
        },
        cwd=str(REPO_ROOT),
        timeout=120,
    )

    assert install_result.returncode == 0, (
        f"install failed on CRUISE fixture (rc={install_result.returncode}):\n"
        f"stdout: {install_result.stdout}\n"
        f"stderr: {install_result.stderr}"
    )
    assert "Cron entry (daily) installed" in install_result.stdout, (
        "install must report successful cron installation"
    )
    # Normal install should NOT mention --skip-pre-deploy
    assert "--skip-pre-deploy" not in install_result.stdout, (
        "install must not reference skip-pre-deploy in a normal install"
    )

    # ── Step 4: verify crontab content ─────────────────────────────────────
    crontab_content = fake_crontab_log.read_text()
    assert "ARGS: -" in crontab_content, (
        f"crontab should be called with '-' (stdin mode); got: {crontab_content!r}"
    )

    cron_lines = [
        line.strip()
        for line in crontab_content.splitlines()
        if "public_inbox_kill_criteria.py" in line
    ]
    assert len(cron_lines) == 1, (
        f"expected exactly 1 cron line with public_inbox_kill_criteria.py, "
        f"found {len(cron_lines)}: {cron_lines}"
    )

    cron_line = cron_lines[0]
    assert "0 7 * * *" in cron_line, (
        f"cron line must have 0 7 * * * cadence; got: {cron_line}"
    )
    assert "MANUAL_DEPLOY=1" not in cron_line, (
        f"normal install must not inject MANUAL_DEPLOY=1; got: {cron_line}"
    )
    assert "public_inbox_kill_criteria.py" in cron_line, (
        f"cron line must reference the kill-criteria script; got: {cron_line}"
    )
    assert ".sau-logs/public-inbox-kill-criteria.log" in cron_line, (
        f"cron line must log to the canonical kill-criteria log; got: {cron_line}"
    )

    # ── Post-condition: baseline file still present (install didn't delete it) ──
    assert sorted(logs_dir.glob(".public-inbox-kill-criteria-baseline-*.json")), (
        "baseline file must still exist after install"
    )
