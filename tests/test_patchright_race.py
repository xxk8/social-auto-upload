"""Unit tests for utils.patchright_race.is_patchright_race.

覆盖 e.name / substring / TimeoutError / non-patchright 排除边界:

1. TimeoutError 排除: 即使 str(e) 里有 "context or browser has been closed"
   substring 也不能误判为 race (网络慢不是 race)。
2. 非 patchright 异常: 通用 Exception / RuntimeError 不论 msg 都 False。
3. Race-specific 已知 name (TargetClosedError subclass): type(e).__name__ 派生
   类名命中 → True (Python 自动: ``__class__.__name__``)。
4. 旧 patchright 形态: 基类 throw 含 "context or browser has been closed"
   substring, belt-and-suspenders 兜底命中 (narrow miss + substring hit)。
5. Second substring 变体: "Target page" 兜底命中。
6. DNS 错误: net::ERR_NAME_NOT_RESOLVED 是真的网络错, 不是 race, False。
7. TLS 错误: net::ERR_CERT_AUTHORITY_INVALID 不是 race, False。
8. Edge case: bare Error() with empty message, narrow miss + substring miss → False。
"""

from patchright.async_api import Error, TimeoutError

from utils.patchright_race import is_patchright_race


def test_timeout_error_returned_false_even_with_substring():
    """TimeoutError 即使 str(e) 含 race-like substring, 仍 False。

    network 慢 / page.goto 超时 不是 race。race 是结构性破坏 (context 在
    执行中消失), 语义区别决定 caller 走哪条 retry / surface 路径。
    """
    e = TimeoutError("Page.goto timeout: context or browser has been closed")
    assert is_patchright_race(e) is False


def test_non_patchright_runtime_error_returned_false():
    """unrelated library 的 RuntimeError 不是 race, False。"""
    e = RuntimeError("Connection reset by peer")
    assert is_patchright_race(e) is False


def test_non_patchright_bare_exception_returned_false():
    """plain ``Exception`` 即使 msg 包含 race substring, 也 False (没有 isinstance guard 不通过)。"""
    e = Exception("context or browser has been closed")
    assert is_patchright_race(e) is False


def test_race_subclass_target_closed_name_match_returns_true():
    """patchright 后续大版本 (v1.40+) 公开 race-specific class, ``type(e).__name__`` 命中 → True。

    Python 自动: 派生类的 ``__class__.__name__`` 即类字面名, 无需手 setattr。
    类字面 ``TargetClosedError`` 的实例自然得到 ``type(e).__name__ == "TargetClosedError"``。
    """

    class TargetClosedError(Error):
        pass

    e = TargetClosedError("Page closed mid-flight")
    assert type(e).__name__ == "TargetClosedError"
    assert is_patchright_race(e) is True


def test_old_patchright_base_error_with_substring_returns_true():
    """2026-06 patchright 实际形态: 基类 ``Error`` throw 含 race substring, belt-and-suspenders 命中。"""
    e = Error("Page.goto: context or browser has been closed")
    # verify name falls through to base subclass
    assert type(e).__name__ == "Error"
    # narrow tier misses ("Error" not in _KNOWN_RACE_NAMES), substring tier hits
    assert is_patchright_race(e) is True


def test_old_patchright_target_page_substring_returned_true():
    """另一兜底 substring ``Target page``, 覆盖 patchright older 在 navigation race 时 throw 的 variant。"""
    e = Error("Page.goto: Target page, context or browser has been closed")
    assert is_patchright_race(e) is True


def test_dns_error_returned_false():
    """``net::ERR_NAME_NOT_RESOLVED`` 是网络错, 不是 race, False。"""
    e = Error("net::ERR_NAME_NOT_RESOLVED")
    assert is_patchright_race(e) is False


def test_tls_error_returned_false():
    """TLS handshake 失败不是 race, False。"""
    e = Error("net::ERR_CERT_AUTHORITY_INVALID")
    assert is_patchright_race(e) is False


def test_bare_error_with_empty_message_returns_false():
    """base ``Error()`` with empty msg → narrow miss + substring miss → False (edge case)。

    Pinned 防止 future patchright 改 default message 时此条 False 被 silently
    flip 成 True: bare ``Error()`` 既不在 narrow race-specific class set 里
    (``type(e).__name__ == "Error"``), 也两条 substring 都不在空 msg 里。
    """
    e = Error()
    assert type(e).__name__ == "Error"
    assert is_patchright_race(e) is False
