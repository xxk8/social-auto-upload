# 安装说明

这个文档分成两部分：

- `For Humans`：给正常使用仓库的开发者、创作者、CLI 用户看
- `For AI Agents`：给 OpenClaw、Codex、Claude Code 一类 agent 看

如果你是“正在使用 agent 客户端的人”，想先给 agent 一段启动提示词，而不是直接阅读下面的执行细节，先看：

- [Agent Bootstrap Prompt](./agent-bootstrap.md)

## For Humans

### 1. 进入项目目录

```bash
cd social-auto-upload
```

### 2. 创建虚拟环境

推荐使用 `uv`：

Windows PowerShell：

```powershell
uv venv
.venv\Scripts\activate
```

Linux / macOS：

```bash
uv venv
source .venv/bin/activate
```

### 3. 安装主线依赖

当前主线依赖已经放到 `pyproject.toml`，推荐直接执行：

```bash
uv pip install -e .
```

安装完成后，会注册 `sau` 命令。

### 4. 安装 patchright Chromium

当前主线使用 `patchright` 驱动浏览器。

国内用户推荐先指定镜像，再安装 Chromium。

Windows PowerShell：

```powershell
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"; patchright install chromium
```

Linux / macOS：

```bash
PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright" patchright install chromium
```

### 5. 配置 conf.py

复制一份配置：

```bash
cp conf.example.py conf.py
```

Windows 也可以直接手动复制并重命名。

当前通常还会用到这些配置项：

- `LOCAL_CHROME_PATH`
- `LOCAL_CHROME_HEADLESS`
- `DEBUG_MODE`

`XHS_SERVER` 目前只和小红书旧流程相关。

### 6. 验证 CLI 是否可用

```bash
sau --help
sau douyin --help
sau kuaishou --help
sau xiaohongshu --help
sau bilibili --help
```

如果命令找不到，优先确认：

- 当前虚拟环境是否已激活
- 是否执行过 `uv pip install -e .`

### 7. 抖音主线示例

```bash
sau douyin login --account <account_name>
sau douyin check --account <account_name>
sau douyin upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介"
图文正文1:
$noteText = @"图文正文"@    
sau douyin upload-note --account <account_name> --images videos/demo1.png videos/demo2.png --title "图文标题" --note $noteText --tags 'tag1,tag2'
图文正文2:
sau douyin upload-note --account <account_name> --images videos/demo1.png videos/demo2.png --title "图文标题" --notef '图文文件路径' --tags 'tag1,tag2'
添加 BGM（可选）:
sau douyin upload-note --account <account_name> --images videos/demo1.png videos/demo2.png --title "图文标题" --note $noteText --tags 'tag1,tag2' --bgm '音乐名称'
``` 

抖音卡login手动获取cookie:

- 目标服务器使用vnc
- 浏览器登录抖音创作者中心https://creator.douyin.com/
- 执行`bash export_douyin_cookie.sh --account <account_name>`
- 检查cookie可用性,执行`sau douyin check --account <account_name>`

### 8. 快手主线示例

```bash
sau kuaishou login --account <account_name>
sau kuaishou check --account <account_name>
sau kuaishou upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介"
sau kuaishou upload-note --account <account_name> --images videos/demo1.png videos/demo2.png videos/demo.png --title "图文标题" --note "图文正文"
```

### 9. 小红书主线示例

```bash
sau xiaohongshu login --account <account_name>
sau xiaohongshu check --account <account_name>
sau xiaohongshu upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介"
sau xiaohongshu upload-note --account <account_name> --images videos/demo1.png videos/demo2.png videos/demo.png --title "图文标题" --note "图文正文"
```

### 10. Bilibili 主线示例

```bash
sau bilibili login --account <account_name>
sau bilibili check --account <account_name>
sau bilibili upload-video --account <account_name> --file videos/demo.mp4 --title "示例标题" --desc "示例简介" --tid 249
```

