# 优化 Checklist：发布中心 + 整体 UI

> 适用范围：Web Shell（`sau_web/`），重点是 `/publish` 页面。
> 适用版本：2026-06-25 之后的下一个迭代窗口。
> 与 `docs/dev/FRONTEND-UI-UPGRADE.md`、`docs/dev/VALUE-UPGRADE.md` 互为补充：
> 那两份讲**已完成**与**入口级功能**，这份讲**未做但应当做的细节**。

## 怎么读这份文档

- 每条建议格式：**【ID】标题**
  - **现状**：当前代码里那段的具体写法
  - **位置**：文件路径 + 行号锚点
  - **建议**：可落地的方案（不写具体实现代码，留 PR 落地）
  - **验收**：如何确认 PR 真的解决了问题
  - **PR 拆分**：建议落在哪个 PR 序列里，方便 review
- 状态 emoji 仅作推荐起算点，正式推进时同步到本表：
  - ⏳ 建议起点
  - 🚧 进行中
  - ✅ 已落地
  - ❌ 不做（说明理由）

## 推荐落地顺序概览

| 阶段 | 涉及 ID | 预估工作量 | 期望收益 |
|------|---------|------------|----------|
| PR-OPT-1 | A · B · C · K | 半日 | 视觉一致性基线拉齐 |
| PR-OPT-2 | D · E | 1 日 | "可用 → 安全感"质变（草稿 + 移动端） |
| PR-OPT-3 | F · G · H · I · J · N | 1 日 | 信息密度与"被埋没的能力"曝光 |
| PR-OPT-4 | L · M · O | 半日 | a11y 一次到位 |
| PR-OPT-5 | P · Q · R · S · T | 1 日 | 内容/文档/信息架构 |
| PR-OPT-6 | U · V · W · X · Y | 半日 | 技术债，是顺手的好机会 |

---

## 一、视觉 (Visual)

| ID | 标题 | 状态 |
|----|------|------|
| A | 卡片 hover 过激 + 暗色 backdrop-filter 导致漂浮感 | ✅ |
| B | PublishStatsBar / GroupPublishSelector 硬编码 brand 色，绕过 tone SSoT | ✅ |
| C | TagInput 计数字号过小，到上限瞬切红色 | ✅ |
| K | PlatformIcon 的 light/dark 实际是同一图，没有真正的浅色版本 | ✅ |
| V-1 | StatsBar / PublishPreview 数字未加 `tabular-nums`，宽度抖动（✅ 提早落地于 PR-OPT-1R1，piggy-back via OPT-1B-1） | ✅ |
| V-2 | Stats Bar "最近提交" 永远是 amber，应按成功/失败配色 | ✅ |
| V-3 | AI sidebar 标题行 `·` 用 `text-border/80` 偏深 | ✅ |
| V-4 | TagInput 暗色 chip `bg-primary/10` 偏弱，应 `bg-primary/15 + border-primary/20` | ✅ |
| V-5 | 图文空图占位用文字"—"，改为 `<ImageIcon>` 更柔和 | ✅ |

### 【A】卡片 hover 过激 + 暗色 backdrop-filter 导致漂浮感
- **现状**：`.card-refined:hover` 同时改变 `background` 与 `border-color`，且暗色模式下叠加 `oklch(0.16 .../ 0.60); backdrop-filter: blur(12px)`。
- **位置**：`sau_web/frontend/src/index.css`（`.card-refined` 与"Light-mode overrides"两块）。
- **建议**：
  - 暗色模式二选一：(1) 完全不透明 (`background: var(--card)`)，去 `backdrop-filter`；(2) 统一在所有卡片上加 `bg-card/95`，靠半透明叠层取代 blur。
  - hover 只允许改 1 个属性（推荐改 border-only），通过 surface elevation 表达层级。
- **验收**：暗色模式下，鼠标悬停任一卡，相邻卡的内容不被模糊；hover 后无颜色跳变。
- **PR 拆分**：PR-OPT-1。

