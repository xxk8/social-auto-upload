## Context

Phase 3 覆盖三个关注点：内容风险前置（合规）、外部信号接入（RSS / 竞品）、结果可观测（通知 / A/B 对比）。父 umbrella `product-roadmap-2026q3` 把这一 Phase 命名为"合规 + 监控 + 开放"。

继承自 umbrella 的关键技术决策（保留不变）：

- 合规预检用 `pyahocorasick` Aho-Corasick 自动机
- RSS 用 `feedparser`
- 通知走 Webhook（飞书 / 钉钉 / Slack 通用）
- A/B 测试复用 Phase 1 已就位的 `content_metrics` 表，不另起新表

## Goals / Non-Goals

**Goals:**

- 任何发布动作在 commit 之前可被合规检查阻断
- RSS 源 1 小时级时效性抓取
- 竞品账号变更按天级聚合
- Webhook 失败重试 3 次（指数退避）

**Non-Goals:**

- 不实现评论 / 私信互动（仍属远期）
- 不实现通知邮件通道（v1 仅 Webhook）
- A/B 测试不实现统计显著性检验（仅做基础对比展示）

## Decisions

### 1. 合规检查集成点：发布 commit 前置 + 异步预检

**决定**: 用户在 PublishPage 切换 Tab 时预检 + 提交发布时强制检查；命中规则时弹窗阻断（不可发布）。

**理由**: 同步阻断比异步警告更可靠；不依赖用户主动点合规按钮。

### 2. 平台规则：内置 + 用户扩展双层

**决定**: `compliance_rules` 表分两层：内置规则（代码常量，平台基础禁止项）+ 用户自定义（DB 可 CRUD）。两层都进入同一个 Aho-Corasick 自动机构建。

**理由**: 内置规则随版本更新；用户可针对垂直行业加词；两者查询性能一致。

### 3. RSS 抓取：去重键 = 平台无关的 link hash

**决定**: 同一 RSS 源的同一篇文章 link 作为唯一键，DB 记录已抓取；新内容才创建发布任务。

**理由**: 避免重复发布；hash 比 link 字符串更紧凑。

### 4. 通知重试：同进程内存队列

**决定**: 通知失败入内存队列，按指数退避重试 3 次；进程重启后丢失未发送通知（接受 v1 损失）。

**理由**: 通知 v1 不持久化是合理的 trade-off（用户可手动重新触发）；v2 可升级到 DB 持久队列。

### 5. A/B 测试：tasks 表 + 共享 group 标识

**决定**: `tasks` 表新增 `ab_test_group` 字段（string），同组对比时按 group 聚合 `content_metrics`。

**理由**: 不另起 ab_tests 表，简化数据模型；现有 `content_metrics` 足以支持对比。

## Risks / Trade-offs

- **合规误报** → 命中规则时给"建议修改"提示，但允许"忽略并发布"（记录日志）
- **RSS 抓取频率被源站限流** → per-source 滑动窗口 + 错误退避
- **竞品账号被反爬** → 用户可配置抓取频率；失败时降级为缓存数据
- **A/B 样本不足** → UI 展示"样本不足，结论仅供参考"

## Open Questions

- 合规规则是否需要支持正则（而非仅关键词）？
- 通知 Webhook 签名机制 v1 是否上？v1 暂不上，v2 引入 HMAC

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- 兄弟子变更: [`phase1-content-publish-loop`](../../phase1-content-publish-loop/) · [`phase2a-publish-intelligence`](../../phase2a-publish-intelligence/) · [`phase2b-media-production`](../../phase2b-media-production/) · [`phase4-collab-and-monetization`](../../phase4-collab-and-monetization/)
- 新增依赖: `pyahocorasick`, `feedparser`
- 依赖 Phase 1 产出: `content_metrics` 表（A/B 对比）
- 复用现有模块: `web_runner/routes/tasks.py`（新增 ab_test_group 字段）
