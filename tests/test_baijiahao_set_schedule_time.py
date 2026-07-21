import asyncio
import inspect
import re
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import patchright.async_api

from uploader.baijiahao_uploader.main import BaiJiaHaoVideo


class SetScheduleTimeSelectorPatternTests(unittest.TestCase):
    """§4.1 — lock the substring-safe exact-match hour selector.

    Three hour values cover the substring-collision cases that the design-D1
    amendment addresses: `2点` (substring-collides with `12点` / `22点`),
    `14点` (no collision, common case), `0点` (boundary, midnight).
    """

    def _build_mock_page(self, locator_chain_dict):
        """Build an AsyncMock `page` whose `.locator(selector)` returns
        the pre-configured AsyncMock from `locator_chain_dict` keyed by
        selector string.
        """

        async def fake_locator(selector):
            return locator_chain_dict[selector]

        page = MagicMock()
        page.locator.side_effect = fake_locator
        page.wait_for_selector = AsyncMock()
        page.wait_for_timeout = AsyncMock()
        return page

    async def _make_set_schedule_time_under_test(self, page, fake_dt):
        """Build a real `BaiJiaHaoVideo` and invoke `set_schedule_time` once.

        Returning the final locator chain (registered by selector) lets the
        test assert on `mock.click.call_args` and `mock.all_inner_texts.call_count`.
        """
        uploader = BaiJiaHaoVideo.__new__(BaiJiaHaoVideo)
        await uploader.set_schedule_time(page, fake_dt)
        return uploader

    async def test_hour_14_uses_exact_match_text_selector(self):
        """14 has NO substring collision. Locks the canonical happy path."""
        # Locator for div.select-wrap (wrapper, .nth(0) / .nth(1) legitimate)
        # and for the visible options list (where the hour click happens).
        wrap_chain_0 = MagicMock()
        wrap_chain_0.click = AsyncMock()
        wrap_chain_1 = MagicMock()
        wrap_chain_1.click = AsyncMock()
        options_list_chain = MagicMock()

        # The fix path: `get_by_text('14点', exact=True).click()` on options_list_chain.
        # Configure the chain so `options_list_chain.get_by_text('14点', exact=True)`
        # returns an AsyncMock that records the call AND supports `.click()`.
        exact_14_clickable_mock = AsyncMock()
        options_list_chain.get_by_text = MagicMock(
            return_value=exact_14_clickable_mock
        )

        locator_map = {
            'div.select-wrap': wrap_chain_0,  # first .nth(0)
            'div.rc-virtual-list  div.cheetah-select-item': MagicMock(),
            'div.rc-virtual-list:visible div.cheetah-select-item-option': options_list_chain,
            'button >> text=定时发布': MagicMock(),
        }

        # .nth(0) and .nth(1) are wrap chain entries; .nth(0) returns wrap_chain_0,
        # .nth(1) returns wrap_chain_1. Both chains need valid .click().
        side_effect_by_index = {0: wrap_chain_0, 1: wrap_chain_1}

        async def fake_wrap_nth(idx):
            return side_effect_by_index[idx]

        wrap_chain_0.nth.side_effect = fake_wrap_nth
        wrap_chain_1.nth.side_effect = fake_wrap_nth  # should not be called

        page = self._build_mock_page(locator_map)
        # The morning-day selection `>> text=3月15日` is also a substring selector
        # (no collision risk for day since day != day-prefix), so we let it
        # fall through to MagicMock default behavior (click() returns AsyncMock).

        await self._make_set_schedule_time_under_test(
            page, datetime(2099, 3, 15, 14, 30)
        )

        # Pin: get_by_text('14点', exact=True) was called on the options locator.
        # `assert_called_once_with` already pins `exact=True` via positional+keyword
        # comparison; this is the single source of truth for the safe-selector contract.
        options_list_chain.get_by_text.assert_called_once_with('14点', exact=True)
        exact_14_clickable_mock.click.assert_awaited_once()

    async def test_hour_2_uses_exact_match_not_substring(self):
        """`2点` would substring-collide with `12点` / `22点` IF the regression returned
        to `text=2点` (no `exact=True`). This test pins `exact=True` explicitly.
        """
        wrap_chain_0 = MagicMock()
        wrap_chain_0.click = AsyncMock()
        wrap_chain_1 = MagicMock()
        wrap_chain_1.click = AsyncMock()
        options_list_chain = MagicMock()

        exact_2_clickable_mock = AsyncMock()
        options_list_chain.get_by_text = MagicMock(
            return_value=exact_2_clickable_mock
        )

        side_effect_by_index = {0: wrap_chain_0, 1: wrap_chain_1}

        async def fake_wrap_nth(idx):
            return side_effect_by_index[idx]

        wrap_chain_0.nth.side_effect = fake_wrap_nth

        locator_map = {
            'div.select-wrap': wrap_chain_0,
            'div.rc-virtual-list  div.cheetah-select-item': MagicMock(),
            'div.rc-virtual-list:visible div.cheetah-select-item-option': options_list_chain,
            'button >> text=定时发布': MagicMock(),
        }

        page = self._build_mock_page(locator_map)
        await self._make_set_schedule_time_under_test(
            page, datetime(2099, 3, 15, 2, 0)
        )

        options_list_chain.get_by_text.assert_called_once_with('2点', exact=True)
        # CRITICAL pinning: the assertion target ALSO captures call_args,
        # so any future regression to `get_by_text('2点')` (without exact=True)
        # would fail this test loudly because of the second positional/keyword arg.
        call_obj = options_list_chain.get_by_text.call_args
        self.assertEqual(call_obj.kwargs, {'exact': True})
        exact_2_clickable_mock.click.assert_awaited_once()

    async def test_hour_0_midnight_boundary(self):
        """`0点` is the boundary; locks the path works at hour=0 too."""
        wrap_chain_0 = MagicMock()
        wrap_chain_0.click = AsyncMock()
        options_list_chain = MagicMock()

        exact_0_clickable_mock = AsyncMock()
        options_list_chain.get_by_text = MagicMock(
            return_value=exact_0_clickable_mock
        )

        async def fake_wrap_nth(idx):
            return wrap_chain_0

        wrap_chain_0.nth.side_effect = fake_wrap_nth

        locator_map = {
            'div.select-wrap': wrap_chain_0,
            'div.rc-virtual-list  div.cheetah-select-item': MagicMock(),
            'div.rc-virtual-list:visible div.cheetah-select-item-option': options_list_chain,
            'button >> text=定时发布': MagicMock(),
        }

        page = self._build_mock_page(locator_map)
        await self._make_set_schedule_time_under_test(
            page, datetime(2099, 3, 15, 0, 0)
        )

        options_list_chain.get_by_text.assert_called_once_with('0点', exact=True)
        exact_0_clickable_mock.click.assert_awaited_once()


