import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import uploader.baijiahao_uploader.main as bj_main


class BaiJiaHaoVideoValidateUploadArgsTests(unittest.TestCase):
    def _make(self, **kw):
        """Build a BaiJiaHaoVideo with defaults overridden — `def` not `lambda` (ruff E731)."""
        defaults = dict(title='t', file_path=str(self._video), tags=[], publish_date=0, account_file=str(self._cookie))
        defaults.update(kw)
        return bj_main.BaiJiaHaoVideo(**defaults)

    def test_validate_upload_args_contract(self):
        """Phase 3 contract lock-in (reviewer #3 follow-up):

        Happy:
          * publish_date=0 short-circuits (stays 0)
          * publish_date=+3h passes (≥ MIN_SCHEDULE_LEAD_TIME=2h)
        Sad:
          * empty title → ValueError
          * missing file → FileNotFoundError
          * past datetime → ValueError
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            self._video = Path(tmp_dir) / 'demo.mp4'
            self._video.write_bytes(b'x')
            self._cookie = Path(tmp_dir) / 'a.json'
            self._cookie.write_text('{}')
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
