# rss-auto-ingest

RSS / Atom 源自动抓取 + 自动创建发布任务能力。

## ADDED Requirements

### Requirement: RSS 订阅管理

The system SHALL 用户应能添加、查询、删除 RSS 源订阅；每条订阅可绑定一个内容模板。

#### Scenario: 订阅 RSS 源
- GIVEN 用户输入 RSS 源 URL + 选择目标平台 + 选择内容模板
- WHEN 调用 `POST /api/rss/subscribe`
- THEN 系统保存订阅到 `rss_sources` 表
- AND 返回订阅详情

#### Scenario: 查询订阅列表
- GIVEN 用户请求订阅列表
- WHEN 调用 `GET /api/rss/sources`
- THEN 返回该用户所有订阅

#### Scenario: 取消订阅
- GIVEN 用户选择取消订阅
- WHEN 调用 `DELETE /api/rss/sources/{id}`
- THEN 系统删除该订阅

### Requirement: 定时抓取

The system SHALL 定时轮询所有订阅的 RSS 源，按 link hash 去重后把新内容匹配到模板并创建发布任务。

#### Scenario: 自动抓取新内容
- GIVEN 定时 worker 触发（每小时）
- WHEN 系统轮询所有订阅
- THEN 使用 feedparser 解析每个 RSS / Atom 源
- AND 对比已抓取 link hash 表，过滤出新条目
- AND 对新条目应用模板 → 创建发布任务

#### Scenario: 抓取失败不阻断其他源
- GIVEN 某个 RSS 源抓取失败（解析错误 / 网络超时）
- WHEN 系统轮询所有订阅
- THEN 记录错误日志
- AND 继续处理其他源

### Requirement: 模板匹配

The system SHALL 支持把 RSS 条目（title / description / link / pubDate）按模板规则生成发布文案。

#### Scenario: 模板字段映射
- GIVEN 模板定义字段映射（如 `{{title}}` → RSS entry.title）
- WHEN 应用模板到 RSS 条目
- THEN 系统替换占位符为实际 RSS 字段值
- AND 生成标题 / 描述 / 标签
