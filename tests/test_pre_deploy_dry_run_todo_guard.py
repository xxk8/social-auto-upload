"""
CI guard for the TODO marker in ``scripts/pre-deploy-dry-run.sh``.

History: the original ``TODO(2026-07-02):`` marker told the post-PR-A dev to
create ``scripts/public-inbox-monetization-pre-deploy.sh`` and update the
FATAL message to point to it. As of 2026-07-02, that TODO has been followed
(``scripts/public-inbox-monetization-pre-deploy.sh`` was created, and the
pre-deploy-dry-run.sh FATAL message was updated). This test now guards
against the marker rotting in EITHER state:

  * If the marker is present with the expected date (2026-07-02), the rot
    logic applies — within 30 days it's "fresh", past 30 days it's
    "aged-out" (CI fails).
  * If the marker is absent (followed / removed), the state is "followed"
    and CI passes regardless of date.

The rot-check tests below use a **fake** script_path (injected via tmp_path)
so they're independent of the real script's state — they test the rot logic
itself, not the real script's current content.

**Three exit states** (rot check returns one of):

  * ``followed``  — TODO is gone OR successor script exists.  No rot.
  * ``fresh``     — TODO is present but within the rot threshold.  No rot (yet).
  * ``aged-out``  — TODO is past the rot threshold and no successor.  ROT.

**Run as a one-shot CI script**::

    python tests/test_pre_deploy_dry_run_todo_guard.py

Returns exit ``0`` if the TODO is not rotting, ``1`` if it is.

**Environment variables** (used by tests + CI simulations)::

    SAU_TODO_GUARD_TODAY=YYYY-MM-DD    Override "today" for the rot check.
    SAU_TODO_GUARD_THRESHOLD_DAYS=N   Override the rot threshold (default 30).
"""
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PRE_DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "pre-deploy-dry-run.sh"
SUCCESSOR_SCRIPT = REPO_ROOT / "scripts" / "public-inbox-monetization-pre-deploy.sh"
TODO_MARKER_RE = re.compile(r"TODO\((\d{4}-\d{2}-\d{2})\):")
DEFAULT_ROT_THRESHOLD_DAYS = 30


# ==================== helpers (also reused by the CLI block) ====================

def _todo_marker_date(script_path: Path = PRE_DEPLOY_SCRIPT) -> str | None:
    """Extract ``YYYY-MM-DD`` from a ``TODO(YYYY-MM-DD):`` marker in *script_path*."""
    if not script_path.exists():
        return None
    m = TODO_MARKER_RE.search(script_path.read_text())
    return m.group(1) if m else None


def _today_override() -> date | None:
    """Return ``SAU_TODO_GUARD_TODAY`` env var as a ``date``, or ``None`` if unset/invalid."""
    env = os.environ.get("SAU_TODO_GUARD_TODAY")
    if not env:
        return None
    try:
        return datetime.strptime(env, "%Y-%m-%d").date()
    except ValueError:
        return None


def _threshold_override() -> int:
    """Return ``SAU_TODO_GUARD_THRESHOLD_DAYS`` env var as ``int``, or the default."""
    env = os.environ.get("SAU_TODO_GUARD_THRESHOLD_DAYS")
    if not env:
        return DEFAULT_ROT_THRESHOLD_DAYS
    try:
        return int(env)
    except ValueError:
        return DEFAULT_ROT_THRESHOLD_DAYS


def _days_since_marker(marker_date: str, today: date | None = None) -> int:
    """Days from *marker_date* to *today* (override or real).  Positive ⇒ after."""
    md = datetime.strptime(marker_date, "%Y-%m-%d").date()
    td = today or _today_override() or date.today()
    return (td - md).days


def _check_rot_state(
    script_path: Path = PRE_DEPLOY_SCRIPT,
    successor_path: Path = SUCCESSOR_SCRIPT,
    threshold_days: int | None = None,
    today: date | None = None,
) -> tuple[str, str]:
    """Return ``(state, message)`` for the rot check.

    State is one of ``followed`` / ``fresh`` / ``aged-out``.
    """
    if threshold_days is None:
        threshold_days = _threshold_override()
    marker = _todo_marker_date(script_path)
    if marker is None:
        return ("followed", f"TODO marker absent from {script_path.name} (followed or removed)")
    if successor_path.exists():
        return ("followed", f"successor script exists at {successor_path.name}")
    days = _days_since_marker(marker, today)
    if days <= threshold_days:
        return (
            "fresh",
            f"TODO({marker}) is {days} day(s) old, within {threshold_days}-day window",
        )
    return (
        "aged-out",
        (
            f"TODO({marker}) is {days} day(s) old (>{threshold_days}-day threshold) "
            f"and successor script {successor_path.name} does not exist. "
            f"Either create the successor or remove the TODO."
        ),
    )


