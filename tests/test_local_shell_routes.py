# -*- coding: utf-8 -*-
"""Smoke tests for local-shell blueprints (admin / hotlist / scheduling / oauth / crawl)."""
from __future__ import annotations

import os

import pytest

# Keep auth off so admin_required is a no-op for local shell smoke.
os.environ.setdefault("SAU_AUTH_ENABLED", "false")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("SAU_AUTH_ENABLED", "false")

    from web_runner import create_app

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_oauth_status_reports_shape(client):
    res = client.get("/api/auth/oauth/status")
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert "google" in body["data"]
    assert "github" in body["data"]
    assert isinstance(body["data"]["google"], bool)
    assert isinstance(body["data"]["github"], bool)


def test_oauth_google_login_json_when_unconfigured(client, monkeypatch):
    # Force unconfigured path regardless of .env secrets.
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
    import web_runner.oauth as oauth_mod

    monkeypatch.setattr(oauth_mod, "_GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr(oauth_mod, "_GOOGLE_CLIENT_SECRET", "")
    res = client.get(
        "/api/auth/google/login",
        headers={"Accept": "application/json"},
    )
    assert res.status_code == 501
    body = res.get_json()
    assert body["success"] is False
    assert body.get("configured") is False


def test_scheduling_insights_envelope(client):
    res = client.get("/api/scheduling/insights")
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert "insights" in body["data"]
    assert "ready" in body["data"]


def test_admin_users_when_auth_disabled(client):
    res = client.get("/api/admin/users")
    # Local shell with auth off should allow admin_required passthrough
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert isinstance(body["data"], list)


def test_hotlist_catalog_reachable(client):
    res = client.get("/api/hotlist")
    assert res.status_code == 200
    body = res.get_json()
    assert body is not None


def test_crawl_health_reachable(client):
    res = client.get("/api/crawl/health")
    assert res.status_code == 200
    body = res.get_json()
    assert body is not None