### 【B】PublishStatsBar / GroupPublishSelector 硬编码 brand 色，绕过 tone SSoT
- **现状**：`bg-emerald-500/10`、`bg-amber-500/10`、`border-l-[#FE2C55]/70` 等 hex 直接写在组件 className 里。
- **位置**：
  - `sau_web/frontend/src/features/publish/PublishStatsBar.tsx`
  - `sau_web/frontend/src/features/publish/GroupPublishSelector.tsx`
    (`PLATFORM_BORDER` 常量)
  - `sau_web/frontend/src/features/publish/NoteForm.tsx`（"已达上限" amber chip）
- **建议**：
  - 全部改用 `@/lib/tone` 的 `toneFillBgClass('success'|'warning'|'error')` 与 `toneTextClass` 系列；
  - 平台专属色统一迁到 `Components/ui/platform-icon.tsx` 已有的 `PLATFORM_COLORS` 常量，让 `PLATFORM_BORDER` 直接读它。
- **验收**：`grep -R "border-l-\[#\|bg-emerald-\|bg-amber-" sau_web/frontend/src` 在 PR 后几乎为零；`@/lib/tone` 之外的色彩 token 散落 ≤ 3 处。
- **PR 拆分**：PR-OPT-1。

### 【C】TagInput 计数字号过小，到上限瞬切红色
- **现状**：剩余/上限计数用 `text-[10px]` → `text-muted-foreground` → 一次性跳 `toneTextClass('error')`。
- **位置**：`sau_web/frontend/src/Components/ui/tag-input.tsx` 末尾的 `tagCountColor`。
- **建议**：
  - 主体计数字号升到 12px (`text-xs`)；
  - 三段过渡加 `transition-colors duration-200`：muted → warning → error；
  - `transition-all` 改为只 transition color，避免误覆盖 layout。
- **验收**：
  - 在 320px → 1920px 屏幕上，计数都可读；
  - 在 80% / 100% 两个临界点变化柔和，不再"突跳"。
- **PR 拆分**：PR-OPT-1。

### 【K】PlatformIcon 的 light/dark 实际是同一图
- **现状**：`ICON_MAP` 里 `light` 与 `dark` 字段指向的是同一份 `*-dark.svg`。
- **位置**：`sau_web/frontend/src/Components/ui/platform-icon.tsx`。
- **建议**：
  - 删除 `dark` 字段，统一用 `src`；
  - 或者补齐浅色 SVG（如果品牌有）. 主要选择前者更轻量。
- **验收**：浅色 / 深色主题下，平台图标**视觉上一致**（不再依赖 theme 字段），至少不再出现"主题切换图标没变"的反直觉。
- **PR 拆分**：PR-OPT-1。

### 【V-1】数字未加 `tabular-nums`
- **现状**：`PublishStatsBar` `text-lg font-bold leading-none` 数字，主题/统计切换时宽度抖动。
- **位置**：`sau_web/frontend/src/features/publish/PublishStatsBar.tsx`。
- **建议**：所有显示数字的 `<p>` 加 `tabular-nums`。
- **验收**：运行几次刷新后，统计数字不抖动。
- **PR 拆分**：PR-OPT-1。

### 【V-2】Stats Bar "最近提交" 永远是 amber
- **现状**：`<Flag className="... text-amber-600 dark:text-amber-400" />` 永远 amber，与实际成功/失败语义无关。
- **位置**：`sau_web/frontend/src/features/publish/PublishStatsBar.tsx`。
- **建议**：从 task store 读取最新状态映射至 `toneTextClass('success'|'warning')`。
- **V-2 完成版补充**：`PublishPage` 拉 `useTasks()` 作为 polling source，`deriveLastTaskTone(tasks, lastTaskIds)` 输出规则为：空 → null（muted），未查到 → warning（首轮 poll gap），pending/running → warning，任意 `code != 0` → error，全 success → success。结果传到 `PublishStatsBar.lastTaskTone`，后者走 `toneBgClass/lastTaskTone` + `toneTextClass(lastTaskTone)`，取代 hard-coded `'warning'`。
- **验收**：发布成功 → 变绿；有过失败 → 变红/橙；空闲时保持中性灰。
- **PR 拆分**：PR-OPT-3（与I联动）。

