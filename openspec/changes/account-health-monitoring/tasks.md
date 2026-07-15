## 1. DB Schema 扩展 (Web API / Database)

- [x] 1.1 `web_runner/db.py:_SCHEMA` 加 5 列: `last_check_at` / `last_real_check_at` / `last_health` / `consecutive_failures` / `next_check_at` / `last_notified_at`
- [x] 1.2 `web_runner/db.py:init_db()` 加 migration 逻辑:ALTER TABLE 添加(PostgreSQL)
- [x] 1.3 `web_runner/db.py` 加 `db_update_account_health(account_id, health, consecutive_failures)` 函数
- [x] 1.4 `web_runner/db.py` 加 `db_get_account_health(account_id) -> dict` 函数
- [x] 1.5 `web_runner/db.py` 加 `db_list_accounts_with_health() -> list[dict]` 函数
- [ ] 1.6 `tests/test_db_wrapper.py` 加 migration 单测:旧表无 health 列 → migrate 后列存在,既有账号 health = 'unknown'

## 2. 后端 — Health Monitor 后台 Job (Web API)

- [x] 2.1 新建 `web_runner/health_monitor.py`:
      - `_monitor_loop()`:threading 循环,每 6h 调一次 `_run_monitor_cycle()`
      - `_run_monitor_cycle()`:遍历账号,串行调 quick check; 按需调真实 `cookie_auth()`,更新 DB
      - 单账号 `cookie_auth()` 30s timeout + 1 次重试
      - 健康度变化时调 `_send_health_notification()`
- [x] 2.2 启动幂等:`_monitor_thread: threading.Thread | None = None`,启动时检查是否已存在
- [x] 2.3 `web_runner/__init__.py:create_app()` 在最后启动 background thread
- [x] 2.4 `web_runner/health_monitor.py` 测试:
      - `tests/test_health_monitor.py` 加 `TestDetermineHealth` / `TestShouldNotify` / `TestCanNotify` / `TestCheckAuthorizationNow` / `TestSendHealthNotification`

## 3. 后端 — 通知触发 (Web API)

- [x] 3.1 `web_runner/health_monitor.py` 加 `_send_health_notification()`:
      - 用现有 `SAU_SMTP_*` 配置 + `_send_smtp_email`
      - body 模板:账号名 / 平台 / 状态 / 重新登录链接(`/app/accounts?platform=X&action=login`)
- [x] 3.2 Webhook 复用 `web_runner/notifications.py` 的 `emit_event()`
- [x] 3.3 `web_runner/health_monitor.py:_should_notify()`:
      - 仅在 `old_health == 'valid' and new_health in ('expiring_soon', 'invalid')` 时通知
      - 24h 频率限制:DB 字段 `last_notified_at` 记录上次通知时间
- [x] 3.4 `.env.example` 加 `SAU_HEALTH_WEBHOOK_URL` 配置项(可选)
- [x] 3.5 `tests/test_health_monitor.py` 加 `TestSendHealthNotification`

## 4. 后端 — Health API (Web API)

- [x] 4.1 `web_runner/routes/account_groups.py` 加 `GET /api/account-authorizations/<id>/health`:
      - 返回 `{health, last_check_at, last_real_check_at, consecutive_failures, next_check_at}`
- [x] 4.2 `web_runner/routes/account_groups.py` 加 `POST /api/account-authorizations/<id>/health-check`:
      - 后台线程调 `cookie_auth()`,202 Accepted 立即返回
- [x] 4.3 `web_runner/routes/account_groups.py:GET /api/account-groups` 列表 API 加 `health` 字段
- [x] 4.4 `tests/test_account_health_api.py`(新建):
      - `test_get_health_endpoint`
      - `test_post_health_check_endpoint`

## 5. 前端 — AccountsPage 健康度 UI (Frontend)

- [x] 5.1 `sau_web/frontend/src/features/accounts/SortableAuthorizationItem.tsx` 加 `<HealthBadge health={auth.health} />`
- [x] 5.2 `HealthBadge` 组件(新建 `sau_web/frontend/src/features/accounts/HealthBadge.tsx`):
      - valid: 绿色 ● + "健康"
      - expiring_soon: 黄色 ● + "即将过期"
      - invalid: 红色 ● + "已失效"
      - unknown: 灰色 ● + "未检查"
- [x] 5.3 `sau_web/frontend/src/Pages/AccountsPage.tsx` 顶部加汇总:`健康 X/总计, 即将过期 Y, 已失效 Z, 未检查 W`
- [x] 5.4 单账号行加 "立即检查" 按钮 → `POST /api/account-authorizations/<id>/health-check`
- [x] 5.5 loading state:检查中显示 spinner
- [ ] 5.6 `tests/AccountsPage.test.tsx` 加 health badge 渲染 case + 立即检查按钮 case

## 6. 前端 — SettingsPage 通知设置 (Frontend)

- [x] 6.1 `sau_web/frontend/src/Pages/SettingsPage.tsx` 加 "账号健康度通知" section:
      - SettingsTab.tsx 已有完整 Switch 开关 + description；"测试通知"按钮待后续 PR 补充
- [x] 6.2 `sau_web/frontend/src/api/accounts.ts` + `client.ts` 加 `sendTestNotification(channel: 'email' | 'webhook')` API
- [x] 6.3 `web_runner/routes/notifications.py` 加 `POST /api/notifications/test-health` 测试通知端点
- [ ] 6.4 `tests/SettingsPage.test.tsx` 加通知设置渲染 case

## 7. 文档 (Docs)

- [ ] 7.1 `docs/install.md` 加 "健康度监控配置" section,说明 `SAU_HEALTH_WEBHOOK_URL` 等
- [ ] 7.2 `docs/web-shell.md` 加 "账号健康度" section,说明 badge 颜色含义
- [x] 7.3 `README.md` 加 "为什么我的 cookie 经常失效?" FAQ

## 8. 验证 (Verification)

- [ ] 8.1 `pytest tests/` 全绿
- [ ] 8.2 dev server 启动 → 看到 health monitor background task log
- [ ] 8.3 故意让某账号 cookie 失效 → 等 6h 或手动触发 `POST /api/accounts/<id>/health-check` → 邮件 + Webhook 收到通知
- [ ] 8.4 24h 内重复触发 → 只发 1 次通知
- [ ] 8.5 既有数据 migration:测试库加 1 个旧账号无 health 字段 → 启动后自动加 4 列,health = 'unknown'
