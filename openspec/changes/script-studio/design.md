## Context

### 现状盘点

- **`social-auto-upload` 今天覆盖的链路:`素材 → 多平台自动上传`**。CLI 入口 `sau <platform> upload-video`，支持 7 个平台(douyin / kuaishou / xiaohongshu / bilibili / tencent / tiktok / baijiahao);Web 端 `sau_web/frontend/` 提供账号管理 / 发布中心 / 任务列表 / 收件箱 / 运行日志 / 数据分析 / Admin Dashboard 7 个子页面。
- **`web_runner/routes/ai.py`** 已有的 AI 能力:`POST /api/ai/chat/stream`(OpenRouter 单回合流式)、`POST /api/ai/content/generate`(标题/正文)、`POST /api/ai/images/search`(Pexels + Pixabay 双源)。studio engine 复用 `POST /api/ai/chat/stream` 作为通用 LLM 通道,**不单独造接口**。
- **数据库(schema)**:SQLite 开发 / PostgreSQL 生产,双方言表结构由 `web_runner/db.py:_init_db_sqlite` 和 `_init_db_postgres` 共同维护;新增 3 张表必须两边同步。
- **前端架构**:React 19 + React Router v7 + Zustand + TanStack Query + shadcn/ui(Radix + Tailwind v4);页面统一放 `src/Pages/`,功能组件放 `src/Components/<Feature>/`,API 客户端放 `src/api/`,状态放 `src/stores/`。

### 启发项目:Seedance2-Storyboard-Generator 的可借鉴 + 可补位

| 启发项目的能力 | 我们如何处理 |
|---|---|
| Claude Skill workflow(分幕生成剧本) | **复用思想**,在 `studio_engine.py` 内置四幕 prompt 模板,跳过 Skill 文件机制 |
| 角色(C) / 场景(S) / 道具(P) 编号系统 | **完整复制**,asset_kind enum + code 前缀规则原样搬过来 |
| Seedance 2.0 时间轴分镜 Prompt 格式 | **完整复制**:`0-3s 画面:... \| 3-6s:... \| 【声音】... \| 【参考】@C01 @S01 \| 尾帧:...` |
| 多集视频延长串联(尾帧 = 下一集片头) | **留到 v0.4+**,v0.3 只导出分镜文本;不引入真正的视频生成 |
| 集数串联依赖 Seedance 2.0 API | **不做**:我们用 Seedance 2.0 作为**输出格式规范**,实际生成留给外部工具 |
| (无可借鉴项) 自动多平台分发 | **我们的优势**:导出分镜后,v0.4+ 可让用户把成片当作"素材收件箱"项,触发我们已经有的批量上传能力 |

### 关键约束

1. **AI 调用必须可中断、可重试**:OpenRouter 流式中途断网不能让用户的整个剧本丢失 → 流式 SSE + 客户端断点显示当前已生成的段落。
2. **数据模型必须两边兼容**:`scenes_json` / `dialogues_json` 字段在 SQLite 用 `TEXT`,PostgreSQL 必须等价映射为 `JSONB` 或 `TEXT` 才能迁移一致(参考 inbox 多平台表已有先例)。
3. **看板组件必须纯前端渲染**:不许在 `useEffect` 里跑复杂 prompt 拼接,所有项目结构由 store 持有 + Zod 校验。
4. **不能破坏现有 `/app/*` 的 7 个路由**:`/app/studio` 是新增第 8 项;`shortcut: '7'` 是新增版位,不与既有快捷键冲突(已有 1-6 + ?)。

## Goals / Non-Goals

### Goals

- v0.1:**让人能进来并开始**——创建项目、列出项目、项目详情可看
- v0.2:**让 AI 真干一次活**——单回合跟进(`POST /follow-up`)和批量四幕生成(`POST /generate`)都通,流式进度可见
- v0.3:**让运营可编辑可导出**——树形剧本查看器、单集内联编辑、AI 改写按钮、Seedance 2.0 分镜导出(单集 / 全剧 .zip)
- 复用现有 AI 通道(`/api/ai/chat/stream`),**避免为 studio 单独造 LLM 接口**
- 复用现有 shadcn 组件体系(Card / Table / Sheet / EmptyState / Skeleton / Toast),零新增 UI 框架
- 复用现有 SSE 流式推基础设施(text/event-stream + 已有的 reader)