### 【V-3】AI sidebar 标题行 `·` 偏深
- **现状**：`<span className="text-border/80">·</span>`。
- **位置**：`sau_web/frontend/src/Components/AiRightPanel/PublishAiSidebar.tsx`。
- **建议**：改为 `text-border/40`，更克制。
- **验收**：在浅色主题下，`·` 几乎呼吸般存在，不抢眼。
- **PR 拆分**：PR-OPT-1。

### 【V-4】TagInput 暗色 chip 偏弱
- **现状**：`bg-primary/10 text-primary`。
- **位置**：`sau_web/frontend/src/Components/ui/tag-input.tsx` chip 部分。
- **建议**：`bg-primary/15` + `border border-primary/20`，让暗色下 chip 边界感更强。
- **验收**：同时按住 macOS 深色模式与高对比度模式，chip 仍可分辨。
- **PR 拆分**：PR-OPT-1。

### 【V-5】PublishPreview 空图占位（\"✅ 提早落地于 PR-OPT-1R2\"）
- **现状**：超过 4 张图展示 `+N`，但 0 张时 fallback 文字用 `bg-muted-foreground/20` 渲染。
- **位置**：`sau_web/frontend/src/features/publish/PublishPreview.tsx`。
- **建议**：用 `<ImageIcon className="h-6 w-6 opacity-40">` 替代文字占位。
- **验收**：预览图文模式未上传时，空态更柔和。
- **PR 拆分**：PR-OPT-3。

---

## 二、交互 (Interaction / UX)

| ID | 标题 | 状态 |
|----|------|------|
| D | 表单 `clearAll` 无二次确认，提交后丢失全部 form state | ✅ |
| E | 移动端底部 nav 字号过小 + 按钮距安全区不足 | ✅ |
| F | Publish 页 AI 侧栏 60/40 硬网格，没有"暂时收起"按钮 | ✅ |
| G | 平台特定字段藏在高级 Accordion 里被忽略 | ✅ |
| H | 失效账号无法在发布页里就地重登录 | ✅ |
| I | 提交成功后跳转不可取消（延时且无取消入口） | ✅ |
| J | AI 助手 Key 管理区密度过高（一行塞 6 个动作） | ✅ |
| N | PubishStatsBar flag 永远 amber（已在 V-2 关联；此处强调状态联动） | ✅ |

### 【D】表单 clearAll 无确认 + 提交后状态清空风险
- **现状**：`<Button variant="outline" onClick={clearAll}>清空</Button>` 一键清空所有 16+ 字段；成功后 `clearAll()` 在 `submit()` 末尾自动执行。
- **位置**：
  - `sau_web/frontend/src/features/publish/VideoForm.tsx`
  - `sau_web/frontend/src/features/publish/NoteForm.tsx`
- **建议**：
  - "清空"按钮 → 仅在已填字段 ≥ 2 时，弹出 `<AlertDialog>` 二次确认；
  - 引入 LocalStorage auto-save：`sau-publish-draft-{video|note}`，每 800ms debounce 写入；在 mount 时若检测到草稿 → toast「已恢复上次草稿」+ 还原按钮；
  - 提交成功后**仅清文件与冗余状态**，保留 title/desc/tags/schedule 给下一次同组复用。
- **验收**：
  - 测试 cases：
    1. 填到一半，刷新页面 → 草稿被恢复。
    2. 提交成功后切回 `/publish` → 仍能看到刚才写的标题/描述（可选确认）。
    3. 主动点"清空" → 弹确认框。
- **PR 拆分**：PR-OPT-2。

### 【E】移动端底部 nav 字号过小 + 触摸区域紧贴底部
- **现状**：底部 nav 4 个 tab，每个 icon `h-9 w-9` (36px)，label `text-[10px]` (≈10px)。底部 `pb-[max(0.5rem,env(safe-area-inset-bottom))]` 偏小。
- **位置**：`sau_web/frontend/src/App.tsx` mobile nav。
- **建议**：
  - icon `h-11 w-11` (44px) + label `text-xs` (12px)；
  - 容器 padding 改为 `pb-[max(0.75rem,env(safe-area-inset-bottom))]`；
  - 增加 `border-t` 透明度渐变 + safe-area-aware 内阴影；
  - 在 iOS 上禁用 `input` zoom：`<meta name="viewport" content="width=device-width, initial-scale=1">` 已存在，确认 body font ≥ 16px。
