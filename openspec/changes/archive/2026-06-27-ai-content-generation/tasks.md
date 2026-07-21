## 1. 后端：多平台生成 API

- [x] 1.1 在 `web_runner/routes/ai.py` 中新增 `PLATFORM_STYLE_PROMPTS` 字典，覆盖全部 7 个平台的风格 prompt 模板（douyin/xiaohongshu/kuaishou/bilibili/tencent/tiktok/baijiahao），每个 prompt 包含 JSON 输出格式指令（要求返回 `{title, description, tags}`）
- [x] 1.2 实现 `_generate_single_platform(model, topic, platform)` 函数：组装 platform-specific system prompt + user prompt，调用 `_stream_openrouter`，解析返回内容为 JSON（含正则提取 fallback），返回 `{platform, title, description, tags, parseError?}`
- [x] 1.3 实现 `POST /api/ai/generate/multi-platform` 端点：接收 `{topic, platforms[], model?}`，校验 platforms 非空且全部合法，使用 `ThreadPoolExecutor` 并行调用各平台，通过 SSE 逐平台推送 `event: platform_result` / `event: platform_error`，最后发送 `event: done`
- [x] 1.4 新增 `json_mode` 参数支持：在 `_stream_openrouter` 中，当请求体包含 `json_mode: true` 时，向 OpenRouter 请求追加 `response_format: { type: "json_object" }`
- [x] 1.5 为多平台端点编写单元测试：覆盖正常多平台生成、部分平台失败、空 platforms 拒绝、非法平台拒绝、JSON 解析 fallback 场景

## 2. 后端：平台风格 Prompt 模板完善

- [x] 2.1 补全 `PLATFORM_STYLE_PROMPTS` 中 tencent/tiktok/baijiahao 三个平台的 prompt（当前 `PLATFORM_PROMPTS` 仅覆盖 4 个平台）
- [x] 2.2 每个 prompt 模板中嵌入该平台的内容特征说明（如抖音 15 秒 hook、小红书 emoji 标题、B 站弹幕文化等），确保生成内容有平台原生感

## 3. 前端：API Client 扩展

- [x] 3.1 在 `sau_web/frontend/src/api/client.ts` 中新增 `generateMultiPlatformStream(topic, platforms, model?, signal?)` 方法，对接 `POST /api/ai/generate/multi-platform`，解析 SSE 的 `platform_result` / `platform_error` / `done` 事件
- [x] 3.2 定义 TypeScript 类型：`MultiPlatformRequest`、`PlatformResult`、`PlatformError`、`MultiPlatformDone`，放在 `src/lib/ai/types.ts`

## 4. 前端：多平台生成面板组件

- [x] 4.1 创建 `src/Components/MultiPlatformGenerate/` 目录，实现 `MultiPlatformGeneratePanel` 主组件：包含主题输入框、平台多选 checkbox 组、"一键生成"按钮、结果展示区
- [x] 4.2 实现 `PlatformResultCard` 子组件：展示单个平台的生成结果（标题/描述/标签），支持内联编辑每个字段，"应用到表单"按钮
- [x] 4.3 实现流式进度状态：生成中显示 skeleton 加载态，每个平台完成后立即展示对应卡片（不等待全部完成），失败平台显示错误信息 + 重试按钮
- [x] 4.4 在 `PublishPage` 中集成 `MultiPlatformGeneratePanel`，位于发布表单上方，可折叠收起
- [x] 4.5 实现"应用到表单"逻辑：点击某平台的结果卡片后，将 title/description/tags 填入当前发布表单，复用现有 `FormHandle.applyAiResult` 桥接

## 5. 前端：智能标签推荐

- [x] 5.1 创建 `src/hooks/useTagRecommendation.ts` hook：接收 `{title, description?, platform?}`，构造标签推荐 prompt，调用 `api.generateMessagesStream`，解析返回的 JSON 数组为 `string[]`
- [x] 5.2 创建 `src/Components/TagRecommendation/TagChipGroup.tsx` 组件：接收标签列表，渲染为可点击 chips，已选标签高亮，点击切换选中状态并回调 `onToggle(tag)`
- [x] 5.3 在发布表单的标签输入区域旁新增"推荐标签"按钮，点击触发 `useTagRecommendation`，结果通过 `TagChipGroup` 展示
- [x] 5.4 标签推荐按钮在标题为空时 disabled，推荐中显示 loading 态

## 6. 测试

- [x] 6.1 后端测试：`tests/test_ai_multi_platform.py`，覆盖多平台端点的正常流程、错误处理、并发行为
- [x] 6.2 前端测试：`MultiPlatformGeneratePanel.test.tsx`，覆盖渲染、生成交互、结果应用
- [x] 6.3 前端测试：`useTagRecommendation.test.ts`，覆盖 prompt 构造、JSON 解析、fallback
- [x] 6.4 前端测试：`TagChipGroup.test.tsx`，覆盖渲染、点击选中/取消
