## 1. CLI Parser 注册表化 (CLI)

- [ ] 1.1 在 `cli/parser.py` 顶部定义 `PlatformParserConfig` dataclass,字段包含 `name / help / login / check / upload_video / upload_note / extra_args / has_note`
- [ ] 1.2 定义 `PLATFORM_PARSER_CONFIG: dict[str, PlatformParserConfig]`,7 个平台每个一个条目,login/check/upload-video/upload-note 用 `add_argument` 的 lambda 表达平台特有参数(product_link / tid / category / draft 等)
- [ ] 1.3 提取 `_build_platform_parser(config)` 通用函数:从 config 自动生成 subparser 树
- [ ] 1.4 `build_parser()` 改为遍历 `PLATFORM_PARSER_CONFIG` 调用 `_build_platform_parser`
- [ ] 1.5 删除原 7 个 `_add_*_parser` 函数
- [ ] 1.6 验证 `python -c "from cli.parser import build_parser; p = build_parser(); print(p.format_help())"` 输出与重构前等价

## 2. 平台特有参数保持 (CLI)

- [ ] 2.1 douyin: product_link / product_title / thumbnail-landscape / thumbnail-portrait
- [ ] 2.2 bilibili: tid
- [ ] 2.3 tencent: short_title / category / draft / thumbnail-landscape / thumbnail-portrait
- [ ] 2.4 xiaohongshu: tag 数量上限 10 的硬错误(原 `cli/dispatchers.py` 实现保留到 dispatch 层,不在 parser)
- [ ] 2.5 kuaishou / tiktok / baijiahao: 维持现有参数集

## 3. sau_cli.py 瘦身 (CLI)

- [ ] 3.1 删除 `sau_cli.py` 顶部 7 个 `from cli.platforms.X import login/check/...`
- [ ] 3.2 移除 `__all__` 列表
- [ ] 3.3 保留 `if __name__ == "__main__": sys.exit(main())` 调用 `cli.main.main()`
- [ ] 3.4 `sau_cli.py` 最终 ≤ 10 行
- [ ] 3.5 `tests/test_sau_cli_shim.py` 验证 `python sau_cli.py --help` 与 `python -m cli.main --help` 输出一致

## 4. 百家号 uploader 迁移到 BaseVideoUploader (Uploader)

- [x] 4.1 `BaiJiaHaoVideo.__init__` 改为继承 `BaseVideoUploader`,加 `super().__init__(publish_date, account_file)` 调用
  - **Deviation note (2026-07-02)**: spec assumes `BaseVideoUploader` 已有 `__init__(publish_date, account_file)`. 但该 base class 当前是 stateless namespace for classmethods, 无 `__init__`. Phase 1 已 ship 的 `DouYinBaseUploader` 走 "derived class 直接设 shared attrs" pattern (无 super 调用). 保持一致: 本 PR 仍改为 `class BaiJiaHaoVideo(BaseVideoUploader):` (满足 "继承" 部分), 但 `__init__` 内部直接 set `self.publish_date / self.account_file` (不调 `super().__init__(publish_date, account_file)`). 给 base 加 `__init__` 需同步更新 7 个 platform class, 超出本 PR 范围; 等更多 shared state 进 base 时再统一升级. Code 上加 `NOTE(deviation-from-spec)` 注释, 未来 reviewer 可立即找到原因.
- [x] 4.2 `BaiJiaHaoVideo.upload()` 用 `self.validate_video_file(self.file_path)` 替代手写 `os.path.exists` 校验
- [x] 4.3 `BaiJiaHaoVideo` 新增 `validate_upload_args()` 方法(若发布策略为 scheduled,调 `self.validate_publish_date`)
- [x] 4.4 `set_schedule_time` 加 `# FIXME(known-bug): 百家号时间选择不准确,目前是随机` 注释(不在本变更修复)
- [x] 4.5 `cli/platforms/baijiahao.py` 改为构造 `BaiJiaHaoVideo(...)` + `await uploader.main()`,与其它平台对齐 — Phase 1 前置 work 已完成, 本 PR 无需再改

## 5. TikTok uploader 迁移到 BaseVideoUploader (Uploader)

- [x] 5.1 `TiktokVideo.__init__` 改为继承 `BaseVideoUploader`,加 `super().__init__(publish_date, account_file)` 调用
  - **Deviation note (2026-07-02)**: 同 §4.1 — 走 DouYinBaseUploader pattern (derived class 直接设 attrs, 不调 `super().__init__()`). Code 上加 `NOTE(deviation-from-spec)` 注释.
