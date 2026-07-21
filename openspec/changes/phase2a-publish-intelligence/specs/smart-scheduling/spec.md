# smart-scheduling

> **Moved from `product-roadmap-2026q3` on 2026-07-12 (umbrella decomposition).** 内容未变更，仅目录搬迁。

基于历史数据的智能排期推荐能力。

## ADDED Requirements

### Requirement: 最佳时段计算

The system SHALL 基于历史发布数据，计算每个平台/账号的最佳发布时段。

#### Scenario: 定时聚合最佳时段
- GIVEN 系统积累了 ≥7 天的发布 + 效果数据
- WHEN 定时聚合任务触发（每小时）
- THEN 系统按 platform + account + hour_of_week 聚合历史效果数据
- AND 计算每个时段的加权平均效果分
- AND 更新 `publish_insights` 表

#### Scenario: 数据不足时不推荐
- GIVEN 某账号/平台的历史数据 < 7 天
- WHEN 查询最佳时段
- THEN 返回空推荐 + 提示"数据积累中"

### Requirement: 最佳时段推荐

The system SHALL 向用户推荐最佳发布时间。

#### Scenario: 查询推荐时间
- GIVEN 用户选择平台和账号
- WHEN 调用 `/api/scheduling/insights`
- THEN 返回 7×24 时段网格的效果分热力图
- AND 标注 Top 3 推荐时段

#### Scenario: 一键采纳推荐时间
- GIVEN 用户在推荐网格中选择一个时段
- WHEN 点击「采纳」
- THEN 自动填充定时发布时间到发布表单

### Requirement: 批量自动排期

The system SHALL 支持批量任务自动分配到最佳时段。

#### Scenario: 批量任务自动排期
- GIVEN 用户有 N 条待发布任务
- WHEN 调用 `/api/scheduling/auto-assign`
- THEN 系统将 N 条任务分配到未来一周的最佳时段
- AND 避免同一账号短时间内密集发布（间隔 ≥ 2 小时）
- AND 返回分配结果供用户确认

#### Scenario: 避免密集发布
- GIVEN 同一账号已有任务在 T 时刻
- WHEN 自动排期分配新任务
- THEN 新任务的发布时间与已有任务间隔 ≥ 2 小时
