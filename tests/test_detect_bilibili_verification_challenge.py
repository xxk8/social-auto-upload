"""
Synthetic regression contract for `_detect_bilibili_verification_challenge(page)`.
Six page-state scenarios exercise probe order, race-safety, and URL-gate.

Run: python -c "import tests.test_detect_bilibili_verification_challenge as m; [getattr(m, f'test_{i}_{case}')() for i in range(1, 7)]"
(Each function below returns `None` on success; raise `AssertionError` on regression.)

Why sync wrappers (not `async def` + `@pytest.mark.asyncio`): pyproject's
`pytest-asyncio>=0.24` defaults to strict mode which skips unmarked async
tests; `asyncio.run(...)` wrappers sidestep the dep entirely.

Vendor: B站 2026 uses Geetest 3rd-party captcha — class selector is
`[class*='geetest']`. iframe probes match geetest/captcha/verify src.
URL fragments: verify, captcha, passport.bilibili.com/login, safecenter.
"""
import asyncio

from uploader.bilibili_uploader.locators import BilibiliLocators as L
from uploader.bilibili_uploader.main import _detect_bilibili_verification_challenge


# ── Stub page model (mirror of tests/test_detect_xhs_verification_challenge.py) ──


class StubLocator:
    """Stub mirror of `patchright.async_api.Locator`. Exposes only the
    methods `_detect_bilibili_verification_challenge` actually calls.
    FRAGILITY NOTE — see comments in test_detect_xhs_verification_challenge.py.
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
    """Stub Page with overridable `url` (raising or static) and locator dicts."""

    def __init__(
        self,
        url: str = "https://member.bilibili.com/",
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


# ── Tests (6 scenarios, mirrors douyin/xhs regression contract) ──────────


def test_1_iframe_challenge_detected_with_correct_type():
    """B站 verify iframe with src*='verify' (or 'captcha'/'geetest')."""
    page = StubPage(
        url="https://passport.bilibili.com/login?from=verify",
        locators={
            L.VERIFICATION_CHALLENGE_IFRAME_SELECTOR: StubLocator(
                count_val=1,
                attr_val="https://captcha.bilibili.com/verify?token=ab12",
            )
        },
    )
    result = _run(_detect_bilibili_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "iframe"
    assert result["matched_probe"] == L.VERIFICATION_CHALLENGE_IFRAME_SELECTOR
    assert "iframe" in result["hint"]
    assert "ab12" in result["hint"] or "captcha.bilibili.com" in result["hint"]


def test_2_geetest_class_detected_with_correct_type():
    """Geetest-style 3rd-party captcha with class containing 'geetest'."""
    page = StubPage(
        url="https://passport.bilibili.com/login?from=geetest",
        locators={
            L.VERIFICATION_CHALLENGE_GEETEST_SELECTOR: StubLocator(count_val=1)
        },
    )
    result = _run(_detect_bilibili_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "geetest"
    assert result["matched_probe"] == L.VERIFICATION_CHALLENGE_GEETEST_SELECTOR


def test_3_url_plus_text_falls_back_when_high_specificity_probes_miss():
    """Text probe is gated by URL containing one of `_VERIFICATION_URL_FRAGMENTS`.
    Cross-check both axes: text visible AND URL suspicious."""
    page = StubPage(
        url="https://passport.bilibili.com/login/captcha",
        text_hits={
            # Use a text that's in our xhs/bili probe set (overlap: 安全验证)
            "安全验证": StubLocator(count_val=1, visible_val=True),
        },
    )
    result = _run(_detect_bilibili_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "text_fallback"
    assert result["matched_probe"] == "text='安全验证'"
    assert "安全验证" in result["hint"]


def test_4_clean_login_yields_no_detection():
    """After-login creator URL — no challenge element present, no URL gate match."""
    page = StubPage(
        url="https://member.bilibili.com/platform/home",
        locators={},
        text_hits={},
    )
    result = _run(_detect_bilibili_verification_challenge(page))
    assert result["detected"] is False
    assert result["type"] == "unknown"
    assert result["hint"] == ""
    assert result["matched_probe"] == ""


def test_5_text_probe_url_gate_blocks_marketing_copy_false_positive():
    """B站 may surface '安全验证' in help docs / settings on
    `member.bilibili.com/...`. URL gate MUST short-circuit text probes
    — only `/login|verify|captcha|safecenter` paths count as suspicious.
    """
    page = StubPage(
        url="https://member.bilibili.com/platform/home",
        text_hits={"安全验证": StubLocator(count_val=1, visible_val=True)},
    )
    result = _run(_detect_bilibili_verification_challenge(page))
    assert result["detected"] is False
    assert result["matched_probe"] == ""


def test_6_race_safe_on_closed_context_doesnt_raise():
    """When the browser context closes mid-poll, every probe call (page.url,
    locator.count, get_attribute, is_visible) MUST throw cleanly without
    leaking exceptions."""

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

    page = FlakyPage(url="https://passport.bilibili.com/login/verify")
    # Outer code MUST NOT raise. If it does, leak path to consumer.
    result = _run(_detect_bilibili_verification_challenge(page))
    assert result["detected"] is False
    assert result["type"] == "unknown"


# ── Bulk runner (bypasses conftest autouse psycopg dependency) ────────────


if __name__ == "__main__":
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
