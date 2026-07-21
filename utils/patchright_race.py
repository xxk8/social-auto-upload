"""鲁棒的 patchright race (context/page/browser 关闭 mid-flight) 检测。

背景与动机
----------

2026-06-29 之前, 抖音 uploader 在 5+ 处 race-wrap 站点 (`_goto_race_safe` /
`_wait_for_url_race_safe` / `cookie_auth` / `_wait_for_douyin_login` polling
wrap) 都用 ``"context or browser has been closed" in msg or "Target page" in msg``
这种 message substring 检测 race。这有两个 integration 风险:

1. ``str(e)`` 的 wording 取决于 patchright 内部实现, 大版本升级可能改名 →
   substring silently 失效 → race 漏出到上层 outer except 打 😢 hard fail。
2. ``TimeoutError`` 也共用 ``Error`` 基类 (MRO: ``TimeoutError → Error``),
   不区分两者会把 race detector 拉宽到 timeout (语义不同: timeout = network
   慢, race = context 结构破坏), 让 polling 超时也被误诊为 race。

新设计
------

使用三段式检测:

* Primary: ``isinstance(e, patchright.async_api.Error)`` 且
  ``not isinstance(e, TimeoutError)``。TimeoutError 显式排除, 避免
  polling 超时被 race 化。
* Narrow: ``type(e).__name__ in {TargetClosedError, PageClosedError,
  ContextClosedError, BrowserClosedError}``。如果 patchright 后续大版本
  把 race-specific class 提到 ``async_api.__all__``, 派生类实例自然得到
  这一属性 (Python 自动: ``__class__.__name__`` = class literal name)。
* Belt-and-suspenders: 当 ``type(e).__name__ == "Error"`` (基类 throw) 时,
  走 message substring 兜底, 覆盖 2026-06 现有 patchright 形态
  (``context or browser has been closed`` / ``Target page``)。

``is_patchright_race(e) -> bool`` 是 pure function, 跨平台可复用
(Douyin / Xiaohongshu / Bilibili 等未来 uploader 会需要同一条 race
分类路径)。

设计 trade-off (文档化):
   TimeoutError 是 race-mask blind spot: 在 Linux OOM killer 关闭
   context 后, ``page.wait_for_url`` 等可能降级抛 TimeoutError 而非
   TargetClosedError。当前 classifier TimeoutError → False, caller 走
   polling_soft_failures escape path。这个是 design call — 不把网络超时
   与结构性 race 混为一谈, 接受 OOM-killer 类 race 改走 soft-unstable
   recover 而非快 re-login。
"""
from __future__ import annotations

from patchright.async_api import Error as PatchrightError
from patchright.async_api import TimeoutError as PatchrightTimeoutError

# patchright v1.40+ 预期会公开的 race-specific class 名
_KNOWN_RACE_NAMES = frozenset({
    "TargetClosedError",
    "PageClosedError",
    "ContextClosedError",
    "BrowserClosedError",
})

# 2026-06 patchright 基类 throw 时 str(e) 实际包含的 substring。
# 当 patchright 未细化到 race-specific class, 用这两个 substring 兜底。
_RACE_MSG_SUBSTRINGS = (
    "context or browser has been closed",
    "Target page",
)


def is_patchright_race(e: BaseException) -> bool:
    """判断 ``e`` 是否表示 patchright 的 context/page/browser race。

    race ≠ timeout: ``TimeoutError`` 永远返回 ``False``。race 是结构性关闭
    mid-flight (context / page / browser 在执行中消失), timeout 是 network
    容忍时间耗尽, 二者 retry / surface 语义完全不同 (见模块 docstring
    race-mask blind spot 段落)。

    Args:
        e: 待分类的 exception 实例。

    Returns:
        ``True`` 表示 race (caller 应走 🩻 + early-return / raise); ``False``
        表示非 race (timeout / DNS / TLS / 通用 Exception / 不相关库抛错)。
    """
    if not isinstance(e, PatchrightError):
        return False
    if isinstance(e, PatchrightTimeoutError):
        return False

    # narrow: 已知 race-specific class name (patchright v1.40+ 派生类自动命中)
    cls_name = type(e).__name__
    if cls_name in _KNOWN_RACE_NAMES:
        return True

    # belt-and-suspenders: 旧 patchright 基类 throw (type(e).__name__ == "Error")
    msg = str(e)
    return any(sub in msg for sub in _RACE_MSG_SUBSTRINGS)
