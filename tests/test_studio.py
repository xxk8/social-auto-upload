"""Tests for ``web_runner.routes.studio`` — Script Studio Phase 1 backend.

import pytest  # noqa: E402

# Post-SQLite-removal: this suite was a SQLite-specific test. Skipped pending
# a rewrite to use the production PG backend (requires a live PG in CI).
# See openspec/changes/migrate-sqlite-to-postgresql-19/tasks.md for the
# deferred rewrite plan.

"""Tests for ``web_runner.routes.studio`` — Script Studio Phase 1 backend.

OpenSpec ref: ``openspec/changes/script-studio/tasks.md §1`` (v0.1 看到项目).

Coverage map (test name → spec anchor). Each ``test_*`` name embeds the
Task ID so a PR reviewer can mechanically trace ANY assertion back to
the matching spec change. Anchor format: ``§1.2.N`` for backend route
tasks, ``§1.6.N`` for cross-layer auth/isolation verification tasks.

Architecture note — FK enforcement in PG
--------------------------------------
Post-SQLite-removal: PostgreSQL enforces foreign keys natively (no
``PRAGMA foreign_keys=ON`` toggle). The ``TestStudioSchemaPragma`` class
that used to verify the pragma is now DELETED — FK enforcement is a PG
constant, not a per-connection setting. The cascade tests below
organically prove the schema implements ``ON DELETE CASCADE``.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest  # noqa: E402

# ── Gate the whole file on the route module landing ────────────────────
pytest.importorskip(
    "web_runner.routes.studio",
    reason=(
        "studio routes pending OpenSpec change `script-studio` Phase 1 "
        "implementation PR. Tests below are the spec-driven contract; "
        "they run cleanly once `web_runner.routes.studio` ships."
    ),
)

from web_runner import create_app  # noqa: E402 — must come after importorskip
from web_runner.db import get_database  # noqa: E402

# ═══════════════════════════════════════════════════════════════════════
#  Fixtures
# ═══════════════════════════════════════════════════════════════════════

@pytest.fixture
def app():
    """Flask test client with isolated temp COOKIES_DIR.

    Mirrors ``tests/test_admin_oauth.py::app`` line-by-line so the
    testing convention is uniform. Forces ``SAU_AUTH_ENABLED=true`` so
    the global auth gate is active even when the host env has it off.
    """
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "true"}, clear=False):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
        application.config["TESTING"] = True
        application.config["SECRET_KEY"] = "test-secret-key-for-studio-tests"
        with tempfile.TemporaryDirectory() as tmp_dir:
            import web_runner.utils as wr_utils
            orig = wr_utils.COOKIES_DIR
            wr_utils.COOKIES_DIR = Path(tmp_dir)
            with application.test_client() as client:
                yield client
            wr_utils.COOKIES_DIR = orig

