## Context

### 现状盘点

- **`social-auto-upload` 覆盖的链路：`素材 → 多平台自动上传`**。CLI 入口 `sau <platform> upload-video`，支持 7 个平台；Web 端提供账号管理 / 发布中心 / 任务列表 / 收件箱 / 运行日志 / 数据分析 / Admin Dashboard 7 个子页面。
- **发布后无反馈回路**：上传完成即终止。不知道哪条内容火了、评论在说什么、竞品在做什么。
- **MediaCrawler 已有能力**：[MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)（56.2k★，MIT）用 Playwright 爬取 Douyin、Xiaohongshu、Kuaishou、Bilibili 等平台的搜索结果、帖子详情、评论、创作者数据。4 个平台与 SAU 重叠。
- **数据库**：SQLite 开发 / PostgreSQL 生产，双方言表结构由 `web_runner/db.py` 维护。
- **现有 CLI 架构**：`sau_cli.py` 用 argparse，子命令通过 `cli/` 包注册。uploader 用 `BaseVideoUploader` 基类。

### 关键约束

1. **单体部署**：用户明确拒绝两个服务（"会部署两个，就很麻烦"）。MediaCrawler 代码必须嵌入 SAU 代码库。
2. **不破坏现有功能**：7 个平台的上传流程必须不受影响。
3. **Playwright 兼容**：SAU 用 `patchright`，MediaCrawler 用 `playwright`。两者 API 兼容（patchright 是 playwright fork），但 import 路径不同。统一使用 `patchright`。
4. **异步上下文**：MediaCrawler 大量使用 `asyncio`，SAU 的 Flask 是同步的。需要正确包装异步调用。
5. **Import 路径重写**：MediaCrawler 的 import 都是相对项目根的（`import config`、`from base.base_crawler import ...`），需要全部改为 `crawler.` 前缀。

## Goals / Non-Goals

### Goals

- v0.1：**骨架能跑** — 从 MediaCrawler 提取核心模块到 `crawler/`，改完 import，能 `from crawler.platforms.xhs import XiaoHongShuCrawler` 不报错
- v0.1：**数据能存** — 新增 2 张 PostgreSQL 表，爬取结果写入 SAU 的 DB
- v0.1：**API 能调** — 3 个 Flask endpoint，`POST /api/crawl/search` 返回爬取结果
- v0.1：**CLI 能用** — `sau crawl search --platform xhs --keywords "编程"` 执行一次完整爬取

### Non-Goals (v0.1)

- **不做 Dashboard UI** — v0.2 再加前端页面
- **不做 IP 代理池** — `proxy/` 模块不提取，初期直连
- **不做 Weibo/Tieba/Zhihu** — SAU 不上传到这些平台
- **不做 AI 情感分析** — 后续版本
- **不做自动回复** — 后续版本
- **不做竞品报告** — 后续版本

## Decisions

### 1. 目录结构：`crawler/` 顶层目录

**选择**：在项目根创建 `crawler/` 目录，而非嵌入 `uploader/` 或 `skills/`。

**理由**：
- 爬虫和上传是两个独立能力，平级放置更清晰
- `uploader/` 已有 8 个平台的上传器，混入爬虫会增加认知负担
- `skills/` 是 Claude Code 的 skill 机制，不适合放核心业务逻辑

### 2. 存储层：替换而非复用

**选择**：不导入 MediaCrawler 的 `database/` 和 `store/` 模块，而是用 `crawler/store/saulite_store.py` 直接写入 SAU 的 PostgreSQL。

**理由**：
- MediaCrawler 的存储层耦合了 SQLAlchemy session、MongoDB、CSV/JSON 文件写入
- 它的 ORM 模型（`XhsNote`、`XhsNoteComment`）与 SAU 的 schema 不兼容
- 替换存储层只需要实现 `AbstractStore` 接口（3 个方法：`store_content`、`store_comment`、`store_creator`）
- 减少依赖：不需要 `aiomysql`、`pymongo`、`openpyxl`

### 3. Playwright 策略：统一用 patchright

