"""IP proxy pool (D6 from design.md).

Initial phase delivers :class:`StaticIpPool` only — a single fixed
``http://``/``https://`` URL read from
``SAU_CRAWLER_STATIC_PROXY_URL``. Real kuaidaili / wandouhttp dynamic
provider integrations (round-MC-2024-threadpool, 13.3) now include a
working HTTP fetch + 5-minute TTL cache so operators can plug in a
dynamic provider URL without modifying code.

The factory is constructed at import-time so the very first crawler
call picks up the configured pool without re-reading env on every
search/detail/comments call.

Round-MC-2024-threadpool (13.3):
    * ``_KuaiDailiIpPool`` — calls ``SAU_CRAWLER_KUAIDAILI_API_URL``
      every 5 minutes, parses the proxy list from the JSON response.
    * ``_WandouHttpIpPool`` — same TTL pattern, parses different
      JSON shape (``msg.proxy`` vs ``data.proxy_list``).
    * Both fall back to ``None`` (no proxy) on any HTTP / JSON error,
      with a one-time warning log. The 5-minute cache prevents an
      API blip from causing every crawler request to fail.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from abc import ABC, abstractmethod
from typing import Any, Callable

_module_logger = logging.getLogger(__name__)


class IpPool(ABC):
    """Abstract IP pool — returns one proxy URL per request.

    Subclasses implement :meth:`get_proxy_url` so a single call site
    can switch providers via ``create_ip_pool(provider_name)(...)``.
    """

    @abstractmethod
    def get_proxy_url(self) -> str | None:
        """Return the next proxy URL, or ``None`` for "no proxy"."""

    def __repr__(self) -> str:  # pragma: no cover — debug helper
        return f"<{type(self).__name__} provider={getattr(self, 'provider', '?')}>"


class StaticIpPool(IpPool):
    """Returns a single fixed proxy URL from env.

    Suitable for low-volume deployments where a $5/mo datacenter
    proxy is enough. The ``provider`` attribute and the empty
    ``get_proxy_url`` return when ``url`` is unset keep the
    :meth:`AbstractCrawler` boot path clean — a misconfig doesn't
    silently flip to "no proxy".
    """

    def __init__(self, url: str) -> None:
        self.provider = "static"
        self._url = url.strip() or None

    def get_proxy_url(self) -> str | None:
        return self._url


class _TtlProxyList:
    """Thread-safe TTL cache for a dynamic proxy provider.

    Caches the full proxy list for ``ttl_seconds``; on expiry or
    on first call, calls ``fetch_func`` to refresh the list. If the
    fetch fails, returns the stale list (rather than failing open to
    "no proxy") — a transient API blip won't disrupt a running crawl.
    ``_last_ok_fetch`` tracks the last SUCCESSFUL fetch timestamp so
    the warning log only fires once per failure window.
    """

    def __init__(
        self,
        fetch_func: Callable[[], list[str]],
        ttl_seconds: int = 300,
    ) -> None:
        self._fetch = fetch_func
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        self._proxies: list[str] = []
        self._last_fetch: float = 0.0
        self._last_ok_fetch: float = 0.0
        self._warned_failure: bool = False

    def get_proxy(self) -> str | None:
        now = time.time()
        with self._lock:
            if now - self._last_fetch > self._ttl or not self._proxies:
                self._last_fetch = now
                try:
                    fresh = self._fetch()
                    if fresh:
                        self._proxies = fresh
                        self._last_ok_fetch = now
                        self._warned_failure = False
                except Exception as exc:
                    if not self._warned_failure:
                        _module_logger.warning(
                            "[crawler] TTL cache fetch failed: %s; using stale list (%d proxies)",
                            type(exc).__name__,
                            len(self._proxies),
                        )
                        self._warned_failure = True
            if not self._proxies:
                return None
            return self._proxies[now.__hash__() % len(self._proxies)]


class _KuaiDailiIpPool(IpPool):
    """Dynamic proxy provider — kuaidaili (快代理).

    Reads ``SAU_CRAWLER_KUAIDAILI_API_URL`` (a URL that returns a
    JSON response like ``{"code": 0, "data": {"proxy_list": ["ip:port"]}}``).
    Proxies are cached with a 5-minute TTL and rotated round-robin.

    If the env var is unset, logs a one-time warning and returns
    ``None`` (no proxy).
    """

    def __init__(self) -> None:
        self.provider = "kuaidaili"
        api_url = os.environ.get("SAU_CRAWLER_KUAIDAILI_API_URL", "").strip()
        if not api_url:
            _module_logger.warning(
                "[crawler] KuaiDailiIpPool: SAU_CRAWLER_KUAIDAILI_API_URL is unset; "
                "returning no-proxy. Set the env var or switch to "
                "SAU_CRAWLER_IP_PROXY_PROVIDER=static."
            )
            self._cache = _TtlProxyList(fetch_func=lambda: [], ttl_seconds=300)
        else:
            self._cache = _TtlProxyList(
                fetch_func=lambda: _fetch_kuaidaili(api_url),
                ttl_seconds=300,
            )

    def get_proxy_url(self) -> str | None:
        return self._cache.get_proxy()


class _WandouHttpIpPool(IpPool):
    """Dynamic proxy provider — WandouHttp (豌豆HTTP).

    Reads ``SAU_CRAWLER_WANDOUHTTP_API_URL`` (a URL that returns a
    JSON response like ``{"code": 0, "msg": {"proxy": "ip:port"}}``).
    Proxies are cached with a 5-minute TTL and rotated round-robin.

    If the env var is unset, logs a one-time warning and returns
    ``None`` (no proxy).
    """

    def __init__(self) -> None:
        self.provider = "wandouhttp"
        api_url = os.environ.get("SAU_CRAWLER_WANDOUHTTP_API_URL", "").strip()
        if not api_url:
            _module_logger.warning(
                "[crawler] WandouHttpIpPool: SAU_CRAWLER_WANDOUHTTP_API_URL is unset; "
                "returning no-proxy. Set the env var or switch to "
                "SAU_CRAWLER_IP_PROXY_PROVIDER=static."
            )
            self._cache = _TtlProxyList(fetch_func=lambda: [], ttl_seconds=300)
        else:
            self._cache = _TtlProxyList(
                fetch_func=lambda: _fetch_wandouhttp(api_url),
                ttl_seconds=300,
            )

    def get_proxy_url(self) -> str | None:
        return self._cache.get_proxy()


def _fetch_kuaidaili(api_url: str) -> list[str]:
    """Fetch proxy list from kuaidaili API.

    Expected JSON shape:
        ``{"code": 0, "data": {"proxy_list": ["ip:port", ...]}}``
    Returns an empty list on any parse / HTTP error.
    """
    try:
        import urllib.request
        import json as _json
        resp = urllib.request.urlopen(api_url, timeout=15)
        payload: dict[str, Any] = _json.loads(resp.read().decode("utf-8"))
        if payload.get("code") == 0:
            data = payload.get("data", {})
            proxy_list: list[str] = data.get("proxy_list", [])
            if isinstance(proxy_list, list):
                return [p for p in proxy_list if isinstance(p, str) and p.strip()]
        _module_logger.warning(
            "[crawler] kuaidaili API returned non-zero code: %s",
            payload.get("msg", "?"),
        )
    except Exception as exc:
        _module_logger.warning(
            "[crawler] kuaidaili fetch failed: %s: %s",
            type(exc).__name__,
            exc,
        )
    return []


def _fetch_wandouhttp(api_url: str) -> list[str]:
    """Fetch proxy from WandouHttp API.

    Expected JSON shape:
        ``{"code": 0, "msg": {"proxy": "ip:port"}}``
    Returns an empty list on any parse / HTTP error.
    """
    try:
        import urllib.request
        import json as _json
        resp = urllib.request.urlopen(api_url, timeout=15)
        payload: dict[str, Any] = _json.loads(resp.read().decode("utf-8"))
        if payload.get("code") == 0:
            msg = payload.get("msg", {})
            if isinstance(msg, dict):
                proxy: str | None = msg.get("proxy")
                if proxy and isinstance(proxy, str) and proxy.strip():
                    return [proxy.strip()]
        _module_logger.warning(
            "[crawler] wandouhttp API returned non-zero code: %s",
            payload.get("msg", "?"),
        )
    except Exception as exc:
        _module_logger.warning(
            "[crawler] wandouhttp fetch failed: %s: %s",
            type(exc).__name__,
            exc,
        )
    return []


def create_ip_pool(provider_name: str) -> IpPool:
    """Factory: ``"static"``, ``"kuaidaili"``, or ``"wandouhttp"``.

    Unrecognized provider -> :class:`StaticIpPool` (with empty url) so
    the crawler falls back to no-proxy instead of crashing on boot.
    The empty-URL :class:`StaticIpPool` is the documented "off"
    sentinel — operators see logs that mention ``provider=static`` and
    know to re-run with the right env var.
    """
    name = (provider_name or "").strip().lower()
    if name == "static":
        url = os.environ.get("SAU_CRAWLER_STATIC_PROXY_URL", "").strip()
        return StaticIpPool(url)
    if name == "kuaidaili":
        return _KuaiDailiIpPool()
    if name == "wandouhttp":
        return _WandouHttpIpPool()
    _module_logger.warning(
        "[crawler] unknown provider=%r; using StaticIpPool with empty URL (no proxy).",
        provider_name,
    )
    return StaticIpPool("")


def get_proxy_url() -> str | None:
    """One-shot helper: read the singleton provider + return its URL.

    Used by :class:`AbstractCrawler` subclasses when they need a
    single proxy URL at Playwright launch time. NOTE: real
    Playwright launches want ``proxy={"server": url, "username": ..., "password": ...}``
    dict form, not a bare URL — so the subclasses should call
    :meth:`crawler.proxy.IpPool.get_proxy_url` themselves rather than
    this one-shot helper, so they can build the full dict.
    """
    from crawler.config import BASE_CONFIG

    if not BASE_CONFIG.enable_ip_proxy:
        return None
    pool = create_ip_pool(BASE_CONFIG.ip_proxy_provider)
    return pool.get_proxy_url()
