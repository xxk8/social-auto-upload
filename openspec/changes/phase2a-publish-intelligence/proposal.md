## Why

Phase 1 提供了"效果数据"基础输入，本子变更在它之上回答两个最直接的运营问题：

- **何时发**？——基于历史数据预聚合最佳时段，避免凭感觉设置定时
- **发什么**？——可复用的内容模板，避免每次从零写文案

这两项是**纯运营杠杆**：实现成本低于 Phase 2b（媒体处理），但对单条发布的 ROI 提升最直接（5 分钟 vs 30 分钟）。

## What Changes

落地两个 capability：

- **`smart-scheduling`**：基于历史效果数据预聚合 `publish_insights`，每小时更新；前端热力图展示最佳时段；批量任务支持自动排期
- **`content-templates`**：模板 CRUD（DB JSONB 存储）+ 前端选择器 + 应用到 AI 侧边栏

## Capabilities

- 新增 `smart-scheduling`
- 新增 `content-templates`

## Impact

- **Web API**：新增 `web_runner/routes/scheduling.py`（insights / recommend / auto-assign）；新增 `web_runner/routes/templates.py`（CRUD + apply）
- **DB**：新增 `publish_insights` 表（platform + account + hour_of_week 主键）+ `content_templates` 表（template JSONB）
- **Frontend**：`PublishPage` 新增「智能排期」入口 + 最佳时段网格；新增「内容模板」选择器
- **Scheduler**：注册 `_insights_aggregator_worker()` 每小时聚合

## Layer

- API: `web_runner/routes/scheduling.py` · `web_runner/routes/templates.py`
- DB: `web_runner/db.py`
- Frontend: `src/Pages/PublishPage.tsx`
- AI sidebar: 复用现有 prompt 注入通道

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- design.md: [`design.md`](design.md)
- 依赖 Phase 1: `content_metrics` 表（用于聚合 insights）
