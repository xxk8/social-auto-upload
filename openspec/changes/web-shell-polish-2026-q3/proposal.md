## Why

最近一次 Web Shell 复查发现 22+ 处可优化点集中在 `/publish` 页面及其周边组件：
- 视觉层有几处硬编码颜色/字号绕过 tone SSoT；
- 交互层存在 clearAll 无确认、表单状态易丢失、移动端底部 nav 触摸不达 44pt；
- 信息架构上"高级选项"被默认折叠、平台专属字段几乎隐形。

按 `docs/dev/optimization-checklist.md` 的规划，可拆成 6 个 PR-OPT 阶段推进。考虑到这 6 阶段无法一次完成，建议先把最直接可见、对稳定性影响最小的 **PR-OPT-1（视觉打磨）/ PR-OPT-2（草稿+移动端）/ PR-OPT-3（信息密度）** 三阶段以本 openspec change 的形式固定下来，作为后续 Q3 迭代的 source-of-truth；PR-OPT-4/5/6 待本 change 完成后再新开 change。

落地后将让 Web Shell 从"能用"切到"好用"，与 `docs/dev/VALUE-UPGRADE.md` 主张的"再 6 项就能从能用变好用"路线一致。

## What Changes

- 新建 openspec change `web-shell-polish-2026-q3`，把 PR-OPT-1/2/3 三阶段纳入正式 spec-driven 推进流程；
- 在该 change 下落地 24 个原子任务（详见 `tasks.md`）；
- 暂不修改任何 CLI / Web API，主战场在 frontend；
- 完成后对应回填 `docs/dev/optimization-checklist.md` 的状态 emoji 与 PR 编号。

## Capabilities

### New Capabilities
- `design-token-discipline`：把品牌色 / 平台色统一迁移到 `@/lib/tone` 与 `@/Components/ui/platform-icon.tsx` 的 SSoT，杜绝 hex/CSS inline 散落
- `mobile-tap-target`：移动端底部 nav 与表单交互符合 44pt / iOS HIG 标准
- `form-draft-safety`：VideoForm / NoteForm 支持 LocalStorage 草稿自动保存与恢复

### Modified Capabilities
- `publish-form`：
  - 增加 clearAll 二次确认、提交成功后保留文本字段不重置；
  - 把"高级选项"中的平台专属字段按所选平台默认展开，或提供醒目 CTA；
  - 增加"📂 模板库"chip 一键填充。
- `ai-sidebar`：
  - 把 API Key 管理区折叠成 Popover；
  - 提供 desktop 侧栏 collapse → rail 的能力，状态持久化。
- `account-selector`：失效账号可在发布页面就地触发 `LoginProgressModal` 重登录。

## Impact

**Affected layers (按 openspec `config.yaml::rules.proposal` 要求三段都列):**
- **CLI (`sau_cli.py` / `uploader/`)**: 无改动。所有变更只发生在 React 前端。
- **Web API (`web_runner/` + `routes/`)**:
  - 无新接口。
  - 但 `SchedulePicker`（PR-OPT-3 之后 PR-OPT-6 范围）后续会涉及 `schedule` 字段的 ISO 规范化，本 change 不触碰。
- **Frontend (`sau_web/frontend/`)**:
  - 主要触及：
    - `sau_web/frontend/src/features/publish/{VideoForm,NoteForm,GroupPublishSelector,PublishStatsBar,PublishPreview}.tsx`
    - `sau_web/frontend/src/Components/ui/{tag-input,platform-icon,card,button,tooltip}.tsx`
    - `sau_web/frontend/src/Components/AiRightPanel/PublishAiSidebar.tsx`
    - `sau_web/frontend/src/Pages/PublishPage.tsx`
    - `sau_web/frontend/src/App.tsx`（mobile nav）
    - `sau_web/frontend/src/index.css`（`.card-refined` 与 light-mode overrides 区）
    - 新增：`sau_web/frontend/src/stores/publishTemplates.ts`
    - 新增：`sau_web/frontend/src/hooks/usePublishDraft.ts`
  - 与发布流程联动的 task 状态读取：`useTasks` / `usePublishStore`。

**Dependencies:**
- 现有 `@/lib/tone` token 体系
- 现有 `useMobileDrawer` hook（仅消费）
- 现有 `LoginProgressModal`（仅消费）
- 现有 `usePublishStore.lastTaskIds`（仅消费）

**Risks / Trade-offs 摘要:**
- 见 `design.md` 的 R-OPT-1 ~ R-OPT-4。
