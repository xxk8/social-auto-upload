import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import uploader.xiaohongshu_uploader.main as xhs_main


class XiaoHongShuVideoValidateUploadArgsTests(unittest.TestCase):
    def _make(self, **kw):
        """Build a XiaoHongShuVideo with defaults overridden — `def` not `lambda` (ruff E731).

        XiaoHongShuVideo.__init__ signature has 10 args (title / file_path / tags /
        publish_date / account_file / thumbnail_path / desc / publish_strategy /
        debug / headless). The factory only sets the 5 AC-relevant fields; remaining
        default to None / `''` / XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE / DEBUG_MODE /
        LOCAL_CHROME_HEADLESS per the upstream __init__ defaults.
        """
        defaults = dict(title='t', file_path=str(self._video), tags=[], publish_date=0, account_file=str(self._cookie))
        defaults.update(kw)
        return xhs_main.XiaoHongShuVideo(**defaults)

    def test_validate_upload_args_contract(self):
        """Phase 4 §8.6 lock-in (migration of xiaohongshu to shared `BaiJiaHaoVideo.validate_upload_args` pattern).

        Validates XiaoHongShuVideo.validate_upload_args contract unlocked by §8.6:
          * title first → FileNotFoundError if missing file → ValueError if past datetime
          * strategy-conditional publish_date block removed from
            `XiaoHongShuBaseUploader.validate_base_args` — validation is now
            unconditional via `validate_publish_date` at the tail of `validate_upload_args`
            (matches `BaiJiaHaoVideo` / `DouYinVideo` / `KSBaseUploader` shape).
          * `cookie_auth` is mock-patched so validate_upload_args runs without a real browser.
          * Note: `obfuscate_video` is NOT in `validate_upload_args` (it's called later
            in `upload_video_content()` for anti-detect), so no obfuscate mock is needed.
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            self._video = Path(tmp_dir) / 'demo.mp4'
            self._video.write_bytes(b'x')
            self._cookie = Path(tmp_dir) / 'a.json'
            self._cookie.write_text('{}')
            with patch('uploader.xiaohongshu_uploader.main.cookie_auth', new=AsyncMock(return_value=True)):
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
