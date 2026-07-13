## Context

MediaCrawler 是一个成熟的多平台爬虫项目（56k+ stars），基于 Playwright 实现了小红书/抖音/快手/B站/微博/贴吧/知乎的爬取能力。social-auto-upload 已有 4 个重叠平台（xhs/douyin/ks/bili），技术栈一致（都用 Playwright）。

本 change 采用**单体集成**模式，将 MediaCrawler 的核心代码直接嵌入 social-auto-upload，避免部署两个服务。

## Goals / Non-Goals

### Goals
- 在 `crawler/` 目录下重建 MediaCrawler 的全部 7 个平台爬取能力
- 覆盖全部平台：xhs、douyin、ks、bili、weibo、tieba、zhihu
- 替换存储层为 social-auto-upload 的 PostgreSQL
- 提供 CLI + Web API + 前端三种使用方式
- 集成 IP 代理池，支持反爬
- 实现 AI 情感分析，对评论进行正/负/中性分类
- 实现自动回复建议，基于评论内容生成回复
- 保持代码隔离（`crawler/` 目录独立，不污染现有代码）

### Non-Goals
- ❌ 不集成 MediaCrawler 的 WebUI（用 social-auto-upload 的 Dashboard）
- ❌ 不实现自动回复的自动发送（只生成建议，用户确认后手动发送）

## Decisions

### D1: 单体集成而非 Sidecar 服务

**决策**: 将 MediaCrawler 核心代码直接嵌入 social-auto-upload 的 `crawler/` 目录，而非独立部署。

**理由**:
- 避免部署两个服务，运维简单
- 共享同一个 PostgreSQL 数据库
- 共享 cookie/登录态
- 减少网络延迟

**替代方案**: Sidecar 服务（MediaCrawler 独立运行，通过 HTTP API 调用）— 拒绝：部署复杂，需要维护两个进程。

### D2: 全部 7 个平台都提取

**决策**: 提取 xhs/douyin/ks/bili/weibo/tieba/zhihu 全部 7 个平台。

**理由**:
- 爬取代码结构一致（都基于 `AbstractCrawler`），提取成本低
- 微博/贴吧/知乎可作为竞品分析的数据源
- 扩展数据覆盖面，为后续功能（热点追踪、跨平台分析）打基础

**替代方案**: 只提取 4 个重叠平台 — 拒绝：代码结构一致，多加 3 个平台边际成本极低。

### D3: 存储层替换为 PostgreSQL

**决策**: 用 social-auto-upload 的 PostgreSQL 替换 MediaCrawler 的 JSON/SQLite 存储。

**理由**:
- 统一数据存储，避免数据孤岛
- PostgreSQL 支持 JSONB，可以灵活存储原始数据
- 已有 `web_runner/db.py` 基础设施

**替代方案**: 保留 MediaCrawler 的 SQLite 存储 — 拒绝：数据分散，查询不便。

### D4: 代码隔离在 crawler/ 目录

**决策**: 所有 MediaCrawler 相关代码放在 `crawler/` 目录下，与现有代码隔离。

**理由**:
- 避免 import 冲突（如 `config`、`tools.utils`）
- 便于维护和升级（未来可以更新 MediaCrawler 版本）
- 清晰的模块边界

**替代方案**: 将代码分散到现有目录 — 拒绝：污染现有代码结构，增加冲突风险。

### D5: Playwright → patchright 兼容

**决策**: MediaCrawler 的 Playwright 调用改为使用 social-auto-upload 的 patchright。

**理由**:
- patchright 是 Playwright 的 fork，API 兼容
- patchright 有更好的反检测能力
- 统一浏览器驱动，减少依赖

**替代方案**: 保留两个浏览器驱动 — 拒绝：增加复杂度和资源占用。

### D6: 集成 IP 代理池

**决策**: 提取 MediaCrawler 的 `proxy/` 模块，支持 IP 代理池。

**理由**:
- 爬取频率高时容易被平台反爬封禁
- MediaCrawler 已有成熟的代理池实现（kuaidaili/wandouhttp/static）
- 初期用 static 代理，后续可切换到动态代理

**替代方案**: 不集成代理池 — 拒绝：反爬是刚需，裸爬必然被封。

### D7: AI 情感分析用 LLM 而非规则

**决策**: 评论情感分析使用 LLM（OpenRouter/本地模型），而非关键词规则。

**理由**:
- 中文评论语义复杂，规则引擎准确率低
- social-auto-upload 已有 OpenRouter 集成（`web_runner/routes/ai.py`）
- LLM 可以同时输出情感分类 + 摘要 + 回复建议

**替代方案**: 关键词规则引擎 — 拒绝：中文反讽、俚语、表情包无法处理。

### D8: 自动回复只生成建议，不自动发送

**决策**: AI 生成回复建议，用户在 Dashboard 确认后手动发送（或后续接入自动发送）。

**理由**:
- 自动回复有风险（误回复、品牌声誉）
- 用户需要审核 AI 生成的内容
- 后续可加"自动发送"开关

**替代方案**: 完全自动回复 — 拒绝：风险太高，初期不可控。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| MediaCrawler 的 import 路径需要批量替换（~40 个文件） | 使用脚本自动化替换 |
| Playwright/patchright 版本兼容性 | patchright API 与 Playwright 100% 兼容 |
| MediaCrawler 的 `config` 模块与 social-auto-upload 的 `conf.py` 可能冲突 | 隔离在 `crawler/config.py`，不直接 import |
| 异步上下文（MediaCrawler 用 asyncio，Flask 是同步的） | 用 `asyncio.run()` 或 `create_task()` 包装 |
| 法律合规（爬虫可能违反平台 ToS） | docs 注明"仅用于学习研究"，控制爬取频率 |
| IP 代理需要付费服务 | 初期用 static 代理（免费），后续按需升级 |
| AI 情感分析增加 API 成本 | 缓存分析结果，避免重复分析 |

## Migration Plan

- **Phase 1** (Tasks 1-3): 创建 `crawler/` 骨架 + 复制文件 + 替换 import
- **Phase 2** (Tasks 4-6): 存储层对接 + 数据库表 + IP 代理池
- **Phase 3** (Tasks 7-9): Web API + CLI 路由
- **Phase 4** (Tasks 10-12): 前端页面 + AI 情感分析 + 自动回复建议
- **Phase 5** (Tasks 13-14): 测试 + 文档

每 Phase 可独立 revert。建议 Phase 1 + 2 先合并，Phase 3 跟随，Phase 4 + 5 收尾。

## Open Questions

- 爬取频率限制（rate limiting）如何配置？建议在 `crawler/config.py` 中暴露 `REQUEST_DELAY` 参数。
- AI 情感分析的模型选择？建议默认用 deepseek-chat（便宜），可配置切换。
- 自动回复建议的触发时机？建议在爬取评论后自动触发，结果存入 `crawled_comments` 表的 `ai_reply_suggestion` 字段。
