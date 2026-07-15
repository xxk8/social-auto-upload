# content-templates

可复用内容模板管理能力。

> **历史说明**：本 spec 由原 `product-roadmap-2026q3/specs/batch-templates/spec.md` 的「内容模板管理」+「模板应用」章节拆分而来。批量导入部分移至 [`phase1-content-publish-loop/specs/batch-import/spec.md`](../../../phase1-content-publish-loop/specs/batch-import/spec.md)。

## ADDED Requirements

### Requirement: 模板 CRUD

The system SHALL 支持用户创建、查询、删除自己的内容模板；模板内容以 JSONB 存储，结构由模板作者定义。

#### Scenario: 创建模板
- GIVEN 用户填写模板名称、平台、内容结构
- WHEN 调用 `POST /api/templates`
- THEN 系统保存模板到 `content_templates` 表
- AND 返回创建成功的模板

#### Scenario: 获取模板列表
- GIVEN 用户请求模板列表
- WHEN 调用 `GET /api/templates`
- THEN 返回该用户的所有模板（按更新时间倒序）

#### Scenario: 删除模板
- GIVEN 用户选择删除某模板
- WHEN 调用 `DELETE /api/templates/{id}`
- THEN 系统删除该模板
- AND 返回删除成功

### Requirement: 模板应用

The system SHALL 支持将模板应用到 AI 内容生成，把模板内容作为 prompt 前缀注入现有 AI 侧边栏。

#### Scenario: 应用模板生成内容
- GIVEN 用户选择一个模板
- WHEN 调用 `POST /api/templates/{id}/apply`
- THEN 系统将模板作为 prompt 前缀发送给 AI
- AND 返回生成的内容（标题/描述/标签）
- AND 自动填充到发布表单

#### Scenario: 自定义模板创建
- GIVEN 用户点击「创建模板」
- WHEN 填写模板名称、选择平台、定义内容结构
- THEN 系统保存自定义模板
- AND 模板出现在模板列表中
