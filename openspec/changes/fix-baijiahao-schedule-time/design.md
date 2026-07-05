## Context

The parent change `cli-uploader-architecture-consistency` deliberately left this bug as a `# FIXME(known-bug)` annotation per design.md D4:

> **D4: 百家号定时发布"随机"bug 留到下个 change**
> **决策**: 本 change 只加 `# FIXME(known-bug)` 注释,不在本次修。理由:
> - 修法需要把 `div.select-wrap` 的真实 DOM 选择 + 真实 datetime 转换写对,与平台 UI 绑定,需要真实账号测试
> - 本 change 的 scope 是"架构一致",不动业务逻辑
> - 留下个明确的 follow-up change ticket: `fix-baijiahao-schedule-time`

This change is that explicit follow-up ticket.

## Goals / Non-Goals

### Goals

- Replace the random-hour behaviour of `BaiJiaHaoVideo.set_schedule_time` with a deterministic text-based click.
- Lock the fix in with a unit test that fails if the buggy `.nth(<index>)` pattern reappears.
- Document the real-account verification procedure for future maintainers.

### Non-Goals

- No refactor of `BaiJiaHaoVideo` to use `BaseVideoUploader.validate_publish_date` — that's a separate concern (parent change Phase 3).
- No fix for the `ai2video` experimental feature (out of scope per parent change).
- No fix for Tencent / Xiaohongshu scheduled-publish bugs (none known; they use text-based selectors already).
- No CLI / Frontend / Web API changes.

## Decisions

### D1: Use text-based click, mirror the day-selection pattern (AMENDED)

The day-selection two lines above uses:

```python
await page.locator(f'div.rc-virtual-list  div.cheetah-select-item >> text={publish_date_day}').click()
```

The **original D1 fix shape** mirrored this with:

```python
await page.locator(f'div.rc-virtual-list:visible div.cheetah-select-item-option >> text={publish_date_hour}').first.click()
```

**AMENDED (2026-07-02):** the implementation uses `get_by_text(publish_date_hour, exact=True)` instead, for **one critical reason**:

