## Why

Phase 1-2b 解决了"发什么 + 何时发 + 怎么产"。Phase 3 在此基础上引入**风险前置 + 外部信号接入 + 可观测性**：

1. **合规风险前置**：发布前无敏感词/违规内容预检，依赖人工审核，容易被平台限流
2. **外部信号接入**：运营盯竞品 / RSS 是高 ROI 但高耗时的重复劳动
3. **结果可观测**：任务完成 / 失败时需要主动通知（飞书 / 钉钉 / Slack），不能等用户回来看

A/B 测试则是 Phase 1 `content_metrics` 的衍生应用：已有数据 → 加分组字段 → 自动对比。

## What Changes

落地五个 capability：

- **`content-compliance`**：pyahocorasick Aho-Corasick 自动机敏感词检测 + 平台特定规则 + 内置/用户扩展双层规则库 + 发布前自动检查
- **`rss-auto-ingest`**：feedparser 解析 RSS / Atom 源 + 定时抓取 + 模板匹配 + 自动创建任务
- **`competitor-monitoring`**：复用 requests 抓取竞品账号 + 按天聚合 + 对标报告
- **`notification-system`**：Webhook 通用通知 + 重试 + 用户可配置 URL
- **`ab-testing`**：tasks 表新增 `ab_test_group` 字段 + 复用 content_metrics 做组间对比

## Capabilities

- 新增 `content-compliance`
- 新增 `rss-auto-ingest`
- 新增 `competitor-monitoring`
- 新增 `notification-system`
- 新增 `ab-testing`

## Impact

- **新增依赖**：`pyahocorasick`, `feedparser`
- **Web API**：新增 `web_runner/routes/compliance.py`, `rss.py`, `competitor.py`, `notifications.py` 四个蓝图 + 扩展 `tasks.py`（A/B 字段 + 路由）
- **DB**：新增 `compliance_rules` 表（平台 + 关键词 + 规则类型）
- **Frontend**：`PublishPage` 发布前自动触发合规检查；新增 RSS 订阅管理 + 竞品监控 + 通知配置 + A/B 对比页面
- **Scheduler**：注册 `_rss_poll_worker()` + `_compliance_rule_aggregator()` + 通知重试 worker

## Layer

- API: `web_runner/routes/compliance.py` · `web_runner/routes/rss.py` · `web_runner/routes/competitor.py` · `web_runner/routes/notifications.py`
- DB: `web_runner/db.py`（新增 compliance_rules）
- Frontend: `src/Pages/PublishPage.tsx` · 新增 RSS / 竞品 / 通知 / A/B 子页面
- Scheduler: RSS 抓取 + 通知重试

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- design.md: [`design.md`](design.md)
- 依赖 Phase 1: `content_metrics` 表（A/B 对比）
- 依赖 Phase 2a: `content_templates` 表（RSS 模板匹配）
