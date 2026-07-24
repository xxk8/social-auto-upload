# Web Shell 可视化界面

social-auto-upload 提供了一个可选的可视化 Web 界面（Web Shell），基于 **React + TanStack Router SPA + Flask** 构建，封装 CLI 能力提供图形化管理。

## 架构（刻意保持简单）

| 层 | 技术 | 说明 |
|---|---|---|
| 前端壳 | Vite + React 19 | 入口 [`sau_web/frontend/src/main.tsx`](../sau_web/frontend/src/main.tsx) |
| 路由 | **TanStack Router** 文件路由 | 定义在 `sau_web/frontend/app/routes/`，**不是** TanStack Start / SSR |
| 数据 | axios + React Query | [`src/api/request.ts`](../sau_web/frontend/src/api/request.ts) 唯一实例；[`client.ts`](../sau_web/frontend/src/api/client.ts) 只做 `api.*` barrel |
| 后端 | `web_runner.py` (Flask) | 包装 CLI；生产环境托管 `frontend/dist/` |

**不要**把本前端当成 TanStack Start 全栈应用：无 `createServerFn`、无 Node BFF、鉴权是本机平台 cookie 文件，不是 Web 用户 session。

```
Browser → Vite :5174 (dev) / Flask static (prod)
       → TanStack Router
       → axios /api/*  →  Flask :6001  →  CLI / cookies
```


## 本地 Web Shell 模式（默认）

本仓库是**单机 CLI + 可视化壳**：前端 TanStack Router SPA，后端 Flask `web_runner`（SQLite）。

### 鉴权

| 变量 | 默认 | 含义 |
|------|------|------|
| `SAU_AUTH_ENABLED` | `false` | `false`：`/api/auth/me` 返回本地合成 admin，不强制登录 |
| `VITE_SAU_LOCAL_SHELL` | 开启 | 前端跳过 SaaS AuthGuard；设 `0` 才走多用户登录 |

### 已对齐 Flask 的 API 面（与前端 `src/api/*` 对应）

| 域 | 主要路径 | 说明 |
|----|----------|------|
| Auth | `/api/auth/*` | 本地合成用户 / 可选真登录 |
| 账号 | `/api/accounts*`、`/api/account-groups*` | 平台 cookie 登录 |
| 上传 | `/api/upload/video`、`/note` | 调 CLI |
| 任务/日志 | `/api/tasks*`、`/api/logs` | SQLite 任务队列 |
| AI | `/api/ai/*` | OpenRouter 等 |
| 日历 | `/api/calendar/tasks` | 任务按日聚合 |
| 下载中心 | `/api/inbox/*` | yt-dlp 下载到 `videos/inbox` |
| 热榜 | `/api/hotlist/*` | 公开页 `/hotlist`；代理各平台热搜，进程内缓存 5 分钟 |
| 采集 | `/api/crawl/*` | 入队 + `crawler.run_crawl` 写 SQLite；浏览器真爬设 `SAU_CRAWLER_LIVE=1` |
| 剧本工坊 | `/api/studio/*` | 项目 CRUD；`POST .../generate` 生成起承转合四幕 SSE |
| 分析 | `/api/analytics/*` | 任务统计 |
| 模板 | `/api/templates*` | 发布模板 |
| 许可证/配额 | `/api/license/*`、`/api/usage/quota` | 本地不限额 stub |
| 热榜 | `/api/hotlist/*` | 抖音/B站等多源热搜代理 |
| 管理后台 | `/api/admin/*` | 用户/审计/趋势（SQLite） |
| 智能排期 | `/api/scheduling/*` | 按历史任务成功率推荐时段 |
| 发布历史 | `/api/publish/history` | 时间线 |
| OAuth | `/api/auth/google|github/*` | 未配置时明确 501/跳转说明 |

启动：

```bash
export SAU_CORS_ALLOWED_ORIGINS="http://localhost:5174"
export SAU_AUTH_ENABLED=false   # 默认已是 false
python web_runner.py
cd sau_web/frontend && npm run dev
```

