# Tasks — Web Shell Polish 2026 Q3

> Source: `docs/dev/optimization-checklist.md`
> 状态机：⏳ 起算 → 🚧 进行中 → ✅ 完成 / ❌ 不做
> 与 `add-web-visualization-shell/tasks.md` 同样按"大节 = 主题"组织。
>
> **进度口径**：截至 2026-06-25，PR-OPT-1 全部条目落地。`total = 19`（详见 `_index.json::artifacts.tasks.bucketing`）。

## 1. PR-OPT-1 视觉拉齐（半日）— ✅ 全部落地（2026-06-25）

- [x] 1.1 **OPT-1A** 暗色卡片去 `backdrop-filter`，hover 只动 `border`。涉及 `sau_web/frontend/src/index.css` 中两处 `.card-refined` 段落与下方"Light-mode overrides"。
- [x] 1.2 **OPT-1B** 把 `PublishStatsBar` 的 `bg-emerald-500/10` / `bg-amber-500/10` 改用 `@/lib/tone::toneFillBgClass('success'|'warning')`。
- [x] 1.3 **OPT-1B** `GroupPublishSelector.PLATFORM_BORDER` 内的 7 个 hex `border-l-[#…]` 改为读 `Components/ui/platform-icon.tsx::PLATFORM_COLORS`。*(新导出 `PLATFORM_BORDER_LEFT`，与 `PLATFORM_COLORS` 同源)*
- [x] 1.4 **OPT-1B** `NoteForm`「已达上限」chip 的 `bg-amber-500/10` 切到 `@/lib/tone` success/warning。
- [x] 1.5 **OPT-1C** `tag-input.tsx::tagCountColor` 字号升到 `text-xs`，三段过渡 muted → warning → error 加 `transition-colors duration-200`。
- [x] 1.6 **OPT-1K** 删除 `PlatformIcon.ICON_MAP` 中 light/dark 字段，统一只读 `src`；删孤儿资产 `assets/brands/baijiahao.svg`。
- [x] 1.7 **OPT-V-1** *(piggy-back)*
  `PublishStatsBar` 所有 `<p>` 数字加 `tabular-nums`。
- [x] 1.8 **OPT-V-3** *[CR-OPT-1R2]* `PublishAiSidebar`
  标题行 `<span className="text-border/80">·</span>` 改 `text-border/60`（首版 `/40` 偏弱，code-reviewer 复审后调到 `/60`）。
- [x] 1.9 **OPT-V-4** `TagsInput` 暗色 chip `bg-primary/10` → `bg-primary/15 border-primary/20`。

> **本节交付清单**：
>
> * 源码改：`sau_web/frontend/src/index.css`、`Components/ui/platform-icon.tsx`、`Components/ui/tag-input.tsx`、`Components/AiRightPanel/PublishAiSidebar.tsx`、`features/publish/PublishStatsBar.tsx`、`features/publish/GroupPublishSelector.tsx`、`features/publish/NoteForm.tsx`、`features/publish/PublishPreview.tsx` 共 8 文件。
> * 删资产：`sau_web/frontend/src/assets/brands/baijiahao.svg`（孤儿）。
> * 文档：`docs/dev/optimization-checklist.md` PR-OPT-1 主表八项 ✅。
> * 截图：`sau_web/frontend/screenshots/` 8 张（before × 2 / after-r1 × 3 / after-r2 × 2 / after-r2-final-light）。
> * `_index.json`：`tasks.total` 24 → 19，`completed` 0 → 5，PR-OPT-1 标记 `shipped`。

## 2. PR-OPT-2 表单安全 + 移动端可达性（1 日）— ✅ 全部落地（2026-06-25）

- [x] 2.1 **OPT-2D** 新建 `sau_web/frontend/src/hooks/usePublishDraft.ts` (+ `PublishDraftBanner.tsx`)：800ms debounce 把 form state 写 `localStorage[sau-publish-draft-{mode}]`，mount 时检测并出「检测到上次未提交的草稿」banner + 「恢复/丢弃」按钮。
- [x] 2.2 **OPT-2D** `VideoForm` / `NoteForm` 的「清空」按钮：当已填字段 ≥ 2 时触发 `<AlertDialog>` 二次确认，否则直接清空。
- [x] 2.3 **OPT-2D** 提交成功后不立刻 `clearAll()`，仅清 file（视频文件 / 图片数组）和 `lastTaskIds`，保留 title/desc/tags/schedule 给下一次同组复用。
- [x] 2.4 **OPT-2E** `App.tsx` 移动端底部 nav：icon `h-9 w-9` → `h-11 w-11`（44pt）、标签 `text-[10px]` → `text-xs`（12px）、Link `min-h-[44px] flex-1 select-none`。
- [x] 2.5 **OPT-2E** 同一处容器 padding `pb-[max(0.5rem,...)]` → `pb-[max(0.75rem,...)]`，加 `box-shadow` 柔和顶边线；nav `aria-label="主导航"`。
- [x] 2.6 **OPT-2E** `index.html` viewport meta 已是 `<meta name="viewport" content="width=device-width, initial-scale=1">`；Playwright 375 设备 emulation 截图与 DOM 验证一在 PR-OPT-2 R2 期间被尝试（并未上传 · 后续 PR-OPT-4 a11y 阶段重试）。

