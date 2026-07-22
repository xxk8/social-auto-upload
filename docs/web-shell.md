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

本仓库 Python 后端是**单机 CLI 壳**（账号/上传/任务/日志/AI），**没有**多用户 `/api/auth/*`。

- 默认 `VITE_SAU_LOCAL_SHELL` 开启：前端注入本地操作员，不强制 `/login`。
- 侧栏恢复历史完整导航；**已对接 Flask** 的页面：账号、发布、任务、日志、AI。
- Inbox / Crawl / Studio / Admin / 日历等页面 UI 已恢复，但对应 `/api` 若未在 `web_runner` 实现会空态或报错——需后续补 Python 接口。

关闭本地模式（接真实鉴权后端时）：

```bash
export VITE_SAU_LOCAL_SHELL=0
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
