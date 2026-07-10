"""scripts/dev_watch.py — dev-mode hot-reload for the Flask backend.

Wraps ``run.py`` (Flask, port 6001) with a watchdog-based restart loop.
Source edits in ``web_runner/``, ``uploader/``, ``cli/``, or ``run.py``
itself trigger a debounced ``kill + restart``; backend stdout/stderr is
appended to ``.sau-logs/backend.log`` with a per-restart banner. Dev
only — production uses supervisord / podman / k8s.

Install (via uv, preferred)::

    uv sync                     # adds watchdog via [dependency-groups] dev

Or in a legacy venv::

    uv pip install watchdog

Usage::

    python scripts/dev_watch.py                # run with defaults
    python scripts/dev_watch.py --dry-run      # log events but don't spawn backend
    python scripts/dev_watch.py --debounce-ms=500

Constraints:

* ``posix_only`` — uses ``signal.SIGTERM`` + ``subprocess.Popen``. macOS
  + Linux are in scope; Windows is not. Production has its own
  supervisor anyway.
* Single backend instance. Two concurrent ``dev_watch.py`` invocations
  would race on ``backend.log`` — fail loud if port ``:6001`` is
  already bound by something other than this script's tracked proc.
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

# Loud-fail import: missing watchdog should not silently no-op. The
# install hint names two paths (uv sync / uv pip install) so operators
# can resolve without reading the watcher script source first.
try:
    from watchdog.events import FileSystemEventHandler
    from watchdog.observers import Observer
except ImportError as exc:
    sys.stderr.write(
        f"Error: {exc}. watchdog is required for scripts/dev_watch.py.\n"
        "Install via:\n"
        "  uv sync\n"
        "  # or, in legacy venv:\n"
        "  uv pip install watchdog\n"
        "  # or:\n"
        "  pip install watchdog\n"
    )
    sys.exit(1)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / ".sau-logs"
LOG_PATH = LOG_DIR / "backend.log"
WATCH_LOG_PATH = LOG_DIR / "dev_watch.log"
DEFAULT_DEBOUNCE_MS = 800
DEFAULT_PORT = 6001

# Single source of truth for what counts as "source we should restart on".
# Files outside this list (db/, .sau-logs/, node_modules/, etc.) trigger no
# restart — important so SQLite writes don't cause restart loops.
WATCH_PATHS: tuple[Path, ...] = (
    PROJECT_ROOT / "web_runner",
    PROJECT_ROOT / "uploader",
    PROJECT_ROOT / "cli",
    PROJECT_ROOT / "run.py",
)

# Env vars forwarded to the backend child. Mirrors the launch line we
# used in earlier restart steps so dev and prod stay in sync on
# CORS + DB connection. ``SAU_DB_DIALECT`` was removed in the
# SQLite→PostgreSQL cutover (PG is the sole backend now).
BAKED_ENV: dict[str, str] = {
    "DATABASE_URL": "postgres:///sau",
    "SAU_CORS_ALLOWED_ORIGINS": "http://localhost:5173,http://localhost:5180",
}

# Last signal number that triggered shutdown; used to surface the
# conventional Unix 128+signum exit code on Ctrl-C / SIGTERM so shell
# scripts can tell signal-driven exit apart from a clean return. The
# signal handler in ``main()`` writes through ``global _last_signum``;
# ``main()`` reads it back at the end to compute ``sys.exit(128+x)``.
# Default 0 = no-signal-clean-exit path, where ``main()`` returns 0
# directly. We do this BEFORE defining ``_log`` because the signal
# handler in ``main`` references the global during runtime — a missing
# module-level definition would surface as ``NameError`` at first
# SIGINT/SIGTERM, not at import time.
_last_signum: int = 0


def _log(msg: str) -> None:
    """Status logger for the watcher itself (separate from backend.log).

    Always tees to stdout for terminal-foreground runs (so a developer
    running ``python scripts/dev_watch.py`` directly sees the restart
    state live) AND appends to ``.sau-logs/dev_watch.log`` so headless
    supervised runs are still observable.

    Never raises — log-write glitches must not crash the watcher.
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"[{ts}] {msg}"
    try:
        print(line, flush=True)
    except OSError:
        pass
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with WATCH_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:
        sys.stderr.write(f"[dev_watch] log write failed: {exc}\n")


