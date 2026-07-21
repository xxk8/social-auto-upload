# 运行前提（视频号 / tencent-upload）

需要满足 `python sau` 主线的运行前提，详见 [`docs/install.md`](../../docs/install.md) 与 [`README.md`](../../README.md#💾安装指南)。要点：

- Python 3.10+ 与项目虚拟环境（`uv pip install -e ".[web]"` 或同等）
- Node.js 18+ 仅在前端开发需要
- PostgreSQL 14+（推荐，Web Shell 默认数据库）
- Chrome / Chromium 浏览器（通过 `patchright install chromium` 准备）
- 国内环境对腾讯系域名不要走代理（如需要隔离代理，先单独验证 login / Studio 加载速度）

视频号本身没有特殊的额外依赖，仅依赖通用 patchright + cookie 加载流程。