- **验收**：在 iPhone SE (375x667) 上，4 个 tab 都能舒适点击；与底部 home indicator 有视觉间距。
- **PR 拆分**：PR-OPT-2。

### 【F】Publish 页 AI 侧栏 60/40 硬网格，无"暂时收起"
- **现状**：`grid-cols-[3fr_2fr]` 仅在 lg+ 启用；而移动端走 FAB + drawer 占满全屏。桌面端没有 shrinking。
- **位置**：`sau_web/frontend/src/Pages/PublishPage.tsx`。
- **F 完成版补充**：实测 `PublishAiSidebar.collapsed=true` 下渲染的 rail 包含 Sparkles affordance + PanelRightOpen 按钮（不携带 `aria-controls`，仅 `aria-expanded=false`），undo 状态下 60px 列宽更紧凑。`PublishPage` 的 `{cn('mt-6 grid gap-6 grid-cols-1', aiCollapsed ? 'lg:grid-cols-[1fr_60px]' : 'lg:grid-cols-[3fr_2fr]')}` 是状态唯一的 grid source；LS write 收敛到一个 useEffect，dedup `stored !== want` 以减少 churn。
- **验收**：桌面端用户能在 AI 助手完全收起的状态下专注填表；刷新页面后保留状态。
- **PR 拆分**：PR-OPT-3（F 部分）。

### 【G】平台特定字段藏在高级 Accordion 里被忽略
- **现状**：抖音商品链接、Bilibili 分区、视频号草稿都默认收起。
- **位置**：
  - `sau_web/frontend/src/features/publish/VideoForm.tsx`（Accordion `<AccordionItem value="advanced">`）
  - `sau_web/frontend/src/features/publish/GroupPublishSelector.tsx` 选中平台后的 summary chip
- **建议**：
  - 在 `GroupPublishSelector` summary 旁加"💡 N 项平台专属待配置"快捷按钮；
  - 点击后自动展开 Accordion 并 highlight 对应区块；
  - 反向逻辑已存在的"未配置高级选项时的圆点指示"保留。
- **验收**：选择了"含抖音"的分组时，"高级选项" Accordion 默认展开（或至少有醒目 CTA 提示）。
- **PR 拆分**：PR-OPT-3。

### 【H】失效账号无法就地重登录
- **现状**：`PLATFORM_BORDER` 中"失效" chip + 当前 `auth.valid=false` 标记，但只能去 `/accounts` 页面重扫码。
- **位置**：
  - `sau_web/frontend/src/features/publish/GroupPublishSelector.tsx` (失效 badge)
  - `sau_web/frontend/src/Components/LoginProgressModal.tsx`（已有流程，可复用）
- **建议**：点击失效 row → 弹出 `LoginProgressModal` 就地登录。
- **验收**：在发布页面也能完成失效账号的重新扫码与 cookie 替换；不需要切到账号管理。
- **PR 拆分**：PR-OPT-3（与登录流程 query 复用紧密，建议单独 PR）。

### 【I】提交成功 1.5s 自动跳转不可取消
- **现状**：`scheduleNavigateAfterSubmit` 写死 1500ms 跳转。
- **位置**：`sau_web/frontend/src/Pages/PublishPage.tsx`。
- **建议**：
  - 把跳转做成"可取消的 setTimeout"，banner 上的 `查看任务状态 →` 按钮 hover 5 秒内不再触发；或显示"4s 后跳转到任务列表 · 取消"按钮；
  - 保留 1.5s 默认，但让用户能留住现场以"再发一份"。
- **验收**：成功 banner 出现后，用户能阻止跳转；仍能手动点击 `查看任务状态 →`。
- **PR 拆分**：PR-OPT-3。

### 【J】AI 助手 Key 管理区密度过高
- **现状**：API Key 状态行同时塞：状态 dot、状态文字、添加 Key、批量、Key 列表、删除全部。
- **位置**：`sau_web/frontend/src/Pages/PublishAiSidebar/AiSidebar.tsx` 头部 Key 状态栏。
- **建议**：把管理动作折叠成 `Popover`（齿轮）；状态行只剩 "已配置 · N 个 Key · 2 个限速中"。
- **验收**：状态行一目了然，不再感觉拥挤。
- **PR 拆分**：PR-OPT-3。

