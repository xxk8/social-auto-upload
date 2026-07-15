# -*- coding: utf-8 -*-
"""Apply 3 surgical edits to uploader/douyin_uploader/main.py.

Fix scope:
  EDIT 1: Strategy 3 CDP-screenshot-fallback block + final fallback line ->
          return "" + a brief English-language comment about why.
  EDIT 2: page.screenshot debug call inside DouYinVideo.upload publish-retry
          loop -> a one-line English-language "screen capture disabled" comment.
  EDIT 3: _cdp_capture_screenshot docstring -> prepend a brief
          DEPRECATED-FOR-QR-EXTRACTION note.

The script is ASCII-only in source so Python's parser doesn't trip on
smart-quotes / smart-dashes that might appear in the comments of the
target file. Run with:
    .venv/bin/python tools/_apply_douyin_qr_fix.py
Verify with:
    .venv/bin/python -m py_compile uploader/douyin_uploader/main.py
"""
import sys

PATH = "uploader/douyin_uploader/main.py"
with open(PATH, encoding="utf-8") as f:
    src = f.read()
print(f"loaded {len(src)} bytes from {PATH}")


# ---- EDIT 1: Strategy 3 CDP-screenshot-fallback block + final-fallback line -> return "" + comment ----
# Anchors:
#   START  = the unique `# Strategy 3: CDP-level screenshot fallback` comment
#   END    = the unique single-line `    return await _cdp_capture_screenshot(page)\n`
#            (the inner multi-line `return await _cdp_capture_screenshot(\n    page,\n    clip={...}, ...)`
#            does NOT match `(page)` because of the newline in there)
START1 = "    # Strategy 3: CDP-level screenshot fallback"
END1 = "    return await _cdp_capture_screenshot(page)\n"

i = src.find(START1)
if i < 0:
    print("FATAL EDIT 1: start anchor missing (Strategy 3 comment). Aborting without write.", file=sys.stderr)
    sys.exit(1)
j = src.find(END1, i)
if j < 0:
    print("FATAL EDIT 1: end anchor missing (single-line _cdp_capture_screenshot call). Aborting without write.", file=sys.stderr)
    sys.exit(1)
j_end = j + len(END1)

NEW1 = (
    "    # Strategy 3 removed: CDP-screenshot-fallback was unreliable for QR extraction.\n"
    "    # Modal bbox often missed the rendered QR because of async-render timing +\n"
    "    # browser zoom + modal-shift animations in Douyin 2026 (user feedback\n"
    "    # 2026-06-29: screen capture is not accurate). The QR capture hierarchy is\n"
    "    # now Strategy 0 (network interception of get_qrcode) and Strategy 1 (DOM\n"
    "    # polling for data:image img). The preserved _cdp_capture_screenshot helper\n"
    "    # below is a future-use building block; nothing currently calls it.\n"
    "    return \"\"\n"
)
src = src[:i] + NEW1 + src[j_end:]
print(f"EDIT 1: replaced {j_end - i} chars with {len(NEW1)} chars")


# ---- EDIT 2: page.screenshot debug call -> comment-only ----
OLD2 = "                if self.debug:\n                    await page.screenshot(full_page=True)\n"
NEW2 = "                # Screen capture disabled 2026-06-29 (not accurate per user feedback).\n"
if OLD2 in src:
    src = src.replace(OLD2, NEW2)
    print(f"EDIT 2: replaced {len(OLD2)} chars with {len(NEW2)} chars")
else:
    print("WARN EDIT 2: anchor not found; skip.", file=sys.stderr)


# ---- EDIT 3: _cdp_capture_screenshot docstring -> prepend DEPRECATED note ----
# Anchored on the function signature line + the opening docstring line.
OLD3 = 'async def _cdp_capture_screenshot(page: Page, clip: dict | None = None, capture_beyond_viewport: bool = False) -> str:\n    """Capture at CDP level (Page.captureScreenshot), returning a data: URL.'
NEW3 = (
    'async def _cdp_capture_screenshot(page: Page, clip: dict | None = None, capture_beyond_viewport: bool = False) -> str:\n'
    '    """Capture at CDP level (Page.captureScreenshot), returning a data: URL.\n'
    '\n'
    '    DEPRECATED-FOR-QR-EXTRACTION (2026-06-29): no longer called by\n'
    '    `_extract_douyin_qrcode_src`. The Strategy 3 CDP-screenshot-fallback was\n'
    '    removed because modal bbox often missed the rendered QR (browser zoom +\n'
    '    modal-shift animations + async-render timing). Preserved as a future-use\n'
    '    building block for CDP capture (debug dumps, content-upload page diff\n'
    '    snapshots). DOM extraction + network interception are preferred for new\n'
    '    QR-scrapes.'
)
if OLD3 in src:
    src = src.replace(OLD3, NEW3)
    print(f"EDIT 3: prepended DEPRECATED-FOR-QR note ({len(OLD3)} -> {len(NEW3)} chars)")
else:
    print("WARN EDIT 3: anchor not found; skip.", file=sys.stderr)


with open(PATH, "w", encoding="utf-8") as f:
    f.write(src)
print(f"wrote {len(src)} bytes back to {PATH}")
