"""Minimal auth route smoke tests (SQLite modular backend)."""
from __future__ import annotations

import os

import pytest

from web_runner import create_app


@pytest.fixture
def client_auth_off(monkeypatch):
    monkeypatch.setenv("SAU_AUTH_ENABLED", "false")
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def client_auth_on(monkeypatch):
    monkeypatch.setenv("SAU_AUTH_ENABLED", "true")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"
    with app.test_client() as c:
        yield c


def test_me_synthetic_when_auth_disabled(client_auth_off):
    resp = client_auth_off.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["user"]["email"] == "local@sau.dev"
    assert body["data"]["user"]["role"] == "admin"


def test_me_401_when_auth_enabled_and_anonymous(client_auth_on):
    resp = client_auth_on.get("/api/auth/me")
    assert resp.status_code == 401


def test_logout_always_ok(client_auth_off):
    resp = client_auth_off.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True


def test_sse_token_local(client_auth_off):
    resp = client_auth_off.get("/api/auth/sse-token")
    assert resp.status_code == 200
    assert resp.get_json()["data"]["token"] == "local-dev"
