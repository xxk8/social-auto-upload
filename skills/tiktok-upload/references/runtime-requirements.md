# 运行前提（TikTok / tiktok-upload）

需要满足 `python sau` 主线的运行前提，详见 [`docs/install.md`](../../docs/install.md)。要点：

- Python 3.10+ 与项目虚拟环境
- PostgreSQL 14+（推荐，Web Shell 默认数据库）
- Chrome / Chromium 浏览器（通过 `patchright install chromium` 准备，TikTok 的 `tk_uploader` 走 Chrome 版实现）

国内环境对 TikTok 直连会被墙；需要确认以下之一任一可达：

- 全局代理
- `tk_uploader` 走代理端口或 chain proxy（pip 自定义）
- VPN / Shadowsocks 全局

`tk_uploader` 是 patchright 跑真实 Chrome，所以走代理会让抓 cookie 时弹出窗口不再本地。务必 **先在 `--headed` 模式手动登录一次确认可达**，再切回 `--headless`。