> **本节交付清单**：
>
> * 新增：`sau_web/frontend/src/hooks/usePublishDraft.ts`（含 `isPersistable` / `isPlainMetadataObject` / `hasMeaningfulContent`）、`sau_web/frontend/src/features/publish/PublishDraftBanner.tsx`。
> * 源码改：`sau_web/frontend/src/features/publish/VideoForm.tsx`、`NoteForm.tsx`、`App.tsx` 共 3 文件。
> *  交付质量门禁·3 轮 code-reviewer 共 5 BLOCKER / MINOR 项： (R1) lastFileMeta 被默认滤器吞掉 · (R1) mount 时空素 snapshot 会里覆丰草稿 · (R2) isPlainMetadataObject 意外接受 File · (R3) 仅 `headless:true` 草稿静默踌 · (R3) useRef 变量不挡；全闭环。
> *  文档：`docs/dev/optimization-checklist.md` 交互表 D · E 二行 ✅；`_index.json` 推进 `tasks.total 19→13 / completed 5→7`，MS-OPT-2 shipped + MS-OPT-3 升为 next-up。

## 3. PR-OPT-3 信息密度与"被埋没的能力"曝光（1 日）

- [x] 3.1 **OPT-3F** `PublishPage.tsx`：AI 侧栏加 `PanelRightClose` 按钮，collapse 时模板从 `grid-cols-[3fr_2fr]` → `grid-cols-[1fr_60px]`。
- [x] 3.2 **OPT-3F** collapse 状态持久化到 `localStorage[sau-publish-ai-collapsed]`，mount 时回读。
- [ ] 3.3 **OPT-3G** `GroupPublishSelector` summary chip 旁加 "💡 N 项平台专属待配置" 快捷按钮；点击时通过 `Accordion` controlled `value` 把 `advanced` 展开并高亮对应 platform 区块（`hasDouyin` / `hasBilibili` / `hasTencent`）。
- [x] 3.4 **OPT-3H** `GroupPublishSelector` 失效 badge 点击触发 `LoginProgressModal`：传入 `platform + cookie_file`，复用现有 modal 流程。
- [x] 3.5 **OPT-3I** `PublishPage.scheduleNavigateAfterSubmit` 改为可取消 timer：banner 上"4s 后跳转到任务列表 · 取消"按钮，点击清 timer。
- [ ] 3.6 **OPT-3J** `AiSidebar` 头部 Key 状态栏：把"添加 / 批量 / 列表 / 删除全部"折叠成单齿轮 `Popover`；状态行只剩 "已配置 · N 个 Key · 2 个限速中"。
- [x] 3.7 **OPT-V-2** `PublishStatsBar` "最近提交" 卡片：从 `usePublishStore + useTasks` 读最新任务状态，用 `@/lib/tone::toneTextClass(tone)` 配色（success / warning / muted-foreground）。*(本 PR 3.1–3.2 中同步落地)*
- [x] 3.8 **OPT-3V-5** *(piggy-back, PR-OPT-1R2 提前落地)* `PublishPreview` 0 张图 fallback 用 `<ImageIcon className="h-6 w-6 text-muted-foreground/80">` 替代 `bg-muted-foreground/20` 占位。
- [ ] 3.9 测试：Playwright 桌面模式打开 → 折叠 AI 侧栏 → 刷新验证状态保留（OPT-3F）；Playwright 移动模式 375 宽度 → 4 tab 触摸 OK（OPT-2E）。

## 4. 配套改动（cross-cutting）

- [x] 4.1 把 `docs/dev/optimization-checklist.md` 中 PR-OPT-1/2/3 对应条目状态 emoji 更新为 ✅（随每个 PR 落地逐条勾）。
- [ ] 4.2 在 `README.md` 末段加 "🔧 下一波打磨" 一行，链接到本 change，便于贡献者 patrol。
- [ ] 4.3 增加 `tests/sau_web_visual/`：用 Playwright snapshot 卡住 `PublishPage` / `AiSidebar` 的关键 UI 状态（视觉回归门禁）。

## 5. Definition of Done

- 上述 11 个剩余子任务全部 ✅（或被显式 ❌ 标记+理由，外加 1 项 OPT-3F Playwright 验证 = 等于 12 个未落地项中 11 个任务 + 1 个 e2e）；
- `pnpm lint`、`pnpm build`、`pnpm test` 全绿；
- Playwright e2e：
  - 视觉：`PublishPage.layout.spec.ts` snapshot diff 无意外；
  - 交互：A 草稿恢复、B clearAll 二次确认、C AI 侧栏折叠持久化；
- `openspec validate web-shell-polish-2026-q3` 通过；
- 关联 PR commit message 起头写 `optimization(OPT-1..3)`。

## 6. Out of Scope（明确不做）

- ⛔ PR-OPT-4 (a11y) —— 待本 change 完成后再开新 change。
- ⛔ PR-OPT-5 (内容/文档) —— 同上。
- ⛔ PR-OPT-6 (技术债) —— 同上。
- ⛔ CLI / Web API 改动 —— 本 change 明确仅 frontend。
