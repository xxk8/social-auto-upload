# 项目文档索引 · Documentation Index

> 本文件是 social-auto-upload 全部文档的**总导航**。按你的角色/目标选择对应分区跳转。
> 子目录 `docs/dev/` 有独立、更细的枢纽：[`docs/dev/INDEX.md`](docs/dev/INDEX.md)。
> 架构/设计双生文件（`DESIGN.md` ↔ `DESIGN-components.md`）内容需保持同步，改动其一须镜像到另一。

---

## 0. 入口 / Entry points

| 文档 | 路径 | 用途 |
| --- | --- | --- |
| 项目主页 README | [`README.md`](../README.md) | 功能特性、架构、安装、快速开始、环境变量、贡献指南 |
| Agent 上下文 | [`CLAUDE.md`](../CLAUDE.md) | `uv`/`patchright` 主线约定、数据库初始化、历史兼容说明 |
| 架构设计（可读版） | [`DESIGN.md`](../DESIGN.md) | 系统架构、配方、a11y 笔记（离线可读） |
| 架构设计（渲染版） | [`DESIGN-components.md`](../DESIGN-components.md) | 与 `DESIGN.md` 内容锁步的组件化渲染形态 |

---

## 1. 用户 / 安装 / User & Install

面向普通用户、创作者、首次部署者。

| 文档 | 路径 | 用途 |
| --- | --- | --- |
| 安装说明 | [`docs/install.md`](install.md) | 依赖安装、首次使用、环境准备 |
| 更新说明 | [`docs/update.md`](update.md) | `git pull` 后重新同步依赖与浏览器驱动 |
| CLI 命令速查 | [`docs/CLI.md`](CLI.md) | `sau <platform> <action>` 子命令、参数、示例 |
| Web Shell 可视化界面 | [`docs/web-shell.md`](web-shell.md) | 可选 React + Flask 界面、CORS、页面与路由 |
| OAuth 社交登录配置 | [`docs/oauth-setup.md`](oauth-setup.md) | Google / GitHub OAuth 申请、重定向 URI、排错 |
| 历史 Web 版本说明 | [`docs/legacy-web.md`](legacy-web.md) | 旧 `sau_backend.py` + Vue 迁移说明 |

---

## 2. 平台接入 / Cookie 管线 / Platform Pipelines

| 文档 | 路径 | 用途 |
| --- | --- | --- |
| B 站 Cookie 管线 | [`docs/bilibili-cookie-pipeline.md`](bilibili-cookie-pipeline.md) | B 站 anti-bot / cookie 导出排查（contributor + maintainer） |
| 抖音 Cookie 管线 | [`docs/douyin-cookie-pipeline.md`](douyin-cookie-pipeline.md) | Chrome DevTools → `cookies/douyin_66.json` → `/api/inbox/download` |

---

## 3. 设计与调研 / Design & Research

| 文档 | 路径 | 用途 |
| --- | --- | --- |
| Admin Dashboard 设计方案 | [`docs/DESIGN-admin-dashboard.md`](DESIGN-admin-dashboard.md) | 后台仪表盘重设计（Draft） |
| Webhook 通知系统 | [`docs/DESIGN-webhook-notifications.md`](DESIGN-webhook-notifications.md) | 上传结果推送飞书/钉钉/企业微信（Draft） |
| 批量导入上传 | [`docs/DESIGN-batch-import.md`](DESIGN-batch-import.md) | CSV/JSON 批量创建上传任务（Draft） |
| 内容日历视图 | [`docs/DESIGN-content-calendar.md`](DESIGN-content-calendar.md) | Web Shell 日历排期视图（Draft） |
| AI 助手面板 UI 重构调研 | [`docs/ui-redesign-research.md`](ui-redesign-research.md) | 对比 ChatGPT/Claude/Gemini/Cursor，提出重构方向 |
| 去重检测对抗指南 | [`docs/anti-duplicate-detection.md`](anti-duplicate-detection.md) | 视频/图片去重检测规避 |
| 图片素材搜索 Runbook | [`docs/ai-material-search.md`](ai-material-search.md) | Pexels + Pixabay 接入 AI 侧栏（运维/上线者） |
| Agent Bootstrap 提示词 | [`docs/agent-bootstrap.md`](agent-bootstrap.md) | OpenClaw / Codex / Claude Code 启动提示词 |
| Vitest 测试套件 | [`docs/vitest-suite.md`](vitest-suite.md) | Web Shell 前端 vitest 套件结构与约定 |

---

## 4. 运营 / on-call / Operations

当班、监控、回滚等运营侧入口。详见 [`docs/dev/INDEX.md`](docs/dev/INDEX.md) 的 Operators 分区。

