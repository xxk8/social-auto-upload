#!/usr/bin/env bash
# social-auto-upload 一键启动脚本
#
# 默认同时拉起：
#   ● Flask 后端           http://localhost:6001   (/api/*)
#   ● Web Shell + 营销站   http://localhost:5180   (SPA — `/` 是 marketing landing, `/dashboard/*` 是运营台)
#
# 营销站与 Web Shell 已合并到同一个 Vite 产物 (sau_web/frontend)。
#   · marketing landing   http://localhost:5180/
#   · web shell dashboard http://localhost:5180/dashboard
#   · login               http://localhost:5180/login
#
# 行为受环境变量控制：
#   SAU_NO_WEBSHELL=1    不拉 Web Shell dashboard（只跑 backend）
#   SAU_NO_BACKEND=1     不拉 Flask（仅前端调试 / 离线预览）
#
# 历史变更：sau_web/site/ 已被合并进 sau_web/frontend/src/marketing/。
#   · SAU_NO_MARKETING=1 现为默认行为（marketing 不再独立起 Vite 进程）
#   · 如你以后需要重新拆开 marketing，可设置 SAU_NO_WEBSHELL=1 并手
#     动 `cd sau_web/frontend && pnpm dev` 启动后访问 `/`。
#
# Ctrl+C 或 kill 同时关闭所有子进程。

set -euo pipefail

ROOT="$(cd "$(dirname "$(realpath "$0")")/.." && pwd)"
LOG_DIR="$ROOT/.sau-logs"
mkdir -p "$LOG_DIR"

# Load .env if present
if [ -f "$ROOT/.env" ]; then
  set -a; source "$ROOT/.env"; set +a
fi

fail() { echo "[ERROR] $*" >&2; exit 1; }

cleanup() {
  echo
  echo "[stop] stopping services..."
  [ -n "${BACKEND_PID:-}"    ] && kill "$BACKEND_PID"    2>/dev/null || true
  [ -n "${WEBSHELL_PID:-}"   ] && kill "$WEBSHELL_PID"   2>/dev/null || true
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
    echo "[stop] closing port $port (pids: $pids)"
    kill $pids >/dev/null 2>&1 || true
    sleep 1
  fi
}

