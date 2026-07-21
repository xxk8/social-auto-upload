# CLI 契约（百家号 / baijiahao-upload）

百家号子命令与 [`cli/parser.py`](../../cli/parser.py) 中 `PlatformParserConfig` 的字段完全一致。当前 hover 出的完整子命令清单与每个 flag 的语义，可随时本地查：

```bash
sau baijiahao --help                    # 顶层百家号分组
sau baijiahao login --help              # 登录
sau baijiahao check --help              # 校验
sau baijiahao upload-video --help       # 视频上传（注意：百家号只有 video，没有 note）
```

百家号故意不暴露 `--desc`（平台不接）与 `--thumbnail`（平台走默认封面）。

需要确认字段时优先 `sau baijiahao <action> --help`；CLI 帮助是契约的 source of truth，能保证 CLI 与上述字段表不会脱钩。
