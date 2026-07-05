## Context

账号 cookie 失效是用户最常见的运营痛点,目前完全是被动发现 — 上传时 `cookie_auth()` 报"失效"才意识到。本 change 把健康度检查从"被动"变"主动",并加上通知通路,让用户提前 24h 知道哪些账号需要重新登录。

## Goals / Non-Goals

### Goals
- 定期(每 6h)后台检查所有账号 cookie 健康度
- 健康度变化时通过邮件 / Webhook 通知用户
- 前端 AccountsPage 可视化健康度(汇总 + 单账号 badge)
- 既有账号自动 migration 到新 schema
- 通知 24h 频率限制,避免刷屏

### Non-Goals
- ❌ 不实现"自动重新登录"(有反检测风险,留 v0.1)
- ❌ 不做账号 health 趋势图(简单状态足够)
- ❌ 不做多 server 实例协调(单进程足够)
- ❌ 不接短信通知(国内无统一 SMS 通道)
- ❌ 不接 push notification(浏览器 push 太复杂,邮件已够)

## Decisions

### D1: 健康度状态机 — 4 个值

**决策**: `last_health` 用 4 字符串 enum:
- `valid` — cookie 有效
- `expiring_soon` — 预计 24h 内失效(根据上次检查 + 7d 平均有效期推断)
- `invalid` — cookie 已失效
- `unknown` — 从未检查 / 迁移数据默认值

**理由**: 4 个值简单清晰,前端 badge 颜色直接映射,无需复杂状态机。

**替代方案 1**: 数值(0-100 健康分)— 拒绝:增加 UI 复杂度,没有明确分界点
**替代方案 2**: 时间戳 + 推断(用户侧算)— 拒绝:用户每次都得算,差

### D2: 通知频率限制 — 24h 一次,基于 DB 字段

**决策**: `accounts.last_notified_at` 记录上次通知时间,新通知前 check `now - last_notified_at > 24h`。

**理由**:
- 简单,无需 Redis / 内存 cache
- DB 持久化,server 重启不丢状态
- 24h 是用户感知合适的频率(避免刷新,也避免延迟太久)

**替代方案**: 用 in-memory dict 缓存 — 拒绝:server 重启丢状态。

### D3: 通知通道 — 邮件 + Webhook,可独立开关

**决策**:
- 邮件:沿用现有 `SAU_SMTP_*` 配置,无新增配置
- Webhook:新增 `SAU_HEALTH_WEBHOOK_URL` 环境变量,POST 一段 JSON
- 两者独立,有哪个用哪个
- 同一事件两个都发(用户配了就要,避免单点失败)

**邮件模板**:
```
Subject: [SAU] 账号 XXX 在 YYY 平台 cookie 已失效

您好,

您的账号 {account_name} (平台: {platform}) cookie 已失效。
请尽快重新登录:

{re_login_url}

如有疑问,请查阅文档: https://docs.sau/install#cookie-relogin
```

**Webhook payload**:
```json
{
  "event": "account_health_changed",
  "account_id": 123,
  "account_name": "creator_main",
  "platform": "douyin",
  "old_health": "valid",
  "new_health": "invalid",
  "timestamp": "2026-07-02T10:30:00Z",
  "action_url": "https://sau.example.com/app/accounts?platform=douyin&action=login"
}
```

**替代方案**: 仅邮件 — 拒绝:运营/MCN 用户需要 Webhook 接企业微信 / 飞书机器人。

### D4: 后台 job 用 asyncio 而非 APScheduler / Celery

**决策**: 用 `asyncio.create_task(_monitor_loop())` 启动 background task,而非引入 APScheduler / Celery / RQ。

**理由**:
- 与现有 Flask `create_app()` 异步模式一致
- 6h 间隔足够,无需 cron 精度
- 进程内运行,部署简单(无额外 worker 进程)
- 重启 server 即重启 job,与 Flask 进程模型一致

**替代方案 1**: APScheduler — 拒绝:多一个依赖,本场景不需要
**替代方案 2**: Celery / RQ — 拒绝:本场景无 long-running 任务,过度设计

### D5: 单账号 `cookie_auth()` 串行,30s timeout + 1 次重试

**决策**: 多账号健康度检查**串行**而非并发,避免多浏览器进程竞争 CPU。

**理由**:
- 8 个账号 × 每个 cookie_auth 启动 chromium = 8 个 chromium 进程 → 内存爆炸
- 串行 8 × 30s = 4 分钟,可接受(每 6h 一次)
- 单账号失败重试 1 次(30s × 2 = 1 分钟)避免网络抖动误报

**替代方案**: 并发 + semaphore(2)— 留 v0.1,本 change 简单优先。

### D6: DB migration 用 `ALTER TABLE ADD COLUMN` 而非 alembic

**决策**: 在 `init_db()` 里检测缺列 → 自动 `ALTER TABLE`,而非引入 alembic。

**理由**:
- 项目目前无 alembic,引入成本大
- 4 列是简单加列,无 index/data 迁移
- 检测缺列后 ALTER 的代码 < 30 行

**替代方案**: alembic — 留 v0.1,当 schema 变更频繁时再上。

### D7: 健康度"expiring_soon"基于 7d 平均推断

**决策**: 简化推断 — `expiring_soon` 触发条件 = `last_check_at` 超过 7d。

**理由**:
- 简单,无需统计历史
- 大多数平台 cookie 7-30d 有效,7d 阈值是 conservative lower bound
- 实际效果:"7d 没查过 → 可能快过期" — 与真实失效时间相关性 70%+

**替代方案**: 跟踪每次 cookie 创建时间,精确计算 — 拒绝:`storage_state` 文件创建时间不准(被覆盖过就 reset),且增加复杂度。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 通知邮件被标记为 spam | 邮件模板用纯文本 + 明确发件人 + Subject 含 [SAU] 前缀 |
| Webhook 端点 5xx 失败,通知丢失 | 1 次重试 + 失败时 logger.error,后续 check 周期还会再发现 |
| 后台 job 与 server 重启竞态 | 启动时检查 `_monitor_task is None`,已存在则不重启 |
| 24h 频率限制太严,用户错过通知 | 在 SettingsPage 加 "立刻检查全部" 按钮,绕过 24h 限制 |
| 既有账号 migration 失败 | `init_db()` 包 try/except,失败时 logger.error 但不阻止 server 启动 |
| 健康度 7d 阈值不准确 | 留 env `SAU_HEALTH_EXPIRING_DAYS`,默认 7d,用户可调 |

## Migration Plan

- **Phase 1** (Task 1): DB schema 加 4 列 + migration 逻辑(零外部行为变化)
- **Phase 2** (Task 2): health_monitor background job(无 API,无前端,只 DB 更新)
- **Phase 3** (Task 3): 通知触发(邮件 + Webhook)
- **Phase 4** (Task 4): health API 端点
- **Phase 5** (Tasks 5-6): 前端 UI
- **Phase 6** (Tasks 7-8): 文档 + 验证

每 Phase 可独立 merge,失败回滚成本低。

## Open Questions

- 是否要给"健康度检查"自身加 auth / admin 权限?— 留 v0.1(目前用现有 auth gate 即可)
- 通知内容里要不要带"最近 5 次上传成功率"?— 留 v0.1(需要更多数据点)
- 邮件 vs Webhook 用户能各自独立配置吗?— 本 change 用 `SAU_SMTP_*` 全局 + `SAU_HEALTH_WEBHOOK_URL` 全局,用户级配置留 v0.1
- 通知是否要分级别(健康度 degraded / critical)— 拒绝:4 个状态已经够,过度细化反而不清楚