class BackendLauncher:
    """Tracked single-process manager for the ``run.py`` child.

    Public surface is intentionally minimal: ``start()`` and ``stop()``.
    Concurrent ``start()`` calls during a long SIGTERM grace are
    **coalesced**, not dropped — we mark a pending restart instead
    and re-fire it once the current one finishes, so the LAST save in
    a burst (which may land during grace) still produces a restart
    after grace resolves. Multiple pending requests collapse to one
    trailing restart at the trailing edge of the burst.
    """

    SIGTERM_GRACE_S = 10.0
    SIGKILL_GRACE_S = 5.0

    def __init__(self, python_bin: str, port: int = DEFAULT_PORT):
        self._python_bin = python_bin
        self._port = port
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._restart_in_progress = False
        # Coalesce (NOT drop) for requests that arrive during a long
        # SIGTERM grace: if another save hits while we're still
        # tearing down the previous restart, mark this flag and re-fire
        # once we exit the grace window. Counterpart to ``finally`` in
        # ``start()``. Without this, the LAST save in a burst that
        # landed during grace would be silently dropped — leaving the
        # backend running with stale bytecode while the operator had
        # explicitly asked for a reload.
        self._pending_restart = False

    @property
    def child_pid(self) -> int | None:
        return self._proc.pid if self._proc is not None else None

    def start(self) -> None:
        # Coalesce, not drop. If a restart is mid-flight (SIGTERM grace
        # or Popen spawn), record a pending restart; we'll re-fire it
        # once the current one completes — that way the LAST save
        # in a burst that landed during a long grace window still
        # produces a restart after the grace resolves, without
        # duplicating the shorter ones in between.
        if self._restart_in_progress:
            self._pending_restart = True
            _log("restart already in progress; marking pending for re-fire after")
            return
        self._restart_in_progress = True
        try:
            with self._lock:
                self._kill_locked()
                self._spawn_locked()
        finally:
            self._restart_in_progress = False
            if self._pending_restart:
                self._pending_restart = False
                _log("re-firing coalesced pending restart (last save in burst)")
                # Recurse now that ``_restart_in_progress`` is False;
                # we re-enter this method's non-busy branch and run a
                # normal kill+spawn cycle. Mirrors kernel \"deferred
                # work\" — coalesce N pending requests down to one
                # trailing restart.
                self.start()

    def stop(self) -> None:
        with self._lock:
            self._kill_locked()

    # ── internal ─────────────────────────────────────────────────────────
    def _kill_locked(self) -> None:
        if self._proc is None:
            return
        proc = self._proc
        self._proc = None  # release the slot before async work
        if proc.poll() is not None:
            _log(f"previous backend (pid {proc.pid}) already exited")
            return

        pid = proc.pid
        _log(f"stopping backend pid={pid} (SIGTERM, {self.SIGTERM_GRACE_S:.0f}s grace)")
        try:
            proc.terminate()
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=self.SIGTERM_GRACE_S)
        except subprocess.TimeoutExpired:
            _log(f"backend pid={pid} did not exit in grace window; escalating to SIGKILL")
            try:
                proc.kill()
            except ProcessLookupError:
                return
            try:
                proc.wait(timeout=self.SIGKILL_GRACE_S)
            except subprocess.TimeoutExpired:
                # Last-resort: still alive after kill + 5s. Don't hang the
                # watcher; leave a loud trail so an operator knows the
                # PID exists but is unresponsive.
                _log(f"backend pid={pid} UNRESPONSIVE to SIGKILL — manual cleanup required")

    def _spawn_locked(self) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)

        # Banner separates restart cycles inside backend.log so the
        # operator can grep across restart boundaries cleanly. Written
        # BEFORE swapping the file handle to ``Popen`` so the divider
        # survives even if the spawn itself fails.
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        banner = f"\n=== dev_watch restart @ {ts} ===\n"
        try:
            with LOG_PATH.open("a", encoding="utf-8") as fh:
                fh.write(banner)
        except OSError as exc:
            _log(f"failed to write restart banner to {LOG_PATH}: {exc}")

        env = os.environ.copy()
        env.update(BAKED_ENV)

        try:
            self._proc = subprocess.Popen(
                [self._python_bin, "run.py"],
                cwd=str(PROJECT_ROOT),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=LOG_PATH.open("ab"),
                stderr=subprocess.STDOUT,
                # Detach from our session: terminal SIGINT (Ctrl-C) reaches
                # the watcher but NOT the backend. Watcher teardown is
                # responsible for explicit SIGTERM via ``stop()``.
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            _log(f"failed to spawn backend (python={self._python_bin!r}): {exc}")
            self._proc = None
            return

        _log(f"started backend pid={self._proc.pid} (port {self._port})")


class ReloadHandler(FileSystemEventHandler):
    """Watchdog handler that schedules a debounced restart on save.

    Filters out the steady-state noise (Python bytecode cache, IDE
    swap files, VCS metadata) so we only restart on real source edits.
    Debounce is a single global Timer: a save cascade resets the timer
    each iteration, so 5 saves in 300 ms produce exactly 1 restart at
    the trailing edge of the burst.
    """

    # Ignored suffixes / path fragments. Order doesn't matter — pure
    # substring check. ``.pyc``/``.pyo`` are excluded because pytest
    # + Python's import machinery constantly create them; including
    # them gives restart-storms on every test collection.
    _IGNORED_SUFFIXES: tuple[str, ...] = (".pyc", ".pyo", ".swp", ".swo", "~")
    _IGNORED_PATH_PARTS: tuple[str, ...] = (
        "/__pycache__/",
        "/.git/",
        "/.venv/",
        "/node_modules/",
        "/.sau-logs/",
    )

    def __init__(self, debounce_ms: int, on_dirty):
        self._debounce_s = debounce_ms / 1000.0
        self._on_dirty = on_dirty
        self._timer: threading.Timer | None = None
        # Lock only to avoid orphan-timer leakage (Timer.cancel() itself
        # is thread-safe per the ``threading`` docs). Removes a window
        # where two near-simultaneous ``on_any_event`` callsites both
        # leave timers alive — only the latest wins.
        self._timer_lock = threading.Lock()

    def on_any_event(self, event) -> None:
        if event.is_directory:
            return
        path = event.src_path
        if any(part in path for part in self._IGNORED_PATH_PARTS):
            return
        if path.endswith(self._IGNORED_SUFFIXES):
            return
        self._schedule_debounce()

    def _schedule_debounce(self) -> None:
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self._debounce_s, self._on_dirty)
            self._timer.daemon = True
            self._timer.start()

    def cancel(self) -> None:
        """Cancel any in-flight debounce timer; called on shutdown."""
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None


