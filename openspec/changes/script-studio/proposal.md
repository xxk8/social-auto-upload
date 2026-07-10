## Why

`social-auto-upload` 已经能"做完最后一个环节"——把现成的视频分发到 7 个平台，但**坐在最前面的"想出一个值得拍的脚本"完全没工具覆盖**。运营团队的实际现状是：

1. **脚本创作靠手写或外网 AI**：运营在 Notion / 飞书文档写分集剧情，再切图、生图、剪辑、上传。整个链路 7-8 个工具手动串联，每一步都要"复制粘贴"。
2. **没有"AI 自动跟进脚本"的钩子**：看到爆款 / 时事 / 灵感时，目前没有地方能「让 AI 围绕一个 idea 持续生成候选 → 我来筛」；所有跟进仍是一次性 chat。
3. **没有"看见跟进内容"的中台**：哪怕运营私下用 ChatGPT / Claude 输出了候选剧本，也没有一个项目化的视图把它们叠在一起看、版本对比、挑出可拍的那一集。
4. **没有"看起来就能拍"的结构化产物**：运营候选的往往是一段长 prose（"开头：主角醒来；中段：复仇高潮；结尾：真相大白"），没有人 / 没有工具把它拆成 Seedance 2.0 期望的时间轴分镜格式。
5. **闭环没用上我们已有的多平台上传能力**：今天哪怕有人手写完分镜、上传了成片，他也不会回到 SAU 把这些东西沉淀成可复用资产。

参考 `liangdabiao/Seedance2-Storyboard-Generator`（启发项目）的成功之处：把"小说 → 多集剧本 → 角色/场景/道具清单 → Seedance 2.0 时间轴分镜"做成一个可复用的 Claude Skill workflow，并把每集"尾帧"作为下一集的"片头"实现视频延长串联。但该项目**没有**视频生成 / 自动上传环节，刚好是我们补位的地方。

## What Changes

### 新增功能

#### v0.1 Script Studio 入口

- 新增 `/app/studio` 路由 + 侧边栏第 7 项「剧本工坊」（icon: `Clapperboard`，shortcut: `7`）
- 新增 `StudioPage` 主页面：项目列表 + 创建项目对话框
- 新增「项目」概念：每个项目绑定一个 idea，以项目为粒度聚合剧本 / 分集 / 资产 / 分镜导出

#### v0.1 剧本生成引擎

- 新增后端 `web_runner/routes/studio.py` Blueprint + `web_runner/studio_engine.py`
- 新增 3 张表：`studio_projects`、`studio_episodes`、`studio_assets`
- 新增 10 个 endpoint（v0.1–v0.3 全集；CRUD 4 + 流式 SSE 2 + 集级 2 + 导出 2；完整路由见 `specs/script-engine/spec.md` §路由表 与 `specs/storyboard-export/spec.md` §API 端点）。

  CRUD 4 个（v0.1，本 PR 前缀）：
  - `POST /api/studio/projects` 创建项目（输入 title + synopsis，style 可选）
  - `GET /api/studio/projects` 列出当前用户项目（按 updated_at DESC）
  - `GET /api/studio/projects/{id}` 项目详情（含关联 episodes + assets）
  - `DELETE /api/studio/projects/{id}` 删除项目 + FK CASCADE 至 episodes + assets

  流式 SSE 2 个（v0.2，OpenSpec 这里列出以便一次过描述）：
  - `POST /api/studio/projects/{id}/follow-up` 「AI 跟进脚本」单回合续写
  - `POST /api/studio/projects/{id}/generate` 「AI 自动生成剧本」四幕批量 N 集

  集级 2 个（v0.3）：
  - `PATCH /api/studio/episodes/{id}` 集级持久化（owner 鉴权 + schema 校验）
  - `POST /api/studio/episodes/{id}/assets` 单集手添资产（ascending code 自动分配）

  导出 GET 2 个（v0.3）：
  - `GET /api/studio/projects/{id}/episodes/{no}/export` 单集 Markdown
  - `GET /api/studio/projects/{id}/export` 全剧 .zip

#### v0.2 树形剧本查看与编辑

