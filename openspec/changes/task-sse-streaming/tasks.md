## 1. 后端 — 任务日志 ring buffer (Web API)

- [ ] 1.1 在 `web_runner/executor.py` 加全局 `_task_log_buffers: dict[str, deque] = {}`,key = task_id,value = `deque(maxlen=500)`
- [ ] 1.2 加 `_task_log_subscribers: dict[str, list[asyncio.Queue]] = {}`,key = task_id,value = list of queues(每个 SSE client 一个)
- [ ] 1.3 实现 `append_task_log(task_id, level, message)` 函数:append 到 buffer + fanout 到所有 subscriber queue
- [ ] 1.4 实现 `get_task_log_history(task_id, since=0) -> list[dict]`:返回 buffer 中 since 之后的日志
- [ ] 1.5 在 `_task_logger` 输出时(通过 logging.Handler subclass)hook 到 `append_task_log`
- [ ] 1.6 加 unit test:验证 buffer maxlen=500 不超限 + fanout 跨 subscriber 同步

## 2. 后端 — 进度报点 (Web API / Uploader)

- [ ] 2.1 在 `web_runner/executor.py` 加 `_task_progress_subscribers: dict[str, list[asyncio.Queue]]` 平行结构
- [ ] 2.2 实现 `report_task_progress(task_id, stage, percent)` 函数:fanout progress event
- [ ] 2.3 在 7 个 uploader 主流程加 `_task_progress` 调用(具体 stage 见 acceptance):
      - `uploader/douyin_uploader/main.py`: `cookie_validated` / `video_uploaded` / `title_filled` / `thumbnail_set` / `published`
      - `uploader/xiaohongshu_uploader/main.py`: 同上
      - `uploader/ks_uploader/main.py`: 同上
      - `uploader/tencent_uploader/main.py`: 同上(含 `original_declared` 额外 stage)
      - `uploader/baijiahao_uploader/main.py`: 同上
      - `uploader/tk_uploader/main.py`: 同上
      - `uploader/youtube_uploader/main.py`: 同上
- [ ] 2.4 进度报点失败时 silently skip(不能因为 progress 报点 crash 上传)

## 3. 后端 — SSE 端点 (Web API)

- [ ] 3.1 在 `web_runner/routes/tasks.py` 加 `GET /api/tasks/<task_id>/stream` 路由:
      - 用 `Response(generator, mimetype="text/event-stream")`
      - generator 先 `yield` 全部历史日志(`event: log`)
      - 然后订阅 subscriber queue,`yield` 新日志
      - task 结束后 `yield event: close` 并 return
      - client 断开时 `queue.put(None)` 通知 generator 退出
- [ ] 3.2 加 `GET /api/tasks/<task_id>/logs?since=<offset>` 路由返回 JSON
- [ ] 3.3 加 auth gate(沿用 `before_request` hook,自动套上)
- [ ] 3.4 验证 EventSource 客户端能解析 event 流

## 4. 前端 — TaskLogStream 组件 (Frontend)

- [ ] 4.1 新建 `sau_web/frontend/src/features/tasks/TaskLogStream.tsx`:
      - props: `taskId, onClose`
      - 内部用 `useEffect` 创建 `new EventSource('/api/tasks/<id>/stream')`
      - 维护 `logs: Array<{ts, level, message}>` state
      - 每个 event 解析后 append
      - unmount 时 `eventSource.close()`
- [ ] 4.2 渲染:每行 `<div className="text-xs font-mono">` + level 决定颜色
- [ ] 4.3 加 "已暂停/继续" 按钮(暂停时新日志入 buffer 但不渲染)
- [ ] 4.4 加 "下载日志" 按钮 → Blob download `.log` 文件

## 5. 前端 — TasksPage 集成 (Frontend)

- [ ] 5.1 `sau_web/frontend/src/Pages/TasksPage.tsx` 任务行加 "Live logs" 按钮(只在 status in [pending, running] 时 enabled)
- [ ] 5.2 点击 → 打开右侧抽屉显示 `<TaskLogStream taskId={task.id} onClose={...} />`
- [ ] 5.3 已完成的任务("completed"/"failed")显示 "View history" 按钮 → 调 REST `/api/tasks/<id>/logs?since=0`
- [ ] 5.4 `sau_web/frontend/src/Pages/TasksPage.test.tsx` 加 task log 渲染 case

## 6. 前端 — PublishPage 实时进度 (Frontend)

- [ ] 6.1 `sau_web/frontend/src/Pages/PublishPage.tsx` 提交上传后,跳到 `<PublishProgress taskId={...} />` 组件
- [ ] 6.2 组件订阅 `/api/tasks/<id>/stream`,显示 progress event → 进度条 + 当前 stage
- [ ] 6.3 进度条 stage → percent 映射表:
      - `cookie_validated`: 10
      - `video_uploaded`: 60
      - `title_filled`: 70
      - `thumbnail_set`: 80
      - `original_declared`: 85(tencent 专属)
      - `published`: 100
- [ ] 6.4 完成后跳成功页,显示 platform-specific 链接(抖音 / 小红书 / B 站都打开创作者中心)

## 7. 测试 (Tests)

- [ ] 7.1 `tests/test_task_sse_streaming.py`(新建)加 SSE 端点 case:
      - mock 1 个 running task + 1 个 SSE client
      - 模拟 logger 输出,验证 client 收到 SSE event
      - 模拟 client 断开,验证 server 端 queue cleanup
- [ ] 7.2 `tests/test_sau_web_upload.py` 加 `/api/tasks/<id>/logs?since=N` REST 端点 case
- [ ] 7.3 `sau_web/frontend/src/features/tasks/TaskLogStream.test.tsx`(新建):mock EventSource,验证 logs state 正确更新
- [ ] 7.4 `sau_web/frontend/src/Pages/TasksPage.test.tsx` 加 "Live logs" 按钮渲染 case

## 8. 验证 (Verification)

- [ ] 8.1 `pytest tests/` 全绿
- [ ] 8.2 dev server 启动 + TasksPage 看到任务 + 点 Live logs 看到实时日志
- [ ] 8.3 PublishPage 提交抖音上传 → 进度条正常推进 → 完成后跳成功页
- [ ] 8.4 内存监控 24h:log buffer 不超过 500 行 × 任务数
