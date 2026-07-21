# product-roadmap-2026q3 (umbrella) — High-level Architecture

> 本文件保留 151-task 路线图的**最高层架构视图**；**任何 layer 级别 / 库选型 / 决策细节移至子变更**。本文件不再承载 design 责任。

## 整体架构（Layer 视图）

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (React + TypeScript + Vite + Ant Design)            │
│  PublishPage · AnalyticsPage · TasksPage · 新增 4+ 子页面    │
└──────────────────────────────────────────────────────────────┘
                ↑ HTTP/JSON          ↓ SSE 进度
┌──────────────────────────────────────────────────────────────┐
│ Backend (Flask + web_runner/* + 异步 worker)                  │
│  routes/{metrics,tasks,batch,scheduling,templates,           │
│          video_clip,subtitle,thumbnail,compliance,           │
│          rss,competitor,notifications,api_v1,webhooks}        │
└──────────────────────────────────────────────────────────────┘
                ↑ SQL              ↑ asyncio
┌──────────────────────────────────────────────────────────────┐
│ Data Layer                                                    │
│  PostgreSQL: content_metrics · publish_insights ·             │
│              content_templates · compliance_rules ·          │
│              webhooks · api_keys · tasks (扩展字段)           │
│  File System: 模型缓存 · 临时切片 · 缩略图 · CSV 上传缓冲     │
└──────────────────────────────────────────────────────────────┘
                ↑ 定时调用
┌──────────────────────────────────────────────────────────────┐
│ Scheduler (Flask app 启动时注册的后台 worker)                 │
│  _metrics_poll_worker · _insights_aggregator_worker ·         │
│  _rss_poll_worker · _compliance_rule_aggregator ·            │
│  _webhook_retry_worker                                       │
└──────────────────────────────────────────────────────────────┘
                ↑ 平台 API
┌──────────────────────────────────────────────────────────────┐
│ 平台 API (douyin / bilibili / xiaohongshu / RSS / webhook)   │
└──────────────────────────────────────────────────────────────┘
```

## Capability 分层映射

| Layer | 涉及 Capability | 子变更 |
| --- | --- | --- |
| **数据闭环（效果 / 模板 / 排期）** | content-metrics, smart-scheduling, content-templates | phase1, phase2a |
| **生产链（媒体处理）** | video-clipping, auto-subtitle, thumbnail-generation | phase2b |
| **风险前置 + 外部信号 + 开放** | content-compliance, rss-auto-ingest, competitor-monitoring, notification-system, ab-testing, approval-workflow, rest-api-open, webhook-callbacks | phase3, phase4 |

## 依赖引入时间线

| 依赖 | 引入 Phase | 子变更 |
| --- | --- | --- |
| `moviepy` | Phase 2b | phase2b |
| `scenedetect` | Phase 2b | phase2b |
| `faster-whisper` | Phase 2b | phase2b（**注意**：父 design.md 错误地写"复用 Inbox Whisper 加载逻辑"） |
| `pyahocorasick` | Phase 3 | phase3 |
| `feedparser` | Phase 3 | phase3 |
| `Pillow`, `opencv-python` | 已有 | — |

## 子变更交叉依赖图

```
phase1 (data loop)  ── 依赖 content_metrics 被 phase2a/3 消费
   ↓
phase2a (intelligence)  ── 依赖 content_metrics
   ↓
phase2b (media)  ── 独立（仅依赖 PyAV / ffmpeg）
   ↓
phase3 (trust & monitoring)  ── 依赖 phase1 content_metrics（A/B 对比）
   ↓
phase4 (collab & monetize)  ── 依赖 phase1 tasks 表（approval_status）
```

## Reference

- 子变更 design: [`../phase1-content-publish-loop/design.md`](../phase1-content-publish-loop/design.md) · [`../phase2a-publish-intelligence/design.md`](../phase2a-publish-intelligence/design.md) · [`../phase2b-media-production/design.md`](../phase2b-media-production/design.md) · [`../phase3-trust-and-monitoring/design.md`](../phase3-trust-and-monitoring/design.md) · [`../phase4-collab-and-monetization/design.md`](../phase4-collab-and-monetization/design.md)
- 父 umbrella proposal: [`./proposal.md`](proposal.md)
