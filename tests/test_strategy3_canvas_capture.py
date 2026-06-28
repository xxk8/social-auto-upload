"""Playwright integration test pinning the Strategy 3 invariant.

`_extract_douyin_qrcode_src` (in ``uploader/douyin_uploader/main.py``)
falls back to **Strategy 3** when Strategy 0 (network intercept) and
Strategy 1 (``<img data:...>`` poll) both miss — Strategy 3 is the
CDP-level modal screenshot via ``uploader.common._cdp_capture_screenshot``,
which calls CDP's ``Page.captureScreenshot`` on a bounded clip region
of the login modal. The whole point of relying on Strategy 3 is that
the captured PNG is the **composited** browser bitmap, including any
`<canvas>` paint buffers Douyin's QR might be rendered into.

Regression guard
----------------
A future refactor that swaps ``Page.captureScreenshot`` →
``page.screenshot(omitBackground=True)`` (the Playwright high-level
API) could silently lose canvas content: headless chromium handles
committed vs uncommitted paint buffers differently between the CDP
and Playwright APIs, and ``clip=`` coord translation differs. Without
this test, such a refactor would slip past review and corrupt the
``image_data_url`` SSE emit on real Douyin logins.

Browser driver skipif
---------------------
Tests gracefully skip if patchright cannot launch chromium (e.g. CI
environments without a planted binary). The module is shippable as-is;
reviewers/CIs with chromium installed run all four scenarios.

Module-scoped fixture state-pollution note
------------------------------------------
The ``chromium_page`` fixture is ``scope="module"`` for browser-boot
amortization (~1-2 s saved vs. function-scope). Tests share the same
``Page`` instance — Test 1's final canvas paint (BLUE) is what
Tests 2/3 capture against. Tests 2/3 only assert clip dimensions +
data-URL prefix (NOT pixel color), so the residual paint is benign.
**Future maintainer caveat**: if pixel-color assertions are added to
Tests 2/3, call ``_canvas_paint(...)`` explicitly first to set a
known state — the implicit blue-residue is not a contract.
"""

from __future__ import annotations

import base64
import io
import os
import sys

import pytest
import pytest_asyncio

# Module-level import skipif — without patchright + Pillow installed,
# this file is meaningless. We intentionally place these after
# ``pytest.importorskip`` so a missing dependency surfaces as a clean
# SKIPPED result, not an ImportError-cascade. ``Pillow`` decodes the
# captured PNG to sample center pixels; ``patchright`` is the project's
# browser driver (NOT vanilla playwright — see ``pyproject.toml``).
pytest.importorskip("patchright.async_api")
pytest.importorskip("PIL")

from PIL import Image  # noqa: E402 (after importorskip, intentional)
from patchright.async_api import async_playwright  # noqa: E402

from uploader.common import _cdp_capture_screenshot  # noqa: E402


# Stub HTML page with a 200x200 `<canvas>` at known coords (50, 100).
# Tests paint the canvas via a Python helper (``_canvas_paint``) wrapping
# ``page.evaluate()`` — patchright's ``set_content()`` does NOT reliably
# execute inline ``<script>`` blocks in headless chromium (verified at
# patchright 1.58.2 + chromium-1217), so the canvas mutation is done
# out-of-band. The ``.login-card-double-Gtywl8`` class mirrors a real
# Douyin modal selector that ``_extract_douyin_qrcode_src`` actually
# clips against (Strategy 3 hook).
STUB_HTML = """
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; padding: 0; height: 2000px; background: white; }
  .login-card-double-Gtywl8 {
    position: absolute; left: 50px; top: 100px;
    width: 200px; height: 200px;
  }
</style>
</head>
<body>
  <div class="login-card-double-Gtywl8">
    <canvas id="qrCanvas" width="200" height="200"></canvas>
  </div>
</body>
</html>
"""


async def _canvas_paint(
    page, color: str, *, top: int | None = None,
) -> None:
    """Paint the test canvas (and optionally reposition it below the fold).

    Routed through ``page.evaluate()`` because patchright's
    ``set_content(STUB_HTML)`` does not reliably execute inline ``<script>``
    in headless chromium (verified ChromiumException ``paintCanvasColor
    is not a function`` at patchright 1.58.2). The helper accepts an
    optional ``top`` kwarg — Test 4 sets ``top=650`` to scroll the
    canvas below the 600px viewport fold and exercises the
    ``capture_beyond_viewport=True`` invariant.
    """
    js_body = (
        """([color, top]) => {
            if (top !== null) {
                document.querySelector('.login-card-double-Gtywl8').style.top = top + 'px';
            }
            const canvas = document.getElementById('qrCanvas');
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 200, 200);
        }"""
    )
    await page.evaluate(js_body, [color, top])


