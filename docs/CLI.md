# CLI 使用说明

项目现在提供一个统一的 CLI 入口 `sau`，当前主线已经接入：

- `douyin`
- `kuaishou`
- `xiaohongshu`
- `bilibili`

实现说明：

- `sau_cli.py` 是当前 CLI 的主入口和唯一主要实现文件
- `sau.exe` 是安装后在 Windows 虚拟环境里自动生成的命令入口，本质上还是调用 `sau_cli.py`
- 如果需要给 OpenClaw、Codex 等 agent 使用，可参考仓库内 skill：
  - `skills/douyin-upload/`
  - `skills/kuaishou-upload/`
  - `skills/xiaohongshu-upload/`
  - `skills/bilibili-upload/`

## 安装 CLI 入口

如果你希望直接使用 `sau` 命令，而不是手动执行 `python sau_cli.py`，先在项目根目录安装一次：

```bash
uv pip install -e .
```

安装后就可以直接使用：

```bash
sau douyin --help
sau kuaishou --help
sau xiaohongshu --help
sau bilibili --help
```

## 安装 patchright 浏览器

Windows 下推荐先指定镜像，再安装 Chromium：

```powershell
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"; patchright install chromium
```

## 抖音 CLI 子命令

```bash
sau douyin login --account <account_name>
sau douyin login --account <account_name> --headless
sau douyin check --account <account_name>
sau douyin upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --tags 运动,训练
sau douyin upload-note --account <account_name> --images videos/1.png videos/2.png --title "图文标题" --note "图文示例" --tags 图文,测试
```

## 快手 CLI 子命令

```bash
sau kuaishou login --account <account_name>
sau kuaishou check --account <account_name>
sau kuaishou upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --tags 运动,训练
sau kuaishou upload-note --account <account_name> --images videos/1.png videos/2.png videos/3.png --title "图文标题" --note "图文示例" --tags 图文,测试
```

## 小红书 CLI 子命令

```bash
sau xiaohongshu login --account <account_name>
sau xiaohongshu check --account <account_name>
sau xiaohongshu upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --tags 小红书,视频
sau xiaohongshu upload-note --account <account_name> --images videos/1.png videos/2.png videos/3.png --title "图文标题" --note "图文示例" --tags 图文,测试
```

海外环境如果无法登录默认创作者后台，可以通过环境变量切换到 RedNote 域名。该设置同时作用于登录、cookie 校验、视频发布和图文发布：

```bash
SAU_XHS_CREATOR_BASE_URL=https://creator.rednote.com sau xiaohongshu login --account <account_name>
```

## Bilibili CLI 子命令

```bash
sau bilibili login --account <account_name>
sau bilibili check --account <account_name>
sau bilibili upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --tid 249 --tags 足球,测试
```

补充说明：

- `creator` 之类的名字只是示例值，真正传的是用户自定义的 `account_name`
- 一个 `account_name` 对应一个账号文件，可以准备多个账号并发使用
- 浏览器平台统一元数据约定：
- 视频使用 `title + desc + tags`
- 图文使用 `title + note + tags`
- `sau bilibili ...` 会自动准备 `biliup`
- 如果本地没有 `biliup`，第一次运行会自动下载
- 如果上游 GitHub Release 有更新，运行时会先自动更新
- `sau bilibili login --account <name>` 建议由用户自己在本地真实终端里执行；如果终端里的二维码显示不完整，**不要**打开 `qrcode.png`（该文件已不再生成）— 改用 Web Shell 扫码（默认渲染内联 `<img src={data:image/...}>`），或在本地终端去掉 `--headless` 让浏览器里直接展示平台自己的二维码

## 登录二维码说明

- 抖音、快手、小红书登录过程中，CLI / uploader 可能会生成临时二维码图片
- 对普通用户来说，可以直接打开该图片扫码
- 对可操作本地文件的 agent 来说，不要只把图片路径告诉用户
- 这类二维码图片本身就是给用户扫码的，agent 应优先直接展示/发送本地图片给用户
- Bilibili 当前不走这套本地二维码图片托管链路，登录按上面的 Bilibili CLI 说明处理即可

## 定时发布

抖音、快手、小红书的图文和视频上传，以及 Bilibili 的视频上传都支持 `--schedule`。只要传了 `--schedule`，CLI 就会自动切换到对应平台的定时发布策略；不传则默认立即发布。

```bash
sau douyin upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --schedule "2026-03-24 21:30"
sau douyin upload-note --account <account_name> --images videos/1.png videos/2.png --title "图文标题" --note "图文示例" --schedule "2026-03-24 21:30"
sau kuaishou upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --schedule "2026-03-24 21:30"
sau kuaishou upload-note --account <account_name> --images videos/1.png videos/2.png videos/3.png --title "图文标题" --note "图文示例" --schedule "2026-03-24 21:30"
sau xiaohongshu upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --schedule "2026-03-24 21:30"
sau xiaohongshu upload-note --account <account_name> --images videos/1.png videos/2.png videos/3.png --title "图文标题" --note "图文示例" --schedule "2026-03-24 21:30"
sau bilibili upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --tid 249 --schedule "2026-03-24 21:30"
```

