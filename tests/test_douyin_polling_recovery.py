"""Unit tests for `uploader.douyin_uploader.main._wait_for_douyin_login` polling-recovery contract.

Why this file exists
--------------------

`_wait_for_douyin_login` 是抖音扫码登录 polling 主循环, 使用三段式局部状态
+ try/continue 控制流管控 _is_douyin_login_completed 抛出的非 race transient
异常. 主要 invariant:

  * **5 次连续非 race transient failure** → escalate 到
    ``_build_login_result(False, "polling_unstable", ...)``, 不再走
    ``max_checks × poll_interval (5min wall-clock)`` 默认预算。
  * **< 5 次 transient failure + 一次 successful iter** → counter 重置, 走
    ``success`` 返回路径。
  * **任何 race (patchright async_api.Error without TimeoutError)** → 立即
    返回 ``patchright_race``, 不进入 soft-failures counter (race ≠ transient)。
  * **TimeoutError 即使 msg 含 race substring** → 不分类为 race (Tier 1 显式
    排除 `TimeoutError`), 走 soft-failures counter (这是 `utils.patchright_race`
    race-mask blind spot design call 的运行时兑现 — 未来 reviewer 想"fix"
    这个 blind spot 会破坏这个 invariant, 所以本测试 gate).

这些 invariant 是 v9 fast-spin polish (reviewer LOW-1 cosmetic) 的核心:
把 transient failure 的 inside-except sleep 删掉, 让 ``continue`` 跳到 for
顶端 next iter 不间隔, counter 累加达到 5 后才能 escalate。Future
contributor 想"加 sleep 防止 hot-loop"或"merge race + transient
counter"等"fix"都会破坏上述 invariant, 所以本测试全套 gate.

也保护 essential contract 不被打破: race 应该走 patchright_race (走
🩻 early-return + re-login), 不应该走 polling_unstable (🐢 re-login);
timeout-style exception 是 nonrace, 应该走 polling_unstable 而非
patchright_race。

设计说明
--------

* 不需 real browser — 用 `asyncio.run` 包装，max_checks 调小，poll_interval=0
  让 fast-spin transient-failure 路径在测试里也跑得足够快。
* `_is_douyin_login_completed` 通过 `monkeypatch.setattr` 注入 mock，按
  side_effects 列表 throw Exception / return bool。
* `_MockPage` / `_MockLocator` 是 Playwright Page/Locator 的 minimal
  double，只需覆盖 `page.url` 属性 + expired-box 链路 chain
  (`page.get_by_text(...).locator("..").first.count()` /
  `.is_visible()`)。
* race 路径用 `patchright.async_api.Error("context or browser has been closed")`，
  真实走 `utils.patchright_race.is_patchright_race` classifier (无 monkeypatch
  classifier) — 验证 v8 classifier fix 的 runtime 行为。

参考
----
* `tests/test_patchright_race.py` — race classifier 自身 9 单测
* `docs/bug-tickets/test-app-bugfix-tickets-2026q3.md` TBF-017 (v8 classifier)
  + TBF-018 (v9 fast-spin polish) + TBF-019 (schema registry round-2)
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from patchright.async_api import Error as PatchrightError
from patchright.async_api import TimeoutError as PatchrightTimeoutError

# Ensure repo root on path so `from uploader.douyin_uploader.main import ...`
# resolves consistently regardless of pytest invocation cwd.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from uploader.douyin_uploader.main import _wait_for_douyin_login  # noqa: E402

# ─────────────────────────────────────────────────────────────────────────
# Minimal Playwright Page / Locator double
# ─────────────────────────────────────────────────────────────────────────


class _MockLocator:
    """Minimal Playwright `Locator` mock covering `_wait_for_douyin_login` usage.

    Used only for the expired-box chain:
        page.get_by_text("二维码失效", exact=True).locator("..").first

    `.locator(...)` returns self for chain; `.first` returns self so awaits
    on `.count()` / `.is_visible()` resolve cleanly to (0, False) — keeping
    the QR-refresh branch dormant during tests.
    """

    async def count(self) -> int:
        return 0  # no "二维码失效" marker present

    async def is_visible(self) -> bool:
        return False

    def locator(self, *args, **kwargs):
        # chain-safe: returning self means .first returns self (no-op)
        return self

    @property
    def first(self):  # noqa: D401 — Python descriptor protocol
        return self


class _MockPage:
    """Minimal Playwright `Page` mock for `_wait_for_douyin_login` solo tests.

    Only attributes the polling-wrap actually consumes:
      * `page.url` (str) — read in success / race-safe paths
      * `page.get_by_text(*args, **kwargs)` — for expired-box chain
    """

    def __init__(self, url: str = "https://creator.douyin.com/creator-micro/home") -> None:
        self.url = url

    def get_by_text(self, *args, **kwargs):
        return _MockLocator()


def _make_mock_is_completed(side_effects):
    """Build a mock for `_is_douyin_login_completed` that plays a sequence.

    Each element in `side_effects` is either:
      * `True` / `False` bool → returned to caller (login status)
      * `BaseException` instance → raised to caller (transient or race)

    After `side_effects` exhausted, default returns `False` (still polling).

    Returns:
        ``(mock_fn, call_counter_dict)`` — ``call_counter_dict["n"]`` is
        incremented on every call regardless of outcome.
    """
    call_counter = {"n": 0}

    async def mock_fn(page):
        idx = call_counter["n"]
        call_counter["n"] += 1
        page.calls = getattr(page, "calls", []) + [idx]  # observation hook
        if idx < len(side_effects):
            item = side_effects[idx]
            if isinstance(item, BaseException):
                raise item
            return item
        # Default: still polling (after exhausting the script).
        return False

    return mock_fn, call_counter


def _account_file():
    """Str-only account_file path — `_build_login_result` only str()s it; no real file needed."""
    return "/tmp/_test_douyin_polling_recovery_fake.json"


def _qrcode_info():
    """Empty QR info dict (Path("") yields None via `if qrcode_info.get("image_path") else None`)."""
    return {"image_path": "", "image_data_url": ""}


# ─────────────────────────────────────────────────────────────────────────
# Core invariant tests
# ─────────────────────────────────────────────────────────────────────────


def test_polling_escalates_at_5th_transient_failure(monkeypatch):
    """5 consecutive transient (non-race) failures → escalate to ``polling_unstable``.

    Verifies the central contract: max_soft_failures=5 boundary.
    Side-effect-driven mock plays 5 homogeneous transient exceptions, then function
    returns with status='polling_unstable' without consuming further max_checks budget.
    """
    page = _MockPage()
    side_effects = [Exception(f"transient blip #{i}") for i in range(1, 6)]
    mock_fn, call_counter = _make_mock_is_completed(side_effects)
    monkeypatch.setattr(
        "uploader.douyin_uploader.main._is_douyin_login_completed",
        mock_fn,
    )

    result = asyncio.run(
        _wait_for_douyin_login(
            page,
            account_file=_account_file(),
            qrcode_info=_qrcode_info(),
            qrcode_callback=None,
            poll_interval=0,         # fast-spin OK in tests (no real CPU contention)
            max_checks=50,           # big enough not to fire `timeout` first
            max_soft_failures=5,
        )
    )

    assert result["success"] is False, "must NOT succeed (5 transient should escalate, not finalize)"
    assert result["status"] == "polling_unstable", (
        f"expected 'polling_unstable' at 5th transient, got {result['status']!r}. "
        f"A future 'fix' that broadens the transient path (e.g. merges race+transient counters) "
        f"would surface here as either '{result['status']!r}' or 'timeout'."
    )
    assert "5 次软失败" in result["message"], (
        f"message should reflect soft_failures=5, got {result['message']!r}"
    )
    assert call_counter["n"] == 5, (
        f"mock `_is_douyin_login_completed` should be called exactly 5 times before "
        f"escalation (no further call after `polling_unstable` return), got {call_counter['n']}"
    )


def test_polling_recovers_with_2_transient_then_success(monkeypatch):
    """2 transient failures + 1 successful is_completed=True → result is ``success``.

    Verifies:
      * transient failures are tolerable (< max_soft_failures)
      * counter resets after successful iter
      * function early-returns `success` on is_completed=True
    """
    page = _MockPage()
    side_effects = [
        Exception("blip #1"),
        Exception("blip #2"),
        True,    # login completed
    ]
    mock_fn, call_counter = _make_mock_is_completed(side_effects)
    monkeypatch.setattr(
        "uploader.douyin_uploader.main._is_douyin_login_completed",
        mock_fn,
    )

    result = asyncio.run(
        _wait_for_douyin_login(
            page,
            account_file=_account_file(),
            qrcode_info=_qrcode_info(),
            qrcode_callback=None,
            poll_interval=0,
            max_checks=50,
            max_soft_failures=5,
        )
    )

    assert result["success"] is True, (
        f"expected success after recovery, got {result!r}"
    )
    assert result["status"] == "success"
    assert "登录成功" in result["message"]
    assert call_counter["n"] == 3, (
        f"mock should be called exactly 3 times (2 transient + 1 success-completed), "
        f"got {call_counter['n']}"
    )


def test_polling_race_short_circuits_to_patchright_race(monkeypatch):
    """A patchright race exception (Tier 1 Error+Tier 2 substring) DOES NOT increment soft_failures.

    Race should return early with status='patchright_race', not enter polling_unstable
    escalation. This guards against a future 'fix' that collapses race and
    transient paths into the soft_failures counter — would lead to re-login paths
    being inverted (race → 5min wait instead of immediate re-login).
    """
    page = _MockPage()
    side_effects = [
        PatchrightError("Page.goto: context or browser has been closed"),
    ]
    mock_fn, call_counter = _make_mock_is_completed(side_effects)
    monkeypatch.setattr(
        "uploader.douyin_uploader.main._is_douyin_login_completed",
        mock_fn,
    )

    result = asyncio.run(
        _wait_for_douyin_login(
            page,
            account_file=_account_file(),
            qrcode_info=_qrcode_info(),
            qrcode_callback=None,
            poll_interval=0,
            max_checks=50,
            max_soft_failures=5,
        )
    )

    assert result["success"] is False
    assert result["status"] == "patchright_race", (
        f"race exception should yield 'patchright_race' (NOT 'polling_unstable'), "
        f"got {result['status']!r}. A future 'fix' that broadens TypeError → "
        f"soft_failures counter would surface here as 'polling_unstable'."
    )
    assert "race" in result["message"].lower()
    assert call_counter["n"] == 1, (
        "race should short-circuit after first call (no retry, no counter increment)"
    )


def test_timeout_error_with_race_substring_stays_nonrace(monkeypatch):
    """TimeoutError 即使 msg 含 race substring 也不分类为 race, 走到 polling_unstable (escalate 5 次后).

    这是 `utils.patchright_race` race-mask blind-spot design call 的 runtime 兑现:

      * Tier 1: ``isinstance(e, PatchrightError) and not isinstance(e, PatchrightTimeoutError)``
        显式排除 TimeoutError, 避免 polling 超时被 race 化。
      * Design call: race-mask blind spot (e.g. Linux OOM killer 关闭 context 后
        TimeoutError 抛) 接受走 soft-unstable recover 路径，不走快 re-login。

    未来 reviewer 想"fix"这个 blind spot (把 TimeoutError 也计入 race 或 merge
    counter) 会不小心改变 invariant — 本测试 gate 这种 regression。
    """
    page = _MockPage()
    side_effects = [
        PatchrightTimeoutError("Page.wait_for_url: context or browser has been closed")
        for _ in range(5)
    ]
    mock_fn, call_counter = _make_mock_is_completed(side_effects)
    monkeypatch.setattr(
        "uploader.douyin_uploader.main._is_douyin_login_completed",
        mock_fn,
    )

    result = asyncio.run(
        _wait_for_douyin_login(
            page,
            account_file=_account_file(),
            qrcode_info=_qrcode_info(),
            qrcode_callback=None,
            poll_interval=0,
            max_checks=50,
            max_soft_failures=5,
        )
    )

    assert result["success"] is False
    assert result["status"] == "polling_unstable", (
        f"TimeoutError should be classified nonrace (despite race substring) "
        f"and reach 5th escalate, got {result['status']!r}. "
        f"Regression: a future 'race-mask retry' that broadens race detection "
        f"to swallow TimeoutError would surface as 'patchright_race' here."
    )
    assert call_counter["n"] == 5, (
        f"TimeoutError should be tolerated as transient (counter increments), got "
        f"{call_counter['n']} calls before escalate"
    )


def test_polling_resets_counter_on_success_iteration(monkeypatch):
    """4 transient (counter→4) + 1 success + 4 transient (counter→4 again) → success.

    Verifies the counter *resets* after a successful (non-throwing) iter, not just
    after `success` return. If a future 'fix' moves the reset line into success-emit,
    4+1+4 would escalate to polling_unstable instead of returning success.
    """
    page = _MockPage()
    # 4 transient → counter to 4; success-iter → reset to 0;
    # 4 more transient → counter to 4 (not 5); success-final → terminate.
    side_effects = (
        [Exception(f"phase1 blip #{i}") for i in range(1, 5)]
        + [False]  # successful iter (no exception); resets counter
        + [Exception(f"phase2 blip #{i}") for i in range(1, 5)]
        + [True]   # login completed
    )
    mock_fn, call_counter = _make_mock_is_completed(side_effects)
    monkeypatch.setattr(
        "uploader.douyin_uploader.main._is_douyin_login_completed",
        mock_fn,
    )

    result = asyncio.run(
        _wait_for_douyin_login(
            page,
            account_file=_account_file(),
            qrcode_info=_qrcode_info(),
            qrcode_callback=None,
            poll_interval=0,
            max_checks=50,
            max_soft_failures=5,
        )
    )

    assert result["success"] is True, (
        f"counter should reset after success iter — total 4+4 transient + 1 success-final "
        f"should succeed, not escalate; got result {result!r}"
    )
    assert result["status"] == "success"
    assert call_counter["n"] == 10, (
        f"expected 10 calls (4 transient + 1 success-iter + 4 transient + 1 success-final), "
        f"got {call_counter['n']}"
    )


def test_polling_4_transient_then_race_returns_race(monkeypatch):
    """mixed: 4 transient (counter→4) + 1 race → race short-circuits at 5th call.

    Verifies race exception NEVER increments `polling_soft_failures` even when
    counter is mid-buildup. A future 'fix' that reorders the race check AFTER
    `polling_soft_failures += 1` would surface here: race path would erroneously
    escalate to polling_unstable after 5 transient failures (regardless of race).
    """
    page = _MockPage()
    side_effects = [
        Exception("phase1 blip #1"),
        Exception("phase1 blip #2"),
        Exception("phase1 blip #3"),
        Exception("phase1 blip #4"),    # counter → 4 after 4th
        PatchrightError("Page.wait_for_url: context or browser has been closed"),
        # NOTE: side_effects exhausted here; if we got here counter=4, race returns
        # before; this 6th entry never reached.
    ]
    mock_fn, call_counter = _make_mock_is_completed(side_effects)
    monkeypatch.setattr(
        "uploader.douyin_uploader.main._is_douyin_login_completed",
        mock_fn,
    )

    result = asyncio.run(
        _wait_for_douyin_login(
            page,
            account_file=_account_file(),
            qrcode_info=_qrcode_info(),
            qrcode_callback=None,
            poll_interval=0,
            max_checks=50,
            max_soft_failures=5,
        )
    )

    assert result["success"] is False
    assert result["status"] == "patchright_race", (
        f"race exception must short-circuit BEFORE counter increment, "
        f"got {result['status']!r}. If counter was incremented on race, "
        f"5 transient + race would surface as 'polling_unstable' instead."
    )
    assert call_counter["n"] == 5, (
        f"expected 5 calls (4 transient + 1 race); race does NOT trigger "
        f"further side-effects, got {call_counter['n']}"
    )


def test_polling_max_checks_wallclock_returns_timeout(monkeypatch):
    """All non-throwing, non-completed iters → after max_checks loop ends → status="timeout".

    Verifies the wall-clock backstop: if polling never succeeds AND never hits race
    AND never hits transient >= 5, the for-loop terminates on `range(max_checks)`
    exhaustion and returns ``_build_login_result(False, "timeout", ...)``.

    A future 'fix' that changes the post-loop return value from "timeout" to
    "polling_unstable" (or merges the timeout path with the soft_failures counter)
    would surface here as wrong status.
    """
    page = _MockPage()
    max_checks = 20     # small + deterministic for test (production default = 100)
    side_effects = [False] * max_checks + [True]   # always returns False; True never reached
    mock_fn, call_counter = _make_mock_is_completed(side_effects)
    monkeypatch.setattr(
        "uploader.douyin_uploader.main._is_douyin_login_completed",
        mock_fn,
    )

    result = asyncio.run(
        _wait_for_douyin_login(
            page,
            account_file=_account_file(),
            qrcode_info=_qrcode_info(),
            qrcode_callback=None,
            poll_interval=0,
            max_checks=max_checks,
            max_soft_failures=5,
        )
    )

    assert result["success"] is False, "wall-clock timeout must NOT succeed"
    assert result["status"] == "timeout", (
        f"expected 'timeout' from wall-clock backstop after max_checks, "
        f"got {result['status']!r}. Regression: a future 'fix' that collapses "
        f"the timeout path into polling_unstable would surface here."
    )
    assert "等待抖音扫码登录超时" in result["message"], (
        f"message should reflect wall-clock timeout, got {result['message']!r}"
    )
    assert call_counter["n"] == max_checks, (
        f"expected {max_checks} calls (one per loop iter), got {call_counter['n']}"
    )
