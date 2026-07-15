## Context

Phase 4 是产品路线图的"开门"阶段：让外部工具能调用 + 让内部流程有人审 + 让结果能被监听。父 umbrella `product-roadmap-2026q3` 把这一 Phase 命名为"协作 + 商业化"，定位远期但单点能力已具备。

继承自父 umbrella 的关键技术决策（保留不变）：

- API Key 鉴权：DB 存储 key + 用户绑定
- Webhook 签名：HMAC-SHA256 + 时间戳防重放
- 审批流：复用 `tasks.approval_status` 字段（DB schema 已就位）

## Goals / Non-Goals

**Goals:**

- 第三方系统可通过 API Key 触发发布 + 查询任务状态
- 任务完成 / 失败可通过 Webhook 主动推送到任意 URL
- 内部审批流可被 UI 触发并留下记录

**Non-Goals:**

- 不实现 SaaS 化计费（v1 范围之外）
- 不实现 SSO（API Key 已满足外部接入）
- 不实现复杂权限模型（v1 仅 owner / editor 二级）

## Decisions

### 1. API Key：与用户绑定 + 作用域粒度

**决定**: 每个 API Key 绑定一个 user_id，作用域（scope）字段限定可调用的端点（`publish:read` / `publish:write` 等）。

**理由**: 粒度足够区分只读 vs 写权限；避免引入 OAuth 复杂度。

### 2. 审批流：v1 仅 owner 可审批

**决定**: 任务创建者默认为 owner，v1 不实现多级审批 / 角色矩阵；仅 owner 可 approve / reject。

**理由**: 满足"留痕"基本诉求；多级审批可后续扩展。

### 3. Webhook 重试：DB 持久队列

**决定**: Webhook 投递失败入 `webhook_deliveries` 表（status + retry_count + last_error），后台 worker 按指数退避重试，最多 5 次。

**理由**: 通知是商业化关键路径（用户付费集成），丢失不可接受；DB 持久化保进程重启不丢。

### 4. API 文档：OpenAPI 自动生成

**决定**: `/api/v1/openapi.json` 自动从 Flask 路由反射生成；UI 可选 Swagger UI（v1 仅 JSON）。

**理由**: 自动化优先；文档与代码同步，避免漂移。

## Risks / Trade-offs

- **API Key 泄漏** → 用户可吊销；建议接入方定期轮换
- **Webhook 目标服务宕机** → 持久重试队列，5 次后转 dead letter
- **审批绕过** → owner 校验 + 操作日志

## Open Questions

- 是否需要在 v1 引入"组织"概念以支持多 owner？（v1 暂不支持）
- Webhook 是否提供"测试事件"端点（无需真实任务）？v1 暂不提供

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- 兄弟子变更: [`phase1-content-publish-loop`](../../phase1-content-publish-loop/) · [`phase2a-publish-intelligence`](../../phase2a-publish-intelligence/) · [`phase2b-media-production`](../../phase2b-media-production/) · [`phase3-trust-and-monitoring`](../../phase3-trust-and-monitoring/)
- 复用现有 schema: `tasks.approval_status`（已就位）· `api_keys` 表（已就位）· `webhooks` 表（已就位）
- 复用现有模块: `web_runner/routes/api_v1.py`（v1 endpoint 已就位）· `web_runner/routes/tasks.py`（审批 route 已就位）
