## Why

当前上传任务的状态变更（成功/失败/重试）只记录在数据库和日志中，用户必须主动打开 Web Shell 或查日志才能知道结果。对于批量运营场景（README 明确「按账号名并发执行任务」），这意味着：

- 运营者需要反复刷新页面确认上传状态
- 上传失败时无法及时感知，导致错过最佳重试窗口
- 多人/多账号协作场景下，团队成员无法同步获取任务进展
- cookie 失效（账号登录态过期）只能在下一次上传时才被动发现

具体证据：
- `web_runner/executor.py` 的 `submit_task(_run_sau, ...)`（L208）是上传执行入口；`web_runner/utils.py:_run_sau(task_id, argv)`（L542）是结果唯一裁决点：成功 L554-557（`returncode==0` 写 `status=success`）、失败 L558-570（非零写 `status=failed`）、异常 L571-589（`TimeoutExpired`/`OSError`/`ValueError` 写 `status=error`）。但**没有**任何外发通知通路。
- `platform`/`account` **不**经函数参数传入 `_run_sau`，而是从 `tasks` 表读取（`web_runner/db.py:1088` 的 `tasks` 表已有 `task_id/platform/account/status/error/result` 列，建任务时由 `utils.py:160` 写入）。`build_event_from_result` 应读该表行，而非解析 argv。
- `web_runner/utils.py` 已有 SSE 基础设施：`_MAX_SSE_CONNECTIONS=5`（L43）、`_SSE_TIMEOUT_SECONDS=300`（L44）、`_progress_subscribers`（L41）；`routes/upload.py:274` 的 `upload_progress_sse` 是现成 generator 范式，`authenticate_sse_request`（routes/auth.py:85）是 SSE 鉴权入口。但 SSE 仅用于任务进度，未用于通知。
- `web_runner/db.py` 是双方言抽象层（SQLite + PostgreSQL），提供 `insert_returning_id()`（L416/L577/L711/L940）、`json_dump()`（L430/L601/L719/L954）、dict 结果契约 —— 新增通知存储必须走这套 API，不能写 Postgres-only 的 `SERIAL` / `NOW()`。
- `.env.example` 无 `SAU_*_WEBHOOK_*` 配置项（仅 `SAU_KILL_CRITERIA_WEBHOOK` 在 L130 是同类先例）；项目已有 `SAU_SMTP_*`（L64-68）但没接到上传事件。
- `cookie.expired` 的触发源是 `sau <platform> check`：`cli/dispatchers.py:58-61` 调 `await <platform>.check(args.account)`，有效打印 `valid`/exit 0，无效打印 `invalid`/exit 1。该路径独立于 `_run_sau`。

## What Changes

**后端 — 事件总线 + Webhook 分发**
- 新文件 `web_runner/notifications.py`：进程内 `EventBus`（queue + 订阅者）、`UploadEvent` dataclass、`emit_event()`、`build_event_from_result()`（复用 `utils._parse_upload_result` 抽 title；platform/account 读 `tasks` 表行，不解析 argv）。
- `web_runner/utils.py:_run_sau()` 的三类终态分支（L554-557 成功 / L558-570 失败 / L571-589 异常）均挂 `emit_event`，前两者映射 `upload.success`/`upload.failed`，`error` 归一为 `upload.failed`。这是唯一结果裁决点。
- `WebhookDispatcher`：飞书 / 钉钉 / 企业微信 / 自定义 URL 适配器，含各平台签名算法（飞书 HMAC-SHA256、钉钉 URL query 签名）、指数退避重试（最多 3 次）、死信处理、幂等去重、频率限制（token-bucket + 失败聚合）。
- 强制 HTTPS；`timestamp` 防重放窗口校验。

**数据库 — notifications 表（双方言）**
- 在 `web_runner/db.py:init_db()` 中新增 `notifications` 表（`AUTOINCREMENT` / `CURRENT_TIMESTAMP` 兼容写法，`delivered`/`final_failed` 用 0/1），随首次启动自动建表，不新增独立迁移脚本。
- `webhooks_config` 表：存储按 `(platform?, account?)` 维度路由的 Webhook 配置数组，页面可读写、覆盖 `.env` baseline。

**后端 — Webhook API**
- `GET/PUT /api/webhooks/config`（读/写 DB 配置，secret 脱敏返回）
- `POST /api/webhooks/test`（连通性测试）
- `GET /api/notifications`、`GET /api/notifications/unread`、`POST /api/notifications/mark-read`
- 审计日志：每次投递 `delivered=1` / `final_failed=1` 写入现有审计表。

**前端 — 通知中心**
- 侧边栏新增「通知中心」入口；复用现有 SSE helper 实时推送。
- 未读角标、按类型筛选、批量已读/清空、Webhook 配置入口。
- `SettingsPage` 加 Webhook 配置（按平台/账号路由）。

