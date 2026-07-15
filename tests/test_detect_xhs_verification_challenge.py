"""
Synthetic regression contract for `_detect_xhs_verification_challenge(page)`.
Six page-state scenarios exercise probe order, race-safety, and URL-gate.

Run: python -c "import tests.test_detect_xhs_verification_challenge as m; [getattr(m, f'test_{i}_{case}')() for i in range(1, 7)]"
(Each function below returns `None` on success; raise `AssertionError` on regression.)

Why sync wrappers (not `async def` + `@pytest.mark.asyncio`): pyproject's
`pytest-asyncio>=0.24` defaults to strict mode which skips unmarked async
tests; `asyncio.run(...)` wrappers sidestep the dep entirely.

Vendor: 小红书 2026 uses Tencent Captcha — class selector checks
`[id*='tcaptcha']` OR `[class*='captcha']`. iframe probes verify / captcha
/ tcaptcha src. URL fragments: verify, safe.xiaohongshu.com,
sec.xiaohongshu.com, captcha.
"""
import asyncio

from uploader.xiaohongshu_uploader.locators import XhsLocators as L
from uploader.xiaohongshu_uploader.main import _detect_xhs_verification_challenge


# ── Stub page model (mirror of tests/test_detect_verification_challenge.py) ──


class StubLocator:
    """Stub mirror of `patchright.async_api.Locator`. Exposes only the
    methods `_detect_xhs_verification_challenge` actually calls:
    `.count()`, `.get_attribute("src")`, `.is_visible()`.

    FRAGILITY NOTE — `self.first = self`
    =================================
    Patchright's real `Locator.first` returns a NEW Locator pointing to the
    first match. Our stub returns `self` because the detector invokes only
    count/attribute/visibility methods, which behave identically whether
    the chained reference is "all-matches" or "first-match" Locator.
    """

    def __init__(self, *, count_val: int = 0, attr_val=None, visible_val: bool = False):
        self._count = count_val
        self._attr = attr_val
        self._visible = visible_val
        self.first = self

    async def count(self) -> int:
        return self._count

    async def get_attribute(self, _name):
        return self._attr

    async def is_visible(self) -> bool:
        return self._visible


class StubPage:
    """Stub Page with `url` as override-friendly @property so test_6 can
    raise on access (race-safe on closed context)."""

    def __init__(
        self,
        url: str = "https://creator.xiaohongshu.com/",
        *,
        locators: dict | None = None,
        text_hits: dict | None = None,
        _url_throws: bool = False,
    ):
        self._url_value = url
        self._locators = locators or {}
        self._text_hits = text_hits or {}
        self._url_throws = _url_throws

    @property
    def url(self) -> str:
        if self._url_throws:
            raise RuntimeError("Target page, context or browser has been closed")
        return self._url_value

    def locator(self, selector):
        return self._locators.get(selector, StubLocator())

    def get_by_text(self, text, exact=False):
        return self._text_hits.get(text, StubLocator())


def _run(coro):
    return asyncio.run(coro)


# ── Tests (6 scenarios, mirrors douyin's regression contract) ───────────────


