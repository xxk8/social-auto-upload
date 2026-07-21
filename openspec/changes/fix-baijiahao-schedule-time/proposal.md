## Why

`uploader/baijiahao_uploader/main.py:BaiJiaHaoVideo.set_schedule_time` has a known bug: the hour VALUE (e.g., 14 for 2pm) is used as an INDEX into the platform's hour dropdown, picking a random available hour instead of the requested one. The original inline TODO says:

> `todo 时间选择，日后在处理 百家号的时间选择不准确，目前是随机`

The buggy line is:

```python
target_hour_index = min(publish_date.hour, current_choice_hour - 1)
await page.locator('div.rc-virtual-list:visible div.cheetah-select-item-option').nth(target_hour_index).click()
```

The `min(..., current_choice_hour - 1)` clamp exists to prevent an IndexError when the dropdown has fewer than 24 entries (e.g., 7 available slots) — but the side effect is that the picked hour is then random within the available list, not the one the user requested.

The same function correctly uses text-based selection for the DAY (`>> text={publish_date_day}`); only the HOUR selection is broken. The day-selection pattern is the right fix shape for the hour.

This bug was deliberately **annotated but not fixed** in `openspec/changes/cli-uploader-architecture-consistency` per design.md D4 ("本 change 只加 `# FIXME(known-bug)` 注释,不在本次修"). This change is the explicit follow-up ticket D4 promised.

## What Changes

- **Replace the index-based hour click with a text-based click**, mirroring the existing day-selection pattern:
  ```python
  await page.locator(f'div.rc-virtual-list:visible div.cheetah-select-item-option >> text={publish_date_hour}').first.click()
  ```
- **Verify the hour option text format** (`"14点"` / `"14时"` / `"14:00"` / `"下午 2 点"`) against a real account in a real Chrome instance before merging — see `design.md` open questions.
- **Handle the edge case** where the requested hour is not in the platform's available list: raise a clear `RuntimeError` (don't silently pick a random hour).
- **Add minute selection** that the current code computes but never uses (`publish_date_min` is dead today). Either wire it through the second dropdown (if the platform supports it) or remove the dead variable.
- **Replace the `# FIXME(known-bug)` annotation** added in the parent change with a real implementation; do not leave the FIXME in place.
- **Add a regression test** that fails if anyone reverts to the index-based pattern.

## Capabilities

### Modified Capabilities

- `uploader-base-architecture` (parent change): the FIXME annotation added in `BaiJiaHaoVideo.set_schedule_time` is replaced with the real fix; no other architectural surface changes.

## Impact

- **Uploader**: `uploader/baijiahao_uploader/main.py` (the `set_schedule_time` method only — 5-15 lines of change)
- **CLI**: no change (the CLI correctly passes `publish_date` to the uploader; the bug is in the uploader's selector, not the CLI)
- **Web API**: no change
- **Frontend**: no change
- **Database**: no change
- **Tests**: NEW `tests/test_baijiahao_set_schedule_time.py` — unit test with a fake `Page` to lock in the text-based selector pattern (since the real baijiahao uploader has zero test coverage today, this is also a coverage increase for the parent change's Phase 3 migration)

## Acceptance Criteria

1. **AC #1 — text-based selector verified**: `BaiJiaHaoVideo.set_schedule_time` calls `page.locator(... >> text=... )` to find the hour option, NOT `.nth(<index>)`. A new unit test (`tests/test_baijiahao_set_schedule_time.py::test_set_schedule_time_uses_text_selector_not_index`) fails if the `.nth(...)` pattern reappears.
2. **AC #2 — FIXME annotation removed**: the `# FIXME(known-bug): 百家号时间选择不准确,目前是随机` comment (added in parent change Task 4.4) is deleted; the inline docstring on `set_schedule_time` reflects the new behaviour.
3. **AC #3 — edge cases raise clear errors**: when the requested hour is not in the available list (e.g., user requested 3am but platform only allows 8-22), the function raises `RuntimeError(f"百家号定时发布小时 {publish_date.hour} 不在可发布小时列表 {available_hours} 中")` instead of silently picking a random hour.
4. **AC #4 — manual real-account test passes**: an operator with a real baijiahao account runs `sau baijiahao upload-video --account X --file Y --title Z --schedule 2099-12-31 14:30` and observes the scheduled time on baijiahao.baidu.com is **14:30** (not random). Documented in `docs/dev/baijiahao-schedule-manual-test-2026q3.md` (a new file in this change).
5. **AC #5 — no regression in parent change**: the parent change's AC #1 (byte-for-byte CLI surface) and AC #5 (`pytest tests/` 全绿) remain green after this change merges.

## Out of Scope

- **Tencent / Xiaohongshu scheduled-publish bugs** (if any) — those have working text-based selectors already (see `uploader/xiaohongshu_uploader/main.py:set_schedule_time_xiaohongshu` and `uploader/tencent_uploader/main.py:set_schedule_time_tencent` for the working patterns this change mirrors).
- **BaiJiaHaoVideo `ai2video` experimental feature** — unrelated and out of scope per parent change Non-Goals.
- **Refactoring `set_schedule_time` to use `BaseVideoUploader.validate_publish_date`** — that's a Phase 3 of the parent change; not a schedule-time bug fix.
