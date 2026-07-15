---
name: tiktok-upload
description: 当 agent 需要通过已安装的 `sau` CLI 完成 TikTok 登录、cookie 校验或视频上传时使用这个 skill。TikTok 对应 `uploader/tk_uploader/`（与抖音的 uploader 解耦），登录走 QR 扫码，目前只支持视频上传、不支持图文。优先使用 `sau tiktok ...` 而不是一开始就阅读 uploader 源码。
---

# TikTok 上传 Skill

优先把 `sau tiktok ...` 作为主接口。

不要假设当前环境一定能读取仓库源码。
不要一开始就去读 `uploader/tk_uploader/`。
只有在命令不可用或 CLI 执行失败时，才回退到故障排查说明。

## 功能概览

| 功能 | 命令入口 | 说明 |
| --- | --- | --- |
| TikTok 登录 | `sau tiktok login --account <name>` | 生成或刷新指定账号的 cookie（QR 扫码） |
| cookie 校验 | `sau tiktok check --account <name>` | 检查指定账号 cookie 是否有效 |
| 视频上传 | `sau tiktok upload-video ...` | 上传并发布 TikTok 视频 |

元数据约定：

- 视频使用 `title + tags`（TikTok 平台没有 description 字段，所以 CLI 里也没有 `--desc`）

## 默认工作流

1. 确认 `sau` 在 PATH 中（`which sau` 或仓库内 `sau_cli.py`）。
2. 执行匹配的 `sau tiktok ...` 命令（login / check / upload-video）。
3. 如果命令失败，再看 `references/troubleshooting.md`。

## 支持动作

- 使用 `sau tiktok login --account <name>` 登录 TikTok
- 使用 `sau tiktok check --account <name>` 校验 cookie 是否有效
- 使用 `sau tiktok upload-video ...` 上传 TikTok 视频

## 命令选择建议

- 当用户需要新的 cookie，或现有 cookie 已失效时，使用 `login`
- 当用户只需要确认 cookie 状态时，使用 `check`
- 当用户要发布视频时，使用 `upload-video`
- TikTok 不支持图文（平台没有图文流），不要尝试 `upload-note`

## 执行前检查

- 先确认当前 shell 里是否可以调用 `sau tiktok --help`
- 如果 `sau` 不在 PATH 中，可以用仓库里的 `sau_cli.py`
- 当用户明确指定无头或有头模式时，显式传 `--headless` 或 `--headed`
- 只有用户明确要求定时发布时，才使用 `--schedule`
- 登录流程会生成本地二维码图片，不要只把图片路径告诉用户 —— 优先用 Web Shell 扫码（默认渲染内联 `<img src={data:image/...}>`）或带 `--headed` 让浏览器直接展示平台自己的二维码
- TikTok 对网络环境敏感，若登录超时，先确认是否能访问 TikTok

## 与其它平台的差异

| 差异 | 说明 |
| --- | --- |
| 无 `--desc` | TikTok 平台只有 `title` + `tags`，CLI 不暴露 `--desc` |
| 无缩略图参数 | TikTok 走平台默认封面生成逻辑 |
| 无图文 | TikTok 是纯视频平台 |
| 视频走 Chrome 版 | TikTok 上传走 patchright + Chrome 而不是 simulator |

## CLI 命令范例

```bash
sau tiktok upload-video \
  --account work1 \
  --file videos/demo.mp4 \
  --title "示例标题" \
  --tags tag1,tag2
```

## 模板文件

- `scripts/examples/tiktok_commands.sh`
- `scripts/examples/tiktok_commands.ps1`
- `scripts/examples/tiktok_cli_template.py`

## 参考文档

- 运行前提：`references/runtime-requirements.md`
- CLI 契约：`references/cli-contract.md`
- 故障排查：`references/troubleshooting.md`