## 运行时参数

CLI 将 `debug` 和 `headless` 拆成了两个独立维度：

```bash
--debug
--headless
--headed
```

- `--debug`: 打开调试行为，例如失败时保留更多调试信息
- `--headless`: 无头模式运行
- `--headed`: 有头模式运行

如果都不传，CLI 当前默认按 `headless=True` 运行。

补充：

- 抖音和快手的 CLI 默认都是无头模式
- 如果用户明确要求可见浏览器窗口，或确实需要人工看页面，再显式传 `--headed`

## 视频上传参数

```bash
--file videos/demo.mp4
--title "示例标题"
--desc "示例简介"
--tags 运动,训练
--thumbnail videos/demo.png
--thumbnail-landscape videos/cover-4x3.png
--thumbnail-portrait videos/cover-3x4.png
```

抖音和视频号支持同时设置两种比例的封面图：

- `--thumbnail-landscape`: 4:3 横版封面
- `--thumbnail-portrait`: 3:4 竖版封面
- `--thumbnail`: 兼容旧参数，等同于 3:4 竖版封面

抖音额外支持：

```bash
--product-link https://example.com/item
--product-title 示例商品
```

Bilibili 额外要求：

```bash
--tid 249
```

- `--tid` 第一版是必填
- `--tags` 会映射到 `biliup upload --tag`
- `--schedule` 会映射到 Bilibili 所需的时间戳参数

## 图文上传参数

```bash
--images videos/1.png videos/2.png videos/3.png
--title "图文标题"
--note "图文内容"
--tags 图文,测试
```

图文上传当前限制：

- 抖音：最多 35 张图片，不支持 GIF
- 快手：支持多张图片，建议传真实不同文件，不要把同一路径重复多次
- 小红书：支持多张图片，正文 `--note` 可选，但 `--title` 建议始终显式传入

后续维护 CLI 时，优先看 `sau_cli.py`、`uploader/` 和 `skills/`。

## Crawler CLI（数据采集 / 评论监控）

`openspec/changes/mediacrawler-integration` 增增 `sau crawl <action>` 名字空间，支持 7 个平台（xhs/douyin/ks/bili/weibo/tieba/zhihu）的关键词搜索、帖子详情、评论树采集，以及 AI 情感分析 + 自动回复建议。采集是**只读**的——从来不写平台，只写本项目自己的 PostgreSQL ``crawled_*`` 表。

### 搜索

```bash
sau crawl search --platform xhs --keywords "美食，旅游"
sau crawl search --platform dy --keywords "火锅" --max-count 50
sau crawl search --platform bili --keywords "Python 教程" --detach
```

### 帖子详情

```bash
sau crawl detail --platform xhs --post-ids "abc123,def456"
sau crawl detail --platform dy --post-ids "v1234567890"
```

### 评论树（二级评论）

```bash
sau crawl comments --platform bili --post-ids "BV1abc" --max-count 200
sau crawl comments --platform weibo --post-ids "mid123"
```

### 平台简称 / 全称

CLI 的 ``--platform`` 同时接受 短名字 (MediaCrawler 原生) 和 长名字 (与发布侧对齐)：

| 短 | 长 |
|---|---|
| `xhs` | `xiaohongshu` |
| `dy` | `douyin` |
| `ks` | `kuaishou` |
| `bili` | `bilibili` |
| `wb` | `weibo` |
| `tieba` | `tieba` |
| `zhihu` | `zhihu` |

### 轮询 / detach

默认情况下 CLI 会同步轮询任务状态（``--poll-timeout`` 秒后超时返回错误码 1）。加 ``--detach`` 可让 CLI 只打印 ``task_id`` 后立即退出 0——后续可通过轮询 `GET /api/crawl/status?task_id=<task_id>` 接口或查询 ``tasks`` 表来跟踪进度。

### 调用流程

1. CLI 调用 `crawler.create_crawl_task()` 插入一行到 ``tasks`` 表 (`status='pending'`)
2. 同一会话里，CLI 轮询 task_id 直到状态离开 `pending/running` （种设轮询上限）
3. 任务进程（`PlatformExecutor`）后台拉起对应平台的 ``AbstractCrawler`` 子类
4. 采集结果写入 ``crawled_content`` / ``crawled_comments``；评论表异步触发 AI 情感分析 + 回复建议（详见 `crawler/ai/`）

### 环境变量

参见 `.env.example` 中 ``SAU_CRAWLER_*`` 部分。重点项目：

- `SAU_CRAWLER_ENABLE_IP_PROXY` — 启用代理池（默认 false）
- `SAU_CRAWLER_STATIC_PROXY_URL` — static 模式代理 URL
- `SAU_CRAWLER_OPENROUTER_API_KEY` — AI 情感/回复建议的 LLM 密钥（未设时仍可工作，使用关键词启发式回退）

### 后续维护该 CLI 时，优先看

- `cli/platforms/crawl.py` — 三个顶层 action 的实现
- `crawler/platforms/<平台>/core.py` — 不同平台的爬取逻辑（当前为 scaffold）
- `web_runner/routes/crawl.py` — Web API 路由
- `crawler/ai/` — OpenRouter 调用

