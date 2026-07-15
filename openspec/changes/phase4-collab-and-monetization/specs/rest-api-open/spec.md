# rest-api-open

面向第三方系统的开放 REST API 能力，含 API Key 鉴权。

> **现状**：`web_runner/routes/api_v1.py` 已部分就位（`/api/v1/publish` + `/api/v1/tasks/{id}` + `/api/v1/openapi.json`），本 spec 关注鉴权补全 + 文档完善。

## ADDED Requirements

### Requirement: API Key 管理

The system SHALL 用户应能创建、查询、吊销 API Key；Key 与 user_id 绑定，含作用域（scope）字段。

#### Scenario: 创建 API Key
- GIVEN 用户输入 name + scope（如 `publish:write` / `publish:read`）
- WHEN 调用 `POST /api/v1/keys`
- THEN 系统生成随机 key（建议 32 字节 URL-safe base64）
- AND 保存 hash 到 `api_keys` 表（schema 已就位）
- AND 一次性返回明文 key（后续只返回 hash 前 8 位用于识别）

#### Scenario: 吊销 API Key
- GIVEN 用户选择吊销某 Key
- WHEN 调用 `DELETE /api/v1/keys/{id}`
- THEN 系统标记 Key 为 revoked
- AND 后续请求返回 401

### Requirement: 鉴权中间件

The system SHALL 所有 `/api/v1/*` 路由应走 API Key 鉴权中间件。

#### Scenario: 有效 Key
- GIVEN 请求 header `Authorization: Bearer <key>`
- WHEN 中间件校验
- THEN 比对 hash 成功 + 未 revoked + scope 匹配
- AND 放行到业务 handler

#### Scenario: 无效 Key
- GIVEN 请求 header 缺失 / Key 错误 / Key revoked
- WHEN 中间件校验
- THEN 返回 401 Unauthorized
- AND 不暴露具体原因（避免信息泄漏）

#### Scenario: scope 不足
- GIVEN Key scope 为 `publish:read` 但请求调用 `publish:write` 端点
- WHEN 中间件校验
- THEN 返回 403 Forbidden
- AND 提示"scope 不足"

### Requirement: 开放端点

The system SHALL expose `/api/v1/publish` and `/api/v1/tasks/{id}` as open endpoints for third-party integrations, gated by API Key authentication with scope-based access control.

#### Scenario: 触发发布
- GIVEN 调用方有 `publish:write` scope
- WHEN POST `/api/v1/publish` 含 platform / account / file / title
- THEN 系统创建 task 并返回 task_id
- AND 后续通过 GET `/api/v1/tasks/{id}` 查询进度

#### Scenario: 查询任务
- GIVEN 调用方有 `publish:read` scope
- WHEN GET `/api/v1/tasks/{id}`
- THEN 返回任务状态 / 进度 / 错误信息
- AND 调用方应仅能查询自己 user_id 下的 task（越权返回 404）

### Requirement: OpenAPI 文档

The system SHALL `GET /api/v1/openapi.json` 应自动从 Flask 路由反射生成。

#### Scenario: 文档自动生成
- GIVEN 路由注册完成
- WHEN 调用 `/api/v1/openapi.json`
- THEN 返回符合 OpenAPI 3 规范的 JSON
- AND 包含所有 `/api/v1/*` 端点的 path / method / request / response schema

#### Scenario: 文档与代码同步
- GIVEN 开发者修改路由
- WHEN 重新加载应用
- THEN openapi.json 自动反映新路由
- AND 不需要手动维护 schema 文件
