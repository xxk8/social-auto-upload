## 1. DB Schema 扩展 (Web API / Database)

- [ ] 1.1 `web_runner/db.py:_SCHEMA` 加 4 列: `last_check_at` (TIMESTAMP NULL) / `last_health` (TEXT DEFAULT 'unknown') / `consecutive_failures` (INTEGER DEFAULT 0) / `next_check_at` (TIMESTAMP NULL)
- [ ] 1.2 `web_runner/db.py:init_db()` 加 migration 逻辑:检测旧表无此 4 列时,ALTER TABLE 添加(SQLite + PostgreSQL 双方言)
- [ ] 1.3 `web_runner/db.py` 加 `db_update_account_health(account_id, health, consecutive_failures)` 函数
- [ ] 1.4 `web_runner/db.py` 加 `db_get_account_health(account_id) -> dict` 函数
- [ ] 1.5 `web_runner/db.py` 加 `db_list_accounts_with_health() -> list[dict]` 函数
- [ ] 1.6 `tests/test_db_wrapper.py` 加 migration 单测:旧表无 health 列 → migrate 后 4 列存在,既有账号 health = 'unknown'

## 2. 后端 — Health Monitor 后台 Job (Web API)

- [ ] 2.1 新建 `web_runner/health_monitor.py`:
      - `_monitor_loop()`:asyncio 循环,每 6h 调一次 `_check_all_accounts()`
      - `_check_all_accounts()`:遍历账号,串行调 `cookie_auth()`,更新 DB
      - 单账号 `cookie_auth()` 30s timeout + 1 次重试
      - 健康度变化时调 `_maybe_notify()`
- [ ] 2.2 启动幂等:`_monitor_task: asyncio.Task | None = None`,启动时检查是否已存在
- [ ] 2.3 `web_runner/__init__.py:create_app()` 在最后启动 background task(`asyncio.create_task(_monitor_loop())`)
- [ ] 2.4 `web_runner/health_monitor.py` 测试:
      - `tests/test_health_monitor.py` 加 `test_monitor_loop_6h_interval`
      - `test_check_all_accounts_serial`
      - `test_idempotent_start`

## 3. 后端 — 通知触发 (Web API)

- [ ] 3.1 `web_runner/utils.py` 加 `_send_health_email(to, subject, body)`:
      - 用现有 `SAU_SMTP_*` 配置
      - body 模板:账号名 / 平台 / 失效时间 / 重新登录链接(`/app/accounts?platform=X&action=login`)
- [ ] 3.2 `web_runner/utils.py` 加 `_send_health_webhook(url, payload)`:
      - `requests.post(url, json=payload, timeout=10)`
      - payload: `{event: "account_health_changed", account_id, platform, health, timestamp, action_url}`
- [ ] 3.3 `web_runner/health_monitor.py:_maybe_notify(account, old_health, new_health)`:
      - 仅在 `old_health == 'valid' and new_health in ('expiring_soon', 'invalid')` 时通知
      - 24h 频率限制:DB 字段 `last_notified_at` 记录上次通知时间
- [ ] 3.4 `.env.example` 加 `SAU_HEALTH_WEBHOOK_URL` 配置项(可选)
- [ ] 3.5 `tests/test_health_notification.py`(新建):
      - `test_email_sent_on_health_change`
      - `test_webhook_sent_on_health_change`
      - `test_24h_rate_limit`
      - `test_no_notification_on_valid_to_expiring_to_valid`

## 4. 后端 — Health API (Web API)

- [ ] 4.1 `web_runner/routes/accounts.py` 加 `GET /api/accounts/<id>/health`:
      - 调 `db_get_account_health(id)`,返回 `{health, last_check_at, consecutive_failures}`
- [ ] 4.2 `web_runner/routes/accounts.py` 加 `POST /api/accounts/<id>/health-check`:
      - 立即调 `cookie_auth()`,更新 DB,返回新 health
- [ ] 4.3 `web_runner/routes/accounts.py:GET /api/accounts` 列表 API 加 `health` 字段
- [ ] 4.4 `tests/test_account_health_api.py`(新建):
      - `test_get_health_endpoint`
      - `test_post_health_check_endpoint`
      - `test_list_accounts_includes_health`

## 5. 前端 — AccountsPage 健康度 UI (Frontend)

- [ ] 5.1 `sau_web/frontend/src/Pages/AccountsPage.tsx` 账号行加 `<HealthBadge health={acc.health} />` 组件
- [ ] 5.2 `HealthBadge` 组件(新建 `src/features/accounts/HealthBadge.tsx`):
      - valid: 绿色 ● + "健康"
      - expiring_soon: 黄色 ● + "即将过期(预计 X 小时)"
      - invalid: 红色 ● + "已失效"
      - unknown: 灰色 ● + "未检查"
- [ ] 5.3 列表顶部加汇总:`5/8 账号健康, 1 即将过期, 2 已失效`(颜色编码)
- [ ] 5.4 单账号行加 "立即检查" 按钮 → `POST /api/accounts/<id>/health-check`
- [ ] 5.5 loading state:检查中显示 spinner
- [ ] 5.6 `tests/AccountsPage.test.tsx` 加 health badge 渲染 case + 立即检查按钮 case

## 6. 前端 — SettingsPage 通知设置 (Frontend)

- [ ] 6.1 `sau_web/frontend/src/Pages/SettingsPage.tsx` 加 "账号健康度通知" section:
      - 邮件开关(`SAU_SMTP_USER` 已配则显示)
      - Webhook URL 输入框(POST 到 `SAU_HEALTH_WEBHOOK_URL` 端点)
      - "测试通知" 按钮 → 触发一次 mock 通知
- [ ] 6.2 `sau_web/frontend/src/api/client.ts` 加 `sendTestNotification(channel: 'email' | 'webhook')` API
- [ ] 6.3 `web_runner/routes/accounts.py` 加 `POST /api/accounts/test-notification` 端点
- [ ] 6.4 `tests/SettingsPage.test.tsx` 加通知设置渲染 case

## 7. 文档 (Docs)

- [ ] 7.1 `docs/install.md` 加 "健康度监控配置" section,说明 `SAU_HEALTH_WEBHOOK_URL` 等
- [ ] 7.2 `docs/web-shell.md` 加 "账号健康度" section,说明 badge 颜色含义
- [ ] 7.3 `README.md` 加 "为什么我的 cookie 经常失效?" FAQ

## 8. 验证 (Verification)

- [ ] 8.1 `pytest tests/` 全绿
- [ ] 8.2 dev server 启动 → 看到 health monitor background task log
- [ ] 8.3 故意让某账号 cookie 失效 → 等 6h 或手动触发 `POST /api/accounts/<id>/health-check` → 邮件 + Webhook 收到通知
- [ ] 8.4 24h 内重复触发 → 只发 1 次通知
- [ ] 8.5 既有数据 migration:测试库加 1 个旧账号无 health 字段 → 启动后自动加 4 列,health = 'unknown'
