## Context

上传任务状态变更当前只落库 + 写日志，运营者必须主动刷新 Web Shell / 查日志。本项目核心场景是批量、多账号并发发布（README「按账号名并发执行任务」），缺主动推送会导致失败错过重试窗口、团队无法同步进展。本 change 引入事件总线 + Webhook 分发 + 站内通知中心，把结果「被动查」变「主动推」。

设计已对齐代码现状，避免与原 doc 的偏差：
- 事件唯一裁决点在 `web_runner/utils.py:_run_sau()`（L542-589），不是凭空假设的钩子。
- SSE 复用 `web_runner/utils.py` 已有的 `_MAX_SSE_CONNECTIONS=5` / `_SSE_TIMEOUT_SECONDS=300` 与 `routes/*` 的 `text/event-stream`，不新建 SSE server。
- 存储走 `web_runner/db.py` 双方言抽象层（`insert_returning_id` / `json_dump` / dict 结果），不写 Postgres-only 语法。

## Goals / Non-Goals

### Goals
- 上传成功/失败、定时触发、cookie 过期四类事件主动推送
- 飞书/钉钉/企业微信/自定义 Webhook，含各平台签名与防重放
- 站内通知中心（SSE 实时推送 + 筛选 + 已读），复用现有 SSE
- 投递可靠：重试 + 死信 + 幂等去重 + 频率限制
- 配置按平台/账号维度路由，`.env` baseline + DB 覆盖
- 投递计入现有审计日志

### Non-Goals
- ❌ 不实现「自动重新登录」（反检测风险，留 v0.1）
- ❌ 不接短信 / 浏览器 push（飞书/钉钉/企微机器人足够）
- ❌ 不做多 server 实例协调（单进程足够）
- ❌ 不实现完整规则引擎 DSL（用 `(platform?, account?)` 路由表即可，复杂模板留 P3）

## Decisions

### D1: 事件唯一裁决点 = `_run_sau` 结果分支

**决策**: `emit_event` 挂在 `web_runner/utils.py:_run_sau()` 的 `returncode==0` 分支（L554-557）、非零分支（L558-570）、超时/异常分支（L571-589），复用已有的 `result` 判定与 `_parse_upload_result()`（utils.py:523）。

**理由**: 该处是 CLI 上传结果唯一落地处。`_run_sau(task_id, argv)` 的签名是 `(task_id, argv)`（utils.py:542），**不**直接收 `platform`/`account`；这两者从 `tasks` 表读取（`web_runner/db.py:1088` 的 `tasks` 表已有 `platform`/`account` 列，建任务时由 `utils.py:160` 写入），`platform` 也可从 `argv[0]` 解析（executor.py:202-206）。在此挂事件天然拿到成功/失败 + result JSON，无需另找钩子。

**关键约束**: `tasks` 表已含 `task_id/platform/account/status/error/result`（db.py:1088-1100），`emit_event` 直接读该表行，**不要**重复解析 argv 抽 account。`_run_sau` 的三类终态：`success`（returncode==0）、`failed`（非零）、`error`（超时/OSError/ValueError）→ 前两者发 `upload.*`，`error` 归一为 `upload.failed`。

**替代方案**: 在 executor 层包一层 —— 拒绝：`_run_sau` 已含结果判定，外层再判会重复解析 stdout。

### D2: 数据库双方言，走 `init_db()`

**决策**: `notifications` 表用 `AUTOINCREMENT` / `CURRENT_TIMESTAMP` 兼容写法，`delivered` / `final_failed` 用 0/1；在 `web_runner/db.py:init_db()` 中随首次启动建表，不新增独立迁移脚本。

**理由**: 项目 `db.py` 是双方言抽象层（SQLite + Postgres），`SERIAL` / `TIMESTAMP DEFAULT NOW()` 会让 SQLite 回退路径建表失败。JSON 列用 `TEXT` + `db.json_dump()`。

**替代方案**: Alembic —— 拒绝：项目无 alembic，两张简单加表不值得引入。

