"""Tests for web_runner/routes/ai.py endpoint coverage.

PR4.3 dropped db_lock across web_runner/*, but routes/ai.py didn't have
endpoint tests until this round, so the lock removal was unverified on
this surface. This file covers the 5 DB-touching endpoints:

  * GET  /api/ai/config       — counts real DB + env OPENROUTE_API_KEY
  * POST /api/ai/config       — INSERT via insert_returning_id + 409 on dup
  * DELETE /api/ai/config     — by key_id OR all
  * GET  /api/ai/keys         — masked fields + rate_limited flag
  * POST /api/ai/keys/batch   — per-row insert with unique-violation skip

`/api/ai/generate` and `/api/ai/models` route through openrouter HTTP
mock + queue worker; they have no DB-touching state machines and fall
under a separate coverage PR (queue worker + http mock plumbing).

Test fixture pattern mirrors tests/test_web_shell.py: create_app() per
test + cookies dir rebind + ``db.execute("DELETE FROM ai_api_keys")``
before & after each test for cross-test isolation.
"""

from __future__ import annotations

import tempfile
from datetime import datetime
from pathlib import Path

import pytest

from web_runner import create_app


@pytest.fixture
def app():
    """Flask test client with isolated cookies dir + ai_api_keys purge.

    Mirrors the fixture in tests/test_web_shell.py. Uses conftest's
    session-shared in-memory SQLite + SAU_DB_DIALECT=sqlite (forced by
    tests/conftest.py at import time).
    """
    from web_runner import utils as wr_utils
    from web_runner.db import get_database

    application = create_app()
    application.config["TESTING"] = True

    # Pre-test purge so we never leak rows from a previous test.
    get_database().execute("DELETE FROM ai_api_keys")

    with tempfile.TemporaryDirectory() as tmp_dir:
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = Path(tmp_dir)
        try:
            with application.test_client() as client:
                yield client
        finally:
            wr_utils.COOKIES_DIR = orig_cookies_dir
            # Post-test purge so cross-test pollution doesn't accumulate
            # (some tests insert rows outside the http boundary).
            get_database().execute("DELETE FROM ai_api_keys")


def _seed_key(
    api_key: str,
    masked: str | None = None,
    rate_limited_at: str | None = None,
) -> int:
    """Insert a row directly into ai_api_keys for test fixture setup.

    Returns the inserted row id. Seeded via ``db.execute + db.last_insert_id``
    (rather than ``insert_returning_id``) so the fixture doesn't double-up
    on whatever RETURNING-compat quirks the host sqlite3 has — PR4.3
    already pinned that relationship.
    """
    from web_runner.db import get_database

    if not masked:
        masked = api_key[:8] + "****" + api_key[-4:] if len(api_key) > 12 else "****"
    db = get_database()
    db.execute(
        "INSERT INTO ai_api_keys (api_key, masked, created, rate_limited_at) " "VALUES (?, ?, ?, ?)",
        (api_key, masked, datetime.now().isoformat(timespec="seconds"), rate_limited_at),
    )
    return db.last_insert_id()


class TestAiConfigGet:
    """GET /api/ai/config — reports whether any api key (DB row OR env)
    is configured, plus the live row count for the DB-only signal."""

    def test_unconfigured_without_env_or_db(self, app, monkeypatch) -> None:
        monkeypatch.delenv("OPENROUTE_API_KEY", raising=False)
        resp = app.get("/api/ai/config")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["configured"] is False
        assert data["data"]["key_count"] == 0

    def test_configured_via_env_var_only(self, app, monkeypatch) -> None:
        monkeypatch.setenv("OPENROUTE_API_KEY", "sk-env-var-only-test")
        resp = app.get("/api/ai/config")
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["configured"] is True
        assert data["data"]["key_count"] == 0

    def test_configured_via_db_rows(self, app, monkeypatch) -> None:
        monkeypatch.delenv("OPENROUTE_API_KEY", raising=False)
        _seed_key("sk-db-1234567890abcdef")
        _seed_key("sk-db-2234567890abcdef01")
        resp = app.get("/api/ai/config")
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["configured"] is True
        assert data["data"]["key_count"] == 2