def _hint_browsers_path() -> None:
    """Point patchright at a planted chromium binary without leaking
    dev-box-specific paths into the public test surface.

    Resolution order (first existing-dir wins — sets
    ``PLAYWRIGHT_BROWSERS_PATH`` BEFORE ``async_playwright()`` enters
    its context so the driver picks it up):

      1. ``SAU_PATCHRIGHT_BROWSERS_PATH`` env var, IF set AND the path
         exists on disk — project convention matches ``.env.example``
         patterns (``SAU_SECRET_KEY``, ``SAU_DB_DIALECT``, …). Lets
         CI / Docker / podman runners plant chromium wherever they
         want without editing this test.
      2. macOS platform-native cache (``~/Library/Caches/ms-playwright``)
         — only tried when ``sys.platform == 'darwin'`` so a Linux
         runner named ``a123`` doesn't get a misleading path probe.
      3. Cross-platform default (``~/.cache/ms-playwright``) — the
         unmodified patchright lookup.

    Failing every branch lets the fixture's launch-error try/except
    surface ``pytest.skip(...)`` cleanly — the test reports SKIPPED,
    not ERROR, in environments without chromium.
    """
    candidates = []
    override = os.environ.get("SAU_PATCHRIGHT_BROWSERS_PATH")
    if override:
        candidates.append(override)
    if sys.platform == "darwin":
        candidates.append(
            os.path.expanduser("~/Library/Caches/ms-playwright")
        )
    candidates.append(os.path.expanduser("~/.cache/ms-playwright"))
    for candidate in candidates:
        if os.path.isdir(candidate):
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = candidate
            return


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def chromium_page():
    """Module-scoped chromium + page with ``STUB_HTML`` loaded.

    Launches ONCE per module so all four tests share a single browser
    process (chromium launch is ~1-2s — sharing keeps the suite
    snappy). If the binary isn't installed (or the launch errors out
    for any reason), the fixture calls ``pytest.skip`` so the entire
    module's tests report SKIPPED rather than erroring — a clean
    surface for CI environments without chromium.
    """
    _hint_browsers_path()

    # Materialize the patchright driver on disk if needed; some fresh
    # venv installs require this nudge before ``.chromium.launch()``
    # can find any binary. Best-effort: failures here fall through to
    # the ``try/except`` below which surfaces a clean SKIP.
    try:
        from patchright._impl._driver import compute_driver_executable
        compute_driver_executable()
    except Exception:
        pass

    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch(headless=True)
        except Exception as exc:
            pytest.skip(
                "chromium binary not available for patchright "
                "(install via `patchright install chromium`): "
                f"{type(exc).__name__}: {exc}"
            )

        context = await browser.new_context(viewport={"width": 800, "height": 600})
        page = await context.new_page()
        await page.set_content(STUB_HTML)
        try:
            yield page
        finally:
            await browser.close()


# Reusable clip dict at the canvas's known coords. ``scale: 1`` matches
# the CDP ``Page.captureScreenshot`` default that ``_cdp_capture_screenshot``
# passes through verbatim.
_CANVAS_CLIP = {"x": 50, "y": 100, "width": 200, "height": 200, "scale": 1}


def _decode_png(data_url: str) -> Image.Image:
    """Decode a ``data:image/png;base64,...`` URL into a Pillow Image.

    Asserts the canonical data: URL prefix — a regression guard for
    "what gets shipped to the Web Shell SSE consumer". The trailing
    PNG-bytes signature check (``\\x89PNG\\r\\n\\x1a\\n``) defends against
    a future refactor that replaces the format with ``image/jpeg``
    or strips the ``base64`` token.
    """
    assert data_url.startswith("data:image/png;base64,"), (
        f"non-canonical data URL prefix: {data_url[:60]!r}"
    )
    payload = data_url.split(",", 1)[1]
    png_bytes = base64.b64decode(payload, validate=True)
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n", (
        f"data URL payload is not a valid PNG signature: {png_bytes[:8]!r}"
    )
    return Image.open(io.BytesIO(png_bytes))


