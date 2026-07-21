## Phase 1 — 数据闭环 + 批量效率

> **审计快照（2026-07-12）**：本子变更 34 个 checkbox，**33/34 已在 codebase 中实现**，仅 1 个真缺口 → [TBF-033](#tbf-033) per-platform 限流保护。Adjacent gap（5 平台 metrics adapter 缺）登记在 [TBF-034](#tbf-034) 单独跟进。
>
> **审计勘误**：原 tasks.md 第 3 段「定时轮询」与第 6 段「效果看板 UI」中提到的 "`_metrics_poll_worker` 调度」与「效果趋势图渲染」实际均已就位（分别见 `web_runner/routes/metrics.py::start_metrics_poller (function)` 的 `threading.Timer` 每小时轮询 + `sau_web/frontend/src/features/analytics/MetricsEffectPanel.tsx::dayData (const) AreaChart`）。**唯一真缺口 = 3.4 per-platform 限流保护**。

### 审计明细

| 范围 | checkbox 总数 | ✅ 已实现 | ❌ 待实施 | 实现位置（file::symbol + kind） | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1. DB Schema | 2 | 2 | 0 | `web_runner/db.py::upsert_metrics (function)` + `def get_metrics_by_task` + `def get_metrics_by_platform` + `content_metrics (table)` | 表 + 索引 + 3 个 helper 全在 |
| 2. 平台适配器 | 5 | 5 | 0 | `web_runner/routes/metrics.py::PlatformMetricsAdapter (class) (Protocol)` + 3 adapter classes + `ADAPTERS (dict)` | **3 平台覆盖（douyin/bilibili/xiaohongshu）**；5 平台缺 → [TBF-034](#tbf-034) |
| 3. 定时轮询 | 4 | 3 | 1 | `web_runner/routes/metrics.py::start_metrics_poller (function)` + `def _metrics_poll_loop (threading.Timer)` + `def _metrics_poll_worker` + `def _fetch_metrics_for_task`；`web_runner/__init__.py::create_app() (startup hook)` | 调度已就位；**3.4 per-platform 限流**未实施 → [TBF-033](#tbf-033) |
| 4. API 路由 | 4 | 4 | 0 | `web_runner/routes/metrics.py::summary (function)` + `def accounts` + `def tasks` + `def refresh` (all @bp route handlers) | 4 个 endpoint 全在 |
| 5. 前端 API 客户端 | 4 | 4 | 0 | `sau_web/frontend/src/api/client.ts::metricsApi.{summary,accounts,tasks,refresh}` (4 API client methods) | 4 个方法全在 |
| 6. 效果看板 UI | 6 | 6 | 0 | `sau_web/frontend/src/Pages/AnalyticsPage.tsx::TabsTrigger value="effect"` + `TabsContent value="effect"` + `sau_web/frontend/src/features/analytics/MetricsEffectPanel.tsx::EffectStat (function) (component, 4 cards)` + `const platformData (BarChart data)` + `const dayData (AreaChart data)` + `accounts (Table data)` + `const [detail, setDetail] (Dialog state)` | 全部 UI 子组件就位（含 trend chart） |
| 7. 批量 API | 4 | 4 | 0 | `web_runner/routes/tasks.py::batch (function)` + `def batch_template` + `BatchResult[] (per-row return)` | 4 个 endpoint + 逐行错误返回全在 |
| 8. 批量 UI | 5 | 5 | 0 | `sau_web/frontend/src/Pages/TasksPage.tsx::onClick setBatchOpen(true)` + `sau_web/frontend/src/features/tasks/BatchImportDialog.tsx::Upload input (file <input>)` + `preview Table (component)` + `uploading (useState)` + `def handleTemplate` | 全部 UI 子组件就位 |
| **合计** | **34** | **33** | **1** | | + 2 adjacent gap（TBF-033/034） |

---

### 1. 效果追踪 — DB Schema（Web API）

- [x] 1.1 新增 `content_metrics` 表到 `web_runner/db.py` schema 初始化 — `web_runner/db.py::content_metrics (table)` + `idx_content_metrics (indexes)`
- [x] 1.2 新增 `content_metrics` CRUD helpers（upsert_metrics / get_metrics_by_task / get_metrics_by_platform） — `web_runner/db.py::upsert_metrics (function)` + `def get_metrics_by_task` + `def get_metrics_by_platform`

### 2. 效果追踪 — 平台 API 适配器（Web API）

- [x] 2.1 新增 `web_runner/routes/metrics.py` 蓝图，注册到 `create_app()` — `web_runner/routes/metrics.py::Blueprint (flask blueprint)` + `create_app() (factory registration)`
- [x] 2.2 实现抖音效果数据拉取适配器（调用抖音开放平台 API） — `web_runner/routes/metrics.py::ADAPTERS (dict)["douyin"]`
- [x] 2.3 实现 B站效果数据拉取适配器（调用 B站 API） — `web_runner/routes/metrics.py::ADAPTERS (dict)["bilibili"]`
- [x] 2.4 实现小红书效果数据拉取适配器（调用小红书 API） — `web_runner/routes/metrics.py::ADAPTERS (dict)["xiaohongshu"]`
- [x] 2.5 实现通用适配器接口 `PlatformMetricsAdapter`，统一返回格式 `{views, likes, comments, shares}` — `web_runner/routes/metrics.py::PlatformMetricsAdapter (class) (Protocol)`
- ⚠️ **Adjacent gap**：`ADAPTERS (dict)` 只覆盖 3/8 平台（douyin/bilibili/xiaohongshu）→ [TBF-034](#tbf-034) 跟进 kuaishou/tencent/tiktok/baijiahao/youtube

### 3. 效果追踪 — 定时轮询（Web API）

- [x] 3.1 实现 `_fetch_metrics_for_task()` 单任务效果拉取逻辑 — `web_runner/routes/metrics.py::_fetch_metrics_for_task (function)`
- [x] 3.2 实现 `_metrics_poll_worker()` 定时轮询 worker（每小时执行） — `web_runner/routes/metrics.py::_metrics_poll_worker (function)`
- [x] 3.3 注册定时任务到 Flask app（使用 `threading.Timer` 或 APScheduler） — `web_runner/__init__.py::create_app() (startup hook for metrics poller)` + `web_runner/routes/metrics.py::start_metrics_poller (function)`
[x] 3.4 实现 API 限流保护（per-platform 滑动窗口限制） — **TODO → [TBF-033](#tbf-033)**

### 4. 效果追踪 — API 路由（Web API）

- [x] 4.1 实现 `GET /api/metrics/summary` — 按平台/时间段聚合效果数据 — `web_runner/routes/metrics.py::summary (function) (route handler)`
- [x] 4.2 实现 `GET /api/metrics/accounts` — 按账号聚合效果数据 — `web_runner/routes/metrics.py::accounts (function) (route handler)`
- [x] 4.3 实现 `GET /api/metrics/tasks` — 单任务效果详情 — `web_runner/routes/metrics.py::tasks (function) (route handler)`
- [x] 4.4 实现 `POST /api/metrics/refresh` — 手动触发效果数据刷新 — `web_runner/routes/metrics.py::refresh (function) (route handler)`

### 5. 效果追踪 — 前端 API 客户端（Frontend）

- [x] 5.1 新增 `fetchMetricsSummary()` 到 `src/api/client.ts` — `sau_web/frontend/src/api/client.ts::metricsApi.summary (api method)`
- [x] 5.2 新增 `fetchMetricsAccounts()` 到 `src/api/client.ts` — `sau_web/frontend/src/api/client.ts::metricsApi.accounts (api method)`
- [x] 5.3 新增 `fetchMetricsTasks()` 到 `src/api/client.ts` — `sau_web/frontend/src/api/client.ts::metricsApi.tasks (api method)`
- [x] 5.4 新增 `refreshMetrics()` 到 `src/api/client.ts` — `sau_web/frontend/src/api/client.ts::metricsApi.refresh (api method)`

### 6. 效果追踪 — 效果看板 UI（Frontend）

- [x] 6.1 AnalyticsPage 新增「效果」Tab — `sau_web/frontend/src/Pages/AnalyticsPage.tsx::TabsTrigger value="effect"` + `TabsContent value="effect"`
- [x] 6.2 实现效果摘要卡片（总播放/总点赞/总评论/总分享） — `sau_web/frontend/src/features/analytics/MetricsEffectPanel.tsx::EffectStat (function) (component, 4 cards)`
- [x] 6.3 实现按平台效果对比图表（复用现有图表组件） — `sau_web/frontend/src/features/analytics/MetricsEffectPanel.tsx::platformData (const) (BarChart data)`
- [x] 6.4 实现按时间段效果趋势图 — `sau_web/frontend/src/features/analytics/MetricsEffectPanel.tsx::dayData (const) (AreaChart data)`
- [x] 6.5 实现账号维度效果排行 — `sau_web/frontend/src/features/analytics/MetricsEffectPanel.tsx::accounts (Table data)`
- [x] 6.6 实现单任务效果详情弹窗 — `sau_web/frontend/src/features/analytics/MetricsEffectPanel.tsx::[detail, setDetail] (useState destructure, Dialog state)`

### 7. 批量导入 — API 路由（Web API）

- [x] 7.1 实现 `POST /api/tasks/batch` — 接收 CSV 文件，解析并批量创建任务 — `web_runner/routes/tasks.py::batch (function) (route handler)`
- [x] 7.2 实现 CSV 校验逻辑（platform/file/title 必填，schedule 格式校验） — `web_runner/routes/tasks.py::batch (function) (route body)`
- [x] 7.3 实现逐行错误返回（不因单行失败阻断整批） — `web_runner/routes/tasks.py::BatchResult[] (per-row return)` + `sau_web/frontend/src/features/tasks/BatchImportDialog.tsx::preview Table (per-row rendering)`
- [x] 7.4 实现 `GET /api/tasks/batch/template` — 下载 CSV 模板 — `web_runner/routes/tasks.py::batch_template (function) (route handler)`

### 8. 批量导入 — 前端 UI（Frontend）

- [x] 8.1 TasksPage 新增「批量导入」按钮 — `sau_web/frontend/src/Pages/TasksPage.tsx::onClick setBatchOpen(true) (button handler)`
- [x] 8.2 实现 CSV 上传组件（Ant Design Upload） — `sau_web/frontend/src/features/tasks/BatchImportDialog.tsx::Upload input (file <input type="file" accept=".csv,text/csv">)`
- [x] 8.3 实现 CSV 预览表格（展示解析结果 + 逐行校验状态） — `sau_web/frontend/src/features/tasks/BatchImportDialog.tsx::preview Table (component)` + per-row `CheckCircle2` / `XCircle` status icons
- [x] 8.4 实现批量确认提交 + 进度展示 — `sau_web/frontend/src/features/tasks/BatchImportDialog.tsx::uploading (useState)` + `Loader2 (spinner icon)`
- [x] 8.5 实现模板下载按钮 — `sau_web/frontend/src/features/tasks/BatchImportDialog.tsx::handleTemplate (function) (template download function)`

---

## 待实施 backlog

### TBF-033

**标题**：metrics polling per-platform 滑动窗口限流

**范围**：

- `web_runner/routes/metrics.py::ADAPTERS` 调用前置：维护 `_last_call_per_platform: dict[str, float]` + `_rate_limit_window_sec` 常量
- 触发条件：若 `now - _last_call_per_platform[platform] < _rate_limit_window_sec[platform]`，跳过本轮 + debug log `rate_limited_skip`
- per-platform 窗口配置：新环境变量 `SAU_METRICS_PER_PLATFORM_QPS={"douyin":1,"bilibili":0.5,"xiaohongshu":1}`；缺省值 1 QPS
- 429 响应处理：适配器抛 `MetricsRateLimited` → 强制 `_last_call_per_platform[platform] = now + 60`
- 单元测试：在 `tests/test_metrics.py` 加 1) 配置正常时 1 秒内 2 次调用被跳过 2) 429 响应后窗口被延长

**参考实现（codebase 已有的 rate-limit 模式可借鉴）**：

- `web_runner/notifications.py::_rate_limited (function) (per-URL sliding window + threading.Lock)` — 内存时间戳表模式
- `web_runner/routes/ai.py::_check_image_rate_limit (function) (per-user DB rate_limited_at flag)` + `def _mark_rate_limited (per-user DB write)` — DB 持久化标记模式
- Per-platform 版本可混合两种思路：**内存 sliding window 走通知模式**（速度快、restart 丢失）+ **DB 标记 429 走 AI 模式**（持久化、跨进程）

**预估**：1 个 PR，~150 行 Python + ~80 行测试

**Owner**：platform-team（TBD 实际人）

**关联**：

- 原 task 3.4
- Phase 3 RSS 轮询（[TBF-005 草案]）有相同的 per-source 限流需求，可复用同一 helper
- `web_runner/notifications.py::_rate_limited (function) (per-URL sliding window + threading.Lock)` — pattern 借鉴

---

### TBF-034

**标题**：metrics adapter 扩展到剩余 5 平台（kuaishou / tencent / tiktok / baijiahao / youtube）

**范围**：

- `web_runner/routes/metrics.py::ADAPTERS (dict)` 当前只注册 3/8 平台：douyin / bilibili / xiaohongshu
- 待扩展：kuaishou（快手）/ tencent（视频号）/ tiktok（TikTok 国际版）/ baijiahao（百家号）/ youtube（YouTube）
- 每个新平台：
  - 查证开放平台 API 是否提供视频/笔记互动数据（views/likes/comments/shares 4 个维度）
  - 若有，按 `web_runner/routes/metrics.py::PlatformMetricsAdapter (class) (Protocol)` 实现新 adapter class
  - 若无（如部分平台只提供 view count），实现 fallback（部分字段填 0 + log warning）
  - 注册到 `ADAPTERS (dict)`
- 文档：`docs/ai-material-search.md` 或新建 `docs/platform-metrics-coverage.md` 列出每个平台的 metrics 可用性矩阵

**前置依赖**：

- 各平台的 uploader 已有且 cookie 可用（已有 `uploader/<platform>_uploader/` 5 个目录）
- 平台 API 调用 token / OAuth 配置在 `conf.py`（需在 `conf.example.py` 加新占位字段）

**PoC 平台选择（先做这 2 个）**：

- **kuaishou + tiktok** — 优先
  - **kuaishou**：开放平台 API 形态与 douyin 最相近（已有 `web_runner/routes/metrics.py::ADAPTERS (dict)["douyin"]` adapter 可借鉴 80%）
  - **tiktok 国际版**：与 douyin 共享 backend（adapter 几乎可复用 douyin 实现，差异主要在 endpoint 域名）
  - 两平台可在 1 sprint 内 PoC 跑通
- **第二波**：baijiahao（百度 OAuth 流程）/ youtube（Google OAuth + Data API v3）/ tencent（视频号 API 较封闭）
- 风险：若任一平台 API 完全不提供互动数据，scope 缩减（不实施该平台 adapter）

**预估（含 PoC 先行）**：

- **PoC（kuaishou + tiktok）**：1 sprint 1-2 人（约 5 人天 / 平台）
- **全量（+ baijiahao + youtube + tencent）**：PoC 成功后 1-2 sprint 3-4 人（每平台 3-5 人天 × 3）
- 风险：5 平台 API 形态差异极大（YouTube = Google OAuth, tencent = 微信视频号, tiktok ≈ douyin 重复, baijiahao = 百度账号 OAuth, kuaishou = 平台私有 API），单平台估时可能 ±50%

**Owner**：platform-team（TBD 实际人）+ 需各平台 API 调研配合

**关联**：

- 原 task 2.2-2.4 仅要求 3 平台，未要求其他 5 平台；本 ticket 扩展 scope
- 依赖 TBF-033 限流保护（5 平台共享 polling 调度）
- 依赖 Phase 3 `notification-system` 的 webhook 触发（5 平台 metrics 异常时通知）
- 风险联动：若 PoC 发现某平台 API 不可用，触发 umbrella `product-roadmap-2026q3` 的"不支持平台"清单更新
