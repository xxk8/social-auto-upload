# notification-system

> **v0 轻量级 Webhook 通知**（Phase 3 上线）。提供用户注册 URL + 任务事件触发 + 内存队列重试 3 次。**生产环境推荐改用** [`webhook-callbacks`](../../../phase4-collab-and-monetization/specs/webhook-callbacks/spec.md)（Phase 4 上线，DB 持久化队列 + 5 次重试 + HMAC 签名 + 测试事件）。
>
> **v0 弃用时间表**（PM/运维确认于 2026-07-12，**具体 Phase 4 上线日待 PM/运维二次确认**）：
> - **90-day alias 期**：自 **Phase 4 上线之日**（待 PM 排期确定时填入绝对日期）起，v0 路由 `POST /api/notifications/webhook` 继续接受写入，同步落到 v0 / v1 表
> - **Phase 4 上线后 90 天**：v0 路由返回 `308 Permanent Redirect` + `Deprecation: true` + `Sunset: <Phase 4 上线日 + 180 天的绝对日期>` headers 引导到 v1 路由 `POST /api/webhooks`（保留 POST method 语义，符合 RFC 7538 §3 (308 Permanent Redirect 保留 POST method 语义)；Deprecation: true header per `draft-ietf-httpapi-deprecation-header`；Sunset: <IMF-fixdate, e.g. `Sun, 06 Nov 2026 00:00:00 GMT` — RFC 7231 §7.1.1.1 格式> header per RFC 8594）
> - **Phase 4 上线后 180 天**：v0 路由返回 `410 Gone` 完整下线（RFC 7231 §6.5.x (410 Gone) hard-stop 语义）
>
> 详细迁移机制见 [`webhook-callbacks`](../../../phase4-collab-and-monetization/specs/webhook-callbacks/spec.md) 顶部 v0 → v1 迁移窗口段。

任务完成 / 失败时的 Webhook 通知能力。

## ADDED Requirements

### Requirement: Webhook 配置

The system SHALL 用户应能注册任意 Webhook URL，订阅特定事件（任务完成 / 任务失败 / 审批通过等）。

#### Scenario: 注册 Webhook
- GIVEN 用户输入 URL + 选择事件类型
- WHEN 调用 `POST /api/notifications/webhook`
- THEN 系统保存到 `webhooks` 表（schema 已就位）
- AND 返回 Webhook 详情

#### Scenario: 查询 Webhook 列表
- GIVEN 用户请求 Webhook 列表
- WHEN 调用 `GET /api/notifications/webhooks`
- THEN 返回该用户所有 Webhook

### Requirement: 事件触发

The system SHALL 在事件发生时主动 POST 到订阅该事件的 Webhook URL。

#### Scenario: 任务完成触发通知
- GIVEN 任务从 running 转为 success
- WHEN 系统更新任务状态
- THEN 系统向订阅 `task.success` 事件的 Webhook URL 推送 JSON payload
- AND 包含 task_id / platform / url / timestamp

#### Scenario: 任务失败触发通知
- GIVEN 任务从 running 转为 failed
- WHEN 系统更新任务状态
- THEN 系统向订阅 `task.failed` 事件的 Webhook URL 推送 JSON payload
- AND 包含 task_id / error_message / timestamp

### Requirement: 重试机制

The system SHALL 在 Webhook 投递失败时按指数退避重试最多 5 次。

#### Scenario: 重试退避
- GIVEN Webhook 首次投递返回 5xx 或超时
- WHEN 系统记录失败
- THEN 投递进入 `webhook_deliveries` 重试队列
- AND 重试间隔 1min / 5min / 30min / 2h / 12h（指数退避）
- AND 5 次失败后转 dead letter + 告警日志

#### Scenario: 4xx 不重试
- GIVEN Webhook 首次投递返回 4xx
- WHEN 系统记录失败
- THEN 不进入重试队列
- AND 标记为永久失败 + 告警日志
