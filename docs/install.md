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

### 11. 可选：一键启动（推荐用于 Web Shell / Studio 联调）

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
