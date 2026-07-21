## ADDED Requirements

### Requirement: Script Engine (openspec delta-format stub — see archived content below)
The `Script Engine` capability is added by openspec change `script-studio`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Script Engine` workflow is invoked per `openspec/changes/script-studio/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # Script Engine 规范
    
    ## 概述
    
    `script-engine` 是「剧本工坊」的后端能力——以项目为粒度,提供剧本数据持久化、AI 自动跟进、四幕批量生成三大能力,作为 `social-auto-upload` 现有 AI 内容生成能力(`ai-content-generation`)在"剧本 / 分集"维度的扩展。
    
    ## 数据模型
    
    ### 实体关系
    
    ```
    studio_projects       (1)──< (N) studio_episodes
           │                       (每个 episode 含 scenes_json / dialogues_json)
           └──< (N) studio_assets
                  (character: C01..C99 / scene: S01..S99 / prop: P01..P99)
    ```
    
    ### studio_projects
    
    | 列 | 类型 | 说明 |
    |---|---|---|
    | `id` | INTEGER PK | |
    | `title` | TEXT NOT NULL | 卡片标题(用户输入,不超过 80 字) |
    | `synopsis` | TEXT NOT NULL | 一句话灵感(用户输入,不超过 500 字) |
    | `style` | TEXT | 风格前缀,例如 "水墨武侠风格,9:16竖屏";为空则由 AI 自由发挥 |
    | `status` | TEXT NOT NULL | `draft` / `generating` / `ready` / `exported` |
    | `owner_user_id` | INTEGER NOT NULL | FK → `users.id`(逻辑 FK,不强制) |
    | `created_at` | TEXT NOT NULL | ISO8601 |
    | `updated_at` | TEXT NOT NULL | ISO8601 |
    
    ### studio_episodes
    
    | 列 | 类型 | 说明 |
    |---|---|---|
    | `id` | INTEGER PK | |
    | `project_id` | INTEGER NOT NULL | FK → `studio_projects.id`, `ON DELETE CASCADE` |
    | `episode_no` | INTEGER NOT NULL | 1..N |
    | `act` | TEXT NOT NULL | `起` / `承` / `转` / `合` |
    | `title` | TEXT NOT NULL | 单集标题 |
    | `scenes_json` | TEXT (SQLite) / JSONB (PG) | `[{scene_no, location, time, shots:[{duration, description, dialogue, ref_assets}]}]` |
    | `dialogues_json` | TEXT (SQLite) / JSONB (PG) | `[{speaker, line, at_seconds}]` |
    | `status` | TEXT NOT NULL | `draft` / `generating` / `complete` |
    | `created_at` | TEXT NOT NULL | |
    
    UNIQUE constraint:`(project_id, episode_no)`。
    
    ### studio_assets
    
    | 列 | 类型 | 说明 |
    |---|---|---|
    | `id` | INTEGER PK | |
    | `project_id` | INTEGER NOT NULL | FK → `studio_projects.id`, `ON DELETE CASCADE` |
    | `kind` | TEXT NOT NULL | `character` / `scene` / `prop` |
    | `code` | TEXT NOT NULL | 项目内唯一编号,例如 `C01` |
    | `name` | TEXT NOT NULL | 资产名称 |
    | `prompt` | TEXT NOT NULL | 生图 prompt,供 Seedance 2.0 / 即梦 等下游使用 |
    | `ref_image_url` | TEXT NULL | 占位,v2.0+ 才真正使用 |
    | `created_at` | TEXT NOT NULL | |
    
    UNIQUE constraint:`(project_id, kind, code)`。
    
    ### Episode JSON 结构(scenes_json)
    
    ```typescript
    type Scene = {
      scene_no: number                   // 1..N
      location: string                   // 场景地点,如 "沧州草料场·雪景"
      time: string                       // "日" / "夜" / "黄昏"
      duration_total: number             // 秒,累加 shots 的 duration 应 == 15s
      shots: Shot[]
      // ... (mock 数据: 黄昏,15s,5 镜头)
    }
    
    type Shot = {
      duration: 3                        // 固定 3s
      description: string                // 镜头描述,中文 prose
      dialogue: string | null            // 该镜头内的对白,可空
      ref_assets: string[]               // 引用 Cxx / Sxx / Pxx 编号
    }
    ```
    
    ## 后端实现
    
    ### 路由表
    
    | Method | Path | 功能 |
    |---|---|---|
    | POST | `/api/studio/projects` | 创建项目 |
    | GET | `/api/studio/projects` | 列出当前用户的项目 |
    | GET | `/api/studio/projects/{id}` | 项目详情 |
    | DELETE | `/api/studio/projects/{id}` | 删除项目(级联) |
    | POST | `/api/studio/projects/{id}/follow-up` | 单回合续写(SSE) |
    | POST | `/api/studio/projects/{id}/generate` | 四幕批量生成(SSE) |
    | PATCH | `/api/studio/episodes/{id}` | 集级持久化 |
    | POST | `/api/studio/episodes/{id}/assets` | 单集内手添资产 |
    
    ### studio_engine.py 关键函数
    
    ```python
    # web_runner/studio_engine.py
    
    SYSTEM_PROMPT_TEMPLATE = """你是连续剧编剧,熟练运用「起承转合」四幕结构。
    - 单集时长 15 秒,分 5 段镜头,每段 3 秒。
    - 角色编号 C01..C99、场景 S01..S99、道具 P01..P99,项目内唯一。
    - 时间轴分镜格式严格遵循 Seedance 2.0 模板:
      0-3s 画面:...
      3-6s 画面:...
      6-9s 画面:...
      9-12s 画面:...
      12-15s 画面:...
      【声音】配乐 + 音效 + 对白
      【参考】@图片1 角色 @图片2 场景
    - 末集尾帧记录「本集最后一帧:...」,供下一集视频延长使用。
    - 风格遵循系统注入: {style}
    """
    
    def build_follow_up_prompt(existing_script: str, user_hint: str) -> str:
        return f"""以下是已有剧本片段:
    {existing_script}
    
    用户希望:{user_hint}
    
    请在保持风格一致的前提下续写不超过 500 字。"""
    
    def build_four_act_prompt(synopsis: str, n_episodes: int) -> str:
        return f"""灵感:{synopsis}
    
    请写 {n_episodes} 集,每集约 15s 镜头 = 5×3s。
    - 第 1 集 = 起,第 2 集 = 承,第 3 集 = 转,第 4-N 集 = 合
    - 输出格式:每集用 `## 集 X · 起/承/转/合 · <标题>` 开头,内含"素材清单"+"时间轴"+"尾帧"三节。
    """
    
    async def parse_llm_stream_to_episodes(
        chunks: AsyncIterator[str],
    ) -> AsyncIterator[tuple[str, dict]]:
        """流式解析,容错宽松。Yield:('episode', {...}) | ('asset', {...}) | ('raw', text)|('error', exc)"""
        ...
    ```
    
    ### SSE 协议规范
    
    `POST /api/studio/projects/{id}/generate` 接受 `{ episode_count: int }`,响应 `Content-Type: text/event-stream`,事件类型如下:
    
    ```
    event: meta
    data: {"total_episodes": 5, "model": "anthropic/claude-3.5-sonnet"}
    
    event: chunk
    data: {"episode_no": 1, "act": "起", "title": "灰烬", "text": "..."}
    
    event: asset
    data: {"kind": "character", "code": "C01", "name": "叶青云", "prompt": "..."}
    
    event: episode_done
    data: {"episode_no": 1, "act": "起", "episode_id": 42}
    
    event: done
    data: {"project_id": 7}
    
    event: error
    data: {"message": "OpenRouter upstream 429"}
    ```
    
    ## 安全 / 计量
    
    | 项 | 实现 |
    |---|---|
    | 鉴权 | 复用 `@login_required` + `_load_project(user_id, project_id)` 二次校验 |
    | 用量 | 复用 `usage_metering` 中间件:`studio.generate` = 4 credits/集,`studio.follow_up` = 1 credit/次 |
    | 模型选择 | 默认 `anthropic/claude-3.5-sonnet`(剧本结构化最强);OpenRouter 透传,不绑死 |
    | 数据隔离 | 所有读路径带 `WHERE owner_user_id = ?`,不返回他人项目 |
    | Soft delete | 不做,直接 hard delete + `ON DELETE CASCADE`,符合"项目级数据"语义 |
    
    ## 失败模式
    
    | 场景 | 行为 |
    |---|---|
    | OpenRouter 429 / 余额耗尽 | 后端捕获 → SSE `event: error` + 写一行日志 |
    | AI 输出非 JSON | 后端解析失败 → 整段视为 raw_text,塞进当前 episode 的 `raw_text` 字段,前端 prose 渲染,不抛错 |
    | 用户中途关闭浏览器 | 已写入 DB 的 episode 保留;下次进入通过 `GET /projects/{id}` 看到完整状态 |
    | 资产编号冲突 | 数据库 `UNIQUE` 约束兜底 → `IntegrityError` → 后端 +1 自动选下一个空号 |
    | 双 generating 同项目 | `POST /generate` 检查 project.status:`generating` 时拒绝 + 返回 409 |
    
