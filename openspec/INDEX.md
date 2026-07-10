# OpenSpec 索引 · OpenSpec Index

> 本文件汇总 `openspec/` 下所有变更（changes）与聚合规格（specs）的状态与用途。
> 状态来源：`openspec list`（权威）。结构校验：`openspec validate --changes`（当前 11 通过 / 19 失败）。
> 已归档的历史变更在 [`changes/archive/`](changes/archive/)。

---

## 1. 进行中（in-progress / active）

| 变更 | 创建 | 任务进度 | 用途 |
| --- | --- | --- | --- |
| [`script-studio`](changes/script-studio/) | 2026-07-06 | 0/84 | 脚本工作室（与 `ai-script-studio` 重复，见 §4） |
| [`studio-whiteboard`](changes/studio-whiteboard/) | 2026-07-07 | 0/61 | Studio 白板（tldraw 画布集成，分镜绘制 / 素材标注 / 灵感草图） |
| [`admin-dashboard-social-login`](changes/admin-dashboard-social-login/) | 2026-07-05 | 81/89 | 后台仪表盘社交登录 |
| [`youtube-full-integration`](changes/youtube-full-integration/) | 2026-07-02 | 0/35 | YouTube uploader 接入 CLI/API/前端/Skill/Inbox 五层 |
| [`web-shell-polish-2026-q3`](changes/web-shell-polish-2026-q3/) | 2026-06-25 | 25/28 | Web Shell 抛光（PR-OPT-1/2/3） |
| [`upload-argv-shape-restoration`](changes/upload-argv-shape-restoration/) | 2026-06-29 | 0/19 | 恢复 30 个发布流测试的 CLI argv 契约 |
| [`task-sse-streaming`](changes/task-sse-streaming/) | 2026-07-02 | 0/34 | 任务日志 SSE 流式 + 实时进度 |
| [`public-inbox-monetization`](changes/public-inbox-monetization/) | 2026-07-02 | 0/65 | 公开 /try 试用页 + 访客配额 + 变现漏斗 |
| [`platform-value-upgrade-2026-q3`](changes/platform-value-upgrade-2026-q3/) | 2026-06-25 | 30/88 | 平台功能/UX/性能/商业化综合升级 |
| [`phase5-uploader-migration-tail`](changes/phase5-uploader-migration-tail/) | — | 0/23 | Phase 5 uploader 迁移尾（TiktokNote + YouTubeVideo） |
| [`openrouter-streaming-rotation`](changes/openrouter-streaming-rotation/) | 2026-06-29 | 0/15 | 恢复 8 个 OpenRouter 流式响应（疑似 mock 漂移） |
| [`migrate-sqlite-to-postgresql-19`](changes/migrate-sqlite-to-postgresql-19/) | 2026-06-24 | 16/69 | SQLite → PostgreSQL 19 迁移（active） |
| [`inbox-multi-platform`](changes/inbox-multi-platform/) | 2026-07-02 | 0/27 | Inbox URL 解析扩展到 13 域名 |
| [`fix-baijiahao-schedule-time`](changes/fix-baijiahao-schedule-time/) | 2026-07-02 | 15/21 | 修复百家号随机小时选择 bug（D4 跟进） |
| [`cli-uploader-architecture-consistency`](changes/cli-uploader-architecture-consistency/) | 2026-07-02 | 24/45 | CLI parser 注册表驱动 + BaseVideoUploader 迁移 |
| [`audit-critical-fixes`](changes/audit-critical-fixes/) | 2026-06-24 | 0/31 | 修复 5 critical + 5 high 审计项 |
| [`account-health-monitoring`](changes/account-health-monitoring/) | 2026-07-02 | 0/37 | 账号 cookie 健康度主动预警 |
| [`add-web-inbox`](changes/add-web-inbox/) | 2026-06-27 | 0/7 | Web 后端分享链接下载 + Whisper 转写入口 |
| [`account-group-rename-rollback`](changes/account-group-rename-rollback/) | 2026-06-29 | 0/18 | 修复 rename_account_group 回滚语义 |
| [`project-optimization`](changes/project-optimization/) | 2025-01-24 | 26/29 | 拆分 web_runner、前端懒加载、CI/CD |
| [`publish-page-ai-sidebar-layout`](changes/publish-page-ai-sidebar-layout/) | 2026-06-24 | 0/18 | AI 助手改右侧常驻面板 |
| [`cli-and-uploader-refactor`](changes/cli-and-uploader-refactor/) | 2026-06-24 | 0/32 | CLI/Uploader 重构 + web_runner 子模块提取 |
| [`chat-dexie-persistence`](changes/chat-dexie-persistence/) | 2026-06-24 | 0/13 | 聊天 Dexie 持久化 |

