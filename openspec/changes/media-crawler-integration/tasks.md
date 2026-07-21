## 1. v0.1 爬虫骨架提取

### 1.1 创建目录结构（Cross-layer）

- [ ] 1.1.1 创建 `crawler/` 顶层目录
- [ ] 1.1.2 创建子目录：`crawler/base/`、`crawler/platforms/`、`crawler/platforms/xhs/`、`crawler/platforms/douyin/`、`crawler/platforms/kuaishou/`、`crawler/platforms/bilibili/`、`crawler/models/`、`crawler/tools/`、`crawler/store/`、`crawler/cache/`
- [ ] 1.1.3 每个目录添加 `__init__.py`

### 1.2 复制核心文件（Cross-layer）

- [ ] 1.2.1 复制 `base/base_crawler.py` → `crawler/base/`（改 import：`from playwright.async_api` → `from patchright.async_api`）
- [ ] 1.2.2 复制 `var.py` → `crawler/var.py`（改 import：删除 `aiomysql`，改用 `Optional`）
- [ ] 1.2.3 复制 `config/base_config.py` → `crawler/config.py`（精简配置项，删除代理池/MongoDB/MySQL 相关）
- [ ] 1.2.4 复制 `media_platform/xhs/client.py` → `crawler/platforms/xhs/`（改 import）
- [ ] 1.2.5 复制 `media_platform/xhs/core.py` → `crawler/platforms/xhs/`（改 import + 存储层替换）
- [ ] 1.2.6 复制 `media_platform/xhs/login.py` → `crawler/platforms/xhs/`（改 import）
- [ ] 1.2.7 复制 `media_platform/xhs/extractor.py` → `crawler/platforms/xhs/`（改 import）
- [ ] 1.2.8 复制 `media_platform/xhs/help.py` → `crawler/platforms/xhs/`（改 import）
- [ ] 1.2.9 复制 `media_platform/xhs/field.py` → `crawler/platforms/xhs/`（无改动）
- [ ] 1.2.10 复制 `media_platform/xhs/playwright_sign.py` → `crawler/platforms/xhs/`（改 import）
- [ ] 1.2.11 复制 `media_platform/xhs/exception.py` → `crawler/platforms/xhs/`（无改动）
- [ ] 1.2.12 复制 `media_platform/douyin/*` → `crawler/platforms/douyin/`（同 XHS 改动）
- [ ] 1.2.13 复制 `media_platform/kuaishou/*` → `crawler/platforms/kuaishou/`（同 XHS 改动）
- [ ] 1.2.14 复制 `media_platform/bilibili/*` → `crawler/platforms/bilibili/`（同 XHS 改动）
- [ ] 1.2.15 复制 `model/m_xiaohongshu.py` → `crawler/models/xhs.py`（无改动）
- [ ] 1.2.16 复制 `model/m_douyin.py` → `crawler/models/douyin.py`（无改动）
- [ ] 1.2.17 复制 `model/m_kuaishou.py` → `crawler/models/kuaishou.py`（无改动）
- [ ] 1.2.18 复制 `model/m_bilibili.py` → `crawler/models/bilibili.py`（无改动）

### 1.3 复制工具函数（Cross-layer）

- [ ] 1.3.1 复制 `tools/cdp_browser.py` → `crawler/tools/`（改 import）
- [ ] 1.3.2 复制 `tools/browser_launcher.py` → `crawler/tools/`（改 import）
- [ ] 1.3.3 复制 `tools/utils.py` → `crawler/tools/`（改 import）
- [ ] 1.3.4 复制 `tools/httpx_util.py` → `crawler/tools/`（改 import）
- [ ] 1.3.5 复制 `tools/async_file_writer.py` → `crawler/tools/`（改 import）
- [ ] 1.3.6 复制 `tools/time_util.py` → `crawler/tools/`（无改动）
- [ ] 1.3.7 复制 `tools/user_hash.py` → `crawler/tools/`（无改动）
- [ ] 1.3.8 复制 `tools/easing.py` → `crawler/tools/`（无改动）
- [ ] 1.3.9 复制 `tools/crawler_util.py` → `crawler/tools/`（改 import）
- [ ] 1.3.10 复制 `tools/slider_util.py` → `crawler/tools/`（改 import）
- [ ] 1.3.11 复制 `cache/cache_factory.py` → `crawler/cache/`（改 import）

### 1.4 批量替换 import 路径（Cross-layer）

- [ ] 1.4.1 全局替换：`import config` → `from crawler import config`（仅 crawler/ 目录内）
- [ ] 1.4.2 全局替换：`from base.base_crawler import` → `from crawler.base.base_crawler import`
- [ ] 1.4.3 全局替换：`from tools import` → `from crawler.tools import`
- [ ] 1.4.4 全局替换：`from tools.xxx import` → `from crawler.tools.xxx import`
- [ ] 1.4.5 全局替换：`from model.xxx import` → `from crawler.models.xxx import`
- [ ] 1.4.6 全局替换：`from cache.xxx import` → `from crawler.cache.xxx import`
- [ ] 1.4.7 全局替换：`from var import` → `from crawler.var import`
- [ ] 1.4.8 全局替换：`from playwright.async_api import` → `from patchright.async_api import`

### 1.5 验证 import 链（Cross-layer）

- [ ] 1.5.1 `python -c "from crawler.base.base_crawler import AbstractCrawler; print('OK')"`
- [ ] 1.5.2 `python -c "from crawler.platforms.xhs import XiaoHongShuCrawler; print('OK')"`
- [ ] 1.5.3 `python -c "from crawler.platforms.douyin import DouyinCrawler; print('OK')"`
- [ ] 1.5.4 `python -c "from crawler.platforms.kuaishou import KuaishouCrawler; print('OK')"`
- [ ] 1.5.5 `python -c "from crawler.platforms.bilibili import BiliBiliCrawler; print('OK')"`

