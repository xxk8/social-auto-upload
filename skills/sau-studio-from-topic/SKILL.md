---
name: sau-studio-from-topic
description: 当 agent 需要根据「主题 + 题材字数」自动生成 9:16 短视频项目时使用这个 skill。该 skill 适配 `social-auto-upload` 仓库的 `web_runner/routes/studio.py` + `sau_web/frontend/remotion_studio/` 已成形的渲染体系。优先通过本 skill 走「主题 → 镜头表 → JSON payload → 现有 POST/render 链路」的产出流程，而不是先去读全部源码再手写。本 skill 输出 (1) Storyboard 镜头表 (markdown) + (2) 可以直接粘贴进 `curl` 调用的 JSON payload / TSX 模板。2 种走法都遵守「不动 `web_runner/` 后端与 `SceneCard.tsx` / `presets.ts` / `Root.tsx` / `index.ts` 4 个既有源码文件」的原则。
metadata:
  tags:
    - studio
    - remotion
    - video
    - sau
    - scripts
    - 短剧
    - 分镜
---

# Topic Studio (主题 → MP4) Skill

> 用一句话主题生成 9:16 竖屏电影的 Storyboard + 落地 payload。
> 重要：本 skill 不修改 `Root.tsx` / `index.ts` / `SceneCard.tsx` / `presets.ts` / `studio.py`。
> 重要：现有 `render.mjs` 硬编码了 `selectComposition({ id: 'StudioProject' })`，所以「粘贴新 Composition」的方案实际上**必然触及 render.mjs**。下面 2 种走法对这点诚实分别说明。
> 重要：原 ask「**可粘到 Root.tsx 旁的 TSX Composition 模板**」与「**严格的零源码改动**」在当前 `render.mjs` 拓扑下是 **mutually exclusive** 的两种约束。skill 给出 2 种 trade-off：(A) **牺牲 TSX 模板**，纯走现有 pipeline JSON payload；(B) **接受 ~6 行 render.mjs patch**，拿 TSX template。两者都保留「不动 `Root.tsx` / `SceneCard.tsx` / `presets.ts` / `studio.py` 4 个既有源码文件」的下限，操作者按需选。

## 何时使用

- 用户给出**一句话主题**（例如 "卧虎藏龙竹林雨"、"九龙城寨夜雨"）
- 同时给出**题材字数**（粗略的总文案字数 / CJK 字符数；不要拿 word_count 字段当英文词数）
- 默认期望 9:16 竖屏，30 fps，片长 ≤ 30s
- 不期望读全部 `remotion_studio/` 源码
- 不期望改 Python 后端或 `web_runner/` 那一层

不适用：你已经有完整 7 段脚本 — 请直接用现有 Studio 的 PATCH + render 流程。skill 只为 「topic → shots → payload」单点能力而生。

## 输入约定

skill 启动时向用户确认：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `topic` | string | **是** | — | 一句话主题。CJK 也接受。例：`卧虎藏龙竹林雨` |
| `word_count` | integer | 否 | 350 | 题材字数（按 CJK 字符计，不要当英文词数）。范围 100 ~ 800 |
| `preset` | enum | 否 | `vibrant` | `classic` / `noir` / `vibrant` / `minimalist` |

`topic` 未填 → **停下来追问**，禁止拍脑袋塞 placeholder。

## 计算公式

```
shot_count = clamp(round(word_count / 50), 3, 7)   // 3 ≤ x ≤ 7

每镜 duration_frames = 60                            // 30 fps × 2s
fade_padding_frames   = 60                            // 收尾淡入淡出
总 durationInFrames   = shot_count * 60 + 60
```

### 字符预算 — 硬上限与推荐配比区分清楚

**硬上限（强制执行，违反会立刻在后端踩坑）**：

```
单行 total ≤ 70 chars  (Python `len()` 计 · CJK / ASCII / 标点 都算 1 char)
单镜头 copy_text ≤ 28 CJK 字  (字幕行上限,同上计法)

走法 A 总预算:  7 行 × 70 chars + 6 \n = 496 ≤ studio.py::_SYNOPSIS_MAX_LEN (500)  ✅
走法 B 总预算:  标记可超 — `[Shot N · EWS · crane · low-key]` 等条目在 TSX 内消化,不在 Pexels 拼接链路
```

**推荐配比（仅为了味道均衡,不强制）**：

```
body_text ≤ 60 CJK 字 主体描述 + ≤ 10 个 ASCII / 中文标点 ≈ 70 chars total  (味道上避免太字)
copy_text ≤ 28 CJK 字 字幕                                          (与 body 解耦后单采计)
```

⚠️ 「推荐」≠「上限」— 上限统一是 **单行 ≤ 70 chars total**，不论字总足 CJK 还是混写 ASCII 都以 70 char 为单一起点。不要把 「60/10」右侧列当作硬约束表读。

