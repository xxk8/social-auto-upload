# Web Shell 可视化界面

social-auto-upload 提供了统一的前端 Vite 应用，同时承载两个使用面：

- **官网首页（默认访问 `http://localhost:5180/`）** — React + Vite 的营销站内容，面向公众，介绍项目能力、平台、CLI / Web / Agent Skill 一套三连。**不需要登录**。
- **Web Shell 运营台（`http://localhost:5180/app`）** — React + Flask 封装的 CLI 图控台。账号分组、批量发布、任务列表、运行日志、AI 生成。**需要邮箱验证码登录**。

历史架构中独立部署的面向官网的 `sau_web/site/` +(端口 `:5174`) React app 已合并进同 Vite 产物，唯一前端路径现在是 `sau_web/frontend/`。

`bash sau_web/start.sh` 同时拉起唯一前端 + Flask 后端。

## 页面功能

| 页面 | 路由 | 认证 | 功能 |
|---|---|---|---|
| 官网首页 | `/` | 公开 | 营销站首页 · Hero / Platforms / Features / CTA |
| 账号管理 | `/app` | AuthGuard | 查看已保存账号、筛选平台、登录新账号、删除账号 |
| 发布中心 | `/dashboard/publish` | AuthGuard | 视频/图文表单提交，选择平台和账号，设置定时发布 |
| 运行日志 | `/dashboard/logs` | AuthGuard | 日志查看、过滤、关键字搜索、导出 |
| 任务列表 | `/dashboard/tasks` | AuthGuard | 任务状态追踪、轮询更新、筛选排序 |
| 组件目录 | `/catalog` | 公开 | 设计走查 · 设计师可在不登录的情况下浏览 9 个组件 demo |

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

## On-call：401 race-window 噪音怎么消

`useAuth.getMe()` 第一次进 `/dashboard/*` 尚未结算时，会有一批并发 `/api/*` 请求与 auth 门同时冲撞，DevTools Network 面板里会看到一片红 401 + 502。这不是真错，是源码里写明保留的 race window（`sa_web/frontend/src/api/_createAuth401ResponseInterceptor.ts` 头部注释 + `_appendAuthPendingHeader.ts`）。
> 前端请求会打上 `X-SAU-Auth-Pending: 1`，后端 `web_runner/__init__.py` 的 `@app.after_request` 会把它在 401 响应上回声为 `X-SAU-Race-Window: 1`，是 CORS simple 之外的 preflight header，**这个窗口内每个 `/api/*` 会多一次 OPTIONS 往返**（成本限在 `isLoading=true` 期间，首屏后归零）。排查时 DevTools Network 加 filter `has-response-header:X-SAU-Race-Window` 即可一键隐藏 race window 期间的 401。

## 注意事项

- Web Shell 运营台为单用户桌面场景设计，不包含用户系统/RBAC
- 所有上传任务实际由 `sau_cli.py` 的 CLI 逻辑在后台线程中执行
- 日志存储于 PostgreSQL（或 SQLite），重启后端不丢失（自动清理超过 2000 条的旧日志）
- 需先登录账号（通过 CLI 或运营台的登录表单）才能发布
- 所有平台、特性已统一收敛到 `PLATFORM_CONFIG` 字典管理，不再依赖硬编码集合
- 官网首页（`/`）位于统一前端应用本身，是公开路由，不要求登录，也不主动调用 `/api/*`。页面里的 CTA 按钮跳转 `/app` 后才进入需要登录的 Web Shell 运营台。
