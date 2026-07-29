#!/usr/bin/env bash
# One-shot Web Shell: Flask/Waitress (:6001) + Vite (:5174)
set -euo pipefail

ROOT="$(cd "$(dirname "$(realpath "$0")")/.." && pwd)"
LOG_DIR="$ROOT/.sau-logs"
mkdir -p "$LOG_DIR"

BACKEND_PORT="${SAU_PORT:-6001}"
FRONTEND_PORT="${SAU_FRONTEND_PORT:-5174}"
OPEN_BROWSER="${SAU_OPEN_BROWSER:-1}"

fail() { echo "[ERROR] $*" >&2; exit 1; }

_CLEANED=0
cleanup() {
  # Avoid double "stop" from EXIT + INT both firing.
  [ "$_CLEANED" = "1" ] && return 0
  _CLEANED=1
  echo
  echo "[stop] stopping services..."
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    # Waitress/Flask may spawn children — best-effort process group.
    kill -- -"$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "${FRONTEND_PID:-}" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    kill -- -"$FRONTEND_PID" 2>/dev/null || true
  fi
  # Clear listeners if PIDs already died but port held.
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  echo "[stop] done"
}
trap cleanup EXIT INT TERM

kill_port() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  fi
  if [ -n "$pids" ]; then
    echo "[stop] freeing port $port (pids: $pids)"
    # shellcheck disable=SC2086
    kill $pids >/dev/null 2>&1 || true
    sleep 0.5
    # shellcheck disable=SC2086
    kill -9 $pids >/dev/null 2>&1 || true
  fi
}

wait_http() {
  local url="$1"
  local name="$2"
  local max="${3:-40}"
  local i=0
  while [ "$i" -lt "$max" ]; do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS -o /dev/null --connect-timeout 1 --max-time 2 "$url" 2>/dev/null; then
        echo "[ok] $name ready ($url)"
        return 0
      fi
    else
      # Fallback: TCP connect via bash /dev/tcp if available.
      local host port
      host=$(echo "$url" | sed -E 's#https?://([^:/]+).*#\1#')
      port=$(echo "$url" | sed -E 's#https?://[^:/]+:([0-9]+).*#\1#')
      if (echo >/dev/tcp/"$host"/"$port") 2>/dev/null; then
        echo "[ok] $name port open ($host:$port)"
        return 0
      fi
    fi
    i=$((i + 1))
    sleep 0.25
  done
  echo "[ERROR] $name did not become ready: $url" >&2
  echo "        see $LOG_DIR/" >&2
  return 1
}

# Prefer project venv python
PYTHON=""
if [ -x "$ROOT/.venv/bin/python" ]; then
  PYTHON="$ROOT/.venv/bin/python"
else
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON="$candidate"
      break
    fi
  done
fi
[ -z "$PYTHON" ] && fail "python not found (create .venv or install python3)"
echo "[info] python: $PYTHON"

# Prefer a real npm on PATH (avoid broken nvm shell wrappers when possible)
NPM="npm"
if [ -x "$HOME/.local/bin/npm" ]; then
  NPM="$HOME/.local/bin/npm"
elif [ -x "/opt/homebrew/bin/npm" ]; then
  NPM="/opt/homebrew/bin/npm"
fi
command -v "$NPM" >/dev/null 2>&1 || command -v npm >/dev/null 2>&1 || fail "npm not found"
echo "[info] npm: $($NPM -v 2>/dev/null || npm -v)"

# 1) Python web deps
if ! "$PYTHON" -c "import flask" >/dev/null 2>&1; then
  echo "[setup] install Python web deps"
  cd "$ROOT"
  if command -v uv >/dev/null 2>&1; then
    uv pip install -e ".[web]"
  else
    "$PYTHON" -m pip install -e ".[web]"
  fi
fi
# Waitress is preferred by run.py (non-debug)
if ! "$PYTHON" -c "import waitress" >/dev/null 2>&1; then
  echo "[setup] install waitress"
  cd "$ROOT"
  if command -v uv >/dev/null 2>&1; then
    uv pip install waitress
  else
    "$PYTHON" -m pip install waitress
  fi
fi

# 2) Frontend deps
if [ ! -d "$ROOT/sau_web/frontend/node_modules" ]; then
  echo "[setup] npm install (frontend)"
  cd "$ROOT/sau_web/frontend"
  $NPM install --legacy-peer-deps
fi

# 3) Free ports
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

# 4) Backend
echo "[start] backend  -> http://localhost:$BACKEND_PORT"
cd "$ROOT"
export SAU_CORS_ALLOWED_ORIGINS="${SAU_CORS_ALLOWED_ORIGINS:-http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174}"
export SAU_AUTH_ENABLED="${SAU_AUTH_ENABLED:-false}"
export SAU_HOST="${SAU_HOST:-0.0.0.0}"
export SAU_PORT="$BACKEND_PORT"
# Dev convenience: reloader off is handled by run.py when SAU_DEBUG unset (Waitress).
: >"$LOG_DIR/backend.log"
"$PYTHON" run.py >>"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "[start] backend pid=$BACKEND_PID"

if ! wait_http "http://127.0.0.1:$BACKEND_PORT/health" "backend" 60; then
  echo "----- backend.log (tail) -----"
  tail -40 "$LOG_DIR/backend.log" || true
  fail "backend failed to start"
fi

# 5) Frontend
echo "[start] frontend -> http://localhost:$FRONTEND_PORT"
cd "$ROOT/sau_web/frontend"
: >"$LOG_DIR/frontend.log"
# Bind fixed port; if busy start.sh already killed it.
$NPM run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort >>"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "[start] frontend pid=$FRONTEND_PID"

if ! wait_http "http://127.0.0.1:$FRONTEND_PORT/" "frontend" 80; then
  echo "----- frontend.log (tail) -----"
  tail -40 "$LOG_DIR/frontend.log" || true
  fail "frontend failed to start"
fi

echo
echo "=========================================="
echo "  Web Shell is up"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  Backend:  http://localhost:$BACKEND_PORT"
echo "  Health:   http://localhost:$BACKEND_PORT/health"
echo "  Logs:     $LOG_DIR/"
echo "  Stop:     Ctrl+C"
echo "=========================================="
echo

if [ "$OPEN_BROWSER" = "1" ]; then
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:$FRONTEND_PORT" 2>/dev/null || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$FRONTEND_PORT" 2>/dev/null || true
  fi
fi

# Keep both children; exit when either dies.
# (Avoid `wait -n` — not available on macOS system bash 3.2.)
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
echo "[warn] a process exited — shutting down the other"