### Non-Goals(v0.1-v0.3)

- **不做真正的视频生成**:v0.3 只导出分镜 Prompt 文本,留给 Seedance 2.0 / 即梦平台手工执行
- **不做字符参考图生成**:asset_prompt 仅作为"未来生图提示词",不实际调用 GPT-Image-2 / Seedream
- **不做视频延长串联**:启发项目的"用上一集尾帧作为下一集片头"留到 v0.4+(需引入视频生成后才有可能)
- **不做多人协作 / 项目权限模型**:每个项目只有 owner_user_id,不分角色 → v2.0 考虑
- **不做 AI 是否满意的反馈回路**:这一版 AI 只是"候选人",运营 / 创作者人工筛
- **不做移动端 Studio 专属 UI**:`ProjectList` 走响应式即可,不专门优化移动端编辑
- **不做面板级 diff**:`v1.0` 才有版本对比 / branch 概念

## Decisions

### 1. 三张表设计

**选择**:最小化的实体集——`projects` / `episodes` / `assets`,**没有**单独的 `scenes` / `shots` 表,而是用 `studio_episodes.scenes_json` 把一整集的场景列表作为 JSON 列存储。

**理由**:
- 启发项目本身就是这种"一个 Markdown 文件管一集"的结构
- SQLite `TEXT` + PostgreSQL `JSONB` 都可以,原子更新通过 `UPDATE ... SET scenes_json = ?` 完成,不需要 JOIN 二级表
- 后续若 `scenes` 字段被频繁单独读写 → v2.0 拆表;先 YAGNI

**实现**:
```sql
-- SQLite(PG 方言去掉 AUTOINCREMENT,改 SERIAL)
CREATE TABLE studio_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    synopsis TEXT NOT NULL,        -- 一句话灵感
    style TEXT,                    -- e.g. "水墨武侠风格,9:16竖屏"
    status TEXT NOT NULL DEFAULT 'draft',  -- draft | generating | ready | exported
    owner_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_studio_projects_owner ON studio_projects(owner_user_id);

CREATE TABLE studio_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    episode_no INTEGER NOT NULL,   -- 1..N
    act TEXT NOT NULL,             -- 起 | 承 | 转 | 合
    title TEXT NOT NULL,
    scenes_json TEXT NOT NULL,     -- [{ scene_no, location, time, shots:[{ duration, description, dialogue, ref_assets:[C01, S02, P03] }] }]
    dialogues_json TEXT NOT NULL,  -- [{ speaker, line, at_seconds }]
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_studio_episodes_project ON studio_episodes(project_id, episode_no);

CREATE TABLE studio_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    kind TEXT NOT NULL,            -- 'character' | 'scene' | 'prop'
    code TEXT NOT NULL,            -- C01..C99 / S01..S99 / P01..P99
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,          -- 生图 prompt
    ref_image_url TEXT,            -- 占位,v2.0+ 才用
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_studio_assets_project_code ON studio_assets(project_id, kind, code);
```

### 2. AI 推进方式:**复用 `/api/ai/chat/stream` 而不是造新端点**

**选择**:`studio_engine.py` 内部构造四幕 prompt,通过同一个 `POST /api/ai/chat/stream` 与 OpenRouter 通信;客户端只跟 studio 自己暴露的 `POST /api/studio/projects/{id}/generate` 打交道。

**理由**:
- `/api/ai/chat/stream` 已经是通用 LLM 流式通道,被 `ai-sidebar-bottom-panel` 改造后能承载任意 prompt 模板 + system 指令
- 单独造 `/api/studio/llm/...` 会让权限 / 计量 / 模型选择 4 个能力各 impl 一次 → 计划性债

**实现**:
```python
# web_runner/studio_engine.py
from web_runner.routes.ai import _stream_openrouter_chat  # 复用底层

async def generate_script(project: dict, episode_count: int) -> AsyncIterator[str]:
    system = build_system_prompt(project["style"])         # "你是连续剧编剧..."
    user = build_four_act_prompt(project["synopsis"], episode_count)
    async for chunk in _stream_openrouter_chat(
        system=system, user=user, model="anthropic/claude-3.5-sonnet",
    ):
        yield chunk
```

### 3. 四幕结构 + Seedance 2.0 格式:直接搬启发项目

