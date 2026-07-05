## Why

当前 Web Shell 推送只覆盖了登录 QR 码的 SSE 流(`/api/accounts/login/qrcode/<task_id>/sse`),而**任务执行期间的日志完全不流式推送**。用户在以下场景体验差:

1. 上传一个 1GB 视频到抖音,需要 5-15 分钟。期间用户只能看到 "pending" 状态,完全不知道是还在传、还是卡在某个 selector、还是已经发布
2. AI 多平台生成 30+ 秒,期间没有 streaming 反馈,用户以为死机
3. 任务失败时,只能点 "查看详情" 看到最后的 exception stack,看不到中间过程(哪个 cookie 校验失败、哪个 selector timeout)
4. 多任务并发时,无法看到每个任务的实时进度

具体证据:
- `web_runner/executor.py` 有 task priority + per-platform concurrency,但执行时 stdout/logger 输出没有 fanout 给订阅者
- `web_runner/routes/tasks.py` 有 `GET /api/tasks` 和 `GET /api/tasks/<id>`,但**没有 SSE 端点**
- `sau_web/frontend/src/Pages/TasksPage.tsx` 是 polling 模型(`refetchInterval`),不是 streaming
- `sau_web/frontend/src/features/tasks/TaskDrawer.tsx`(推测)展示静态日志

## What Changes

**后端 — 任务日志 ring buffer + SSE 端点**
- `web_runner/executor.py` 增加 per-task log buffer(每个 task 一个 `collections.deque(maxlen=500)`)
- 在 `_task_logger` 输出时,hook 到对应 task_id 的 buffer
- 新增 `GET /api/tasks/<task_id>/stream` SSE 端点:
  - 先把 buffer 中的历史日志一次性发给 client(resume-from-history)
  - 然后订阅该 task 的新日志,实时推送
  - task 结束后发 `{event: "close", data: {status: "success"}}` 然后断流
- 新增 `GET /api/tasks/<task_id>/logs?since=<offset>` REST 端点(给非 SSE 客户端用)
- Flask 路由注册到 `web_runner/routes/tasks.py`

**后端 — 任务进度 event**
- `web_runner/executor.py` 任务执行过程中定期发 progress event(从 _upload_video 等函数的 known 节点:`cookie_validated` / `video_uploaded` / `title_filled` / `tags_filled` / `thumbnail_set` / `published`)
- `DouYinVideo.upload` 等用 `_task_progress(task_id, stage, percent)` 辅助函数显式报点
- SSE event 形如 `{event: "progress", data: {stage: "video_uploaded", percent: 70}}`

**前端 — TasksPage 实时日志**
- `sau_web/frontend/src/Pages/TasksPage.tsx` 任务行加 "Live logs" 按钮 → 打开 `<TaskLogStream>` 抽屉
- `<TaskLogStream>` 组件用 `EventSource` 连接 `/api/tasks/<id>/stream`,显示实时日志
- 每个日志行有 timestamp + level + 颜色(text-success-foreground / warn / destructive)
- 支持 "已结束" 任务查看历史(从 offset 拉)
- 抽屉关闭时 `eventSource.close()`

**前端 — PublishPage 实时进度**
- `sau_web/frontend/src/Pages/PublishPage.tsx` 提交上传后,跳转到"等待中"页面
- 实时显示当前 stage(`uploading_video` / `filling_title` / `setting_thumbnail` / `published` 等)
- 用 stage → 进度条 0/30/60/85/100 映射
- 完成后跳到 "成功" 页 + 显示跳转链接

**测试**
- `tests/test_sau_web_upload.py` 加 SSE 端点 case(模拟 client EventSource,验证 event 流)
- `tests/test_sau_web_upload.py` 加 progress event case
- `sau_web/frontend/src/Pages/TasksPage.test.tsx` 加 TaskLogStream 渲染 case
- `sau_web/frontend/src/features/tasks/TaskLogStream.test.tsx`(新建) 测 EventSource 订阅/取消订阅

## Capabilities

### New Capabilities
- `task-log-sse-streaming`: 后端 per-task log ring buffer + SSE 端点,前端 EventSource 实时显示
- `task-progress-events`: 任务执行过程中显式报 stage + percent,SSE 推送给 client
- `task-history-rest`: `GET /api/tasks/<id>/logs?since=<offset>` 拉历史日志(给非 SSE client / 重连用)

### Modified Capabilities
- `executor-priority-queue`: 任务执行时 fanout stdout/logger 到 buffer
- `publish-page-wizard`: PublishPage 提交后跳等待页 + 实时 progress

## Impact

- **CLI**: 无影响(SSE 是 Web 专属)
- **Web API**:
  - `web_runner/executor.py` 加 log buffer + 进度报点 hook
  - `web_runner/routes/tasks.py` 加 2 个新路由(`/stream` + `/logs`)
  - `uploader/douyin_uploader/main.py` / `xiaohongshu_uploader/main.py` / `ks_uploader/main.py` / `tencent_uploader/main.py` 等 6+ 个上传流程加 `_task_progress(task_id, stage, percent)` 调用
- **Frontend**:
  - `sau_web/frontend/src/Pages/TasksPage.tsx` 加 "Live logs" 按钮 + `<TaskLogStream>` 抽屉
  - `sau_web/frontend/src/features/tasks/TaskLogStream.tsx` 新建(EventSource 订阅组件)
  - `sau_web/frontend/src/Pages/PublishPage.tsx` 提交后跳等待页 + 实时 progress
- **Database**: 无变化
- **Dependencies**: 无新增(`EventSource` 浏览器原生)

## Acceptance Criteria

1. **SSE 端点**:
   - `GET /api/tasks/<task_id>/stream` 返回 `text/event-stream`,前 1-2 秒发 buffer 历史,然后实时推新日志
   - task 结束后发 `event: close` 并断流
   - client 断开后 server 端 30s 内清理订阅(避免内存泄漏)
2. **进度 event**:
   - 上传抖音视频时,client 至少收到 4 个 progress event:`cookie_validated` / `video_uploaded` / `title_filled` / `published`
   - percent 字段在 0-100 之间单调递增
3. **前端实时日志**:
   - 打开 TasksPage,点 "Live logs" → 抽屉显示当前选中任务的实时日志
   - 日志行 timestamp 正确(本地时间,HH:MM:SS 格式)
   - 任务失败时,error 日志红色高亮
4. **前端 publish progress**:
   - PublishPage 提交后,显示进度条 + 当前 stage 文字
   - 完成后跳 "成功" 页 + 跳转到 platform link
5. **历史日志**:
   - `GET /api/tasks/<id>/logs?since=0` 返回该 task 全量日志
   - `?since=10` 返回从第 10 行开始的日志
6. **内存安全**:
   - log buffer `maxlen=500`,不会无限增长
   - 任务完成后 buffer 保留 1 小时供查询,1 小时后 GC
7. **测试不回归**:`pytest tests/` 全绿