> ⚠️ 字符预算**走法 A hard 限 70 chars/line**。如果 `word_count=400` 推出 7 行，每行 70 chars 加 6 个换行 → 496 ≤ 500，server 才不挂。如有 1 行溢出，全部回退到 6 镜 + 重算。
>
> ⚠️ `body_text` 必须让 Pexels 搜得到 ——**禁止**摄影术语（"EWS"、"dolly"、"silhouette"、"Steadicam"、"handheld"、"pan"、"tilt"、"match-cut"），`web_runner/routes/studio.py::_resolve_scene_backgrounds` 会自动拼接 body 进 Pexels query，污染后会被搜出咖啡馆/白天街景等无关图。允许的语义：「主体 + 环境 + 色调 + 物效」。
>
> ⚠️ **走法 A 的 synopsis 每行禁止内联 marker**（`[Shot N · EWS · crane · low-key]`）。理由：marker 单行就占 ~35 ASCII chars，与 70 chars/line 的硬预算不共戴天；marker 进 Pexels query 也污染检索。marker 仅在 Approach B 的 TSX `<Composition title={...}>` 旁作「场记备注」保留。

## 2 种走法的诚实说明（先选 1 种再开始）

### 走法 A ——「现有管线 LLM 化」，**真正的零代码改动**

适用：操作者只是想要「主题 → 7 镜文字 → MP4」，完全不想碰源代码。

#### 流程

1. skill 输出 Storyboard markdown 表格 (7 行以内)
2. skill 把表格转成 **JSON payload**：
   ```json
   {
     "title": "卧虎藏龙竹林雨",
     "synopsis": "<7 行 body_text，每行 ≤70 CJK，用 \\n 连起来>",
     "style": "wuxia-bamboo-rain",
     "render_config": { "preset": "vibrant", "version": 1 },
     "background_queries": ["bamboo forest mist morning portrait", "..."]
   }
   ```
3. 操作者跑 3 步 `curl`（无须新建任何文件）：
   ```bash
   # 1) 建项目
   curl -sS -X POST http://localhost:6001/api/studio/projects \
        -H 'Content-Type: application/json' \
        -d '{"title":"卧虎藏龙竹林雨","synopsis":"(<700 char)","style":"wuxia-bamboo-rain"}'

   # 2) 把 7 镜 + preset 一起 PATCH 进项目（id 从上一步拿）
   curl -sS -X PATCH http://localhost:6001/api/studio/projects/<id> \
        -H 'Content-Type: application/json' \
        -d '{"synopsis":"<7 镜 全文>","render_config":{"preset":"vibrant","version":1}}'

   # 3) 触发渲染
   curl -sS -X POST http://localhost:6001/api/studio/projects/<id>/render \
        -H 'Content-Type: application/json' -d '{}'
   ```

服务端 现有的 `_build_scenes_for_render` + `_resolve_scene_backgrounds` 会自动把 7 行 synopsis 拆成 7 个 SceneCard + 7 个 Pexels 图；`Root.tsx` 已注册 `<Composition id="StudioProject" component={StudioProject}>`；`render.mjs` 硬编码 `selectComposition({ id: 'StudioProject' })`，**全链路无需任何源码改动**。

#### 走法 A 的限制

- 输出片子的 Composition id 永远叫 `StudioProject`，**无法**给每个 topic 起独特 id（想去 `StudioProject-{slug}` 需要走 B）。
- `pexels_query` 由 server 端自动从 `style + scene.title + scene.body` 拼接 → 走法 A 的输出不直接控制 Pexels 选哪张图。如对背景图严格要求，需走 B，预填 `studio_assets.kind='background'` 行。
- `word_count` ≤ 350 时只能产出 ≤ 7 镜；想更多镜只能改 studio.py 的 `_SYNOPSIS_MAX_LEN`。

### 走法 B ——「新 Composition + render.mjs `--entry` flag」，**1 处源码改动**

适用：操作者愿意给每个 topic 起独特 Composition id（如 `Studio-wuxia-bamboo`、`Studio-kowloon-cyberpunk`），且愿意给 `render.mjs` 加 `--entry` flag 接收多入口。

#### 流程

1. skill 输出 Storyboard 表格（同 A）
2. skill 输出**新的 entry-point 文件** 内容（粘到 `sau_web/frontend/remotion_studio/index-topic-studio.tsx`）：
   ```tsx
   import { registerRoot } from 'remotion'
   import { RemotionRoot } from './Root'
   registerRoot(RemotionRoot)
   ```
   （**完全等同于 `index.ts`，但封装路径不同，与现有二选一启动。**）