---

## 2. 已完成但未归档（complete，建议 `openspec archive`）

这些变更状态为 `complete`，但仍在 `changes/` 而非 `changes/archive/`。按 OpenSpec 工作流应归档。

| 变更 | 任务 | 用途 |
| --- | --- | --- |
| [`admin-dashboard-ui-redesign`](changes/admin-dashboard-ui-redesign/) | 18/18 | 后台仪表盘 UI 重设计 |
| [`migrate-sqlite-to-postgresql-20`](changes/migrate-sqlite-to-postgresql-20/) | 22/22 | SQLite → PostgreSQL 20 迁移 |
| [`email-auth-login`](changes/email-auth-login/) | 49/49 | 邮箱验证码登录系统 |
| [`drop-legacy-failing-tests-2026q3`](changes/drop-legacy-failing-tests-2026q3/) | 16/16 | 删除遗留失败测试 |
| [`audit-account-groups-unique-collision-2026q3`](changes/audit-account-groups-unique-collision-2026q3/) | 22/22 | 审计 account_groups UNIQUE 冲突机制 |
| [`ai-sidebar-enhancements`](changes/ai-sidebar-enhancements/) | 21/21 | AI 侧边栏增强（平台感知/历史/模板/SSE） |
| [`ai-sidebar-content-generation`](changes/ai-sidebar-content-generation/) | 19/19 | AI 内容生成集成到 PublishPage |
| [`add-web-visualization-shell`](changes/add-web-visualization-shell/) | 27/27 | 最小 Web 壳（React+Vite+Flask） |

---

## 3. 聚合规格 / Specs（`openspec/specs/`）

共 6 个，作为跨变更的长期契约（已删除 4 个仅被已归档变更引用、且代码中无引用的废弃 spec：`bilibili-note-upload`、`chat-form-bridge`、`multi-platform-generate`、`smart-tag-recommend`）：

`ai-stream-multimessage`（代码引用）· `api-reliability` · `chat-persistence` · `cli-hardening` · `frontend-polish` · `multi-turn-chat`

---

## 4. 需整理的项（待确认后处理）

- **重复/停滞的 `no-tasks` 变更（仅 proposal，未实现）**：
  - `ai-script-studio` —— 与进行中的 `script-studio` 重复，疑似废弃提案。
  - `ai-sidebar-bottom-panel` —— 仅 proposal，无 tasks。
  - `ai-sidebar-material-search` —— 仅 proposal，无 tasks（另有 `docs/ai-material-search.md` runbook）。
  建议：确认废弃后删除，或补全 tasks 转为正式变更。
- **状态不同步**：部分 `_index.json` 的 `status` 与 `openspec list` 不一致（如 `cli-uploader-architecture-consistency` 在 `_index.json` 标 `proposed`，CLI 标 `in-progress`）。建议以 `openspec list` 为准，统一索引文件。
- **索引格式不一致**：变更目录下混用 `_index.json` 与 `.openspec.yaml`，少数两者皆无（`admin-dashboard-ui-redesign`、`ai-script-studio` 等）。
- **散落备份文件**：`changes/public-inbox-monetization/_index.bak` 应删除。
- **校验失败**：`openspec validate --changes` 当前 19 个失败，需逐个修复（缺 `design.md`/`proposal.md` 或 spec 结构问题）。