表结构：
```sql
CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,  -- pg 用 BIGSERIAL
    event_type   TEXT NOT NULL,
    task_id      TEXT,
    platform     TEXT,
    account      TEXT,
    title        TEXT,
    status       TEXT,
    error_msg    TEXT,
    payload      TEXT,                                -- JSON: 完整 UploadEvent，便于重投/排查
    webhook_url  TEXT,                                -- 脱敏后展示用，仅记录目标标识
    delivered    INTEGER NOT NULL DEFAULT 0,
    final_failed INTEGER NOT NULL DEFAULT 0,
    retry_count  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_task ON notifications(task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_delivered ON notifications(delivered);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(delivered, final_failed);
```

### D3: 配置来源与优先级（`.env` baseline + DB 覆盖）

**决策**: `.env` 的 `SAU_*_WEBHOOK_*` 为只读 baseline（进程启动读入）；页面 `PUT /api/webhooks/config` 写 DB 表 `webhooks_config` 并覆盖/合并 `.env`。

| 来源 | 读写 | 优先级 |
|---|---|---|
| `.env` | 只读，启动加载 | 低（baseline） |
| `webhooks_config` | 页面可读写 | 高（覆盖/合并） |

- 解析顺序：先 `.env` 默认值 → DB 非空字段覆盖。
- `GET /api/webhooks/config` 返回 secret 脱敏（`****1234` 仅尾 4 位）。

**理由**: `.env` 进程启动后不可改，页面配置若直接写 `.env` 会冲突；明确 DB 为真相源避免打架。

### D4: Webhook 配置按 `(platform?, account?)` 维度路由

**决策**: `webhooks_config` 存数组，每条含 `platform?` / `account?` / `url` / `secret` / `enabled`。路由规则：最具体匹配优先（account+platform > platform > 全局）。

**理由**: 多账号是项目标配，单一全局 Webhook 无法满足「抖音组 / 小红书组各自通知对应负责人」。从 P1 就支持，避免后期重构。

**替代方案**: 仅全局 URL —— 拒绝：MCN / 团队协作场景刚需按账号路由。

### D5: 各平台签名 + 防重放

**决策**:

| 平台 | 签名方式 | 关键参数 |
|---|---|---|
| 飞书 | `timestamp` + `sign = base64(HMAC-SHA256(key=timestamp+secret, msg=))` 拼到 JSON | `timestamp`（毫秒）、防重放窗口 ±3600s |
| 钉钉 | `timestamp`（毫秒）+ `sign = urlencode(HMAC-SHA256(key=secret, msg=timestamp+"\n"+secret))` 作为 query 参数 | 签名走 URL query，非 body |
| 企业微信 | 无需签名，URL 即凭证 | 保护 URL 不泄露 |

- 强制 HTTPS，禁止 http Webhook。
- `timestamp` 与服务器时间偏差超窗口直接拒发并记录。
- 分发失败（非 2xx / `errcode!=0`）按 D6 重试，不把平台错误原文回显前端。

**理由**: 签名算法是最容易实现错的地方，必须按官方规范，否则机器人收不到消息。

### D6: 投递可靠性 — 重试 + 死信 + 去重 + 频率限制

**决策**:
- 持久化到 `notifications` 表，异步 worker 消费，不阻塞事件总线。
- 失败指数退避（1s → 2s → 4s），最多 3 次；投递状态同事务更新 `delivered` / `delivered_at` / `retry_count`。
- 死信：3 次仍失败 → `final_failed=1` + 生成内部 `system.webhook_failed` 通知进通知中心（不向外发）。
- 幂等去重：写前按 `(task_id, event_type)` 去重，已 `delivered=1` 则跳过（防 executor 重试/并发重复推送）。
- 频率限制：token-bucket 默认 20 条/分钟/渠道 + 失败聚合（同窗口多条 `upload.failed` 合并为「近 1 分钟 N 个任务失败，涉及账号…」摘要卡片）。

