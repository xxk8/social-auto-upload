## 1. Investigate the actual hour-option text format (Uploader)

> **Status (2026-07-02): §1.1 done, §1.2 / §1.3 / §1.4 deferred to post-merge §5 (real-account probe, AC #4)**
>
> This change implements the **fix path that does not depend on §1.2/§1.3.** The fix uses
> `get_by_text(publish_date_hour, exact=True)` which Playwright resolves with strict equality
> — IF the platform renders hours as e.g. `"14点"` (matching the assumption in
> `publish_date_hour = f'{publish_date.hour}点'`), the fix is exact-correct. IF the platform
> renders differently (e.g. `"14时"` / `"下午 2 点"` / `"14:00"`), the RuntimeError path from
> §3.1 surfaces the actual `available` list to the operator + logs, which §1.2 captures
> as part of the post-merge probe.

- [x] 1.1 Read the `set_schedule_time` method in `uploader/baijiahao_uploader/main.py` and confirm the bug (index-based `.nth()` instead of text-based `>> text=`).
- [ ] 1.2 Run a real-account probe: open a headed Chrome session against `https://baijiahao.baidu.com/operator/rc/edit?type=videoV2` and inspect the hour dropdown's option text format. Capture the text of the first 5-10 options via `page.locator('div.rc-virtual-list:visible div.cheetah-select-item-option').all_inner_texts()` and paste the result into [`_probes/2026-07-02.md`](./_probes/2026-07-02.md) (probe-result template populated this turn). **DEFERRED to post-merge AC #4 (cross-references: §5.2).**
- [ ] 1.3 Verify whether the platform exposes minute selection as a SECOND dropdown after hour. If yes, capture the option text format for minutes too. **DEFERRED to post-merge AC #4 (cross-references: §5.2).**
- [ ] 1.4 Confirm the bug is reproducible / fix is verified: in a headed session, call `set_schedule_time(page, datetime(2099, 1, 1, 14, 30))` and observe the actually-selected hour. **DEFERRED to post-merge AC #4.**

## 2. Replace index-based click with text-based click (Uploader)

> **Status (2026-07-02): §2.1–§2.4 done.**
>
> Implementation notes on top of the design D1:
>
> - I used `get_by_text(publish_date_hour, exact=True)` instead of the design-original
>   `>> text={publish_date_hour}` constructor + `.first.click()` pattern. Rationale:
>   Playwright's `>> text=` syntax is **substring-match by default**, which would falsely
>   match `"12点"` / `"22点"` when looking for `"2点"`. `get_by_text(..., exact=True)` is
>   the official Playwright API for strict equality and matches the design's INTENT
>   ("mirror the day-selection pattern") without the substring-collision bug. Verified
>   semantics at https://playwright.dev/python/docs/other-locators#text-locator.
> - The fix preserves the `.nth(0)` / `.nth(1)` calls on `div.select-wrap` (the dropdown
>   WRAPPERS, not the options) — those are legitimate and not part of the bug.

- [x] 2.1 Replace the buggy 3-line block in `BaiJiaHaoVideo.set_schedule_time`:
  ```python
  current_choice_hour = await page.locator('...').count()
  target_hour_index = min(publish_date.hour, current_choice_hour - 1)
  await page.locator('...').nth(target_hour_index).click()
  ```
  with the exact-match selector:
  ```python
  await page.locator('div.rc-virtual-list:visible div.cheetah-select-item-option').get_by_text(publish_date_hour, exact=True).click()
  ```
- [x] 2.2 Drop the now-unused `current_choice_hour` count + `target_hour_index` math.
- [x] 2.3 Replace the `# FIXME(known-bug): 百家号时间选择不准确,目前是随机` comment block with a `# FIXED(...)` block (NOT delete it) — keeps the change-trail + AC#4 gating note visible until the real-account probe lands. See `uploader/baijiahao_uploader/main.py` lines ~117-128.
- [x] 2.4 Delete the original docstring "todo 时间选择，日后在处理 百家号的时间选择不准确，目前是随机" — replaced with the `FIXED` block the fix rationale lives in the comment above the method.

## 3. Handle edge cases (Uploader)

> **Status (2026-07-02): §3.1 done. §3.2 resolved per D3 (no minute wire-up pending AC#4). §3.3 deferred.**

- [x] 3.1 When the text-based hour click times out, raise a clear `RuntimeError` with both the requested hour and the available list (queried via `all_inner_texts()`). Implementation wraps the `get_by_text(...).click()` in `try/except (patchright.async_api.Error, OSError, asyncio.TimeoutError)`, dumps `available` from `all_inner_texts()` (with fallback "<unavailable — dropdown may have closed>" on secondary failure), and `raise RuntimeError(...) from exc` so the original Playwright traceback is preserved. Error message format (per design D2): `"百家号定时发布时间选择失败: 用户请求 hour={hour!r}, 当前可见 hour options={available!r}. 原始 playwright error: {exc!r}. 如 hour option 实际渲染格式与 '{hour}' 不符 ..., 需调整 publish_date_hour 模板 — 详见 openspec/changes/fix-baijiahao-schedule-time/ AC #4 真实账号 probe 任务。"` — includes the SHA-stable pointer to the openspec ticket so a future operator seeing this in logs can locate AC#4 immediately.
- [x] 3.2 Per **D3** (see design.md §Decisions): no minute wire-up attempted in this PR. The pre-existing `publish_date_min = f'{publish_date.minute}分'` variable has been **deleted** (it was set but never read); minute-level scheduling is a §5.x follow-up pending the real-account probe confirming whether the platform exposes a minute dropdown.
- [ ] 3.3 Apply the same edge-case logic to the day selection (the existing text-based day click is correct, but a missing-day `RuntimeError` would help users debug schedule times in the past). **DEFERRED** — out of scope for this PR (not in user-supplied ticket spec; the day-string formatting already has `day > 9` guard).

## 4. Add regression test (Test)

> **Status (2026-07-02): §4.1–§4.3 done — see `tests/test_baijiahao_set_schedule_time.py`.**
>
> Tests are unit-level (unittest.mock.AsyncMock for `page`); no browser required.

- [x] 4.1 Created `tests/test_baijiahao_set_schedule_time.py`. First test class (3 cases: `14点` happy / `2点` substring-collision / `0点` boundary) asserts `set_schedule_time` calls `page.locator('div.rc-virtual-list:visible div.cheetah-select-item-option').get_by_text(publish_date_hour, exact=True).click()` — locks the substring-safe selector pattern.
- [x] 4.2 Source-walk test (second class) walks `inspect.getsource(BaiJiaHaoVideo.set_schedule_time)` and fails if `target_hour_index` / `current_choice_hour` appear. Also pins legitimate `.nth(0)` / `.nth(1)` calls on `div.select-wrap` remains (over-deletion guard against future cleanup that drops the dropdown-wrapper clicks).
- [x] 4.3 Edge-case test class (3 cases): (a) text-selector TimeoutError → RuntimeError raised + `'14点'` + `'8点'` (mocked available list) + `'AC #4'` openspec pointer all in the message; (b) `__cause__` is the original playwright TimeoutError (identity, `assertIs`); (c) `all_inner_texts` returns EMPTY list → empty-marker `<empty — dropdown showed no option texts>` surfaces.

## 5. Real-account verification (Manual)

> **Status (2026-07-02): §5.1 SCAFFOLD CREATED (`baijiahao-schedule-manual-test-2026q3.md` + `_probes/2026-07-02.md`); §5.2 / §5.3 PENDING OPERATOR RUN.**
>
> **AC #4 requires staging-account credentials + physical phone for QR scan** — a human operator runs §5.2 against a logged-in staging account; the runbook + probe-cache scaffoldings below cannot substitute for a logged-in session. Procedure: see the linked runbook; once an operator fills in the probe template's Decision block, §5.2 / §5.3 can be marked complete.
>
> The change CAN merge without §5.2, but §5.2 must run BEFORE the next release that
> advertises "fixed scheduled-publish" in release notes. If §5.2 surfaces an unexpected
> hour format (e.g. `"14时"` instead of `"14点"`), §3.1's RuntimeError ALREADY surfaces
> the available list to the operator — so the worst case is loud-failure-on-first-use,
> NOT silent-random-hour regression.

- [x] 5.1 **DONE** (this turn) — Created the runbook [`../../../docs/dev/baijiahao-schedule-manual-test-2026q3.md`](../../../docs/dev/baijiahao-schedule-manual-test-2026q3.md) AND the probe-result template [`./_probes/2026-07-02.md`](./_probes/2026-07-02.md). Both files include `<FILL_IN — ...>` slots and a Decision block; a human operator on a staging account fills them in by running §5.2.
- [ ] 5.2 Run the manual test on a staging account (human operator step, ~10 min). **PENDING** — procedure: [`../../../docs/dev/baijiahao-schedule-manual-test-2026q3.md`](../../../docs/dev/baijiahao-schedule-manual-test-2026q3.md). Capture evidence in [`./_probes/2026-07-02.md`](./_probes/2026-07-02.md).
- [ ] 5.3 Update `proposal.md` AC #4 with the result, and if the actual hour format differs from `"N点"`, open a downstream ticket to adjust `publish_date_hour = ...` template + bump the regression test. **PENDING — conditional on §5.2's Decision block.** The probe-result template's Decision section encodes 4 outcomes (`CLOSE-OK` / `OPEN-DOWNSTREAM-TICKET-SIMPLE` / `-MEDIUM` / `-COMPLEX`); the downstream openspec ticket path is `openspec/changes/<descriptive-name>/` per the runbook step 9.

## 6. Verify parent change ACs still hold (Verification)

> **Status (2026-07-02): §6.1 / §6.2 / §6.3 to be re-run at PR-time. Already-validated locally:**

- [x] 6.1 Pre-merge local run: `.venv/bin/python -m pytest tests/ -q --tb=short` — GREEN for the suites this PR touches. Phase 2/3/4/4.5 + the new `test_baijiahao_set_schedule_time.py` (3 classes) all pass; the 2 pre-existing `test_xiaohongshu_uploader.py::test_video_fill_meta_*` failures + 2 pre-existing `test_structured_log.py` errors are confirmed-unrelated via git stash (independent of this PR's diff).
- [x] 6.2 Pre-merge local run: `.venv/bin/python -m pytest tests/test_baijiahao_uploader.py tests/test_baijiahao_set_schedule_time.py -v` — all pass + ruff clean on the modified/added files.
- [x] 6.3 Pre-merge local sanity: the help text for `cli.main baijiahao upload-video --help` (CLI surface unchanged — fix is pure uploader-internal).

---

## Post-feedback tightening (code-reviewer pass 2 endorsements, retroactively applied 2026-07-02)

> Footnote-style audit trail for incremental work that landed in this PR cycle but was
> not pre-tracked in §3 / §4. Each item is a tiny refinement identified during a
> code-reviewer pass, applied immediately, and recorded here rather than as a `- [x]`
> mid-section insert (which would flatten the forward-progress-log shape `tasks.md`
> conventionally has in this repo).

- **§3.1b** (empty-list guard, code-reviewer Q7): added `available = available or ['<empty — dropdown showed no option texts>']` between the secondary except-branch and the RuntimeError raise — distinguishes "dropdown closed after timeout" from "dropdown queried but yielded no option texts" in the operator-facing RuntimeError message.
- **§4.4** (test-comment tightening, code-reviewer pass 2): dropped the meta-citation "Per code-reviewer Q4:" from the AC #4 pointer assertion comment (rewrote as self-explanatory rename-robustness rationale); dropped the redundant `assertEqual(call_obj.kwargs, {'exact': True})` pin in the `14点` happy-path test (the existing `assert_called_once_with('14点', exact=True)` already pins `exact=True` via positional+keyword comparison).
- **Method docstring restored** in `set_schedule_time` (code-reviewer Q11): added a 4-line docstring replacing the removed `"todo 时间选择..."` placeholder; describes day+hour selection contract + the D2 RuntimeError relationship.
- **§5 disclaimer tightening + §1.2 / §5 cross-link paths fixed** (code-reviewer pass 2): the §5 status block now reads operator-facing ("AC #4 requires staging-account credentials + physical phone for QR scan" — a human operator runs §5.2 against a logged-in staging account) instead of agent-meta; all cross-reference links in §1.2 / §5.1 / §5.2 are now `../../../docs/dev/...` cwd-relative-from-file so they resolve when GitHub renders `tasks.md` from inside the openspec ticket subdir.

---

## Cross-references

- `uploader/baijiahao_uploader/main.py::BaiJiaHaoVideo.set_schedule_time` — the runtime that AC #4's probe must validate.
- `uploader/baijiahao_uploader/main.py::BaiJiaHaoVideo.validate_upload_args` — Phase 3 contract unblock for `validate_publish_date` (independent of AC #4; already covered by `tests/test_baijiahao_uploader.py`).
- `tests/test_baijiahao_set_schedule_time.py` — 6 regression tests (3 classes) pinning the substring-safe selector + D2 RuntimeError contract.
- [`../../../docs/dev/baijiahao-schedule-manual-test-2026q3.md`](../../../docs/dev/baijiahao-schedule-manual-test-2026q3.md) — the manual procedure runbook (operator-facing).
- [`./_probes/2026-07-02.md`](./_probes/2026-07-02.md) — date-stamped probe-result template the operator fills in.
- `./proposal.md` — AC #4 source-of-truth.
- `./design.md` — D1 amended + D2 + D3 + D5 decisions.
- [`../../../docs/dev/INDEX.md#operators`](../../../docs/dev/INDEX.md#operators) — Operators hub; this runbook is one of the post-merge gates.
