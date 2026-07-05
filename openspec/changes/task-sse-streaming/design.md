## Context

Web Shell 当前的任务日志查看是 polling 模型(`TasksPage` 定时 refetch)+ 静态展示(任务详情 drawer 只能看任务完成后的最终日志),用户无法看到任务执行中的中间日志。SSE 流式推送是天然解 — 后端有 logger,前端有 `EventSource` API,中间只需要一个 buffer + fanout 层。

## Goals / Non-Goals

### Goals
- 任务执行期间日志实时推送给前端
- 支持历史日志 resume(SSE 断线重连后能拿到断线期间的日志)
- 任务进度显式报点(upload → thumbnail → publish),前端进度条可见
- 内存安全:log buffer 不会无限增长;订阅者断开后 server 端清理

### Non-Goals
- ❌ 不做日志全文搜索(留 v0.1)
- ❌ 不做日志告警(规则引擎) — 留 v0.1
- ❌ 不做日志持久化(目前只在内存,server 重启即丢) — 留 v0.1,届时用 SQLite 存
- ❌ 不做多 SSE client 之间的协作(每个 client 独立订阅)
- ❌ 不做 task log 跨 server 实例同步(单进程)

## Decisions

### D1: 内存 ring buffer (deque maxlen=500) 而非文件

**决策**: 每个 task 的日志存在内存 `deque(maxlen=500)`,而非文件 / SQLite。

**理由**:
- 任务的"近期日志"价值远大于"全部历史日志";500 行覆盖绝大多数调试场景
- 写文件 / DB 每次 logger 都加 IO,影响上传主流程(视频上传已经 CPU/IO bound)
- 单 task 500 行 × 最大并发 16 task = 8000 行 = ~2MB 内存,可接受

**替代方案 1**: 写文件 `logs/<task_id>.log` — 拒绝:IO 开销
**替代方案 2**: SQLite 持久化 — 拒绝:本 change scope 是 streaming,不是 persistence

### D2: 进度 stage 由 uploader 显式报,而非从 log 推断

**决策**: 在每个 uploader 主流程的关键节点显式调 `_task_progress(task_id, stage, percent)`,而不是从 log 中 regex 推断 stage。

**理由**:
- 从 log 推断是不可靠的(平台 UI 变化 → log 文本变 → 推断失败)
- 显式报点对 uploader 来说是低成本(`task_id` 已经在 TaskContext 里)
- 失败时 silently skip(不能因为 progress 报点 crash 上传)

**实现**: `web_runner/executor.py` 提供 `report_task_progress(task_id, stage, percent)`,在 `_run_sau` 子进程启动前把 task_id 注入环境变量,`uploader` 启动时读 `os.environ["SAU_TASK_ID"]` 然后 import + 调 report。

**替代方案**: uploader 直接写进度到 stdout,executor 解析 — 拒绝:与 logger output 串流难区分。

### D3: SSE 端点用 `text/event-stream` + `Response(generator)`

**决策**: 用 Flask 的 `Response(generator, mimetype="text/event-stream")` 模式,而非引入 `flask-sse` / `sse-starlette` 等额外库。

**理由**:
- 标准库 + Flask 现成能力,无新依赖
- generator 控制流清晰(用 `try/finally` 清理 subscriber)
- 与项目其它 SSE 端点(`/api/accounts/login/qrcode/<id>/sse`)风格一致

**替代方案**: flask-sse — 拒绝:多一个依赖,多一份配置,本场景用不到它的 pubsub 抽象。

### D4: 前端 EventSource 而非 WebSocket / Axios polling

**决策**: 前端用 `EventSource`(浏览器原生)而非 WebSocket / Axios polling。

**理由**:
- EventSource 浏览器原生,无新依赖
- 天然断线重连(虽然本 change 不用,留给未来)
- 单向(server → client)场景最适合
- WebSocket 是双向的,本场景用不到

**替代方案**: WebSocket — 拒绝:过度设计。

### D5: 历史日志用 `?since=<offset>` REST 端点,非 SSE replay

**决策**: 已完成的任务查看历史日志走 REST `GET /api/tasks/<id>/logs?since=N` 端点,不走 SSE。

**理由**:
- 已完成 task 不需要 streaming,一次性拉全量更简单
- `since` 参数支持分页,大日志不会一次性塞爆前端
- REST 端点更易被非前端 client(curl / Postman)调试

**替代方案**: SSE replay — 拒绝:对已完成 task 是浪费。

### D6: Subscriber queue 用 `asyncio.Queue` 而非 callback

**决策**: 每个 SSE client 一个 `asyncio.Queue(maxsize=100)`,server 端 fanout 时 `await queue.put(log_entry)`。

**理由**:
- Queue 是 asyncio 原生,容易 backpressure(client 慢时 queue 满 → server 端 await 暂停)
- 断开时 `queue.put_nowait(SENTINEL)` 通知 generator 退出
- 比 callback 模式更易测(可以直接 `await queue.get()` 测)

**替代方案**: callback 函数 + threading.Event — 拒绝:与 asyncio 不协调。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 多 SSE client 订阅同一 task,fanout 开销 | queue.put 是 O(1),最大并发 16 client × 16 task = 256 queue,可接受 |
| Client 断开但 server 端没及时清理 subscriber → 内存泄漏 | generator 异常 / 结束时 `try/finally queue.put(SENTINEL)` + 30s 超时清理 |
| 进度报点失败导致上传 crash | `try/except Exception: pass` 包住 _task_progress 调用 |
| 大 logger 输出(line > 1MB)撑爆 buffer | 截断到 10KB,日志中加 `[truncated]` 标识 |
| EventSource 跨域不工作 | CORS 已配,且前端同源,无影响 |

## Migration Plan

- **Phase 1** (Task 1): 后端 log buffer + subscribers(零外部行为变化)
- **Phase 2** (Task 2): 进度报点 + uploader 接入(每 uploader 一个 commit,出问题好 revert)
- **Phase 3** (Task 3): SSE 端点(新路由,新文件,无 breaking)
- **Phase 4** (Tasks 4-6): 前端 3 个组件
- **Phase 5** (Tasks 7-8): 测试 + 验证

每 Phase 独立 merge,失败回滚成本低。

## Open Questions

- 是否需要给 SSE 加心跳(15s ping)避免被中间 proxy 切断?— 看实际部署,如果跨 nginx 经常断就加
- 日志 buffer 是否要分 level 存储(只存 warn 以上)— 拒绝:debug 价值高,500 行容量够
- 进度报点是否要给 percent 还是只有 stage?— 留 stage,前端自己映射 percent(见 task 6.3)
- 多 server 实例时 log buffer 不共享— 拒绝,单进程足够
