## Phase 3 — 合规 + 监控 + 开放

> 本子变更从父 umbrella `product-roadmap-2026q3` 摘录任务 24-35。共 46 个 checkbox。

### 24. 内容合规预检 — 依赖安装（Web API）

- [ ] 24.1 新增 `pyahocorasick` 到 `pyproject.toml` 依赖
- [ ] 24.2 新增 `feedparser` 到 `pyproject.toml` 依赖

### 25. 内容合规预检 — DB Schema（Web API）

- [ ] 25.1 新增 `compliance_rules` 表（平台 + 关键词 + 规则类型）
- [ ] 25.2 新增内置敏感词库（基础违规词 + 平台特定规则）
- [ ] 25.3 新增 `compliance_rules` CRUD helpers

### 26. 内容合规预检 — 核心逻辑（Web API）

- [ ] 26.1 新增 `web_runner/routes/compliance.py` 蓝图
- [ ] 26.2 实现 `_build_automaton(keywords)` — 使用 pyahocorasick 构建匹配自动机
- [ ] 26.3 实现 `_check_text(text, automaton)` — O(n) 敏感词匹配
- [ ] 26.4 实现 `_check_platform_rules(platform, text)` — 平台特定规则检查
- [ ] 26.5 实现 `POST /api/compliance/check` — 文本合规检查
- [ ] 26.6 实现 `POST /api/compliance/check/batch` — 批量文本合规检查

### 27. 内容合规预检 — API 路由（Web API）

- [ ] 27.1 实现 `GET /api/compliance/rules` — 获取合规规则列表
- [ ] 27.2 实现 `POST /api/compliance/rules` — 创建自定义规则
- [ ] 27.3 实现 `DELETE /api/compliance/rules/{id}` — 删除规则

### 28. 内容合规预检 — 前端 UI（Frontend）

- [ ] 28.1 PublishPage 新增「合规检查」按钮（发布前自动触发）
- [ ] 28.2 实现合规检查结果展示（命中词 + 建议修改）
- [ ] 28.3 实现合规规则管理页面
- [ ] 28.4 实现自定义敏感词库上传

### 29. RSS 自动抓取 — 核心逻辑（Web API）

- [ ] 29.1 新增 `web_runner/routes/rss.py` 蓝图
- [ ] 29.2 实现 `_fetch_rss_feed(url)` — 使用 feedparser 解析 RSS
- [ ] 29.3 实现 `_match_rss_to_template(feed_item, template)` — RSS 内容匹配模板
- [ ] 29.4 实现 `POST /api/rss/subscribe` — 订阅 RSS 源
- [ ] 29.5 实现 `GET /api/rss/sources` — 获取订阅列表
- [ ] 29.6 实现 `DELETE /api/rss/sources/{id}` — 取消订阅

### 30. RSS 自动抓取 — 定时任务（Web API）

- [ ] 30.1 实现 `_rss_poll_worker()` — 定时轮询 RSS 源（每小时）
- [ ] 30.2 实现新内容自动创建发布任务
- [ ] 30.3 注册定时任务到 Flask app

### 31. RSS 自动抓取 — 前端 UI（Frontend）

- [ ] 31.1 新增 RSS 订阅管理页面
- [ ] 31.2 实现 RSS 源添加/删除
- [ ] 31.3 实现 RSS 新内容预览
- [ ] 31.4 实现 RSS 内容自动发布配置

### 32. 竞品监控 — 核心逻辑（Web API）

- [ ] 32.1 新增 `web_runner/routes/competitor.py` 蓝图
- [ ] 32.2 实现 `_fetch_competitor_posts(account)` — 抓取竞品账号发布内容
- [ ] 32.3 实现 `_generate_comparison_report()` — 生成对标报告
- [ ] 32.4 实现 `POST /api/competitor/track` — 添加竞品账号追踪
- [ ] 32.5 实现 `GET /api/competitor/report` — 获取对标报告

### 33. 竞品监控 — 前端 UI（Frontend）

- [ ] 33.1 新增竞品监控页面
- [ ] 33.2 实现竞品账号添加/管理
- [ ] 33.3 实现对标报告展示

### 34. 通知系统（Web API）

- [ ] 34.1 新增 `web_runner/routes/notifications.py` 蓝图
- [ ] 34.2 实现 `_send_webhook(url, payload)` — 发送 Webhook 通知
- [ ] 34.3 实现 `POST /api/notifications/webhook` — 配置 Webhook URL
- [ ] 34.4 实现任务完成/失败时自动触发通知

### 35. A/B 测试（Web API + Frontend）

- [ ] 35.1 tasks 表新增 `ab_test_group` 字段（A/B 组标识）
- [ ] 35.2 实现 `POST /api/tasks/ab-test` — 创建 A/B 测试任务（同内容不同标题/封面）
- [ ] 35.3 实现 A/B 测试效果对比展示（复用 content_metrics）
