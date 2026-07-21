## 1. v0.1 看到项目

### 1.1 数据库 — 3 张表(Web API 层)

- [ ] 1.1.1 在 `web_runner/db.py:_init_db_sqlite` 和 `:_init_db_postgres` 中新增 `studio_projects` / `studio_episodes` / `studio_assets` 三张表(SQLite `TEXT` ↔ PG `JSONB` 双方言等价)
- [ ] 1.1.2 添加索引:`idx_studio_projects_owner`、`idx_studio_episodes_project`、`UNIQUE idx_studio_assets_project_code`
- [ ] 1.1.3 验证双方言建表:本地启动后端口 6003 查看 sqlite3 schema;`SAU_DB_DIALECT=postgres` 启动后用 psql `\d+ studio_projects` 验证 PG schema

### 1.2 后端 — 项目 CRUD API(Web API 层)

- [ ] 1.2.1 新建 `web_runner/routes/studio.py`,创建 `bp = Blueprint("studio", __name__)`
- [ ] 1.2.2 `POST /api/studio/projects`:Body 接 `{ title, synopsis, style? }`,落 `studio_projects(status='draft')`,返回 `{ id, title, ... }`
- [ ] 1.2.3 `GET /api/studio/projects`:仅返回当前 `owner_user_id` 的项目,按 `updated_at DESC`
- [ ] 1.2.4 `GET /api/studio/projects/{id}`:项目详情 + 关联的 `studio_episodes` 列表 + `studio_assets` 列表
- [ ] 1.2.5 `DELETE /api/studio/projects/{id}`:级联删除 episodes + assets(`ON DELETE CASCADE` 已就位)
- [ ] 1.2.6 抽取 `_load_project(user_id, project_id)` 公共鉴权函数,确保非 owner 拿不到项目
- [ ] 1.2.7 在 `web_runner/__init__.py` 中注册 `studio_bp` Blueprint

### 1.3 前端 — API 客户端 + Zustand Store(Frontend 层)

- [ ] 1.3.1 新建 `sau_web/frontend/src/api/studio.ts`,实现 `studioApi.createProject` / `listProjects` / `getProject` / `deleteProject`
- [ ] 1.3.2 新建 `sau_web/frontend/src/stores/useStudioStore.ts`,实现 `projects` / `currentProjectId` + TanStack Query mutation hooks

### 1.4 前端 — Studio 主页面 + 项目列表(Frontend 层)

- [ ] 1.4.1 新建 `sau_web/frontend/src/Pages/StudioPage.tsx`,含 `Header` + 主区域(空状态 / 项目卡片网格二选一)
- [ ] 1.4.2 新建 `sau_web/frontend/src/Components/Studio/ProjectList.tsx`:项目卡片网格(沿用 `Card` + 响应式 grid)
- [ ] 1.4.3 新建 `sau_web/frontend/src/Components/Studio/ProjectCard.tsx`:标题 / 灵感 / 状态徽章 / 进度条 / 创建时间
- [ ] 1.4.4 新建 `sau_web/frontend/src/Components/Studio/ProjectCreateDialog.tsx`:Radix Sheet 三步表单(title → synopsis → style preset 选择)
- [ ] 1.4.5 使用现有的 `EmptyState` 组件处理"还没项目"空状态 + 主 CTA「创建第一个剧本」
- [ ] 1.4.6 使用现有的 `Skeleton` 组件处理项目列表加载状态

### 1.5 前端 — 路由 + 侧边栏导航(Frontend 层)

- [ ] 1.5.1 修改 `sau_web/frontend/src/App.tsx`,新增 lazy route:`const StudioPage = lazy(() => import('./Pages/StudioPage'))`
- [ ] 1.5.2 在 `<Routes>` 中添加 `<Route path="/studio" element={<AuthGuard><StudioPage /></AuthGuard>} />`
- [ ] 1.5.3 修改 `sau_web/frontend/src/AppShell.tsx`,`navItems` 中追加第 8 项:
  ```typescript
  { path: '/app/studio', label: '剧本工坊', icon: Clapperboard, shortcut: '7' }
  ```
- [ ] 1.5.4 验证 `useShortcut('7')` 与现有 1-6 + ? 不冲突

### 1.6 测试(Cross-layer)

- [ ] 1.6.1 验证登录后访问 `/app/studio` 看到「还没项目」空状态
- [ ] 1.6.2 验证点击「创建第一个剧本」打开 Dialog,填表后项目出现在列表中
- [ ] 1.6.3 验证 owner 在多端点(2 个浏览器)只看见自己创建的项目,看不到他人的
- [ ] 1.6.4 验证非 owner 访问 `GET /api/studio/projects/{他人的_id}` 返回 404
- [ ] 1.6.5 添加后端 pytest 测试 `tests/test_studio.py`:create / list / get / 鉴权 / 级联删
- [ ] 1.6.6 添加前端 Vitest 测试 `StudioPage.test.tsx`:空状态 / 创建流程 / 占位组件

---

## 2. v0.2 AI 跟进脚本与四幕生成

