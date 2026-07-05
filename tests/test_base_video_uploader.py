import unittest
from datetime import datetime, timedelta, timezone

from uploader.base_video import BaseVideoUploader


class ValidatePublishDateHardeningTests(unittest.TestCase):
    def test_validate_publish_date_contract(self):
        """Pin the base contract shared by all 7 platforms (Phase 4 §8.1 migrated Douyin, future migrations follow).

        Coverage:
          * 0 / None                              -> 0 (short-circuit, immediate publish)
          * now + timedelta(hours=3) naive        -> returned unchanged (well past lead-time)
          * now UTC + timedelta(hours=3) tz-aware -> returned unchanged (validator uses publish_date.tzinfo)
          * exactly-now                           -> ValueError ("必须晚于当前时间") — FIRST branch
          * now + MIN_SCHEDULE_LEAD_TIME (2h)     -> ValueError ("必须大于当前时间 2 小时") — SECOND boundary (lead-time edge)
          * int 5 / str                           -> TypeError (sentinels for non-(None|0|datetime) input)

        Boundary technique: capture `now_ref` once per assertion, let the validator's own
        `datetime.now(...)` advance by microseconds inside the call. The `<=` predicate
        still fires because `now_ref + delta <= now_ref + delta + epsilon`. No time-mocking.
        The regex pins distinguish the FIRST (≤ now) branch from the SECOND (≤ now+2h)
        boundary — e.g., a future refactor deleting the FIRST check would let `now_ref`
        pass through to the SECOND and raise the LEAD-TIME message, breaking the regex.
        """
        # Short-circuit (0 / None -> 0)
        self.assertEqual(BaseVideoUploader.validate_publish_date(0), 0)
        self.assertEqual(BaseVideoUploader.validate_publish_date(None), 0)
        # Happy: future +3h naive (≥ lead-time) returned unchanged
        future_naive = datetime.now() + timedelta(hours=3)
        self.assertEqual(BaseVideoUploader.validate_publish_date(future_naive), future_naive)
        # Happy: TZ-aware UTC +3h returned unchanged (validator branches on publish_date.tzinfo)
        future_tz = datetime.now(timezone.utc) + timedelta(hours=3)
        self.assertEqual(BaseVideoUploader.validate_publish_date(future_tz), future_tz)
        # Boundary: exactly-now (FIRST branch) + now+2h lead-time edge (SECOND branch).
        # Regex pins discriminate the two error messages — protects against FUTURE
        # refactors that delete either branch.
        now_ref = datetime.now()
        self.assertRaisesRegex(ValueError, '晚于当前时间', lambda: BaseVideoUploader.validate_publish_date(now_ref))
        self.assertRaisesRegex(ValueError, '2 小时', lambda: BaseVideoUploader.validate_publish_date(now_ref + timedelta(hours=2)))
        # TypeError sentinels: anything non-(None|0|datetime) raises TypeError
        self.assertRaises(TypeError, lambda: BaseVideoUploader.validate_publish_date(5))
        self.assertRaises(TypeError, lambda: BaseVideoUploader.validate_publish_date('2026-07-02'))


if __name__ == '__main__':
    unittest.main()