补充说明：

- `creator` 之类的名字只是示例值，真正传的是用户自定义的 `account_name`
- 一个 `account_name` 对应一个账号文件，可以准备多个账号并发使用
- 浏览器平台统一元数据约定：
- 视频使用 `title + desc + tags`
- 图文使用 `title + note + tags`
- 用户不需要手动安装 `biliup`
- 首次运行 Bilibili 相关命令时，程序会自动下载 `biliup`
- 后续运行会自动检查上游 release 并自动更新
- Bilibili 登录建议由用户自己在本地真实终端里执行；如果终端里的二维码显示不完整，**不要**打开 `qrcode.png`（该文件已不再生成）— 改用 Web Shell 扫码（默认渲染内联 `<img src={data:image/...}>`），或在本地终端去掉 `--headless` 让浏览器里直接展示平台自己的二维码
- 如果国内网络访问下载较慢，可先用 `https://gh-proxy.com/` 或 `https://gh-proxy.org/` 辅助访问对应 release 地址排障

### 11. 账号健康监控（Account Health Monitoring）

账号授权完成后，系统会自动在后台检查每个账号的 cookie 健康状态，并在 Web Shell 的账号管理页面展示。

#### 检查机制

- **Quick check**：每次检查都会读取 cookie 文件，校验文件存在、非空、JSON 合法、以及文件新鲜度。
- **Real check**：通过 `patchright` 启动真实浏览器，调用平台自带的 `cookie_auth()` 校验登录态。真实检查比较消耗资源，默认每 24 小时只执行一次。
- **后台轮询**：`web_runner/health_monitor.py` 启动一个 daemon 线程，默认每 6 小时对所有账号串行检查一次。
- **手动触发**：在 Web Shell 账号管理页面，每个授权卡片都有「立即检查」按钮，可以立即触发一次检查（202 Accepted，后台异步执行）。

#### 健康状态

| 状态 | 含义 | 视觉提示 |
|---|---|---|
| `valid` | 健康 | 绿色 |
| `expiring_soon` | cookie 文件超过 24 小时未刷新，或上次真实检查超过 7 天 | 黄色 |
| `invalid` | quick check 失败或真实浏览器校验失败 | 红色 |
| `unknown` | 尚未完成首次检查 | 灰色 |

#### 环境变量（SAU_HEALTH_* + SAU_COOKIE_STALE_HOURS）

调优位置均指 Python 模块级常量（在源码里直接 `int(os.environ.get(...))`，改 env 后重启 Flask 进程即生效）。范围列给出的是**安全边界**，越过边界会被 `_clamp_health_retries` 等夹具静默截断、或在 `_quick_check_cookie` 里出现意外的 expired-too-soon。

