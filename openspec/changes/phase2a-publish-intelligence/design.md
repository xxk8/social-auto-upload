## Context

Phase 2a 在 Phase 1 效果数据闭环之上，提供"何时发 + 发什么"两条横切能力。父 umbrella `product-roadmap-2026q3` 把这一 Phase 命名为"智能排期 + 内容模板"，对应效果数据已被消费的两条主要场景。

继承自 umbrella 的关键技术决策：

- 排期推荐以 `publish_insights` 预聚合表承载，按 platform + account + hour_of_week 维度，每小时更新一次
- 历史数据 < 7 天时降级为"数据积累中"提示，不强行推荐
- 模板存储为 JSONB，结构可由模板作者定义（不强制 schema）
- 模板"应用"走现有 AI 侧边栏，模板作为 prompt 前缀注入

## Goals / Non-Goals

**Goals:**

- 任意已积累 ≥7 天数据的平台 + 账号组合，能输出 Top 3 最佳时段
- 同一账号相邻任务间隔 ≥ 2 小时（避免密集发布被平台限流）
- 模板 CRUD 全套，前端列表/编辑/应用一体化

**Non-Goals:**

- 不实现 ML 预测（仅基于历史加权平均，避免 Phase 2 引入 ML 依赖）
- 不实现模板市场 / 跨用户分享（v1 用户私有）
- 不实现模板版本控制（最新一次保存覆盖前次）

## Decisions

### 1. 排期粒度：hour_of_week 而非 hour_of_day

**决定**: `publish_insights` 主键为 `(platform, account, hour_of_week)`，每周 168 个 bin。

**理由**: 工作日/周末效应显著，`hour_of_day` 会把"周一早 9 点"和"周日早 9 点"混在一起；hour_of_week 区分度更高，且 bin 数量可控。

### 2. 模板存储：JSONB + 结构校验在应用层

**决定**: `content_templates.template` 字段为 JSONB，结构由前端 schema 校验；后端只校验 JSON 合法性 + 必填占位符。

**理由**: 不同平台 / 不同模板类型的字段差异较大；schema 在前端 form schema 工具（如 zod）中维护最自然，后端做最小化校验。

### 3. 模板应用：prompt 注入而非代码生成

**决定**: `POST /api/templates/{id}/apply` 把模板内容作为 prompt prefix 注入现有 AI 侧边栏，AI 返回的标题 / 描述 / 标签自动回填发布表单。

**理由**: 复用现有 AI 侧边栏 SSE 通道，不另起一条独立 LLM 通道。

### 4. 自动排期：保守间距

**决定**: 同一账号相邻任务间隔 ≥ 2 小时，跨账号不限。

**理由**: 平台对同账号高频发布敏感；跨账号是不同主体的内容，互不影响。

## Risks / Trade-offs

- **数据冷启动** → 7 天阈值 + 空状态提示 + 用户可选"忽略推荐"
- **模板结构漂移** → 模板版本 v1 不维护，后续 v2 引入 version 字段
- **AI 模板应用偶发超时** → SSE 通道已有断线重连，沿用

## Open Questions

- 平台特定最佳时段是否需要剔除"凌晨 2-6 点"等低活跃时段？
- 模板是否需要支持"图片占位符"（目前 prompt-only 即可覆盖）？

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- 兄弟子变更: [`phase1-content-publish-loop`](../../phase1-content-publish-loop/) · [`phase2b-media-production`](../../phase2b-media-production/) · [`phase3-trust-and-monitoring`](../../phase3-trust-and-monitoring/) · [`phase4-collab-and-monetization`](../../phase4-collab-and-monetization/)
- 依赖 Phase 1 产出: `content_metrics` 表（用于聚合 insights）
- 复用现有模块: `sau_web/frontend/src/Pages/PublishPage.tsx` · AI sidebar 现有 prompt 注入通道
