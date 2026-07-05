import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import uploader.tk_uploader.main as tk_main


class TiktokNoteValidateUploadArgsTests(unittest.TestCase):
    def _make(self, **kw):
        """Build a TiktokNote with defaults overridden — `def` not `lambda` (ruff E731).

        TiktokNote.__init__ signature has 5 kw-only args (title, note,
        image_files, tags, publish_date, account_file, headless); the
        factory only sets the 6 AC-relevant fields. `headless` defaults
        to `LOCAL_CHROME_HEADLESS` per the upstream signature.

        Note: NO `cookie_auth` mock — TiktokNote's validate_upload_args
        does not check cookies (mirrors the bilibili Note shape: the
        cookie check lives in `cli/platforms/tiktok.*` BEFORE the
        uploader is constructed).
        """
        defaults = dict(
            title='t',
            note='n',
            image_files=[str(self._image)],
            tags=[],
            publish_date=0,
            account_file=str(self._cookie),
        )
        defaults.update(kw)
        return tk_main.TiktokNote(**defaults)

    def test_validate_upload_args_contract(self):
        """Phase 5 lock-in (TiktokNote migration to shared `BilibiliNote.validate_upload_args` pattern).

        Validates TiktokNote.validate_upload_args contract after Phase 5
        migration to BaseVideoUploader inheritance + consolidated use of
        base's `validate_image_file` / `validate_publish_date`:
          * title-required, note-required, image-required are the
            type-specific guards
          * per-image validation uses the consolidated
            `BaseVideoUploader.validate_image_file` (cross-platform
            SUPPORTED_IMAGE_EXTENSIONS)
          * publish_date validation is now UNCONDITIONAL via
            `base.validate_publish_date` (matches the rest of the family
            — the prior TiktokVideo shape already used this pattern; the
            new TiktokNote inherits it).

        Order matches the shared pattern (mirrors `BilibiliNote`):
          title → note → image_files non-empty → per-image validate →
          validate_publish_date.
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            self._image = Path(tmp_dir) / 'demo.jpg'
            self._image.write_bytes(b'x')
            self._cookie = Path(tmp_dir) / 'a.json'
            self._cookie.write_text('{}')

            # 2 happy paths
            n = self._make()
            asyncio.run(n.validate_upload_args())
            self.assertEqual(n.publish_date, 0)
            future = datetime.now() + timedelta(hours=3)
            n = self._make(publish_date=future)
            asyncio.run(n.validate_upload_args())
            self.assertEqual(n.publish_date, future)

            # 4 sad paths (note: BilibiliNote's test has 3; the extra
            # ``note=''`` check is added here to lock in the TikTok-
            # specific non-empty-note guard which is NOT mirrored in
            # bilibili's test — that asymmetry was a coverage gap.)
            self.assertRaises(
                ValueError,
                lambda: asyncio.run(self._make(title='').validate_upload_args()),
            )
            self.assertRaises(
                ValueError,
                lambda: asyncio.run(self._make(note='').validate_upload_args()),
            )
            self.assertRaises(
                FileNotFoundError,
                lambda: asyncio.run(
                    self._make(image_files=['/no/such.jpg']).validate_upload_args()
                ),
            )
            self.assertRaises(
                ValueError,
                lambda: asyncio.run(
                    self._make(publish_date=datetime.now() - timedelta(minutes=1)).validate_upload_args()
                ),
            )


if __name__ == '__main__':
    unittest.main()
