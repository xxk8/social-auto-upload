"""Douyin login-result status schema (Python source-of-truth).

TBF-019 cross-language source-of-truth seed.

Why
---

`uploader/douyin_uploader/main.py::_build_login_result` 接受一个 ``status: str``
参数并写进 result dict 的 ``status`` 字段。从 early TBF-016 修到 TBF-018 fast-spin
polish, 我们累积了 7 个合法 status 字面量: success / failed / cookie_valid /
cookie_invalid / patchright_race / polling_unstable / timeout。每个 status 是某个 race /
soft-failure / wall-clock timeout / 终态分支的字面字符串。

**注**: ``timeout`` 是 TBF-019 schema seed 第一次运行后发现的 drift:
``main.py`` line 418 会在 ``_wait_for_douyin_login`` 的 for-loop 走完 ``max_checks``
(默认 5min 默认 ``poll_interval=3 * max_checks=100``) 仍未触发 success / race /
polling_unstable 时 emit ``status="timeout"``。原 schema seed 未包含此 status,
是 spec 本身的遗漏 — 现已 deliberate add, schema 与 emission site 重新对齐。

问题: 7+ string literatures 散在 `_build_login_result(success, status="...", ...)`
调用点 (9+ sites)。任何 typo (e.g. ``patchrightrace`` 漏下划线) 都会
silently drift — Python 不会拦截。未来 web_runner 加 consumer 时, 同样的
``result["status"] == "failed"`` 字面 match 也会漏识别新 status。

设计
----

提供两个公用 symbols:

* ``LOGIN_RESULT_STATUSES``: ``frozenset`` of 7 canonical status strings.
  Schema anchor (single source-of-truth) for **all** Python consumers —
  caller 端 ``if result["status"] in LOGIN_RESULT_STATUSES: ...`` 比
  字面 ``== "success"`` 安全; 可以枚举 comparison 时表示 all-known。

* ``validate_login_status(s) -> bool``: bool check helper. EAFP try/except
  idiom 友好:

  .. code-block:: python

      validate_login_status(result["status"])  # True if known, False if unknown
      # or raise idiom:
      if not validate_login_status(result["status"]):
          raise UnknownStatusError(result["status"])

Why **not** an enum / dataclass: 当前 main.py 9+ sites 用字面 string 传递
status (stringly-typed), 立即 refactor 到 enum 需조정所有 call sites — HIGH
risk + 越出 minimal-change 原则. ``frozenset + bool helper`` 提供
single-source-of-truth anchor without breaking existing call sites. 未来
TBF-019 follow-up 可以增量迁移 status 字面 转 enum。

Why **private** module-prefix (``_status_schema``): 单-package 内部契约;
未来跨-package (utils/login_qrcode) promotion 取决于 TBF-019 rollout。
"""
from __future__ import annotations

# Canonical status values emitted by `uploader.douyin_uploader.main._build_login_result`.
# Single source-of-truth for Python consumers (web_runner / docs / tests).
# Adding a new status here must be a deliberate action; never edit mid-PR without
# cross-ref to the producing call site in `main.py`.

LOGIN_RESULT_STATUSES: frozenset[str] = frozenset({
    "success",           # 抖音扫码登录成功 (login completed)
    "failed",            # 通用 catch-all / outer-finally 兜底
    "cookie_valid",      # cookie_auth 返回 True (token 加载成功)
    "cookie_invalid",    # cookie_auth 返回 False / cookie 文件不存在
    "patchright_race",   # context/browser closed mid-operation (5 race sites)
    "polling_unstable",  # _wait_for_douyin_login 连续 5 软失败 (Polling fast-spin escalation)
    "timeout",           # _wait_for_douyin_login max_checks wall-clock (default poll_interval=3 × max_checks=100 = 5min) reached without success/race/soft-fail
})


def validate_login_status(s: str) -> bool:
    """Return True if ``s`` 是一个 known login result status.

    Helper function for callers checking unknown status (e.g., bug-fix
    diagnostic, defensive logging in web_runner backend, frontend serialization).

    Args:
        s: candidate status string.

    Returns:
        ``True`` if ``s`` 在 ``LOGIN_RESULT_STATUSES`` 中; ``False`` 否则。

    .. note::
       Stopgap while schema is stringly-typed in main.py. When TBF-020 (enum
       migration) lands and ``_build_login_result`` accepts ``LoginResultStatus``
       enum, this helper is naturally superseded by ``isinstance(s, LoginResultStatus)``.
       Functionality preserved; symbol may be deprecated post-migration.
    """
    return s in LOGIN_RESULT_STATUSES


__all__ = ["LOGIN_RESULT_STATUSES", "validate_login_status"]