| 变量 | 默认值 | 有效范围 | 调优位置 | 说明 |
|---|---|---|---|---|
| `SAU_HEALTH_MONITOR_INTERVAL` | `21600`（6 小时） | `≥ 60` 秒 | [`web_runner/health_monitor.py::_HEALTH_INTERVAL`](web_runner/health_monitor.py) | 后台 daemon 线程串行轮询所有账号的间隔，单位秒。设太小 = continuous browser churn；设太大 = 失效 cookie 检出滞后 |
| `SAU_HEALTH_REAL_CHECK_INTERVAL` | `86400`（24 小时） | `≥ 0` 秒（`0` = 每轮都触发） | [`web_runner/health_monitor.py::_REAL_CHECK_INTERVAL`](web_runner/health_monitor.py) | 两次真实浏览器 cookie_auth 之间的最小间隔，单位秒。控制后台轮询里 hard 真实检查的频率 |
| `SAU_HEALTH_TIMEOUT` | `30` | `[5, 120]` 秒 | [`web_runner/health_monitor.py::_HEALTH_TIMEOUT`](web_runner/health_monitor.py) | 单次真实检查超时，单位秒。**worst-case 总耗时 ≈ `(_HEALTH_RETRIES + 1) × _HEALTH_TIMEOUT`** ：默认配置 `(1+1)×30 = 60s`；两端 range 拉满 `(3+1)×120 = 480s`（8 分钟；看似卡死但实为 retry 在跑，不要按 hang 处理） |
| `SAU_HEALTH_EXPIRING_DAYS` | `7` | `[1, 365]` 天 | [`web_runner/health_monitor.py::_EXPIRING_DAYS`](web_runner/health_monitor.py) | 上次真实检查超过多少天即在没有 stale 信号时也标记为 `expiring_soon`。**与 `SAU_COOKIE_STALE_HOURS` 是 ORTHOGONAL TRIGGERS**，详见下方「互相关系」 |
| `SAU_HEALTH_RETRIES` | `1` | `[0, 3]`（强制 clamp） | [`web_runner/health_monitor.py::_HEALTH_RETRIES`](web_runner/health_monitor.py)（经 `_clamp_health_retries()`） | 单次真实检查失败后的 retry 次数。**会被硬夹到 3**，传 `100` 也不会失控，但也不会保留原值。详见 `_clamp_health_retries()` docstring |
| `SAU_COOKIE_STALE_HOURS` | `24` | `[1, 168]` 小时（≤ 1 周） | [`web_runner/utils.py::_COOKIE_STALE_HOURS`](web_runner/utils.py) | cookie 文件 mtime 超过多少小时即在 quick check 中标记为 `stale=true`，从而进入 `expiring_soon` 路径。设太大 = 检测滞后；设太小 = fresh 也会变 stale |
| `SAU_FEISHU_WEBHOOK_URL` | (未设置) | HTTPS URL | [`web_runner/notifications.py::_env_webhooks`](web_runner/notifications.py) | 飞书 bot incoming webhook URL，账号健康度降级事件会发到这里。未设 → 该通道不发。其他 SAU_*_WEBHOOK_URL 同型 |
| `SAU_FEISHU_WEBHOOK_SECRET` | (未设置) | string | [`web_runner/notifications.py::_feishu_sign`](web_runner/notifications.py) | 飞书 HMAC-SHA256 签名密钥（与 `SAU_FEISHU_WEBHOOK_URL` 配对使用；不设 → 走无签名 frame） |
| `SAU_DINGTALK_WEBHOOK_URL` | (未设置) | HTTPS URL | [`web_runner/notifications.py::_env_webhooks`](web_runner/notifications.py) | 钉钉 bot webhook URL。未设 → 该通道不发 |
| `SAU_DINGTALK_WEBHOOK_SECRET` | (未设置) | string | [`web_runner/notifications.py::_dingtalk_sign`](web_runner/notifications.py) | 钉钉 HMAC-SHA256 签名密钥（与 `SAU_DINGTALK_WEBHOOK_URL` 配对使用；不设 → 不加签 query string） |
| `SAU_WEWORK_WEBHOOK_URL` | (未设置) | HTTPS URL | [`web_runner/notifications.py::_env_webhooks`](web_runner/notifications.py) | 企业微信 bot webhook URL。未设 → 该通道不发 |
| `SAU_WEBHOOK_URL` | (未设置) | HTTPS URL | [`web_runner/notifications.py::_env_webhooks`](web_runner/notifications.py) | 通用 custom webhook 兑底（feishu/dingtalk/wework 全未设时发这里；`feishu/dingtalk` 关键词不会匹配该 URL） |
| `SAU_WEBHOOK_AGG_WINDOW` | `60` | `≥ 1` 秒 | [`web_runner/notifications.py::_rate_limited`](web_runner/notifications.py) | webhook 通道 rate-limit 窗口（默认 60s 内 20 调，避免 bot 调用盾被打中） |
| `SAU_SMTP_*` | (未设置) | 详见 [`web_runner/routes/auth.py::_send_smtp_email`](web_runner/routes/auth.py) | 同列左侧 | 邮件发送 config 群（`SAU_SMTP_HOST` / `SAU_SMTP_PORT` / `SAU_SMTP_USER` / `SAU_SMTP_PASSWORD` / `SAU_SMTP_FROM`）；不改其他不动，例越未设 → 邮件不发。健康度通知调用路径见下方〔告警通知〕段 |
| `SAU_HEALTH_WEBHOOK_URL` | (reserved) | reserved | n/a | **openspec 只佔位、实际未生效**—`web_runner/health_monitor.py::_send_health_notification` 走 `emit_event()` 共用上方 4 个 `SAU_*_WEBHOOK_URL`，而非独立的 `SAU_HEALTH_WEBHOOK_URL`。设计记录在 `openspec/changes/account-health-monitoring/{proposal.md, design.md[D3]}`，未来若不同通道上费补，可改 `notifications.py::resolve_webhooks` 优先指定 SAU_HEALTH_WEBHOOK_URL。今未生效不报错，明 table 留行 slipper pledge。 |（ORTHOGONAL TRIGGERS）

