"""
Synthetic regression contract for `_detect_verification_challenge(page)`.
Six page-state scenarios exercise probe order, race-safety, and URL-gate.

Run: pytest tests/test_detect_verification_challenge.py -v
(requires psycopg installed as the conftest autouse session fixture
`tests/conftest.py::_init_pg_schema` calls `pytest.importorskip("psycopg")`
at setup — `uv pip install -e ".[dev]"` includes the `web-pg` extra
transitively. The detector itself touches no DB; psycopg is only needed
because conftest's autouse scope cascades the skip to every test.)

Why sync wrappers (not `async def` + `@pytest.mark.asyncio`): pyproject's
`pytest-asyncio>=0.24` defaults to strict mode which skips unmarked async
tests; `asyncio.run(...)` wrappers sidestep the dep entirely.
"""
import asyncio

from uploader.douyin_uploader.locators import DouyinLocators as L
from uploader.douyin_uploader.main import _detect_verification_challenge


# ── Stub page model ──────────────────────────────────────────────────────


class StubLocator:
    """Stub mirror of `patchright.async_api.Locator`. Exposes only the
    methods `_detect_verification_challenge` actually calls:
    `.count()`, `.get_attribute("src")`, `.is_visible()`.

    FRAGILITY NOTE — `self.first = self`
    =================================
    Patchright's real `Locator.first` returns a NEW Locator pointing to the
    first match. Our stub returns `self` because the detector invokes only
    count/attribute/visibility methods, which behave identically whether
    the chained reference is "all-matches" or "first-match" Locator.

    This works for the CURRENT detector. If a future maintainer introduces
    polymorphic behaviour (e.g. `.nth(0)`, `.all()`, context-tracking), this
    stub will silently agree with the new API and miss regressions. Plonk
    a `class FirstLocator` delegation wrapper here if/when that happens.
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
    """Stub Page with `url` as override-friendly @property to allow sub-classes
    to throw on access (test_6 — race-safe on closed context).
    """

    def __init__(
        self,
        url: str = "https://creator.douyin.com/",
        *,
        locators: dict | None = None,
        text_hits: dict | None = None,
    ):
        self._url_value = url
        self._locators = locators or {}
        self._text_hits = text_hits or {}

    @property
    def url(self) -> str:
        return self._url_value

    def locator(self, selector):
        return self._locators.get(selector, StubLocator())

    def get_by_text(self, text, exact=False):
        return self._text_hits.get(text, StubLocator())


def _run(coro):
    """Sync wrapper for the async detector — keeps tests at plain
    `def test_*` so we don't need pytest-asyncio strict-mode markers.
    """
    return asyncio.run(coro)


# ── Tests ────────────────────────────────────────────────────────────────


def test_1_iframe_challenge_detected_with_correct_type():
    """Douyin's verify iframe (src contains 'verify' or 'captcha') — strongest signal."""
    page = StubPage(
        url="https://creator.douyin.com/verify/abc",
        locators={
            L.VERIFICATION_CHALLENGE_IFRAME_SELECTOR: StubLocator(
                count_val=1,
                attr_val="https://sec.douyin.com/captcha?token=xyz123",
            )
        },
    )
    result = _run(_detect_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "iframe"
    # Lock matched_probe to the source-of-truth locator string. If probe
    # order or composition changes, this string MUST change too — the
    # operator-facing modal banner surfaces it as a debug aid.
    assert result["matched_probe"] == L.VERIFICATION_CHALLENGE_IFRAME_SELECTOR
    assert "verify iframe src" in result["hint"]


def test_2_geetest_class_detected_with_correct_type():
    """3rd-party captcha (class contains 'geetest') — second-strongest signal."""
    page = StubPage(
        url="https://creator.douyin.com/captcha/geetest",
        locators={
            L.VERIFICATION_CHALLENGE_GEETEST_SELECTOR: StubLocator(count_val=1)
        },
    )
    result = _run(_detect_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "geetest"
    assert result["matched_probe"] == L.VERIFICATION_CHALLENGE_GEETEST_SELECTOR


def test_3_url_plus_text_falls_back_when_high_specificity_probes_miss():
    """Text probe is gated by URL containing one of `_VERIFICATION_URL_FRAGMENTS`.
    If URL is suspicious AND a known challenge text is visible, fall back
    to type='text_fallback'.
    """
    page = StubPage(
        url="https://passport.douyin.com/verify/sms",
        text_hits={"极验": StubLocator(count_val=1, visible_val=True)},
    )
    result = _run(_detect_verification_challenge(page))
    assert result["detected"] is True
    assert result["type"] == "text_fallback"
    # matched_probe is f"text={text!r}" — locks the exact string format the
    # SSE payload surfaces to operator modal.
    assert result["matched_probe"] == "text='极验'"
    assert "极验" in result["hint"]


def test_4_clean_login_yields_no_detection():
    """Post-login creator-micro URL — no challenge element present."""
    page = StubPage(
        url="https://creator.douyin.com/creator-micro/content/upload",
        locators={},
    )
    result = _run(_detect_verification_challenge(page))
    assert result["detected"] is False
    assert result["type"] == "unknown"
    assert result["hint"] == ""
    assert result["matched_probe"] == ""


def test_5_text_probe_url_gate_blocks_marketing_copy_false_positive():
    """Marketing copy on `creator-micro/...` may surface a forbidden text
    like '极验' for non-challenge reasons. The URL gate MUST short-circuit
    text probes so the detector doesn't false-fire.
    """
    page = StubPage(
        url="https://creator.douyin.com/creator-micro/home",
        text_hits={"极验": StubLocator(count_val=1, visible_val=True)},
    )
    result = _run(_detect_verification_challenge(page))
    assert result["detected"] is False
    assert result["matched_probe"] == ""


def test_6_race_safe_on_closed_context_doesnt_raise():
    """When the browser context closes mid-poll, every probe call (page.url,
    locator.count, get_attribute, is_visible) MUST throw cleanly without
    leaking exceptions to `_wait_for_douyin_login`'s outer try/except.

    The detector should return {detected: False} and let the calling for-loop
    re-probe next tick.
    """

    class ClosedTextLoc:
        async def count(self):
            raise RuntimeError("page closed")

        async def is_visible(self):
            raise RuntimeError("page closed")

    class FlakyPage(StubPage):
        @property
        def url(self):
            raise RuntimeError("browser context closed")

        def locator(self, selector):
            class ClosedLoc:
                async def count(self):
                    raise RuntimeError(
                        "Target page, context or browser has been closed"
                    )

                async def get_attribute(self, name):
                    raise RuntimeError(
                        "Target page, context or browser has been closed"
                    )

                async def is_visible(self):
                    raise RuntimeError(
                        "Target page, context or browser has been closed"
                    )

            return ClosedLoc()

        def get_by_text(self, text, exact=False):
            return ClosedTextLoc()

    page = FlakyPage(url="https://sec.douyin.com/verify/foo")
    # Outer code MUST NOT raise. If it does, leak path to consumer.
    result = _run(_detect_verification_challenge(page))
    assert result["detected"] is False
    assert result["type"] == "unknown"
