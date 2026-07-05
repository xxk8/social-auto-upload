# TBF-XXX Baijiahao Schedule — Manual Probe Runbook (AC #4)

> Real-account probe procedure for verifying the actual hour-option text format rendered by `baijiahao.baidu.com/builder/rc/edit?type=videoV2`. This gates `openspec/changes/fix-baijiahao-schedule-time/` §1.2 / §1.3 / §1.4 / §5 — i.e., whether the design-D1 fix (`get_by_text(publish_date_hour, exact=True)` with `publish_date_hour = f'{hour}点'`) is correct, OR whether a downstream ticket must be opened to adjust the `publish_date_hour` template.

## Why this exists

The fix landed in commit `(this-PR)` replaces the buggy `target_hour_index = min(publish_date.hour, current_choice_hour - 1)` with a text-based `get_by_text(publish_date_hour, exact=True).click()` (substring-safe against `2点` / `12点` / `22点` collisions). The fix's correctness hinges on **the actual rendered text format** of the platform's hour dropdown.

The unit tests in `tests/test_baijiahao_set_schedule_time.py` (6 tests across 3 classes) can verify the text-based selector pattern lands correctly against the assumption `publish_date_hour = f'{N}点'`. What the unit tests CANNOT verify is the actual rendered text — `"14点"`, `"14时"`, `"14:00"`, `"下午 2 点"`, etc. Only a real Chrome session against a logged-in account can confirm.

This runbook is the explicit AC #4 / §5.x post-merge follow-up the prior openspec tasks.md marked as **"DEFERRED — post-merge"**. The fix is in production code today; running this probe is the final gate before the next release note can advertise "fixed scheduled-publish" for baijiahao.

## Prerequisites

