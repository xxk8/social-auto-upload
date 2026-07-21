import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import uploader.bilibili_uploader.note as bnote


class BilibiliNoteValidateUploadArgsTests(unittest.TestCase):
    def _make(self, **kw):
        """Build a BilibiliNote with defaults overridden — `def` not `lambda` (ruff E731).

        BilibiliNote.__init__ signature has 8 args; the factory only sets the 5
        AC-relevant fields. Remaining default to ``''`` / ``[]`` /
        ``BILIBILI_NOTE_PUBLISH_STRATEGY_IMMEDIATE`` / ``DEBUG_MODE=False`` /
        ``LOCAL_CHROME_HEADLESS=True`` per the upstream __init__ defaults.

        Note: NO `cookie_auth` mock — bilibili Note's validate_upload_args does
        not check cookies (mirrors the baijiahao shape: cookie validation
        lives in `cli/platforms/bilibili.upload_note` BEFORE constructing
        the uploader class).
        """
        defaults = dict(image_paths=[], title='t', note='n', tags=[], publish_date=0, account_file=str(self._cookie))
        defaults.update(kw)
        return bnote.BilibiliNote(**defaults)

    def test_validate_upload_args_contract(self):
        """Phase 4 §8.5 lock-in (migration of bilibili Note to shared `BaiJiaHaoVideo.validate_upload_args` pattern).

        Validates BilibiliNote.validate_upload_args contract after migration to BaseVideoUploader
        inheritance + consolidated use of base's validate_image_file / validate_publish_date:
          * MAX_IMAGES = 20 enforced BEFORE per-image normalisation (fail fast on shape)
          * title-required, image-required, max-images = the type-specific guards
          * publish_date validation is now UNCONDITIONAL via base.validate_publish_date
            (replacing the prior ad-hoc `publish_date not in (None, 0) and (not isinstance(...))`
            check that lacked past-date enforcement + the 0-short-circuit).
          * The order: title → image_paths → MAX_IMAGES → per-image validate → validate_publish_date
            matches the DouYin / Kuaishou / XHS / Tencent shared pattern.
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            self._video = Path(tmp_dir) / 'demo.jpg'
            self._video.write_bytes(b'x')
            self._cookie = Path(tmp_dir) / 'a.json'
            self._cookie.write_text('{}')
            # 2 happy paths
            n = self._make(image_paths=[str(self._video)])
            asyncio.run(n.validate_upload_args())
            self.assertEqual(n.publish_date, 0)
            future = datetime.now() + timedelta(hours=3)
            n = self._make(image_paths=[str(self._video)], publish_date=future)
            asyncio.run(n.validate_upload_args())
            self.assertEqual(n.publish_date, future)
            # 3 sad paths
            self.assertRaises(ValueError, lambda: asyncio.run(self._make(image_paths=[str(self._video)], title='').validate_upload_args()))
            self.assertRaises(FileNotFoundError, lambda: asyncio.run(self._make(image_paths=['/no/such.jpg']).validate_upload_args()))
            self.assertRaises(ValueError, lambda: asyncio.run(self._make(image_paths=[str(self._video)], publish_date=datetime.now() - timedelta(minutes=1)).validate_upload_args()))


if __name__ == '__main__':
    unittest.main()