**Cookie 过期通知**
- `cookie.expired` 事件由 `sau <platform> check`（CLI 已有 `check` 子命令，cli/dispatchers.py:58-61）判定登录态失效后触发，**不**与上传结果混在同一通道。

## Capabilities

### New Capabilities
- `webhook-dispatch`: 上传/系统事件 → 飞书/钉钉/企微/自定义 Webhook，含签名、重试、死信、去重、频率限制
- `notification-center-ui`: Web Shell 通知中心（侧边栏入口 + SSE 实时推送 + 筛选/已读）
- `notification-api`: `/api/notifications/*` 与 `/api/webhooks/*` 端点
- `webhook-config`: 按平台/账号维度路由的 Webhook 配置（`.env` baseline + DB 覆盖）

### Modified Capabilities
- `upload-event-emit`: `web_runner/utils.py:_run_sau` 成功/失败/异常分支挂 `emit_event`（新增事件源）
- `web-runner-startup`: `web_runner/__init__.py:create_app` 启动 Webhook 异步分发 worker
- `audit-log`: 通知投递计入现有审计日志

## Impact

- **CLI**: 无直接影响；`cookie.expired` 事件由 `sau <platform> check` 触发（已有命令扩展）。
- **Web API**:
  - 新文件 `web_runner/notifications.py`（事件总线 + 分发器 + 适配器，~300 行）
  - `web_runner/db.py:init_db()` 加 `notifications` + `webhooks_config` 两表（双方言）
  - `web_runner/utils.py:_run_sau()` 成功/失败/异常分支加 `emit_event`
  - `web_runner/__init__.py:create_app()` 启动分发 worker
  - `web_runner/routes/` 加 `notifications.py` + `webhooks.py`（或并入现有路由模块）
  - `.env.example` 加 `SAU_WEBHOOK_URL` / `SAU_FEISHU_*` / `SAU_DINGTALK_*` / `SAU_WEWORK_*` 配置项
- **Frontend**:
  - `sau_web/frontend/src/Pages/NotificationCenterPage.tsx`（新建）
  - 侧边栏加「通知中心」入口 + 未读角标
  - `sau_web/frontend/src/Pages/SettingsPage.tsx` 加 Webhook 配置（按平台/账号路由）
  - `sau_web/frontend/src/api/client.ts` 加 `/api/notifications/*` 与 `/api/webhooks/*` client
  - 复用现有 SSE hook（与 `routes/upload.py` 同套）
- **Database**:
  - `notifications` 表 + `webhooks_config` 表，SQLite + PostgreSQL 双方言
- **Dependencies**: `requests` 已用；无新依赖（签名用 `hmac` / `hashlib` 标准库）。

## Acceptance Criteria

1. **事件触发**：上传任务在 `_run_sau` 的三类终态分支（成功 L554-557 / 失败 L558-570 / 异常 L571-589）发出 `upload.success` 或 `upload.failed` 事件；`platform`/`account` 读 `tasks` 表，event 含 task_id / platform / account / title / error_message（截断 500 字符）。`cookie.expired` 由 `sau <platform> check` 路径（cli/dispatchers.py:58-61）发出，独立于上传通道。
2. **Webhook 分发**：配置的飞书/钉钉/企微/自定义 URL 收到结构正确的消息卡片；签名算法符合各平台官方规范；强制 HTTPS。
3. **投递可靠性**：投递失败指数退避重试最多 3 次；3 次仍失败标记 `final_failed=1` 并生成一条内部 `system.webhook_failed` 通知进通知中心；同 `(task_id, event_type)` 仅推送一次（幂等去重）。
4. **频率限制**：批量发布场景下 token-bucket 默认 20 条/分钟/渠道；同窗口多条 `upload.failed` 聚合为一条摘要卡片。
5. **配置优先级**：`.env` 为只读 baseline，DB 配置（`PUT /api/webhooks/config`）覆盖/合并 `.env`；`GET` 返回 secret 仅尾 4 位脱敏。
6. **通知中心**：侧边栏有入口 + 未读角标；列表时间倒序、按类型筛选；SSE 实时推送复用现有 helper；支持批量已读/清空。
7. **Cookie 过期**：`sau <platform> check` 判定登录态失效后发 `cookie.expired` 事件，独立于上传结果通道。
8. **审计**：每次投递 `delivered=1` / `final_failed=1` 计入现有审计日志。
9. **DB 双方言**：`notifications` / `webhooks_config` 在 SQLite 与 PostgreSQL 下均能建表成功，走 `init_db()` 同一入口。
10. **测试不回归**：`pytest tests/` 全绿；新增 `tests/test_webhook_dispatch.py`、`tests/test_notifications_api.py`。
