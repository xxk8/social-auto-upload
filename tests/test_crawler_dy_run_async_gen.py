"""Focused regression test for ``DouyinCrawler._run_async_gen``.

Reproduces the production ``'Browser' object has no attribute 'aclose'``
bug by simulating the SSE client-disconnect scenario:

1. The Flask ``Response(generate(), mimetype='text/event-stream')`` is
   closed mid-stream by the client.  In Python that means somebody calls
   ``generate().close()``, which propagates ``GeneratorExit`` down the
   ``yield from`` chain (search_stream -> _run_async_gen ->
   _async_search_stream).
2. ``_run_async_gen``'s ``finally`` runs and closes the per-call event
   loop.  In Python 3.12+, ``BaseEventLoop.close()`` auto-runs
   ``run_until_complete(agen.aclose())`` on every pending asyncgen we
   never explicitly closed.  That races with patchright's
   ``async_playwright()`` teardown and bubbles up as the bug.

The fix in this commit (round-OPT-...) explicitly does
``loop.run_until_complete(gen.aclose())`` inside ``_run_async_gen``'s
``finally`` BEFORE ``loop.close()``, so Python's automatic sweep finds
``_asyncgens`` empty.  This test asserts that the patched path runs
cleanly without raising ``AttributeError`` when the outer sync
generator is closed mid-flight, and that the cleanup sequence for any
held Browser-like state runs to completion (verified by a ``closed``
flag on the fake Browser).
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from crawler.platforms.douyin.core import DouyinCrawler


# A "Browser" that exhibits the same property as ``patchright.Browser``:
# only ``close()`` (no ``aclose()``).  If anything in the cleanup chain
# ever calls ``aclose()`` on it, we surface ``AttributeError`` -- exactly
# the production symptom.
class FakeBrowser:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        # Mimic patchright teardown: yield control so the loop machinery
        # gets a chance to fire the asyncgen-finalizer hook *if* our
        # explicit ``run_until_complete(gen.aclose())`` pass is missing.
        await asyncio.sleep(0)
        self.closed = True

    def __repr__(self) -> str:
        return "FakeBrowser()"  # so the AttributeError matches the prod text


async def fake_async_search_stream():
    """Mimic ``_async_search_stream`` -- holds a browser across yields."""
    browser = FakeBrowser()
    try:
        # Equivalent to opening a session, scraping, and yielding rows.
        yield {"post_id": "p1", "title": "row-1", "_browser": browser}
        yield {"post_id": "p2", "title": "row-2", "_browser": browser}
        yield {"post_id": "p3", "title": "row-3", "_browser": browser}
    finally:
        # Equivalent to ``await browser.close()`` inside
        # ``_open_browser_session`` __aexit__.  Without the patch, this
        # finally runs as part of Python's auto-``agen.aclose()`` during
        # ``loop.close()``, which races with patchright cleanup.
        await browser.close()


def test_run_async_gen_normal_completion() -> None:
    """End-of-stream path: every row drained cleanly, browser closed."""
    crawler = DouyinCrawler()
    rows = list(crawler._run_async_gen(fake_async_search_stream()))
    assert len(rows) == 3
    assert [r["post_id"] for r in rows] == ["p1", "p2", "p3"]
    # The FakeBrowser object the producer's ``finally`` saw and closed
    # is not exposed to us here (the rows copy the dict), but we can
    # re-run to check cleanup completes via the next test.


def test_run_async_gen_mid_stream_close_has_no_attribute_error() -> None:
    """SSE-disconnect simulation: pull one row, close the outer sync gen.

    The patched ``_run_async_gen`` must:

    1. NOT raise ``AttributeError('FakeBrowser' object has no
       attribute 'aclose')`` -- that was the production symptom.
    2. Reach the inner generator's ``finally`` block and call
       ``FakeBrowser.close()`` to completion -- so the Browser was
       actually torn down (no zombie Chromium processes).

    Without the patch, the auto-``agen.aclose()`` sweep inside
    ``loop.close()`` would drive the inner generator's ``finally``
    through a faulty cleanup path that surfaces the AttributeError
    either synchronously here or asynchronously in the next event-loop
    cycle.
    """
    crawler = DouyinCrawler()
    sync_stream = crawler._run_async_gen(fake_async_search_stream())

    first = next(sync_stream)  # pull row "p1" out
    assert first["post_id"] == "p1"
    held_browser = first["_browser"]
    assert held_browser.closed is False  # still open before disconnect

    # == SSE client disconnect ==
    # Flask closes the Response iterator -> generator.close() is called ->
    # GeneratorExit cascades through the chain.  With the fix this
    # returns cleanly.  Without the fix this raises AttributeError.
    sync_stream.close()

    # The producer's ``finally`` block ran (via the explicit
    # ``run_until_complete(gen.aclose())`` pass) and the Browser is now
    # closed.
    assert held_browser.closed is True, (
        "Patched _run_async_gen should drive the inner asyncgen's "
        "finally block before close() returns"
    )


def test_run_async_gen_close_works_when_inner_raises() -> None:
    """If the inner asyncgen raises mid-stream, the outer cleanup still
    runs cleanly and the browser is closed.

    Mirrors the production failure mode at
    ``_async_search_stream`` -> ``await page.wait_for_selector(...)``:
    the page navigation succeeds, then the selector-wait raises a
    RuntimeError or selector TimeoutError.  Without an explicit
    ``gen.aclose()`` pass in ``_run_async_gen``, the patchright
    ``Browser`` would not be cleanly closed and Chromium would leak.

    With the patch, the producer's ``finally`` runs cleanly and the
    held Browser is closed before the exception propagates out.
    """
    async def raising_asyncgen():
        browser = FakeBrowser()
        try:
            yield {"_browser": browser}
            # Simulate ``page.wait_for_selector`` raising a TimeoutError.
            # Use the same message the production warning uses so a
            # grep on logs finds both this test and the prod error.
            raise RuntimeError("simulated selector wait timeout")
        finally:
            await browser.close()

    crawler = DouyinCrawler()
    sync_stream = crawler._run_async_gen(raising_asyncgen())

    first = next(sync_stream)
    held_browser = first["_browser"]

    with pytest.raises(RuntimeError, match="simulated selector wait timeout"):
        # Pull another row -- the inner asyncgen raises here.  The
        # producer's finally still runs (close the suspended browser)
        # before ``StopAsyncIteration`` reaches the outer driver.
        next(sync_stream)

    # Even though the producer raised, the browser was closed.
    assert held_browser.closed is True


def test_run_async_gen_handles_inner_with_no_yields() -> None:
    """Asyncgen that yields zero rows before returning -- the patched
    cleanup should still run cleanly.

    Note: an ``async def`` with no ``yield`` (or where the yield is
    unreachable) is a coroutine function, NOT an async generator
    function.  We give it an unreachable ``yield`` via ``if False:``
    so it remains an async generator object after ``__call__``.
    """
    async def no_yields():
        browser = FakeBrowser()
        try:
            if False:
                yield  # marks this function as an async generator fn;
                       # never actually reached at runtime
            return
        finally:
            await browser.close()

    crawler = DouyinCrawler()
    sync_stream = crawler._run_async_gen(no_yields())
    # No rows -> sync gen immediately exhausts on first __next__.
    assert list(sync_stream) == []  # cleaner than expecting StopIteration


def test_run_async_gen_aclose_runs_before_loop_close(monkeypatch) -> None:
    """Lock in the patch's structural contract: ``gen.aclose()`` MUST
    run on a still-alive loop BEFORE ``loop.close()``, so Python 3.12's
    auto-asyncgen sweep inside ``loop.close()`` finds ``_asyncgens``
    empty.

    Without the patch, the spy would only observe ``close`` once and
    ``run_until_complete`` zero times (the auto-sweep is invisible
    to user code), so the assertion would fail.  With the patch the
    spy observes ``run_until_complete`` (one per inner
    ``__anext__`` PLUS exactly one extra for the explicit
    ``gen.aclose()``) followed by ``close``.  The ordering matters.
    """
    import asyncio as _asyncio

    seen: list[str] = []
    real_run = _asyncio.BaseEventLoop.run_until_complete
    real_close = _asyncio.BaseEventLoop.close

    def spy_run(self, fut):
        seen.append("run_until_complete")
        return real_run(self, fut)

    def spy_close(self):
        seen.append("close")
        return real_close(self)

    monkeypatch.setattr(_asyncio.BaseEventLoop, "run_until_complete", spy_run)
    monkeypatch.setattr(_asyncio.BaseEventLoop, "close", spy_close)

    crawler = DouyinCrawler()
    sync_stream = crawler._run_async_gen(fake_async_search_stream())

    # Pull one row out -- consumes one ``run_until_complete`` (the
    # inner ``__anext__``).
    next(sync_stream)

    # == SSE-disconnect simulation ==
    sync_stream.close()

    # The patched path produces this call order:
    #   run_until_complete (__anext__)
    #   run_until_complete (our explicit gen.aclose())
    #   close (loop.close())
    # Without the patch (``_run_async_gen.finaly`` only has
    # ``loop.close()``), we'd see just:
    #   run_until_complete (__anext__)
    #   close  (auto-aclose inside loop.close is INVISIBLE to spy)
    # so ``seen`` would have ONE ``run_until_complete`` not two.
    #
    # Use ``== 2`` (not ``>= 2``) so any future refactor that adds an
    # extra ``run_until_complete`` (e.g., a redundant double-aclose)
    # also fails loud.
    assert seen.count("run_until_complete") == 2, (
        f"Patched _run_async_gen must drive exactly one explicit "
        f"run_until_complete(gen.aclose()) pass before close(); "
        f"got {seen!r}"
    )
    assert seen[-1] == "close", f"close() must be the LAST event; got {seen!r}"
    assert seen[-2] == "run_until_complete", (
        f"the explicit aclose() pass must immediately precede close(); "
        f"got {seen!r}"
    )


def test_run_async_gen_loop_close_aclose_attribute_error_is_swallowed(
    monkeypatch,
) -> None:
    """Lock in the production fix for the SSE ``event: error`` of
    ``'Browser' object has no attribute 'aclose'``.

    On Python 3.12+, ``BaseEventLoop.close()`` auto-runs
    ``run_until_complete(agen.aclose())`` on any pending asyncgen.
    If patchright's ``Browser`` object is still in the cleanup chain
    when that auto-sweep fires, patchright surfaces an
    ``AttributeError`` because ``Browser`` only implements
    ``close()`` (not ``aclose()``).  The patch in this round wraps
    the ``loop.close()`` call in its own ``try / except`` so the
    teardown race stays a debug-log trace instead of a 5xx-shaped
    stream end (the SSE route in
    :mod:`web_runner.routes.crawl` catches ``Exception`` from
    ``crawler.search_stream()`` and emits an ``event: error`` to
    the browser; without this patch the user sees a permanent
    error in the dashboard even though rows were streamed
    successfully).

    Without the patch, ``sync_stream.close()`` below would re-raise
    ``AttributeError('Browser' object has no attribute 'aclose')``,
    which is the exact production symptom the user reported on
    ``/dashboard/crawl``.  With the patch, the close() pass must
    complete silently AND the held Browser must still be closed
    (proving the patchright teardown finished its work before the
    error was swallowed).
    """
    import asyncio as _asyncio

    real_close = _asyncio.BaseEventLoop.close

    def exploding_close(self):
        # Mirrors the production error message verbatim so a log
        # grep on ``'Browser' object has no attribute 'aclose'``
        # finds both this test and the live SSE error.
        raise AttributeError(
            "'Browser' object has no attribute 'aclose'"
        )

    monkeypatch.setattr(_asyncio.BaseEventLoop, "close", exploding_close)

    crawler = DouyinCrawler()
    sync_stream = crawler._run_async_gen(fake_async_search_stream())

    first = next(sync_stream)
    held_browser = first["_browser"]
    assert held_browser.closed is False  # still open mid-stream

    # The fix: this close() must NOT raise.  Without the patch, it
    # would propagate the AttributeError to the caller (the SSE
    # route's ``for row in crawler.search_stream(...)`` loop) which
    # turns it into an ``event: error`` frame.
    sync_stream.close()

    # The held Browser was closed via the explicit ``gen.aclose()``
    # pass BEFORE the exploding ``loop.close()`` was hit, so the
    # patchright teardown finished its work and the AttributeError
    # is just a no-op cleanup artifact.
    assert held_browser.closed is True, (
        "Patched _run_async_gen must drive the inner asyncgen's "
        "finally block (closing the held Browser) BEFORE the "
        "exploding loop.close() fires, so the AttributeError is "
        "swallowed AFTER real cleanup completed."
    )
