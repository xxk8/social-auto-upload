# Webhook 通知系统 — 设计文档（指针）

> 本设计已整理为正式的 OpenSpec change 并归档。**以归档后的 OpenSpec 为准**，避免两份文档分叉。

## 归档位置

- 归档 change：`openspec/changes/archive/2026-07-08-webhook-notifications/`
  - `proposal.md` — Why / What Changes / Capabilities / Impact / 10 条 Acceptance Criteria
  - `design.md` — 9 个 Decisions（D1-D9，含 file:line 证据 + 替代方案）
  - `tasks.md` — 8 个 Phase / 46 个任务
  - `specs/` — 4 个 capability（webhook-dispatch / notification-center-ui / notification-api / webhook-config），共 32 个 Gherkin Scenario

## 关键设计结论（速览）

- **事件唯一裁决点**：`web_runner/utils.py:_run_sau()` 的三类终态分支（成功 L554-557 / 失败 L558-570 / 异常 L571-589）挂 `emit_event`；`platform`/`account` 读 `tasks` 表（db.py:1088），不解析 argv。
- **cookie 过期独立通道**：由 `sau <platform> check`（cli/dispatchers.py:58-61）触发 `cookie.expired`，不混进上传结果。
- **SSE 复用**：通知中心实时推送复用现有 `_MAX_SSE_CONNECTIONS=5` / `upload_progress_sse` 范式（routes/upload.py:274），不新建 SSE server。
- **双方言建表**：`notifications` / `webhooks_config` 走 `web_runner/db.py:init_db()`，不写 Postgres-only 语法。
- **配置优先级**：`.env` 为只读 baseline，`PUT /api/webhooks/config` 写 DB 覆盖；`GET` 返回 secret 仅尾 4 位脱敏。
- **投递可靠性**：指数退避重试 3 次 → 死信（`final_failed` + 内部 `system.webhook_failed`）→ 幂等去重 → token-bucket 限流 + 失败聚合。
- **四平台签名**：飞书 HMAC-SHA256（body）、钉钉 HMAC-SHA256（URL query）、企微无签名（URL 即凭证）；强制 HTTPS + 防重放窗口。

## 你需要做的

只在 `.env` 填密钥即可：

```bash
SAU_FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
SAU_FEISHU_WEBHOOK_SECRET=xxxx
SAU_DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx
SAU_DINGTALK_WEBHOOK_SECRET=xxxx
SAU_WEWORK_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
SAU_WEBHOOK_AGG_WINDOW=60
```

实现阶段按 `specs/` 的 Scenario 逐条落地。
