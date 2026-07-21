## Why

Phase 1-3 让单人/单团队运营"快、多、好"。Phase 4 把产品**开门**：让外部工具能调用（REST API）、让内部流程有人审（审批流）、让结果能被监听（Webhook 回调）。

这是父 umbrella 路线图中的"远期 Phase"，定位商业化前置。本子变更聚焦三项最基础能力，刻意不做 SaaS 化计费、不做多角色权限、不做复杂组织模型。

## What Changes

落地三个 capability：

- **`approval-workflow`**：任务级审批状态（pending / approved / rejected）+ owner 审批 / 驳回 + 留痕
- **`rest-api-open`**：API Key 鉴权 + 开放 `/api/v1/publish` + `/api/v1/tasks/{id}` + OpenAPI 文档
- **`webhook-callbacks`**：用户可注册任意 URL + 任务完成 / 失败时主动推送 + HMAC 签名 + DB 持久重试

## Capabilities

- 新增 `approval-workflow`
- 新增 `rest-api-open`
- 新增 `webhook-callbacks`

## Impact

- **Web API**：扩展 `web_runner/routes/tasks.py`（approve / reject 路由已部分就位，需补全 UI 状态映射）；新增 `web_runner/routes/api_v1.py`（v1 端点已部分就位，需补全鉴权）；新增 `web_runner/routes/webhooks.py`（配置 + 触发 + 重试）
- **DB**：复用已就位的 `api_keys` + `webhooks` + `webhook_deliveries` + `tasks.approval_status` 字段
- **Frontend**：`TasksPage` 新增审批操作列 + Webhook 配置子页面

## Layer

- API: `web_runner/routes/api_v1.py` · `web_runner/routes/webhooks.py` · `web_runner/routes/tasks.py`
- DB: `web_runner/db.py`（schema 已就位）
- Auth: API Key 鉴权（新增中间件）
- Frontend: `src/Pages/TasksPage.tsx`（审批操作列）

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- design.md: [`design.md`](design.md)
- 复用现有 schema: `api_keys` · `webhooks` · `webhook_deliveries` · `tasks.approval_status`
