---
name: tencent-upload
description: 当 agent 需要通过已安装的 `sau` CLI 完成视频号（WeChat Channels）登录、cookie 校验、视频上传或图文发布时使用这个 skill。视频号现在对应 `uploader/tencent_uploader/`，登录走 QR 扫码，发布支持 `publish_date` 定时或 immediate。优先使用 `sau tencent ...` 而不是一开始就阅读 uploader 源码。
---

# 视频号上传 Skill

优先把 `sau tencent ...` 作为主接口。

不要假设当前环境一定能读取仓库源码。
不要一开始就去读 `uploader/tencent_uploader/`。
只有在命令不可用或 CLI 执行失败时，才回退到故障排查说明。

## 功能概览

| 功能 | 命令入口 | 说明 |
| --- | --- | --- |
| 视频号登录 | `sau tencent login --account <name>` | 生成或刷新指定账号的 cookie（QR 扫码） |
| cookie 校验 | `sau tencent check --account <name>` | 检查指定账号 cookie 是否有效 |
| 视频上传 | `sau tencent upload-video ...` | 上传并发布视频号视频，支持 short-title / category / draft |
| 图文上传 | `sau tencent upload-note ...` | 上传并发布视频号图文（图文），支持 draft |

元数据约定：

- 视频使用 `title + desc + tags`，可选 `--short-title`（短标题）/ `--category`（原创分类）/ `--draft`（草稿）。
- 图文使用 `title + note + tags`，可选 `--draft`。
- 缩略图：视频号同时支持通用 `--thumbnail`、横屏 `--thumbnail-landscape`、竖屏 `--thumbnail-portrait` 三种来源。

## 默认工作流

1. 确认 `sau` 在 PATH 中（`which sau` 或仓库内 `sau_cli.py`）。
2. 执行匹配的 `sau tencent ...` 命令（login / check / upload-video / upload-note）。
3. 如果命令失败，再看 `references/troubleshooting.md`。

## 支持动作

- 使用 `sau tencent login --account <name>` 登录视频号
- 使用 `sau tencent check --account <name>` 校验 cookie 是否有效
- 使用 `sau tencent upload-video ...` 上传视频号视频
- 使用 `sau tencent upload-note ...` 上传视频号图文

## 命令选择建议

- 当用户需要新的 cookie，或现有 cookie 已失效时，使用 `login`
- 当用户只需要确认 cookie 状态时，使用 `check`
- 当用户要发布视频时，使用 `upload-video`
- 当用户要发布图文时，使用 `upload-note`
- 仅在用户明确要保存草稿不要立即发布时，加 `--draft`

## 执行前检查

- 先确认当前 shell 里是否可以调用 `sau tencent --help`
- 如果 `sau` 不在 PATH 中，可以用仓库里的 `sau_cli.py`
- 当用户明确指定无头或有头模式时，显式传 `--headless` 或 `--headed`
- 只有用户明确要求定时发布时，才使用 `--schedule`
- 登录流程会生成本地二维码图片，不要只把图片路径告诉用户 —— 优先用 Web Shell 扫码（默认渲染内联 `<img src={data:image/...}>`）或带 `--headed` 让浏览器直接展示平台自己的二维码

## 与其它平台的差异

| 差异 | 说明 |
| --- | --- |
| 短标题 (`--short-title`) | 视频号独有字段，控制在短标题字数上限内 |
| 原创分类 (`--category`) | 视频号独有，可标记原创内容 |
| 草稿 (`--draft`) | 视频号独有，单条 publish / upload-note 都支持 |
| 横竖屏双缩略图 | 与抖音并列，视频号同时支持 landscape + portrait |
| 图文支持 | ✅ 视频号是少有的同时支持图文上传的平台之一 |

## CLI 命令范例

```bash
# 视频
sau tencent upload-video \
  --account work1 \
  --file videos/demo.mp4 \
  --title "示例标题" \
  --desc "示例简介" \
  --tags tag1,tag2 \
  --thumbnail videos/cover.jpg \
  --short-title "短标题" \
  --category "原创"
```

```bash
# 图文
sau tencent upload-note \
  --account work1 \
  --images videos/1.png videos/2.png \
  --title "图文标题" \
  --note "图文正文" \
  --tags tag1,tag2
```

## 模板文件

- `scripts/examples/tencent_commands.sh`
- `scripts/examples/tencent_commands.ps1`
- `scripts/examples/tencent_cli_template.py`

## 参考文档

- 运行前提：`references/runtime-requirements.md`
- CLI 契约：`references/cli-contract.md`
- 故障排查：`references/troubleshooting.md`
