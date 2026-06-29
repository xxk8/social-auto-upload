"""Tests for web_runner/routes/analytics.py helpers and endpoints.

Regression coverage for _parse_date ISO-8601 datetime string handling
(PR fix: frontend sends ``2026-06-21T02:37:54.362Z`` but _parse_date
previously only accepted ``YYYY-MM-DD``).
"""

from __future__ import annotations

import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from web_runner import create_app

# 直接从 ``web_runner.db`` import (兜底 helper 的真实所在地)。
# ``routes/analytics`` 仍 re-export 别名以保持向后兼容,
# 但 tests 锁定 invariant 时绑到源头更稳。
from web_runner.db import parse_date_param as _parse_date
from web_runner.routes.analytics import _clamp_date_range, _today_str


class TestParseDate:
    """Regression tests for _parse_date — must accept both plain dates
    and ISO-8601 datetime strings (with or without Z suffix)."""

    def test_plain_date_unchanged(self) -> None:
        assert _parse_date("2026-06-21") == "2026-06-21"

    def test_iso_datetime_with_z_suffix(self) -> None:
        """Frontend sends ``2026-06-21T02:37:54.362Z`` — truncate to date."""
        assert _parse_date("2026-06-21T02:37:54.362Z") == "2026-06-21"

    def test_iso_datetime_without_z(self) -> None:
        assert _parse_date("2026-06-21T02:37:54.362") == "2026-06-21"

    def test_iso_datetime_with_offset(self) -> None:
        assert _parse_date("2026-06-21T10:37:54.362+08:00") == "2026-06-21"

    def test_iso_datetime_space_separator(self) -> None:
        """``datetime.fromisoformat`` also accepts space-separated form."""
        assert _parse_date("2026-06-21 02:37:54.362") == "2026-06-21"

    def test_malicious_or_garbage_input_falls_back_to_default(self) -> None:
        """Non-date strings must not crash; they fall back to default offset."""
        result = _parse_date("not-a-date", default_days_ago=0)
        # Should be today (within a few ms tolerance of the call)
        expected = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert result == expected

    def test_none_falls_back_to_default(self) -> None:
        result = _parse_date(None, default_days_ago=7)
        expected = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
        assert result == expected

    def test_empty_string_falls_back_to_default(self) -> None:
        result = _parse_date("", default_days_ago=30)
        expected = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        assert result == expected


