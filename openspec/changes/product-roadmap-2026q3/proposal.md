# product-roadmap-2026q3 (umbrella)

> **角色说明**：本变更已从单变更拆解为 5 个独立子变更（umbrella index 模式）。本文件保留**最高层 Why** + 路线图整体视图；**所有 What Changes / 详细 Impact 移至各子变更**。后续工作请直接在各子变更目录中推进，不要在本目录里加 tasks。

## Why（最高层动机）

social-auto-upload 已具备多平台一键发布、AI 内容生成、Web Shell 运营台等核心能力，但仍存在五大缺口：

1. **数据断裂**：发布后无效果数据回流
2. **效率瓶颈**：逐条手工发布，无批量
3. **内容复用缺失**：历史优质内容无法管理
4. **内容生产链断裂**：长视频无自动切片/字幕/封面
5. **合规风险**：发布前无敏感词预检

本路线图 4 个 Phase 解决上述 5 项 + 协作 / 商业化 3 项远期能力，共 13 个 capability，151 个 checkbox。

## Decomposition（路线图拆分）

| 子变更 | Phase | 任务数 | 覆盖能力 |
| --- | --- | --- | --- |
| [`phase1-content-publish-loop`](../phase1-content-publish-loop/) | Phase 1 | 34 | content-metrics, batch-import |
| [`phase2a-publish-intelligence`](../phase2a-publish-intelligence/) | Phase 2a | 23 | smart-scheduling, content-templates |
| [`phase2b-media-production`](../phase2b-media-production/) | Phase 2b | 35 | video-clipping, auto-subtitle, thumbnail-generation |
| [`phase3-trust-and-monitoring`](../phase3-trust-and-monitoring/) | Phase 3 | 46 | content-compliance, rss-auto-ingest, competitor-monitoring, notification-system, ab-testing |
| [`phase4-collab-and-monetization`](../phase4-collab-and-monetization/) | Phase 4 | 13 | approval-workflow, rest-api-open, webhook-callbacks |
| **合计** | | **151** | **13 capabilities** |

## Sub-change Detail

每个子变更自成独立 openspec 变更，含独立 `proposal.md` / `design.md` / `tasks.md` / `_index.json` / `specs/`。umbrella 不再复制子变更的 detail。

## 已识别的设计勘误

父 design.md 有以下错误，已在子变更中纠正：

- **"复用 Inbox 的 Whisper 模型加载逻辑（`web_runner/routes/inbox.py`）"** —— 不成立。`inbox.py` 当前调用的是 OpenAI API 而非本地 `faster-whisper`。
  - 纠正：[`phase2b-media-production/design.md`](../phase2b-media-production/design.md) § Decisions 1 + Tasks 19.2
- **"封面生成需要新增依赖"** —— 不成立。`Pillow` + `opencv-python` 已是项目依赖。
  - 纠正：[`phase2b-media-production/design.md`](../phase2b-media-production/design.md) § Context

## Open-Source Library Summary

| 能力 | 推荐库 | 引入位置 |
| --- | --- | --- |
| 视频切片 | `moviepy` + `scenedetect` | phase2b |
| 自动字幕 | `faster-whisper` | phase2b |
| 封面生成 | `Pillow` + `opencv-python`（已有） | phase2b |
| 敏感词检测 | `pyahocorasick` | phase3 |
| RSS 解析 | `feedparser` | phase3 |
| 效果追踪 / 批量导入 / 通知 | `requests` + `csv`（已有） | phase1 / phase3 / phase4 |

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](.) (本目录)
- 5 个子变更: 见上表
- openspec/INDEX.md: [`../../INDEX.md`](../../INDEX.md)
