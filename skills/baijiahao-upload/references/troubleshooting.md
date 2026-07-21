# 故障排查（百家号 / baijiahao-upload）

## 登录失败

- **`qrcode.png` 找不到**：项目当前不再生成 `qrcode.png`，改用 Web Shell 走 SSE 扫码（默认渲染内联 `<img>`），或带 `--headed` 让 headed Chrome 直接展示平台 QR。
- **二维码扫码后页面无反应**：常见原因是代理劫持百度域，先关代理再重试；或 cookie 文件被覆盖。
- **HEADLESS 模式下登录超时**：同视频号；百家号也走 QR + headed Chrome 流程。

## cookie 失效

- **一次性排查**：
  ```bash
  sau baijiahao check --account <name>            # 浅度判定
  ```
- 重新 `sau baijiahao login --account <name>` 走完 QR 扫码即可恢复。

## 上传失败

> ⚠️ 注：以下"日上传额度 / 暖号"是社区经验总结 *不一定* 与百度百家号官方公开阈值一致。CLI 流水线正式上线前，请用百家号官方后台或业务监控面板核对当前生效阈值。

- **频控 / 限流**：百家号作为内容平台对短视频有日上传上限（具体数值随账号资质与平台策略变化）。建议新账号首日只手动发 1 条做"暖号"，后续再走 CLI 流水线。
- **标题 / 标签长度截断**：百家号标题 ≤ 30 字，标签 ≤ 10 个，建议在调用前用客户端校验或脚本前过滤；超长会被静默截断。
- **`account_file` 找不到**：`sau baijiahao login` 重跑前先确认 `cookies/baijiahao_<name>.json` 与账号一致。

## 仍未恢复

- 重新确认账号是否在百度账号中心被风控；若被风控，CLI 流程即使 cookie "valid" 也会在上传前被拒。
