---
name: youtube-upload
description: 当 agent 需要通过已安装的 `sau` CLI 完成 YouTube 登录、cookie 校验或视频上传时使用这个 skill。YouTube 对应 `uploader/youtube_uploader/`，登录走 **Google 账号密码 + headed Chrome**（不是 QR），发布支持 `public / unlisted / private` 三种可见性，不支持图文。优先使用 `sau youtube ...` 而不是一开始就阅读 uploader 源码。
---

# YouTube 上传 Skill

优先把 `sau youtube ...` 作为主接口。

不要假设当前环境一定能读取仓库源码。
不要一开始就去读 `uploader/youtube_uploader/`。
只有在命令不可用或 CLI 执行失败时，才回退到故障排查说明。

> **重要差异**：YouTube 是当前接入的 8 个平台里**唯一走 Google 账号密码交互登录**的。其余 7 个平台（抖音 / 快手 / 小红书 / Bilibili / 视频号 / 百家号 / TikTok）都走 QR 扫码。YouTube 走的是 headed Chrome 的 login form，所以：
> 1. 登录必须在带 `chrome` 通道的真实终端，浏览器会要求输入 Google 账号密码 + 可能的两步验证；
> 2. Web Shell SSE bridge 当前**只支持 QR 流程**，所以 YouTube 暂时**只能在 Web Shell 走"用 CLI"路径**，登录到上传全靠 CLI / 本地终端。

## 功能概览

| 功能 | 命令入口 | 说明 |
| --- | --- | --- |
| YouTube 登录 | `sau youtube login --account <name>` | headed Chrome 登录 Google / YouTube，保存 storage_state |
| cookie 校验 | `sau youtube check --account <name>` | 检查 storage_state 是否仍有效（带 cookie 打开 Studio） |
| 视频上传 | `sau youtube upload-video ...` | 上传并发布 YouTube 视频，支持 visibility / tags / 缩略图 / 播放列表 |

元数据约定：

- 视频使用 `title + description + tags`，可选 `--thumbnail`（封面）/`--visibility`（`public`/`unlisted`/`private`）/ playlist
- **YouTube 不支持图文**（不是漏掉，是平台没有这个能力）

## 默认工作流

1. 确认 `sau` 在 PATH 中（`which sau` 或仓库内 `sau_cli.py`）。
2. 检查 `conf.py` 里是否需要设 `YT_PROXY`（国内直接连 YouTube 会超时）。设成 `http://127.0.0.1:7890` 之类本地代理端口即可；不设则不走代理。
3. 执行匹配的 `sau youtube ...` 命令（login / check / upload-video）。
4. 如果命令失败，再看 `references/troubleshooting.md`。

## 支持动作

- 使用 `sau youtube login --account <name>` 登录 YouTube（headed Chrome，必须本地真实终端）
- 使用 `sau youtube check --account <name>` 校验 storage_state 是否仍有效
- 使用 `sau youtube upload-video ...` 上传 YouTube 视频

## 命令选择建议

- 当用户需要新的 storage_state，或现有 cookie 已失效时，使用 `login`
- 当用户只需要确认 cookie 状态时，使用 `check`
- 当用户要发布视频时，使用 `upload-video`
- YouTube 不支持图文（平台没有图文流），不要尝试 `upload-note`
- 默认可见性是 `public`，发布原子能设成草稿请改用 `--visibility unlisted` 或 `private`

## 执行前检查

- 先确认当前 shell 里是否可以调用 `sau youtube --help`
- 如果 `sau` 不在 PATH 中，可以用仓库里的 `sau_cli.py`
- **登录必须在带 headed Chrome 的真实终端执行**，不要在无头环境或 SSH-only 环境硬跑 login
- `sau youtube check` 在 headless 模式下也可以跑（仅带 cookie 打开 Studio）
- `sau youtube upload-video` 的 `headless` 取值由 CLI 的 `--headless` / `--headed` 决定；上传本身走 headed Chrome 是常见默认
- 国内环境确认 `YT_PROXY` 已设；可用 `curl -I https://www.youtube.com` 走 proxy 验证连通
- **Web Shell SSE 登录当前不支持 YouTube**（bridge 假设 QR 流程）；Web 端在 UI 上会明确提示用户去 CLI 登录

## 与其它平台的差异

| 差异 | 说明 |
| --- | --- |
| 登录形态 | 走 Google 账号密码 + 可能的两步验证，与其它 7 个平台的 QR 扫码完全不一样 |
| 可见性 | 用 `--visibility`（`public / unlisted / private`），不走 publish_date 定时 |
| `publish_date` 参数 | YouTube uploader 接住但 **不生效** —— CLI 表面暴露 `--schedule`（家族默认），但 dispatcher 故意把 `publish_date=0` 硬编码；用户即便传了 `--schedule` 也会被忽略，原因为 YouTube Studio 标准 browser-automation 路径不暴露 schedule UI（premium / audited 账号才开放） |
| 缩略图、Playlist | YouTube 独有，cover image 与 playlist 都能配 |
| Web Shell | ❌ 当前 SSE bridge 仅支持 QR 流程；YouTube 暂走"调用CLI"路径 |
| 网络环境 | 国内直连 YouTube 会超时，必须经 `YT_PROXY` |

## CLI 命令范例

```bash
# 登录（headed Chrome，必走本地真实终端）
sau youtube login --account work1

# 校验 storage_state
sau youtube check --account work1

# 发布视频
sau youtube upload-video \
  --account work1 \
  --file videos/demo.mp4 \
  --title "示例标题" \
  --desc "示例简介" \
  --tags tag1,tag2 \
  --thumbnail videos/cover.jpg \
  --visibility unlisted
```

## 模板文件

- `scripts/examples/youtube_commands.sh`
- `scripts/examples/youtube_commands.ps1`
- `scripts/examples/youtube_cli_template.py`

## 参考文档

- 运行前提：`references/runtime-requirements.md`
- CLI 契约：`references/cli-contract.md`
- 故障排查：`references/troubleshooting.md`
