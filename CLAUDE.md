## Project Overview

This project, `social-auto-upload`, automates publishing video content to multiple domestic and international mainstream social media platforms.

The current mainline is the Python CLI/backend implementation under `sau_cli.py`, `uploader/`, and `skills/`. The legacy Web stack (`sau_backend.py`, `sau_backend/`) has been moved to `legacy/` and is not the active entrypoint.

**Web stack (optional, single React app):**

*  `sau_web/frontend/` — **唯一前端应用**，React + Vite。默认端口 **5180**。同时承载 **官网首页**（公开 `/` 路由，访客无需登录）与 **Web Shell 运营台**（authed `/app/*` 路由，需要邮箱验证码登录）。
*  共享同一个 `run.py` Flask 后端（端口 **6001**，由 Vite dev proxy 调用 `/api/*`）。
* 一键拉起前端 + 后端：`bash sau_web/start.sh`。之前描述的独立 `sau_web/site/` React app 已合并进同 Vite 产物，不再独立部署。*  Docs: `docs/web-shell.md`
* Note: prefer the CLI unless you are actively working on the React frontend.

**Operations / on-call:**

*  `docs/dev/INDEX.md` — dev-docs hub grouped by audience (**Operators / Contributors / Onboarding**); use as the canonical entrypoint when looking up any in-depth engineering doc from the repo root.
*  `docs/dev/monitor-cdp-throttling-cron-ops.md` — TBF-018 cron runbook: deploy / verify / idempotent re-run / rollback / threshold-tune. Mirrors `docs/web-shell.md`'s top-level pointer pattern so an on-call operator landing at the repo root reaches it in 1 click.
*  `docs/dev/public-inbox-ops.md` — public-inbox-monetization daily kill-criteria runbook: deploy / verify (30-day trigger confirmation) / idempotent re-run / rollback / threshold-tune / webhook delivery. Next-business-day SLA (vs TBF-018's 5-min STOP-SHIP). Same operator-side conventions as the TBF-018 runbook.
*  `docs/ai-material-search.md` — Pexels + Pixabay image-search onboarding for the AI sidebar `/app/publish` 「图片素材」Disclosure: free-tier signup URLs, `.env` 写入 `PEXELS_API_KEY` / `PIXABAY_API_KEY`, rate-limit warnings (Pexels 200/h + 20K/mo · Pixabay 100/60s), curl `POST /api/ai/images/search` verify, T&C compliance (attribution + 不复制主体 + 不 hotlink). 镜像 `web_runner/routes/ai.py` §1 三路由 + 前端 `MaterialSection.tsx` 的运维纪律。
*  Note: prefer this pointer to the per-runbook paragraphs scattered across `README.md` so there's a single ON-CALL entry surface.

**Command-line Interface:**

The project also provides a command-line interface (CLI) for users who prefer to work from the terminal. For new Douyin CLI work, prefer the `sau douyin ...` entrypoint over legacy example scripts.

*   `login`: To log in to the Douyin uploader account.
*   `check`: To verify whether the saved Douyin cookie is still valid.
*   `upload`: To upload one video file with explicit metadata flags.

## Building and Running

### Backend

> 当前主线使用 `uv` + `pyproject.toml` 管理依赖，使用 `patchright` 驱动浏览器，数据库初始化已在 `web_runner/db.py` 中集成（首次启动 `web_runner.py` 时自动建表）。**`requirements.txt` 和 `db/createTable.py` 仅作历史兼容用途，新用户请直接按下方命令走。**

1.  **Install dependencies (推荐 `uv`，回退 `pip` 时使用 `-e` 安装 `pyproject.toml`):**
    ```bash
    uv pip install -e .
    # 或： pip install -e .
    ```

2.  **Install Playwright-compatible browser drivers (`patchright`，国内镜像):**
    ```bash
    patchright install chromium
    # Windows PowerShell 用 npmmirror: $env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"; patchright install chromium
    ```

3.  **Initialize the database (首次启动 `web_runner.py` 时自动完成，无需手动执行):**
    ```bash
    python web_runner.py   # 自动调用 web_runner/db.py::init_db()
    ```

4.  **Run the Web stack (官网首页 + Web Shell 运营台 + 后端):**
    ```bash
    bash sau_web/start.sh
    ```
    该脚本同时拉起：
    - 官网首页（默认访问） → `http://localhost:5174`
    - Web Shell 运营台         → `http://localhost:5180`
    - Flask 后端 API         → `http://localhost:6001`
    日志输出到 `.sau-logs/` 下。手动启动仅后端：
    ```bash
    python web_runner.py
    ```

### Frontend (唯一前端 sa_web/frontend)

1.  **Navigate to the frontend directory:**
    ```bash
    cd sau_web/frontend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Run the dev server:**
    ```bash
    npm run dev
    ```
    默认 `http://localhost:5180`：
    - 官网首页 / 公开营销页： `/` (访客可直接访问)
    - Web Shell 运营台：      `/app` (需要邮箱验证码登录)
    - 组件目录：          `/catalog` (公开，供设计走查)

### Command-line Interface

`uv pip install -e .` 安装后，会在虚拟环境里注册 `sau` 入口（当前主入口为 `sau_cli.py` / `cli/` 包）。本地开发时也可直接：

```bash
python sau_cli.py douyin login --account <account_name>
```

**Login:**

```bash
sau douyin login --account <account_name>
```

**Check:**

```bash
sau douyin check --account <account_name>
```

**Upload:**

```bash
sau douyin upload-video --account <account_name> --file <video_file> --title <title> [--tags tag1,tag2] [--schedule YYYY-MM-DD HH:MM]
```

**Install bundled skill:**

```bash
sau skill install
```

## Development Conventions

*   Current mainline code is in `sau_cli.py` / `cli/`, `uploader/`, `skills/`, and `docs/CLI.md`.
*   One optional React frontend lives under `sau_web/frontend/` (default port `:5180`); it simultaneously serves the marketing landing page at `/` and the authed Web Shell dashboard at `/app/*`. The previously proposed separate `sau_web/site/` app on `:5174` was merged into the same Vite product and is no longer a separate repo path.
*   The historical Vue frontend `sau_frontend/` has been removed.
*   The project uses a SQLite database for data storage. The database file is located at `db/database.db`.
*   The `conf.example.py` file should be copied to `conf.py` and configured with the appropriate settings.
*   The `requirements.txt` file lists the Python dependencies.
*   `sau_web/frontend/package.json` lists the React frontend dependencies (now covering both the landing page and the dashboard).

## Cross-doc thread index

Three cross-cutting rules (module-local `cva()` · `verbatimModuleSyntax` 4-rung fallback · lint baseline + sweep status) live in **three documents covering three reviewer roles**: source-of-truth detail, system-level tutorial, and PR-side enforcement. Use this matrix as the README-of-record for the threads so a reviewer with a specific role lands in their natural cell first.

| Thread | Source-of-truth detail | System-level tutorial | PR-side enforcement |
|---|---|---|---|
| Module-local `cva()` (canonical set: `badge.tsx`, `button.tsx`, `alert.tsx`, `sheet.tsx`) | `DESIGN-components.md` → `cross-cutting.shadcn-fast-refresh.rule` | `DESIGN.md` → Iteration guide step 3 | `openspec/config.yaml` → `rules.design` bullets 6 + 7 |
| `verbatimModuleSyntax` 4-rung fallback ladder | `DESIGN-components.md` → `cross-cutting.shadcn-fast-refresh.sweep-status` (verbatimModuleSyntax paragraph + `tsconfig.app.json` top-of-file comment) | `DESIGN.md` → Iteration guide step 5 | `openspec/config.yaml` → `rules.design` bullets 8 + 9 |
| Lint baseline + sweep status | `DESIGN-components.md` → `cross-cutting.shadcn-fast-refresh.sweep-status` (full sweep / next-round open items) | `DESIGN.md` → "Known open lint baseline" | `openspec/config.yaml` → `rules.design` bullets 10 + 11 |

**Land here first** by reviewer role:

- **PR review** (human or AI agent enforcing openspec): start at `openspec/config.yaml rules.design`. Cross-check `DESIGN.md` for rationale; consult `DESIGN-components.md` only when you need the full recipe behind a bullet.
- **System author** (token / radius / `cva()` promotion): start at `DESIGN.md` Iteration guide. Mirror the change in `DESIGN-components.md` so per-component recipes stay in lockstep; check `openspec/config.yaml rules.design` bullets 6+7 before promoting a new recipe.
- **Component author** (`<Button>` / `<Card>` / etc. variant work, or tickets under the `cva()` contract): start at `DESIGN-components.md cross-cutting.shadcn-fast-refresh.rule`. Validate via `DESIGN.md` Iteration guide step 3. Confirm `openspec/config.yaml rules.design` bullets 6+7 don't forbid what you're about to do.
- **Feature author** (implementing a dashboard page or wiring a new endpoint): start at `DESIGN-components.md cross-cutting.shadcn-fast-refresh.rule` for the cva/verbatim/lint rules that apply to your code, then check `DESIGN.md` Iteration guide step 3 for the rationale, then confirm `openspec/config.yaml rules.design` bullets 6+7 / 8+9 / 10+11 don't forbid anything you just authored.
- **Lint sweep author** (clearing an `OPT-follow-up-3-sweep-2` next-round item): start at `DESIGN-components.md cross-cutting.shadcn-fast-refresh.sweep-status` (full sweep block). After the fix lands, update `DESIGN.md` "Known open lint baseline" + `openspec/config.yaml rules.design` bullet 10 (rule) + bullet 11 (allowlist, only if you removed an entry).