@pytest.mark.asyncio(loop_scope="module")
async def test_cdp_capture_screenshot_paints_canvas_state_into_png(chromium_page):
    """Red→Blue paint mutation MUST produce distinct PNGs with RGB-distinct pixels.

    Pins the core Strategy 3 invariant: ``Page.captureScreenshot``
    returns the composited browser bitmap including ``<canvas>`` paint
    buffers. A future swap to ``page.screenshot()`` (high-level API)
    could return STALE canvas frames in some headless modes — the
    "different paint → different PNG" check catches that regression
    with no false positives: pixel-level RGB also changes.
    """
    # Paint RED + capture
    await _canvas_paint(chromium_page, "rgb(255, 0, 0)")
    red_url = await _cdp_capture_screenshot(chromium_page, clip=_CANVAS_CLIP)

    # Paint BLUE + capture
    await _canvas_paint(chromium_page, "rgb(0, 0, 255)")
    blue_url = await _cdp_capture_screenshot(chromium_page, clip=_CANVAS_CLIP)

    # Byte-level: PNGs must change across paints. A stale-frame regression
    # would short-circuit here.
    assert red_url != blue_url, (
        "red/blue canvas paints produced byte-identical PNGs — "
        "Page.captureScreenshot is returning a STALE FRAME"
    )

    red_img = _decode_png(red_url).convert("RGB")
    blue_img = _decode_png(blue_url).convert("RGB")

    # Pixel-level: 3 distinct sample points (corner, center, diagonal)
    # must all match the painted fillStyle — guards against a future
    # regression that produces a center-bias artifact (e.g. composited-
    # but-blanked edges). Loose channel bounds (>200 / <50) absorb JPEG-
    # like color drift if a future refactor changes format; the strict-
    # different check across paints pins the "mutate → change" semantic.
    sample_points = ((50, 50), (100, 100), (150, 150))
    for x, y in sample_points:
        red_px = red_img.getpixel((x, y))
        blue_px = blue_img.getpixel((x, y))
        assert red_px[0] > 200 and red_px[1] < 50 and red_px[2] < 50, (
            f"expected dominant RED at ({x},{y}), got {red_px}"
        )
        assert blue_px[2] > 200 and blue_px[0] < 50 and blue_px[1] < 50, (
            f"expected dominant BLUE at ({x},{y}), got {blue_px}"
        )
        assert red_px != blue_px


@pytest.mark.asyncio(loop_scope="module")
async def test_cdp_capture_screenshot_clip_bounds_match(chromium_page):
    """Returned PNG dimensions MUST equal the clip's ``{w, h}``.

    Pins Strategy 3's bounded-clip contract — ``_extract_douyin_qrcode_src``
    clips against modal bbox selectors and expects a STRICTLY-bounded
    PNG (not a full-viewport fallback). A future refactor that silently
    drops the ``clip=`` arg or converts it to bound-by-viewport would
    return either full-viewport PNGs (size > 200x200) or malformed
    ``Page.captureScreenshot`` errors.
    """
    img = _decode_png(
        await _cdp_capture_screenshot(chromium_page, clip=_CANVAS_CLIP)
    )
    assert img.size == (200, 200), (
        f"clip={_CANVAS_CLIP['width']}x{_CANVAS_CLIP['height']} returned "
        f"PNG of size {img.size} — clip bounds not honored"
    )


@pytest.mark.asyncio(loop_scope="module")
async def test_cdp_capture_screenshot_data_url_prefix_is_canonical(chromium_page):
    """Returned data URL prefix is literally ``data:image/png;base64,``.

    Pins the Web Shell inline ``<img src=>`` consumer contract: a future
    refactor that strips the prefix (returns raw b64 string), or replaces
    it with ``data:application/octet-stream``, would break the SSE
    consumer surface. The PNG signature check in ``_decode_png`` also
    defends against silent format swaps (e.g. ``image/jpeg``).
    """
    data_url = await _cdp_capture_screenshot(chromium_page, clip=_CANVAS_CLIP)
    assert data_url.startswith("data:image/png;base64,"), (
        f"data URL prefix must be canonical for SSE inline <img>, "
        f"got: {data_url[:60]!r}"
    )


@pytest.mark.asyncio(loop_scope="module")
async def test_cdp_capture_screenshot_capture_beyond_viewport_honors_offcanvas(
    chromium_page,
):
    """clip y > viewport height with ``capture_beyond_viewport=True`` → green pixels.

    Pins Strategy 3's ``captureBeyondViewport: True`` parameter — the
    Douyin login modal often extends below the 600px viewport fold on
    smaller screens. The helper MUST honor off-viewport rendering.
    A refactor that drops ``captureBeyondViewport`` (Playwright's
    high-level API doesn't expose this knob) would return viewport-
    clipped garbage (white background pixels) where green paint is
    expected.
    """
    # Reposition the canvas below the 600px viewport fold + paint GREEN.
    await _canvas_paint(chromium_page, "rgb(0, 255, 0)", top=650)
    offclip = {"x": 50, "y": 650, "width": 200, "height": 200, "scale": 1}
    img = _decode_png(
        await _cdp_capture_screenshot(
            chromium_page, clip=offclip, capture_beyond_viewport=True,
        )
    ).convert("RGB")

    assert img.size == (200, 200), (
        f"capture_beyond_viewport=True should still honor clip dimensions, "
        f"got {img.size}"
    )
    px = img.getpixel((100, 100))
    assert px[1] > 200 and px[0] < 50 and px[2] < 50, (
        f"capture_beyond_viewport=True should paint GREEN at offcanvas "
        f"canvas center; got {px} (the surrounding white body was clipped "
        f"instead — the b/v knob is being silently dropped)"
    )
