# CLI 契约（TikTok / tiktok-upload）

TikTok 子命令与 [`cli/parser.py`](../../cli/parser.py) 中 `PlatformParserConfig` 的字段完全一致。当前 hover 出的完整子命令清单与每个 flag 的语义，可随时本地查：

```bash
sau tiktok --help                    # 顶层 TikTok 分组
sau tiktok login --help              # 登录
sau tiktok check --help              # 校验
sau tiktok upload-video --help       # 视频上传（注意：TikTok 只有 video，没有 note）
```

TikTok 故意不暴露 `--desc`（平台不接）与 `--thumbnail`（平台走默认封面）。

需要确认字段时优先 `sau tiktok <action> --help`；CLI 帮助是契约的 source of truth。