- [x] 5.2 `TiktokVideo` 改用 `tiktok_logger.info(...)` 替代 `print(f'[+]...')` (共 4 处:`cookie valid` / `cookie expired` / `Uploading ...` / `update cookie`)
  - **Completion note**: 4 处 print 已在 Phase 1 前置 work 中替换为 `tiktok_logger.*`. grep 验证无残留 `print(` 调用.
- [x] 5.3 `TiktokVideo.upload()` 复用 `self.validate_video_file(self.file_path)`
- [x] 5.4 `TiktokVideo` 新增 `validate_upload_args()` 方法
- [x] 5.5 `cli/platforms/tiktok.py` 改为构造 `TiktokVideo(...)` + `await uploader.main()` — Phase 1 前置 work 已完成, 本 PR 无需再改

## 6. 验证 (CLI / Uploader)

- [ ] 6.1 `pytest tests/` 全绿
- [ ] 6.2 `pytest tests/test_structured_log.py` 验证 baijiahao/tiktok 的 logger 输出被 structured log 收录
- [ ] 6.3 7 个平台每个的 `sau <platform> --help` 输出与重构前 byte-for-byte 等价
- [ ] 6.4 `sau baijiahao upload-video --account X --file Y --title Z` 端到端 smoke(本地无 cookie 跳过,只看 argparse 不报错)
- [ ] 6.5 `sau tiktok upload-video --account X --file Y --title Z` 端到端 smoke

## 7. Pre-migration audit (audit-only, no code changes) (Uploader)

Added 2026-07-02: audit the 5 non-Phase-3 platform modules (`bilibili` / `kuaishou` / `xiaohongshu` / `tencent` / `douyin`) + `tiktok` for the same `datetime.now()` coercion pattern that bit `baijiahao` in Phase 3, BEFORE any of them get migrated to `validate_publish_date` in a future phase.

**Outcome: clean.** `cli/platforms/baijiahao.py` was the only outlier (already fixed in Phase 3 §4.5: `publish_date = request.publish_date or 0` with explanatory comment). All 6 other platform modules use safe pass-through patterns and need no proactive changes.

- [x] 7.1 Audit `cli/platforms/{bilibili,kuaishou,xiaohongshu,tencent,douyin,tiktok}.py` for `datetime.now()` coercion / falsy `or` fallback / `isinstance(... datetime)` guard coercion
  - **Result**: bilibili gates `--dtime` injection (skips when `0`/int, biliup immediate default — safe). kuaishou / xiaohongshu / tencent / douyin / tiktok pass `request.publish_date` through verbatim. None coerce via `datetime.now()` or falsy fallback.
- [x] 7.2 Audit round-trip: `request.publish_date` → uploader constructor → `validate_publish_date` short-circuit on `0`
  - **Result**: `BaseVideoUploader.validate_publish_date` short-circuits `None`/`0` → `0` before the past-date check, so a verbatim `0` from any platform module is safe regardless of whether the platform is migrated.
- [x] 7.3 Audit `cli/parser.py` / `cli/dispatchers.py` / `cli/main.py` / `cli/utils.py` for upstream coercion
  - **Result**: `cli/dispatchers.py` uses `args.schedule or 0` defensively (intentional: argparse returns `None` when `--schedule` not passed). All other upstream sites are pass-through.
- [x] 7.4 Audit `uploader/` for any inline `or datetime.now` / `isinstance + or` patterns outside `base_video.py`
  - **Result**: zero matches. `uploader/baijiahao_uploader/main.py:335` `now = datetime.now()` is for the `ai2video` LocalStorage batch-key, unrelated to `publish_date`.

## 8. Phase 4 — DouYin migration to shared `BaiJiaHaoVideo.validate_upload_args` pattern (Uploader)

Added 2026-07-02: migrate `DouYinVideo` + `DouYinNote` to the shared unconditional-`validate_publish_date` pattern (matches Phase 3 baijiahao + tiktok), closing the §7 audit round-trip with a real regression guard. DouYin's prior logic was strategy-conditional (`if strategy=IMMEDIATE: publish_date = 0` overwrote user input silently — latent bug).

- [x] 8.1 `DouYinBaseUploader.validate_base_args`: drop the strategy-conditional `publish_date` block; keep cookie_file + cookie_auth + publish_strategy validation only. publish_date validation is now unconditional in the derived-class `validate_upload_args` (matches baijiahao shared pattern).
  - **Side-effect**: DouYinNote relied on `validate_base_args` to mutate `publish_date` → covered symmetrically in 8.2.