### 【N】Stats Bar flag 与提交成功联动
- 已在【V-2】登记，重复列出确保 PR 关联。当与 I 联动 PR-OPT-3 时一起做。

---

## 三、A11y（无障碍）

| ID | 标题 | 状态 |
|----|------|------|
| L | NoteForm 缩略图拖拽排序无键盘替代 | ⏳ |
| M | Dropzone 用 `document.getElementById(...).click()` 绕过 React | ⏳ |
| O | 现有快捷键未集中展示，键盘用户缺乏上下文 | ⏳ |

### 【L】NoteForm 缩略图拖拽无键盘替代
- **现状**：`ThumbnailTile` 仅实现 HTML5 drag-and-drop。
- **位置**：`sau_web/frontend/src/features/publish/NoteForm.tsx` (`ThumbnailTile` 子组件)。
- **建议**：
  - 缩略图加 `tabIndex={0}`，焦点态下：
    - `⌘↑ / ⌘↓` 上移/下移
    - `← / →` 移动一格
    - `Delete` 删除
  - 配 ARIA live region 提示"已上移至第 N 位"。
- **验收**：纯键盘也能完整执行"上传 → 重排 → 删除"。
- **PR 拆分**：PR-OPT-4。

### 【M】Dropzone 用 `document.getElementById(...).click()`
- **现状**：`onClick={() => document.getElementById('video-file-input')?.click()}` 绕过 React 事件系统。
- **位置**：
  - `sau_web/frontend/src/features/publish/VideoForm.tsx`
  - `sau_web/frontend/src/features/publish/NoteForm.tsx`
- **建议**：
  - 改用 `<input ref={fileInputRef}> + <Button onClick={() => fileInputRef.current?.click()}>`；
  - 或者把整个 dropzone 包进 `<label htmlFor="...">`，无需 ref。
- **验收**：在 React 19 + Vite HMR 下，丢失焦点也不会再触发 click；SSR 模式下不报错。
- **PR 拆分**：PR-OPT-4。

### 【O】快捷键集中说明
- **现状**：`Cmd+K` 全局调色板、`Ctrl+Enter` 生成、`/` 搜索、`n` 跳 `/publish`，但只在零散 tooltip 里出现。
- **位置**：
  - `sau_web/frontend/src/App.tsx`（全局监听）
  - `sau_web/frontend/src/Components/AiSidebar/AiSidebar.tsx`（Ctrl+Enter）
- **建议**：
  - 命令面板新增"?"面板，集中列出键位；
  - footer 加 kbd chip 对照表；
  - 在 onboarding tour 第一步介绍键位。
- **验收**：新用户能在 5 秒内通过键位完成"打开命令面板 → 跳到发布 → AI 生成 → 提交"全流程。
- **PR 拆分**：PR-OPT-4。

---

## 四、内容 / Docs / 信息架构 (Content & IA)

| ID | 标题 | 状态 |
|----|------|------|
| P | README 没突出 Web UI 的差异化能力 | ⏳ |
| Q | `install.md` / `update.md` 缺少"快速体验 Web Shell"流程 | ⏳ |
| R | 缺草稿库 / 常用模板（手动填常用内容反复写） | ⏳ |
| S | TasksPage 缺"↻ 重发"快捷按钮 | ⏳ |
| T | 高级字段缺 helper tooltip（什么时候该填） | ⏳ |

### 【P】README 没突出 Web UI 的差异化价值
- **现状**：README 重点讲 CLI，Web Shell 段落只有"Web Shell 文档"一句。
- **位置**：`README.md` "🏁 快速开始" 与目录小节。
- **建议**：
  - 在"🧱 项目架构"后插入"Web Shell 独有能力"小节，列出：
    1. 可视化账号分组一键发布到多平台
    2. AI 自动生成 / 优化标题、描述、标签
    3. 实时发布预览 + 平台专属字段
  - 在"🚀 快速开始"前插一张发布页截图。
- **验收**：
  - 任何读者扫一眼 README 就会意识到："这不是 CLI 套壳，有产品级的 UI"。
  - 截图视觉清晰、可点击放大。
