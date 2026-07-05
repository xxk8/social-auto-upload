# Design — Phase 5: uploader migration tail (TiktokNote + YouTubeVideo)

## §1 Mechanism (matches Phase 4 §8.4 per-derived-class pattern)

Phase 4 §8.4 standardised `validate_upload_args` onto the
per-derived-class surface (NOT the abstract base). Each new class
adds the method ending with the unconditional
`self.publish_date = self.validate_publish_date(self.publish_date)`
line.

This change continues the pattern:

* **TiktokNote** (NEW class) follows `BilibiliNote`'s shape — image
  list is validated via the consolidated
  `BaseVideoUploader.validate_image_file` (cross-platform set of
  `SUPPORTED_IMAGE_EXTENSIONS`).
* **YouTubeVideo** (existing class) follows `TencentVideo`'s shape —
  single file is validated via consolidated
  `BaseVideoUploader.validate_video_file`.

`TiktokNote` is created in a single file alongside `TiktokVideo` to
match the `tencent_uploader/main.py` shape (Video + Note both in
one file). YouTube is video-only per the current platform support
matrix; no YouTubeNote is in scope.

## §2 Cross-cutting consistency with the 11 prior classes

| Class                          | `validate_upload_args`? | image validation | publish_date unconditional? |
|--------------------------------|---|---|---|
| BaiJiaHaoVideo                 | ✓ | n/a | ✓ |
| DouYinVideo                    | ✓ | n/a | ✓ |
| DouYinNote                     | ✓ | ✓ | ✓ |
| KSVideo                        | ✓ | n/a | ✓ |
| KSNote                         | ✓ | ✓ | ✓ |
| XiaoHongShuVideo               | ✓ | n/a | ✓ |
| XiaoHongShuNote                | ✓ | ✓ | ✓ |
| TencentVideo                   | ✓ | n/a | ✓ |
| TencentNote                    | ✓ | ✓ | ✓ |
| BilibiliNote                   | ✓ | ✓ | ✓ |
| TiktokVideo                    | ✓ | n/a | ✓ |
| **TiktokNote** (NEW in P5)     | ✓ | ✓ | ✓ |
| **YouTubeVideo** (added in P5) | ✓ | n/a | ✓ |

13 / 13 derived classes participate in the family fingerprint
post-Phase 5. `grep -rn 'def validate_upload_args' uploader/`
returns 13 matches.

## §3 Decision register

### D3.1 — TiktokNote `upload()` body stubbed

Mirror Phase 4 §8.4.3's TencentNote sub-design-decision:
`validate_upload_args` IS real + tested; `upload()` body is
`raise NotImplementedError(...)` because TikTok Studio's Photo Post UI
flow is not yet wired through patchright. The lock-in test only
exercises the real validator (no real browser session is opened). When
TikTok Photo Post publishing is wired (future ticket), the body is
swapped out without touching the validator.

### D3.1a — TiktokNote.MAX_IMAGES = 35

Per-class cap mirroring `BilibiliNote.MAX_IMAGES = 20` (the §8.4.4
deviation note explicitly: "MAX_IMAGES cap preserved (platform-
specific — base class doesn't track per-platform image limits)"). TikTok
Studio's Photo Post carousel is 35 images as of 2024 (storage-side
limit; the upload UI's hot path is 9 with the rest accessed via a
"see more" affordance). The cap is enforced in `validate_upload_args`
BEFORE the per-image loop so the 36th image fails fast on shape, not
on the 36th individual validation. The `MAX_IMAGES` constant is the
canonical single source of truth for the cap; the test does NOT
exercise it (matching BilibiliNote's test shape — the cap is enforced
but the lock-in test covers a single happy path + 4 sad paths on
title/note/file/publish_date, not on the cap).

### D3.2 — YouTubeVideo exposure of `publish_date` field

YouTube Studio's standard browser automation does not support
scheduled publishing (UI requires premium/audited account). The
`publish_date` field is exposed for spec-parity with the rest of the
family but `upload()` does not act on it. Future ticket: wire
`set_schedule_time_youtube` if YouTube's schedule UI becomes viable.

### D3.3 — `YouTubeVideo.upload()` updated to invoke `validate_upload_args()`

Phase 4 §8.4 family contract is "validate → run". Step 2.4 of tasks.md
adds the call to `upload()`. This is BEHAVIOUR-PRESERVING for existing
valid callers (default `publish_date=0` short-circuits in validate →
upload proceeds). It is BEHAVIOUR-IMPROVING for invalid callers
(missing file / wrong extension / past datetime) — previously these
would fail silently inside Playwright with obscure timeouts; now they
fail fast in `validate_upload_args` with clear messages.

### D3.4 — Test design mirrors BilibiliNote (NO `cookie_auth` mock)

The lock-in test is structurally identical to
`tests/test_bilibili_uploader.py::test_validate_upload_args_contract`.
Rationale for NOT mocking `cookie_auth`: TiktokNote's
`validate_upload_args` does not call `cookie_auth` (it ONLY validates
user-supplied inputs + structural files). The cookie check is at the
CLI dispatch layer (`cli/platforms/tiktok.*` BEFORE the uploader is
constructed). Mirroring BilibiliNote's exact pattern keeps the test
deterministic + browserless.

## §4 Lock-in test shape

`tests/test_tiktok_note_uploader.py::test_validate_upload_args_contract`
mirrors `tests/test_bilibili_uploader.py::test_validate_upload_args_contract`:

* **2 happy paths**:
  * `publish_date=0` → after validate, `self.publish_date == 0`.
  * `publish_date=now+3h` → after validate, `self.publish_date` is
    the original `datetime` (well-formed scheduled post).
* **3 sad paths**:
  * empty title → `ValueError("TikTok note mode requires title")`.
  * non-existent image path → `FileNotFoundError` (from base's
    `validate_image_file`).
  * past datetime → `ValueError("定时发布时间必须晚于当前时间")` (from
    base's `validate_publish_date`).

NO `cookie_auth` mock (TiktokNote's `validate_upload_args` does not
check cookies).

## §5 Audit verification

**Pre-migration**:
```
$ grep -rn 'def validate_upload_args' uploader/ | wc -l
11
```

**Post-migration**:
```
$ grep -rn 'def validate_upload_args' uploader/ | wc -l
13
```

Diff:
* NEW: `uploader/tk_uploader/main.py: TiktokNote`
* NEW: `uploader/youtube_uploader/main.py: YouTubeVideo`

## §6 Caller grep (Phase 5 close confirms §8.4.5 audit alone insufficient)

The §8.4.5 grep was:
```
$ grep -rn 'self.publish_date = self.validate_publish_date(self.publish_date)' uploader/
```

This grep caught only classes that ALREADY had `validate_upload_args`
ending with the unconditional `validate_publish_date` line.
Classes that SHOULD HAVE `validate_upload_args` but didn't (e.g.,
`YouTubeVideo`) were not detected.

Phase 5 introduces a complementary grep as the structural-anchor
audit:
```
$ grep -rn 'def validate_upload_args' uploader/
```

This catches every class that participates in the family
fingerprint, regardless of whether `upload()` invokes it yet.
Cross-checking both greps gives a complete picture.

## §7 Out-of-scope retention rationale

* `TiktokNoteUploadRequest` dataclass + `cli/dispatchers.upload_note_tiktok`
  dispatch — Phase 6 cli-level migration ticket.
* `TiktokNoteUploadRequest` adds `cli/platforms/tiktok.upload_note()`
  routable handler — Phase 6.
* `YouTube set_schedule_time_youtube` — depends on YouTube Studio's
  schedule UI becoming viable; future ticket if applicable.
