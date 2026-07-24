"""IP proxy pool (vendored subset of MediaCrawler ``proxy/proxy_ip_pool.py``)."""
from __future__ import annotations

from crawler.proxy.proxy_ip_pool import (
    create_ip_pool,
    get_proxy_url,
    IpPool,
    StaticIpPool,
)

__all__ = ["create_ip_pool", "get_proxy_url", "IpPool", "StaticIpPool"]