- **PR 拆分**：PR-OPT-5。

### 【Q】install / update 缺流程图
- **现状**：`docs/install.md` / `docs/update.md` 主要是命令行步骤。
- **位置**：`docs/install.md` 末尾 + `docs/dev/agent-bootstrap.md`。
- **建议**：
  - `install.md` 末尾加 "🌐 快速体验 Web Shell" 流程图：启动 → 首次登录 → 创建分组 → 选择平台 → 发布一条，附 4 张截图；
  - `agent-bootstrap.md` 删去 CLI-only 措辞，加入 Web Shell 启动说明。
- **验收**：首次用户能 10 分钟内走完整个流程。
- **PR 拆分**：PR-OPT-5。

### 【R】缺草稿库 / 常用模板
- **现状**：每次发布都要填同样的"美食 · 探店 · vlog ..."。
- **位置**：
  - `sau_web/frontend/src/features/publish/VideoForm.tsx` 与 `NoteForm.tsx`
  - `sau_web/frontend/src/stores/` （现有 AI templates store，可借鉴）
- **建议**：
  - 新建 `sau_web/frontend/src/stores/publishTemplates.ts`：
    - `PublishTemplate = { id, name, mode: 'video'|'note', title, desc, tags, scheduleHint, cover, ... }`；
    - localStorage 持久化，可导入/导出 JSON；
  - `PublishPage` 加一行"📂 我的模板" chip 列，点击后一键填充（不替换已选文件/账号组）。
- **验收**：复杂表单能在 3 秒内一键还原。
- **PR 拆分**：PR-OPT-5。

### 【S】TasksPage 缺"↻ 重发"
- **现状**：`TasksPage` 只有"删除 / 重试"，没有"重发此次"功能。
- **位置**：
  - `sau_web/frontend/src/Pages/TasksPage.tsx`
  - `sau_web/frontend/src/stores/publishStore.ts` (`lastTaskIds`)
- **建议**：
  - 任务行加"↻ 重发"按钮：把当时 title/desc/tags/schedule/平台 selection 拷回 PublishPage 表单，并自动选中原账号组；
  - 提供"覆盖当前表单"或"复制为新草稿"两种语义。
- **验收**："美食 · 周末复盘"这类周期性内容能一键复用。
- **PR 拆分**：PR-OPT-5。

### 【T】高级字段缺 helper tooltip
- **现状**："商品链接"、"短标题"、"原创分类"等字段没有说明何时该填。
- **位置**：`sau_web/frontend/src/features/publish/VideoForm.tsx` 高级选项区。
- **建议**：每个非常识输入框加 `<Tip>` helper 文本，例如：
  - 商品链接 →「只在发布带货视频时填写」
  - 短标题 →「视频号专属，最多 8 字」
  - 原创分类 →「视频号原创声明的二级类目，可选」
- **验收**：新用户在不读文档的情况下能正确填写。
- **PR 拆分**：PR-OPT-5。

---

## 五、技术债 (Tech Debt)

| ID | 标题 | 状态 |
|----|------|------|
| U | `--status-*-border` 已在 CSS 里定义，但 `Alert` / `Toast` 不消费 | ⏳ |
| V | `tag-input.tsx` 内联 `border-[var(--status-error-fg)]/40` 应抽到 tone | ⏳ |
| W | `PublishSuccessBanner` confetti 没看 `prefers-reduced-motion` | ⏳ |
| X | `SchedulePicker` 用 `datetime-local`，跨时区处理不一致 | ⏳ |
| Y | `useMobileDrawer` 在窗口拉窄时没有兜底 | ⏳ |

### 【U】Alert/Toast 未消费 status tokens
- **现状**：`--status-success-border: color-mix(...)` 已定义，但多数 inline `border-amber-200`、`border-destructive/20` 写死。
- **位置**：
  - `sau_web/frontend/src/index.css` 底部注释已明确"不写平行规则"
  - `sau_web/frontend/src/Components/ui/alert.tsx`、`toast.tsx`