# ==================== real-script contract tests (handle both states) ====================

def test_todo_marker_state_is_either_present_or_followed():
    """The real script's TODO marker is in one of two consistent states:

    (a) present with the expected date (pre-followup) → rot logic applies
    (b) absent (post-followup, i.e. successor created or TODO removed) → 'followed'

    This test tripwires if the script is in an INCONSISTENT state.
    """
    marker = _todo_marker_date()
    state, msg = _check_rot_state()
    if marker is None:
        assert state == "followed", (
            f"marker absent but rot state is {state} (expected 'followed'): {msg}"
        )
    else:
        assert marker == "2026-07-02", f"unexpected marker date: {marker}"


def test_real_script_rot_state_is_not_aged_out():
    """The real pre-deploy-dry-run.sh must never be in 'aged-out' state —
    if the marker is present without a successor, CI fails immediately so the
    owner sees the rot before it goes stale for another 30 days.
    """
    state, _ = _check_rot_state()
    assert state != "aged-out", (
        "Real pre-deploy-dry-run.sh is in 'aged-out' state — TODO is rotting. "
        "Either create the successor script or remove the TODO."
    )


# ==================== rot-check tests (use a fake script_path) ====================

def _fake_script_with_marker(tmp_path: Path, marker_date: str = "2026-07-02") -> Path:
    """Create a fake script with a TODO marker (for rot-check tests)."""
    fake = tmp_path / "pre-deploy-dry-run.sh"
    fake.write_text(
        f"#!/usr/bin/env bash\n"
        f"# TODO({marker_date}): once PR-A lands, do the thing.\n"
        f"echo 'fake script with marker'\n"
    )
    return fake


def test_fresh_todo_does_not_fail(monkeypatch, tmp_path):
    """Within the 30-day window, the rotting guard should not trigger.

    Today is 2026-07-02 (=marker date), so 0 days old → ``fresh``.
    """
    fake_script = _fake_script_with_marker(tmp_path)
    monkeypatch.setenv("SAU_TODO_GUARD_TODAY", "2026-07-02")
    state, msg = _check_rot_state(
        script_path=fake_script,
        successor_path=tmp_path / "_nope.sh",
    )
    assert state in ("fresh", "followed"), f"unexpected state: {state} ({msg})"


def test_aged_out_todo_fails_without_successor(monkeypatch, tmp_path):
    """Simulate 31 days after 2026-07-02 with no successor script → expect ``aged-out``."""
    fake_script = _fake_script_with_marker(tmp_path)
    monkeypatch.setenv("SAU_TODO_GUARD_TODAY", "2026-08-02")
    no_successor = tmp_path / "public-inbox-monetization-pre-deploy.sh"
    state, msg = _check_rot_state(script_path=fake_script, successor_path=no_successor)
    assert state == "aged-out", f"expected aged-out, got {state}: {msg}"
    assert "2026-07-02" in msg
    assert "31" in msg


def test_aged_out_todo_passes_when_successor_exists(monkeypatch, tmp_path):
    """Simulate 60 days after 2026-07-02, but successor script exists → ``followed``."""
    fake_script = _fake_script_with_marker(tmp_path)
    monkeypatch.setenv("SAU_TODO_GUARD_TODAY", "2026-08-31")
    fake_successor = tmp_path / "public-inbox-monetization-pre-deploy.sh"
    fake_successor.write_text("#!/usr/bin/env bash\necho fake\n")
    state, msg = _check_rot_state(script_path=fake_script, successor_path=fake_successor)
    assert state == "followed", f"expected followed (successor exists), got {state}: {msg}"


def test_removed_todo_passes_regardless_of_date(monkeypatch, tmp_path):
    """If the TODO is gone, the guard passes regardless of date / successor existence."""
    monkeypatch.setenv("SAU_TODO_GUARD_TODAY", "2027-01-01")
    fake_script = tmp_path / "pre-deploy-dry-run.sh"
    fake_script.write_text("#!/usr/bin/env bash\necho 'no TODO'\n")
    state, msg = _check_rot_state(script_path=fake_script, successor_path=tmp_path / "_nope.sh")
    assert state == "followed", f"expected followed (TODO removed), got {state}: {msg}"


