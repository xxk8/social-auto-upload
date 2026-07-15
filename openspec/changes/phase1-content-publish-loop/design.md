## Context

Phase 1 解决两个最高优先级缺口：发布后效果数据完全断裂 + 逐条手工发布效率瓶颈。父 umbrella `product-roadmap-2026q3` 已确立整体路线图；本子变更聚焦"先看见效果、再批量铺量"的数据-效率双闭环。

继承自 umbrella 的关键技术决策：

- 数据存储独立表，不与现有 `analytics_*` 混合，避免聚合查询性能影响
- 平台 API 调用走"定时轮询 + 限流保护"路径，不实时查询
- CSV 解析用 Python 标准库 `csv` 模块，不新增依赖
- 复用现有 `web_runner/routes/tasks.py` 任务创建逻辑，仅扩展为批量入口

## Goals / Non-Goals

**Goals:**

- 任何 `status=success` 的发布任务在 ≤ 1 小时内进入 effect tracking
- 单次 CSV 导入 ≤ 100 行，单行失败不阻断整批
- 效果数据对 AnalyticsPage / PublishPage / 后续 Phase 2 排期推荐 均可消费

**Non-Goals:**

- 不引入新的 BI / 报表系统（用现有 React + Ant Design 组件）
- 不实现"评论 / 私信"互动数据（父 umbrella Phase 2+ 才考虑）
- 不实现 A/B 测试（Phase 3 单独子变更）

## Decisions

### 1. 效果数据拉取：统一平台适配器接口

**决定**: 定义 `PlatformMetricsAdapter` 协议类，统一返回 `{views, likes, comments, shares, fetched_at}`。每个平台一个实现（douyin / bilibili / xiaohongshu）。

**理由**: 后续 Phase 2 的"最佳时段推荐"和 Phase 3 的"竞品对标"都依赖标准化数据；先把契约定下来比先把三个平台实现齐更重要。

### 2. 轮询调度：可注入的 worker 抽象

**决定**: 提供 `_fetch_metrics_for_task(task)` 单任务拉取函数 + `_metrics_poll_worker()` 后台调度器，两者解耦，调度器在 Flask app 启动时注册，间隔可配置（默认 1 小时）。

**理由**: 测试可只调 `_fetch_metrics_for_task` 单步验证，无需启动后台循环；运行时 worker 失败不阻塞 HTTP 请求。

### 3. 限流策略：per-platform 滑动窗口

**决定**: 每平台维护一个最近调用时间戳的简单内存表，调用前比对平台 API 文档规定的 QPS 上限，触发限流则跳过本轮。

**理由**: 早期阶段无需引入 Redis；后续如需分布式可平滑切换。

### 4. CSV 批量：解析与提交分离

**决定**: 客户端先解析 + 校验（前端组件 `BatchImportDialog`），展示预览表给用户确认后再 `POST /api/tasks/batch`；服务端只信任 platform/file/title 三必填 + schedule 格式，再次校验防绕过。

**理由**: 前端提前失败成本低（不需要造 task_id），服务端最终校验保证数据完整性。

## Risks / Trade-offs

- **平台 API 限流** → per-platform 滑动窗口 + 错误日志 + 下一轮重试
- **CSV 格式错误** → 前端预览表 + 服务端二次校验 + 逐行 error
- **首启时无历史数据** → 效果 Tab 容忍空状态（"数据积累中"）

## Open Questions

- 抖音 / B 站 / 小红书 开放平台 API 当前是否对外提供效果数据接口？如无，Phase 1 退化为"上传后手工回填"
- 批量导入上限 100 行 / 次 是否合理？后续可通过环境变量调整

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- 兄弟子变更: [`phase2a-publish-intelligence`](../../phase2a-publish-intelligence/) · [`phase2b-media-production`](../../phase2b-media-production/) · [`phase3-trust-and-monitoring`](../../phase3-trust-and-monitoring/) · [`phase4-collab-and-monetization`](../../phase4-collab-and-monetization/)
- 复用现有模块: `web_runner/db.py` · `web_runner/routes/analytics.py` · `web_runner/routes/tasks.py` · `sau_web/frontend/src/Pages/AnalyticsPage.tsx` · `sau_web/frontend/src/Pages/TasksPage.tsx`