- **建议**：
  - 把 `Alert` 的 `variant="success|warning|error|info"` 全部切到 `toneStyleClasses[tone]`（`@/lib/tone` 已有）;
  - 删掉组件内手写的 `border-amber-200 / bg-amber-50` 等。
- **验收**：`grep "border-amber\|border-destructive" sau_web/frontend/src` 在 PR 后归零。
- **PR 拆分**：PR-OPT-6。

### 【V】TagInput 内联 border assertion
- **现状**：

  ```tsx
  isAtLimit && `border-[var(--status-error-fg)]/40 focus-within:${toneRingClass('error')}/40`
  ```

  className 字面量里写了 inline 颜色 token，且拼接方式使得 Tailwind v4 JIT 不一定识别。
- **位置**：`sau_web/frontend/src/Components/ui/tag-input.tsx`。
- **建议**：在 `@/lib/tone.ts` 里新增 `toneOutlineClass(tone)`，将 `border-{tone}/40` 模式封装到 utility；tag-input 直接消费。
- **验收**：TagInput README 一致；Tailwind build 不报"unknown class"。
- **PR 拆分**：PR-OPT-6。

### 【W】Confetti 不感知 prefers-reduced-motion
- **现状**：

  ```tsx
  if (!info || firedRef.current) return
  firedRef.current = true
  // 立即 import('canvas-confetti') + requestAnimationFrame 喷彩带
  ```

- **位置**：`sau_web/frontend/src/features/publish/PublishSuccessBanner.tsx`。
- **建议**：
  - 进入 confetti 函数前加 `if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;`；
  - 或者在 `index.css` 全局：`@media (prefers-reduced-motion: reduce) { .confetti-only { display: none } }`，保留 banner 本身的入场动画。
- **验收**：开启 OS reduced-motion 开关 → 不喷彩带，但 banner 仍出现。
- **PR 拆分**：PR-OPT-6。

### 【X】SchedulePicker 跨时区一致性
- **现状**：`type="datetime-local"` 在 Chrome/Firefox 是本地时间，Safari 部分版本是 UTC。
- **位置**：`sau_web/frontend/src/features/publish/SchedulePicker.tsx`。
- **建议**：
  - 把字符串统一转为 ISO 8601 with timezone (`new Date(value).toISOString()`) 再传给 backend；
  - UI 上加一行 helper："时区: {本地 tz}"；
  - 或者直接换成自研的 `<DatePicker>` + `<TimePicker>`，对齐双日历习惯。
- **验收**：东八区用户设置 18:00 → 服务端收到带 `+08:00` 的 ISO；
  - 夏令时地区不出现 1 小时偏差。
- **PR 拆分**：PR-OPT-6（与 backend 协议协同；建议单独 PR）。

### 【Y】useMobileDrawer resize 拉窄未兜底
- **现状**：抽屉 open 状态在窗口从桌面拉到 < lg 时，没有自动 close。
- **位置**：`sau_web/frontend/src/hooks/useMobileDrawer.ts`（推测）。
- **建议**：增加 `MediaQueryList` listener，当 `matches === false`（即不是 mobile）时调用 `close()`。
- **验收**：在桌面端打开 drawer 后拖窄窗口到 1023px 以下 → 自动 close。
- **PR 拆分**：PR-OPT-6。

---

## 与其它文档的关系

- `docs/dev/FRONTEND-UI-UPGRADE.md` —— 历史迁移记录（Ant Design → shadcn/ui）。
- `docs/dev/VALUE-UPGRADE.md` —— 入口级"升值感"建议（confetti、品牌色、内容预览等），与本文件 **R/S/T 互补**。
- `docs/web-shell.md` —— Web Shell 启动文档，在 PR-OPT-5 时同步更新。
- `openspec/config.yaml` —— `rules.<area>` 部分在 PR 落地后回填实际约束。

## 落地节奏建议

- 每个 PR-OPT-N 完成：
  1. 更新本文件对应状态 emoji；
  2. 在 commit message 起头写 `optimization(OPT-N)`；
  3. 在 PR 描述中链接到本文件的具体条目（"fixes OPT-1A/B"）；
  4. 完成后移动到"已完成"段（如需保留）。
- 维护人：Owner + 任意 contributor。
- 反馈：新增条目时直接 append，按板块归类。
