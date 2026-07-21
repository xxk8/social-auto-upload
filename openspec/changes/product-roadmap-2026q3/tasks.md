# product-roadmap-2026q3 (umbrella) — Tasks 已下沉到子变更

> **状态**：本 umbrella 任务已全部下沉到 5 个子变更的 `tasks.md`。本文件保留为**子变更导航**。**不要再在本目录里勾选 / 新增 task**。

## 子变更索引（共 151 个 checkbox）

| 子变更 | 任务文件 | Task 总数 | 涉及 checkbox 段 |
| --- | --- | --- | --- |
| [`phase1-content-publish-loop`](./../phase1-content-publish-loop/tasks.md) | tasks.md | 34 | 原 1-8 段（DB / 适配器 / 轮询 / 路由 / 前端 / 批量导入） |
| [`phase2a-publish-intelligence`](./../phase2a-publish-intelligence/tasks.md) | tasks.md | 23 | 原 9-15 段（智能排期 + 内容模板） |
| [`phase2b-media-production`](./../phase2b-media-production/tasks.md) | tasks.md | 35 | 原 16-23 段（视频切片 + 字幕 + 封面） |
| [`phase3-trust-and-monitoring`](./../phase3-trust-and-monitoring/tasks.md) | tasks.md | 46 | 原 24-35 段（合规 + RSS + 竞品 + 通知 + A/B） |
| [`phase4-collab-and-monetization`](./../phase4-collab-and-monetization/tasks.md) | tasks.md | 13 | 原 36-38 段（审批 + REST + Webhook） |
| **合计** | | **151** | |

## 拆分理由

1. 单 PR 容纳 151 个 checkbox 不可能（跨 16 周工作量）
2. 5 个子变更的 capability 域**互不重叠**，可独立推进
3. 团队工作模式是 TBF-XXX ticket 的小 PR（见 git log）
4. 子变更可分别 apply / archive，互不阻塞

## 历史 tasks 摘录

如需查阅原始 1-38 段编号的 task 列表，请直接阅读 5 个子变更的 `tasks.md`，每段都保留原编号（如 `phase1-content-publish-loop/tasks.md` 含原 1-8 段）。
