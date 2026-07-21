## Why

CLI 层和 Uploader 层的重复代码在 `cli-and-uploader-refactor` change 中已部分缓解(基类、managed_browser),但仍有三处明显的架构不一致在阻碍新平台接入:

1. **`cli/parser.py` 7 份手写 `_add_*_parser`** — 每个平台 ~80 行(共享字段 + 平台特有字段),共 ~500 行。新增一个 YouTube 平台需要再复制 80 行;且 `login/check` 子命令被每个平台重写 7 次。
2. **`sau_cli.py` 是 re-export shim** — 它从 `cli.dispatchers / cli.platforms / cli.parser` 二次 re-export 所有符号,实际上 `cli.main:main` 已经做了入口,导致 `sau_cli` 是双入口、心智负担。
3. **`BaiJiaHaoVideo` / `TiktokVideo` 仍裸 object** — `uploader/baijiahao_uploader/main.py:BaiJiaHaoVideo` 和 `uploader/tk_uploader/main.py:TiktokVideo` 没有继承 `BaseVideoUploader`,因此:
   - 没有统一的 `validate_upload_args` / `validate_publish_date` / `publish_strategy`
   - `cli/platforms/baijiahao.py` / `cli/platforms/tiktok.py` 走的旁路(直接 `await obj.main()`)绕开 dispatcher
   - 日志用 `print()` 而非 `utils.log.*_logger`,structured log 收录不到
   - 与 douyin/xhs/ks/tencent/bilibili 的 CLI 行为不一致(参数顺序、错误传播)

这三个问题合起来让"加一个 YouTube 平台"实际工作量从 ~50 行虚增到 ~200 行。

## What Changes

**CLI Parser 改注册表驱动**
- `cli/parser.py` 引入 `PLATFORM_PARSER_CONFIG: dict[str, PlatformParserConfig]`,每个平台一段 dataclass 配置(login args / check args / upload-video args / upload-note args / common flags)
- 提取通用 `build_platform_parser(config)` 函数,7 个 `_add_*_parser` 合并为配置查找
- 公共参数 `--debug/--headless/--headed` 通过 `add_runtime_flags(parser)` 复用,消除 7 份重复

**sau_cli.py 瘦身为 shim**
- 仅保留 `from cli.main import main` + `if __name__ == "__main__": sys.exit(main())` (~5 行)
- 移除所有 `from cli.platforms.* import login as login_*` 的 re-export(它们不在 `sau_cli` 中被实际调用,只是历史兼容)

**百家号 / TikTok 迁移到 BaseVideoUploader**
- `BaiJiaHaoVideo.__init__` 改为 `super().__init__(publish_date, account_file, ...)`
- `BaiJiaHaoVideo.upload()` 复用 `BaseVideoUploader.validate_video_file` / `validate_publish_date`
- `TiktokVideo` 同上;同时将 `print(f'...')` 替换为 `tiktok_logger.info(...)`
- 百家号的 `set_schedule_time` 保留现有"hour 随机"实现(有 TODO 但不在本变更范围),但加 `# FIXME(known-bug): see TBF-XXX` 注释,避免新平台接入时被误以为是标准实现

**新平台接入成本目标**
- 加一个 YouTube 平台(已经实现 uploader):只改 `cli/platforms/youtube.py`(~30 行)+ `cli/parser.py` `PLATFORM_PARSER_CONFIG` 加一段(~15 行),共 ~45 行
- 比当前加平台的工作量 ~200 行降低 75%

## Capabilities

### New Capabilities
- `cli-parser-registry`: `cli/parser.py` 改为注册表驱动,新增平台从复制粘贴 80 行降到 ~15 行

### Modified Capabilities
- `cli-hardening`: `sau_cli.py` 去掉 re-export shim
- `uploader-base-architecture`: `BaiJiaHaoVideo` / `TiktokVideo` 加入 `BaseVideoUploader` 继承链

## Impact

- **CLI**:
  - `cli/parser.py` 重写为注册表驱动;`sau_cli.py` 瘦身为 5 行
  - `cli/platforms/baijiahao.py` / `cli/platforms/tiktok.py` 由"直接 `obj.main()`"改为"构造 BaseVideoUploader 子类 + 调 `await uploader.upload(playwright)`",与其它平台对齐
- **Web API**: 无影响
- **Frontend**: 无影响
- **Database**: 无影响

## Acceptance Criteria

1. **CLI 命令行接口不变**:`sau <platform> <action> --help` 对 7 个平台每个 action 输出与重构前 byte-for-byte 相同
2. **新平台接入成本验证**:模拟"加一个 YouTube 平台"→ 只改 `cli/platforms/youtube.py` + `cli/parser.py` 的 PLATFORM_PARSER_CONFIG 共 ≤ 50 行,无任何其它文件改动
3. **`BaiJiaHaoVideo` / `TiktokVideo` 行为兼容**:
   - `sau baijiahao upload-video --account X --file Y --title Z` 仍然走相同的浏览器启动 / cookie 校验 / 上传流程
   - `sau tiktok upload-video --account X --file Y --title Z` 同上
   - `validate_upload_args` 报错信息与原版一致
4. **日志统一**:`tiktok_logger` / `baijiahao_logger` 替代 `print()`,`pytest tests/test_structured_log.py` 不回归
5. **测试不回归**:`pytest tests/` 全绿
6. **`sau_cli.py` 单测**:`tests/test_sau_cli_shim.py` 新增,验证 `sau_cli.main` 仍可调用且行为等价于 `cli.main.main`
