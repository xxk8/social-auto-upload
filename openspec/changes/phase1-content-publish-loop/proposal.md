## Why

父 umbrella `product-roadmap-2026q3` 已识别出五大缺口：数据断裂 / 效率瓶颈 / 内容复用缺失 / 内容生产链断裂 / 合规风险。Phase 1 解决其中**优先级最高的两项**：

1. **数据断裂**：发布后没有任何效果数据回流，AI 也没有反馈信号。
2. **效率瓶颈**：逐条手工发布，运营每天可处理的发布条数被卡在十几条。

效果数据是后续 Phase 2-3 所有智能化能力（排期推荐、模板调优、A/B 对比）的输入；批量导入是 Phase 2-3 自动化能力（RSS / 模板批量套用）的前置基础。

## What Changes

落地两个 capability：

- **`content-metrics`**：发布后每小时拉取平台 API 互动数据 → 落到 `content_metrics` 表 → AnalyticsPage 效果 Tab 展示
- **`batch-import`**：CSV 上传 → 解析 + 逐行校验 → 批量创建 task → 预览确认

## Capabilities

- 新增 `content-metrics`
- 新增 `batch-import`

## Impact

- **Web API**：新增 `web_runner/routes/metrics.py`（summary / accounts / tasks / refresh 四个端点）；扩展 `web_runner/routes/tasks.py`（新增 `POST /api/tasks/batch` 与 `GET /api/tasks/batch/template`）
- **DB**：新增 `content_metrics` 表（task_id + platform 主键）+ CRUD helpers
- **Frontend**：`AnalyticsPage` 新增「效果」Tab；`TasksPage` 新增「批量导入」按钮 + `BatchImportDialog`
- **Scheduler**：注册 `_metrics_poll_worker()` 每小时拉取；可配置间隔

## Layer

- API: `web_runner/routes/metrics.py` · `web_runner/routes/tasks.py`
- DB: `web_runner/db.py`
- Frontend: `src/Pages/AnalyticsPage.tsx` · `src/Pages/TasksPage.tsx`

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- design.md: [`design.md`](design.md)
