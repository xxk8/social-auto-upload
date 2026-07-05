## Why

当前 AI 能力局限于"单平台对话式生成"——用户在 AI Sidebar 中与模型聊天，得到的结果手动应用到一个平台的发布表单。这要求用户自己理解每个平台的风格差异并分别生成。

自媒体运营者的核心需求是：**输入一个主题，一键获得所有平台的适配内容**。抖音要短平快，小红书要种草体，B站要标题党，快手要接地气。当前流程需要用户逐平台与 AI 对话，效率低且对新手不友好。

此外，发布时标签全靠手填，缺少基于内容的智能推荐；定时发布的时间选择也没有数据支撑。

## What Changes

- 新增 **多平台结构化生成 API**：`POST /api/ai/generate/multi-platform`，接收主题 + 目标平台列表，返回每个平台的 `{title, description, tags}` 结构化 JSON
- 新增 **智能标签推荐 API**：`POST /api/ai/recommend-tags`，根据标题和内容推荐热门标签
- 前端发布页面新增 **"一键生成全部平台"按钮**，调用多平台 API，结果以平台卡片形式展示，用户可逐平台编辑后一键发布
- 前端标签输入组件升级为 **标签推荐器**，输入标题后自动推荐可点击的标签 chips
- 保留现有单平台对话式 AI Sidebar 作为高级模式，新增的结构化生成作为快速模式

## Capabilities

### New Capabilities

- `multi-platform-generate`: 多平台结构化内容生成——输入主题，输出每个平台适配的标题/描述/标签 JSON，含平台风格 prompt 模板管理和 SSE 流式返回
- `smart-tag-recommend`: 智能标签推荐——根据标题+内容+平台，AI 推荐标签候选列表，前端以 chip 形式展示供一键选用

### Modified Capabilities

- `ai-stream-multimessage`: 在现有 SSE 流式转发基础上，新增 `response_format: { type: "json_object" }` 支持，使模型返回结构化 JSON（用于多平台生成场景）

## Impact

- **CLI**: 无直接影响，新增能力仅通过 Web API 暴露
- **Web API** (`web_runner/routes/ai.py`): 新增 2 个端点，新增平台风格 prompt 模板
- **Frontend**: 发布页面新增多平台生成面板，标签输入组件升级，新增 hooks 和 API client 方法
- **依赖**: 无新依赖，复用现有 OpenRouter SSE 基础设施