## 快速启动

### 方式一：一键启动（推荐）

```bash
bash sau_web/start.sh
```

该脚本会自动检查依赖、安装缺失包、启动后端和前端开发服务器。

### 方式二：手动启动

#### 1. 安装依赖

```bash
# Python 后端依赖
uv pip install -e ".[web]"

# React 前端依赖
cd sau_web/frontend && npm install
```

#### 2. 启动后端

```bash
python run.py
# 等价：python web_runner.py（thin wrapper → create_app）
```

后端运行在 `http://localhost:6001`。

##### CORS / 本地鉴权（必读）

后端默认 **禁用** CORS。前端跨域访问 `/api/*` 必须显式设置环境变量 `SAU_CORS_ALLOWED_ORIGINS`，值为逗号分隔的 来源 列表（包含 scheme 与端口，例如 `http://localhost:5174`）。

本地开发示例（在 shell 启动后端前设置）：

```bash
export SAU_CORS_ALLOWED_ORIGINS="http://localhost:5173,http://localhost:5174"
export SAU_AUTH_ENABLED=false   # 本地跳过邮箱登录；/api/auth/me 返回 synthetic admin
python run.py
```

未设置（或值为空）时，后端只会记录一条 warning 并拒绝所有跨域请求，前端 API 调用会报 CORS 错误。

#### 3. 启动前端（开发模式）

```bash
cd sau_web/frontend && npm run dev
```

前端运行在 `http://localhost:5174`，Vite 将 `/api` 代理到后端 `6001`。

#### 4. 生产构建

```bash
cd sau_web/frontend && npm run build
```

构建产物在 `sau_web/frontend/dist/`，后端会自动提供 `GET /` 服务。

## 页面功能

业务页挂在 `/dashboard` 壳（`AppShell`）下；营销/登录页在壳外。

| 页面 | 路由 | 功能 |
|---|---|---|
| 落地页 | `/` | 产品介绍入口 |
| 账号管理 | `/dashboard` | 账号组、平台授权、登录/校验 |
| 发布中心 | `/dashboard/publish` | 视频/图文表单、定时发布 |
| 任务列表 | `/dashboard/tasks` | 任务状态、轮询、重试 |
| 运行日志 | `/dashboard/logs` | 日志查看与过滤 |
| 收件箱等 | `/dashboard/inbox` 等 | 见 `app/routes/dashboard/` |
| 登录相关 | `/login`、`/login/auth` 等 | 壳外页面（非平台 cookie 登录主路径） |

平台账号登录/扫码以 dashboard 内授权流程 + Flask `/api/accounts/*` 为准。

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/accounts` | 列出已保存账号 |
| POST | `/api/accounts/login` | 触发账号登录 |
| POST | `/api/accounts/check` | 检查单个账号 Cookie 有效性 |
| POST | `/api/accounts/check-all` | 批量检查所有账号 Cookie |
| POST | `/api/accounts/delete` | 删除已保存账号 |
| POST | `/api/upload/video` | 视频上传（支持 headless、抖音商品、B站 tid、视频号短标题/分类/草稿） |
| POST | `/api/upload/note` | 图文上传（支持 JSON data URI 和 multipart 文件上传两种模式） |
| GET | `/api/tasks` | 任务状态列表 |
| POST | `/api/tasks/retry` | 重试失败/异常任务 |
| GET | `/api/logs` | 运行日志（支持 after / task_id 过滤） |
| GET | `/health` | 健康检查 |

## 注意事项

- Web Shell 为单用户桌面场景设计，不包含用户系统/RBAC
- 所有上传任务实际由 `sau_cli.py` 的 CLI 逻辑在后台线程中执行
- 日志存储于 SQLite 数据库，重启后端不丢失（自动清理超过 2000 条的旧日志）
- 需先登录账号（通过 CLI 或 Web Shell 的登录表单）才能发布
- 所有平台、特性已统一收敛到 `PLATFORM_CONFIG` 字典管理，不再依赖硬编码集合
