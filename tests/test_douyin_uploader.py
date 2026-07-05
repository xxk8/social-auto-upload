import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import uploader.douyin_uploader.main as dy_main


class DouYinVideoValidateUploadArgsTests(unittest.TestCase):
    def _make(self, **kw):
        """Build a DouYinVideo with defaults overridden — `def` not `lambda` (ruff E731).

        DouYinVideo.__init__ widens later args (thumbnails, product_link, desc, ...) — the
        factory only sets the 5 AC-relevant fields; remaining default to None / "" /
        DOUYIN_PUBLISH_STRATEGY_IMMEDIATE per the upstream __init__ signature.
        """
        defaults = dict(title='t', file_path=str(self._video), tags=[], publish_date=0, account_file=str(self._cookie))
        defaults.update(kw)
        return dy_main.DouYinVideo(**defaults)

    def test_validate_upload_args_contract(self):
        """Phase 4 lock-in (douyin migration to shared baijiahao pattern, audit §7 round-trip).

        Validates DouYinVideo.validate_upload_args contract unlocked by §8.1:
          * title first → FileNotFoundError if missing file → ValueError if past datetime
          * publish_date validation is now UNCONDITIONAL (replacing the prior
            strategy-conditional block in DouYinBaseUploader.validate_base_args).
          * cookie_auth + obfuscate_video are mock-patched so validate_upload_args
            runs without a real browser or anti-detect.
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            self._video = Path(tmp_dir) / 'demo.mp4'
            self._video.write_bytes(b'x')
            self._cookie = Path(tmp_dir) / 'a.json'
            self._cookie.write_text('{}')
            no_obf = Path(tmp_dir) / 'no-such.obf.mp4'
            with patch('uploader.douyin_uploader.main.cookie_auth', new=AsyncMock(return_value=True)), patch('uploader.douyin_uploader.main.obfuscate_video', return_value=no_obf):
                a = self._make()
                asyncio.run(a.validate_upload_args())
                self.assertEqual(a.publish_date, 0)
                future = datetime.now() + timedelta(hours=3)
                a = self._make(publish_date=future)
                asyncio.run(a.validate_upload_args())
                self.assertEqual(a.publish_date, future)
                self.assertRaises(ValueError, lambda: asyncio.run(self._make(title='').validate_upload_args()))
                self.assertRaises(FileNotFoundError, lambda: asyncio.run(self._make(file_path='/no/such.mp4').validate_upload_args()))
                self.assertRaises(ValueError, lambda: asyncio.run(self._make(publish_date=datetime.now() - timedelta(minutes=1)).validate_upload_args()))


if __name__ == '__main__':
    unittest.main()
