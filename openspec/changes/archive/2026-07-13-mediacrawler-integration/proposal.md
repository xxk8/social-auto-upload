## Why

social-auto-upload 目前只支持"发布"，不支持"采集"。用户发布内容后无法：
- 监控自己视频下的评论
- 分析竞品的热门内容
- 获取平台热点话题
- 了解评论的情感倾向
- 快速回复用户评论

MediaCrawler（56k+ stars）已经实现了小红书/抖音/快手/B站/微博/贴吧/知乎的爬取能力，且技术栈与本项目高度重叠（都基于 Playwright）。与其重复造轮子，不如将其核心能力直接嵌入本项目。

7 个平台覆盖了国内自媒体的核心战场 + 社交讨论社区。

## What Changes

**爬虫核心模块**
- 新增 `crawler/` 目录，从 MediaCrawler 提取全部 7 个平台的核心代码
- 批量替换 import 路径（`config` → `crawler.config`，`tools` → `crawler.tools` 等）
- 覆盖全部平台：xhs、douyin、ks、bili、weibo、tieba、zhihu

**存储层对接**
- 替换 MediaCrawler 的 JSON/SQLite 存储为 social-auto-upload 的 PostgreSQL
- 新增 `crawler/store/saulite_store.py` 对接 `web_runner/db.py`
- 新增 2 张数据库表：`crawled_content`、`crawled_comments`

**IP 代理池**
- 提取 MediaCrawler 的 `proxy/` 模块
- 支持 static 代理（初期）和动态代理（后续）
- 配置化：`ENABLE_IP_PROXY`、`IP_PROXY_PROVIDER_NAME`

**AI 情感分析**
- 新增 `crawler/ai/sentiment.py`
- 调用 LLM（OpenRouter）对评论进行情感分类（positive/negative/neutral）
- 结果写入 `crawled_comments.ai_sentiment` 字段

**自动回复建议**
- 新增 `crawler/ai/reply.py`
- 基于评论内容 + 帖子上下文生成回复建议
- 用户在 Dashboard 确认后手动发送

**Web API 接入**
- 新增 `web_runner/routes/crawl.py` 路由蓝图
- 提供爬虫启动/停止/状态查询/数据查询/回复建议接口

**CLI 接入**
- 新增 `sau crawl search/detail/comments` 命令
- 在 `cli/parser.py` 和 `cli/dispatchers.py` 注册

**前端接入**
- 新增 `/dashboard/crawl` 页面（爬虫任务管理 + 情感分析展示 + 回复建议）

## Capabilities

### New Capabilities
- `crawler-search`: 按关键词搜索 7 个平台的帖子和视频
- `crawler-detail`: 获取指定帖子/视频的详细信息和评论
- `crawler-comments`: 爬取指定帖子下的所有评论（含二级评论）
- `crawler-proxy`: IP 代理池支持，防反爬
- `crawler-sentiment`: AI 情感分析（positive/negative/neutral）
- `crawler-reply-suggestion`: AI 自动回复建议生成
- `crawl-api`: Web API 接口控制爬虫任务
- `crawl-cli`: CLI 命令 `sau crawl search/detail/comments`

### Modified Capabilities
- `web-inbox`: 增加评论数据展示 + 情感标签
- `dashboard`: 新增爬虫管理页面

## Impact

- **CLI**:
  - 新增 `cli/platforms/crawl.py` (~150 行)
  - `cli/parser.py` 加 crawl subparser (~40 行)
  - `cli/dispatchers.py` 加 crawl 分发 (~10 行)
- **Web API**:
  - 新增 `web_runner/routes/crawl.py` (~250 行)
  - `web_runner/__init__.py` 注册蓝图 (~2 行)
  - `web_runner/db.py` 加 2 张新表 (~50 行)
- **Frontend**:
  - 新增 `sau_web/frontend/src/Pages/CrawlPage.tsx` (~350 行)
  - `sau_web/frontend/src/routes.ts` 加 `/dashboard/crawl` 路由
  - `sau_web/frontend/src/api/client.ts` 加 crawl API 调用
- **新增目录**: `crawler/` (~45 个文件，从 MediaCrawler 提取并改造)
- **Dependencies**: `tenacity`、`httpx`（可能需要新增）

## Acceptance Criteria

1. **CLI**:
   - `sau crawl --help` 输出包含 search / detail / comments 三个 subcommand
   - `sau crawl search --platform xhs --keywords "测试"` 能爬取小红书搜索结果
   - `sau crawl detail --platform dy --post-ids "id1"` 能获取抖音视频详情
   - `sau crawl comments --platform bili --post-ids "id1"` 能获取 B站评论
   - `sau crawl search --platform weibo --keywords "热点"` 能爬取微博搜索结果
2. **Web API**:
   - `POST /api/crawl/search` 启动搜索爬虫，返回 task_id
   - `GET /api/crawl/status` 查询爬虫运行状态
   - `GET /api/crawl/data?platform=xhs` 获取爬取的数据
   - `POST /api/crawl/reply-suggest` 生成回复建议
3. **数据库**:
   - `crawled_content` 表存在且可写入
   - `crawled_comments` 表存在且可写入（含 ai_sentiment、ai_reply_suggestion 字段）
4. **AI**:
   - 评论情感分析返回 positive/negative/neutral + 置信度
   - 回复建议生成返回可复制的文本
5. **前端**:
   - `/dashboard/crawl` 页面可访问
   - 能启动/停止爬虫任务
   - 能查看评论数据 + 情感标签
   - 能查看 AI 回复建议
6. **测试**:
   - `pytest tests/` 不回归
   - 新增 `tests/test_crawler.py` 覆盖核心爬取逻辑
   - 新增 `tests/test_crawler_ai.py` 覆盖 AI 功能
