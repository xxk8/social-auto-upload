# 运行前提（YouTube / youtube-upload）

需要满足 `python sau` 主线的运行前提，详见 [`docs/install.md`](../../docs/install.md)。要点：

- Python 3.10+ 与项目虚拟环境
- PostgreSQL 14+（推荐，Web Shell 默认数据库）
- Chrome / Chromium 浏览器（`youtube_uploader` 用 channel="chrome" 启动，需要真实安装的 Chrome，不是 patchright 自带的 Chromium）

**YouTube 强制要 headed Chrome**：

- `login` 子命令必须 headed：会弹出真实浏览器窗口让你输入 Google 账号密码 + 可能的两步验证。
- `upload-video` 在 headed / headless 都可走，但若 `--headless` 出错请切到 headed 重试。
- `check` 子命令始终 headless：仅用 storage_state 打开 Studio 验证跳转。

**国内环境强烈建议设 `YT_PROXY`**：国内直连 `youtube.com` 会超时。`conf.py` 加一行 `YT_PROXY = "http://127.0.0.1:7890"`（与本地代理端口保持一致）。CLI 与 uploader 都会读这个变量；不设则不上代理。

**Web Shell YouTube 当前不支持 SSE bridge**：SSE 桥只承载 QR 流程，YouTube 走 Google 账号密码 + 2FA 登录，目前无法在 Web Shell SSE 内承载。请走 CLI / 本地终端登录。
