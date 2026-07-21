# Web Shell 可视化界面

social-auto-upload 提供了统一的前端 Vite 应用，同时承载两个使用面：

- **官网首页（默认访问 `http://localhost:5180/`）** — React + Vite 的营销站内容，面向公众，介绍项目能力、平台、CLI / Web / Agent Skill 一套三连。**不需要登录**。
- **Web Shell 运营台（`http://localhost:5180/app`）** — React + Flask 封装的 CLI 图控台。账号分组、批量发布、任务列表、运行日志、AI 生成。**需要邮箱验证码登录**。

历史架构中独立部署的面向官网的 `sau_web/site/` +(端口 `:5174`) React app 已合并进同 Vite 产物，唯一前端路径现在是 `sau_web/frontend/`。

`bash sau_web/start.sh` 同时拉起唯一前端 + Flask 后端。

## 页面功能

| 页面 | 路由 | 认证 | 功能 |
|---|---|---|---|
| 官网首页 | `/` | 公开 | 营销站首页 · Hero / Platforms / Features / CTA |
| 账号管理 | `/app` | AuthGuard | 查看已保存账号、筛选平台、登录新账号、删除账号；查看账号健康状态与汇总 |
| 发布中心 | `/dashboard/publish` | AuthGuard | 视频/图文表单提交，选择平台和账号，设置定时发布 |
| 运行日志 | `/dashboard/logs` | AuthGuard | 日志查看、过滤、关键字搜索、导出 |
| 任务列表 | `/dashboard/tasks` | AuthGuard | 任务状态追踪、轮询更新、筛选排序 |
| 组件目录 | `/catalog` | 公开 | 设计走查 · 设计师可在不登录的情况下浏览 9 个组件 demo |

## 账号健康监控

账号管理页面（`/app`）会展示每个授权账号的 cookie 健康状态，并在页面顶部显示健康汇总。

### 健康状态说明

| 状态 | 标签 | 含义 |
|---|---|---|
| `valid` | 健康 | cookie 文件有效，且最近一次真实浏览器校验通过 |
| `expiring_soon` | 即将过期 | cookie 文件 mtime 超过 24 小时（可调 `SAU_COOKIE_STALE_HOURS`，默认 24）未刷新，或最近一次真实检查已超过 7 天（可调 `SAU_HEALTH_EXPIRING_DAYS`，默认 7） |
| `invalid` | 已失效 | cookie 文件缺失/损坏，或真实浏览器校验失败 |
| `unknown` | 未检查 | 授权刚创建，尚未完成首次健康检查 |

### 页面交互

- **健康汇总**：页面顶部显示「健康 / 即将过期 / 已失效 / 未检查」的数量统计，方便一眼定位问题账号。
- **健康徽章**：每个授权卡片上有一个彩色状态徽章，对应上表四种状态。
- **立即检查**：每个授权卡片提供「立即检查」按钮，点击后后端会启动一个后台线程执行真实浏览器校验，前端自动刷新列表查看最新状态。
- **一键检测**：页面右上角的「一键检测」按钮会触发对所有账号的批量检查。

### 后台检查策略

- 后台 daemon 默认每 6 小时（`SAU_HEALTH_MONITOR_INTERVAL=21600` 秒）对所有账号串行检查一次。
- 每次检查都会做轻量的文件级 quick check。
- 真实的浏览器校验默认每 24 小时（`SAU_HEALTH_REAL_CHECK_INTERVAL=86400` 秒）才执行一次，避免频繁启动 Chromium 消耗资源。
- 检查频率、最大重试、超时与 stale 阈值均可通过环境变量调整；默认 / 范围 / 调优位置见 [`docs/install.md`](docs/install.md) §11「账号健康监控」与环境变量表。

### 告警通知

当账号健康状态从 `valid` 降级为 `expiring_soon` 或 `invalid` 时，系统会：

