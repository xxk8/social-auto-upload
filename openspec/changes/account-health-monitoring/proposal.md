## Why

用户最常见的运营痛点不是发布失败,而是**"早上发现 cookie 失效,要重新登录 5 个账号"**。当前缺失:

- 没有定期健康检查 — 账号 cookie 失效是被动发现的(下次上传才报"cookie_invalid")
- 没有"健康度"可视化 — AccountsPage 看不到账号是否即将过期
- 没有预警通知 — cookie 失效时不通知用户
- 没有集中化"全部账号健康度" dashboard

具体证据:
- `uploader/<platform>_uploader/main.py` 的 `cookie_auth()` 函数有,但只在上传时被调用
- `web_runner/routes/accounts.py` 路由(推测)只列 cookie 文件,不查健康度
- `web_runner/utils.py` / `db.py` 没有 `accounts.health` / `accounts.last_checked` 字段
- 前端 `AccountsPage.tsx` 不显示健康度 badge
- 没有 SMTP / Webhook 通知通路(仅 `SAU_SMTP_*` 配在 `.env.example`,但没接到健康度事件)

## What Changes

**数据库 — accounts 健康度字段**
- 现有 `accounts` 表(若有)加 4 列:
  - `last_check_at` (TIMESTAMP) — 上次 cookie_auth 时间
  - `last_health` (TEXT) — `valid` / `expiring_soon` / `invalid` / `unknown`
  - `consecutive_failures` (INTEGER, default 0) — 连续失败次数
  - `next_check_at` (TIMESTAMP) — 下次计划检查时间
- SQLite / PostgreSQL 双方言都要加,迁移脚本兼容既有账号(默认 `last_health = 'unknown'`, `last_check_at = NULL`)

**后端 — 定期健康检查后台 job**
- 新文件 `web_runner/health_monitor.py`:
  - 启动时启动 asyncio 背景任务
  - 每 6h 遍历所有账号,串行调 `cookie_auth()` (避免并发浏览器)
  - 更新 DB 字段
  - 健康度变化时触发通知
- 单次 `cookie_auth()` timeout 30s,失败重试 1 次
- Job 启动幂等(server 重启不重复启动)

**后端 — 健康度通知**
- 健康度变化时(valid → expiring_soon / invalid)触发通知:
  - 邮件:用现有 `SAU_SMTP_*` 配置
  - Webhook:新增 `SAU_HEALTH_WEBHOOK_URL` 配置,POST 一段 JSON `{event, account, health, ...}`
- 通知频率限制:同一账号 24h 内最多 1 次,避免刷屏
- 邮件模板 + Webhook payload 见 design D3

**后端 — 手动健康检查 API**
- `POST /api/accounts/<id>/health-check` 触发立即检查,返回最新健康度
- `GET /api/accounts/<id>/health` 拉最近一次健康度
- 已有 `GET /api/accounts` 列表 API 加 `health` 字段(不破 schema,后端 join)

**前端 — 健康度 UI**
- `sau_web/frontend/src/Pages/AccountsPage.tsx` 账号行加健康度 badge:
  - `valid`: 绿色 ●
  - `expiring_soon`: 黄色 ● + 倒计时(预计 24h 内失效)
  - `invalid`: 红色 ● + "重新登录" CTA
  - `unknown`: 灰色 ● + "检查" 按钮
- 列表顶部加汇总: `5/8 账号健康, 1 即将过期, 2 已失效`
- 单账号行加"立即检查"按钮 → 调 `POST /api/accounts/<id>/health-check`,loading state
- 通知设置页(`SettingsPage`):允许用户配邮件 / Webhook

**测试**
- `tests/test_account_health.py`(新建)加:
  - 健康度更新逻辑
  - 通知触发逻辑(邮件 / Webhook)
  - 频率限制(24h 内重复不发)
- `tests/test_health_monitor.py`(新建)加:
  - 后台 job 启动幂等
  - 单账号 30s timeout + 1 次重试
- `sau_web/frontend/src/Pages/AccountsPage.test.tsx` 加 badge 渲染 case
- `tests/test_health_notification.py`(新建)测邮件 / Webhook 触发

## Capabilities

### New Capabilities
- `account-health-tracking`: 账号 cookie 定期健康度检查 + DB 持久化
- `account-health-notification`: 健康度变化时邮件 / Webhook 通知
- `account-health-ui`: 前端 AccountsPage 健康度 badge + 汇总
- `account-health-api`: `GET/POST /api/accounts/<id>/health[-check]` 端点

### Modified Capabilities
- `db-schema`: accounts 表加 4 列(双方言)
- `web-runner-startup`: `web_runner/__init__.py:create_app` 启动 health monitor 背景 job

## Impact

- **CLI**: 无影响(纯 Web 功能)
- **Web API**:
  - `web_runner/db.py` `init_db()` 加 4 列 + migration
  - 新文件 `web_runner/health_monitor.py`(~150 行,含通知触发)
  - `web_runner/routes/accounts.py` 加 2 个新路由
  - `web_runner/__init__.py:create_app` 启动 background job
  - `web_runner/utils.py` 加 `_send_health_email()` / `_send_health_webhook()` 辅助函数
  - `.env.example` 加 `SAU_HEALTH_WEBHOOK_URL` 配置项
- **Frontend**:
  - `sau_web/frontend/src/Pages/AccountsPage.tsx` 加 health badge + 汇总 + 立即检查按钮
  - `sau_web/frontend/src/Pages/SettingsPage.tsx` 加通知设置(邮件 / Webhook)
  - `sau_web/frontend/src/api/client.ts` 加 `/api/accounts/<id>/health[-check]` API client
- **Database**:
  - accounts 表加 4 列,SQLite + PostgreSQL 双方言
  - migration 脚本兼容既有账号
- **Dependencies**:
  - 邮件:`smtplib` 标准库
  - Webhook:`requests` 已用
  - 无新依赖

## Acceptance Criteria

1. **后台 job**:
   - Server 启动后,`web_runner/health_monitor.py` 启动 1 个 background task
   - 每 6h 遍历所有账号,调 `cookie_auth()`
   - 重启 server 不重复启动(幂等)
2. **健康度更新**:
   - Cookie 有效 → `last_health = 'valid'`, `consecutive_failures = 0`
   - Cookie 失效 → `last_health = 'invalid'`, `consecutive_failures = N+1`
   - Cookie 即将过期(根据 `last_check_at + 7d`)→ `last_health = 'expiring_soon'`
3. **通知触发**:
   - 健康度从 `valid` → `invalid` 时,触发邮件 + Webhook
   - 24h 内同账号最多 1 次通知
   - 邮件模板含:账号名、平台、失效时间、重新登录链接
   - Webhook payload: `{event: "account_health_changed", account_id, platform, health, timestamp}`
4. **API**:
   - `GET /api/accounts/<id>/health` → `{health, last_check_at, consecutive_failures}`
   - `POST /api/accounts/<id>/health-check` → 立即检查,返回新健康度
5. **前端**:
   - AccountsPage 账号行显示健康度 badge
   - 列表顶部显示汇总 `5/8 健康, 1 即将过期, 2 已失效`
   - 单账号行 "立即检查" 按钮可手动触发
6. **DB migration**:
   - 既有账号(无 health 字段)默认值 `last_health = 'unknown'`
   - `init_db()` 检测到缺列时自动 ALTER TABLE
7. **测试不回归**:`pytest tests/` 全绿