---

## 2. v0.1 存储层对接

### 2.1 数据库表（Web API 层）

- [ ] 2.1.1 在 `web_runner/db.py:_init_db_sqlite` 中新增 `crawled_content` 表（SQLite 方言）
- [ ] 2.1.2 在 `web_runner/db.py:_init_db_sqlite` 中新增 `crawled_comments` 表（SQLite 方言）
- [ ] 2.1.3 在 `web_runner/db.py:_init_db_postgres` 中新增 `crawled_content` 表（PG 方言）
- [ ] 2.1.4 在 `web_runner/db.py:_init_db_postgres` 中新增 `crawled_comments` 表（PG 方言）
- [ ] 2.1.5 添加索引：`idx_crawled_content_platform`、`idx_crawled_content_post`、`idx_crawled_comments_post`
- [ ] 2.1.6 验证双方言建表：本地启动后查 sqlite3 schema；`SAU_DB_DIALECT=postgres` 启动后用 psql `\d+ crawled_content` 验证

### 2.2 存储实现（Web API 层）

- [ ] 2.2.1 新建 `crawler/store/__init__.py`
- [ ] 2.2.2 新建 `crawler/store/saulite_store.py`，实现 `SauliteStore` 类
- [ ] 2.2.3 实现 `store_content(platform, content_item)` — INSERT OR REPLACE 到 `crawled_content`
- [ ] 2.2.4 实现 `store_comment(platform, comment_item)` — INSERT OR REPLACE 到 `crawled_comments`
- [ ] 2.2.5 实现 `store_creator(platform, creator_item)` — 暂为 no-op（v0.2 再实现）
- [ ] 2.2.6 修改 `crawler/platforms/xhs/core.py` 中的存储调用，使用 `SauliteStore`
- [ ] 2.2.7 修改 `crawler/platforms/douyin/core.py` 中的存储调用
- [ ] 2.2.8 修改 `crawler/platforms/kuaishou/core.py` 中的存储调用
- [ ] 2.2.9 修改 `crawler/platforms/bilibili/core.py` 中的存储调用

---

## 3. v0.1 API 路由

### 3.1 后端 — 爬虫 API（Web API 层）

- [ ] 3.1.1 新建 `web_runner/routes/crawl.py`，创建 `bp = Blueprint("crawl", __name__)`
- [ ] 3.1.2 `POST /api/crawl/search`：接收 `{ platform, keywords, max_items? }`，调用对应平台的 `XiaoHongShuCrawler.search()`，返回 `{ success, data: [...], count }`
- [ ] 3.1.3 `POST /api/crawl/detail`：接收 `{ platform, post_ids }`，调用 `detail_crawl()`，返回 `{ success, data: [...], count }`
- [ ] 3.1.4 `GET /api/crawl/status`：返回当前爬虫任务状态 `{ running: bool, platform: str, progress: int, total: int }`
- [ ] 3.1.5 在 `web_runner/__init__.py` 中注册 `crawl_bp` Blueprint

### 3.2 CLI — crawl 子命令（CLI 层）

- [ ] 3.2.1 在 `sau_cli.py` 中注册 `crawl` 子命令
- [ ] 3.2.2 实现 `sau crawl search --platform <xhs|dy|ks|bili> --keywords <text> [--max-items N]`
- [ ] 3.2.3 实现 `sau crawl detail --platform <xhs|dy|ks|bili> --post-ids <id1,id2,...>`
- [ ] 3.2.4 实现 `sau crawl status` — 查询最近一次爬取状态

### 3.3 依赖安装（Cross-layer）

- [ ] 3.3.1 在 `pyproject.toml` 的 `[project.dependencies]` 中添加 `tenacity>=8.0`
- [ ] 3.3.2 在 `pyproject.toml` 的 `[project.dependencies]` 中添加 `httpx>=0.25`
- [ ] 3.3.3 验证 `patchright install chromium` 能正常安装浏览器

---

## 4. v0.1 端到端验证

### 4.1 单元验证（Cross-layer）

- [ ] 4.1.1 验证所有 import 链不报错（5 个平台爬虫类）
- [ ] 4.1.2 验证 `crawled_content` 和 `crawled_comments` 表在 SQLite 和 PostgreSQL 都能建表
- [ ] 4.1.3 验证 `SauliteStore.store_content()` 能写入数据
- [ ] 4.1.4 验证 `SauliteStore.store_comment()` 能写入数据

### 4.2 集成验证（Cross-layer）

- [ ] 4.2.1 启动后端 `python web_runner.py`，确认无 import 报错
- [ ] 4.2.2 `curl -X POST http://localhost:6001/api/crawl/search -H "Content-Type: application/json" -d '{"platform": "xhs", "keywords": "测试", "max_items": 3}'` 返回成功
- [ ] 4.2.3 `psql -d sau -c "SELECT * FROM crawled_content LIMIT 5"` 能看到爬取数据
- [ ] 4.2.4 `sau crawl search --platform xhs --keywords "编程" --max-items 3` CLI 能执行

### 4.3 回归验证（Cross-layer）

- [ ] 4.3.1 `sau douyin check --account test` 能正常执行（不被 crawler 模块影响）
- [ ] 4.3.2 Web Dashboard 登录 / 发布 / 任务列表功能正常
- [ ] 4.3.3 现有 22 个 API endpoint 全部可用
