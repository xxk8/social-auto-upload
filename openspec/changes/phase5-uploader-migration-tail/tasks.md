# Tasks — Phase 5: uploader migration tail (TiktokNote + YouTubeVideo)

## 1. TiktokNote class creation (Uploader)

- [ ] 1.1 Add `TiktokNote(BaseVideoUploader)` class to
      `uploader/tk_uploader/main.py` (mirrors `TiktokVideo` deviation
      note — derived class directly sets shared attrs, no
      `super().__init__()`).
- [ ] 1.2 Constructor signature: `__init__(self, *, title, note,
      image_files, tags, publish_date, account_file,
      headless=LOCAL_CHROME_HEADLESS)`. Sets all 7 instance attrs
      directly. `image_files` normalised to `list[str]` for symmetry
      with `BilibiliNote` shape.
- [ ] 1.3 `validate_upload_args` order: title non-empty → note
      non-empty → image_files non-empty → `MAX_IMAGES = 35` cap
      enforced → per-image `self.validate_image_file(p)` (resolves
      to `Path`, normalised back to `str`; matches `BilibiliNote`
      shape) → `self.publish_date =
      self.validate_publish_date(self.publish_date)` (unconditional,
      short-circuits on `0`/`None` per family pattern).
- [ ] 1.4 `upload(self, playwright)` stubbed with
      `raise NotImplementedError("TikTok Photo Post upload not yet
      wired")`. Reason: matches Phase 4 §8.4.3 sub-design-decision on
      TencentNote stub (prevents the test from accidentally driving a
      real TikTok session).
- [ ] 1.5 Add `await self.validate_upload_args()` call at the top of
      `upload()` (matches family contract: validate → run). For the
      stub case this fires BEFORE the `NotImplementedError`, so the
      validator runs first.

## 2. YouTubeVideo `validate_upload_args` (Uploader)

- [ ] 2.1 Add `publish_date=0` keyword arg to `YouTubeVideo.__init__`
      signature (after `playlist=None`; before `visibility="public"`,
      `--backward-compatible — existing callers omit it).
- [ ] 2.2 Set `self.publish_date = publish_date` in `__init__` body.
- [ ] 2.3 Add `validate_upload_args` method: title non-empty →
      `self.file_path = str(self.validate_video_file(self.file_path))` →
      unconditional `self.publish_date =
      self.validate_publish_date(self.publish_date)`.
- [ ] 2.4 Add `await self.validate_upload_args()` call at the top of
      `YouTubeVideo.upload()` (right after Playwright browser launch).
      Behaviour-preserving: existing valid callers default
      `publish_date=0` → validate short-circuits → upload proceeds.
      Behaviour-IMPROVING: invalid callers (missing file / wrong
      extension / past datetime) now fail fast in validate instead of
      getting an obscure Playwright timeout.
- [ ] 2.5 Add `youtube_logger.warning(...)` for non-zero
      `publish_date` in `YouTubeVideo.upload()` (right after
      `validate_upload_args()`). Rationale: YouTube Studio's standard
      browser-automation path does NOT act on `publish_date` (premium/
      audited account required for the schedule UI); the value is
      exposed for spec-parity with the family but silently ignored by
      the body. A loud warning prevents future-maintainer confusion
      ("why isn't my schedule taking effect?"). Matches the
      fail-loud-not-silent family style.
- [ ] 2.6 DO NOT wire `set_schedule_time_youtube` — out of scope.
      YouTube Studio's schedule UI requires premium/audited account.

## 3. Lock-in test (Test)

- [ ] 3.1 Create `tests/test_tiktok_note_uploader.py` mirroring
      `tests/test_bilibili_uploader.py` shape — ONE test function
      `test_validate_upload_args_contract` on a class
      `TiktokNoteValidateUploadArgsTests`.
- [ ] 3.2 2 happy paths:
      * `publish_date=0` → after validate, `self.publish_date == 0`.
      * `publish_date=now+3h` → after validate, `self.publish_date` is
        the original `datetime` (well-formed scheduled post).
- [ ] 3.3 3 sad paths:
      * empty title → `ValueError("TikTok note mode requires title")`.
      * non-existent image path → `FileNotFoundError` (from base's
        `validate_image_file`).
      * past datetime → `ValueError("定时发布时间必须晚于当前时间")`
        (from base's `validate_publish_date`).
- [ ] 3.4 NO `cookie_auth` mock — mirrors BilibiliNote (TiktokNote's
      `validate_upload_args` does not check cookies; that check lives
      in `cli/platforms/tiktok.*` BEFORE the uploader is constructed).
- [ ] 3.5 Verify the test passes
      (`pytest tests/test_tiktok_note_uploader.py::TiktokNoteValidateUploadArgsTests::test_validate_upload_args_contract`).

## 4. Family fingerprint audit (Verification)

- [ ] 4.1 `grep -rn 'def validate_upload_args' uploader/` returns
      ≥ 13 matches (11 prior + TiktokNote + YouTubeVideo).
- [ ] 4.2 `grep -rn 'self.publish_date = self.validate_publish_date(self.publish_date)' uploader/`
      returns ≥ 12 matches (11 prior + TiktokNote; YouTubeVideo sets
      publish_date but the unconditional validate line is callable
      from validate_upload_args — counted once per class via the
      new method).
- [ ] 4.3 `grep -rn 'await self.validate_upload_args' uploader/`
      returns ≥ 6 matches (Baijiahao / Douyin (Video + Note) / Tencent
      (Video + Note) / Bilibili / TiktokNote / YouTube — Phase 4 was
      selective on per-class upload() invocation; Phase 5 brings
      TiktokNote + YouTube up to par).

## 5. Cross-link (Docs)

- [ ] 5.1 Update parent
      `openspec/changes/cli-uploader-architecture-consistency/tasks.md`
      §8.4 to add a §8.4.6 entry:
      "Phase 5 close: TiktokNote (create from scratch +
      validate_upload_args) + YouTubeVideo (add validate_upload_args).
      New ticket: `openspec/changes/phase5-uploader-migration-tail/`.
      Confirms all 13 derived classes are in the family fingerprint
      set."

## 6. Final verification (Pytest + Ruff)

- [ ] 6.1 `pytest tests/test_tiktok_note_uploader.py` PASS.
- [ ] 6.2 `pytest tests/test_bilibili_uploader.py`/
      `test_douyin_uploader.py`/`test_baijiahao_uploader.py`/
      `test_kuaishou_uploader.py`/`test_xiaohongshu_uploader.py`/
      `test_tencent_uploader.py` (Phase 4 regression set) still PASS.
- [ ] 6.3 `ruff check` on `uploader/tk_uploader/main.py` +
      `uploader/youtube_uploader/main.py` +
      `tests/test_tiktok_note_uploader.py` clean.