**理由**: 批量发布高频触发，无去重/限流必刷屏；死信让运营者能在 Web Shell 看到「某渠道投递失败」而非静默丢失。

### D7: 通知中心 SSE 复用现有基础设施

**决策**: 通知中心实时推送复用 `web_runner/utils.py` 的 SSE helper + `_progress_subscribers` 订阅模式与连接数上限（`_MAX_SSE_CONNECTIONS=5`），不另起 SSE server。

**理由**: 现有 `routes/upload.py` / `accounts.py` / `ai.py` 已是 `text/event-stream` 端点；两套实现会瓜分 5 个连接配额。

### D8: `cookie.expired` 走独立通道（接 `check`）

**决策**: `cookie.expired` 事件由 `sau <platform> check --account <name>` 触发，不是 `_run_sau`。CLI 分发在 `cli/dispatchers.py:58-61`：`is_valid = await <platform>.check(args.account)`，有效打印 `valid`/exit 0，无效打印 `invalid`/exit 1。Web Shell 的 `POST /api/accounts/check` 走同一条 `check` 路径。

**理由**: `check` 判定登录态失效与「上传失败（可能因 cookie 失效）」是不同语义；`_run_sau` 拿不到 cookie 有效性信号，硬塞会混通道。独立 `cookie.expired` 让运营者明确知道「哪个账号要重新登录」。

**注意**: `cookie.expired` 的 `platform`/`account` 来自 `check` 的 `args.platform`/`args.account`（CLI 子命令首参即 platform，见 `cli/parser.py:234`），不需要读 `tasks` 表。

### D9: 审计接入

**决策**: 每次 `delivered=1` / `final_failed=1` 写入现有审计日志（参照 `routes/admin.py` 审计表 + `/app/admin/audit`），记录渠道 / event_type / task_id / 时间。

**理由**: 外发 Webhook 是敏感操作，需可回溯「为什么运营者收到某条通知」。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| Webhook 端点 5xx，通知丢失 | 指数退避重试 3 次 + 死信进通知中心 + logger.error |
| 批量发布刷屏 | token-bucket + 失败聚合（D6） |
| `(task_id,event_type)` 重复推送 | 写前幂等去重（D6） |
| 签名算法实现错，机器人收不到 | D5 按官方规范 + `POST /api/webhooks/test` 连通性验证 |
| 配置 `.env` 与 DB 打架 | D3 明确 DB 为真相源，`.env` 仅 baseline |
| secret 泄露 | 仅服务端存；`GET` 脱敏；审计不记 secret |
| 现有 SSE 连接配额被占用 | D7 复用同一套，不新增 server |
| 既有库无 `notifications` 表 | `init_db()` 建表 + try/except 容错，失败不阻止 server 启动 |

## Migration Plan

- **Phase 0** (Task 1): `notifications` + `webhooks_config` 两表建表（无外部行为变化）
- **Phase 1** (Task 2): `web_runner/notifications.py` 事件总线 + `emit_event` 挂 `_run_sau`
- **Phase 2** (Task 3): `WebhookDispatcher` + 飞书/钉钉适配器 + 重试/死信/去重/限流
- **Phase 3** (Task 4): Webhook API（`/api/webhooks/*` + `/api/notifications/*`）
- **Phase 4** (Task 5): 前端通知中心 UI + 复用 SSE + 按平台/账号路由配置
- **Phase 5** (Task 6): cookie 过期检测（接 `check`）+ 审计接入
- **Phase 6** (Task 7): 企微适配 + 自定义模板 + 规则引擎（P3）
- **Phase 7** (Task 8): 文档 + 验证

每 Phase 可独立 merge。

## Open Questions

- 规则引擎是否要支持正则匹配标题/错误？（留 P3，先用 `(platform?, account?)` 路由表）
- 失败聚合摘要的窗口（默认 1 分钟）是否可配？（默认做成 `SAU_WEBHOOK_AGG_WINDOW` 环境变量）
- 通知中心未读角标是否要进浏览器 Tab title？（默认做，沿用现有未读提示模式）
