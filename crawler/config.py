"""Crawler runtime configuration.

Vendored subset of MediaCrawler's ``config/base_config.py``. The
vendor drops MongoDB / CDP-mode / WebUI options (D3 of design.md —
storage is PG-only, browser driver is patchright via the existing
``uploader/*_uploader`` scripts).

Env-driven defaults (read once at import time):

    * ``SAU_CRAWLER_HEADLESS``        — bool, default ``True``
    * ``SAU_CRAWLER_ENABLE_IP_PROXY`` — bool, default ``False``
    * ``SAU_CRAWLER_IP_PROXY_PROVIDER`` — ``"static"`` / ``"kuaidaili"``
      / ``"wandouhttp"``, default ``"static"``
    * ``SAU_CRAWLER_STATIC_PROXY_URL`` — URL when provider=static,
      default ``""``
    * ``SAU_CRAWLER_REQUEST_DELAY``   — seconds (float), default ``1.0``
    * ``SAU_CRAWLER_SAVE_DATA_OPTION`` — ``"saulite"`` is the only
      supported value (D3: storage is PG-only).
    * ``SAU_CRAWLER_MAX_COMMENTS``    — int, default ``100``
    * ``SAU_CRAWLER_MAX_SEARCH_PAGES`` — int, default ``5``
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal


def _env_bool(key: str, default: bool) -> bool:
    raw = os.environ.get(key, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_float(key: str, default: float) -> float:
    raw = os.environ.get(key, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_str(key: str, default: str = "") -> str:
    """Strip + fall-through-to-default for env-string knobs.

    Used by :class:`BaseConfig` for any string-typed env var
    (``SAU_XHS_SIGN_MODE`` etc.) so an empty value picks the default
    instead of an empty string. Round-MC-2024-xhs-signing.
    """
    raw = os.environ.get(key, default).strip()
    return raw or default


@dataclass(frozen=True)
class BaseConfig:
    """Immutable crawler config snapshot.

    Frozen dataclass (Tasks 3.1 + 3.3 of tasks.md): once imported, a
    process can rely on the values not changing underfoot. Sub-crawlers
    read the values via :data:`BASE_CONFIG`.
    """

    headless: bool = field(default_factory=lambda: _env_bool("SAU_CRAWLER_HEADLESS", True))
    enable_ip_proxy: bool = field(default_factory=lambda: _env_bool("SAU_CRAWLER_ENABLE_IP_PROXY", False))
    ip_proxy_provider: Literal["static", "kuaidaili", "wandouhttp"] = field(
        default_factory=lambda: os.environ.get("SAU_CRAWLER_IP_PROXY_PROVIDER", "static").strip() or "static"  # type: ignore[return-value]
    )
    static_proxy_url: str = field(
        default_factory=lambda: os.environ.get("SAU_CRAWLER_STATIC_PROXY_URL", "").strip()
    )
    request_delay: float = field(default_factory=lambda: _env_float("SAU_CRAWLER_REQUEST_DELAY", 1.0))
    save_data_option: str = field(
        default_factory=lambda: os.environ.get("SAU_CRAWLER_SAVE_DATA_OPTION", "saulite").strip() or "saulite"
    )
    max_comments: int = field(default_factory=lambda: _env_int("SAU_CRAWLER_MAX_COMMENTS", 100))
    max_search_pages: int = field(default_factory=lambda: _env_int("SAU_CRAWLER_MAX_SEARCH_PAGES", 5))
    # XHS signing mode — round-MC-2024-xhs-signing.
    #
    # ``"dom"`` — current Playwright DOM-scraping path (round-MC-2024-xhs-realization).
    # One Chromium launch per call; honors ``SAU_CRAWLER_REQUEST_DELAY``.
    # This is the default because the DOM mode is verified-working
    # against today's XHS frontend.
    #
    # ``"sign"`` — MediaCrawler-style signed API path. Uses ``httpx`` +
    # ``xhshow`` to call XHS's signed endpoints directly
    # (``/api/sns/web/v1/search/notes`` etc.), bypassing Chromium. Up to
    # 10× faster but the signing algo is brittle — XHS regenerates it on
    # every frontend push, after which signatures fail en masse and the
    # caller cascades back to ``"dom"``. Opt-in only.
    sign_mode: Literal["dom", "sign"] = field(
        default_factory=lambda: _env_str("SAU_XHS_SIGN_MODE", "dom").lower() or "dom"  # type: ignore[return-value]
    )

    def __post_init__(self) -> None:
        # Task 3.3 contract: a non-saulite value is a bug. Surface it
        # eagerly at import-time so a misconfig doesn't silently
        # disappear into the empty ``save_data_option`` branch.
        if self.save_data_option != "saulite":
            raise RuntimeError(
                f"SAU_CRAWLER_SAVE_DATA_OPTION={self.save_data_option!r} is "
                f"unsupported. Only 'saulite' (PostgreSQL via web_runner/db.py) "
                f"is wired in this round."
            )
        # Round-MC-2024-xhs-signing contract: validate the env-driven
        # ``sign_mode`` early so a typo (e.g. ``"sig"`` instead of
        # ``"sign"``) fails loudly at import-time rather than silently
        # dispatching everything to ``"dom"`` and confusing an operator
        # who IS expecting the fast path.
        if self.sign_mode not in {"dom", "sign"}:
            raise RuntimeError(
                f"SAU_XHS_SIGN_MODE={self.sign_mode!r} is invalid. "
                f"Valid values: 'dom' | 'sign'."
            )


# Module-level singleton — read once at import. Tests that need to
# override a value can ``monkeypatch.setattr(crawler.config, 'BASE_CONFIG', ...)``
# since frozen-dataclass instances are read-only at the attribute
# level (Tasks 3.1 docs).
BASE_CONFIG: BaseConfig = BaseConfig()