`SAU_COOKIE_STALE_HOURS` 与 `SAU_HEALTH_EXPIRING_DAYS` 是两条**在调用点互斥（mutually exclusive at the call-site）的 ORTHOGONAL TRIGGERS**——不是两层嵌套：

- `SAU_COOKIE_STALE_HOURS` ⇒ **mtime-trigger**：回答"cookie 文件是不是太久没刷新"，看 `stat.st_mtime`。
- `SAU_HEALTH_EXPIRING_DAYS` ⇒ **verification-trigger**：回答"上次真实检查是不是太久之前"，看 `account_authorizations.last_check_at`。
- `_determine_health` 里 mtime-trigger 先求值：mtime 触发 → 跳过 verification；mtime 不触发 → 才求值 verification。同一个调用只会有一条路径生效（mutually exclusive at the call-site）；两条 trigger 都映射到同一个 `expiring_soon` 颜色。
- `SAU_HEALTH_RETRIES` 与上面两个**完全正交**：它控制 `_check_with_retry()` 内部重试预算，**只看 `_determine_health` 拿到的 `real_valid`——而 `real_valid` 只看 retry 内的结论**。**stale 与 expiring 只看 mtime 和 `last_check_at`**，与 retry 完全无关。调高 retry 修不了 stale 误报，但能把 `_check_with_retry()` 内部短暂网络抖动 / timeout 导致的 `real_valid=False` 吞掉（**for-loop 里任一 attempt 不抛异常即 early-return（`True` / `False` 原样透传，不重试平台侧直接判 invalid）；raise 才 `continue` 到下一个 attempt；N+1 次全 raise 才走完循环 return `False`**），让单次网络抖动不会直接升级成 `invalid` 误报。简而言之：**stale 看 mtime、`real_valid` 看 retry，两个互不干涉**——运维别误以为 retry 能修 stale。

#### 告警通知

当某个账号的健康状态从 `valid` 降级为 `expiring_soon` 或 `invalid` 时，系统会：

1. 触发 `cookie.expiring_soon` 或 `cookie.expired` 事件，通过现有的通知工人（notification worker）投递 webhook / 站内通知。
2. 向该账号分组所属**所有者**的邮箱发送一封告警邮件（24 小时内同一账号只通知一次，避免刷屏）。

通知对象按 `account_groups.owner_user_id` 确定：

- 新创建的账号分组会自动记录创建者为所有者（`owner_user_id`）。
- 升级部署时，历史分组会在 `init_db()` 中自动回填为数据库中第一个用户。
- 如果某分组的所有者为空（例如关闭登录的纯 CLI / 无用户部署）：
  - 邮件发送会依次回退到第一个管理员邮箱、第一个用户邮箱。
  - 通知偏好（是否发邮件 / webhook）直接读取第一个用户的 `notify_health_email` / `notify_health_webhook`。