def _check_port_unoccupied(port: int) -> str | None:
    """Return PID of process listening on ``port``, or None if free.

    ``lsof`` is the macOS-native tool; on Linux it's usually available
    too via the ``lsof`` apt package. We treat "lsof missing" as a hard
    warning, not silent skip, because running with no port-check
    produces confusing double-bind scenarios on restart.
    """
    try:
        out = subprocess.run(
            ["lsof", "-ti", str(port), "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        _log(
            "lsof not found on PATH; cannot verify port ownership. "
            "Install lsof (e.g. `brew install lsof` / `apt install lsof`) "
            "or fall back to manual PID check via `ps aux | grep run.py`."
        )
        return None
    pids = [line for line in out.stdout.strip().split("\n") if line.strip().isdigit()]
    return pids[0] if pids else None


def _resolve_python() -> str:
    """Pick the Python interpreter for the backend.

    Prefer the project-local ``.venv/bin/python`` so the watcher and
    backend both use the same env (avoids subtle import-path mismatches
    that give "works in my venv, not in yours" surprises). Falls back
    to ``sys.executable`` so CI smoke runs without a venv still work.
    """
    candidate = PROJECT_ROOT / ".venv" / "bin" / "python"
    if candidate.is_file():
        return str(candidate)
    return sys.executable


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--debounce-ms", type=int, default=DEFAULT_DEBOUNCE_MS,
        metavar="MS",
        help="Milliseconds to wait after the last save before restarting "
             f"(default: {DEFAULT_DEBOUNCE_MS}).",
    )
    ap.add_argument(
        "--dry-run", action="store_true",
        help="Watch paths and log events but don't actually spawn the "
             "backend. Useful for validating which files trigger a restart.",
    )
    return ap.parse_args()


