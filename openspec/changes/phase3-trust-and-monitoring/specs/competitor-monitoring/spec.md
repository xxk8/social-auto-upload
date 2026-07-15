# competitor-monitoring

竞品账号发布频率与内容监控能力。

## ADDED Requirements

### Requirement: 竞品追踪

The system SHALL 用户应能添加竞品账号、查询追踪列表、设置抓取频率。

#### Scenario: 添加竞品账号
- GIVEN 用户输入竞品账号 + 平台 + 抓取频率
- WHEN 调用 `POST /api/competitor/track`
- THEN 系统保存到 `competitor_tracks` 表
- AND 返回追踪详情

#### Scenario: 抓取竞品发布
- GIVEN 系统积累了竞品追踪列表
- WHEN 定时 worker 触发（按用户配置频率，默认每天）
- THEN 系统抓取竞品最新发布内容
- AND 落到 `competitor_posts` 表（去重 by post_id）

#### Scenario: 反爬降级
- GIVEN 抓取返回 403 / 反爬验证
- WHEN 系统记录失败次数
- THEN 自动降级为缓存数据展示
- AND 不影响其他账号抓取

### Requirement: 对标报告

The system SHALL 能基于竞品 + 自身数据生成按天级聚合的对标报告。

#### Scenario: 生成对标报告
- GIVEN 用户选择时间范围（默认 7 天）
- WHEN 调用 `GET /api/competitor/report`
- THEN 系统聚合自身发布 vs 竞品发布数据
- AND 返回按天对比（发布条数 / 平台分布 / 平均播放预估）

#### Scenario: 多竞品对比
- GIVEN 用户同时追踪 N 个竞品
- WHEN 调用对标报告接口
- THEN 报告同时展示 N 个竞品的对比
- AND 支持排序（按发布频率 / 按互动估算）