### 2.1 后端 — Studio Engine(Web API 层)

- [ ] 2.1.1 新建 `web_runner/studio_engine.py`
- [ ] 2.1.2 实现 `build_system_prompt(style: str)`:返回 system 指令("你是连续剧编剧,使用四幕结构 + 五段时间轴分镜 + C/S/P 资产编号 ...")
- [ ] 2.1.3 实现 `build_four_act_prompt(synopsis, n_episodes)`:返回 user 指令("基于以下灵感写 {n_episodes} 集,每集标 '起/承/转/合' 标签 ...")
- [ ] 2.1.4 实现 `build_follow_up_prompt(existing_script, user_hint)`:单回合续写 prompt
- [ ] 2.1.5 实现 `parse_llm_stream_to_episodes(chunks_iter)`:把 OpenRouter 流式 JSON 字面量解析为 `(episode_chunk, asset_chunk, error_chunk)` 三种事件,容错宽松(失败段单独入 `raw_text` 不丢)

### 2.2 后端 — 续写 + 生成 API(Web API 层,流式 SSE)

- [ ] 2.2.1 在 `web_runner/routes/studio.py` 中实现 `POST /api/studio/projects/{id}/follow-up`,返回 `text/event-stream`
- [ ] 2.2.2 SSE 事件类型:`meta` / `chunk` / `asset` / `done` / `error`(设计见 `design.md` §4)
- [ ] 2.2.3 实现 `POST /api/studio/projects/{id}/generate`,接 `{ episode_count: int }`,返回 `text/event-stream`
- [ ] 2.2.4 后端解析 OpenRouter 流 → 中间持久化到 `studio_episodes`,每写完一集触发 `event: done episode_no=N`
- [ ] 2.2.5 复用现有 `web_runner/routes/ai.py:_stream_openrouter_chat` 作为 LLM 通道(不擅自造接口)

### 2.3 后端 — 用量计量(Cross-layer)

- [ ] 2.3.1 在 `usage_metering` 中间件注册 `studio.generate`(4 credits / 集)和 `studio.follow_up`(1 credit / 次)
- [ ] 2.3.2 默认月度上限:每用户 30 次续写 + 20 次生成;`SAU_METERING_ENABLED=false` 时跳过

### 2.4 前端 — 树形剧本查看器(Frontend 层)

- [ ] 2.4.1 新建 `sau_web/frontend/src/Components/Studio/ScriptViewer.tsx`:折叠树(剧集 → 幕 → 场景 → 镜头)+ 节点单击展开
- [ ] 2.4.2 树节点显示状态徽章:`空 / 空生成 / 生成中 / 完成`
- [ ] 2.4.3 实现 `useStreamGenerate(projectId, episodeCount)`:封装 `fetch(...).then(stream => EventSource)` 风格的 SSE reader
- [ ] 2.4.4 客户端按 `episode_no` 增量合并到 `useStudioStore.episodes`,中途断网不丢已有段落
- [ ] 2.4.5 操作栏:[生成全部 5 集] / [单集跟进 ♻️] / [重新生成] 三按钮

### 2.5 前端 — 资产卡片(Frontend 层)

- [ ] 2.5.1 新建 `sau_web/frontend/src/Components/Studio/AssetPlanner.tsx`:C / S / P 三栏卡片
- [ ] 2.5.2 单卡:`{ code, name, prompt, ref_image_url? }` + 「复制编号」「复制生成提示词」两个按钮
- [ ] 2.5.3 占位:ref_image_url 为 null 时显示灰底 + "未生成"标签
- [ ] 2.5.4 数据来源:Ai 生成时尾随 `event: asset` 增量 push 到 store,前端不主动请求

### 2.6 测试(Cross-layer)

- [ ] 2.6.1 验证点击「生成全部」后 5 集依次到达,断点在中间时刷新会看到已完成段落保留
- [ ] 2.6.2 验证 AI 输出非 JSON 时后端降级为 raw_text,前端 prose 渲染不报错
- [ ] 2.6.3 验证资产编号在同项目内不重复(数据库唯一约束兜底 + 前端跳过冲突)
- [ ] 2.6.4 验证 `studio.generate` 单集超 4 credits 时拒绝(free tier 用尽提示)
- [ ] 2.6.5 添加后端 pytest 测试流式 SSE:mock OpenRouter 返回 → 断言 5 个 `event: chunk` 完整到达 + 1 个 `event: done`
- [ ] 2.6.6 添加前端 Vitest 测试:`ScriptViewer` 折叠树 + 增量合并 + 状态徽章

---

## 3. v0.3 编辑 + 导出 Seedance 2.0 分镜

### 3.1 前端 — 单集内联编辑器(Frontend 层)

