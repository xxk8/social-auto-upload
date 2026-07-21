## ADDED Requirements

### Requirement: Script Viewer (openspec delta-format stub — see archived content below)
The `Script Viewer` capability is added by openspec change `script-studio`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Script Viewer` workflow is invoked per `openspec/changes/script-studio/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # Script Viewer 规范
    
    ## 概述
    
    `script-viewer` 是「剧本工坊」的前端展示与编辑能力——把后端 `script-engine` 产出的"项目 → 剧集 → 幕 → 场景 → 镜头"四层结构以可折叠树 + 内联编辑 + AI 续写的方式呈现。
    
    ## 页面层级
    
    ```
    StudioPage (/app/studio)
    ├── 空状态(EmptyState + CTA「创建第一个剧本」)
    └── ProjectList(项目卡片网格)
        └── ProjectCard
            └── 点击进入 → ProjectDetail(本期同路由,有 projectId 时显示子页面)
                ├── 左栏:AssetPlanner(C/S/P 资产卡片)
                ├── 中栏:ScriptViewer(折叠树)
                └── 右栏:操作栏 + AI 续写按钮 + EpisodeEditor 抽屉
    ```
    
    ## ScriptViewer 树形结构
    
    ### 数据模型(完全对齐 `script-engine` §Episode JSON)
    
    ```typescript
    type EpisodeNode = {
      id: number
      episode_no: number
      act: '起' | '承' | '转' | '合'
      title: string
      status: 'draft' | 'generating' | 'complete' | 'error'
      scenes: Scene[]
      dialogues: Dialogue[]
      // 内联编辑 dirty 状态(本地,不持久化)
      is_dirty?: boolean
    }
    
    type TreeNode = {
      episode: EpisodeNode
      children: SceneNode[]
    }
    
    type SceneNode = {
      scene_no: number
      location: string
      time: string
      shots: ShotNode[]
    }
    ```
    
    ### 渲染规则
    
    | 状态 | 视觉 |
    |---|---|
    | `Episode.status === 'draft'` | 节点旁空心圆 `○` + tooltip「等待生成」 |
    | `Episode.status === 'generating'` | 节点旁 spinner + tooltip「正在生成」(v0.2 用) |
    | `Episode.status === 'complete'` | 节点旁绿色 ✓ |
    | `Episode.status === 'error'` | 节点旁红色 ⚠ + toast |
    
    ### 折叠状态
    
    - 默认所有 episode 收起到第二级(`episode → act`),场景级展开
    - `localStorage.studio.expandedNodes` 记忆用户展开状态
    - 状态切换(complete ↔ draft)不触发自动展开(避免抖动)
    
    ### 单击 / 双击交互
    
    | 操作 | 行为 |
    |---|---|
    | 单击 episode 行 | 选中 + 右栏 EpisodeEditor 抽屉打开,装载该 episode |
    | 双击 episode 行 | 滚动到该集 + 一次性展开到镜头级 |
    | 单击 shot 行 | 行级 contenteditable(若可编辑) / 触发 `AiContinueButton` |
    | 单击 asset 卡片 | 高亮所有引用该 asset 的 shot(v0.3 用 `data-asset={code}` 选择器实现交叉高亮) |
    
    ## AssetPlanner(资产卡片)
    
    ### 三栏布局
    
    ```
    [角色 C]            [场景 S]            [道具 P]
    ┌────────┐         ┌────────┐         ┌────────┐
    │ C01    │         │ S01    │         │ P01    │
    │叶青云 │         │沧州草料场│         │ 青锋剑 │
    │prompt  │         │prompt  │         │prompt  │
    │[复制编号]│         │[复制编号]│         │[复制编号]│
    │[复制提示词]│       │[复制提示词]│       │[复制提示词]│
    └────────┘         └────────┘         └────────┘
    ```
    
    ### 数据
    
    | 来源 | 处理 |
    |---|---|
    | SSE `event: asset` 增量到达 | push 到 `useStudioStore.assets[projectId]`;Zod 校验 + 去重 |
    | `POST /api/studio/episodes/{id}/assets` 手添 | 用户手动新增,ascending code 自动分配 |
    
    ## EpisodeEditor(单集内联编辑)v0.3
    
    ### 三栏编辑
    
    ```
    旁白 (Prose)        对白 (Dialogue)       镜头描述 (Shot Description)
    ─────────────────    ──────────────────    ────────────────────────────
    [多行 prose]        [+ 角色 输入对话]     [+ 3s 镜头 添加]
                        [+ at_seconds]        [+ duration / dialogue / ref_assets]
    [💡 AI 改写]        [💡 AI 改写]          [💡 AI 改写]
    ```
    
    ### 自动保存
    
    | 触发 | 行为 |
    |---|---|
    | 行停止输入 1500ms | debounce,触发`PATCH /api/studio/episodes/{id}`,被锁住行立刻显示「保存中」 同步指示 |
    | 用户从抽屉离开 / 项目切换 | 立刻保存(无视 debounce) |
    | 网络失败 | 重试 3 次,失败 → Toast「保存失败,重试中」 + 行高亮红 |
    
    ### Schema 校验(Zod)
    
    ```typescript
    const EpisodeSchema = z.object({
      episode_no: z.number().int().positive(),
      act: z.enum(['起', '承', '转', '合']),
      title: z.string().min(1).max(80),
      scenes_json: z.string().refine(s => JSON.parse(s).every(isScene)),
      dialogues_json: z.string().refine(s => JSON.parse(s).every(isDialogue)),
    })
    
    // 失败时 inline 显示:
    // - 行级错误:右下角小红点 + tooltip
    // - 局部错误:行下方单字符红框 + 完整 rationale 一行
    ```
    
    ## AiContinueButton(v0.2 + v0.3 复用)
    
    ### UI 形态
    
    - 文本行旁悬浮 `💡 AI`
    - 单击 → 弹出小对话框 "请描述你想要的改写"(v0.2 简版 / v0.3 full)
    - 提交后走 SSE 流式,左侧 / 行内实时增量替换("diff" 风格)
    - 流停止后弹"接受 / 放弃"双按钮
    
    ### 触发逻辑
    
    ```
    local row content + user hint → POST /api/studio/projects/{id}/follow-up
      → SSE → parser → preview diff
      → [接受] 写回 PATCH /episodes/{id}
      → [放弃] 丢弃 diff
    ```
    
    ## 响应式
    
    | 断点 | 行为 |
    |---|---|
    | ≥1280px | 三栏 (AssetPlanner \| ScriptViewer \| 操作栏) |
    | 768px-1279px | 两栏 (AssetPlanner 折叠成上方面板) |
    | <768px | 单栏 + Tab 切换(资产 / 剧本 / 编辑) |
    
    ## 组件清单(全部新增)
    
    | 路径 | 作用 |
    |---|---|
    | `src/Pages/StudioPage.tsx` | 主页面(layout + routing 分支) |
    | `src/Components/Studio/ProjectList.tsx` | 项目卡片网格 |
    | `src/Components/Studio/ProjectCard.tsx` | 单个项目卡片 |
    | `src/Components/Studio/ProjectCreateDialog.tsx` | 创建项目 Sheet |
    | `src/Components/Studio/ScriptViewer.tsx` | 折叠树 |
    | `src/Components/Studio/AssetPlanner.tsx` | 三栏资产卡片 |
    | `src/Components/Studio/EpisodeEditor.tsx` | 单集内联编辑 |
    | `src/Components/Studio/AiContinueButton.tsx` | AI 改写悬浮按钮 |
    | `src/stores/useStudioStore.ts` | Zustand store |
    | `src/api/studio.ts` | API 客户端 |
    
    ## 组件复用(零新增 UI 框架)
    
    | 现有组件 | 复用 |
    |---|---|
    | `Card` / `EmptyState` / `Skeleton` | ProjectList / ProjectCard |
    | `Sheet` (Radix) | ProjectCreateDialog |
    | `Button` / `Toast` / `DropdownMenu` | 操作栏 |
    | `Badge` | 状态徽章(generating / complete / error) |
    | React Router hooks | `useShortcut('7')`(沿用 admin-dashboard 的同款实现) |
    | Zod | `EpisodeSchema` 客户端校验 |
    
    ## 状态契约(zustand `useStudioStore`)
    
    ```typescript
    interface StudioState {
      projects: Project[]
      currentProjectId: number | null
      episodes: Record<number /* projectId */, EpisodeNode[]>  // map
      assets: Record<number /* projectId */, Asset[]>
      generation: Record<number /* projectId */, {
        status: 'idle' | 'running' | 'error'
        episodeIndex?: number
        totalEpisodes?: number
        error?: string
      }>
      // 选中状态(供 Editor 抽屉)
      selectedEpisodeId: number | null
    
      // Actions
      createProject(input): Promise<Project>
      loadProject(id): Promise<void>
      deleteProject(id): Promise<void>
      patchEpisode(id, patch): Promise<EpisodeNode>
      addEpisodeLocal(projectId, episode): void  // SSE chunk 增量 push
      addAssetLocal(projectId, asset): void      // SSE asset 增量 push
      setGeneration(projectId, partial): void
    }
    ```
    
    ## 测试
    
    | 文件 | 覆盖 |
    |---|---|
    | `StudioPage.test.tsx` | 空状态 + 创建流程 + 路由跳转 |
    | `ScriptViewer.test.tsx` | 折叠树 + 选中 + 状态徽章 |
    | `EpisodeEditor.test.tsx` | 1500ms debounce + schema 校验失败 inline + 自动保存重试 |
    | `AiContinueButton.test.tsx` | mock SSE → 接受 / 放弃两条路径都覆盖 |
    
    ## 关键文件清单
    
    | 文件 | 操作 |
    |---|---|
    | `src/Pages/StudioPage.tsx` | 新建 |
    | `src/Components/Studio/*.tsx` | 新建(8 个) |
    | `src/stores/useStudioStore.ts` | 新建 |
    | `src/api/studio.ts` | 新建 |
    | `src/App.tsx` | 修改(新增 lazy route) |
    | `src/AppShell.tsx` | 修改(第 8 项 navItems + shortcut 7) |
    
