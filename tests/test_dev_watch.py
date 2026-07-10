"""Tests for ``scripts/dev_watch.py`` — dev-mode hot reload.

Coverage
--------

* **Module invariants** — DEFAULT_DEBOUNCE_MS=800, SIGTERM_GRACE_S=10,
  SIGKILL_GRACE_S=5 are the contract values documented in
  ``docs/dev/hot-reload-philosophy.md`` §5. Drift here would silently
  change restart cadence without surfacing in the doc.

* **BackendLauncher** — kill+spawn lifecycle, banner write, SIGTERM-then-
  SIGKILL grace ladder, coalesce-not-drop during in-flight restart
  (saves arriving during graceful teardown still produce a trailing
  restart).

* **ReloadHandler** — debounce window folds burst saves to one restart;
  ignored path/suffix (``.pyc``, ``__pycache__``, ``.git``, etc.) does
  NOT schedule restart; directory events are dropped.

ReloadHandler tests are guarded behind ``pytest.importorskip("watchdog")``
because the class extends ``watchdog.events.FileSystemEventHandler``; the
rest of the suite runs without watchdog as long as ``scripts/dev_watch.py``
imports cleanly.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# scripts/ is not on pytest's default sys.path. Add it once so that
# `import dev_watch` resolves in this test module's namespace.
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

# Importing dev_watch itself triggers the watchdog import at module top
# (with a loud-fail sys.exit(1) if missing). The dev group includes
# watchdog, so a standard `uv sync` install will satisfy this. We catch
# the SystemExit so pytest can surface a clean ``Skipped`` reason rather
# than a collection-time traceback when watchdog is missing.
try:
    import dev_watch as dw  # noqa: E402
except SystemExit:
    pytest.skip(
        "scripts/dev_watch.py requires watchdog (install: `uv sync` "
        "or `uv pip install watchdog`); all tests in this file skip.",
        allow_module_level=True,
    )


# ─────────── FakeProc ──────────────────────────────────────────────


class FakeProc:
    """Mimic ``subprocess.Popen`` lifecycle without spawning a real process.

    Records every signal-like method call into ``signal_log`` so tests can
    assert the SIGTERM→wait→SIGKILL ordering on teardown. ``wait()``
    always returns immediately; tests that want to model a slow graceful
    exit should subclass and override ``terminate()`` to introduce a
    delay. ``poll()`` returns ``None`` while alive and ``0`` after
    ``terminate()`` / ``kill()`` so BackendLauncher's
    ``proc.poll() is not None`` early-out kicks in correctly.
    """

    def __init__(self, pid: int = 12345) -> None:
        self.pid = pid
        self._alive = True
        self.signal_log: list[str] = []

    def poll(self):
        return None if self._alive else 0

    def terminate(self):
        self.signal_log.append("SIGTERM")
        self._alive = False  # graceful exit

    def kill(self):
        self.signal_log.append("SIGKILL")
        self._alive = False

    def wait(self, timeout=None):
        return 0

    def __repr__(self) -> str:
        return f"FakeProc(pid={self.pid}, alive={self._alive}, " f"signals={self.signal_log})"


class StubbornFakeProc(FakeProc):
    """Survives SIGTERM through the grace window; only SIGKILL ends it.

    Used by the SIGKILL-escalation test to verify ``_kill_locked``'s
    timeout→kill fallback path. ``terminate()`` records SIGTERM but
    leaves ``_alive`` True; ``wait()`` raises ``TimeoutExpired`` until
    ``kill()`` is called. Models the real-world case of a Flask worker
    holding an in-flight HTTP request or a long DB transaction when
    the watcher SIGTERMs it — we deliberately don't fast-exit on
    SIGTERM because we want clean teardown of in-flight work first.
    """

    def terminate(self):
        self.signal_log.append("SIGTERM")
        # SIGTERM-with-grace: ignore the request; ``_alive`` stays True
        # so ``wait()`` will fall through to a TimeoutExpired.

    def kill(self):
        self.signal_log.append("SIGKILL")
        self._alive = False

    def wait(self, timeout=None):
        # After SIGKILL the process is dead; return cleanly.
        if "SIGKILL" in self.signal_log:
            return 0
        # Otherwise raise so ``_kill_locked``'s
        # ``except subprocess.TimeoutExpired`` branch escalates to kill().
        raise subprocess.TimeoutExpired(cmd="run.py", timeout=timeout)


# ─────────── fixtures ──────────────────────────────────────────────


@pytest.fixture
def fresh_log(tmp_path, monkeypatch):
    """Redirect LOG_PATH and WATCH_LOG_PATH into a tmp dir.

    Without this, ``BackendLauncher._spawn_locked`` writes the restart
    banner into the real ``.sau-logs/backend.log`` of the repo, and
    every ``_log()`` call appends to ``.sau-logs/dev_watch.log`` —
    polluting the developer filesystem on test runs.
    """
    backend_log = tmp_path / "backend.log"
    watch_log = tmp_path / "dev_watch.log"
    monkeypatch.setattr(dw, "LOG_DIR", tmp_path)
    monkeypatch.setattr(dw, "LOG_PATH", backend_log)
    monkeypatch.setattr(dw, "WATCH_LOG_PATH", watch_log)
    yield tmp_path


@pytest.fixture
def fast_debounce(monkeypatch):
    """Shrink debounce + grace windows so burst-collapse tests run fast.

    Tests in this module reuse real ``threading.Timer`` scheduling, so
    we cannot monkeypatch the timer itself without losing the
    "five-saves-coalesce-to-one" invariant's actual ``Timer.cancel()`` +
    ``Timer.start()`` cycle. Instead we shrink the debounce window
    itself to 50 ms so a real ``time.sleep(0.15)`` reliably covers it.

    ``SIGTERM_GRACE_S`` and ``SIGKILL_GRACE_S`` are CLASS attributes on
    ``BackendLauncher`` (not module-level aliases), so the monkeypatch
    targets the class — patches to ``dw.SIGTERM_GRACE_S`` would silently
    no-op because ``_kill_locked`` reads via ``self.SIGTERM_GRACE_S``.
    """
    monkeypatch.setattr(dw, "DEFAULT_DEBOUNCE_MS", 50)
    monkeypatch.setattr(dw.BackendLauncher, "SIGTERM_GRACE_S", 0.5)
    monkeypatch.setattr(dw.BackendLauncher, "SIGKILL_GRACE_S", 0.5)
    yield


def _make_event(path: str, *, is_directory: bool = False) -> MagicMock:
    """Build a watchdog-shaped event mock for ``ReloadHandler.on_any_event``."""
    ev = MagicMock()
    ev.is_directory = is_directory
    ev.src_path = path
    return ev


# ─────────── module-level invariants ──────────────────────────────


def test_default_debounce_window_is_800ms() -> None:
    """[USER CASE #2 — debounce gap] ``DEFAULT_DEBOUNCE_MS == 800``.

    This is the contract value documented in
    ``docs/dev/hot-reload-philosophy.md`` §5 row 1. If we change it,
    the doc needs to change in lockstep — otherwise the operator's
    mental model of "5 saves in 300 ms = 1 restart" silently breaks.
    """
    assert dw.DEFAULT_DEBOUNCE_MS == 800, (
        f"DEFAULT_DEBOUNCE_MS drifted from 800ms to {dw.DEFAULT_DEBOUNCE_MS}ms — "
        f"update docs/dev/hot-reload-philosophy.md §5 row 1"
    )


def test_sigterm_and_sigkill_grace_periods_match_doc() -> None:
    """SIGTERM_GRACE_S=10.0 and SIGKILL_GRACE_S=5.0 are the documented values."""
    actual_term = dw.BackendLauncher.SIGTERM_GRACE_S
    actual_kill = dw.BackendLauncher.SIGKILL_GRACE_S
    assert actual_term == 10.0, (
        f"SIGTERM_GRACE_S drifted from 10.0s to {actual_term}s — " f"update docs/dev/hot-reload-philosophy.md §5 row 2"
    )
    assert actual_kill == 5.0, (
        f"SIGKILL_GRACE_S drifted from 5.0s to {actual_kill}s — " f"update docs/dev/hot-reload-philosophy.md §5 row 3"
    )


def test_watch_paths_cover_the_four_targets() -> None:
    """WATCH_PATHS must include the four restart-triggering sources:
    ``web_runner/``, ``uploader/``, ``cli/``, and ``run.py``.
    """
    paths = [str(p) for p in dw.WATCH_PATHS]
    assert any(p.endswith("web_runner") for p in paths), paths
    assert any(p.endswith("uploader") for p in paths), paths
    assert any(p.endswith("cli") for p in paths), paths
    assert any(p.endswith("run.py") for p in paths), paths


def test_ignored_suffix_set_exactly_matches_lockdown() -> None:
    """.pyc, .pyo, .swp, .swo, ~ are the locked noise suffix set."""
    assert dw.ReloadHandler._IGNORED_SUFFIXES == (
        ".pyc",
        ".pyo",
        ".swp",
        ".swo",
        "~",
    )


def test_ignored_path_parts_include_caches_and_vcs_metadata() -> None:
    """Five path fragments must be excluded: __pycache__/, .git/, .venv/,
    node_modules/, .sau-logs/. Restart-storm sources during Python /
    pytest / Git / npm / logging all flow through these prefixes.
    """
    expected = {
        "/__pycache__/",
        "/.git/",
        "/.venv/",
        "/node_modules/",
        "/.sau-logs/",
    }
    actual = set(dw.ReloadHandler._IGNORED_PATH_PARTS)
    miss = expected - actual
    assert not miss, f"missing noise-filter path fragments: {sorted(miss)}"


# ─────────── BackendLauncher — kill+spawn lifecycle ────────────────


def test_start_spawns_popen_exactly_once(fresh_log) -> None:
    """First ``start()`` spawns one ``subprocess.Popen`` with ``[python, 'run.py']``."""
    fake_proc = FakeProc(pid=42)
    with patch.object(dw.subprocess, "Popen", return_value=fake_proc) as popen_mock:
        launcher = dw.BackendLauncher(python_bin="/fake/python")
        launcher.start()

    assert popen_mock.call_count == 1, "start() must spawn exactly one Popen"
    assert launcher.child_pid == 42
    args, kwargs = popen_mock.call_args
    assert args[0] == ["/fake/python", "run.py"]
    # Detach semantics — the watcher must NOT have its terminal SIGINT
    # propagate to the backend; supervision flows through BackendLauncher.
    assert kwargs["start_new_session"] is True
    assert kwargs["stdin"] == dw.subprocess.DEVNULL


def test_spawn_writes_banner_to_log_with_timestamp(fresh_log) -> None:
    """Each restart writes a ``=== dev_watch restart @ <ts> ===`` banner
    to LOG_PATH **before** swapping the file handle to the new Popen.

    The banner is grep-able across restart boundaries; if Popen itself
    fails to spawn, the banner is still on disk so an operator can see
    *which* attempt crashed.
    """
    fake_proc = FakeProc(pid=99)
    with patch.object(dw.subprocess, "Popen", return_value=fake_proc):
        dw.BackendLauncher(python_bin="/fake/python").start()

    text = fresh_log.joinpath("backend.log").read_text(encoding="utf-8")
    assert "dev_watch restart" in text, f"banner missing in: {text!r}"
    # MUST begin with the divider so the first restart's separator
    # bookmarks the start-of-log cleanly.
    stripped = text.lstrip("\n")
    assert stripped.startswith("=== dev_watch restart"), stripped[:60]


def test_spawn_merges_baked_env_into_popen_env(fresh_log) -> None:
    """The BAKED_ENV overrides (DATABASE_URL, SAU_CORS_ALLOWED_ORIGINS)
    reach Popen via the ``env=`` kwarg so the dev backend talks to the
    same Postgres + CORS allowances the operator uses in production.
    ``SAU_DB_DIALECT`` was dropped in the SQLite→PG cutover.
    """
    fake_proc = FakeProc(pid=1)
    with patch.object(dw.subprocess, "Popen", return_value=fake_proc) as popen_mock:
        dw.BackendLauncher(python_bin="/fake/python").start()

    env = popen_mock.call_args.kwargs["env"]
    assert "SAU_DB_DIALECT" not in env, (
        "SAU_DB_DIALECT is removed post-SQLite-cutover; the watcher should "
        "NOT inject it into the backend's env"
    )
    assert env["DATABASE_URL"] == "postgres:///sau"
    assert env["SAU_CORS_ALLOWED_ORIGINS"] == "http://localhost:5173,http://localhost:5180"


def test_teardown_sends_sigterm_first(fresh_log) -> None:
    """``stop()`` sends SIGTERM (never SIGKILL at first — that's the
    graceful path the doc promises for clean shutdown)."""
    fake_proc = FakeProc(pid=123)
    with patch.object(dw.subprocess, "Popen", return_value=fake_proc):
        launcher = dw.BackendLauncher(python_bin="/fake/python")
        launcher.start()
        launcher.stop()

    assert fake_proc.signal_log, "stop() must signal the child"
    assert fake_proc.signal_log[0] == "SIGTERM", f"first signal was {fake_proc.signal_log[0]!r}; SIGTERM must lead"


def test_consecutive_start_kills_then_respawns(fresh_log) -> None:
    """Two contiguous ``start()`` calls: the second kills the first's
    child and spawns a fresh one. Popen is called twice; the tracked
    PID advances.
    """
    proc_a, proc_b = FakeProc(pid=1), FakeProc(pid=2)
    # side_effect=[...] consumes procs in order then raises StopIteration
    # on any further Popen call — flags the test as broken if more spawns
    # happen than expected (catches over-eager kill+spawn regressions).
    with patch.object(dw.subprocess, "Popen", side_effect=[proc_a, proc_b]):
        launcher = dw.BackendLauncher(python_bin="/fake/python")
        launcher.start()
        assert launcher.child_pid == 1
        launcher.start()
        assert launcher.child_pid == 2

    # proc_a was sent SIGTERM (it returned from wait() immediately because
    # FakeProc.terminate() flips _alive to False).
    assert "SIGTERM" in proc_a.signal_log


def test_coalesce_not_drop_during_in_flight_restart(fresh_log) -> None:
    """[invariant] Saves arriving WHILE a restart is mid-flight don't get
    silently dropped — BackendLauncher marks ``_pending_restart`` and
    re-fires once the in-flight one completes.

    We don't simulate real time here; we directly flip the internal
    ``_restart_in_progress`` flag (mimicking "first start in grace"),
    then call ``start()`` again. Without coalesce-not-drop, the second
    call would silently no-op; with it, ``_pending_restart`` flips True
    and a manually-advanced finally block re-fires ⇒ exactly one
    trailing restart, not zero.
    """
    with patch.object(dw.subprocess, "Popen", side_effect=[FakeProc(pid=10)]):
        launcher = dw.BackendLauncher(python_bin="/fake/python")
        # Simulate "first start is mid-flight" — flip the busy flag
        # without actually killing/spawning anything.
        launcher._restart_in_progress = True
        launcher.start()  # busy branch: marks pending, returns
        assert launcher._pending_restart is True, "second start() during in-flight restart must NOT silently drop"

        # Manually advance the finally block (simulating completion of
        # the first start): clear busy, see pending, recurse.
        launcher._restart_in_progress = False
        if launcher._pending_restart:
            launcher._pending_restart = False
            launcher.start()


def test_already_exited_proc_skips_signal_send(fresh_log) -> None:
    """If the previous backend already exited (``poll() != None``),
    ``_kill_locked`` must NOT send another SIGTERM — avoids spurious
    ProcessLookupError on race-cleanup and removes a confusing
    "stopping pid=X (already exited)" log line.
    """
    proc = FakeProc(pid=5)
    proc._alive = False  # already exited before launcher reaches start() #2

    with patch.object(dw.subprocess, "Popen", return_value=proc):
        launcher = dw.BackendLauncher(python_bin="/fake/python")
        launcher.start()
        launcher.start()  # should detect already-exited, skip signal

    assert proc.signal_log == [], f"expected zero signals (proc already exited); got {proc.signal_log}"


def test_sigterm_unresponsive_escalates_to_sigkill(fresh_log) -> None:
    """Grace ladder: SIGTERM -> grace elapsed -> SIGKILL -> exit.

    When a backend ignores SIGTERM (in-flight HTTP request, slow
    Postgres tx, etc.), the grace window expires and ``_kill_locked``
    escalates to SIGKILL via the ``except subprocess.TimeoutExpired``
    branch. Documents the [10 s SIGTERM, 5 s SIGKILL] ladder —
    deviations would silently extend or shorten the restart window.

    Uses ``StubbornFakeProc`` which records SIGTERM but stays alive,
    so ``wait()`` raises ``TimeoutExpired`` and triggers the kill
    escalation.
    """
    proc = StubbornFakeProc(pid=50)
    with patch.object(dw.subprocess, "Popen", return_value=proc):
        launcher = dw.BackendLauncher(python_bin="/fake/python")
        launcher.start()  # initial spawn
        launcher.stop()  # teardown — escalate to SIGKILL

    assert proc.signal_log == ["SIGTERM", "SIGKILL"], f"expected SIGTERM -> SIGKILL ladder; got {proc.signal_log}"


# ─────────── ReloadHandler — debounce + ignored-path filtering ────


def test_burst_of_three_saves_collapses_to_one_restart(fast_debounce, fresh_log) -> None:
    """[USER CASE #3 — double save] 3 ``on_any_event`` calls within the
    debounce window produce ONE backend restart, not three.

    Simulates the editor's "save the same file 3 times in 200 ms"
    pattern (Vim's ``:wa``, IDE autosave thundering, atomic-rename
    commit hooks) — burst should fold to a single trailing restart.
    """
    pytest.importorskip("watchdog")

    popen_calls: list[FakeProc] = []

    def fake_popen(*a, **kw):
        p = FakeProc(pid=100 + len(popen_calls))
        popen_calls.append(p)
        return p

    handler = None
    try:
        with patch.object(dw.subprocess, "Popen", side_effect=fake_popen):
            launcher = dw.BackendLauncher(python_bin="/fake/python")
            handler = dw.ReloadHandler(debounce_ms=50, on_dirty=launcher.start)

            # Burst: 3 saves within 50 ms debounce window
            for path in (
                "/proj/web_runner/routes/auth.py",
                "/proj/web_runner/routes/analytics.py",
                "/proj/web_runner/db.py",
            ):
                handler.on_any_event(_make_event(path))

            # Wait for debounce window to elapse + a margin (Timer fires once)
            time.sleep(0.25)  # 0.25 s margin: safe under CI thread-scheduling jitter
    finally:
        if handler is not None:
            handler.cancel()  # drop any pending timer

    assert len(popen_calls) == 1, (
        f"burst of 3 saves produced {len(popen_calls)} restarts; "
        f"debounce should fold them to a SINGLE trailing restart: {popen_calls}"
    )


def test_sequential_saves_after_debounce_produce_separate_restarts(fast_debounce, fresh_log) -> None:
    """Counterpart to the burst-collapse test: each save arriving AFTER
    a previous debounce has elapsed produces its own restart. Without
    this, the debounce logic could over-fold (e.g. sharing a single
    timer across bursts separated by minutes).
    """
    pytest.importorskip("watchdog")

    popen_calls: list[FakeProc] = []

    def fake_popen(*a, **kw):
        p = FakeProc(pid=200 + len(popen_calls))
        popen_calls.append(p)
        return p

    handler = None
    try:
        with patch.object(dw.subprocess, "Popen", side_effect=fake_popen):
            launcher = dw.BackendLauncher(python_bin="/fake/python")
            handler = dw.ReloadHandler(debounce_ms=50, on_dirty=launcher.start)

            handler.on_any_event(_make_event("/proj/web_runner/foo.py"))
            time.sleep(0.25)  # 0.25 s margin: safe under CI thread jitter
            assert len(popen_calls) == 1, f"expected 1 restart after first save, got {len(popen_calls)}"

            handler.on_any_event(_make_event("/proj/web_runner/foo.py"))
            time.sleep(0.25)  # second debounce elapsed
            assert (
                len(popen_calls) == 2
            ), f"sequential saves should produce independent restarts; got {len(popen_calls)}"
    finally:
        if handler is not None:
            handler.cancel()


def test_ignored_path_parts_do_not_schedule_restart(fast_debounce) -> None:
    """[USER CASE #1 — fake mtime, inverse] ``on_any_event`` on noise paths
    (``.pyc``, ``__pycache__/``, ``.git/``, ``.venv/``, etc.) must NOT
    schedule a debounce timer. This is the inverse of the kill+restart
    test: an event that LOOKS like a save must be filtered out.

    Python's import machinery creates .pyc on every bytecode regen;
    pytest follow-symlinks into ``.venv/``; ``.git/`` churns on every
    git status. If any of these scheduled restarts, the dev loop would
    be drowned in noise.
    """
    pytest.importorskip("watchdog")

    handler = dw.ReloadHandler(debounce_ms=50, on_dirty=lambda: None)

    spurious = [
        "/proj/web_runner/__pycache__/foo.pyc",
        "/proj/web_runner/services.py.pyc",
        "/proj/.git/HEAD",
        "/proj/.git/refs/heads/main.lock",
        "/proj/.venv/lib/python3.12/site-packages/foo.py",
        "/proj/node_modules/react/index.js",
        "/proj/.sau-logs/backend.log",
        "/proj/web_runner/.foo.py.swp",
        "/proj/web_runner/foo.py~",  # ~ suffix (Emacs/Vim backup)
    ]

    for path in spurious:
        handler.on_any_event(_make_event(path))

    assert handler._timer is None, (
        f"a noise path scheduled a restart; ReloadHandler did not filter: " f"timer={handler._timer}"
    )


def test_real_source_edit_schedules_a_restart(fast_debounce) -> None:
    """Counterpart: a real source event DOES schedule a debounce restart.
    Locks the invariant that the noise filter isn't accidentally
    over-broad and rejecting genuine edits.
    """
    pytest.importorskip("watchdog")
    handler = dw.ReloadHandler(debounce_ms=50, on_dirty=lambda: None)
    try:
        handler.on_any_event(_make_event("/proj/web_runner/routes/auth.py"))
        assert handler._timer is not None, "real source edit must schedule a debounce restart"
        assert handler._timer.is_alive() is True
    finally:
        handler.cancel()


def test_directory_event_is_dropped(fast_debounce) -> None:
    """``is_directory=True`` events (folder create/delete/move) are ignored
    regardless of path; we only restart on per-file mtime changes.
    """
    pytest.importorskip("watchdog")
    handler = dw.ReloadHandler(debounce_ms=50, on_dirty=lambda: None)
    handler.on_any_event(_make_event("/proj/web_runner/", is_directory=True))
    assert handler._timer is None


def test_cancel_drops_in_flight_timer(fast_debounce) -> None:
    """``ReloadHandler.cancel()`` (called from main()'s signal handler)
    must clear ``_timer`` so the watcher can exit cleanly without a
    background timer firing after observer.stop().
    """
    pytest.importorskip("watchdog")
    handler = dw.ReloadHandler(debounce_ms=50, on_dirty=lambda: None)
    handler.on_any_event(_make_event("/proj/web_runner/foo.py"))
    assert handler._timer is not None
    handler.cancel()
    assert handler._timer is None


# ─────────── _check_port_unoccupied ────────────────────────────────


def test_check_port_returns_pid_when_listening() -> None:
    """When ``lsof`` reports a PID, ``_check_port_unoccupied`` returns it
    so main() can fail loud in pre-flight."""
    fake_completed = MagicMock()
    fake_completed.stdout = "12345\n"
    fake_completed.returncode = 0

    with patch.object(subprocess, "run", return_value=fake_completed):
        pid = dw._check_port_unoccupied(6001)
    assert pid == "12345"


def test_check_port_returns_none_when_free() -> None:
    """When ``lsof`` returns nothing, ``_check_port_unoccupied`` returns
    None — main() proceeds to spawn the backend."""
    fake_completed = MagicMock()
    fake_completed.stdout = ""
    fake_completed.returncode = 0

    with patch.object(subprocess, "run", return_value=fake_completed):
        pid = dw._check_port_unoccupied(6001)
    assert pid is None


def test_check_port_filters_non_pid_lines() -> None:
    """``lsof`` may emit warnings on stderr; stdout can contain stray
    non-numeric lines (e.g. process names if called without ``-ti``).
    The helper must filter to digits-only."""
    fake_completed = MagicMock()
    fake_completed.stdout = "header\n12345\nmore noise\n67890\n"
    fake_completed.returncode = 0

    with patch.object(subprocess, "run", return_value=fake_completed):
        pid = dw._check_port_unoccupied(6001)
    # returns the FIRST numeric PID it finds
    assert pid == "12345"