1. 触发 `cookie.expiring_soon` / `cookie.expired` 事件，通过通知工人投递 webhook / 站内通知。
2. 向该账号分组**所有者**的邮箱发送告警邮件（同一账号 24 小时内只通知一次）。

通知按 `account_groups.owner_user_id` 路由：

- 每个账号分组在创建时自动记录当前登录用户为所有者。
- 健康告警使用所有者个人的通知偏好（`notify_health_email`、`notify_health_webhook`），可在 Web Shell 的「设置 → 健康告警通知」中开关。
- 若分组没有所有者（历史数据或关闭登录的部署）：
  - 邮件发送会依次回退到第一个管理员、第一个用户。
  - 通知偏好（是否发邮件 / webhook）直接读取第一个用户的 `notify_health_email` / `notify_health_webhook`。
- 升级后首次启动时，`init_db()` 会自动把历史分组的所有者回填为数据库中第一个用户（仅在 `users` 表非空时执行，一次性迁移）。
- 通知通道 env vars 以 [`docs/install.md` §11 环境变量表](install.md#11-账号健康监控account-health-monitoring) 中的 4 个 `SAU_*_WEBHOOK_URL` / 兑底 `SAU_WEBHOOK_URL` + `SAU_SMTP_*` 为准；频道未设该频道不发。openspec 中领会的独立 `SAU_HEALTH_WEBHOOK_URL` 未生效，仅为 reserved 提示。

## API 接口

| 方法 | 路径 | 状态 | 说明 |
|---|---|---|---|
| GET | `/api/accounts` | 200 | 列出已保存账号 |
| POST | `/api/accounts/login` | 200 | 触发账号登录 |
| POST | `/api/accounts/check` | 200 | 检查单个账号 Cookie 有效性 |
| POST | `/api/accounts/check-all` | 200 | 批量检查所有账号 Cookie |
| POST | `/api/accounts/delete` | 200 | 删除已保存账号 |
| POST | `/api/upload/video` | **202** | 视频上传（headless、抖音商品、B站 tid、视频号短标题/分类/草稿）— 火象忽略 |
| POST | `/api/upload/note` | **202** | 图文上传（JSON data URI + multipart 两种）— 火象忽略 |
| GET | `/api/tasks` | 200 | 任务状态列表；支持 `?task_id=X` 单任务查询 |
| POST | `/api/tasks/add` | **202** | 手动添加任务 — 火象忽略 |
| POST | `/api/tasks/retry` | **202** | 重试失败/异常任务 — 火象忽略 |
| POST | `/api/tasks/reschedule` | **202** | 重新调度待处理任务 — 火象忽略 |
| POST | `/api/tasks/copy` | **202** | 复制任务到新调度时间 — 火象忽略 |
| GET | `/api/logs` | 200 | 运行日志（支持 after / task_id 过滤） |
| GET | `/api/account-authorizations/<id>/health` | 200 | 查询单个账号授权的健康状态 |
| POST | `/api/account-authorizations/<id>/health-check` | **202** | 手动触发单个账号授权的健康检查 |
| GET | `/health` | 200 | 健康检查 |

### 火象忽略 契约（202 Accepted + Location + Retry-After）

`/api/upload/*` + `/api/tasks/{add,retry,reschedule,copy}` 走的是**“后台队列执行”**语义，不是“同步执行”语义。返响应是 202 + 以下内容：

```http
HTTP/1.1 202 Accepted
Location: /api/tasks?task_id=upload-video-123456-abcdef
Retry-After: 2

{
  "success": true,
  "data": { "task_id": "upload-video-123456-abcdef", "status": "pending" }
}
```

* **202 + Location** 意味着“服务端已接受 + 已入队 + 可轮询” 。上传是入库后才返 响应，所以**关掉浏览器 tab 不会丢任务** — 文件在入库前就可能未完整到服务端，这是浏览器/TCP 原生限制，不在 202 合约覆盖范围（需要 resumable upload）。
* **轮询 `Location` 指向的 URL** 可以获取该任务的最新状态 — 与 TasksPage 已有的 `useTasks`（3s 轮询）路径一致，不需要额外前端改造。
* **后端重启后所有 `status='pending'` 任务会被 `PlatformExecutor.load_pending_tasks` 重新入队**（不仅限于 `scheduled_at IS NOT NULL`）— 避免重启丢任务。
* `reschedule` / `copy` 返回体里仍会带上 `scheduled_at`（与重写前一致），避免前端需要额外取一次。

### Idempotency-Key 契约（防止 tab 关闭后重试重复发布）

`/api/upload/video` + `/api/upload/note` + `/api/tasks/{add,retry,reschedule,copy}` 这 6 个生成任务的路由同时支持 **Stripe 风格的 `Idempotency-Key` 协议**。使用场景：用户点击“发布”后 tab 被关闭（网络断、浏览器崩溃、手动关闭），重新打开重试时，**不重复发布**。

#### 客户端使用

前端 `sau_web/frontend/src/api/_idempotencyStore.ts` 自动为这 6 个 POST 请求拦截 + 注入 `Idempotency-Key` header：

* UUID **不需开发者手动生成** — 拦截器以 `(user_id, route)` 为名，调用请求时从 `localStorage` 读取或生成一个新的 UUID。
* UUID **会跨 tab 关闭持久化** — 存在 `localStorage`（不是 `sessionStorage`），TTL 7 天，匹配后端缓存 TTL。
* 请求成功后（2xx）`localStorage` 项被清除 — 下一次“主动重发同一个内容”会拿一个新的 UUID，不会触发 422 误报。

```http
POST /api/upload/video HTTP/1.1
Content-Type: multipart/form-data
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

<file>...
```

#### 后端响应

首次请求：

```http
HTTP/1.1 202 Accepted
Location: /api/tasks?task_id=upload-video-123456-abcdef
Retry-After: 2

{ "success": true, "data": { "task_id": "upload-video-123456-abcdef", "status": "pending" } }
```

重复请求（**同 key + 同 payload**）：

```http
HTTP/1.1 202 Accepted
Location: /api/tasks?task_id=upload-video-123456-abcdef    ← 同一个 task_id
Retry-After: 2
Idempotency-Replayed: true                                 ← 表明这是重放，不是新提交

<原姈的 202 body>
```

#### 5 个合约场景（全部已锁定）

| 场景 | 客户端发送 | 后端响应 |
|---|---|---|
| **首次提交** | `Idempotency-Key: <new-uuid>` | 202 + Location + Retry-After（入库后返） |
| **重放**（同 key + 同 payload） | `Idempotency-Key: <same-uuid>` + 同表单内容 | 202 + `Idempotency-Replayed: true` + 同一个 `task_id` |
| **并发重试**（同 key，第一个仍在处理中） | `Idempotency-Key: <same-uuid>` | **409 Conflict** + `Retry-After: 5` |
| **key 被重复用于不同 payload**（client bug） | `Idempotency-Key: <same-uuid>` + 不同表单内容 | **422 Unprocessable Entity** |
| **未提供 key** | （无 header） | 202 + 正常 — 6 个路由不强制要求 key，未加 key 的客户端与未加 idempotency 的原 client 100% 兼容（4xx 响应、错误码、错误消息都保持原样，不引入任何行为变化） |

#### 测试覆盖（13 个测试锁住上面 5 个场景 + 底层 helper）

**端到端（`tests/test_idempotency_contract.py`，走真实 `create_app()` + Flask test client + PG）：**

* `test_no_key_header_passes_through_normally` — **场景 5**：无 `Idempotency-Key` → 202 透传，不进 `claim`/`lookup`。
* `test_2xx_replay_returns_cached_with_marker` — **场景 2（重放）** + 顺带锁定 **场景 1（首次提交）**：同 key + 同 payload → 第二次返 202 + `Idempotency-Replayed: true` + **同一个 `task_id`** + **同一个 `Location`**。最强 pin：`SELECT COUNT(*) FROM tasks WHERE task_id=...` 必须为 1（replay 不能插第二条任务行）。本测试的第一次请求也覆盖了 **场景 1**：resp1 是 202 + `Location: /api/tasks?task_id=<id>` + 无 `Idempotency-Replayed` 标记。
* `test_409_on_concurrent_retry_with_same_key` — **场景 3（并发重试）**：预填一个 `state='processing'` 的行 + monkeypatch `payload_hash` 让 hash 匹配 → 第二次返 409 + `Retry-After: 5` + `Idempotency-Replayed` **不能**出现（以防未来 refactor 误把 409 走 replay 路径）。
* `test_422_on_key_with_different_payload` — **场景 4（key + 不同 payload）**：预填一个 `state='completed'` 的行 + monkeypatch `payload_hash` 让 hash 不匹配 → 第二次返 422 + 消息含 `different payload`。

**Helper 层（同文件，锁住 `web_runner/idempotency.py` 的 6 个核心函数）：**

* `test_payload_hash_deterministic_for_same_parts` + `test_payload_hash_includes_file_metadata` — `payload_hash()`：同 parts → 同 hash；不同 file_name/size/mime → 不同 hash。
* `test_lookup_returns_none_for_unknown_key` — `lookup()`：未见过 → `None`。
* `test_claim_succeeds_then_lookup_returns_processing` — `claim()` + `lookup()` 链：首次 claim 返 `True`；lookup 看到 `state='processing'` → `("inflight-409", None)`。
* `test_claim_conflict_returns_false_on_second_call` — 同一 key 的第二次 `claim()` 返 `False`（ON CONFLICT DO NOTHING）。
* `test_complete_promotes_to_replay` — `complete()` 后 lookup 返 `("replay", cached)`。
* `test_mismatch_returns_422` — 同 key + 不同 hash → `lookup()` 返 `("conflict-422", None)`。
* `test_release_removes_processing_row` — `release()` 后 lookup 返 `None`。
* `test_cleanup_expired_deletes_past_rows` — janitor sweep：手动将 `expires_at` 调为过去时间，`cleanup_expired()` 删除 ≥ 1 行。

**运行测试**：`DATABASE_URL=postgres://... .venv/bin/python -m pytest tests/test_idempotency_contract.py -v`（需要本地 PG；无 `DATABASE_URL` 时整文件 skip）。

**相关资源（openspec 交叉链接）**：

* **`openspec/changes/idem-keys/tasks.md`** — 本 round 的完整任务清单（`mergeable` 状态，45 个 `[x]` 项），包含 7 个 section（DB schema / helper module / 6 routes / frontend / tests / docs / hotfixes），便于 reviewer 一行跳到任何子任务的源码位置。
* **`openspec/changes/idem-keys/`** — 后续可放的 `design.md` / `specs/` / `proposal.md`（目前仅 `tasks.md`，需要的 round 可以补上）。

#### 存储与 TTL

* 后端缓存存储在 PostgreSQL 表 `idempotency_keys`（复合主键 `user_id + route + key`）。`payload_hash` 是 route-specific 签名（上传为 platform+account+title+file_name+file_size+file_mime；JSON 路由为 `json.dumps(body, sort_keys=True)`）。**不哈希文件内容**（200MB 哈希太昂贵）。
* TTL 为 **7 天** — 不心用户“周末忘了重试”的场景，DB 行本身就是轻量存储。
* 7 天后由 `idempotency_keys_expires` partial index 覆盖的 janitor 扫描删除（跟 `_cleanup_old_uploads` 在同一个 sweep 点调用）。

#### 5xx 语义（round-OPT-idem-keys 必需知道的 trade-off）

后端 `finalize()` 在 5xx 响应时调用 `release()`（**不是** `complete()`）— 允许下一个 retry 重新执行副作用。背后的原因：原始业务路径是“先写文件 → 再插任务行 → 再提交执行器”，5xx 可能在两者都已提交后发生（执行器 OOM），不释放会让用户在 7 天内无法重试。

代价：重试会 **重复写文件 + 重复插任务行**（文件仍会被 `_cleanup_old_uploads` 24h 清理，任务行在历史里是两条“同一内容”记录，不会被去重）。判断依据为：`finalize()` 注释里写明了这个 trade-off，不接受的设计是“5xx 也 complete”（代价是用户卡 7 天无法恢复）。

### 重启不失任务

`PlatformExecutor.load_pending_tasks()` 在 Flask 启动时从 PG 拉出所有 `status IN ('pending', 'scheduled') AND (scheduled_at IS NULL OR scheduled_at <= now)` 任务并重新入队。覆盖以下三类：

1. **未调度的 pending**（`/api/upload/*` 与 `/api/tasks/add` 入队后崩溃）
2. **到期的 pending**（原始的 `load_scheduled_tasks` 场景）
3. **到期的 `scheduled` 状态任务**（`reschedule` / `copy` 后 Timer 被重启丢了的场景）

优先级都是 `PRIORITY_NORMAL`（不是 `PRIORITY_RETRY`）— 重启恢复是原任务的延续，不应该能抢走用户手动重试的优先级。

### 边界与限制

* **multipart 上传中途关 tab** — 文件未完全到服务端，入库未提交，任务不会创建。这不是 202 能修复的，是浏览器/TCP 原生限制。报错的 user 需要重新上传。
* **上传流中断后服务端可能已收到部分文件** — 会垃圾保留在 `.sau_uploads/` 下。`_cleanup_old_uploads()` 每 24h 清一次。
* **多后端实例 重复入队** — 当前架构是单进程 `PlatformExecutor` 优先级队列 + PG 表。多个后端实例同时启动会重复入队未受防护任务；项目是本地优先、单机部署，未加锁。

## On-call：401 race-window 噪音怎么消

`useAuth.getMe()` 第一次进 `/dashboard/*` 尚未结算时，会有一批并发 `/api/*` 请求与 auth 门同时冲撞，DevTools Network 面板里会看到一片红 401 + 502。这不是真错，是源码里写明保留的 race window（`sa_web/frontend/src/api/_createAuth401ResponseInterceptor.ts` 头部注释 + `_appendAuthPendingHeader.ts`）。
> 前端请求会打上 `X-SAU-Auth-Pending: 1`，后端 `web_runner/__init__.py` 的 `@app.after_request` 会把它在 401 响应上回声为 `X-SAU-Race-Window: 1`，是 CORS simple 之外的 preflight header，**这个窗口内每个 `/api/*` 会多一次 OPTIONS 往返**（成本限在 `isLoading=true` 期间，首屏后归零）。排查时 DevTools Network 加 filter `has-response-header:X-SAU-Race-Window` 即可一键隐藏 race window 期间的 401。

## 注意事项

- Web Shell 运营台为单用户桌面场景设计，不包含用户系统/RBAC
- 所有上传任务实际由 `sau_cli.py` 的 CLI 逻辑在后台线程中执行
- 日志存储于 PostgreSQL（或 SQLite），重启后端不丢失（自动清理超过 2000 条的旧日志）
- 需先登录账号（通过 CLI 或运营台的登录表单）才能发布
- 所有平台、特性已统一收敛到 `PLATFORM_CONFIG` 字典管理，不再依赖硬编码集合
- 官网首页（`/`）位于统一前端应用本身，是公开路由，不要求登录，也不主动调用 `/api/*`。页面里的 CTA 按钮跳转 `/app` 后才进入需要登录的 Web Shell 运营台。