@pytest.fixture(autouse=True)
def _clean_tables():
    """Wipe every table the studio tests touch, before AND after each test.

    Autouse so every test starts (and ends) with a clean state. The
    try/except wrappers tolerate the schema-bootstrap window where
    certain tables don't exist yet (e.g. when the implementation PR
    hasn't migrated the dev DB).
    """
    db = get_database()
    cleanup = [
        "DELETE FROM studio_assets",
        "DELETE FROM studio_episodes",
        "DELETE FROM studio_projects",
        "DELETE FROM admin_audit_log",
        "DELETE FROM verification_codes",
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

# ── Auth helpers (mirrors tests/test_admin_oauth.py exactly) ──────────

# Canonical _login_as helper lives at tests/_login_helpers.py
from tests._login_helpers import _login_as  # noqa: E402
def _now_iso():
    """Re-export of `_now_iso` from auth route."""
    from web_runner.routes.auth import _now_iso as _n
    return _n()

# ═══════════════════════════════════════════════════════════════════════
#  POST /api/studio/projects — tasks.md §1.2.2
# ═══════════════════════════════════════════════════════════════════════
#
# (Post-SQLite-removal: TestStudioSchemaPragma class deleted — PG enforces
# FK natively. Cascade tests below organically prove schema correctness.)

class TestStudioProjectCreate:
    """POST /api/studio/projects."""

    def test_create_minimal_required_fields_200(self, app):
        """§1.2.2: title + synopsis 必填,落到 DB,返回 id + owner_user_id."""
        admin = _login_as(app, "studio_create_min@test.com")
        resp = app.post(
            "/api/studio/projects",
            json={"title": "灰烬", "synopsis": "少年剑客复仇"},
        )
        assert resp.status_code in (200, 201), resp.get_json()
        data = resp.get_json()
        assert data["success"] is True
        assert "id" in data["data"]
        assert data["data"]["title"] == "灰烬"
        assert data["data"]["synopsis"] == "少年剑客复仇"
        assert data["data"]["owner_user_id"] == admin["id"]
        assert data["data"]["status"] == "draft"

    def test_create_with_style_persists_to_db(self, app):
        """§1.2.2: style 可选存在时,落库到对应列."""
        _login_as(app, "studio_create_style@test.com")
        resp = app.post(
            "/api/studio/projects",
            json={
                "title": "林冲夜奔",
                "synopsis": "风雪山神庙",
                "style": "水墨武侠风格,9:16竖屏",
            },
        )
        assert resp.status_code in (200, 201)
        data = resp.get_json()
        assert data["data"]["style"] == "水墨武侠风格,9:16竖屏"
        row = get_database().fetch_one(
            "SELECT style FROM studio_projects WHERE id = ?",
            (data["data"]["id"],),
        )
        assert row["style"] == "水墨武侠风格,9:16竖屏"

    def test_create_unauth_returns_401(self, app):
        """§1.6.4: 未登录 → 401."""
        resp = app.post(
            "/api/studio/projects",
            json={"title": "未授权", "synopsis": "没有 session"},
        )
        assert resp.status_code == 401
        assert "未登录" in resp.get_json()["message"]

    def test_create_missing_title_400(self, app):
        """§1.2.2: title 缺失 → 400."""
        _login_as(app, "studio_create_no_title@test.com")
        resp = app.post("/api/studio/projects", json={"synopsis": "only"})
        assert resp.status_code == 400
        msg = resp.get_json().get("message", "")
        assert "title" in msg or "标题" in msg

    def test_create_missing_synopsis_400(self, app):
        """§1.2.2: synopsis 缺失 → 400."""
        _login_as(app, "studio_create_no_syn@test.com")
        resp = app.post("/api/studio/projects", json={"title": "only"})
        assert resp.status_code == 400
        msg = resp.get_json().get("message", "")
        assert "synopsis" in msg or "灵感" in msg

    def test_create_title_max_length_80(self, app):
        """§1.2.2 + spec.script-engine 表注:title 不超过 80 字."""
        _login_as(app, "studio_create_long@test.com")
        resp_ok = app.post(
            "/api/studio/projects",
            json={"title": "A" * 80, "synopsis": "x"},
        )
        assert resp_ok.status_code in (200, 201)
        resp_too_long = app.post(
            "/api/studio/projects",
            json={"title": "B" * 81, "synopsis": "x"},
        )
        assert resp_too_long.status_code == 400

    def test_create_synopsis_max_length_500(self, app):
        """§1.2.2 + specs/script-engine/spec.md: synopsis 不超过 500 字。"""
        _login_as(app, "studio_create_syn_long@test.com")
        resp_ok = app.post(
            "/api/studio/projects",
            json={"title": "x", "synopsis": "A" * 500},
        )
        assert resp_ok.status_code == 200
        resp_too_long = app.post(
            "/api/studio/projects",
            json={"title": "x", "synopsis": "B" * 501},
        )
        assert resp_too_long.status_code == 400

# ═══════════════════════════════════════════════════════════════════════
#  GET /api/studio/projects — tasks.md §1.2.3, §1.6.3
# ═══════════════════════════════════════════════════════════════════════

class TestStudioProjectList:
    """GET /api/studio/projects — 仅返回 owner 自己的 + updated_at DESC."""

    def test_list_empty_returns_empty_array_200(self, app):
        """§1.6.1: 新用户无项目 → 200 + 空数组(非 404)."""
        _login_as(app, "studio_list_empty@test.com")
        resp = app.get("/api/studio/projects")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["data"] == []

    def test_list_returns_only_own_projects(self, app):
        """§1.2.6 + §1.6.3: User A 看不到 User B 的项目(隔离)."""
        _login_as(app, "studio_list_iso_a@test.com")
        for title in ("A-1", "A-2"):
            app.post("/api/studio/projects", json={"title": title, "synopsis": "a"})

        _login_as(app, "studio_list_iso_b@test.com")
        for title in ("B-1", "B-2", "B-3"):
            app.post("/api/studio/projects", json={"title": title, "synopsis": "b"})

        _login_as(app, "studio_list_iso_a@test.com")
        resp = app.get("/api/studio/projects")
        titles = sorted(p["title"] for p in resp.get_json()["data"])
        assert titles == ["A-1", "A-2"], "B's projects must NOT leak into A's list"

    def test_list_ordered_by_updated_at_desc(self, app):
        """§1.2.3: 最近编辑排最前(updated_at DESC)."""
        _login_as(app, "studio_list_order@test.com")
        for title in ("first", "second", "third"):
            app.post("/api/studio/projects", json={"title": title, "synopsis": "x"})
        resp = app.get("/api/studio/projects")
        titles = [p["title"] for p in resp.get_json()["data"]]
        assert titles == ["third", "second", "first"]

    def test_list_unauth_returns_401(self, app):
        """§1.6.4: 未登录 → 401."""
        resp = app.get("/api/studio/projects")
        assert resp.status_code == 401

# ═══════════════════════════════════════════════════════════════════════
#  GET /api/studio/projects/{id} — tasks.md §1.2.4, §1.6.4
# ═══════════════════════════════════════════════════════════════════════

class TestStudioProjectGet:
    """GET /api/studio/projects/{id} — owner-only,含 episodes + assets."""

    def test_get_returns_full_project_record(self, app):
        """§1.2.4: owner 拿自己的项目 → 200 + 完整 record."""
        admin = _login_as(app, "studio_get_min@test.com")
        create_resp = app.post(
            "/api/studio/projects",
            json={"title": "test", "synopsis": "syn"},
        )
        project_id = create_resp.get_json()["data"]["id"]

        resp = app.get(f"/api/studio/projects/{project_id}")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["id"] == project_id
        assert data["title"] == "test"
        assert data["synopsis"] == "syn"
        assert data["owner_user_id"] == admin["id"]
        assert data["status"] == "draft"

    def test_get_includes_associated_episodes_and_assets(self, app):
        """§1.2.4: 项目详情应包含关联 episodes + assets(空时返空数组)."""
        _login_as(app, "studio_get_full@test.com")
        project_id = app.post(
            "/api/studio/projects", json={"title": "full", "synopsis": "test"}
        ).get_json()["data"]["id"]

        resp = app.get(f"/api/studio/projects/{project_id}")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data.get("episodes") == [] or data.get("episodes") is None
        assert data.get("assets") == [] or data.get("assets") is None

    def test_get_returns_seeded_episodes_and_assets(self, app):
        """§1.2.4: 直接 seed 后,详情应能呈现关联行."""
        db = get_database()
        _login_as(app, "studio_get_seed@test.com")
        project_id = app.post(
            "/api/studio/projects", json={"title": "with-kids", "synopsis": "x"}
        ).get_json()["data"]["id"]

        db.execute(
            "INSERT INTO studio_episodes (project_id, episode_no, act, title, "
            "scenes_json, dialogues_json, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (project_id, 1, "起", "灰烬", "[]", "[]", "draft", _now_iso()),
        )
        db.execute(
            "INSERT INTO studio_assets (project_id, kind, code, name, prompt, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (project_id, "character", "C01", "叶青云", "test", _now_iso()),
        )
        db.execute(
            "INSERT INTO studio_assets (project_id, kind, code, name, prompt, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (project_id, "scene", "S01", "青锋山废墟", "test", _now_iso()),
        )

        resp = app.get(f"/api/studio/projects/{project_id}")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert len(data["episodes"]) == 1
        assert data["episodes"][0]["episode_no"] == 1
        assert data["episodes"][0]["act"] == "起"
        assert len(data["assets"]) == 2
        codes = {a["code"] for a in data["assets"]}
        assert codes == {"C01", "S01"}

    def test_get_other_users_project_returns_404(self, app):
        """§1.2.6 + §1.6.4: User B GET User A 的项目 → 404(不暴露存在性)."""
        _login_as(app, "studio_get_other_a@test.com")
        project_id = app.post(
            "/api/studio/projects", json={"title": "private", "synopsis": "mine"}
        ).get_json()["data"]["id"]

        _login_as(app, "studio_get_other_b@test.com")
        resp = app.get(f"/api/studio/projects/{project_id}")
        assert resp.status_code == 404

    def test_get_nonexistent_project_returns_404(self, app):
        """§1.2.4: 不存在的 id → 404."""
        _login_as(app, "studio_get_404@test.com")
        resp = app.get("/api/studio/projects/99999")
        assert resp.status_code == 404

    def test_get_unauth_returns_401(self, app):
        """§1.6.4: 未登录 → 401."""
        resp = app.get("/api/studio/projects/1")
        assert resp.status_code == 401

# ═══════════════════════════════════════════════════════════════════════
#  DELETE /api/studio/projects/{id} — tasks.md §1.2.5, §1.6.4
# ═══════════════════════════════════════════════════════════════════════

class TestStudioProjectDelete:
    """DELETE /api/studio/projects/{id} — hard delete + 级联."""

    def test_delete_owner_returns_200_and_db_row_gone(self, app):
        """§1.2.5: owner 删除自己的项目 → 200 + 项目行物理删除."""
        db = get_database()
        _login_as(app, "studio_del_basic@test.com")
        project_id = app.post(
            "/api/studio/projects", json={"title": "to_delete", "synopsis": "x"}
        ).get_json()["data"]["id"]

        resp = app.delete(f"/api/studio/projects/{project_id}")
        assert resp.status_code == 200
        assert db.fetch_one(
            "SELECT id FROM studio_projects WHERE id = ?", (project_id,)
        ) is None

    def test_delete_other_users_project_returns_404(self, app):
        """§1.2.6 + §1.6.4: User B 不能删 User A → 404(同 GET 隔离语义)."""
        _login_as(app, "studio_del_other_a@test.com")
        project_id = app.post(
            "/api/studio/projects", json={"title": "protected", "synopsis": "a"}
        ).get_json()["data"]["id"]

        _login_as(app, "studio_del_other_b@test.com")
        resp = app.delete(f"/api/studio/projects/{project_id}")
        assert resp.status_code == 404

    def test_delete_nonexistent_project_returns_404(self, app):
        """§1.2.5: 删除不存在的 id → 404(幂等 + 安全)."""
        _login_as(app, "studio_del_404@test.com")
        resp = app.delete("/api/studio/projects/99999")
        assert resp.status_code == 404

    def test_delete_unauth_returns_401(self, app):
        """§1.6.4: 未登录 → 401."""
        resp = app.delete("/api/studio/projects/1")
        assert resp.status_code == 401

# ═══════════════════════════════════════════════════════════════════════
#  Cascade delete — tasks.md §1.2.5 + design.md §1
# ═══════════════════════════════════════════════════════════════════════

class TestStudioCascadeDelete:
    """DELETE project → episodes + assets 一并删除(FK + CASCADE).

    Schema declares ``ON DELETE CASCADE`` on both
    ``studio_episodes.project_id`` and ``studio_assets.project_id``.
    SQLite enforces this **only when** ``PRAGMA foreign_keys = ON``
    for the running connection — see the
    ``TestStudioSchemaPragma`` canary test.
    """

    def test_delete_cascade_removes_all_episodes(self, app):
        """§1.2.5: DELETE project → 该 project 下所有 episodes 一并消失."""
        db = get_database()
        _login_as(app, "studio_cascade_eps@test.com")
        project_id = app.post(
            "/api/studio/projects", json={"title": "with-eps", "synopsis": "x"}
        ).get_json()["data"]["id"]

        for ep_no, act in ((1, "起"), (2, "承"), (3, "转")):
            db.execute(
                "INSERT INTO studio_episodes (project_id, episode_no, act, "
                "title, scenes_json, dialogues_json, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (project_id, ep_no, act, f"E0{ep_no}", "[]", "[]", "draft", _now_iso()),
            )
        assert len(
            db.fetch_all(
                "SELECT id FROM studio_episodes WHERE project_id = ?",
                (project_id,),
            )
        ) == 3

        resp = app.delete(f"/api/studio/projects/{project_id}")
        assert resp.status_code == 200

        assert (
            db.fetch_one(
                "SELECT id FROM studio_projects WHERE id = ?", (project_id,)
            )
            is None
        )
        assert (
            db.fetch_all(
                "SELECT id FROM studio_episodes WHERE project_id = ?",
                (project_id,),
            )
            == []
        ), "episodes must cascade-delete with the project (FK CASCADE contract)"

    def test_delete_cascade_removes_all_assets(self, app):
        """§1.2.5: DELETE project → C/S/P 三类 assets 一并消失."""
        db = get_database()
        _login_as(app, "studio_cascade_asset@test.com")
        project_id = app.post(
            "/api/studio/projects", json={"title": "with-assets", "synopsis": "x"}
        ).get_json()["data"]["id"]

        for kind, code, name in (
            ("character", "C01", "叶青云"),
            ("character", "C02", "苏挽月"),
            ("scene", "S01", "青锋山废墟·夜"),
            ("prop", "P01", "青锋剑"),
        ):
            db.execute(
                "INSERT INTO studio_assets (project_id, kind, code, name, "
                "prompt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (project_id, kind, code, name, "test prompt", _now_iso()),
            )
        assert len(
            db.fetch_all(
                "SELECT id FROM studio_assets WHERE project_id = ?", (project_id,)
            )
        ) == 4

        app.delete(f"/api/studio/projects/{project_id}")

        assert (
            db.fetch_all(
                "SELECT id FROM studio_assets WHERE project_id = ?", (project_id,)
            )
            == []
        ), "assets must cascade-delete with the project (FK CASCADE contract)"

    def test_delete_cascade_does_not_touch_other_projects(self, app):
        """§1.2.5 + isolation: cascade 只影响被删 project,其他项目一概不动."""
        db = get_database()
        _login_as(app, "studio_cascade_iso_a@test.com")
        p1_id = app.post(
            "/api/studio/projects", json={"title": "P1", "synopsis": "x"}
        ).get_json()["data"]["id"]
        p2_id = app.post(
            "/api/studio/projects", json={"title": "P2", "synopsis": "y"}
        ).get_json()["data"]["id"]

        for pid in (p1_id, p2_id):
            db.execute(
                "INSERT INTO studio_episodes (project_id, episode_no, act, "
                "title, scenes_json, dialogues_json, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (pid, 1, "起", "E01", "[]", "[]", "draft", _now_iso()),
            )

        app.delete(f"/api/studio/projects/{p1_id}")

        assert (
            db.fetch_one(
                "SELECT id FROM studio_projects WHERE id = ?", (p1_id,)
            )
            is None
        )
        p2_row = db.fetch_one(
            "SELECT id FROM studio_projects WHERE id = ?", (p2_id,)
        )
        assert p2_row is not None, "P2 must NOT be touched by P1's cascade"
        p2_eps = db.fetch_all(
            "SELECT id FROM studio_episodes WHERE project_id = ?", (p2_id,)
        )
        assert len(p2_eps) == 1, (
            "P2's episode must NOT be touched by P1's cascade — the FK "
            "constraint scopes cascade to the deleted parent only."
        )

    def test_delete_cascade_does_not_touch_other_users_orphan_rows(self, app):
        """Cross-user isolation 双重保险:其他用户的 project / asset 都不能被波及."""
        db = get_database()
        _login_as(app, "studio_cascade_xuser_a@test.com")
        a_id = app.post(
            "/api/studio/projects", json={"title": "A_proj", "synopsis": "a"}
        ).get_json()["data"]["id"]
        db.execute(
            "INSERT INTO studio_assets (project_id, kind, code, name, prompt, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (a_id, "character", "C01", "A_chars", "x", _now_iso()),
        )

        _login_as(app, "studio_cascade_xuser_b@test.com")
        b_id = app.post(
            "/api/studio/projects", json={"title": "B_proj", "synopsis": "b"}
        ).get_json()["data"]["id"]
        db.execute(
            "INSERT INTO studio_assets (project_id, kind, code, name, prompt, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (b_id, "character", "C01", "B_chars", "y", _now_iso()),
        )

        _login_as(app, "studio_cascade_xuser_a@test.com")
        app.delete(f"/api/studio/projects/{a_id}")

        b_proj = db.fetch_one(
            "SELECT id FROM studio_projects WHERE id = ?", (b_id,)
        )
        assert b_proj is not None, "B's project must NOT be touched by A's cascade"
        b_assets = db.fetch_all(
            "SELECT id, name FROM studio_assets WHERE project_id = ?", (b_id,)
        )
        assert len(b_assets) == 1, "B's asset must NOT be touched by A's cascade"
        assert b_assets[0]["name"] == "B_chars"

# ═══════════════════════════════════════════════════════════════════════
#  Phase 3 — POST /api/studio/projects/<id>/episodes (round-OPT-T2-follow-up)
#
# Tests for the append endpoint; user flow is "POST 4 acts to project 9,
# verify the 4 cards render in StudioDetailPage, click Render to use the
# episodes as renderer input." Covers happy path (single + 4-act batch),
# validation failures, owner isolation, FK cascade piggyback, and the
# auto-increment-continues-from-existing-rows contract.
# ═══════════════════════════════════════════════════════════════════════


class TestStudioEpisodeAppend:
    """§3.3.0 — POST /api/studio/projects/<id>/episodes surface."""

    def _create_project(self, app, login_email: str) -> int:
        """Helper: create a project owned by ``login_email`` and return its id."""
        body = app.post(
            "/api/studio/projects",
            json={"title": f"proj-{login_email}", "synopsis": "x"},
        )
        assert body.status_code in (200, 201), body.get_data(as_text=True)
        return body.get_json()["data"]["id"]

    def test_append_single_episode_returns_201(self, app):
        _login_as(app, "studio_eps_single@test.com")
        project_id = self._create_project(app, "studio_eps_single@test.com")
        body = app.post(
            f"/api/studio/projects/{project_id}/episodes",
            json={
                "title": "灰烬中的希望",
                "act": "起",
                "scenes_json": [{"scene_no": 1, "location": "江边小镇"}],
                "dialogues_json": [{"speaker": "林冲", "line": "大雪压青松"}],
            },
        )
        assert body.status_code == 201, body.get_data(as_text=True)
        data = body.get_json()
        assert data["success"] is True
        assert len(data["data"]) == 1
        ep = data["data"][0]
        assert ep["episode_no"] == 1
        assert ep["act"] == "起"
        assert ep["title"] == "灰烬中的希望"
        assert json.loads(ep["scenes"])[0]["location"] == "江边小镇"
        # Round-trip via GET — proves DB write + serialization correctness.
        eps = app.get(f"/api/studio/projects/{project_id}").get_json()["data"]["episodes"]
        assert len(eps) == 1
        assert eps[0]["id"] == ep["id"]
        assert eps[0]["act"] == "起"

    def test_append_batch_of_four_acts_assigns_consecutive_no(self, app):
        _login_as(app, "studio_eps_batch@test.com")
        project_id = self._create_project(app, "studio_eps_batch@test.com")
        body = app.post(
            f"/api/studio/projects/{project_id}/episodes",
            json=[
                {"act": "起", "title": "开端"},
                {"act": "承", "title": "递进"},
                {"act": "转", "title": "转折"},
                {"act": "合", "title": "收束"},
            ],
        )
        assert body.status_code == 201, body.get_data(as_text=True)
        eps = body.get_json()["data"]
        assert len(eps) == 4
        assert [e["episode_no"] for e in eps] == [1, 2, 3, 4]
        assert [e["act"] for e in eps] == ["起", "承", "转", "合"]

    def test_append_unknown_act_returns_400(self, app):
        _login_as(app, "studio_eps_bad_act@test.com")
        project_id = self._create_project(app, "studio_eps_bad_act@test.com")
        body = app.post(
            f"/api/studio/projects/{project_id}/episodes",
            json={"act": "终"},
        )
        assert body.status_code == 400
        msg = body.get_json()["message"]
        assert "act" in msg
        # Shape-only assertion (don't pin literal env-tunable counts).
        assert "之一" in msg

    def test_append_unauth_returns_401(self, app):
        # No `_login_as` call — session has no admin.
        body = app.post("/api/studio/projects/9/episodes", json={"act": "起"})
        assert body.status_code == 401
        assert body.get_json()["success"] is False

    def test_append_to_other_users_project_returns_404(self, app):
        _login_as(app, "studio_eps_owner_a@test.com")
        project_id = self._create_project(app, "studio_eps_owner_a@test.com")
        # Switch to user B; they CANNOT see A's project.
        _login_as(app, "studio_eps_owner_b@test.com")
        body = app.post(
            f"/api/studio/projects/{project_id}/episodes",
            json={"act": "合"},
        )
        assert body.status_code == 404
        assert body.get_json()["message"] == "项目不存在"

    def test_append_empty_array_returns_400(self, app):
        _login_as(app, "studio_eps_empty@test.com")
        project_id = self._create_project(app, "studio_eps_empty@test.com")
        body = app.post(
            f"/api/studio/projects/{project_id}/episodes",
            json=[],
        )
        assert body.status_code == 400
        assert "episode 列表不能为空" in body.get_json()["message"]

    def test_append_increments_after_existing_episodes(self, app):
        """Server-assigned ``episode_no`` continues from the current
        max, NOT restarts at 1 each call. Without this contract,
        an operator who adds 2 acts today + 2 more tomorrow would
        see duplicate no=1+2+1+2 rows.
        """
        _login_as(app, "studio_eps_inc@test.com")
        project_id = self._create_project(app, "studio_eps_inc@test.com")
        r1 = app.post(
            f"/api/studio/projects/{project_id}/episodes",
            json=[{"act": "起"}, {"act": "承"}],
        )
        assert r1.status_code == 201
        assert [e["episode_no"] for e in r1.get_json()["data"]] == [1, 2]
        r2 = app.post(
            f"/api/studio/projects/{project_id}/episodes",
            json=[{"act": "转"}, {"act": "合"}],
        )
        assert r2.status_code == 201
        # Critical: incremented, NOT restarted.
        assert [e["episode_no"] for e in r2.get_json()["data"]] == [3, 4]

    def test_append_to_nonexistent_project_returns_404(self, app):
        _login_as(app, "studio_eps_404@test.com")
        body = app.post(
            "/api/studio/projects/999999/episodes",
            json={"act": "起"},
        )
        assert body.status_code == 404
        assert body.get_json()["message"] == "项目不存在"

    def test_append_cascade_piggyback_episodes_delete_with_project(self, app):
        """Piggybacks the FK CASCADE contract on the existing
        TestStudioCascadeDelete suite — when a project is deleted,
        any episodes newly appended via this endpoint MUST vanish too
        (otherwise the cascade contract regresses on the new surface).
        """
        _login_as(app, "studio_eps_cascade@test.com")
        project_id = self._create_project(app, "studio_eps_cascade@test.com")
        app.post(
            f"/api/studio/projects/{project_id}/episodes",
            json=[{"act": "起"}, {"act": "合"}],
        )
        db = get_database()
        before = db.fetch_all(
            "SELECT id FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        )
        assert len(before) == 2, "before-delete: episodes must exist"
        d = app.delete(f"/api/studio/projects/{project_id}")
        assert d.status_code == 200
        after = db.fetch_all(
            "SELECT id FROM studio_episodes WHERE project_id = ?",
            (project_id,),
        )
        assert len(after) == 0, (
            "after-delete: episodes must cascade-delete with the project "
            "— round-OPT-T2-follow-up followup"
        )


# ═══════════════════════════════════════════════════════════════════════
#  Cross-cutting response-shape contract
# ═══════════════════════════════════════════════════════════════════════

class TestStudioResponseShape:
    """All success responses return ``{success: True, data: <T>}``.

    Mirrors the project-wide envelope used by ``oauth.py`` /
    ``admin.py``: 200 wraps payload in ``data``, 4xx wraps the
    Chinese error message in ``message``.
    """

    def test_create_returns_envelope_shape(self, app):
        _login_as(app, "studio_shape_create@test.com")
        resp = app.post(
            "/api/studio/projects",
            json={"title": "shape", "synopsis": "x"},
        )
        body = resp.get_json()
        assert body["success"] is True
        assert isinstance(body.get("data"), dict)
        assert "id" in body["data"]

    def test_list_returns_envelope_shape(self, app):
        _login_as(app, "studio_shape_list@test.com")
        resp = app.get("/api/studio/projects")
        body = resp.get_json()
        assert body["success"] is True
        assert isinstance(body["data"], list)

    def test_get_returns_envelope_shape(self, app):
        _login_as(app, "studio_shape_get@test.com")
        project_id = app.post(
            "/api/studio/projects", json={"title": "shape", "synopsis": "x"}
        ).get_json()["data"]["id"]
        resp = app.get(f"/api/studio/projects/{project_id}")
        body = resp.get_json()
        assert body["success"] is True
        assert isinstance(body["data"], dict)
        assert "id" in body["data"]

    def test_4xx_returns_message_without_data(self, app):
        """Validation errors wrap the Chinese message under ``message``.

        ``data`` is omitted on 4xx so the response stays close to
        the ``oauth.py`` / ``admin.py`` shape — pinning it here so
        a future refactor that emits ``data: null`` on errors is
        caught by tests rather than silently landing.
        """
        _login_as(app, "studio_shape_err@test.com")
        resp = app.post(
            "/api/studio/projects", json={"synopsis": "missing title"}
        )
        body = resp.get_json()
        assert body["success"] is False
        assert "message" in body
        assert isinstance(body["message"], str)
        assert len(body["message"]) > 0