- 邮件与 webhook 通道分别受所有者（或 fallback 用户）的 `users.notify_health_email` / `users.notify_health_webhook` 偏好控制。
- 升级部署时的历史分组回填是一次性迁移，仅在 `users` 表非空时执行。

通知依赖上方环境变量表中 `SAU_FEISHU_WEBHOOK_URL` / `SAU_DINGTALK_WEBHOOK_URL` / `SAU_WEWORK_WEBHOOK_URL` / `SAU_WEBHOOK_URL` 兑底 + `SAU_SMTP_*` 配置，具体见 [`web_runner/notifications.py::_env_webhooks`](web_runner/notifications.py) 与 [`web_runner/routes/auth.py::_send_smtp_email`](web_runner/routes/auth.py)。openspec 中领会的 `SAU_HEALTH_WEBHOOK_URL` 是占位名，上表中顶只留一行 reserved 提示，未实际生效。

### 12. 可选：一键启动（推荐用于 Web Shell / Studio 联调）

如果不想手动 `source .venv/bin/activate`，可以直接跑：

```bash
bash sau_web/start.sh
```

`sau_web/start.sh` 自己会把 `$ROOT/.venv/bin` 抢先 prepend 到 `$PATH`，再 `exec` Flask 后端（`python run.py`）。这样 Flask 进程内一切 `subprocess.run([...])` / `shutil.which(...)` 调用（典型场景：Studio 角色的 `edge-tts` 配音合成）会从 venv bin 里命中，不需要单独 venv 激活。`run.py` 内部还一层 idempotent 的 PATH 兜底（`_inject_venv_bin_to_path`），双保险。

如果走的是 `bash export_douyin_cookie.sh --account <account_name>` 之类的独立 Python 便捷 shell，确认自己已经先 `source .venv/bin/activate` 再走 — 那些脚本没有自处理 PATH。

---

## For AI Agents

如果你是一个可执行命令的 agent，请优先按下面顺序处理：

1. 先假设仓库根目录就是当前工作目录
2. 优先使用 `uv` 管理环境，不要默认回退到旧的 `requirements.txt`
3. 安装命令优先使用：

```bash
uv pip install -e .
```

4. 如需浏览器驱动，优先使用：

Windows PowerShell：

```powershell
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"; patchright install chromium
```

Linux / macOS：

```bash
PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright" patchright install chromium
```

5. 安装完成后，优先检查：

```bash
sau --help
sau douyin --help
sau kuaishou --help
sau xiaohongshu --help
sau bilibili --help
```

6. 如果用户的目标是抖音或快手的登录、cookie 校验、视频上传、图文上传，优先走 CLI：

```bash
sau douyin login
sau douyin check
sau douyin upload-video
sau douyin upload-note

sau kuaishou login
sau kuaishou check
sau kuaishou upload-video
sau kuaishou upload-note

sau xiaohongshu login
sau xiaohongshu check
sau xiaohongshu upload-video
sau xiaohongshu upload-note

sau bilibili login
sau bilibili check
sau bilibili upload-video
```

7. 如果用户明确在使用 skill 系统，再引导其阅读：

- `skills/douyin-upload/SKILL.md`
- `skills/douyin-upload/references/cli-contract.md`
- `skills/kuaishou-upload/SKILL.md`
- `skills/kuaishou-upload/references/cli-contract.md`
- `skills/xiaohongshu-upload/SKILL.md`
- `skills/xiaohongshu-upload/references/cli-contract.md`
- `skills/bilibili-upload/SKILL.md`
- `skills/bilibili-upload/references/cli-contract.md`

### 对 agent 的额外说明

