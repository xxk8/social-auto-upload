## ADDED Requirements

### Requirement: Storyboard Export (openspec delta-format stub — see archived content below)
The `Storyboard Export` capability is added by openspec change `script-studio`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Storyboard Export` workflow is invoked per `openspec/changes/script-studio/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # Storyboard Export 规范
    
    ## 概述
    
    `storyboard-export` 是「剧本工坊」的最后一公里——把 `script-engine` 产出的剧集数据固化为 **Seedance 2.0 时间轴分镜格式**,运营/创作者可直接复制到[即梦](https://jimeng.jianying.com/)或 Seedance 2.0 平台手工执行视频生成。
    
    格式参考 [`liangdabiao/Seedance2-Storyboard-Generator`](https://github.com/liangdabiao/Seedance2-Storyboard-Generator):**完全等价的文件结构、命名规范和分节**,方便运营在两种工具之间迁移内容。
    
    ## 分镜格式规范
    
    ### 单集模板(GFM 严格对齐)
    
    ```markdown
    # {项目标题} · E{集数} · {起/承/转/合} · {单集标题}
    
    ## 素材清单
    | 素材槽 | 文件 | 说明 |
    |--------|------|------|
    | 图片 1 | C01 | 角色参考 · 叶青云 |
    | 图片 2 | S01 | 场景参考 · 青锋山废墟·夜 |
    | 图片 3 | P01 | 道具参考 · 青锋剑 |
    
    ## Seedance Prompt(时间轴格式)
    
    {style_prefix}
    
    0-3秒画面:高空俯拍,废墟全景,灰白墨黑色调,空镜 2 秒后角色走入画面。
    3-6秒画面:镜头推进,叶青云正面半身,眉眼有泪光。
    6-9秒画面:特写断剑,指节发白,镜头上摇。
    9-12秒画面:苦笑,嘴角上扬同时眼尾落泪,缓慢转身。
    12-15秒画面:背影渐远,废墟留白,镜头定格 1 秒。
    
    【声音】配乐:古筝独奏,低音沉郁;音效:剑鸣、风声;对白:"这一剑,我还不起。"
    【参考】@图片 1 角色,@图片 2 场景,@图片 3 道具
    
    ## 尾帧描述
    
    本集最后一帧画面:叶青云背影远去,地上一柄断剑,夕阳斜照。用于下一集(E{集数+1})视频延长的片头衔接。
    ```
    
    ### 项目级 _剧本.md(每剧一份)
    
    ```markdown
    # {项目标题} · 完整剧本
    
    灵感:{synopsis}
    
    风格:{style}
    
    ## 全剧四幕规划
    
    | 集数 | 幕 | 标题 | 时长 | 主要场景 |
    |------|----|------|------|----------|
    | E01 | 起 | 灰烬 | 15s | S01 青锋山废墟 |
    | E02 | 承 | 破局 | 15s | S02 月下古镇 |
    | E03 | 转 | 真相 | 15s | S01 暮色回望 |
    | E04 | 合 | 重逢 | 15s | S03 山门远景 |
    | E05 | 合 | 余音 | 15s | S04 草屋独白 |
    
    ## 资产清单
    
    ### 角色
    - C01 叶青云 — 少年剑客,断剑复仇
    - C02 苏挽月 — 古镇女子,白衣
    
    ### 场景
    - S01 青锋山废墟·夜 — 门派覆灭之地
    - S02 月下古镇 — 灯影摇曳
    - S03 山门远景 — 暮色
    
    ### 道具
    - P01 青锋剑 — 断剑,剑身有裂纹
    
    ## 分集索引
    
    - [E01 · 起 · 灰烬](./E01_分镜.md)
    - [E02 · 承 · 破局](./E02_分镜.md)
    - ...
    
    ## 制作说明
    
    - 本项目使用项目内置的剧本工坊自动生成。
    - 分镜格式与 [Seedance 2.0 Storyboard Generator](https://github.com/liangdabiao/Seedance2-Storyboard-Generator) 等价。
    - 视频生成:把每集分镜粘贴到即梦 / Seedance 2.0,使用素材槽对应图片作为 @图片 1..N 引用即可。
    ```
    
    ## 实现规则
    
    ### 数据 → Markdown 映射
    
    ```typescript
    // src/Components/Studio/StoryboardExport.tsx
    
    export function renderEpisodeMarkdown(
      project: Project,
      episode: EpisodeNode,
      assets: Asset[],
    ): string {
      const referencedCodes = collectReferencedAssetCodes(episode.scenes)
      const assetTableSection = renderAssetTable(assets.filter(a => referencedCodes.has(a.code)))
    
      const timeAxis = episode.scenes.flatMap(s =>
        s.shots.map(shot => `${formatDuration(s, shot)}画面:${shot.description}`)
      ).join('\n')
    
      const soundSection = renderSoundSection(episode)
      const refSection = renderReferenceSection(episode.scenes, assets)
      const endingTail = renderEndingTailFrame(episode)
    
      // 风格前缀:"{style}\n\n" 若 style 字段为空则省略
      return `
    # ${project.title} · E${String(episode.episode_no).padStart(2, '0')} · ${episode.act} · ${episode.title}
    
    ## 素材清单
    ${assetTableSection}
    
    ## Seedance Prompt(时间轴格式)
    
    ${project.style ? project.style + '\n\n' : ''}${timeAxis}
    
    ${soundSection}
    ${refSection}
    
    ## 尾帧描述
    
    ${endingTail}
    `
    }
    ```
    
    ### 严格格式校验(导出前断言)
    
    | 规则 | 检查 |
    |---|---|
    | 时间轴必须恰好 5 段(0-3 / 3-6 / 6-9 / 9-12 / 12-15 秒) | `scene.shots.length === 5` or shots 累加 = 15s |
    | 风格前缀统一 | emoji-free,不含特殊模板字符 |
    | 集标题不能为空 + 不能超过 80 字 | 前端 + 后端双重校验 |
    | 素材编号必须存在 | 引用了一个不存在的 Cxx 自动补 `unmapped: C99` 兜底 |
    | 输出 Markdown < 200KB | 单集 .md 大小限制(防 AI 单集失控生成超长文本) |
    
    ## 导出动作
    
    ### 单集
    
    | 动作 | 实现 |
    |---|---|
    | 复制到剪贴板 | `navigator.clipboard.writeText(markdown)` + Toast「已复制」 |
    | 下载 `.md` | `Blob` + `<a download>` 触发,文件名 `E{集数}_{标题}.md` |
    
    ### 全剧
    
    | 动作 | 实现 |
    |---|---|
    | 批量下载 `.zip` | `jszip` 打包结构: `_剧本.md` + `E01_分镜.md` ... `E0N_分镜.md` + `素材清单.md` |
    | 文件名统一 | 中文允许,使用 file-saver 本地化触发 |
    
    ### 字段一致性
    
    - 全剧 `_剧本.md` 末段必须包含 Seedance 2.0 启发项目链接
    - 单集/E01..E0N 必须有 `E01_分镜.md` 这种下划线命名(空格 / 中划线都拒绝)
    
    ### 字符一致性
    
    | 项 | 要求 |
    |---|---|
    | 中文标点 | 「,」「:」「(」「)」 全角 |
    | 数字格式 | 阿拉伯数字 |
    | emoji | 仅 Toast 名义上允许,Markdown 内容中不允许(降低跨平台渲染差异) |
    | 资产编号 | `[C|S|P]\d{2}` 严格两位数,等同于启发项目 |
    
    ## 与启发项目等价性断言(快照测试)
    
    > 此段为 PR 评审 / 后续兼容性回归测试的硬性要求。
    
    | 启发项目文件(《林教头风雪山神庙》) | 我们的输出文件 |
    |---|---|
    | `林教头风雪山神庙_剧本.md` | `{title}_剧本.md`(下划线,英文版项目用连字符) |
    | `林教头风雪山神庙_素材清单.md` | `{title}_素材清单.md`(仅在 v0.4+ 与分集 E0X 分开;v0.3 内嵌到 `_剧本.md`) |
    | `林教头风雪山神庙_E0X_分镜.md` | `E0X_分镜.md`(无项目前缀,见 §全剧 .zip 布局) |
    
    **注**:启发项目单文件命名是"项目前缀 + 类型",我们为简洁统一为"类型即可 + 全剧目录约束"——这是有意的小差异,便于在 web 端列目录时直接扫描,以 README 注明。
    
    ## API 端点
    
    | Method | Path | 功能 |
    |---|---|---|
    | GET | `/api/studio/projects/{id}/episodes/{no}/export` | 单集 Markdown(纯文本,`Content-Type: text/markdown; charset=utf-8`) |
    | GET | `/api/studio/projects/{id}/export` | 全剧 .zip,`Content-Type: application/zip` |
    
    注:`GET /export` 仅在 `project.status === 'ready' | 'exported'` 时返回 200;否则 409。
    
    ## 测试
    
    | 文件 | 覆盖 |
    |---|---|
    | `StoryboardExport.test.tsx` | 渲染 5 段分镜快照 + 全剧 .zip layout 快照 |
    | `tests/test_studio_export.py` | `GET /export` 鉴权 / status 校验 / zip 文件名 / 内容校验 |
    
    ### Golden file 对比
    
    - 准备 `tests/goldens/{林冲 / 聂风 / 项链}_export_studio.zip`
    - 测试用启发项目原始数据 + 我们的生成器 → 对比 ZIP 内每个 md 与 golden file
    - Diff ≤ 风格前缀差异 / README 段落(允许)
    
    ## 关键文件清单
    
    | 文件 | 操作 |
    |---|---|
    | `sau_web/frontend/src/Components/Studio/StoryboardExport.tsx` | 新建 |
    | `web_runner/routes/studio.py` | 修改(添加 `GET /export` 端点) |
    | `package.json` | 修改(`jszip` 已存在则无须添加) |
    | `tests/test_studio_export.py` | 新建 |
    | `sau_web/frontend/src/Components/Studio/StoryboardExport.test.tsx` | 新建 |
    
