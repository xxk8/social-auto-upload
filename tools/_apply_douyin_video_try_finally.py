#!/usr/bin/env python3
"""Surgery v3: wrap DouYinVideo.upload in upload_success=False + outer try/finally.

v1 used Python unicode escapes which got truncated at 4 hex digits.
v2 used raw UTF-8 chars, but the docstring itself still contained a backslash-u
sequence in prose that Python 3 parsed as an escape, triggering SyntaxError on
v2's first import. v3 keeps the docstring ASCII-only and constructs any
non-ASCII string content via chr(0x...) so the script source itself never
declares a backslash-u to the Python parser.

Mirrors DouYinNote.upload's pattern: when EDIT 6's patchright-race
`raise` fires, the `finally:` block still runs so
`await context.close()` + `await browser.close()` execute
unconditionally (preventing browser/context leaks — patchright contexts
hold ~50-200 MB each, several races can exhaust file descriptors).

Transformation:
  - Anchor on `class DouYinVideo(DouYinBaseUploader):` + the next
    `async def upload(self, playwright: Playwright) -> None:` (the
    next such def AFTER the class header is unambiguously DouYinVideo.upload).
  - Insert `        upload_success = False` + `        try:` immediately
    before `        page = await context.new_page()`.
  - Re-indent body lines (between the new opener and the trailing
    5-line cleanup block) by adding 4 spaces of leading indent to every
    line.
  - Replace the trailing 5 lines (storage_state + log + sleep + close + close)
    with `            upload_success = True` + `        finally:` +
    `            if upload_success:` + indented storage_state/log/sleep
    + unconditional `            await context.close()` +
    `            await browser.close()`.

The script is conservative: it anchors on text that occurs exactly once
following DouYinVideo's class header, and refuses to write if any anchor
is not found.
"""
import sys

p = "uploader/douyin_uploader/main.py"

with open(p, encoding="utf-8") as f:
    src = f.read()

# ----- Step 1: locate DouYinVideo.upload body -----
class_marker = "\nclass DouYinVideo(DouYinBaseUploader):\n"
idx_class = src.find(class_marker)
if idx_class == -1:
    print("ERROR: class DouYinVideo not found", file=sys.stderr)
    sys.exit(1)

# After DouYinVideo class header, the very next `async def upload(...)`
# is unambiguously DouYinVideo.upload (DouYinNote.upload is in a
# different class and after several intervening methods).
upload_def_marker = "\n    async def upload(self, playwright: Playwright) -> None:\n"
idx_upload_def = src.find(upload_def_marker, idx_class)
if idx_upload_def == -1:
    print("ERROR: DouYinVideo.upload def line not found", file=sys.stderr)
    sys.exit(1)

# The ANCHOR inside DouYinVideo.upload body — a unique string that
# appears ONLY in this method (the comparable DouYinNote variant says
# "检查 cookie、图片和发布时间" without 视频/封面, so "视频文件、封面和发布时间"
# together are unique).
anchor_marker = 'douyin_logger.info(_msg("🧍", "小人先检查 cookie、视频文件、封面和发布时间"))'
idx_anchor = src.find(anchor_marker, idx_upload_def)
if idx_anchor == -1:
    print("ERROR: DouYinVideo.upload anchor body not found", file=sys.stderr)
    sys.exit(1)

# Method body ENDS at the `        await browser.close()` line followed
# by `\n\n    async def douyin_upload_video(self):`.
end_cleanup_marker = "        await browser.close()\n\n    async def douyin_upload_video(self):"
idx_upload_end = src.find(end_cleanup_marker, idx_upload_def)
if idx_upload_end == -1:
    print("ERROR: DouYinVideo.upload end marker not found", file=sys.stderr)
    sys.exit(1)

idx_upload_end_inclusive = idx_upload_end + len("        await browser.close()")

# ----- Step 2: slice the old body (skip the leading \n of upload_def_marker) -----
old_body = src[idx_upload_def + 1 : idx_upload_end_inclusive]
old_lines = old_body.split("\n")
print(f"Old method body: {len(old_lines)} lines")

# ----- Step 3: transform line-by-line -----
new_lines = []
i = 0
reindent_active = False  # becomes True at the page = await context.new_page() marker

while i < len(old_lines):
    line = old_lines[i]
    stripped = line.lstrip() if line else ""

    if not reindent_active:
        if stripped == "page = await context.new_page()":
            # Enter re-indent phase: insert outer try opener + re-indent THIS line.
            new_lines.append("        upload_success = False")
            new_lines.append("        try:")
            new_lines.append("    " + line)  # prepend 4 spaces
            reindent_active = True
            i += 1
            continue
        else:
            new_lines.append(line)
            i += 1
            continue

    # Phase 2 trigger: the trailing 5-line cleanup block.
    if stripped == "await context.storage_state(path=self.account_file)":
        # Emit the new upload_success + finally block, consuming the next 4 lines.
        new_lines.append("            upload_success = True")
        new_lines.append("        finally:")
        new_lines.append("            if upload_success:")
        new_lines.append("                await context.storage_state(path=self.account_file)")
        new_lines.append('                douyin_logger.success(_msg("🥳", "cookie 更新完毕"))')
        new_lines.append("                await asyncio.sleep(2)")
        new_lines.append("            await context.close()")
        new_lines.append("            await browser.close()")
        i += 5  # skip the 5 cleanup lines (storage_state + log + sleep + close + close)
        reindent_active = False  # cleanup consumed; no further re-indent
        continue

    if reindent_active:
        # Body line: re-indent by adding 4 spaces of leading indent.
        if line == "":
            new_lines.append(line)
        else:
            new_lines.append("    " + line)
        i += 1
        continue

    new_lines.append(line)
    i += 1

new_body = "\n".join(new_lines)
print(f"New method body: {len(new_lines)} lines")
print(f"Net change: {len(new_lines) - len(old_lines):+d} lines")

# ----- Step 4: write back -----
new_src = src[: idx_upload_def + 1] + new_body + src[idx_upload_end_inclusive:]

with open(p, "w", encoding="utf-8") as f:
    f.write(new_src)

print(f"Wrote: {p}")
print("OK")
