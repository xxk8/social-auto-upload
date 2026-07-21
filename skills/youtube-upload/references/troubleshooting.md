# 故障排查（YouTube / youtube-upload）

## 登录失败

- **"Please sign in" / "Your browser is not secure"**：YouTube uploader 会强制 headed Chrome（channel="chrome"）。需要本地真实 Chrome，不是 patchright 自带 Chromium。先 `which google-chrome` / `ls '/Applications/Google Chrome.app'` 确认安装了。
- **2 步验证卡住**：YouTube uploader 走的是真实 headed 浏览器，所有 2FA / reCAPTCHA / 手机验证码都需要本地手工完成。CLI 流程在此处会被暂停，直到你在打开的 Chrome 窗口里点过去。
- **国内环境登录超时**：直连会卡在登录页。设 `YT_PROXY`（见 `runtime-requirements.md`）并重启 CLI。

## cookie 失效

- **一次性排查**：
  ```bash
  sau youtube check --account <name>            # 浅度判定
  ```
  `check` 子命令只 headless 打开 Studio，验证是否被踢回 Google 登录页；如果被踢，说明 storage_state 已过期，需要重跑 login。

## 上传失败

- **`# topic 自动补全浮层挡住发布按钮`**：uploader 内置 `_dismiss_autocomplete` 在标题/简介 `--text` 写入后清掉；个别极端长 `# 标签` 仍可能触发。该浮层出现时，CLI 不会自动重试；建议在标题/简介里少用前缀 `#`。
- **`publish_date` 用户传 `--schedule` 但不生效**：这是已知缺位，参见 `cli-contract.md` 的说明。
- **`UNLISTED` / `PRIVATE` 发布到一半被拒**：YouTube uploader 在 visibility 选择失败时会上传但不发布；如果跑完 30 分钟仍卡在 `Processing`，请去 Studio 后台手工发布。
- **`channel URL fragment` 校验失败**：用户登录后没有进入频道页；可能停在 `youtube.com/feed` 或 `/signin`。重跑 login。

## Web Shell 走不出 QR 流程（已知 gap）

SSE bridge 仅承载 QR 登录流；YouTube 走 Google 账号密码 + 2FA，桥接不上。当前端发起 `sau youtube login` 的 SSE 时，前端会收到 `platform requires CLI login` 的提示 ——这是预期行为，请走 CLI 登录。

## 仍未恢复

- `conf.py` 删 cookie 缓存、删除 `cookies/youtube_<name>.json` 之后重跑 `login`。
- 若账号在 Google 账号中心被反复风控，先在 Browser Forward 走完"login in unusual location" 的二次确认，再退回到 headed Chrome CLI。