# Wait for a TCP port to accept connections AND (when curl is
# available) for an HTTP /health probe to return 200. Two-stage
# probe — see the comment block on each stage below.
#
# Usage:  wait_for_port <port> [timeout_secs]
# Returns: 0 on success, 1 on timeout.
#
# Why two stages?
#   * Stage 1 (TCP /dev/tcp) is the fast happy-path. bash's
#     /dev/tcp is a built-in pseudo-device — no nc/lsof dep, no
#     subprocess fork. Succeeds on SYN/ACK even if the listener
#     hasn't yet called accept(), so it's permissive about the
#     listener's state. Used as a quick "is anyone listening?"
#     filter before paying for the curl round-trip.
#   * Stage 2 (HTTP /health) is the strong guarantee. A bare
#     TCP accept proves the port is bound, not that the
#     application is ready to serve. Flask binds its socket
#     in create_app() before its first request handler is
#     wired; psycopg's lazy imports fire on the first /api call.
#     Without stage 2, Vite's proxy can 502 for the first
#     3–5s while Flask is mid-import. /health binds at
#     create_app() time, so its 200 means the request router
#     is wired end-to-end.
#
# Why curl-optional?
#   The user's first dev experience should not require
#   installing curl. On hosts without curl, stage 1 alone is
#   still a strict improvement over the prior zero-wait state:
#   it eliminates the worst cold-start race. On hosts with
#   curl, stage 2 catches the slower cold-start path that
#   stage 1 misses.
#
# Polling cadence: 0.5s. 30s default → ≤ 60 probes; both
# stages are cheap (1 syscall + 0-1 HTTP GET) so CPU cost is
# negligible.
wait_for_port() {
  local port="$1"
  local timeout="${2:-30}"
  local start_ts elapsed
  start_ts=$(date +%s)
  while true; do
    # Stage 1: TCP probe. The exec 3<>... form opens a
    # bidirectional fd inside the subshell; on a closed port
    # bash prints "Connection refused" to stderr which we
    # discard. The subshell teardown auto-closes fd 3 — do
    # NOT add `exec 3<&-` in the parent shell here, that
    # would close whatever fd 3 the parent has (or
    # silently error), not the subshell's fd we just
    # opened.
    if (exec 3<>/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
      # Stage 2: HTTP /health probe (skipped if curl missing).
      if command -v curl >/dev/null 2>&1; then
        if curl -sf -o /dev/null --max-time 2 \
             "http://127.0.0.1:$port/health" 2>/dev/null; then
          return 0
        fi
      else
        # No curl — TCP probe alone is our best signal.
        return 0
      fi
    fi
    elapsed=$(( $(date +%s) - start_ts ))
    if [ "$elapsed" -ge "$timeout" ]; then
      return 1
    fi
    sleep 0.5
  done
}

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
[ -z "$PYTHON" ] && fail "python not found"
echo "[info] python: $PYTHON"

NO_BACKEND="${SAU_NO_BACKEND:-0}"
# 历史变量：marketing 已默认不住独立 Vite 进程。
# 现跱者仅在以后重现拆开时使用；sau_web/site/ 已删除，不再走它。
NO_MARKETING="${SAU_NO_MARKETING:-1}"
NO_WEBSHELL="${SAU_NO_WEBSHELL:-0}"

# ── 1) 检查/安装 Python 依赖 ───────────────────────────────────
if [ "$NO_BACKEND" != "1" ] && ! "$PYTHON" -c "import flask" >/dev/null 2>&1; then
  echo "[setup] install web deps"
  cd "$ROOT"
  if command -v uv >/dev/null 2>&1; then
    uv pip install -e ".[web]"
  else
    pip install -e ".[web]"
  fi
fi

# ── 2) 检查/安装前端依赖 ──────────────────────────────────────
# Marketing 现随前端一起安装：不需要独立的 sau_web/site/node_modules 检查。
if [ "$NO_WEBSHELL" != "1" ] && [ ! -d "$ROOT/sau_web/frontend/node_modules" ]; then
  echo "[setup] install web-shell deps"
  cd "$ROOT/sau_web/frontend"
  npm install
fi

# ── 3) 数据库配置 (PostgreSQL-only, post-SQLite-removal) ─────────
# DATABASE_URL is the single env-var surface for the PG connection.
# If unset, we default to a local-DB URI so the dev shell stays
# runnable out of the box; production should always override.
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgres:///sau"
  echo "[info] DATABASE_URL not set, defaulting to postgres:///sau"
fi

# ── 4) 关闭默认端口 ──────────────────────────────────────────
kill_port 6001
kill_port 5180
# marketing landing 现并入 Web Shell (同一个 Vite 产物， :5180)。
# 如以往遗留的 :5174 端口被某个旧版 Sau Web 还占用，顺带清理。
kill_port 5174

# ── 5) 启动后端 ──────────────────────────────────────────────
if [ "$NO_BACKEND" != "1" ]; then
  echo "[start] backend  -> http://localhost:6001"
  cd "$ROOT"
  export SAU_CORS_ALLOWED_ORIGINS="${SAU_CORS_ALLOWED_ORIGINS:-http://localhost:5173,http://localhost:5174,http://localhost:5180}"
  # Dev-mode convenience: disable auth so /api/* is reachable without login.
  # Can still be overridden by setting SAU_AUTH_ENABLED explicitly.
  export SAU_AUTH_ENABLED="${SAU_AUTH_ENABLED:-false}"
  # Round-Video-Backgrounds-v1: prepend the project's `.venv/bin`
  # to `$PATH` so subprocesses spawned from the Flask process
  # (e.g. `edge-tts` for Studio voiceover synthesis, `ffmpeg`-
  # variant helper scripts) resolve via ``shutil.which()`` without
  # a manual ``source .venv/bin/activate``. ``exec`` collapses this
  # subshell into ``python run.py`` — ``&`` already backgrounded,
  # so ``$!`` below captures the python PID and the ``trap cleanup
  # EXIT`` still tears it down cleanly.
  #
  # Belt-and-suspenders: ``run.py`` also has an idempotent in-process
  # ``_inject_venv_bin_to_path`` for operators who bypass this script
  # (i.e. invoke ``python run.py`` directly with the venv NOT
  # activated). That guard sees ``$ROOT/.venv/bin`` already on
  # ``$PATH`` and no-ops — both paths are safe to coexist.
  PATH="$ROOT/.venv/bin:$PATH" exec "$PYTHON" run.py > "$LOG_DIR/backend.log" 2>&1 &
  BACKEND_PID=$!
  echo "[start] backend pid=$BACKEND_PID"
fi

# ── 5.5) 等待后端就绪（cold-start race gate） ─────────────────
# Vite's dev server binds :5180 within a few hundred ms of
# `npm run dev`, but its /api proxy hits :6001 the moment a
# request lands. Without this gate, Vite starts while Flask
# is still mid-import → first N requests 502 with "Bad
# Gateway" until Flask finishes wiring its request handlers.
#
# Skipped when:
#   * SAU_NO_BACKEND=1   — no Flask to wait for
#   * SAU_NO_WEBSHELL=1  — no Vite to race with
#
# Failure handling: if the wait times out, tail the last
# 30 lines of backend.log BEFORE the trap fires so the
# operator can see the real cause (e.g. psycopg missing,
# PG unreachable, import error). The trap on EXIT will still
# kill the half-started backend cleanly afterwards.
if [ "$NO_BACKEND" != "1" ] && [ "$NO_WEBSHELL" != "1" ]; then
  timeout="${SAU_BACKEND_READY_TIMEOUT:-30}"
  echo "[wait ] waiting for backend on :6001 (timeout ${timeout}s)..."
  if ! wait_for_port 6001 "$timeout"; then
    echo "[ERROR] backend did not become ready within ${timeout}s" >&2
    if [ -f "$LOG_DIR/backend.log" ]; then
      echo "[hint] tail of $LOG_DIR/backend.log:" >&2
      tail -n 30 "$LOG_DIR/backend.log" >&2 || true
    else
      echo "[hint] no backend.log found at $LOG_DIR/backend.log" >&2
    fi
    echo "[hint] 常见原因: PostgreSQL 未连接 / psycopg 缺失 / DATABASE_URL 错 / 端口 6001 仍被旧进程占用 / Python 依赖未装 (uv pip install -e .[web])" >&2
    fail "backend not ready"
  fi
  echo "[wait ] backend ready"
fi

# ── 6) 启动营销官网（默认入口） ────────────────────────────────
# ── 6) 启动 Web Shell + Marketing（同一个 Vite 产物，:5180） ────
if [ "$NO_WEBSHELL" != "1" ]; then
  echo "[start] web-shell (+marketing) -> http://localhost:5180"
  cd "$ROOT/sau_web/frontend"
  npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
  WEBSHELL_PID=$!
  echo "[start] frontend pid=$WEBSHELL_PID"
fi

cat <<EOF

$(printf '━%.0s' {1..40})
  Marketing Landing (/):     http://localhost:5180/
  Web Shell 运营台 (/dashboard/*):  http://localhost:5180/dashboard
  Login (/login):           http://localhost:5180/login
  Flask 后端 API:           http://localhost:6001
$(printf '━%.0s' {1..40})
日志: $LOG_DIR
  frontend.log · backend.log
关闭: Ctrl+C

EOF

wait