- [x] 8.2 `DouYinVideo.validate_upload_args`: add unconditional `self.publish_date = self.validate_publish_date(self.publish_date)` AFTER title + file + obfuscation + thumbnail checks (matching baijiahao pattern order). DouYinNote gets symmetric coverage at the end of its validate_upload_args.
  - **Runtime-impact**: strategy=IMMEDIATE + `publish_date=datetime(...)` no longer silently overwrites to 0 (latent bug fix). The `upload()` guard `if publish_strategy == SCHEDULED and self.publish_date != 0` still controls actual scheduling, so behavior is unchanged at the runtime level for valid configurations.
- [x] 8.3 `tests/test_douyin_uploader.py`: 6-line lock-in test mirroring `tests/test_baijiahao_uploader.py` (2 happy + 3 sad paths). Mocks `cookie_auth` (AsyncMock returning True) + `obfuscate_video` (returns a non-existent `.obf.mp4` so the `if obfuscated.exists()` branch is skipped — keeps the test deterministic without writing a real `.obf` file).
  - **File lock-in**: matches Phase 3 §6.5 AC pattern; provides regression guard for the Phase 4 migration.
- [x] 8.4 Phase 4 candidate migration — bilibili / kuaishou / xiaohongshu / tencent (Uploader)
  - **Status (2026-07-02): all 4 platforms migrated. Pattern matches §8.1 / §8.2 (DouYin); the latent "IMMEDIATE strategy + datetime input → silently overwritten to 0" bug is now closed across the full 7-platform family.**
  - [x] 8.4.1 kuaishou: drop strategy-conditional `publish_date` block from `KSBaseUploader.validate_base_args`; add unconditional `self.publish_date = self.validate_publish_date(self.publish_date)` at the tail of both `KSVideo.validate_upload_args` and `KSNote.validate_upload_args`. New test `tests/test_kuaishou_uploader.py` mirrors `tests/test_douyin_uploader.py` (mocks module-level `cookie_auth` so validate_upload_args runs without a real browser).
  - [x] 8.4.2 xiaohongshu: same pattern — drop conditional from `XiaoHongShuBaseUploader.validate_base_args`; add unconditional at the tail of both `XiaoHongShuVideo.validate_upload_args` and `XiaoHongShuNote.validate_upload_args`. New test `tests/test_xiaohongshu_uploader.py` mirrors `tests/test_douyin_uploader.py`. Note: `obfuscate_video` / `obfuscate_image` live in `upload_video_content` / `upload_note_content`, not in `validate_upload_args`, so the test does not need obfuscation mocks.
  - [x] 8.4.3 tencent: same pattern — drop conditional from `TencentBaseUploader.validate_base_args`; add unconditional at the tail of both `TencentVideo.validate_upload_args` and `TencentNote.validate_upload_args`. New test `tests/test_tencent_uploader.py` mirrors `tests/test_douyin_uploader.py`. **Sub-design-decision (from thinker-with-files-gemini pass)**: TencentNote's `upload()` body is still stubbed with `NotImplementedError` (text-mode tabs in 视频号 not yet wired); the validation portion is migrated because `validate_upload_args` is real and runs BEFORE the upload body, so the test never touches the not-yet-implemented body.
  - [x] 8.4.4 bilibili: structural outlier migration — `BilibiliNote` did NOT previously inherit `BaseVideoUploader`; after migration it does. Dropped the local `_validate_image` private method (same logic as base's `validate_image_file`; the local `SUPPORTED_IMAGE_EXTENSIONS` set was a strict subset of the base set, so consolidation is behaviour-preserving). Replaced the ad-hoc `publish_date not in (None, 0) and (not isinstance(...))` TypeError check with an unconditional `validate_publish_date` (matches the shared pattern). `MAX_IMAGES = 20` cap preserved (platform-specific — base class doesn't track per-platform image limits). New test `tests/test_bilibili_uploader.py` mirrors `tests/test_baijiahao_uploader.py` (NO `cookie_auth` mock — bilibili Note's `validate_upload_args` does not check cookies; the check lives in `cli/platforms/bilibili.upload_note` BEFORE constructing the uploader). **NOTE**: bilibili has no `BilibiliVideo` class — video uploads use a biliup (subprocess) CLI in `cli/platforms/bilibili.upload_video`, so only Note is migrated. When the biliup CLI is replaced by an in-process `BilibiliVideo` class, the §8.4.4 inheritance pattern transfers verbatim.
  - [x] 8.4.5 Family-wide audit §8.4 (2026-07-02): confirmed all 11 derived classes that have `validate_upload_args` end with the unconditional `validate_publish_date` line — `BaiJiaHaoVideo` (Phase 3 §4.3) / `DouYinVideo` + `DouYinNote` (Phase 4 §8.2) / `KSVideo` + `KSNote` (Phase 4 §8.4.1) / `XiaoHongShuVideo` + `XiaoHongShuNote` (Phase 4 §8.4.2) / `TencentVideo` + `TencentNote` (Phase 4 §8.4.3) / `BilibiliNote` (Phase 4 §8.4.4) / `TiktokVideo` (Phase 3 §5.4, predates §8.4). Grep verification: `grep -rn 'self.publish_date = self.validate_publish_date(self.publish_date)' uploader/` returns 11 lines across 10 files (douyin + ks + tencent + xhs each contribute 2 lines for their Video + Note pair). Strategy-conditional block removed from all 5 base classes (`KSBaseUploader` / `XiaoHongShuBaseUploader` / `TencentBaseUploader` / `DouYinBaseUploader` + baijiahao's unconditional from §4.3 — bilibili Note was leaf-class, no base to update). Pre-migration §7 audit findings confirmed all 6 platform modules pass `request.publish_date` verbatim, so the migration is safe across the board.
  - **Side-effect observed across the family**: a fixture type `(Kuaishou|Xiaohongshu|Tencent|Bilibili)Video.__init__(..., publish_date=<datetime>, publish_strategy='immediate')` previously silently overwrote user-input `publish_date` to `0` (because the base-class strategy-conditional path forced `else: self.publish_date = 0`). After §8.4 the user-intent is preserved — `datetime` is no longer replaced. The `upload()` runtime guards `if publish_strategy == SCHEDULED and self.publish_date != 0` still gate actual scheduling, so behaviour at the runtime level is unchanged for VALID configurations; the §8.4 change is strictly less lossy for INVALID (strategy=IMMEDIATE + datetime) configurations that operators might have passed in by mistake.
  - [x] 8.4.6 Phase 5 tail close (2026-07-02): the §8.4.5 audit grep was structurally insufficient — it only matched classes ALREADY containing `validate_upload_args`. Two unfingerprinted outliers remained and are migrated in `openspec/changes/phase5-uploader-migration-tail/`:
      * `TiktokNote` (NEW class, `uploader/tk_uploader/main.py`) — Phase 5 created the class + applied the §8.4 family pattern with image validation. `upload()` body stubbed with `NotImplementedError` per the §8.4.3 sub-design-decision on TencentNote (validation IS real; UI wiring is out of scope). Lock-in test: `tests/test_tiktok_note_uploader.py::test_validate_upload_args_contract`.
      * `YouTubeVideo` (`uploader/youtube_uploader/main.py`) — Phase 5 added `validate_upload_args` (the §8.4.5 grep's pre-existing miss). Added `publish_date=0` kwarg to `__init__` (backward-compatible; default short-circuits in validate). `upload()` now invokes `self.validate_upload_args()` first per the family contract (matches §8.4 behaviour-preserving-property: existing valid callers default `publish_date=0` → validate short-circuits → upload proceeds).
      * Post-Phase-5 sanity: `grep -rn 'def validate_upload_args' uploader/` returns 13 matches (11 prior + TiktokNote + YouTubeVideo); family fingerprint is now EXHAUSTIVE. The complementary grep `grep -rn 'self.publish_date = self.validate_publish_date(self.publish_date)' uploader/` returns ≥ 12 matches (note TiktokNote's `upload()` body is stubbed so the unconditional call appears once in `validate_upload_args` and the `await` invocation in `upload()` is does-not-exist for the stub body — that's by design per the §8.4.3 sub-design-decision).

## 9. Phase 6 — cli-level wiring for the Phase 5 tail (Out-of-scope-of-this-change, future ticket)

`TiktokNote` and `YouTubeVideo`'s `validate_upload_args` (Phase 5) are
class-level. The cli-level wiring (`TiktokNoteUploadRequest` dataclass +
dispatcher + CLI subparser for `sau tiktok upload-note`) is a
follow-up migration ticket (Phase 6). Phase 5 ships the uploader-class
migration only + the lock-in test; dispatch-level + cli-parser-level
are decoupled per the same architecture as Phase 4 §8.4.