class SetScheduleTimeSourceWalkTest(unittest.TestCase):
    """§4.2 — pin the buggy `.nth(target_hour_index)` pattern out of the source.

    Legitimate `.nth(0)` / `.nth(1)` calls remain (on dropdown WRAPPERS).
    Only `.nth(target_hour_index)` (the OPTS index-as-hour-value bug) is banned.
    """

    def test_set_schedule_time_does_not_use_target_hour_index(self):
        source = inspect.getsource(BaiJiaHaoVideo.set_schedule_time)
        # Pin: variable `target_hour_index` MUST NOT appear in the fixed source.
        self.assertNotIn('target_hour_index', source)
        # Pin: `current_choice_hour` MUST NOT appear (was the count variable).
        self.assertNotIn('current_choice_hour', source)

    def test_set_schedule_time_uses_text_based_selector(self):
        source = inspect.getsource(BaiJiaHaoVideo.set_schedule_time)
        # Pin: `get_by_text(` MUST appear with `exact=True` kwarg (substring-safe pattern).
        # The pin is intentionally specific so a regression to the design-D1 ORIGINAL
        # (`>> text={publish_date_hour}` substring form) fails loudly.
        self.assertTrue(
            re.search(r'get_by_text\(\s*publish_date_hour\s*,\s*exact\s*=\s*True\s*\)', source),
            msg='Fix regression: get_by_text(publish_date_hour, exact=True) is the substring-safe selector pattern from design.md D1 amendment. '
                'A return to `text={publish_date_hour}` substring form is vulnerable to '
                'the documented 2点 / 12点 / 22点 collision.',
        )

    def test_set_schedule_time_legitimate_nth_calls_preserved(self):
        """Confirm we did NOT accidentally over-delete — `.nth(0)` and `.nth(1)`
        on `div.select-wrap` (the dropdown WRAPPERS) are legitimate; only the
        options-list `.nth(target_hour_index)` was the bug.
        """
        source = inspect.getsource(BaiJiaHaoVideo.set_schedule_time)
        # The methods call `.nth(0)` and `.nth(1)` on dropdown wrappers. We pin
        # BOTH are still present (regression guard against over-deletion in a
        # future cleanup that drops these wrapper clicks).
        self.assertIn(".nth(0)", source)
        self.assertIn(".nth(1)", source)


