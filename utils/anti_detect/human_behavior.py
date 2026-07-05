"""Human-like interaction primitives for Playwright / patchright.

All functions are async and designed to be dropped directly into existing
uploader flows with minimal code changes.
"""
from __future__ import annotations

import asyncio
import math
import random

from patchright.async_api import Locator, Page

# Module-level cache for the last known mouse position per Page instance.
# Keys are ``id(page)`` so the dict stays small even with many pages.
_last_mouse_pos: dict[int, tuple[float, float]] = {}


# ── Random delay helpers ────────────────────────────────────────────────────

async def random_delay(min_ms: float = 800, max_ms: float = 2500) -> None:
    """Sleep for a random duration between *min_ms* and *max_ms* milliseconds.

    Uses a truncated normal distribution centred on the midpoint so that
    extreme outliers (very short / very long) are rarer than uniform random.
    """
    mid = (min_ms + max_ms) / 2
    std = (max_ms - min_ms) / 4
    value = random.gauss(mu=mid, sigma=std)
    value = max(min_ms, min(max_ms, value))
    await asyncio.sleep(value / 1000.0)


async def random_short_delay(min_ms: float = 150, max_ms: float = 600) -> None:
    """Shorter delay for micro-pauses between keypresses / small actions."""
    await random_delay(min_ms, max_ms)


async def random_long_delay(min_ms: float = 2000, max_ms: float = 5000) -> None:
    """Longer delay for page transitions, upload waits, modal animations."""
    await random_delay(min_ms, max_ms)


# ── Human typing ────────────────────────────────────────────────────────────

async def human_type(
    page: Page,
    text: str,
    min_delay_ms: float = 50,
    max_delay_ms: float = 180,
    typo_probability: float = 0.0,
) -> None:
    """Type *text* into the currently focused element with human-like timing.

    Args:
        page: Active Playwright page.
        text: String to type.
        min_delay_ms: Minimum ms between keystrokes.
        max_delay_ms: Maximum ms between keystrokes.
        typo_probability: Chance (0.0–1.0) of inserting a random typo then
            backspacing it. Default 0.0 to avoid accidentally corrupting
            hashtags / platform-specific syntax.
    """
    for char in text:
        # Occasional slightly longer pause (e.g. thinking between words)
        if char == ' ':
            await random_delay(min_delay_ms * 1.5, max_delay_ms * 1.5)

        # Optional typo injection (disabled by default for upload metadata safety)
        if typo_probability > 0 and random.random() < typo_probability:
            typo_char = random.choice('abcdefghijklmnopqrstuvwxyz')
            await page.keyboard.press(typo_char)
            await random_short_delay(80, 200)
            await page.keyboard.press('Backspace')
            await random_short_delay(80, 200)

        await page.keyboard.press(char)
        await random_delay(min_delay_ms, max_delay_ms)


# ── Bezier-curve mouse movement ─────────────────────────────────────────────

def _bezier_point(
    t: float,
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
) -> tuple[float, float]:
    """Cubic Bezier interpolation at parameter *t* ∈ [0, 1]."""
    u = 1 - t
    tt = t * t
    uu = u * u
    uuu = uu * u
    ttt = tt * t

    x = uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0]
    y = uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1]
    return (round(x), round(y))


def _generate_bezier_control_points(
    start: tuple[float, float],
    end: tuple[float, float],
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Generate two random interior control points for a cubic Bezier curve.

    The control points are offset from the midpoint in a random direction
    so that the path is not a straight line but stays within reasonable bounds.
    """
    mid_x = (start[0] + end[0]) / 2
    mid_y = (start[1] + end[1]) / 2

    # Random offset magnitude: 10%–30% of the distance between start and end
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dist = math.hypot(dx, dy)
    offset_mag = dist * random.uniform(0.1, 0.3)

    # Random angle for the control-point offset
    angle = random.uniform(0, 2 * math.pi)
    offset_x = offset_mag * math.cos(angle)
    offset_y = offset_mag * math.sin(angle)

    cp1 = (mid_x + offset_x, mid_y + offset_y)
    cp2 = (mid_x - offset_x, mid_y - offset_y)
    return cp1, cp2


async def bezier_mouse_move(
    page: Page,
    target_x: float,
    target_y: float,
    steps: int = 15,
    min_step_ms: float = 8,
    max_step_ms: float = 25,
) -> None:
    """Move the mouse from its current position to *(target_x, target_y)*
    along a cubic Bezier curve with slight overshoot / wobble.

    Args:
        page: Active Playwright page.
        target_x, target_y: Destination viewport coordinates.
        steps: Number of intermediate mousemove events.
        min_step_ms, max_step_ms: Delay between each step.
    """
    page_id = id(page)
    start = _last_mouse_pos.get(page_id, (0.0, 0.0))
    end = (float(target_x), float(target_y))

    cp1, cp2 = _generate_bezier_control_points(start, end)

    # Add a tiny overshoot at the end (humans often overshoot then correct)
    overshoot = random.uniform(-3, 3)
    overshoot_end = (end[0] + overshoot, end[1] + overshoot)

    for i in range(1, steps + 1):
        t = i / steps
        # Ease-out: slow down as we approach the target
        t_eased = 1 - math.pow(1 - t, 2.5)
        x, y = _bezier_point(t_eased, start, cp1, cp2, overshoot_end)
        await page.mouse.move(x, y)
        await random_delay(min_step_ms, max_step_ms)

    # Final correction to exact target
    if abs(overshoot) > 0.5:
        await page.mouse.move(target_x, target_y)
        await random_short_delay(20, 60)

    # Cache final position so the next call starts from here.
    _last_mouse_pos[page_id] = (float(target_x), float(target_y))


# ── Human click ─────────────────────────────────────────────────────────────

async def human_click(
    page: Page,
    locator: Locator,
    move_before_click: bool = True,
    random_offset: bool = True,
) -> None:
    """Click a locator with human-like mouse movement and optional tiny offset.

    Args:
        page: Active Playwright page.
        locator: Playwright Locator to click.
        move_before_click: If True, move the mouse along a Bezier curve to
            the element before clicking.
        random_offset: If True, click slightly off-centre (±3 px) to avoid
            perfectly centred clicks which are a bot signature.
    """
    bbox = await locator.bounding_box()
    if not bbox:
        # Fallback to standard click if element is not visible / detached
        await locator.click()
        return

    cx = bbox["x"] + bbox["width"] / 2
    cy = bbox["y"] + bbox["height"] / 2

    if random_offset:
        cx += random.uniform(-3, 3)
        cy += random.uniform(-3, 3)

    if move_before_click:
        await bezier_mouse_move(page, cx, cy)

    await page.mouse.click(cx, cy)
    await random_short_delay(100, 300)


# ── Natural scroll ──────────────────────────────────────────────────────────

async def human_scroll(
    page: Page,
    direction: str = "down",
    distance: int = 300,
    steps: int = 5,
) -> None:
    """Scroll the page in small increments with variable pauses.

    Args:
        page: Active Playwright page.
        direction: ``"up"`` or ``"down"``.
        distance: Total pixels to scroll.
        steps: Number of scroll wheel events.
    """
    delta = distance // steps
    delta_y = -delta if direction == "down" else delta

    for _ in range(steps):
        await page.mouse.wheel(0, delta_y)
        await random_delay(150, 500)
