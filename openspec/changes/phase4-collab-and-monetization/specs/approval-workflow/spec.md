# approval-workflow

任务级审批流能力：owner 可批准 / 驳回待发布的任务。

> **schema 现状**：`tasks.approval_status` 字段已在 `web_runner/db.py` 就位（`pending | approved | rejected | NULL`）。本 spec 关注路由 + UI 集成的补全。

## ADDED Requirements

### Requirement: 审批路由

The system SHALL 提供 `POST /api/tasks/{id}/approve` 与 `POST /api/tasks/{id}/reject` 路由。

#### Scenario: 审批通过
- GIVEN 任务 owner 触发审批
- WHEN 调用 `POST /api/tasks/{id}/approve`
- THEN 系统更新 `approval_status = 'approved'`
- AND 记录审批人 / 审批时间
- AND 任务可继续进入发布流程

#### Scenario: 驳回附意见
- GIVEN 任务 owner 触发驳回
- WHEN 调用 `POST /api/tasks/{id}/reject` 并附 `rejection_reason`
- THEN 系统更新 `approval_status = 'rejected'`
- AND 保存驳回原因到 `rejection_reason` 字段
- AND 任务不进入发布流程

#### Scenario: 仅 owner 可审批
- GIVEN 非任务 owner 用户尝试审批
- WHEN 调用审批路由
- THEN 系统返回 403 Forbidden
- AND 记录未授权访问日志

### Requirement: UI 集成

The system SHALL TasksPage 应展示审批状态列 + owner 审批操作按钮。

#### Scenario: 审批状态列展示
- GIVEN 用户访问 TasksPage
- WHEN 列表加载
- THEN 展示 `approval_status` 列（pending / approved / rejected badge）
- AND 仅 owner 行展示「批准 / 驳回」操作按钮

#### Scenario: 驳回意见编辑
- GIVEN owner 点击「驳回」按钮
- WHEN 弹窗输入驳回意见并确认
- THEN 系统调用 reject 路由
- AND 列表行更新为 rejected + 显示意见摘要

### Requirement: 审批通知

The system SHALL 在审批状态变化时通知申请人（站内消息或邮件，v1 仅站内消息）。

#### Scenario: 审批结果站内通知
- GIVEN 任务状态从 pending 变为 approved / rejected
- WHEN 系统更新状态
- THEN 系统向任务创建者发送站内通知
- AND 通知中心展示审批结果 + 链接到任务详情