class TestAiConfigSet:
    """POST /api/ai/config — INSERT key with masked display + key_id.

    Pinpoints the IntegrityError → 409 contract PR4.3 added (catch
    narrowed from `except Exception` substring diagnosis to the proper
    ``except sqlite3.IntegrityError`` path).
    """

    def test_add_new_key_returns_masked_and_id(self, app) -> None:
        resp = app.post(
            "/api/ai/config",
            json={"api_key": "sk-newkey1234567890abcd"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["configured"] is True
        assert data["data"]["key_masked"] == "sk-newke****abcd"
        assert isinstance(data["data"]["key_id"], int)
        assert data["data"]["key_id"] > 0

    def test_short_key_masks_as_stars_only(self, app) -> None:
        resp = app.post(
            "/api/ai/config",
            json={"api_key": "sk-x"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["data"]["key_masked"] == "****"

    def test_duplicate_key_returns_409_with_chinese_message(self, app) -> None:
        first = app.post(
            "/api/ai/config",
            json={"api_key": "sk-dup1234567890abcd"},
        )
        assert first.status_code == 200
        second = app.post(
            "/api/ai/config",
            json={"api_key": "sk-dup1234567890abcd"},
        )
        assert second.status_code == 409
        data = second.get_json()
        assert data["success"] is False
        assert "已经添加" in data["message"]

    def test_empty_or_missing_api_key_returns_400(self, app) -> None:
        empty = app.post("/api/ai/config", json={"api_key": ""})
        assert empty.status_code == 400

        missing = app.post("/api/ai/config", json={})
        assert missing.status_code == 400


class TestAiConfigDelete:
    """DELETE /api/ai/config — by key_id OR clear-all when key_id omitted.

    Pinpoints the IntegrityError-clean remap that PR4.3 (and PR2's
    broadening to `except Exception`) raised as concern: this path was
    pre-existing and the existing behavior should be preserved end-to-end.
    """

    def test_delete_by_key_id_removes_targeted_row(self, app) -> None:
        keep_id = _seed_key("sk-keep1234567890abcd")
        target_id = _seed_key("sk-del1234567890abcdef")
        resp = app.delete(
            "/api/ai/config",
            json={"key_id": target_id},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True

        from web_runner.db import get_database

        rows = get_database().fetch_all("SELECT id FROM ai_api_keys ORDER BY id ASC")
        assert [r["id"] for r in rows] == [keep_id]

    def test_delete_all_when_no_key_id_empties_table(self, app) -> None:
        _seed_key("sk-aaaa1234567890abcd")
        _seed_key("sk-bbbb1234567890abcdef")
        resp = app.delete("/api/ai/config", json={})
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        from web_runner.db import get_database

        rows = get_database().fetch_all("SELECT api_key FROM ai_api_keys")
        assert rows == []


class TestAiKeysList:
    """GET /api/ai/keys — masked fields + rate_limited boolean per row."""

    def test_empty_state_returns_empty_list(self, app) -> None:
        resp = app.get("/api/ai/keys")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"] == []

    def test_with_keys_returns_masked_and_rate_limited_flag(self, app) -> None:
        _seed_key(
            "sk-healthy1234567890xyz",
            masked="sk-heal****0xyz",
            rate_limited_at=None,
        )
        _seed_key(
            "sk-limited1234567890abc",
            masked="sk-limi****0abc",
            rate_limited_at="2026-06-24T09:00:00",
        )
        resp = app.get("/api/ai/keys")
        data = resp.get_json()
        assert data["success"] is True
        assert len(data["data"]) == 2

        # `_get_all_keys_cached` orders by id ASC; sort the response the
        # same way before asserting so we don't depend on insert order.
        entries = sorted(data["data"], key=lambda k: k["id"])
        assert entries[0]["masked"] == "sk-heal****0xyz"
        assert entries[0]["rate_limited"] is False
        assert entries[1]["masked"] == "sk-limi****0abc"
        assert entries[1]["rate_limited"] is True
        # `api_key` plaintext MUST NOT leak to the response (security).
        for entry in entries:
            assert "api_key" not in entry


class TestAiKeysBatch:
    """POST /api/ai/keys/batch — per-row insert with unique-violation skip.

    Validates that PR4.3's narrowed exception handler still routes
    IntegrityError to ``skipped[...]`` and surfaces other exceptions in
    ``errors[...]`` rather than crashing the whole batch.
    """

    def test_all_new_valid_keys_all_added(self, app) -> None:
        resp = app.post(
            "/api/ai/keys/batch",
            json={
                "keys": [
                    "sk-batch1234567890abcde",
                    "sk-batch2234567890abcdef",
                    "sk-batch3234567890abcdef01",
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["added"] == 3
        assert data["data"]["skipped"] == 0
        assert data["data"]["errors"] == []

    def test_all_invalid_keys_skipped(self, app) -> None:
        resp = app.post(
            "/api/ai/keys/batch",
            json={
                "keys": [
                    "not-sk-prefix-1234abcd",
                    "also-no-prefix-1234",
                    "",
                ]
            },
        )
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["added"] == 0
        assert data["data"]["skipped"] == 3
        assert data["data"]["errors"] == []

    def test_mixed_new_duplicate_and_invalid(self, app) -> None:
        _seed_key("sk-existing1234567890xx")
        resp = app.post(
            "/api/ai/keys/batch",
            json={
                "keys": [
                    "sk-existing1234567890xx",  # duplicate → skipped
                    "sk-newone1234567890abcd01",  # new → added
                    "not-prefixed-skip-this",  # invalid → skipped
                ]
            },
        )
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"]["added"] == 1
        assert data["data"]["skipped"] == 2
        assert data["data"]["errors"] == []

    def test_non_array_keys_field_returns_400(self, app) -> None:
        resp = app.post(
            "/api/ai/keys/batch",
            json={"keys": "not-an-array"},
        )
        assert resp.status_code == 400
        assert resp.get_json()["success"] is False