- **Staging 百家号 account** — do NOT use a production publishing account. The probe writes a draft (not a publish) so production account risk is low, but staging discipline keeps the audit trail clean.
- **Local browser session** — headed Chrome with `LOCAL_CHROME_HEADLESS=False` (the project's web runner default is headless; for the probe you want a visible window to inspect dropdowns).
- **`patchright install chromium`** — already loaded if you've run `patchright install chromium` per the project install instructions. Verify: `.venv/bin/python -c "from patchwright.async_api import async_playwright; import asyncio; print(asyncio.run(...).version)"` or just `which chromium`.
- **`.venv/` populated** — `uv pip install -e .` from repo root.
- **`uploader/baijiahao_uploader/main.py::BaiJiaHaoVideo.__init__` signature memorized** — the constructor accepts `(title, file_path, tags, publish_date, account_file, proxy_setting=None)`. The probe creates a stub `BaiJiaHaoVideo` instance to call `set_schedule_time(page, publish_date)` directly; this avoids running the full `upload()` flow.

## What to capture

Three pieces of evidence, in this order:

1. **Day dropdown option text format** (sanity check; not the primary deliverable)
   - Click into the day picker (the first `div.select-wrap`) and capture `all_inner_texts()`.
   - Expected today: `"7月15日"`, `"7月16日"`, ... (the existing design-D1 assumption).

2. **Hour dropdown option text format** (the PRIMARY deliverable)
   - Click into the hour picker (the second `div.select-wrap`) and capture `all_inner_texts()`.
   - **THIS IS THE AC #4 ANSWER.** Three possible outcomes:
     - **A.** Text is exactly `"8点"`, `"9点"`, ..., `"22点"` (matches the design-D1 `{N}点` assumption) → probe succeeds, ticket closes.
     - **B.** Text is `"8时"`, `"9时"`, ... → format-mismatch; open downstream ticket.
     - **C.** Text is `"上午 8:00"`, `"下午 2:00"`, ... or `"8:00"`, `"14:00"` → format-mismatch with non-trivial template; open downstream ticket with a higher resolution scope.

3. **Minute granularity** (the secondary deliverable)
   - Inspect whether the hour dropdown also exposes minute-level slots (e.g. `"8:00"`, `"8:30"`, `"9:00"`). If yes, also capture the `all_inner_texts()` of the minute sub-list.
   - If no minute granularity, just record `none` for the minute field.

The probe result file lives at `openspec/changes/fix-baijiahao-schedule-time/_probes/<date-utc>.md` — see the template there. Use today's UTC date (e.g. `2026-07-02.md`).

## Procedure

### Step 1 — Log into staging baijiahao (manual step, NOT automatable)

Open `https://baijiahao.baidu.com/builder/theme/bjh/login` in your local Chrome. Scan the QR code with the Baidu app on the staging-account phone. Wait until `baijiahao.baidu.com/builder/rc/home` loads (logged-in dashboard).

> **Why this step is manual**: the QR-code scan requires a physical phone. Don't try to drive past the login page via `browser-use` or scripted patching — you'll just hit the login surface and not the publish UI.

### Step 2 — Navigate to the video-publish UI

```bash
# Open the video-V2 publish page directly:
# https://baijiahao.baidu.com/builder/rc/edit?type=videoV2
```

Wait until the form loads (`div#formMain` becomes visible).

### Step 3 — Fill the title (stub value) and upload any small video file

The probe does NOT need a real publish; just enough to expose the "定时发布" button at the bottom of the form.

- Title: any 8-char non-empty string (e.g. `__probe__`).
- File: any 1-second MP4 / any supported video extension.
- Tags: leave empty (not required).
- Cover: skip (auto-generated).

### Step 4 — Click "定时发布" to expose the day + hour dropdowns

The button is `div.op-btn-outter-content >> text=定时发布` → its parent `button`. Click it; the right-side modal panel opens with day + hour dropdowns.

### Step 5 — Capture the day dropdown options (sanity check)

Open Chrome DevTools (F12) → Console tab. Run:

```js
document.querySelectorAll('div.rc-virtual-list div.cheetah-select-item').forEach(el => console.log(el.innerText))
```

or if you have Playwright DevTools:

```python
# In a Python REPL with .venv active:
import asyncio
from patchright.async_api import async_playwright

async def capture_day_options():
    async with async_playwright() as p:
        # Use a NEW context that inherits the dev-tools session cookies — easiest is:
        # 1. Save your logged-in storage_state.json from Chrome DevTools → Application → Cookies → copy as JSON
        # 2. Or just use the developer's interactive session via patchright.connect_over_cdp
        browser = await p.chromium.launch(headless=False)
        # ... connect to your existing Chrome session ...
        # page = await context.new_page()
        # ... navigate, click day dropdown, await locator chain ...
        text_list = await page.locator('div.rc-virtual-list div.cheetah-select-item').all_inner_texts()
        print('DAY_OPTIONS:', text_list)

asyncio.run(capture_day_options())
```

Expected today: `['7月15日', '7月16日', '7月17日', ...]` (today's date + next 6 days).

Paste output into the probe file's `## Day dropdown capture` section.

### Step 6 — Capture the hour dropdown options (PRIMARY)

After step 4, click the second `div.select-wrap` (the hour dropdown). Run:

```js
document.querySelectorAll('div.rc-virtual-list div.cheetah-select-item-option').forEach(el => console.log(el.innerText))
```

Paste output into the probe file's `## Hour dropdown capture` section.

> **Important distinction**: `div.cheetah-select-item` (the day list vs class) vs `div.cheetah-select-item-option` (the hour list extra class). Both selectors are exercised by the fix — day uses `cheetah-select-item`, hour uses `cheetah-select-item-option`. The probe should capture BOTH.

### Step 7 — Decide minute granularity

Inspect the hour dropdown's option list. If the elements look like `"8:00"`, `"8:30"`, `"9:00"`, etc., minute granularity is exposed. Capture the minute sub-list and paste into the probe file's `## Minute granularity` section.

If the elements look like `"8点"`, `"9点"`, etc., no minute granularity — record `none`.

### Step 8 — Close the dropdown (manual)

Press Esc or click outside the dropdown. **Do NOT click "定时发布" submit** — the probe does not need to commit a publish; we just needed to read the dropdown rendering.

### Step 9 — Fill in the probe result file

Open `openspec/changes/fix-baijiahao-schedule-time/_probes/2026-07-02.md` (today's UTC date) and replace the `PLACEHOLDER` slots with the captured outputs. Fill in the **Decision block** at the bottom:

| Captured format | Decision |
|---|---|
| Day: `7月15日`, ..., Hour: `8点`, `9点`, ... (matches `{N}点`) | **CLOSE-OK** — design D1 stands; PR can release without further work. |
| Hour: `8时`, `9时`, ... (any `{N}时` variant) | **OPEN-DOWNSTREAM-TICKET-SIMPLE** — template change `f'{N}点'` → `f'{N}时'`; safe fix scope. |
| Hour: `8:00`, `9:00`, ... (HH:MM format) | **OPEN-DOWNSTREAM-TICKET-MEDIUM** — template change to `f'{H:02d}:00'` AND minute dropdown needs new wire-up; bigger scope. |
| Hour: `上午 8:00`, `下午 2:00`, ... (with 上午/下午 prefix) | **OPEN-DOWNSTREAM-TICKET-COMPLEX** — needs AM/PM parsing logic OR operator-side UI hint; design decision needed. |

### Step 10 — Update the openspec tasks.md

Open `openspec/changes/fix-baijiahao-schedule-time/tasks.md` and:

- If decision is CLOSE-OK: mark §5.1, §5.2, §5.3 all complete (`[x]`). The probe is the final AC #4 close-out.
- If decision is OPEN-DOWNSTREAM: leave §5.1 / §5.2 marked complete, leave §5.3 pending with a reference to the new ticket.

## What to do if format-mismatch is discovered

> **Do NOT immediately open a code patch.** The audit trail matters: this probe file is the source-of-truth evidence that the design-D1 fix is wrong.

1. **Open a downstream openspec ticket** at `openspec/changes/<descriptive-name>/` with:
   - `proposal.md`: cite the probe file + the observed format
   - `design.md`: explain the format-mismatch root cause + remediation options
   - `tasks.md`: sketch the template change + the minute wire-up (if applicable)
2. **Title format**: `fix(baijiahao): adjust publish_date_hour template after AC#4 probe revealed {N}时 format`
3. **PR scope**: ONLY the `publish_date_hour` line in `uploader/baijiahao_uploader/main.py:BaiJiaHaoVideo.set_schedule_time` + the symmetric test in `tests/test_baijiahao_set_schedule_time.py` (additional hour-value cases for the new format).

## Cross-references

- `uploader/baijiahao_uploader/main.py::BaiJiaHaoVideo.set_schedule_time` — the fix's runtime selector call.
- `uploader/baijiahao_uploader/main.py::BaiJiaHaoVideo.validate_upload_args` — Phase 3 contract unblock for `validate_publish_date` (independent of AC#4; already covered by `tests/test_baijiahao_uploader.py`).
- `tests/test_baijiahao_set_schedule_time.py` — 6 regression tests pinning `'14点'` / `'2点'` / `'0点'` selector patterns.
- `openspec/changes/fix-baijiahao-schedule-time/proposal.md` — bug rationale + AC list (AC #4 is this probe).
- `openspec/changes/fix-baijiahao-schedule-time/design.md` — D1 amended to `get_by_text(exact=True)` (substring-safe rationale).
- `openspec/changes/fix-baijiahao-schedule-time/design.md#d2` — D2 RuntimeError contract that surfaces the `available` list when the requested hour is missing.
- `openspec/changes/fix-baijiahao-schedule-time/tasks.md §5` — the post-merge follow-up this runbook closes.
- `openspec/changes/fix-baijiahao-schedule-time/_probes/<utc-date>.md` — probe-result template (this runbook).
- `docs/dev/INDEX.md#operators` — Operators hub; this runbook is one of the post-merge gates.
- **Discoverability**: kebab-case + H2-sectioned; matches `docs/dev/monitor-cdp-throttling-cron-ops.md` convention (an Operator runbook pattern already in production use).
