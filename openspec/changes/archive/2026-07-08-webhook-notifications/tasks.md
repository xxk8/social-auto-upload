## 1. 数据库 — notifications / webhooks_config 表 (Web API / Database)

- [ ] 1.1 `web_runner/db.py:init_db()` 加 `notifications` 表（`AUTOINCREMENT` / `CURRENT_TIMESTAMP` 兼容，`delivered`/`final_failed` 用 0/1，含 3 个索引），SQLite + PostgreSQL 双方言
- [ ] 1.2 `web_runner/db.py:init_db()` 加 `webhooks_config` 表（数组存路由条目：`platform?` / `account?` / `url` / `secret` / `enabled`）
- [ ] 1.3 `web_runner/db.py` 加 `db_insert_notification(event: dict) -> int`（走 `insert_returning_id`）
- [ ] 1.4 `web_runner/db.py` 加 `db_mark_delivered(notification_id)` / `db_mark_final_failed(notification_id)` / `db_incr_retry(notification_id)`
- [ ] 1.5 `web_runner/db.py` 加 `db_get_webhook_config() -> list[dict]` / `db_upsert_webhook_config(rows: list[dict])`
- [ ] 1.6 `tests/test_db_wrapper.py` 加建表单测：SQLite + Postgres 下两表均成功；`payload` 经 `json_dump` 编解码往返

## 2. 后端 — 事件总线 + emit 挂载 (Web API)

- [ ] 2.1 新建 `web_runner/notifications.py`：`UploadEvent` dataclass（event_type / task_id / platform / account / title / status / error_message / timestamp / video_file / scheduled_time）
- [ ] 2.2 `web_runner/notifications.py` 加进程内 `EventBus`（queue + 订阅者）+ `emit_event(event)`
- [ ] 2.3 `web_runner/notifications.py` 加 `build_event_from_result(task_id, event_type, stdout)`：复用 `utils._parse_upload_result` 抽 platform/account/title
- [ ] 2.4 `web_runner/utils.py:_run_sau()` L554-559 成功/失败分支挂 `emit_event`（成功用 `build_event_from_result`，失败用 `UploadEvent` + error_message 截断 500 字符）
- [ ] 2.5 `web_runner/__init__.py:create_app()` 启动 Webhook 分发 worker（asyncio task，幂等）
- [ ] 2.6 `tests/test_notifications_event.py` 加：`emit_event` 在 `_run_sau` 成功/失败分支触发；error_message 截断；同 `(task_id,event_type)` 去重

## 3. 后端 — WebhookDispatcher + 适配器 (Web API)

- [ ] 3.1 `web_runner/notifications.py:WebhookDispatcher`：消费 EventBus，按 D4 路由规则选 `webhooks_config` 条目
- [ ] 3.2 飞书适配器：`interactive` 卡片 + `timestamp` + `sign = base64(HMAC-SHA256(timestamp+secret))`，防重放 ±3600s
- [ ] 3.3 钉钉适配器：`markdown` + `timestamp` + `sign` 走 URL query（`HMAC-SHA256(secret, timestamp+"\n"+secret)` urlencode）
- [ ] 3.4 企业微信适配器：`markdown/text` 封装，URL 即凭证（不签名）
- [ ] 3.5 强制 HTTPS；`timestamp` 偏差超窗口拒发 + logger.error
- [ ] 3.6 投递可靠性：指数退避（1s→2s→4s）最多 3 次；`delivered`/`delivered_at`/`retry_count` 同事务更新
- [ ] 3.7 死信：3 次失败 → `final_failed=1` + 生成内部 `system.webhook_failed` 通知
- [ ] 3.8 幂等去重：写前按 `(task_id, event_type)` 查重，已 `delivered=1` 跳过
- [ ] 3.9 频率限制：token-bucket 默认 20 条/分钟/渠道 + 失败聚合摘要（`SAU_WEBHOOK_AGG_WINDOW` 默认 60s）
- [ ] 3.10 审计接入：每次 `delivered=1` / `final_failed=1` 写现有审计日志（渠道 / event_type / task_id / 时间）
- [ ] 3.11 `tests/test_webhook_dispatch.py`：`test_feishu_sign` / `test_dingtalk_sign` / `test_https_only` / `test_retry_3x_then_dead_letter` / `test_idempotent_dedup` / `test_rate_limit_aggregate`