**选择**:完全照搬 [`liangdabiao/Seedance2-Storyboard-Generator`](https://github.com/liangdabiao/Seedance2-Storyboard-Generator) 的格式约定。

**理由**:
- 启发项目已经有 1.7K star,运营 / 创作者社区已经熟悉这套 C/S/P + 时间轴 + 尾帧 的约定
- 改格式会带来迁移成本,用户会抗拒

**采纳的约定**:
- 角色 `C01` / 场景 `S01` / 道具 `P01`,项目内唯一
- 分镜:`0-3s / 3-6s / 6-9s / 9-12s / 12-15s` 五段(每段 3 秒)
- 音效 + 参考 + 尾帧三段在同一段 MarkDown 内连续
- 末集尾帧 = 强调"服务下一集"

### 4. 端上加 SSE = 复用已有流式推 `/api/ai/chat/stream`

**选择**:`/api/studio/projects/{id}/generate` 返回 `text/event-stream`,事件类型:
- `event: meta`   `data: { total_episodes, model }`
- `event: chunk`  `data: { episode_no, act, text }` (流式追加)
- `event: asset`  `data: { kind, code, name, prompt }` (解析过程中提取的资产)
- `event: done`   `data: { project_id }`
- `event: error`  `data: { message }`

**理由**:
- 既可以让 5 集生成对用户可见,"AI 在写第一集..." / "第二集 '承' 完成..."
- 也能让用户在生成中途暂停 — v0.3 暂不实现,但协议预留了空间

### 5. 前端状态分层

```
useStudioStore (zustand)
├── projects:          Project[]
├── currentProjectId:  number | null
├── generation:        { status, episodeIndex?, totalEpisodes?, error? }
└── shortcuts:         { selectedEpisodeId, expandedNodes }
```

理由:已有 `useAccountGroups` / `useStudioStore` 等先例,沿用同一 zustand pattern。

### 6. 8 组件拆分的依据

```
sau_web/frontend/src/Components/Studio/
├── ProjectList.tsx          # /app/studio 默认页:项目卡片网格(无项目时空状态 + CTA)
├── ProjectCard.tsx          # 单个项目卡片:标题 / 灵感 / 状态徽章 / 进度条
├── ProjectCreateDialog.tsx  # Sheet 形式:title + synopsis + style preset 选择
├── ScriptViewer.tsx         # 树形剧本查看:折叠树 + 节点状态 + 单击行展开
├── AssetPlanner.tsx         # C/S/P 三栏卡片,每张卡片有编号 + name + prompt + 复制按钮
├── EpisodeEditor.tsx        # 单集旁白 / 对白 / 镜头描述的内联编辑
├── AiContinueButton.tsx     # 文本旁的悬浮按钮,触发单点 AI 改写(再次走 reuse /api/ai/chat/stream)
└── StoryboardExport.tsx     # 渲染 Seedance 2.0 格式 + 单集复制 + 全剧 .zip 下载
```

理由:**单一职责 + 便于单测**。`AssetPlanner` 是只读的、`EpisodeEditor` 是写的,二者状态独立 — 测试时可以单独 mock `useStudioStore`。

### 7. 路由集成

```tsx
// src/App.tsx
const StudioPage = lazy(() => import('./Pages/StudioPage'))
// ...
<Route path="/studio" element={<AuthGuard><StudioPage /></AuthGuard>} />
```

侧边栏:
```tsx
// src/AppShell.tsx navItems
{ path: '/app/studio', label: '剧本工坊', icon: Clapperboard, shortcut: '7' }
```

理由:与现有"账号管理 / 发布中心 / 任务列表 / 数据分析 / 运行日志 / 素材收件箱 / 管理后台"7 项并列,**第 8 个**,shortcut 不冲突。

### 8. 数据库方言兼容性

**选择**:`scenes_json` / `dialogues_json` 在 SQLite 用 `TEXT`,PostgreSQL 用 `JSONB`,但在 ORM 层不直接暴露 `JSONB` 特有函数 — 一律序列化 / 反序列化字符串。两边初始化函数 `_init_db_sqlite` 和 `_init_db_postgres` 都加这三张表的同样 DDL。

理由:沿用 `inbox-multi-platform` / `email-auth-login` 的"双方言同步演进"模式;参考 `web_runner/db.py` 已有的 schema-aware 抽象。

## Risks / Trade-offs

| 风险 | 缓解措施 |
|---|---|
| OpenRouter 调用超时 / 限流 / 余额耗尽 | 后端 stream 自身捕获 → 写 `event: error`,前端展示 Toast "AI 暂时不可用,请稍后重试";已生成的段落保留,不丢 |
| AI 输出不符合四幕 JSON 结构 | 后端解析失败时 → 整段视为"自由文本"塞入 `episodes[].raw_text` 字段,前端降级渲染为 prose;不丢段落 |
| 用户连续触发 8 次生成,跑空余额 | 复用 `usage_metering` 中间件 → `studio.generate` 算 4 credits / 集;`studio.follow_up` 算 1 credit / 次(月配额内每用户 30);`SAU_METERING_ENABLED=false` 时跳过 |
| `projects` / `episodes` 关联出错导致级联误删 | `studio_episodes.project_id` 用 `ON DELETE CASCADE`;但 `owner_user_id` **不** 加 FK,允许运营把项目转给别人后用户被删 |
| 资产编号重复(C01 / S01) | `UNIQUE INDEX idx_studio_assets_project_code (project_id, kind, code)` 在数据库层硬保证;前端解析失败时自动选下一个空号 |
| 编辑器无限增长导致 React 重渲染卡顿 | `EpisodeEditor` 用 `react-hook-form` 形式,只 dirty 行重渲(对照 publish wizard 已有模式) |
| 灵感剧本带敏感内容 | OpenRouter 本身有内容审核;后端不做额外护栏,沿用现有 policy |
| 项目数据无导出 | v0.1-v0.3 不做"项目级 Markdown 导出",只做"分镜导出";v2.0 引入 `studio.export_markdown` |
| 启发项目仓库被社区 fork 后分裂 | 我们的格式约定以 clone + 改进为预期 → v0.4+ 主动在 docs 写"我们兼容 Seedance2-Storyboard-Generator 文件结构" |

## Migration Plan

### Phase 1 — v0.1 看到项目(Week 1)

1. DB:新增 3 张表 SQLite + PG 同步
2. API:`POST /api/studio/projects`、`GET /api/studio/projects`、`GET /api/studio/projects/{id}`
3. 路由:`/app/studio` lazy route
4. UI:`StudioPage` + `ProjectList` + `ProjectCard` + `ProjectCreateDialog`
5. Test:`tests/test_studio.py` 覆盖 create / list / get

### Phase 2 — v0.2 看到剧本(Week 2)

1. Engine:`studio_engine.py` 实现四幕 prompt + 流式
2. API:`POST /api/studio/projects/{id}/follow-up`、`POST /generate`(流式)
3. UI:`ScriptViewer` + `AssetPlanner`
4. Test:流式断点、AI 段落不丢、资产提取

### Phase 3 — v0.3 编辑并导出(Week 3)

1. UI:`EpisodeEditor` + `AiContinueButton`
2. UI:`StoryboardExport`(单集复制 + 全剧 .zip)
3. Test:Markdown 格式严格匹配启发项目模板

### Phase 4 — 回滚策略

任何一个 Phase 不通过 → 删除对应文件/路由,DB 字段保留但不写入,旧阶段仍可用。每个 Phase 的入口都自带 `useFeatureFlag('studio.v0N')`,便于灰度。

## Open Questions

- [ ] 是否做"项目级 Markdown 导出 / 导入"(v0.4 / v2.0)?→ 暂时不做,先 v0.3 分镜级
- [ ] 是否启用 asset refinery(自动从 raw text 提取角色)?→ v0.2 后端解析就提;UI 暂不允许手改编号
- [ ] 是否接入视频生成 API(Seedance 2.0 / 即梦)?→ **不做**;v0.4+ 考虑
- [ ] 是否做"自动发布"成片到多平台?→ **不做**;v2.0+ 考虑,且需要先有视频生成
- [ ] 是否启用 AI 满意度反馈回路 → **不做**(YAGNI)
- [ ] 是否与 `inbox`(素材收件箱)打通 → v2.0 考虑,可让 studio 导出的成片落入 inbox
- [ ] 是否引入 Claude Skill(动态加载 .md)→ **不做**,我们直接 prompt 内嵌在 `studio_engine.py`