class SetScheduleTimeRuntimeErrorEdgeCaseTests(unittest.TestCase):
    """§4.3 — pin §3.1 / D2 RuntimeError with both requested hour AND available list.

    Simulates the text-selector timing out (maximally likely real-world case:
    platform renders hour options in an unexpected format like "14 时" instead
    of "14点"). Asserts the RuntimeError message format happens to match design D2.
    """

    async def test_runtime_error_raised_on_text_selector_timeout(self):
        wrap_chain_0 = MagicMock()
        wrap_chain_0.click = AsyncMock()

        # Configure options_list so `get_by_text('14点', exact=True).click()` raises.
        options_list_chain = MagicMock()
        clickable_for_14 = AsyncMock(
            side_effect=patchright.async_api.TimeoutError(
                "Locator.click: Timeout exceeded while waiting for element to be visible"
            )
        )
        options_list_chain.get_by_text = MagicMock(return_value=clickable_for_14)
        # The fallback `all_inner_texts()` (called inside except) returns a list.
        options_list_chain.all_inner_texts = AsyncMock(
            return_value=['8点', '9点', '10点', '11点']  # '14点' is NOT in this list
        )

        async def fake_wrap_nth(idx):
            return wrap_chain_0

        wrap_chain_0.nth.side_effect = fake_wrap_nth

        locator_map = {
            'div.select-wrap': wrap_chain_0,
            'div.rc-virtual-list  div.cheetah-select-item': MagicMock(),
            'div.rc-virtual-list:visible div.cheetah-select-item-option': options_list_chain,
            'button >> text=定时发布': MagicMock(),
        }

        async def fake_locator(selector):
            return locator_map[selector]

        page = MagicMock()
        page.locator.side_effect = fake_locator
        page.wait_for_selector = AsyncMock()
        page.wait_for_timeout = AsyncMock()

        uploader = BaiJiaHaoVideo.__new__(BaiJiaHaoVideo)

        with self.assertRaises(RuntimeError) as ctx:
            await uploader.set_schedule_time(page, datetime(2099, 3, 15, 14, 30))

        # Pin: error message contains (a) the REQUESTED hour + (b) the AVAILABLE list.
        # Design D2 plus the openspec pointer is intentionally required to be grep-friendly.
        msg = str(ctx.exception)
        self.assertIn("'14点'", msg, msg='RuntimeError must contain the requested hour for operator diagnosis')
        self.assertIn("'8点'", msg, msg='RuntimeError must contain available hour options (or D2 contract is broken)')
        # Pin: openspec-ticket pointer is preserved so the operator can locate AC#4 from logs.
        # Pin 'AC #4' (rename-robust substring) rather than the full ticket path; operators
        # need the signal "look up the real-account probe", not the literal directory name.
        # The full path is the openspec/docs concern.
        self.assertIn('AC #4', msg)

        # Pin: the fallback `all_inner_texts()` was actually called (the chain works).
        options_list_chain.all_inner_texts.assert_awaited_once()

    async def test_runtime_error_chain_preserves_original_traceback(self):
        """The `raise ... from exc` clause preserves the original playwright traceback
        so session-attached debug tooling / Sentry can pinpoint the underlying cause.
        """
        wrap_chain_0 = MagicMock()
        wrap_chain_0.click = AsyncMock()

        original_exc = patchright.async_api.TimeoutError(
            "Locator.click: Timeout exceeded while waiting for element to be visible"
        )
        options_list_chain = MagicMock()
        clickable_for_14 = AsyncMock(side_effect=original_exc)
        options_list_chain.get_by_text = MagicMock(return_value=clickable_for_14)
        options_list_chain.all_inner_texts = AsyncMock(return_value=['8点'])

        async def fake_wrap_nth(idx):
            return wrap_chain_0

        wrap_chain_0.nth.side_effect = fake_wrap_nth

        locator_map = {
            'div.select-wrap': wrap_chain_0,
            'div.rc-virtual-list  div.cheetah-select-item': MagicMock(),
            'div.rc-virtual-list:visible div.cheetah-select-item-option': options_list_chain,
            'button >> text=定时发布': MagicMock(),
        }

        async def fake_locator(selector):
            return locator_map[selector]

        page = MagicMock()
        page.locator.side_effect = fake_locator
        page.wait_for_selector = AsyncMock()
        page.wait_for_timeout = AsyncMock()

        uploader = BaiJiaHaoVideo.__new__(BaiJiaHaoVideo)

        with self.assertRaises(RuntimeError) as ctx:
            await uploader.set_schedule_time(page, datetime(2099, 3, 15, 14, 30))

        # `__cause__` should be the original TimeoutError (the `raise ... from exc` form).
        self.assertIs(ctx.exception.__cause__, original_exc)

    async def test_runtime_error_on_empty_options_list_uses_empty_marker(self):
        """Per code-reviewer Q7: if `all_inner_texts()` returns [] (dropdown opened but yielded
        no option texts), the RuntimeError must surface an empty-list marker so operators
        can distinguish "dropdown genuinely has 0 options" from "dropdown closed after timeout".
        """
        wrap_chain_0 = MagicMock()
        wrap_chain_0.click = AsyncMock()

        options_list_chain = MagicMock()
        clickable_for_14 = AsyncMock(
            side_effect=patchright.async_api.TimeoutError(
                "Locator.click: Timeout exceeded while waiting for element to be visible"
            )
        )
        options_list_chain.get_by_text = MagicMock(return_value=clickable_for_14)
        # Crucial: all_inner_texts succeeds but returns EMPTY list (not an exception).
        options_list_chain.all_inner_texts = AsyncMock(return_value=[])

        async def fake_wrap_nth(idx):
            return wrap_chain_0

        wrap_chain_0.nth.side_effect = fake_wrap_nth

        locator_map = {
            'div.select-wrap': wrap_chain_0,
            'div.rc-virtual-list  div.cheetah-select-item': MagicMock(),
            'div.rc-virtual-list:visible div.cheetah-select-item-option': options_list_chain,
            'button >> text=定时发布': MagicMock(),
        }

        async def fake_locator(selector):
            return locator_map[selector]

        page = MagicMock()
        page.locator.side_effect = fake_locator
        page.wait_for_selector = AsyncMock()
        page.wait_for_timeout = AsyncMock()

        uploader = BaiJiaHaoVideo.__new__(BaiJiaHaoVideo)

        with self.assertRaises(RuntimeError) as ctx:
            await uploader.set_schedule_time(page, datetime(2099, 3, 15, 14, 30))

        # Pin: empty-list marker must surface (NOT the underlying `[]` literal).
        msg = str(ctx.exception)
        self.assertIn('<empty — dropdown showed no option texts>', msg)
        # Pin: requested hour is still in the message (so the two signals are combinable).
        self.assertIn("'14点'", msg)


# Configure the test module to run async test methods via a per-test event loop
# (mirrors the pattern from tests/test_douyin_uploader.py + tests/test_baijiahao_uploader.py).


def _async_runner(test_method):
    async def wrapper(self):
        await test_method(self)

    return wrapper


for _cls in (
    SetScheduleTimeSelectorPatternTests,
    SetScheduleTimeRuntimeErrorEdgeCaseTests,
):
    for _name in dir(_cls):
        if _name.startswith('test_') and callable(getattr(_cls, _name)):
            _existing = getattr(_cls, _name)
            if asyncio.iscoroutinefunction(_existing):
                setattr(_cls, _name, _async_runner(_existing))


if __name__ == '__main__':
    unittest.main()