class TestParseDateSafetyNet:
    """鲁棒兜底 (safety net) tests.

    锁定 invariant: ``_parse_date`` (alias 到 ``web_runner.db.parse_date_param``)
    必须对**任何**输入返回 ``YYYY-MM-DD`` 字符串,绝不向调用方抛异常。
    防止未来 refactor 不小心删掉顶层 ``except Exception`` 兜底
    (那种删法会让前端异常输入重新触发 500, 同时无声 nested 500 链路
    会污染 error_events 表,运维难定位)。
    """

    def test_bytes_input_falls_back_to_default(self) -> None:
        """bytes 输入 (前端 bug / multipart 表单异常) 必须门槛。"""
        result = _parse_date(b"2026-06-21", default_days_ago=0)
        expected = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert result == expected

    def test_list_input_falls_back_to_default(self) -> None:
        """list 输入 — 触发 ``list.replace`` AttributeError, 顶层 except 兜住。"""
        result = _parse_date(["2026-06-21"], default_days_ago=0)
        expected = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert result == expected

    def test_dict_input_falls_back_to_default(self) -> None:
        """dict 输入 (某些 WSGI 极端路径) — 顶层兜底。"""
        result = _parse_date({"date": "2026-06-21"}, default_days_ago=0)
        expected = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert result == expected

    def test_int_input_falls_back_to_default(self) -> None:
        """int 输入 — ``int.replace`` 不存在, AttributeError 被顶层接住。

        这是一条特殊的覆盖: int 走 strptime 会 TypeError (走 inner except
        嘴口向下走), 走 ``int.replace`` 会 AttributeError (走顶层 except)。
        两层 except 都证实生效, 不是只靠一层。"""
        result = _parse_date(20260621, default_days_ago=0)
        expected = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert result == expected

    def test_attributeerror_on_replace_falls_back(self) -> None:
        """Custom 对象 (``__bool__=True`` 但 ``.replace`` 抛 AttributeError)
         —— 模拟刺穿 inner ``except (ValueError, TypeError)`` 的异常类型
         来验证顶层 ``except Exception`` 的 invariant。

        如果未来有人重构时**误**把顶层 except 缩成 \
        ``except (ValueError, TypeError, AttributeError)``,本测试会误下
        穿过层后【不在 WARNING 日志场景】踩出表面 (仍跳不进
        WARNING 检查), 一个独立的安全网 test 还是需要的。"
        """

        class _RaiseAttrError:
            def __bool__(self) -> bool:
                return True

            @property
            def replace(self):
                raise AttributeError("simulated no-replace-method")

        result = _parse_date(_RaiseAttrError(), default_days_ago=0)
        expected = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert result == expected

    def test_safety_net_logs_warning_with_failing_input(self, caplog) -> None:
        """顶层兜底触发时, ``web_runner.db`` logger 必须输出 WARNING,
        把失败输入 + exception 类型告诉运维 (不是默默 fail)。

        "可见的 graceful degradation" 是安全兑底的核心语义。
        如果未来重构把 WARNING 删了,本测试会第一时间报错,避免运维
        靠 traceback 才能看出坏输入源头。"""

        class _RaiseAttrError:
            def __bool__(self) -> bool:
                return True

            @property
            def replace(self):
                raise AttributeError("simulated no-replace-method")

        with caplog.at_level("WARNING", logger="web_runner.db"):
            _parse_date(_RaiseAttrError(), default_days_ago=0)
        warnings_with_marker = [
            r for r in caplog.records if r.name == "web_runner.db" and "parse_date_param" in r.message
        ]
        assert warnings_with_marker, (
            f"expected parse_date_param WARNING on web_runner.db logger, "
            f"got: {[(r.name, r.levelname, r.message) for r in caplog.records]}"
        )

    def test_sql_injection_probe_does_not_500(self) -> None:
        """SQL 注入探测 ``?from=' OR 1=1 --``: strptime/fromisoformat 不会
        执行 SQL,但 limit 我们对任意垃圾串都不能 500。而最终返回的是
        fallback 日期,SQL 层完全是 YYYY-MM-DD 字符串,根本不走 SQL。
        这是第二道防线 — 防止未来某个 factoring 错误从 db.py 拿走
        兜底后路由层临时接字符串。"""
        result = _parse_date("' OR 1=1 --", default_days_ago=0)
        expected = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert result == expected


class TestClampDateRange:
    def test_range_within_limit_unchanged(self) -> None:
        assert _clamp_date_range("2026-06-01", "2026-06-07", max_days=7) == ("2026-06-01", "2026-06-07")

    def test_range_exceeds_limit_clamped(self) -> None:
        assert _clamp_date_range("2026-05-01", "2026-06-07", max_days=7) == ("2026-05-31", "2026-06-07")

    def test_single_day_range(self) -> None:
        assert _clamp_date_range("2026-06-07", "2026-06-07", max_days=7) == ("2026-06-07", "2026-06-07")


class TestTodayStr:
    def test_returns_today_utc(self) -> None:
        expected = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert _today_str() == expected


@pytest.fixture
def app():
    """Flask test client for analytics endpoint tests."""
    # Patch _sync_cookie_files_to_db so create_app() doesn't try to
    # insert real cookie files into the test DB (avoids RETURNING-id
    # quirks when account_groups rows don't yet exist).
    import web_runner.utils as wr_utils

    with patch.object(wr_utils, "_sync_cookie_files_to_db"):
        application = create_app()
    application.config["TESTING"] = True
    with tempfile.TemporaryDirectory() as tmp_dir:
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = Path(tmp_dir)
        try:
            with application.test_client() as client:
                yield client
        finally:
            wr_utils.COOKIES_DIR = orig_cookies_dir


class TestAnalyticsSummaryEndpoint:
    """Endpoint-level regression: verify ISO datetime query params do not 500."""

    def test_summary_with_iso_datetime_params(self, app) -> None:
        """Reproducer for the 500 when frontend sends ISO-8601 datetimes."""
        resp = app.get(
            "/api/analytics/summary?from=2026-06-21T02:37:54.362Z&to=2026-06-28T02:37:54.362Z",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert "data" in data
        assert isinstance(data["data"]["total"], int)

    def test_summary_with_plain_date_params(self, app) -> None:
        resp = app.get("/api/analytics/summary?from=2026-06-21&to=2026-06-28")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True

    def test_summary_without_params_uses_defaults(self, app) -> None:
        resp = app.get("/api/analytics/summary")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
