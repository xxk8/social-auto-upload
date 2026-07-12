# webhook-callbacks

> **v1 生产级 Webhook**（Phase 4 上线）。**取代** Phase 3 的 [`notification-system`](../../../phase3-trust-and-monitoring/specs/notification-system/spec.md) — 不再维护两套并行实现。本 spec 拥有全部 webhook 路由（用户注册 + payload 规则 + 签名 + 重试 + 投递），`notification-system` 的 v0 入口（`POST /api/notifications/webhook`）在 Phase 4 落地后应下线或透明转发到本 spec 的统一入口（`POST /api/webhooks`）。
>
> **v0 → v1 迁移窗口**（PM/运维确认于 2026-07-12，**具体 Phase 4 上线日待 PM/运维二次确认**）：Phase 4 部署时执行一次性数据迁移（v0 `webhooks` 行 → v1 schema），旧 v0 路由 `POST /api/notifications/webhook` 自 **Phase 4 上线之日**（待 PM 排期确定时填入绝对日期）起保留为 **90-day alias**（v0 路由在 90 天 alias 期内继续接受写入并同步落到 v1 表，**Phase 4 上线后 90 天** v0 路由返回 `308 Permanent Redirect` + `Deprecation: true` + `Sunset: <Phase 4 上线日 + 180 天的绝对日期>` headers 引导到 v1 路由 `POST /api/webhooks` — 保留 POST method 语义，符合 RFC 7538 §3 (308 Permanent Redirect 保留 POST method 语义)；Deprecation: true header per `draft-ietf-httpapi-deprecation-header`；Sunset: <IMF-fixdate, e.g. `Sun, 06 Nov 2026 00:00:00 GMT` — RFC 7231 §7.1.1.1 格式> header per RFC 8594），**Phase 4 上线后 180 天 v0 路由返回 `410 Gone` 完整下线**（RFC 7231 §6.5.x (410 Gone) hard-stop 语义，客户端应停止调用）。详见 [`phase3-trust-and-monitoring/specs/notification-system/spec.md`](../../../phase3-trust-and-monitoring/specs/notification-system/spec.md) 顶部的 v0 弃用时间表。
>
> **监控需求**：7-day 滚动窗口监测 v0 路由请求量 < 1% 峰值，否则触发 P2 告警（提示延长 308 重定向窗口）。详见 [`docs/bug-tickets/test-app-bugfix-tickets-2026q3.md` §TBF-035](../../../../../docs/bug-tickets/test-app-bugfix-tickets-2026q3.md#tbf-035--v0v1-webhook-migration-monitoring-1-threshold--p2-alert)（v0→v1 webhook migration monitoring: 1% threshold + P2 alert）。

Webhook 配置 + 事件投递 + 签名 + 重试能力。

> **说明**：本 spec 覆盖 Phase 4 任务 38（webhook 表 + 配置路由 + 触发逻辑 + 签名重试），与 Phase 3 任务 34（通知系统）的 `notification-system` capability 是**面向用户**的注册配置层，本 spec 是**面向开发者**的 payload / 签名 / 重试机制层。两者配合：用户先通过 `notification-system` 注册 Webhook URL，后端按本 spec 的 payload / 签名规则投递。

## ADDED Requirements

### Requirement: Webhook 注册

The system SHALL allow users to register Webhooks with URL + event list + secret, and serve as the unified v1 superset of the Phase 3 notification-system capability.

#### Scenario: 创建 Webhook
- GIVEN 用户输入 URL + 事件列表（task.success / task.failed / approval.changed）+ secret
- WHEN 调用 `POST /api/webhooks`
- THEN 系统保存到 `webhooks` 表（schema 已就位）
- AND 返回 Webhook id

#### Scenario: 测试事件
- GIVEN 用户点击「测试事件」按钮
- WHEN 调用 `POST /api/webhooks/{id}/test`
- THEN 系统向该 URL 推送测试 payload
- AND 返回投递结果（status code + 延迟）

### Requirement: 事件触发投递

The system SHALL 在事件触发时按 `webhooks.events` 字段过滤后，向每个匹配 Webhook 推送 JSON payload。

#### Scenario: 任务完成事件
- GIVEN 任务从 running 转为 success
- WHEN 系统更新状态
- THEN 向所有订阅 `task.success` 的 Webhook URL 推送
- AND payload 包含 task_id / platform / url / timestamp

#### Scenario: 审批变更事件
- GIVEN 任务 approval_status 变化
- WHEN 系统更新状态
- THEN 向所有订阅 `approval.changed` 的 Webhook URL 推送
- AND payload 包含 task_id / from_status / to_status / actor_user_id

### Requirement: HMAC 签名

The system SHALL 在每个 payload 附带 HMAC-SHA256 签名，接收方可验证来源。

#### Scenario: 签名计算
- GIVEN 投递 Webhook 到 URL
- WHEN 系统生成 payload
- THEN 计算 `HMAC-SHA256(secret, timestamp + body)`
- AND 在 header `X-SAU-Signature: <hex>` 中返回
- AND header `X-SAU-Timestamp: <unix_ts>` 携带时间戳

#### Scenario: 接收方验签
- GIVEN 接收方收到 payload
- WHEN 验签
- THEN 接收方按相同算法计算签名
- AND 时间戳与当前时间差 ≤ 5 分钟（防重放）
- AND 签名一致则接受

### Requirement: 持久化重试

The system SHALL 在投递失败时按指数退避重试最多 5 次，结果持久化到 `webhook_deliveries` 表。

#### Scenario: 重试退避
- GIVEN 投递返回 5xx / 超时
- WHEN 系统记录失败
- THEN 投递入 `webhook_deliveries` 重试队列
- AND 间隔 1min / 5min / 30min / 2h / 12h
- AND 5 次后转 dead letter

#### Scenario: 4xx 不重试
- GIVEN 投递返回 4xx
- WHEN 系统记录失败
- THEN 标记永久失败
- AND 不重试

#### Scenario: 进程重启不丢
- GIVEN 重试队列中存在 pending 投递
- WHEN 进程重启
- THEN 下次启动后 worker 重新拉起
- AND 继续按重试计划执行