## 4. 后端 — Webhook / Notification API (Web API)

- [ ] 4.1 `web_runner/routes/webhooks.py`：`GET /api/webhooks/config`（secret 脱敏尾 4 位）/ `PUT /api/webhooks/config`（写 DB 覆盖 `.env`）/ `POST /api/webhooks/test`（连通性）
- [ ] 4.2 `web_runner/routes/notifications.py`：`GET /api/notifications`（分页+筛选）/ `GET /api/notifications/unread` / `POST /api/notifications/mark-read`
- [ ] 4.3 `.env.example` 加 `SAU_WEBHOOK_URL` / `SAU_FEISHU_WEBHOOK_URL` / `SAU_FEISHU_WEBHOOK_SECRET` / `SAU_DINGTALK_*` / `SAU_WEWORK_WEBHOOK_URL` / `SAU_WEBHOOK_AGG_WINDOW`
- [ ] 4.4 `tests/test_notifications_api.py`：`test_get_config_masked_secret` / `test_put_config_overrides_env` / `test_list_notifications_filter` / `test_mark_read`

## 5. 前端 — 通知中心 UI (Frontend)

- [ ] 5.1 侧边栏加「通知中心」入口 + 未读数量角标（侧边栏 + 浏览器 Tab title，沿用现有未读提示模式）
- [ ] 5.2 新建 `src/Pages/NotificationCenterPage.tsx`：列表时间倒序、按类型筛选（全部/未读/上传成功/上传失败/系统通知）
- [ ] 5.3 每条显示：事件类型图标、平台、账号、标题、时间、状态；批量标记已读 / 清空
- [ ] 5.4 复用现有 SSE hook（与 `routes/upload.py` 同套 `_MAX_SSE_CONNECTIONS=5`）实时推送新通知
- [ ] 5.5 `src/api/client.ts` 加 `/api/notifications/*` 与 `/api/webhooks/*` client
- [ ] 5.6 `tests/NotificationCenterPage.test.tsx` 加渲染 + 筛选 + 已读 case

## 6. 前端 — SettingsPage Webhook 配置 (Frontend)

- [ ] 6.1 `src/Pages/SettingsPage.tsx` 加「Webhook 通知」section：按平台/账号路由的 URL + secret 输入、启用开关、「测试连通性」按钮
- [ ] 6.2 「测试连通性」→ `POST /api/webhooks/test`
- [ ] 6.3 `tests/SettingsPage.test.tsx` 加 Webhook 配置渲染 + 测试按钮 case

## 7. Cookie 过期检测 (CLI / Web API)

- [ ] 7.1 `sau <platform> check`（CLI 已有）判定登录态失效后 emit `cookie.expired` 事件（独立于上传结果通道）
- [ ] 7.2 executor 账号健康巡检（若实现）复用同一 `cookie.expired` 事件
- [ ] 7.3 `tests/test_cookie_expired_event.py`：check 失败 → 发 `cookie.expired`，不与 `upload.failed` 混淆

## 8. 文档 + 验证 (Docs / Verification)

- [ ] 8.1 `docs/web-shell.md` 加「通知中心」section（入口、筛选、已读、Webhook 配置）
- [ ] 8.2 `docs/install.md` 加「Webhook 通知配置」section（各平台 env 变量 + 签名说明）
- [ ] 8.3 `pytest tests/` 全绿
- [ ] 8.4 dev server 启动 → 看到 Webhook 分发 worker log
- [ ] 8.5 配一个飞书/钉钉机器人 → 跑一次上传成功/失败 → 收到卡片；24h 内重复事件只推 1 次
- [ ] 8.6 故意让 Webhook 5xx → 重试 3 次后通知中心出现 `system.webhook_failed`；审计日志记录
- [ ] 8.7 SQLite + PostgreSQL 两种 dialect 下 `init_db()` 均成功建两表
