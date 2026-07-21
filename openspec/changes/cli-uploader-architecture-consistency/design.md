## Context

`cli-and-uploader-refactor` change 已经把"CLI 分发器注册化"作为核心 deliverable 写在 proposal 中,但实际合并时只完成了 `BaseUploadRequest` 基类,未完成"通用 `dispatch_platform()` + 平台配置字典"部分。本 change 承接那部分未完成工作 + 修 `sau_cli.py` 的 re-export 死代码 + 修 baijiahao/tiktok 与 `BaseVideoUploader` 的架构偏离。

## Goals / Non-Goals

### Goals
- CLI parser 改注册表驱动,新平台接入成本 ≤ 50 行(`cli/platforms/<name>.py` + `cli/parser.py` 的一段 config)
- `sau_cli.py` ≤ 10 行,无 re-export
- `BaiJiaHaoVideo` / `TiktokVideo` 继承 `BaseVideoUploader`,与 douyin/xhs/ks/tencent/bilibili 行为对齐
- 7 个平台 CLI 外部行为 byte-for-byte 不变

### Non-Goals
- ❌ 不改 YouTube 平台接入(单独的 `youtube-full-integration` change)
- ❌ 不修百家号定时发布"随机"bug(已知 TODO,需要单独 change)
- ❌ 不实现 TencentNote / TikTok note / Baijiahao note(单独 change)
- ❌ 不引入新依赖
- ❌ 不动 web_runner 前端

## Decisions

### D1: PlatformParserConfig 用 lambda 表达平台特有参数

**决策**: 每个平台的 `upload_video_args` 是一个 list of lambda(parser),在 `_build_platform_parser` 中遍历执行。lambda 闭包捕获平台名,避免为每个平台写 `_add_X_argv` 函数。

```python
@dataclass
class PlatformParserConfig:
    name: str
    help: str
    has_login: bool = True
    has_check: bool = True
    has_upload_video: bool = True
    has_upload_note: bool = False
    upload_video_args: list[Callable[[argparse.ArgumentParser], None]] = field(default_factory=list)
    upload_note_args: list[Callable[[argparse.ArgumentParser], None]] = field(default_factory=list)
```

**替代方案 1**: 用类继承 + 多态(`TencentParser(BaseParser)`)— 拒绝:7 个文件,反而分散。
**替代方案 2**: 用 yaml/toml 配置 — 拒绝:lambda 在 yaml 里表达不了,需要额外 DSL。
**替代方案 3**: 完全重复现状 — 拒绝:本 change 就是为了消除它。

### D2: `sau_cli.py` 砍到 ≤ 10 行

**决策**: `sau_cli.py` 只保留:
```python
import sys
from cli.main import main
if __name__ == "__main__":
    sys.exit(main())
```

不保留任何 re-export,因为:
- `cli.platforms.X` 是 cli 内部模块,外部用户不会 `from sau_cli import X`
- `pyproject.toml` 的 `sau` 入口点用 `cli.main:main`,不用 `sau_cli.main`
- 保留 re-export 反而是诱饵,新代码会 `import sau_cli.X` 然后发现它不存在

**风险**: 第三方代码 `import sau_cli.X` 会破(已知 0 个 import 点,确认 `git grep "from sau_cli"` 为空)。

### D3: 百家号 / TikTok 改 BaseVideoUploader 不重写实现

**决策**: 保留 `BaiJiaHaoVideo` / `TiktokVideo` 现有 `upload()` / `set_schedule_time()` 实现,只改:
- 继承 `BaseVideoUploader`
- 用 `self.validate_video_file(...)` 替代 `os.path.exists(...)`
- 替换 `print()` 为 logger
- 加 `validate_upload_args()`

不重写核心浏览器自动化逻辑,因为这些逻辑与其它平台差异大(百家号有 `ai2video` 实验性功能 / TikTok 用 firefox 而非 chromium),改 BaseVideoUploader 只是"加挂载点",不动主流程。

**替代方案**: 完整重写为统一的 `_upload_via_pw` — 拒绝:YAGNI,且可能引入回归。

### D4: 百家号定时发布"随机"bug 留到下个 change

**决策**: 本 change 只加 `# FIXME(known-bug)` 注释,不在本次修。理由:
- 修法需要把 `div.select-wrap` 的真实 DOM 选择 + 真实 datetime 转换写对,与平台 UI 绑定,需要真实账号测试
- 本 change 的 scope 是"架构一致",不动业务逻辑
- 留下个明确的 follow-up change ticket: `fix-baijiahao-schedule-time`

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 注册表化 parser 改变 `argparse` 内部顺序,导致 `--help` 输出与重构前 byte 不等 | 1.6 任务有 byte-for-byte 验证;若有差异,在 test 里 snapshot |
| 百家号 / TikTok `BaseVideoUploader` 改造引入新行为 | 端到端 smoke + 不改 `upload()` 主流程,只加 validate |
| `sau_cli.py` 砍 re-export 破第三方 | `git grep` 确认 0 引用,失败模式清晰 |
| 现有 test 用了 `sau_cli.login_*` re-export | `tests/test_sau_browser_cli.py` 等需要同步从 `cli.platforms` 导入 |

## Migration Plan

- **Phase 1** (Tasks 1-2): CLI parser 注册化(零外部行为变化,可独立 merge)
- **Phase 2** (Task 3): `sau_cli.py` 瘦身(零外部行为变化,验证 `sau_cli.main` 仍可调)
- **Phase 3** (Tasks 4-5): 百家号 / TikTok 改 BaseVideoUploader(各自一个 commit,出问题好 revert)
- **Phase 4** (Task 6): 全量验证

每个 Phase 可独立 revert,失败时回滚成本低。

## Open Questions

- 现有 `tests/test_sau_browser_cli.py` 直接 import `sau_cli.login_*` 的写法是否还有?如果有,改 import 路径算 breaking 还是要维护?
- `cli/parser.py` 注册表化后,`xhs` 平台"tag 数量上限 10"的硬错误逻辑(目前在 `cli/dispatchers.py`)是否一并搬过来?还是保留在 dispatcher?