- On-call cron 排错：[`docs/dev/monitor-cdp-throttling-cron-ops.md`](docs/dev/monitor-cdp-throttling-cron-ops.md)
- Public-Inbox 终止阈值：[`docs/dev/public-inbox-ops.md`](docs/dev/public-inbox-ops.md)
- Account Health 调优表：[`docs/install.md` §11](install.md#11-account-health-monitoring)（SAU_HEALTH_* + SAU_COOKIE_STALE_HOURS 的默认值 / 范围 / ORTHOGONAL TRIGGERS）

---

## 5. 数据库 / 性能 / Database & Performance

PostgreSQL schema、索引、查询优化、性能基线。运维/调优侧入口 — 镜像 `docs/dev/INDEX.md` 中 TBF-018 cron runbook 的 1-click discoverability 模式。

| 文档 | 路径 | 用途 |
| --- | --- | --- |
| 索引 & 性能拓扑 | [`docs/perf-indexes.md`](perf-indexes.md) | 24 个索引的完整清单 + round-7 新增 3 个索引的深度解读 + autovacuum 调优（4 个高 churn 表的 `ALTER TABLE ... SET` 已部署）+ 未来 BRIN/分区/物化视图/JSONB GIN/pg_trgm 策略 + §8「不生效的索引」防误投清单 |
| 性能基线 (EXPLAIN 目录) | [`docs/perf-baseline.md`](perf-baseline.md) | 11 个代表性慢查询的 before/after `EXPLAIN (ANALYZE, BUFFERS)` 输出（3 个 direct target + 8 个 dashboard）+ 复现方法 + 未来 SQL 改造建议（Q6 generated column、Q8 streaming export 等） |
| 性能基线复现脚本 | [`scripts/perf_baseline_capture.py`](../scripts/perf_baseline_capture.py) | 幂等捕获脚本：drop+create `sau_perf` DB → 灌种子数据（5k users + 50k tasks + 15k error_events + 100k usage_logs + 10k verification_codes + 2k audit）→ 抓 BEFORE/AFTER EXPLAIN → 输出汇总表 + 漂移检查（`NEW_INDEXES` 与 `web_runner/db.py` 一致性） |

> **新 operator 着陆路径：** 从 repo 根点 `docs/INDEX.md` → 这里 → 1 跳到任一文档。无需 grep，无需翻 `docs/dev/` 多个 runbook。

---

## 6. 开发文档枢纽 / `docs/dev/`

`docs/dev/` 包含按 **Operators / Contributors / Onboarding** 分组的全部 runbook、战略、规范文档。
**请直接阅读其枢纽页：**[`docs/dev/INDEX.md`](docs/dev/INDEX.md)

主要文件速览：

| 文档 | 路径 | 用途 |
| --- | --- | --- |
| 前端 UI 升级方案 | [`docs/dev/FRONTEND-UI-UPGRADE.md`](dev/FRONTEND-UI-UPGRADE.md) | Ant Design → shadcn/ui 迁移记录 |
| 前端开发规范 | [`docs/dev/frontend-standards.md`](dev/frontend-standards.md) | `sau_web/frontend` 开发约定 |
| 优化 Checklist | [`docs/dev/optimization-checklist.md`](dev/optimization-checklist.md) | 发布中心 + UI PR 评审清单 |
| Hot-reload 设计理念 | [`docs/dev/hot-reload-philosophy.md`](dev/hot-reload-philosophy.md) | 为何自写 `dev_watch.py` |
| 项目升值战略 | [`docs/dev/VALUE-STRATEGY.md`](dev/VALUE-STRATEGY.md) | 2026 Q3 商业化路线 |
| 升值改进建议 | [`docs/dev/VALUE-UPGRADE.md`](dev/VALUE-UPGRADE.md) | 低投入高感知价值 PR 提案 |
| Skill 分发说明 | [`docs/dev/skill-distribution.md`](dev/skill-distribution.md) | Claude skill 分发方式 |
| PostgreSQL 本地开发 | [`docs/dev/postgres-getting-started.md`](dev/postgres-getting-started.md) | PG 19 集群一键搭建 |

---

## 7. 历史计划与规格 / `docs/superpowers/`

早期 agentic 实现计划与设计规格（按日期归档）。

- 计划 Plans：[`docs/superpowers/plans/`](superpowers/plans/)
  - `2026-03-25-bilibili-cli-implementation.md` — B 站 CLI 实现计划
  - `2026-03-25-browser-cli-unification-implementation.md` — 浏览器 CLI 统一实现计划
  - `2026-03-25-xiaohongshu-shallow-alignment.md` — 小红书浅对齐实现计划
- 规格 Specs：[`docs/superpowers/specs/`](superpowers/specs/)
  - `2026-03-25-bilibili-cli-design.md` — B 站 CLI 设计
  - `2026-03-25-browser-cli-unification-design.md` — 浏览器平台 CLI 统一与小红书 Skill 设计

---

## 8. Bug 工单 / `docs/bug-tickets/`

| 文档 | 路径 | 用途 |
| --- | --- | --- |
| Test-App Bugfix 工单 2026 Q3 | [`docs/bug-tickets/test-app-bugfix-tickets-2026q3.md`](bug-tickets/test-app-bugfix-tickets-2026q3.md) | 测试套件清理解锁的修复工单 |

---

## 9. 变更与规格 / `openspec/`

OpenSpec 工作流驱动的增量变更与 aggregate 规格。

- 进行中变更：`openspec/changes/`（约 30 个，覆盖 AI 侧栏、上传器迁移、PostgreSQL 迁移、仪表盘重设计等）
- 聚合规格：`openspec/specs/`（cli-hardening、chat-persistence、frontend-polish 等）

> 浏览具体变更与规格请直接查看 [`openspec/`](../openspec/) 目录。

---

## 10. 其他散落文档 / Misc

根目录还散落若干与文档/设计相关的 Markdown（设计截图说明、`.cursor`/`.kilo`/`.opencode` 工作流命令等），多数由对应工具自动生成，不在本索引逐一收录。
