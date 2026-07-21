# Design — Web Shell Polish 2026 Q3

## Context

`docs/dev/optimization-checklist.md` 已经把 22+ 项打磨条目归到五大板块（视觉 / 交互 / a11y / 内容 / 技术债），并按 PR 编号（PR-OPT-1..6）排了节奏。本 openspec change 的目标是 **把前 3 个 PR 阶段（PR-OPT-1 / 2 / 3）正式纳入 spec-driven 流程**，让它们从"checklist 上的 emoji"升级为可被 openspec validate 应用、并可在 PR 描述里被 link 到的原子任务。

这三阶段主要工作面都在 React 前端，唯一可能涉及 Web API 的只剩 `SchedulePicker` 的 ISO 规范化（属于 PR-OPT-6），故本 change 不需要 backend 协同。

环境前提：
- 现有前后端是 React + Vite + Tailwind v4 + shadcn/ui + `@/lib/tone` SSoT；
- `@/lib/tone` 已经把 success/warning/error/info 拆分到底色 / 文本 / ring 等各级 utility；
- `usePublishStore` / `useTasks` / `useAccountGroups` 已稳定，是这一轮草稿/任务状态读写的基座。

## Goals / Non-Goals

**Goals**
- 把 PR-OPT-1 / 2 / 3 共 15 个核心条目（视觉 9 + 表单安全 6）整理为可在 PR 中逐项勾选的任务；
- 推进时不破坏现有功能：发布、账号分组、AI 生成、登录全部回流 expect；
- 主线落地点为 React 前端，TTL 用 localStorage，不引入新后端表；
- 提供"模板库"（PR-OPT-5 范围）这一波先把 store + UI 骨架搭起来，让 5 / 6 阶段后续 change 能直接续。

**Non-Goals**
- 不引入新的依赖管理工具（不增 Redux/MobX 等）；
- 不重新设计提示色板（仅迁移到现有 `@/lib/tone`）；
- 不动 `db/database.db`、不写新路由；
- 不修改 `openapi` 模板或后端 SQL。

## Decisions

**D-1. CSS 颜色回流到 `@/lib/tone` 不再写 hardcoded hex**
- `index.css` 已经留下"single source of truth"注释（"不要在样式表中再加平行规则"），本 change 兑现它；
- 平台专属色读 `PlatformIcon.PLATFORM_COLORS`（已有），不重复。

**D-2. 表单草稿走 useStorage hook 而非新增 store**
- `localStorage[sau-publish-draft-{video|note}]`，用 800ms debounce；
- hook 名：`usePublishDraft(formHandle)`，挂在 form 内部而非 store，避免影响 `usePublishStore.lastTaskIds` 的语义；
- mount 时检测草稿 → toast「已恢复上次草稿」+ 提供「丢弃」按钮。

**D-3. clearAll 二次确认 = AlertDialog，已填 ≥2 字段时才弹出**
- 阈值"≥ 2 字段"而不是"非空"，避免用户在空表单误点弹 modal 反而烦躁；
- 用 `<AlertDialog>` 现成的 Dialog 原语，不引外部 dep。

**D-4. 提交成功后保留 title/desc/tags/schedule，只清文件**
- 与 D-2 协同：草稿恢复时能看到最近一次提交残留的字段，对周期性内容（如周末复盘）友好；
- 提交成功后强制跳转到 `/tasks` 的 timer 是 I 项，需要时可取消，但不因此清空 form。

**D-5. AI 侧栏 collapse 持久化到 localStorage**
- key `sau-publish-ai-collapsed`；
- 默认状态下从 localStorage 读，与初次 collapse 状态绑定 boolean；
- mount 时不能让 layout-shift：先按 `lg:` 维度走默认 [3fr 2fr]，等 measurement 再 clamp。

**D-6. 失效账号就地登录走 `LoginProgressModal`**
- 复用现有组件；
- 从 publish 页面传 `platform + cookie_file` 给 modal，modal 内部再读 `/api/accounts/refresh` 重新写回 cookie；
- 不动 accounts 页面路由。

**D-7. "高级选项"自动展开根据账号组的 platform set**
- 当 `GroupPublishSelector.activePlatforms` 包含 `douyin | bilibili | tencent` 中任一，且对应平台特定字段未填，自动 scroll-to + 展开 Accordion；
- 不强行展开非平台专属字段（仅 schedule + 无头 toggle 不展开）。

**D-8. 模板库 store 雏形**
- 仅在本 change 内搭骨架（`publishTemplates.ts` + 一个 chip 行），不放完整 CRUD；
- 预留 selector 与 import/export JSON 入口，把内容设计推迟到 PR-OPT-5。

## Risks / Trade-offs

- **R-OPT-1：暗色卡片去 `backdrop-filter` 可能让 hover 反馈变"扁平"**
  - 缓解：同时改 `border` 颜色 + 加 `shadow-sm` 微弱外阴影，靠 1px hairline + surface elevation 替代 blur 的"提拉感"。
  - 验收：在 hover 前后用 Playwright `getComputedStyle` 卡一个 border 颜色差值，CI 不会假阳性。

- **R-OPT-2：表单草稿 localStorage 与 SSR / 多 tab 冲突**
  - 缓解：写入时打 `lastModified`、`window.name` 区分 tab；多 tab 时各有 last write wins，但 always show toast「已恢复上次草稿」避免静默踩别人。
  - 验收：开 2 个 tab 分别编辑，关一个，另一个 reload → 仅拿到自己最后一次写入。

- **R-OPT-3：把"高级选项"默认展开，没被常用 platform 用上的字段反而显得多余**
  - 缓解：仅当 platform set 与平台专属字段 (OPT-3G 中 1.3 三块) 任意命中时展开；schedule / headless toggle 仍 default 收起。

- **R-OPT-4：AI 侧栏 collapse 后桌面端只剩 rail，但 rail 内信息（模型名）闪烁**
  - 缓解：从 `useAiStore.selectedModel` 稳定读取，loading 期间显示 "···"。
  - 验收：在 `selectedModel === null` 时不渲染 rail tooltip。

- **R-OPT-5：模板库雏形可能与 PR-OPT-5 (P/R/S/T) 命名冲突**
  - 缓解：本 change 仅放 `publishTemplates.ts` 的 type 与 localStorage 读写，单测不会 hit 完整 UI；PR-OPT-5 可以直接复用。

## Cross-references

- 关联 checklist：`docs/dev/optimization-checklist.md`
- 关联 tasks：`openspec/changes/web-shell-polish-2026-q3/tasks.md`
- 关联依赖：本 change 仅 frontend，CLI / API 不变；`openapi` 模板不动。
- 后续 change 待本 change `applyReady: true` 后开：
  - `web-shell-a11y-2026-q4`（PR-OPT-4）
  - `web-shell-content-polish-2026-q4`（PR-OPT-5）
  - `web-shell-tech-debt-2026-q4`（PR-OPT-6）