---

## 5. 已归档（参考）

[`changes/archive/`](changes/archive/) 下 4 个：`2026-06-19-add-bilibili-note-support`、`2026-06-21-cli-backend-migration-review`、`2026-06-24-ai-sidebar-multi-turn-chat`、`2026-06-27-ai-content-generation`。

---

## 6. 待回填的规格债务 (Backfill Debt)

> 本节追踪上一轮 wholesale `## 概述 → ## ADDED Requirements` 迁移遗留的 stub 规格，状态为「待回填」。

上一轮 openspec delta-format 迁移后，`openspec/changes/*/specs/*/spec.md` 下有 **57** 个文件包含 `openspec delta-format stub` 标记。这些是占位符，不是正式规格。CI 在 `.github/workflows/ci.yml::openspec-stub-gate` 中以 `docs/openspec-stub-baseline.txt` 为 baseline，冻结 stub 总数禁止净增长（仅允许随 backfill 同步递减）。

**回填顺序（优先级从高到低，与 GitHub Issue 一致）**：

**Tier 1 — 高频功能（用户优先点）**（6 条）
- `openspec/changes/add-web-visualization-shell/specs/web-shell/spec.md`
- `openspec/changes/admin-dashboard-social-login/specs/admin-dashboard/spec.md`
- `openspec/changes/admin-dashboard-social-login/specs/social-login/spec.md`
- `openspec/changes/platform-value-upgrade-2026-q3/specs/publish-wizard/spec.md`
- `openspec/changes/platform-value-upgrade-2026-q3/specs/license-system/spec.md`
- `openspec/changes/platform-value-upgrade-2026-q3/specs/content-preview/spec.md`

**Tier 2 — 核心平台 / 基础设施**（24 条）
- `platform-value-upgrade-2026-q3` 余下 7 条（`analytics-dashboard` · `api-reliability` · `draft-templates` · `frontend-polish` · `multi-turn-chat` · `scheduled-timeline` · `usage-metering`）
- `migrate-sqlite-to-postgresql-19` 4 条（`db-pool-observability` · `pg-database-driver` · `pg-schema-v19` · `sqlite-pg-migrator`）
- `web-shell-polish-2026-q3` 3 条（`design-token-discipline` · `form-draft-safety` · `mobile-tap-target`）
- `cli-and-uploader-refactor` 2 条 + `cli-uploader-architecture-consistency` 1 条
- `public-inbox-monetization` 7 条（`affiliate-rail` · `ethical-ads-sponsor-slot` · `guest-usage-tracking` · `public-inbox-api` · `public-inbox-ops-runbook` · `public-inbox-page` · `public-inbox-quota`）

**Tier 3 — 功能 backlog**（20 条）
- `youtube-full-integration` 5 条 · `account-health-monitoring` 4 条 · `task-sse-streaming` 3 条 · `script-studio` 3 条 · `inbox-multi-platform` 4 条 · `add-web-inbox` 1 条

**Tier 4 — 清理 / 小众**（7 条）
- `ai-sidebar-bottom-panel` 3 条 · `audit-account-groups-unique-collision-2026q3` · `drop-legacy-failing-tests-2026q3` · `fix-baijiahao-schedule-time` · `phase5-uploader-migration-tail`

**回填流程**（内部追踪，backfill assignee 协同）：
1. 选定一个文件，将 `### Requirement: ... (openspec delta-format stub ...)` 与 `#### Scenario: ... (stub)` 改写为正式 delta 格式（参考 `studio-whiteboard/specs/canvas-editor/spec.md` 为模板）。
2. **同步递减 `docs/openspec-stub-baseline.txt`**（减 N = 本 PR 回填的 stub 数）。CI 在 stub 数 < baseline 时会主动 fail 并提示更新 baseline，强制保持 ratchet 单向下降。
3. 在 PR 描述里写明「backfill N stubs for capability X」，方便回溯。