def main() -> int:
    args = _parse_args()
    _log(
        f"dev_watch starting "
        f"(debounce={args.debounce_ms}ms, dry_run={args.dry_run})"
    )

    # ── pre-flight: ensure 6001 isn't bound by something we didn't start
    if not args.dry_run:
        existing = _check_port_unoccupied(DEFAULT_PORT)
        if existing:
            _log(
                f"port {DEFAULT_PORT} already bound by pid {existing} — "
                f"this is not part of a watcher-managed tree. "
                f"Kill it explicitly to avoid double-binding:\n"
                f"  kill -9 {existing}\n"
                f"or:\n"
                f"  lsof -ti:{DEFAULT_PORT} | xargs kill -9"
            )
            return 1

    python_bin = _resolve_python()
    _log(f"using python interpreter: {python_bin}")

    launcher = BackendLauncher(python_bin=python_bin)
    handler = ReloadHandler(debounce_ms=args.debounce_ms, on_dirty=launcher.start)

    observer = Observer()
    for wp in WATCH_PATHS:
        if not wp.exists():
            _log(f"skipping non-existent watch path: {wp}")
            continue
        recursive = wp.is_dir()
        observer.schedule(handler, str(wp), recursive=recursive)
        _log(f"watching: {wp}" + (" (recursive)" if recursive else ""))
    observer.start()

    # Signal-driven shutdown: signal handler stays minimal (just sets
    # the Event); the main loop picks the Event up on its next wait
    # tick and runs the full teardown via try/finally. This way SIGINT,
    # SIGTERM, and KeyboardInterrupt all converge on the same exit
    # path without re-entry safety concerns.
    stop_event = threading.Event()

    def _request_shutdown(signum: int, _frame) -> None:
        # Capture signum so the main thread can ``sys.exit(128+signum)``
        # at the end — preserves the conventional Unix signal-driven
        # exit code so shell scripts can distinguish Ctrl-C from a
        # clean return.
        global _last_signum
        _last_signum = signum
        sys.stderr.write(f"\n[dev_watch] received signal {signum}; shutting down\n")
        sys.stderr.flush()
        stop_event.set()

    signal.signal(signal.SIGINT, _request_shutdown)
    signal.signal(signal.SIGTERM, _request_shutdown)

    try:
        if not args.dry_run:
            launcher.start()  # initial launch
        # Loop on the Event (not time.sleep) so SIGINT wakes us
        # immediately and we drop straight into ``finally``.
        while not stop_event.is_set():
            stop_event.wait(timeout=1.0)
    finally:
        _log("stopping watcher (cancelling timer, joining observer, killing backend)")
        handler.cancel()
        observer.stop()
        launcher.stop()
        # Bounded join — on slow / wedged FS (NFS, full inotify queues)
        # ``observer.join()`` can stall 30+ s, blocking Ctrl-C exit.
        # Cap at 5 s and warn if the watchdog poller thread is still
        # alive; we'll abandon it.
        observer.join(timeout=5.0)
        if observer.is_alive():
            _log(
                "observer thread did not exit in 5s; abandoning "
                "(kernel watcher wedged on slow FS / full inotify queue)"
            )
        _log("dev_watch exited")

    # Surface the signal-driven exit code if shutdown was signal-driven;
    # otherwise return 0 for clean exit. Mirrors shell convention
    # ``$? == 130`` for Ctrl-C, ``$? == 143`` for SIGTERM.
    if _last_signum:
        sys.exit(128 + _last_signum)
    return 0


if __name__ == "__main__":
    sys.exit(main())