def test_threshold_override_shortens_window(monkeypatch, tmp_path):
    """``threshold=5`` ⇒ a 10-day-old TODO should be ``aged-out``."""
    fake_script = _fake_script_with_marker(tmp_path)
    monkeypatch.setenv("SAU_TODO_GUARD_TODAY", "2026-07-12")
    state, msg = _check_rot_state(
        script_path=fake_script,
        threshold_days=5,
        successor_path=tmp_path / "_nope.sh",
    )
    assert state == "aged-out", f"expected aged-out, got {state}: {msg}"


def test_threshold_override_lengthens_window(monkeypatch, tmp_path):
    """``threshold=100`` ⇒ a 10-day-old TODO is still ``fresh``."""
    fake_script = _fake_script_with_marker(tmp_path)
    monkeypatch.setenv("SAU_TODO_GUARD_TODAY", "2026-07-12")
    state, msg = _check_rot_state(
        script_path=fake_script,
        threshold_days=100,
        successor_path=tmp_path / "_nope.sh",
    )
    assert state == "fresh", f"expected fresh, got {state}: {msg}"


# ==================== unit tests for the helper functions ====================

def test_todo_marker_date_parses_known_format(tmp_path):
    """The TODO marker regex should extract the YYYY-MM-DD date from a sample file."""
    sample = (
        "# TODO(2026-07-02): once PR-A lands (it will create\n"
        "# scripts/public-inbox-monetization-pre-deploy.sh), replace the\n"
    )
    f = tmp_path / "script.sh"
    f.write_text(sample)
    assert _todo_marker_date(f) == "2026-07-02"


def test_todo_marker_date_returns_none_when_absent(tmp_path):
    f = tmp_path / "script.sh"
    f.write_text("# no TODO here\n")
    assert _todo_marker_date(f) is None


def test_todo_marker_date_returns_none_when_file_missing(tmp_path):
    assert _todo_marker_date(tmp_path / "nonexistent.sh") is None


def test_days_since_marker_positive_after():
    assert _days_since_marker("2026-07-02", date(2026, 8, 2)) == 31


def test_days_since_marker_zero_on_marker_date():
    assert _days_since_marker("2026-07-02", date(2026, 7, 2)) == 0


def test_days_since_marker_negative_before():
    assert _days_since_marker("2026-07-02", date(2026, 6, 1)) == -31


def test_today_override_parses_env_var(monkeypatch):
    monkeypatch.setenv("SAU_TODO_GUARD_TODAY", "2026-08-15")
    assert _today_override() == date(2026, 8, 15)


def test_today_override_returns_none_when_unset(monkeypatch):
    monkeypatch.delenv("SAU_TODO_GUARD_TODAY", raising=False)
    assert _today_override() is None


def test_today_override_returns_none_on_garbage(monkeypatch):
    monkeypatch.setenv("SAU_TODO_GUARD_TODAY", "not-a-date")
    assert _today_override() is None


def test_threshold_override_parses_env_var(monkeypatch):
    monkeypatch.setenv("SAU_TODO_GUARD_THRESHOLD_DAYS", "7")
    assert _threshold_override() == 7


def test_threshold_override_returns_default_when_unset(monkeypatch):
    monkeypatch.delenv("SAU_TODO_GUARD_THRESHOLD_DAYS", raising=False)
    assert _threshold_override() == DEFAULT_ROT_THRESHOLD_DAYS


def test_threshold_override_returns_default_on_garbage(monkeypatch):
    monkeypatch.setenv("SAU_TODO_GUARD_THRESHOLD_DAYS", "not-a-number")
    assert _threshold_override() == DEFAULT_ROT_THRESHOLD_DAYS


# ==================== CLI entry point for CI / pre-commit ====================

def _cli_main() -> int:
    """CLI: exit ``0`` if TODO is not rotting, ``1`` if it is."""
    state, msg = _check_rot_state()
    print(f"[todo-guard] state={state} :: {msg}")
    if state == "aged-out":
        print(
            "[todo-guard] FAIL: TODO is rotting.  See message above.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(_cli_main())
