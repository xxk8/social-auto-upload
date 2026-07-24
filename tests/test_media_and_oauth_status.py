# -*- coding: utf-8 -*-
"""Smoke: media health endpoints + oauth status + db backend name."""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("SAU_AUTH_ENABLED", "false")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("SAU_AUTH_ENABLED", "false")
    from web_runner import create_app

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_oauth_status_json(client):
    res = client.get("/api/auth/oauth/status")
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert "google" in body["data"]
    assert "github" in body["data"]


def test_media_health_endpoints(client):
    for path in (
        "/api/video/clip/health",
        "/api/subtitle/health",
        "/api/thumbnail/health",
    ):
        res = client.get(path)
        assert res.status_code == 200, path
        assert res.get_json()["success"] is True


def test_health_reports_db_backend(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert data.get("db") == "postgres"


def test_db_backend_is_postgres_only():
    from web_runner.db import backend_name, require_database_url

    assert backend_name() == "postgres"
    assert require_database_url().startswith("postgresql://")
