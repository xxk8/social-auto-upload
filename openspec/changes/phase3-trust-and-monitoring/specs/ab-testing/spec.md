# ab-testing

同内容不同标题 / 封面的 A/B 测试能力，复用 Phase 1 `content_metrics` 表做组间对比。

## ADDED Requirements

### Requirement: A/B 组标识

The system SHALL tasks 表应新增 `ab_test_group` 字段；同组的任务在 content_metrics 查询时按 group 聚合。

#### Scenario: 创建 A/B 测试任务
- GIVEN 用户输入 A/B 组名 + 两个变体（标题 / 封面不同）
- WHEN 调用 `POST /api/tasks/ab-test`
- THEN 系统创建 2 个 task，共享 `ab_test_group` 标识
- AND 各 task 落不同的 `ab_test_variant` 字段（A / B）

### Requirement: 效果对比

The system SHALL 基于 `content_metrics` 聚合同组不同 variant 的互动数据。

#### Scenario: 聚合 A/B 对比
- GIVEN 用户输入 A/B 组名 + 时间范围
- WHEN 调用 `GET /api/ab-test/compare?group=xxx`
- THEN 系统按 variant 聚合 views / likes / comments
- AND 返回各 variant 的平均互动 + 提升百分比
- AND 标注样本量与置信度

#### Scenario: 样本量不足提示
- GIVEN A/B 组样本量 < 30 / variant
- WHEN 用户查看对比
- THEN UI 展示"样本不足，结论仅供参考"提示
- AND 不展示显著性结论

#### Scenario: 复用 content_metrics
- GIVEN content_metrics 表已有 task_id → platform → 互动数据映射
- WHEN 聚合 A/B 对比
- THEN 系统不另起新表，仅按 task_id JOIN 现有 metrics
- AND 性能受现有 content_metrics 索引保护
