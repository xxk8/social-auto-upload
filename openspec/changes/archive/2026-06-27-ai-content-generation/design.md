## Context

当前 AI 能力已完整实现：多-turn SSE 流式对话、Form Bridge（AI 结果自动填入发布表单）、OpenRouter 密钥轮换、prompt 增强、prompt 模板、历史记录。

但存在两个核心体验瓶颈：
1. **单平台逐一对话**：用户需要为每个平台分别与 AI 对话，手动调整风格
2. **标签全靠手填**：发布时没有基于内容的智能标签推荐

现有架构关键路径：
- 前端 `useChatActions` → `buildChatPayload` → `api.generateMessagesStream` → 后端 `/api/ai/generate/stream` → `_stream_openrouter`
- 后端 `PLATFORM_PROMPTS` 已有 4 个平台的风格 prompt（douyin/xiaohongshu/kuaishou/bilibili）
- 后端 `_stream_openrouter` 已支持 SSE 流式返回 + 429 密钥轮换

## Goals / Non-Goals

**Goals:**
- 用户输入一个主题，一键获得所有目标平台的结构化内容（标题/描述/标签）
- 每个平台的内容自动适配该平台的风格（抖音短平快 vs 小红书种草体）
- 输入标题后自动推荐可点击的标签 chips
- 复用现有 SSE 基础设施和密钥管理，不引入新依赖

**Non-Goals:**
- 不做"最佳发布时间推荐"（需要历史数据积累，后续单独做）
- 不做视频/图片 AI 生成（仅文本）
- 不修改现有单平台对话式 AI Sidebar（作为高级模式保留）
- 不做 AI 内容审核/合规检测
- 不引入新的外部依赖或 LLM provider

## Decisions

### Decision 1: 多平台生成采用"并行独立调用"而非"单次调用返回多平台 JSON"

**选择**: 对每个目标平台独立调用 `_stream_openrouter`，每个平台一次 LLM 调用。

**备选方案**: 单次调用要求模型返回 `{douyin: {...}, xiaohongshu: {...}}` 的嵌套 JSON。

**理由**:
- 单次调用的 JSON 输出不稳定，模型经常格式错误，需要额外的解析和重试逻辑
- 并行调用可以利用现有 `_stream_openrouter` 和 SSE 基础设施，零改动
- 单平台失败不影响其他平台，容错性更好
- 每个平台可以独立流式返回，前端可以逐平台展示结果而非等待全部完成

**实现**: 后端新增 `/api/ai/generate/multi-platform`，内部用 `ThreadPoolExecutor` 并行调用 N 次 `_stream_openrouter`，通过 SSE 逐平台推送结果。

### Decision 2: 结构化 JSON 输出通过 response_format + 解析 prompt 实现

**选择**: 在 system prompt 中明确要求模型返回 JSON 格式，并在后端做 JSON 解析 + 容错。

**备选方案**: 使用 OpenRouter 的 `response_format: { type: "json_object" }` 参数。

**理由**:
- `response_format` 并非所有免费模型都支持，会导致部分模型报错
- 通过 prompt 约束更通用，兼容所有模型
- 后端解析时做 `json.loads` + 正则提取 fallback（模型可能在 JSON 前后加说明文字）

### Decision 3: 标签推荐复用现有 `/api/ai/generate/stream` 端点

**选择**: 不新增独立的标签推荐 API 端点，而是在前端通过构造特定 prompt 调用现有流式端点。

**备选方案**: 新增 `POST /api/ai/recommend-tags` 端点。

**理由**:
- 标签推荐本质是一次 LLM 调用，不需要特殊的后端逻辑
- 复用现有端点减少代码和测试维护量
- 前端构造 prompt 更灵活，可以包含表单上下文

**实现**: 前端新增 `useTagRecommendation` hook，构造"根据以下标题和内容推荐 N 个标签"的 prompt，调用 `api.generateMessagesStream`，解析返回的 JSON 标签列表。

### Decision 4: 前端新增 MultiPlatformGeneratePanel 组件，嵌入发布页面

**选择**: 在 PublishPage 中新增一个可折叠的面板，位于发布表单上方或侧边。

**布局**:
- 快速模式（默认）: 多平台结构化生成面板，输入主题 → 选择平台 → 一键生成 → 卡片展示结果
- 高级模式: 现有 AI Sidebar（多-turn 对话），通过 tab 切换

**理由**:
- 快速模式覆盖 80% 场景（"帮我生成所有平台的文案"），高级模式覆盖 20% 场景（"帮我优化这个标题的措辞"）
- 卡片展示结果让用户一眼看到所有平台的内容差异，便于对比和编辑

## Risks / Trade-offs

**[风险] 免费模型 JSON 输出不稳定** → 在 system prompt 中强调 JSON 格式 + 后端做正则提取 fallback + 前端解析失败时显示原始文本并允许手动编辑。降级方案：如果 JSON 解析失败，将原始文本作为 `description` 字段，`title` 和 `tags` 留空。

**[风险] 并行调用耗尽 API 配额** → 限制最大并行平台数为 4（与现有 semaphore=2 对齐），超出的平台排队等待。前端显示"生成中"进度指示。

**[风险] 多平台生成增加 API 调用成本** → 使用免费模型（当前默认 `google/gemma-4-26b-a4b-it:free`），单次多平台生成（4 平台）= 4 次免费调用。通过 usage_metering 限制每日生成次数（免费用户 10 次/天）。

**[权衡] 标签推荐不走独立端点** → 好处是零后端改动；坏处是无法做标签热度排序（需要平台热搜数据）。当前阶段接受这个权衡，后续可扩展。
