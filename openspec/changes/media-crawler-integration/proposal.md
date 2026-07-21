## Why

`social-auto-upload` 能把视频分发到 7 个平台，但**发布后完全看不到效果反馈**——不知道哪条内容火了、评论在说什么、竞品在做什么。运营团队的痛点：

1. **没有评论管理**：发布后无法自动收集评论，人工翻平台效率极低。
2. **没有竞品分析**：不知道同领域竞品发了什么、什么内容跑得好。
3. **没有效果追踪**：AI 生成内容 → 上传 → 完事。没有数据回流来优化下一轮内容。
4. **两个服务部署麻烦**：[MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)（56.2k★）已经能爬评论/视频数据，但它是独立 FastAPI 服务。用户明确拒绝部署两个服务（"会部署两个，就很麻烦"）。

**MediaCrawler** 覆盖 Douyin、Xiaohongshu、Kuaishou、Bilibili 等平台，提供搜索、详情、评论、创作者数据爬取。与 SAU 有 4 个平台重叠。用户选择**单体集成**（直接嵌入），而非 sidecar/API wrapper 模式。

## What Changes

### 新增功能

#### v0.1 爬虫骨架 + 单平台验证

- 新增 `crawler/` 顶层目录，承载从 MediaCrawler 提取的核心爬取逻辑
- 4 个平台爬虫模块：`crawler/platforms/{xhs,douyin,kuaishou,bilibili}/`
- 抽象基类：`crawler/base/base_crawler.py`（AbstractCrawler, AbstractLogin, AbstractStore, AbstractApiClient）
- 数据模型：`crawler/models/{xhs,douyin,kuaishou,bilibili}.py`（Pydantic）
- 工具函数：`crawler/tools/`（CDP 浏览器、HTTP 客户端、签名、用户匿名化等）
- 爬虫配置：`crawler/config.py`（从 MediaCrawler config 精简）

#### v0.1 存储层对接

- 新增 2 张表：`crawled_content`（爬取内容）、`crawled_comments`（爬取评论）
- 新增 `crawler/store/saulite_store.py`：替换 MediaCrawler 的 JSON/CSV/MongoDB 存储，直接写入 SAU 的 PostgreSQL

#### v0.1 API 路由

- 新增 `web_runner/routes/crawl.py`：爬虫启动/停止/状态查询接口
- 3 个 endpoint：
  - `POST /api/crawl/search` — 关键词搜索爬取
  - `POST /api/crawl/detail` — 指定帖子详情+评论
  - `GET /api/crawl/status` — 爬虫任务状态

#### v0.1 依赖安装

- 新增 `tenacity`、`httpx` 依赖
- 统一使用 `patchright`（替代 MediaCrawler 的 `playwright`）

### 不包含

- IP 代理池（`proxy/` 模块）— 初期不需要
- MediaCrawler 的 FastAPI API（`api/`）— 用 Flask 路由
- MediaCrawler 的 WebUI（`webui/`）— 用 SAU 的 Dashboard
- Weibo、Tieba、Zhihu 平台 — SAU 不上传到这些平台
- AI 情感分析、自动回复 — 后续版本

## Capabilities

| 能力 | 说明 |
|------|------|
| 关键词搜索爬取 | 按关键词搜索小红书/抖音/快手/B站的帖子，采集标题、描述、点赞数、评论数 |
| 帖子详情+评论 | 指定帖子 ID，爬取完整内容 + 所有评论（含子评论） |
| 数据持久化 | 爬取结果写入 PostgreSQL，支持后续查询和分析 |
| CLI 调用 | `sau crawl search --platform xhs --keywords "关键词"` |
| API 调用 | REST API 供 Dashboard 和外部集成使用 |

## Impact

### Backend (Web API)

- 新增 `web_runner/routes/crawl.py` — 3 个爬虫 endpoint
- `web_runner/__init__.py` — 注册 `crawl_bp` Blueprint
- `web_runner/db.py` — 新增 `crawled_content`、`crawled_comments` 建表语句
- 新增 `crawler/` 目录（~30 个文件，从 MediaCrawler 提取+改 import）

### Frontend

- **暂不涉及** — v0.1 仅 CLI + API，Dashboard UI 留到 v0.2

### CLI

- `sau_cli.py` — 新增 `crawl` 子命令（search / detail / status）