def test_1_iframe_challenge_detected_with_correct_type():
    """小红书 verify iframe with src*='verify' (or 'captcha'/'tcaptcha')."""
    page = StubPage(
        url="https://creator.xiaohongshu.com/verify/abc",
        locators={
            L.VERIFICATION_CHALLENGE_IFRAME_SELECTOR: StubLocator(
                count_val=1,
                attr_val="https://sec.xiaohongshu.com/verify?token=xyz123",
            )
        },
    )
    result = _run(_detect_xhs_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "iframe"
    assert result["matched_probe"] == L.VERIFICATION_CHALLENGE_IFRAME_SELECTOR
    # Hint should mention iframe + src
    assert "iframe" in result["hint"]
    assert "xyz123" in result["hint"] or "sec.xiaohongshu.com" in result["hint"]


def test_2_geetest_class_detected_with_correct_type():
    """Tencent Captcha — class*='captcha' OR id*='tcaptcha'."""
    page = StubPage(
        url="https://creator.xiaohongshu.com/safe?token=foo",
        locators={
            L.VERIFICATION_CHALLENGE_GEETEST_SELECTOR: StubLocator(count_val=1)
        },
    )
    result = _run(_detect_xhs_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "geetest"
    assert result["matched_probe"] == L.VERIFICATION_CHALLENGE_GEETEST_SELECTOR


def test_3_url_plus_text_falls_back_when_high_specificity_probes_miss():
    """Text probe is gated by URL containing one of `_VERIFICATION_URL_FRAGMENTS`.
    Cross-check both axes: text visible AND URL suspicious."""
    page = StubPage(
        url="https://sec.xiaohongshu.com/captcha/sms",
        text_hits={"请完成验证": StubLocator(count_val=1, visible_val=True)},
    )
    result = _run(_detect_xhs_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "text_fallback"
    assert result["matched_probe"] == "text='请完成验证'"
    assert "请完成验证" in result["hint"]


def test_4_clean_login_yields_no_detection():
    """Post-login creator-micro URL — no challenge element present, no URL gate."""
    page = StubPage(
        url="https://creator.xiaohongshu.com/publish/publish",
        locators={},
        text_hits={},
    )
    result = _run(_detect_xhs_verification_challenge(page))
    assert result["detected"] is False
    assert result["type"] == "unknown"
    assert result["hint"] == ""
    assert result["matched_probe"] == ""


def test_5_text_probe_url_gate_blocks_marketing_copy_false_positive():
    """Marketing copy on `creator-micro/...` may surface a forbidden text
    like '拖动滑块' for non-challenge reasons. Even though the text is
    visible AND the selector matches a security-themed copy, the URL gate
    MUST short-circuit text probes so the detector doesn't false-fire.
    """
    page = StubPage(
        url="https://creator.xiaohongshu.com/creator-micro/home",
        text_hits={"拖动滑块": StubLocator(count_val=1, visible_val=True)},
    )
    result = _run(_detect_xhs_verification_challenge(page))
    assert result["detected"] is False
    assert result["matched_probe"] == ""


def test_6_race_safe_on_closed_context_doesnt_raise():
    """When the browser context closes mid-poll, every probe call (page.url,
    locator.count, get_attribute, is_visible) MUST throw cleanly without
    leaking exceptions.  The detector should return {detected: False}
    and let the calling for-loop re-probe next tick."""

    class FlakyPage(StubPage):
        @property
        def url(self):
            raise RuntimeError("browser context closed")

        def locator(self, _selector):
            class ClosedLoc:
                async def count(self):
                    raise RuntimeError("Target page, context or browser has been closed")

                async def get_attribute(self, _name):
                    raise RuntimeError("Target page, context or browser has been closed")

                async def is_visible(self):
                    raise RuntimeError("Target page, context or browser has been closed")

            return ClosedLoc()

        def get_by_text(self, _text, exact=False):
            class ClosedTextLoc:
                async def count(self):
                    raise RuntimeError("Target page, context or browser has been closed")

                async def is_visible(self):
                    raise RuntimeError("Target page, context or browser has been closed")

            return ClosedTextLoc()

    page = FlakyPage(url="https://sec.xiaohongshu.com/verify/foo")
    # Outer code MUST NOT raise. If it does, leak path to consumer.
    result = _run(_detect_xhs_verification_challenge(page))
    assert result["detected"] is False
    assert result["type"] == "unknown"


# ── Bulk runner (bypasses conftest autouse psycopg dependency) ────────────


if __name__ == "__main__":
    """Run via `python tests/test_detect_xhs_verification_challenge.py`.

    pytest discovery paths are blocked by tests/conftest.py::pytest.importorskip('psycopg')
    in dev envs without psycopg installed. This module-level __main__
    bypass lets us run all 6 scenarios without pytest + psycopg, matching
    the douyin test file's exact pattern (tests/test_detect_verification_challenge.py).
    """
    _TESTS = [
        test_1_iframe_challenge_detected_with_correct_type,
        test_2_geetest_class_detected_with_correct_type,
        test_3_url_plus_text_falls_back_when_high_specificity_probes_miss,
        test_4_clean_login_yields_no_detection,
        test_5_text_probe_url_gate_blocks_marketing_copy_false_positive,
        test_6_race_safe_on_closed_context_doesnt_raise,
    ]
    _ok, _fail = 0, 0
    for _t in _TESTS:
        try:
            _t()
            print(f"  OK: {_t.__name__}")
            _ok += 1
        except Exception as _exc:
            print(f"FAIL: {_t.__name__} -> {type(_exc).__name__}: {_exc}")
            _fail += 1
    print(f"ALL_PASS={_ok == len(_TESTS)} ok={_ok} fail={_fail} total={len(_TESTS)}")