- [ ] 3.1.1 新建 `sau_web/frontend/src/Components/Studio/EpisodeEditor.tsx`
- [ ] 3.1.2 三栏编辑:旁白(全局 prose) / 对白(角色 + 时间轴) / 镜头描述(per-shot 段落)
- [ ] 3.1.3 使用 `react-hook-form` 只对 dirty 行做局部 update(参考 publish wizard 的 dirty row 模式)
- [ ] 3.1.4 引入 Zod schema 客户端校验 `Episode` 数据结构,失败时 inline 显示
- [ ] 3.1.5 自动保存:debounce 1500ms → `PATCH /api/studio/episodes/{id}`

### 3.2 前端 — AI 改写按钮(Frontend 层)

- [ ] 3.2.1 新建 `sau_web/frontend/src/Components/Studio/AiContinueButton.tsx`:文本框旁悬浮按钮
- [ ] 3.2.2 触发走 `studio.follow_up` 协议(同 v0.2 的 SSE 通道),但只替换当前行的内容
- [ ] 3.2.3 提供 "接受" + "放弃" 双按钮 onboarding 流程,不直接覆盖
- [ ] 3.2.4 v0.3 暂不支持 multi-shot 改写,只支持 prose + dialogue 行级

### 3.3 后端 — 集级持久化(Web API 层)

- [x] 3.3.0 实现 `POST /api/studio/projects/{id}/episodes` `POST /api/studio/projects/{id}/episodes`,Body 接单个 `{title?, act, scenes_json?, dialogues_json?}` 或批量(数组)。`act` ∈ {起,承,转,合},`scenes_json`/`dialogues_json` 接受 list-of-dicts 或预 stringified JSON。`episode_no` 自动按 `COALESCE(MAX+1)+i` 分配,整个 MAX 读 + N×INSERT 包在一个 `db.transaction()` 内,保证 atomic 一致性 + 同事务可见性。owner 鉴权走 `_load_project`→ 404,unauth → 401,空数组 → 400,首项校验错 → 400 且偏误越不洩其它已验证项的资源。round-OPT-T2-follow-up 落地。
- [ ] 3.3.1 实现 `PATCH /api/studio/episodes/{id}`,Body 接 `{ title?, scenes_json?, dialogues_json? }`,带 owner 鉴权
- [ ] 3.3.2 校验 schema 后 UPDATE;返回最新 episode
- [ ] 3.3.3 实现 `POST /api/studio/episodes/{id}/assets`(用户手动添加资产时,自动选下一个空号)

### 3.4 前端 — Seedance 2.0 分镜导出(Frontend 层)

- [ ] 3.4.1 新建 `sau_web/frontend/src/Components/Studio/StoryboardExport.tsx`
- [ ] 3.4.2 渲染格式严格遵循 `liangdabiao/Seedance2-Storyboard-Generator` 模板:
  ```
  ## 素材清单
  | 素材槽 | 文件 | 说明 |
  | 图片1 | C01 | 角色参考 |

  ## Seedance Prompt(时间轴格式)
  0-3秒画面:...
  3-6秒画面:...
  ...
  【声音】配乐 + 音效 + 对白
  【参考】@图片1 角色 @图片2 场景

  ## 尾帧描述
  本集最后一帧:...
  ```
- [ ] 3.4.3 单集 API:[复制 Markdown] / [下载 .md] 两个动作
- [ ] 3.4.4 全剧 API:[批量下载 .zip](jszip 单 zip 内含 `_剧本.md` + `E01_分镜.md`... `E05_分镜.md` + `素材清单.md`)
- [ ] 3.4.5 严格保留中英文标点一致性(中文用「,」「:」「(」「)」)

### 3.5 测试(Cross-layer)

- [ ] 3.5.1 验证 Editor 修改后 1.5s 内自动保存,刷新数据持久
- [ ] 3.5.2 验证「接受 / 放弃」流程:点击接受 → 行被覆盖;点击放弃 → 原内容保留
- [ ] 3.5.3 验证单集复制 Markdown 粘贴到任何 Markdown 解析器(GFM)渲染正确
- [ ] 3.5.4 验证全剧 .zip 解压后,文件名 `_剧本.md` / `E0X_分镜.md` 命名规范一致
- [ ] 3.5.5 验证严格格式:与启发项目 5 个示例项目(林冲 / 聂风 / 项链)逐字符对比,我们的输出与模板结构等价
- [ ] 3.5.6 添加后端 pytest:`PATCH /episodes/{id}` 鉴权 / schema / owner 校验
- [ ] 3.5.7 添加前端 Vitest:`StoryboardExport` 快照测试(把生成的 Markdown 与 golden file 对比)

---

## 4. 文档与配置(Cross-layer)

- [ ] 4.1 在 `README.md` 添加「剧本工坊」段落(用法 + 与启发项目的关系)
- [ ] 4.2 更新 `.env.example`,添加 `SAU_STUDIO_DEFAULT_EPISODES` 配置项说明
- [ ] 4.3 新建 `docs/script-studio.md`,介绍四幕结构 + Seedance 2.0 格式 + v0.4+ 路线
- [ ] 4.4 在 `docs/CLI.md` 添加 `sau studio ...` 子命令占位(v0.4+ 真实实现)
- [ ] 4.5 在 `docs/dev/INDEX.md` 添加「剧本工坊」入口
