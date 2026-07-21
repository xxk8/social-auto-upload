"""Integration tests for ``POST /api/studio/projects/<id>/generate``.

OpenSpec ref: ``openspec/changes/studio-ai-script-generation/tasks.md §7.2``.
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from web_runner import create_app  # noqa: E402
from web_runner.db import get_database  # noqa: E402
from web_runner.routes import studio as studio_module  # noqa: E402

from tests._login_helpers import _login_as  # noqa: E402


@pytest.fixture
def app():
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "true"}, clear=False):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
        application.config["TESTING"] = True
        application.config["SECRET_KEY"] = "test-secret-key-for-studio-generate"
        with tempfile.TemporaryDirectory() as tmp_dir:
            import web_runner.utils as wr_utils
            orig = wr_utils.COOKIES_DIR
            wr_utils.COOKIES_DIR = Path(tmp_dir)
            with application.test_client() as client:
                yield client
            wr_utils.COOKIES_DIR = orig


@pytest.fixture(autouse=True)
def _clean_tables():
    db = get_database()
    cleanup = [
        "DELETE FROM studio_assets",
        "DELETE FROM studio_episodes",
        "DELETE FROM studio_projects",
        "DELETE FROM usage_logs",
        "DELETE FROM users",
    ]
    for sql in cleanup:
        try:
            db.execute(sql)
        except Exception:
            pass
    yield
    for sql in cleanup:
        try:
            db.execute(sql)
        except Exception:
            pass


def _create_project(app, email: str, *, synopsis: str = "syn"):
    _login_as(app, email)
    resp = app.post("/api/studio/projects", json={"title": "test", "synopsis": synopsis})
    assert resp.status_code in (200, 201)
    return resp.get_json()["data"]["id"]


def _yield_data_event(content: str) -> str:
    return f"event: data\ndata: {json.dumps({'content': content}, ensure_ascii=False)}\n\n"


def _yield_done_event(full_content: str) -> str:
    return f"event: done\ndata: {json.dumps({'content': full_content}, ensure_ascii=False)}\n\n"


def _yield_generation_done_event(payload: dict) -> str:
    return f"event: generation_done\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


class TestGenerateRequiresAuth:
    def test_generate_unauth_returns_401(self, app):
        resp = app.post("/api/studio/projects/1/generate")
        assert resp.status_code == 401


class TestGenerateProjectNotFound:
    def test_generate_missing_project_returns_404(self, app):
        _login_as(app, "studio_gen_404@test.com")
        resp = app.post("/api/studio/projects/999999/generate")
        assert resp.status_code == 404


class TestGenerateOwnerIsolation:
    def test_generate_other_users_project_returns_404(self, app):
        project_id = _create_project(app, "studio_gen_owner_a@test.com")

        _login_as(app, "studio_gen_owner_b@test.com")
        resp = app.post(f"/api/studio/projects/{project_id}/generate")
        assert resp.status_code == 404


class TestGenerateSuccess:
    def test_generate_persists_episodes(self, app):
        project_id = _create_project(app, "studio_gen_success@test.com")

        episodes_payload = {
            "episodes": [
                {"act": "起", "title": "开端", "scenes": [], "dialogues": []},
                {"act": "承", "title": "递进", "scenes": [], "dialogues": []},
                {"act": "转", "title": "转折", "scenes": [], "dialogues": []},
                {"act": "合", "title": "结局", "scenes": [], "dialogues": []},
            ]
        }

        def fake_stream(*args, **kwargs):
            yield _yield_data_event("生成中")
            yield _yield_generation_done_event(episodes_payload)

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        body = resp.get_data(as_text=True)
        assert "event: generation_done" in body

        db = get_database()
        rows = db.fetch_all(
            "SELECT act, title FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
            (project_id,),
        )
        assert len(rows) == 4
        assert [r["act"] for r in rows] == ["起", "承", "转", "合"]

    def test_generate_sse_event_sequence(self, app):
        project_id = _create_project(app, "studio_gen_sse@test.com")

        def fake_stream(*args, **kwargs):
            yield _yield_data_event("第一幕")
            yield _yield_done_event("{}")

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        body = resp.get_data(as_text=True)
        lines = [line for line in body.split("\n") if line]
        assert any(line == "event: data" for line in lines)
        assert any(line == "event: done" for line in lines)

    def test_generate_appends_to_existing_episodes(self, app):
        project_id = _create_project(app, "studio_gen_append@test.com")

        # Seed one existing episode manually.
        db = get_database()
        db.execute(
            "INSERT INTO studio_episodes (project_id, episode_no, act, title, scenes_json, dialogues_json, status, created_at) "
            "VALUES (?, 1, '起', '已有开端', '[]', '[]', 'draft', ?)",
            (project_id, datetime.now(timezone.utc).isoformat()),
        )

        episodes_payload = {
            "episodes": [
                {"act": "起", "title": "新开端", "scenes": [], "dialogues": []},
                {"act": "承", "title": "新递进", "scenes": [], "dialogues": []},
            ]
        }

        def fake_stream(*args, **kwargs):
            yield _yield_generation_done_event(episodes_payload)

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        # Fully consume the SSE stream so the route triggers persistence.
        resp.get_data(as_text=True)

        rows = db.fetch_all(
            "SELECT episode_no, act, title FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
            (project_id,),
        )
        assert len(rows) == 3
        assert [r["episode_no"] for r in rows] == [1, 2, 3]
        assert rows[1]["title"] == "新开端"
        assert rows[2]["title"] == "新递进"

    def test_generate_filters_invalid_acts(self, app):
        project_id = _create_project(app, "studio_gen_acts@test.com")

        episodes_payload = {
            "episodes": [
                {"act": "起", "title": "开端", "scenes": [], "dialogues": []},
                {"act": "无效", "title": "跳过", "scenes": [], "dialogues": []},
                {"act": "合", "title": "结局", "scenes": [], "dialogues": []},
            ]
        }

        def fake_stream(*args, **kwargs):
            yield _yield_generation_done_event(episodes_payload)

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        resp.get_data(as_text=True)

        db = get_database()
        rows = db.fetch_all(
            "SELECT act, title FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
            (project_id,),
        )
        assert len(rows) == 2
        assert rows[0]["act"] == "起"
        assert rows[1]["act"] == "合"

    def test_generate_empty_episodes_does_not_persist(self, app):
        project_id = _create_project(app, "studio_gen_empty@test.com")

        def fake_stream(*args, **kwargs):
            yield _yield_generation_done_event({"episodes": []})

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        resp.get_data(as_text=True)

        db = get_database()
        rows = db.fetch_all(
            "SELECT * FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        )
        assert len(rows) == 0

    def test_generate_persists_scenes_and_dialogues(self, app):
        project_id = _create_project(app, "studio_gen_scenes@test.com")

        episodes_payload = {
            "episodes": [
                {
                    "act": "起",
                    "title": "开端",
                    "scenes": [{"title": "场景1", "body": "开场", "duration_sec": 3}],
                    "dialogues": [{"speaker": "主角", "text": "开始吧"}],
                },
            ]
        }

        def fake_stream(*args, **kwargs):
            yield _yield_generation_done_event(episodes_payload)

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        resp.get_data(as_text=True)

        db = get_database()
        row = db.fetch_one(
            "SELECT scenes_json, dialogues_json FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        )
        assert row is not None
        scenes = db.json_load(row["scenes_json"])
        dialogues = db.json_load(row["dialogues_json"])
        assert len(scenes) == 1
        assert scenes[0]["title"] == "场景1"
        assert len(dialogues) == 1
        assert dialogues[0]["text"] == "开始吧"

    def test_generate_updates_project_updated_at(self, app):
        project_id = _create_project(app, "studio_gen_updated@test.com")

        db = get_database()
        before = db.fetch_one(
            "SELECT updated_at FROM studio_projects WHERE id = ?",
            (project_id,),
        )["updated_at"]

        # Patch _now_iso so the update produces a deterministic later timestamp.
        # The patch context must cover resp.get_data() because persistence only
        # runs after the SSE generator is fully consumed by the client.
        later_timestamp = "2099-01-01T00:00:00+00:00"

        episodes_payload = {
            "episodes": [
                {"act": "起", "title": "开端", "scenes": [], "dialogues": []},
            ]
        }

        def fake_stream(*args, **kwargs):
            yield _yield_generation_done_event(episodes_payload)

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            with patch.object(studio_module, "_now_iso", return_value=later_timestamp):
                resp = app.post(f"/api/studio/projects/{project_id}/generate")
                assert resp.status_code == 200
                # Persistence runs only after the SSE stream is consumed.
                resp.get_data(as_text=True)

        after = db.fetch_one(
            "SELECT updated_at FROM studio_projects WHERE id = ?",
            (project_id,),
        )["updated_at"]
        assert after == later_timestamp
        assert after != before


class TestGenerateErrors:
    def test_generate_exception_mid_stream_yields_error(self, app):
        project_id = _create_project(app, "studio_gen_exc@test.com")

        def fake_stream(*args, **kwargs):
            yield _yield_data_event("开始生成")
            raise RuntimeError("stream boom")

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        body = resp.get_data(as_text=True)
        assert "event: error" in body

        db = get_database()
        rows = db.fetch_all(
            "SELECT * FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        )
        assert len(rows) == 0

    def test_generate_error_event_does_not_persist(self, app):
        project_id = _create_project(app, "studio_gen_err@test.com")

        def fake_stream(*args, **kwargs):
            yield "event: error\ndata: {\"message\": \"AI 生成失败\"}\n\n"

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        body = resp.get_data(as_text=True)
        assert "event: error" in body

        db = get_database()
        rows = db.fetch_all(
            "SELECT * FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        )
        assert len(rows) == 0

    def test_generate_invalid_generation_done_json_does_not_persist(self, app):
        project_id = _create_project(app, "studio_gen_invalid_json@test.com")

        def fake_stream(*args, **kwargs):
            yield "event: generation_done\ndata: not-json\n\n"

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        resp.get_data(as_text=True)

        db = get_database()
        rows = db.fetch_all(
            "SELECT * FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        )
        assert len(rows) == 0

class TestGeneratePersistError:
    def test_persist_error_does_not_crash_stream(self, app):
        project_id = _create_project(app, "studio_gen_persist_err@test.com")

        def fake_stream(*args, **kwargs):
            payload = json.dumps({"episodes": [{"act": "起"}]}, ensure_ascii=False)
            yield f"event: generation_done\ndata: {payload}\n\n"

        def boom_persist(*args, **kwargs):
            raise RuntimeError("DB boom")

        with patch("web_runner.studio_engine.generate_episodes_sse", fake_stream):
            with patch("web_runner.routes.studio._persist_generated_episodes", boom_persist):
                resp = app.post(f"/api/studio/projects/{project_id}/generate")

        assert resp.status_code == 200
        body = resp.get_data(as_text=True)
        assert "event: generation_done" in body
