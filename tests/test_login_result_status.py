"""Unit tests for uploader.douyin_uploader._status_schema invariant.

5 个 core 用例:

1. schema 是 frozenset — immutability 锁定 (runtime 不能 accidental mutation)。
2. canonical 7 values pinning — schema set is exact, 增/减 status 需 explicit edit test。
   7-element set 是 TBF-019 schema seed 第一次运行后发现的 drift fix 个案:
   `timeout` 是被 schema seed 遗漏但 main.py line 418 实际 emit 的 status。
3. validate_login_status 已知值 → True。
4. validate_login_status 未知值 (含 task-lifecycle 误伤如 pending/scheduled/error) → False。
5. anti-typo 中央 anti-drift 保证: 拼错 'patchrightrace' / 'cookies_valid' / 'successes' 等不予 validate。
   这是 schema registry 存在的核心价值。
"""
from uploader.douyin_uploader._status_schema import (
    LOGIN_RESULT_STATUSES,
    validate_login_status,
)


def test_login_result_statuses_is_frozenset_immutable():
    """schema set 类型必须是 frozenset, not set / list / tuple — 锁定为 immutable。"""
    assert isinstance(LOGIN_RESULT_STATUSES, frozenset), (
        f"expected frozenset, got {type(LOGIN_RESULT_STATUSES).__name__}"
    )


def test_login_result_statuses_canonical_7_values_pinning():
    """Pin canonical 7-element schema set; adding/removing a status requires explicit test edit + TBF review。

    历史: TBF-019 schema seed 初版为 6-element (success / failed / cookie_valid /
    cookie_invalid / patchright_race / polling_unstable)。第一次运行后 spot check
    发现 main.py line 418 实际 emit `status="timeout"` (5min wall-clock max_checks
    默认走完仍未 success) 但不在原 schema set 中 — 是 spec 本身的遗漏。
    决议: deliberate add `timeout` to schema, 与 emission site 重新对齐 (7-element)。

    If the test breaks, schema drift has happened. Open a TBF first per the
    "add/remove status requires explicit TBF" protocol — do not silently edit.
    """
    expected = frozenset({
        "success",
        "failed",
        "cookie_valid",
        "cookie_invalid",
        "patchright_race",
        "polling_unstable",
        "timeout",
    })
    assert LOGIN_RESULT_STATUSES == expected, (
        f"schema drift detected: got {sorted(LOGIN_RESULT_STATUSES)}, "
        f"expected {sorted(expected)}. If intentional, update test + open TBF for schema change review."
    )


def test_login_result_statuses_no_task_lifecycle_pollution():
    """task lifecycle status (pending/scheduled/running/success-with-failed-rune) 必须不在 login schema 中。

    task lifecycle namespace 是独立 DB-only (web_runner/db.py tasks table),
    与 douyin login result 不交叉。schema entry 静态 pinning 能 catch
    accidental namespace bleed。
    """
    task_lifecycle = {"pending", "scheduled", "running", "error"}
    assert LOGIN_RESULT_STATUSES.isdisjoint(task_lifecycle), (
        "douyin login schema polluted by task lifecycle status — these are independent namespaces"
    )


def test_validate_login_status_known_values_return_true():
    for s in ("success", "failed", "cookie_valid", "cookie_invalid", "patchright_race", "polling_unstable", "timeout"):
        assert validate_login_status(s) is True, f"{s!r} expected to validate as known status"


def test_validate_login_status_unknown_values_return_false():
    unknown_samples = [
        "pending",          # task lifecycle, not login schema
        "scheduled",        # task lifecycle, not login schema
        "error",            # task lifecycle, not login schema
        "",                 # empty string
        "SUCCESS",          # case mismatch (not normalized)
        "polling_throttle", # hypothetical future status (TBF-019 future)
        "unknown",
    ]
    for s in unknown_samples:
        assert validate_login_status(s) is False, f"{s!r} should NOT validate (unknown / namespace-incorrect)"


def test_validate_login_status_typos_return_false():
    """Anti-typo 中央 anti-drift guarantee.

    The schema registry's primary value is preventing typo'd status literals
    from silently being treated as a known status (eg. by web_runner
    `result["status"] == "<typo>"` matching unknown values as 'ok').

    Note: after the round-2 drift fix, `timeout` is a canonical 7-element
    member; typo variants covering common misspellings / case / punctuation
    are listed below to guarantee the helper still rejects them. (See
    TBF-019 round-2 for the schema extension context.)
    """
    typo_samples = [
        "patchrightrace",   # missing underscore (most common typo)
        "cookies_valid",    # plural typo
        "successes",        # plural typo
        "cookieinvalid",    # missing underscore
        "polling-unstable", # hyphen instead of underscore
        "POLLING_UNSTABLE", # uppercase
        "pollingunsable",   # typo
        "time_out",         # alternative underscore form of timeout
        "TIMEOUT",          # uppercase variant of timeout
    ]
    for s in typo_samples:
        assert validate_login_status(s) is False, f"typo'd literal {s!r} must NOT validate"
