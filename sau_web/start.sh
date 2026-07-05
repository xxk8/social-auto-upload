#!/usr/bin/env bash
# social-auto-upload 一键启动脚本
#
# 默认同时拉起：
#   ● Flask 后端           http://localhost:6001   (/api/*)
#   ● Web Shell + 营销站   http://localhost:5180   (SPA — `/` 是 marketing landing, `/app/*` 是运营台)
#
# 营销站与 Web Shell 已合并到同一个 Vite 产物 (sau_web/frontend)。
#   · marketing landing   http://localhost:5180/
#   · web shell dashboard http://localhost:5180/app
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

# ── 3) 数据库配置 ────────────────────────────────────────────
export SAU_DB_DIALECT="${SAU_DB_DIALECT:-postgres}"
if [ "$SAU_DB_DIALECT" = "postgres" ] && [ -z "${DATABASE_URL:-}" ]; then
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
  "$PYTHON" run.py > "$LOG_DIR/backend.log" 2>&1 &
  BACKEND_PID=$!
  echo "[start] backend pid=$BACKEND_PID"
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
  Web Shell 运营台 (/app/*):  http://localhost:5180/app
  Login (/login):           http://localhost:5180/login
  Flask 后端 API:           http://localhost:6001
$(printf '━%.0s' {1..40})
日志: $LOG_DIR
  frontend.log · backend.log
关闭: Ctrl+C

EOF

wait