3. skill 输出**render.mjs 1-line patch**：
   ```diff
   - bundle({ entryPoint: resolve(here, 'index.ts') })
   + // CLI flag lets the topic studio bundle a different root
   + bundle({ entryPoint: resolve(here, argv.entry ?? 'index.ts') })
   ```
   并在文件头 `argv = minimist(process.argv.slice(2))` 把 `argv.entry` 接好。
4. 操作者运行：
   ```bash
   node render.mjs --out out.mp4 --entry index-topic-studio.tsx < payload.json
   ```

#### 走法 B 的限制

- ⚠️ render.mjs 改 5~10 行（不是 1 行，是 bundle 入口 + argv 解析 + 一些 entry 验证）。**这是与「完全不改源码」差距最大的地方**——本 skill 在走法 B 部分直接告诉操作者这 5~10 行长什么样，不藏掖。
- ⚠️ 操作者必须记得每次用 `--entry` flag；默认 `--entry index.ts` 保持现有行为兼容。

## Visual Preset 选择

只能选 `sau_web/frontend/remotion_studio/presets.ts` 里 4 个：

| id | 适用场景 | 备注 |
| --- | --- | --- |
| `classic` | 通用/无明显主题 | fallback，最稳 |
| `noir` | 悬疑/科普/深调 | 衬线感，fade 较长（45 frames），克制 |
| `vibrant` | 带货/赛博/律动 | 高饱和、bounce、短 fade（15 frames），强烈推荐**赛博朋克/夜空主题** |
| `minimalist` | 鸡汤/情感语录 | 静态无 fade，灰白色 |

不确定 → 一律 `vibrant`。`copy_text` 文案风格与 preset 调性匹配：`noir` 短句克制，`vibrant` 动词张力。

## slug() helper （走法 B 唯一需要）

走法 A 不需要 slug；走法 B 必须有 safe slug。

```ts
import { createHash } from 'crypto'

/** 把任意 topic 导出为 ASCII-safe 的 Composition id 后缀 */
export function topicSlug(s: string): string {
  // CJK characters → fall back to sha1 (8 chars) for stability.
  // Pure ASCII → kebab-case for human readability.
  if (/^[a-z0-9 \-_]+$/i.test(s.trim())) {
    return s.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32)
  }
  return createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 8)
}

// 例：
// topicSlug('卧虎藏龙竹林雨')        → 'a4b3c1d2'
// topicSlug('Kowloon Cyberpunk')    → 'kowloon-cyberpunk'
```

## Validation Checklist （输出前必跑）

每条都给一个**对应失败模式**——漏掉会立刻在后端踩坑。

- [ ] **每行 `body_text` ≤ 70 chars**（Python len 维度，CJK+ASCII 都算 1）→ 违反会触发 `_SYNOPSIS_MAX_LEN=500` 后端 400
- [ ] **每行 `copy_text` ≤ 28 CJK** → 违反会触发 `SceneCard::wrapLines(text, 12)` 截断
- [ ] **`shot_count` ∈ [3, 7]** → 违反时重排镜数(word_count/50 自动 clamp)
- [ ] **`palette_hex` 三色组非空洞**（不接受 `#FFFFFF,#000000,#888888`）→ 否则预设视觉无对照
- [ ] **`pexels_query` 没有任何摄影术语**（EWS / CU / dolly / pan / silhouette / Steadicam / handheld / match-cut / whip-pan / tilt / zoom / crane / dolly-in）→ 违反会被 `_resolve_scene_backgrounds` 拼到 query 中，检索结果与主题不匹配
- [ ] **走法 A → `synopsis` 每行禁止内联 marker**（`[Shot N · ...]`）→ marker 单行占 ~35 chars，与 70 chars 硬预算冲突，且 marker 进 Pexels query 污染检索
- [ ] **走法 A → `synopsis` 是纯文拼接**（用 `\n` 连，不是 `,` 或 `;`）→ Python `_build_scenes_for_render` 用 `.split('\n')` 拆镜
- [ ] **走法 A → 拼接后 `synopsis.length ≤ 500 chars`**（`7 × 70 + 6 \n = 496 ≤ 500`）→ 最多 4 chars 余量
- [ ] **走法 A → 不引用 `TopicStudio` 等自定义 Composition id** → 走法 A 永远只用现有 `id="StudioProject"`
- [ ] **走法 B → `topicSlug(topic)` 结果非空且全 ASCII**（CJK 落 sha1 8-hex；纯 ASCII 走 kebab-case）→ 不合规 Composition id 直接 render.mjs 报「no composition with id」
- [ ] **走法 B → render.mjs patch 同时包含 `--entry` argv 解析**（不是只换字符串）→ 否则 flag 不进入 bridge
- [ ] **走法 B → diff ≤ 10 行**（1 行换字符串 + ~3 行 argv + 2 行校验 + 1 行注释）→ 操作者可一行 commit 验
- [ ] **走法 B → 新 entry 文件不内嵌 `RemotionRoot`**，必须自定一个独立的 `TopicRemotionRoot`（不与 `index.ts` 已 `registerRoot(RemotionRoot)` 冲突）→ 否则 Remotion 4 报 `registerRoot called twice`
- [ ] **不动 `Root.tsx` / `index.ts` / `SceneCard.tsx` / `presets.ts` / `studio.py` 任何已有逻辑**