**选择**：将 MediaCrawler 代码中的 `from playwright.async_api import ...` 全部替换为 `from patchright.async_api import ...`。

**理由**：
- `patchright` 是 `playwright` 的 fork，API 完全兼容
- `patchright` 有更好的反检测能力（patch 了 Playwright 被检测的指纹）
- 避免同时依赖两个 Playwright 版本

### 4. Import 重写策略：批量替换

**选择**：将 MediaCrawler 的所有 import 路径从根级改为 `crawler.` 前缀。

**理由**：
- MediaCrawler 用的是 `import config`、`from base.base_crawler import ...` 这种根级 import
- 直接复制会导致 import 冲突（SAU 也有自己的 `config`、`utils`）
- 批量替换是机械化操作，风险低

**具体替换规则**：
```
import config → from crawler import config
from base.base_crawler import → from crawler.base.base_crawler import
from tools import → from crawler.tools import
from tools.xxx import → from crawler.tools.xxx import
from model.xxx import → from crawler.models.xxx import
from cache.xxx import → from crawler.cache.xxx import
from var import → from crawler.var import
from store.xxx import → from crawler.store.xxx import
```

### 5. 配置精简

**选择**：从 MediaCrawler 的 `config/base_config.py` 提取必要配置项，合并到 `crawler/config.py`。

**保留的配置项**：
- `PLATFORM` — 目标平台
- `KEYWORDS` — 搜索关键词
- `CRAWLER_TYPE` — search | detail | creator
- `HEADLESS` — 无头模式
- `SAVE_DATA_OPTION` — 存储方式（新增 `saulite` 选项）
- `ENABLE_GET_COMMENTS` — 是否爬评论
- `LOGIN_TYPE` — 登录方式（cookie | qrcode | mobile）
- `ENABLE_CDP_MODE` / `CDP_DEBUG_PORT` / `CDP_CONNECT_EXISTING` — CDP 模式

**删除的配置项**：
- 代理池相关（`ENABLE_IP_PROXY`, `IP_PROXY_POOL_COUNT` 等）
- MongoDB 相关
- MySQL 相关
- 不支持的平台配置（weibo, tieba, zhihu）

## Risks

### 1. Import 冲突

**风险**：MediaCrawler 的 `tools.utils` 与 SAU 的 `utils/` 可能冲突。

**缓解**：全部重命名为 `crawler.tools.utils`，运行时不会有歧义。

### 2. 异步上下文

**风险**：MediaCrawler 的核心逻辑是 async（`async def start()`），SAU 的 Flask 是同步的。

**缓解**：在 API 路由中用 `asyncio.run()` 或 `asyncio.create_task()` 包装。CLI 中直接用 `asyncio.run()`。

### 3. Playwright 浏览器实例

**风险**：MediaCrawler 每次爬取都启动一个 Chromium 实例，资源消耗大。

**缓解**：v0.1 先单次启动，后续考虑浏览器池化复用。

### 4. 法律合规

**风险**：爬取平台数据可能违反平台 ToS。

**缓解**：控制爬取频率（`time.sleep`），仅用于学习研究目的，不大规模采集。

## Migration Plan

### Phase 1：骨架提取（v0.1 核心）

1. 创建 `crawler/` 目录结构
2. 复制 MediaCrawler 核心文件（~30 个）
3. 批量替换 import 路径
4. 替换 `playwright` 为 `patchright`
5. 创建 `crawler/config.py`（精简配置）
6. 创建 `crawler/store/saulite_store.py`（PostgreSQL 存储）
7. 新增 2 张 PostgreSQL 表

### Phase 2：API 集成（v0.1 收尾）

1. 新增 `web_runner/routes/crawl.py`
2. 注册 `crawl_bp` Blueprint
3. 实现 3 个 endpoint
4. 新增 `sau crawl` CLI 子命令
5. 安装新增依赖（`tenacity`, `httpx`）

### Phase 3：Dashboard UI（v0.2）

- `/dashboard/crawl` 页面
- 爬虫任务管理
- 评论数据展示

### Phase 4：高级功能（v0.3+）

- AI 情感分析
- 自动回复
- 竞品报告
- 发布后自动爬取评论
