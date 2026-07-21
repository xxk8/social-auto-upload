# 故障排查（视频号 / tencent-upload）

## 登录失败

- **`qrcode.png` 找不到**：项目当前不再生成 `qrcode.png`（round-OPT-acct-qr cleanup 2026-07-10），改用 Web Shell 走 SSE 扫码（默认渲染内联 `<img>`），或带 `--headed` 让 headed Chrome 直接展示平台 QR。
- **二维码扫码后页面无反应**：常见原因是代理劫持腾讯域，先关代理再重试；或 cookie 文件被覆盖。
- **HEADLESS 模式下登录超时**：login 流程必须 headed Chrome，CLI 把 `--headless` 当默认值，但登录自身会强制打开真实浏览器窗口。不要在 SSH-only / headless-only 环境跑 login。

## cookie 失效

- **一次性排查**：
  ```bash
  sau tencent check --account <name>            # 浅度判定：cookie 文件 + 关键字段是否齐全
  ```

  返回 `valid` 表示 storage_state 关键 cookie（`openid2` 等）仍在；返回 `invalid` 才需要重跑 login。

## 上传失败

- **`ASR 风控 / 频控 / 二次验证` 频出**：登录首关掉手机短信之外的二次人脸 / 扫码验证；脚本性频控建议先在平台前台手动操作 1 次，再走 CLI 重试。
- **头条图 / 缩略图失败**：视频号的横屏 / 竖屏缩略图尺寸有要求（± 5%），上传前先用平台的 Web 后台上传一张确认尺寸与格式。
- **CLI 上传流程卡 30+ 分钟不结束**：先看 `.sau-logs/backend.log` 截图与 Playwright 控制台错误流，常见原因是 cookie 升级 / 用户态下线被暂停。

## 仍未恢复

- 重新 `sau tencent login --account <name>`，手工走完 QR 扫码流程；新 cookie 应立即恢复上传能力。
- 若账号在新设备登录后被腾讯要求二次校验，CLI 在 headed Chromium 中会展示对应页面，人工过一次也能稳定后续 CLI 流程。