- 当登录流程生成本地二维码图片时，不要只把图片路径发给用户
- 这类二维码图片本身就是给用户扫码的，agent 应优先直接展示/发送本地图片给用户扫码
- 如果环境支持查看本地图片，优先用查看图片能力把二维码展示出来；路径只作为补充信息
- Bilibili 登录当前不建议 agent 在非交互环境里直接代跑
- 正确做法是让用户自己在本地终端执行 `sau bilibili login --account <name>`（不要带 `--headless`）；如果二维码显示不完整，**不要**提示打开 `qrcode.png`（该文件已不再生成）— 改用 Web Shell 扫码（默认渲染内联 `<img src={data:image/...}>`）
- `requirements.txt` 目前是历史兼容文件，不是主安装入口
- `uploader/` 是核心实现目录
- `sau_cli.py` 是当前 CLI 主入口
- `docs/legacy-web.md` 是历史 Web 版本说明，不保证当前可用
- Bilibili 首次运行时可能自动下载 `biliup`

---

> 🔧 **运行后当日 on-call / 运营 / 排错入口**：[`docs/dev/INDEX.md`](docs/dev/INDEX.md) · [`docs/dev/monitor-cdp-throttling-cron-ops.md`](docs/dev/monitor-cdp-throttling-cron-ops.md) · [`docs/dev/public-inbox-ops.md`](docs/dev/public-inbox-ops.md)
>
> 公开试用 /try 相关的告警 / 30 天滚动 kill criteria：`docs/dev/public-inbox-ops.md`。可选 webhook 接收 STOP-SHIP / WATCHFUL verdict：`SAU_KILL_CRITERIA_WEBHOOK`（见 `.env.example` 告警段）。
>
> 🪪 **免费版 & AI 内容生成**（round-AI-paywall 合约起生效）：AI 文案生成 / 图片素材搜索 / 多平台适配 — 全部是 **Pro 套餐专享**。free-tier 用户调用 **user-facing** AI 路由（`_AI_FEATURE_BLOCKED_FOR_FREE` 内 9 个，如 `/api/ai/generate`、`/api/ai/images/search`、`/api/ai/recommend-images`、`/api/ai/enhance-prompt`）时会被 [`web_runner/middleware/usage_metering.py::before_request`](web_runner/middleware/usage_metering.py) 在 daily-quota 检查之前返回一个 HTTP **402 `tier_required`** 拦截，根本不到路由 handler / 配额检查层。所以：
>
> - 但 **`/api/ai/*` 下的 utility 类 endpoint**（`/api/ai/models`、 `/api/ai/config`、 `/api/ai/keys` 见 `_AI_UTILITY_PATH_PREFIXES`）不消耗 AI 配额，**所有 tier 都能调用**——这些是 sidebar chrome 渲染、key 列表查看所必需。`_AI_UTILITY_PATH_PREFIXES` 在 `before_request` 中先于 quota 检查被跳过，故设为 allowed。
> - `.env.example` 中 `SAU_TIER_FREE_AI` 默认值已从 `10` 改为 `0`，表示「daily quota 已被 tier-block 旁路」——不是「free tier 每天可调用 0 次」语义。
> - 如需给 free tier 恢复每日 AI 限额，**同时调整 `_AI_FEATURE_BLOCKED_FOR_FREE`**（锁定列表）和 **`_AI_UTILITY_PATH_PREFIXES`**（utility 跳过列表），**仅改 `SAU_TIER_FREE_AI` 不起作用**。
> - 前端的 `<PublishAiSidebar>` 在 free tier 下会屏蔽输入框并展示升级 CTA (`<AiPaywallBanner />`)；该交互的跨层合约细节见 [`sau_web/frontend/src/Components/AiRightPanel/TierBlockGate.tsx`](sau_web/frontend/src/Components/AiRightPanel/TierBlockGate.tsx)。后端 402 envelope 的字段不变量（`success / error / code / required_tier / blocked_action / upgrade_url`）以 `_TIER_BLOCKED_RESPONSE` 为准。