> Playwright's `>> text=` SYNTAX (used in the day selector above) performs **substring matching** by default. For the hour case, the assumption `publish_date_hour = f'{publish_date.hour}点'` produces strings like `"2点"`, `"12点"`, `"22点"` — `text=2点` would silently match `"12点"` and `"22点"`, and with `.first` the most-visible match would win, not the value the user requested.
>
> `get_by_text(publish_date_hour, exact=True)` enforces strict equality (Playwright's documented `exact=True` flag on `get_by_text`). Day selection does NOT have this collision risk because `publish_date_day = f'{month}月{day}日'` does not have a day-component that prefixes another day-component (day 1, 11, 21 are month-distinguished via `0{d}日` zero-pad).

Final implementation:

```python
try:
    await page.locator('div.rc-virtual-list:visible div.cheetah-select-item-option').get_by_text(publish_date_hour, exact=True).click()
except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as exc:
    available = await page.locator('div.rc-virtual-list:visible div.cheetah-select-item-option').all_inner_texts()
    raise RuntimeError(f'百家号定时发布时间选择失败: 用户请求 hour={publish_date_hour!r}, 当前可见 hour options={available!r}. 原始 playwright error: {exc!r}. ...') from exc
```

**Alternative considered**: parse all option texts and find by `int(text.replace('点', '')) == publish_date.hour`. Rejected: more code, less readable.

**Alternative considered**: a `select_by_value` helper. Rejected: Ant Design's `cheetah-select` is a custom dropdown (not a native `<select>`), so `select_by_value` does not work.

### D2: Raise a clear `RuntimeError` instead of silent fallback

✅ **DONE.** Implementation in `uploader/baijiahao_uploader/main.py::BaiJiaHaoVideo.set_schedule_time` catches the text-selector click failure, queries `available` via `all_inner_texts()`, and re-raises with `raise RuntimeError(...) from exc` so both the friendly operator-facing message AND the original Playwright traceback are preserved.

The error format follows the design intent (`requested hour + available list`) but adds one extra signal — the openspec-ticket pointer (`详见 openspec/changes/fix-baijiahao-schedule-time/ AC #4 真实账号 probe 任务`) so an operator seeing the message in production logs can locate the manual-probe runbook without grep:

```
百家号定时发布时间选择失败: 用户请求 hour='14点', 当前可见 hour options=['8点', '9点', ...]. 原始 playwright error: <exc>. 如 hour option 实际渲染格式与 '14点' 不符 ..., 需调整 publish_date_hour 模板 — 详见 openspec/changes/fix-baijiahao-schedule-time/ AC #4 真实账号 probe 任务。
```

**Rationale**: a scheduled-publish bug that produces a random hour is WORSE than a clear failure — operators schedule a video for 2pm and it posts at 4pm silently. Loud failure with the available list lets the operator pick a valid hour or open a bug ticket.

### D3: `# FIXME(known-bug)` → `# FIXED(known-bug, gated on AC#4)` (NUANCED, not DROPPED)

The parent change Task 4.4 added `# FIXME(known-bug): 百家号时间选择不准确,目前是随机`. **Original D3 said drop the comment once merged** — the §2 implementation **does NOT drop** it. The new comment block is structured as:

```
# FIXED（openspec/changes/fix-baijiahao-schedule-time, AC §1–§3）:
# ... explanation of the bug + what was fixed ...
# 残留风险(AC #4 真正账号 probe 后才能 close):
#   1. hour option 实际渲染格式可能是 "14 时" / "下午 2 点" / "14:00" 而非 "{N}点"
#   2. minute wire-up 同样依赖 AC #4 真实 dropdown DOM 结构
```

**Rationale for keeping the comment**: the design assumed the format `"N点"` but cannot verify it without AC #4 (real-account probe). The `get_by_text(exact=True)` fix is correct for `"N点"` and will loudly fail via D2's RuntimeError if the format differs. Keeping an explicit `FIXED-but-gated-on-AC#4` comment + openspec-ticket pointer in the source preserves the audit trail AND points the next maintainer to the open work.

### D4: Real-account test is the final AC, not automated (STANDS — explicit post-merge follow-up)

The unit test (Task 4, done) can verify the text-based selector pattern but cannot verify the **actual hour option text format** without a real account. The text could be `"14点"`, `"14时"`, `"14:00"`, `"下午 2 点"`, etc. — only a real Chrome session can confirm.

So AC #4 (real-account test, §1.2 / §1.3 / §1.4 / §5) is **explicit post-merge follow-up** — the change CAN merge without §5, but §5 must run BEFORE the next release that advertises "fixed scheduled-publish" in release notes. If §5 surfaces an unexpected hour format, §3.1's RuntimeError ALREADY surfaces the available list to the operator — worst case is loud-failure-on-first-use, NOT silent-random-hour regression.

### D5 (NEW): Tests use `unittest.mock.AsyncMock`, not a real browser

The regression test file `tests/test_baijiahao_set_schedule_time.py` uses `unittest.mock.AsyncMock` for the `page` object rather than a real Playwright session. Three rationale points:

  1. **Speed**: the fix is 5-15 lines of selector code; a 30s browser test per PR is excessive test-suite drag.
  2. **Determinism**: AC #4 is the real-account verification — running the unit test in CI is a regression guard, not the canary.
  3. **CI parallelism**: a Chromium-bearing test would require browser drivers in CI; the existing test suite uses `unittest.mock` exclusively for uploader internals (`tests/test_baijiahao_uploader.py`, `tests/test_douyin_uploader.py`, `tests/test_xiaohongshu_uploader.py`).

**Alternative considered**: spin up a MockPageObject that accepts `.locator(...)` chained selectors. Rejected: `AsyncMock` with `MagicMock` chain-return is industry standard and readable.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Platform's hour option text format changes after the change merges | AC #2 (delete FIXME) + AC #1 (text-selector test) catch the regression; the operator manual test is the canary |
| The new `RuntimeError` for "hour not in list" is too aggressive — some users may want silent fallback | Document the behaviour change in release notes; provide a one-line workaround (`--schedule` to a valid hour) |
| The test suite currently has no baijiahao uploader coverage at all | This change adds the first 3 tests for `set_schedule_time`; future changes can extend to other methods |

## Open Questions

1. **Q1: What is the actual text format of the hour options?** `"14点"`? `"14时"`? `"14:00"`? `"下午 2 点"`? Task 1.2 answers this empirically. The current `publish_date_hour = f'{publish_date.hour}点'` is an assumption.
2. **Q2: Does the platform expose a minute dropdown?** The current code computes `publish_date_min` but never uses it. If yes, wire it through (Task 3.2). If no, remove the dead variable.
3. **Q3: What is the time granularity?** Hour-only? 30-min slots? Custom? Determines whether `publish_date.minute` should be rounded to the nearest valid slot.
4. **Q4: What happens if `publish_date` is in the past?** The platform probably rejects it. The current code does not check. Should this change add a guard, or leave it for the platform to surface? (Deferring — the platform's error message is the operator's primary signal.)
5. **Q5: How stable is the dropdown across regions / account types?** The `cheetah-select-item-option` class is from Ant Design, which Baijiahao's frontend uses. The text format is the more fragile part. A future frontend redesign could break the text-based selector — but breaking `>> text=` is a louder failure than the silent random-hour bug, so the trade-off favours the fix.

## Migration Plan

- This change is small enough to be a single PR.
- PR title suggestion: `fix(baijiahao): replace random-hour selector with text-based click`
- The new test file `tests/test_baijiahao_set_schedule_time.py` is added in the same PR.
- The new manual-test doc `docs/dev/baijiahao-schedule-manual-test-2026q3.md` is added in the same PR.
- Rollback is trivial: revert the PR (one file change in `uploader/baijiahao_uploader/main.py` + the test + the doc).

## References

- Parent change: `openspec/changes/cli-uploader-architecture-consistency` (Phase 3, Task 4.4)
- Buggy code: `uploader/baijiahao_uploader/main.py:BaiJiaHaoVideo.set_schedule_time` (lines ~169-188)
- Working pattern: `uploader/xiaohongshu_uploader/main.py:XiaoHongShuBaseUploader.set_schedule_time_xiaohongshu` (text-based `fill()`)
- Working pattern: `uploader/tencent_uploader/main.py:TencentBaseUploader.set_schedule_time_tencent` (text-based `keyboard.type()`)
