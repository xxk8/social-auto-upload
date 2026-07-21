# content-metrics

> **Moved from `product-roadmap-2026q3` on 2026-07-12 (umbrella decomposition).** 内容未变更，仅目录搬迁。

发布后效果数据追踪能力。

## ADDED Requirements

### Requirement: 平台效果数据拉取

The system SHALL 定时从各平台 API 拉取已发布内容的互动数据（播放量、点赞、评论、分享）。

#### Scenario: 定时轮询拉取效果数据
- GIVEN 已发布的任务记录（status=success）
- WHEN 定时任务触发（每小时）
- THEN 系统调用对应平台 API 拉取该任务的效果数据
- AND 更新 `content_metrics` 表（upsert by task_id + platform）

#### Scenario: 平台 API 限流保护
- GIVEN 某平台 API 返回 429 限流
- THEN 系统跳过该平台本轮轮询
- AND 记录限流日志
- AND 下一轮轮询正常执行

#### Scenario: 平台 API 不可用
- GIVEN 某平台 API 返回 5xx 或超时
- THEN 系统保留 `content_metrics` 中已有数据不变
- AND 记录错误日志
- AND 不影响其他平台的数据拉取

### Requirement: 效果数据查询

The system SHALL 提供效果数据的聚合查询接口。

#### Scenario: 按平台聚合效果数据
- GIVEN 指定时间范围和平台
- WHEN 调用 `/api/metrics/summary`
- THEN 返回该平台在该时间范围内的总播放/点赞/评论/分享

#### Scenario: 按账号聚合效果数据
- GIVEN 指定时间范围
- WHEN 调用 `/api/metrics/accounts`
- THEN 返回每个账号的聚合效果数据（含成功率）

#### Scenario: 单任务效果详情
- GIVEN 指定 task_id
- WHEN 调用 `/api/metrics/tasks`
- THEN 返回该任务的详细效果数据（各平台维度）

### Requirement: 效果看板展示

The system SHALL 前端应提供效果数据的可视化看板。

#### Scenario: 效果 Tab 展示
- GIVEN 用户访问 AnalyticsPage
- WHEN 切换到「效果」Tab
- THEN 展示效果摘要卡片（总播放/点赞/评论/分享）
- AND 展示按平台效果对比图表
- AND 展示按时间段效果趋势图

#### Scenario: 账号效果排行
- GIVEN 用户访问 AnalyticsPage 效果 Tab
- WHEN 页面加载
- THEN 展示按效果指标排序的账号列表

#### Scenario: 手动刷新效果数据
- GIVEN 用户点击「刷新效果数据」按钮
- WHEN 调用 `/api/metrics/refresh`
- THEN 系统立即触发一轮效果数据拉取
- AND 返回刷新状态
