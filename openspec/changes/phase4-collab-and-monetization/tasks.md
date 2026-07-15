## Phase 4 — 协作 + 商业化

> 本子变更从父 umbrella `product-roadmap-2026q3` 摘录任务 36-38。共 13 个 checkbox。

### 36. 审批流（Web API + Frontend）

[x] 36.1 tasks 表新增 `approval_status` 字段（pending/approved/rejected） *(schema 已就位)*
[x] 36.2 实现 `POST /api/tasks/{id}/approve` 审批路由
[x] 36.3 实现 `POST /api/tasks/{id}/reject` 驳回路由（附修改意见）
[x] 36.4 TasksPage 新增审批状态列 + 审批操作按钮
[x] 36.5 实现审批通知（站内消息或邮件）

### 37. REST API 开放（Web API）

[x] 37.1 实现 API Key 管理（创建/吊销/列表）
[x] 37.2 实现 `POST /api/v1/publish` 开放发布接口（API Key 鉴权）
[x] 37.3 实现 `GET /api/v1/tasks/{id}` 开放任务查询接口
[x] 37.4 编写 API 文档（OpenAPI/Swagger）

### 38. Webhook 回调（Web API）

[x] 38.1 新增 `webhooks` 表（url/events/secret） *(schema 已就位)*
[x] 38.2 实现 `POST /api/webhooks` 创建 Webhook
[x] 38.3 实现发布完成/失败时的 Webhook 触发逻辑
[x] 38.4 实现 Webhook 签名验证 + 重试机制
