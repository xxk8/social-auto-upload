# Proposal — Phase 5: uploader migration tail (TiktokNote + YouTubeVideo)

## Why

The `cli-uploader-architecture-consistency` change's §8.4.5 family audit
confirmed 11 derived classes ending with the unconditional
`validate_publish_date` line — but that audit grep only matched classes
**already containing `validate_upload_args`**. Two unfingerprinted
outliers remain:

1. **`TiktokNote`** does not exist in `uploader/tk_uploader/main.py` —
   only `TiktokVideo` ships. The Phase 4 §8.4 per-derived-class
   `validate_upload_args` consolidation pattern applies to a new
   `TiktokNote` to round out TikTok Studio's Photo Post capability, with
   the upload() body stubbed per the Phase 4 §8.4.3 (TencentNote)
   sub-design-decision.

2. **`YouTubeVideo`** (`uploader/youtube_uploader/main.py:185`)
   inherits `BaseVideoUploader` but has **no `validate_upload_args`
   method**. Predicate-conditional checks (`os.path.exists`, `not
   self.title`) are scattered across `upload()` instead. This is the
   §8.4.5 grep's pre-existing miss — the grep caught classes that
   already had a `validate_upload_args` method, not classes that
   *should* have one.

This change ships both migrations so the family pattern reaches 13 of
13 derived classes. `grep -rn 'def validate_upload_args' uploader/`
returns 13.

## What

* Create `TiktokNote(BaseVideoUploader)` in
  `uploader/tk_uploader/main.py` (mirrors `TiktokVideo` deviation
  note + `BilibiliNote` image-validation pattern). `upload()` body
  stubbed with `NotImplementedError` — TikTok Studio's Photo Post UI
  flow is not yet wired through patchright. The pre-flight validator
  IS real (mirrors §8.4.3's TencentNote sub-design-decision:
  validation runs BEFORE the not-yet-implemented upload body, so the
  lock-in test only exercises the real validator).

* Add `validate_upload_args` to `YouTubeVideo` (same Phase 4
  per-derived-class pattern; uses `BaseVideoUploader.validate_video_file`
  + `validate_publish_date`). Add `publish_date=0` keyword arg to
  `__init__` (backward-compatible — existing callers default to 0).
  `YouTubeVideo.upload()` is updated to invoke
  `await self.validate_upload_args()` first (matches the family
  contract: validate → run).

* Lock-in test `tests/test_tiktok_note_uploader.py::test_validate_upload_args_contract`
  mirrors `tests/test_bilibili_uploader.py::test_validate_upload_args_contract`
  shape — 2 happy paths (immediate + scheduled) + 3 sad paths (empty
  title, missing image file, past datetime). NO `cookie_auth` mock
  (TiktokNote's `validate_upload_args` does not check cookies; the
  cookie check lives in `cli/platforms/tiktok.*` BEFORE the uploader
  is constructed — same as `BilibiliNote`).

## Out of scope

* `TiktokNoteUploadRequest` dataclass + dispatcher wiring in
  `cli/models.py` + `cli/dispatchers.py` + `cli/platforms/tiktok.py`
  — Phase 6 (cli-level) migration ticket. This change ships the
  uploader-class migration only.
* `YouTube set_schedule_time` — YouTube Studio's standard browser
  automation path does not expose the schedule UI (premium/audited
  account required). The `publish_date` field is exposed for
  spec-parity with the family; the upload() body still ignores it.
  Future ticket if YouTube's schedule UI becomes viable.

## Cross-ref

Closes `openspec/changes/cli-uploader-architecture-consistency/tasks.md`
§8.4 remaining tail (the §8.4.5 audit's unfingerprinted-outlier gap).
