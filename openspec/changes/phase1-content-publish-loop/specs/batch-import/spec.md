# batch-import

CSV 批量导入发布任务能力。

> **历史说明**：本 spec 由原 `product-roadmap-2026q3/specs/batch-templates/spec.md` 的「CSV 批量导入」章节拆分而来。模板管理部分移至 [`phase2a-publish-intelligence/specs/content-templates/spec.md`](../../../phase2a-publish-intelligence/specs/content-templates/spec.md)。

## ADDED Requirements

### Requirement: CSV 批量创建任务

The system SHALL 支持通过 CSV 文件批量创建发布任务，逐行解析、逐行校验、逐行创建，单行失败不阻断整批。

#### Scenario: 上传 CSV 批量创建任务
- GIVEN 用户上传包含 N 行的 CSV 文件
- WHEN 调用 `POST /api/tasks/batch`
- THEN 系统逐行解析并创建任务
- AND 返回每行的创建结果（成功/失败 + 错误信息）
- AND 单行失败不阻断整批处理

#### Scenario: CSV 校验
- GIVEN 用户上传的 CSV 文件
- WHEN 系统解析 CSV
- THEN 校验必填字段（platform, file, title）
- AND 校验 platform 是否在支持列表中
- AND 校验 file 路径是否存在
- AND 校验 schedule 格式（如提供）
- AND 返回逐行校验结果

#### Scenario: 下载 CSV 模板
- GIVEN 用户点击「下载模板」
- WHEN 调用 `GET /api/tasks/batch/template`
- THEN 返回预填表头的 CSV 文件

#### Scenario: 批量导入预览
- GIVEN 用户上传 CSV 文件
- WHEN 前端解析 CSV
- THEN 展示预览表格（含逐行校验状态）
- AND 用户确认后才提交
