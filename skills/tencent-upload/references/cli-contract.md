# CLI 契约（视频号 / tencent-upload）

视频号子命令与 [`cli/parser.py`](../../cli/parser.py) 中 `PlatformParserConfig` 的字段完全一致。当前 hover 出的完整子命令清单与每个 flag 的语义，可随时本地查：

```bash
sau tencent --help                    # 顶层视频号分组
sau tencent login --help              # 登录
sau tencent check --help              # 校验
sau tencent upload-video --help       # 视频上传
sau tencent upload-note --help        # 图文上传
```

视频号独有的 flag：`--short-title`、`--category`、`--draft`（video/note 共用）。其它 flag 与家族保持一致：`--account / --file / --title / --desc / --tags / --schedule / --thumbnail * 3 / --debug / --headless`。

需要确认字段时优先 `sau tencent <action> --help`；CLI 帮助是契约的 source of truth，能保证 CLI 与上述字段表不会脱钩。