## Validation Output 模板

skill 最终交付，至少包含如下块：

```
## Storyboard

| # | shot_size | movement | lighting | palette_hex | copy_text | body_text | pexels_query |
|---|-----------|----------|----------|-------------|-----------|-----------|--------------|
| ... |

## Payload（走法 A）

```bash
# 3-step curl sequence (no source edits)
curl ... POST /api/studio/projects
curl ... PATCH /api/studio/projects/$ID
curl ... POST /api/studio/projects/$ID/render
```
```
OR
```

## Patch（走法 B）

```diff
--- a/sau_web/frontend/remotion_studio/render.mjs
+++ b/sau_web/frontend/remotion_studio/render.mjs
@@ -X,Y +X,Y @@
- // old bundle call
+ // new bundle call with --entry flag
```

```tsx
// new file: sau_web/frontend/remotion_studio/index-topic-studio.tsx
import { registerRoot } from 'remotion'
import { RemotionRoot } from './Root'
registerRoot(RemotionRoot)
```
```

## 失败模式

| 失败 | 原因 | 修复 |
| --- | --- | --- |
| `POST /api/studio/projects` 返 400 "synopsis 太长" | 7 镜 × 75 chars = 525 > 500 | 收紧 `body_text` ≤ 70 或减到 6 镜 |
| PATCH 后 Pexels 取景对不上 | body 含摄影术语污染 query | 改写为「主体 + 环境 + 色调」主体词 |
| 走法 A 出片非常单调（一图到底 / 一字到底） | synopsis 行被合并成单行 | 确认是用 `\n` 连，不是 `,` 或 `;` |
| 走法 B 提示 `composition "..." not found` | slug 为空 / 含非 ASCII | 用上面的 `topicSlug()` |
| 走法 B render.mjs patch 后所有现有渲染都找不到 `StudioProject` | patch 把默认 entry 改成 `index-topic-studio.tsx` | 保留 `argv.entry ?? 'index.ts'` 的回退 |

## 示例：卧虎藏龙竹林雨 (word_count=350, preset=noir, 走法 A)

### Storyboard

```
| # | shot_size | movement | lighting | palette_hex | copy_text | body_text | pexels_query |
|---|-----------|----------|----------|-------------|-----------|-----------|--------------|
| 1 | WS | static | low-key | `#2A4D69,#A8B5C2,#E8C57A` | 雾气里，竹影只是轮廓。 | 清晨雾气弥漫的竹林远景,翠绿色调中被白色雾气包裹的竹尖若隐若现。 | `bamboo forest mist morning portrait` |
| 2 | MS | tracking | practical | `#1A1A1A,#E8C57A,#A8B5C2` | 衣袂带风，脚步无声。 | 镜头匀速跟随一名白衣女子穿行竹林小径,衣裳随动作徐徐摆动。 | `chinese woman walking bamboo portrait` |
| 3 | MCU | pan | 3-point | `#1A1A1A,#E8C57A,#5C7A4F` | 眼角一滴泪，没落下。 | 侧脸特写摇镜,角色面部三分光:暖黄主光 + 翠绿补光 + 鼻侧阴影。 | `chinese woman rim light bamboo` |
| 4 | WIDE | crane | high-key | `#2A4D69,#5C7A4F,#E8C57A` | 这一切，本是梦。 | 摇臂升高,竹海在雾气与晨曦中层层展开直至远山。 | `bamboo forest sunrise aerial landscape` |
```

**走法 A（占 5 镜示例，操作者把表转 JSON 后跑 3 步 curl 上传）。**

## 不读这些文件

- 不要读 `cli/` 全套
- 不要读 `uploader/*` 模块
- 不要读 `web_runner/db.py`
- 不要读 `sau_cli.py`

只在 troubleshooting 时再读。

## 仅 troubleshooting 时读

- `sau_web/frontend/remotion_studio/components/SceneCard.tsx` — 排「为何画面全黑」时
- `sau_web/frontend/remotion_studio/types.ts` — 排 inputProps 形状错误时
- `sau_web/frontend/remotion_studio/utils/pacing.ts` — 排「durationInFrames 不对」时
- `web_runner/routes/studio.py` — 排 PATCH 400 时
