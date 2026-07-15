# 故障排查（TikTok / tiktok-upload）

## 登录失败

- **`qrcode.png` 找不到**：项目当前不再生成 `qrcode.png`，改用 Web Shell 走 SSE 扫码（默认渲染内联 `<img>`），或带 `--headed` 让 headed Chrome 直接展示平台 QR。
- **二维码扫描后无反应 / cookie 文件不变**：国内环境下需要确认网络可达 TikTok / Chrome 能访问 TikTok Studio；TikTok 对 IP 风控敏感，跨区域登录极易触发二次验证。
- **HEADLESS 模式下登录超时**：同视频号；TikTok 走 QR + headed Chrome 流程。

## cookie 失效

- **一次性排查**：
  ```bash
  sau tiktok check --account <name>            # 浅度判定
  ```
- 重新 `sau tiktok login --account <name>` 走完 QR 扫码即可恢复；如果仍被风控，先在浏览器前台手工完成"人脸或邮件代码"二次验证，再走 CLI。

## 上传失败

> ⚠️ 注：以下"日上传阈值 / 暖号时间"是社区经验总结 *不一定* 与平台官方公开阈值一致。CLI 流水线正式上线前，请用 TikTok 官方创作者中心或业务监控面板核对当前生效阈值。

- **频控 / 限流**：TikTok 对账号日上传条数有限制（具体数值随账号资质与平台策略变化）。建议新账号暖号后再大规模跑流水线；流水线在账号维度上宁串行 *不要* 多账号并发（并发跨账号会发二次风控）。
- **视频长度 / 格式截断**：TikTok 视频时长 15 秒 / 60 秒 / 10 分钟三档；之间会被自动截断。建议在客户端做长度检查。
- **`publish_date` 不生效**：TikTok UI 路由不支持外部 schedule（与其它主流平台不同），`--schedule` 会带进 dispatcher 构造的 Request 但被 uploader 拒绝。需要等定时发布走 CLI 后台调度器再统一走流程。

## 仍未恢复

- 重新确认账号是否在 TikTok 账号中心被风控；若被风控，CLI 即使 cookie "valid" 也会在上传前被拒。