- 新增 `ScriptViewer`：树形结构展示（剧集 → 幕 → 场景 → 镜头）
- 新增 `AssetPlanner`：角色(C) / 场景(S) / 道具(P) 卡片网格
- 新增 `EpisodeEditor`：单集分镜的内联编辑（旁白、对白、镜头描述）
- 新增 `AiContinueButton`：在单行文本旁悬浮按钮，触发单点 AI 改写 / 续写

#### v0.3 分镜导出

- 新增 `StoryboardExport`：把单集渲染成 Seedance 2.0 时间轴 Prompt
- 支持单集复制 / 单集下载 `.md` / 全剧批量下载 `.zip`
- 分镜 Prompt 严格遵循启发项目格式（素材清单表 + 时间轴分段 + 音效 / @参考 + 尾帧描述）

### 数据流

```
用户创建项目
    ↓
输入 title + synopsis（一句话灵感）
    ↓
AI 自动生成剧本（四幕 × N 集）
    ↓
树形查看 → 单集编辑器（人机共创）
    ↓
选择保留的集 → 一键导出 Seedance 2.0 分镜
    ↓
（后续 v0.4+）生图 / 视频 → 串联到现有上传能力
```

## Capabilities

### New Capabilities

- `script-engine`:AI 自动跟进脚本的数据模型 + 生成器 + 流式 API（项目、分集、续写、四幕生成）
- `script-viewer`:树形剧本查看器（项目列表 → 树形结构 → 分集详情 → 内联编辑）+ 资产卡片
- `storyboard-export`:Seedance 2.0 时间轴格式分镜导出（单集 / 全剧，支持 Markdown / 复制）

### Modified Capabilities

- `frontend-polish`:侧边栏追加第 8 项「剧本工坊」(icon: `Clapperboard`, shortcut: `8`)
- `ai-content-generation`:`POST /api/ai/chat/stream` 标记为**通用 LLM 流式通道**,允许 studio engine 直接复用而非单独造接口

## Impact

+ **CLI**: 无变更（纯 Web 端新增；v0.4+ 在任务 4.4 为 `sau studio …` 预留占位）
+ **Web API**:
  - 新增 `web_runner/routes/studio.py`(项目 / 分集 / 续写 / 生成 4 个 endpoint + SSE 流式进度)
  - 新增 `web_runner/studio_engine.py`(四幕结构 prompt 模板 + 流式解析)
- **Frontend**:
  - 新增 `src/Pages/StudioPage.tsx`(dashboard 主体)
  - 新增 `src/Components/Studio/` 目录:8 个组件(ProjectList · ProjectCard · ProjectCreateDialog · ScriptViewer · AssetPlanner · EpisodeEditor · AiContinueButton · StoryboardExport)
  - 新增 `src/stores/useStudioStore.ts`(Zustand 状态:当前项目 / 选中的分集 / 流式进度)
  - 新增 `src/api/studio.ts`(`request.get` / `request.post` 包装)
  - 修改 `src/App.tsx`:新增 `/app/studio` lazy route + Suspense fallback
  - 修改 `src/AppShell.tsx`:增加 `navItems` 第 8 项（icon: `Clapperboard`）+ `useShortcut(8)` 绑定
- **Database**:
  - 新增 `studio_projects`(id, title, synopsis, style, status, created_at, updated_at, owner_user_id)
  - 新增 `studio_episodes`(id, project_id, episode_no, act, scenes_json, dialogues_json, status, created_at)
  - 新增 `studio_assets`(id, project_id, kind ENUM('character','scene','prop'), code, name, prompt, ref_image_url)
  - 索引:`idx_studio_projects_owner`、`idx_studio_episodes_project`
- **依赖**:
  - Python:无新增依赖(复用 `OPENROUTER_API_KEY` 和 `/api/ai/chat/stream` 已有的 `sse-starlette`)
  - Frontend:无新增依赖(react-markdown / prismjs / jszip 都已经在前端依赖图里;若未在则按需添加,优先 viz 已存在的 UI 库)
- **配置**:
  - 复用 `.env`:`OPENROUTER_API_KEY`(studio engine 调用)
  - 新增可选 `SAU_STUDIO_DEFAULT_EPISODES`(默认 5 集;留空 = 5)
- **Breaking**:无(纯新增;`/`、`/app/*`、`/api/*` 既有契约保持不变)
