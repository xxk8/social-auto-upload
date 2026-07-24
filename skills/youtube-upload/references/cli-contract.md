# CLI 契约（YouTube / youtube-upload）

YouTube 子命令与 [`cli/parser.py`](../../cli/parser.py) 中 `PlatformParserConfig` 的字段完全一致。当前 hover 出的完整子命令清单与每个 flag 的语义，可随时本地查：

```bash
sau youtube --help                    # 顶层 YouTube 分组
sau youtube login --help               # 登录（headed Chrome，Google 账号）
sau youtube check --help               # 校验（headless，带 cookie 打开 Studio）
sau youtube upload-video --help        # 视频上传
```

YouTube 子命令与 [`cli/parser.py`](../../cli/parser.py) 的 `youtube` PlatformParserConfig 字段、以及 [`cli/dispatchers.py::_dispatch_youtube`](../../cli/dispatchers.py) 的实际接线共同决定 — 两边会对不上时以 dispatcher 为准。下面说明 YouTube 几条家族默认行为的偏差，以避免未来读者据 CLI help 直接推论出错误期望：

- `--visibility` —— **parser 未暴露**（`PlatformParserConfig` 中没有 `has_visibility` 字段）。上传默认 `public`；用户上 CLI 改不了。若要让 `--visibility` 透传：需要同步改两边 ——（1）在 [`cli/parser.py`](../../cli/parser.py) 的 `youtube` PlatformParserConfig 中追加 `has_visibility: bool = True`；（2）把 [`cli/dispatchers.py::_dispatch_youtube`](../../cli/dispatchers.py) 里硬编码的 `visibility='public'` 改成 `visibility=args.visibility`。
- `--schedule` —— **parser 是暴露的**（家族默认行为，在 `_add_upload_video_subparser` 里无条件追加，与是否有 `has_schedule` 参数无关），但 **dispatcher 故意把 `publish_date=0` 硬编码**，所以即便用户传了 `--schedule`，CLI 也会忽略它。这是有意设计：YouTube Studio 标准 browser-automation 路径不暴露 schedule UI（需 premium/audited 账号才开放）。若未来 Studio schedule UI 重新可用，只需在 [`cli/dispatchers.py::_dispatch_youtube`](../../cli/dispatchers.py) 把 `publish_date=0` 改成 `publish_date=args.schedule or 0` 即可。

需要确认字段时优先 `sau youtube <action> --help`；CLI 帮助是契约的 source of truth。
