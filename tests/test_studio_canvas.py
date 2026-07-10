"""Tests for the ``Backend is schema-version-agnostic`` contract.

OpenSpec ref: ``openspec/changes/studio-whiteboard/specs/canvas-editor/
spec.md`` §`Backend is schema-version-agnostic` Requirement + 4 Scenarios.

These tests verify the backend's **opaque-storage** contract: the
``TldrawSnapshot`` is stored and returned without any schema
inspection, version upgrade, or content transformation. The four
payloads exercised below (legacy v1 schema, future v99 schema, no
``schema`` field, unknown custom shape type) all round-trip through
PATCH → DB → GET with the same JSON value, proving that the backend
treats the tldraw internal structure as opaque storage.

Architecture notes
------------------
* Mirrors the existing ``tests/test_studio.py`` fixture pattern
  (``app`` with isolated temp ``COOKIES_DIR``, ``_clean_tables``
  autouse wipe). The only addition is the canvas-aware ``_create_project``
  / ``_patch_canvas`` / ``_get_canvas`` helpers below.
* Post-SQLite-removal: this suite runs against the real PG backend
  via ``web_runner.db.get_database()``. The conftest requires
  ``DATABASE_URL`` to point to a test PG database; the suite
  cleans its own tables via ``_clean_tables`` so no migration
  of fixtures is required.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from web_runner import create_app  # noqa: E402
from web_runner.db import get_database  # noqa: E402
from tests._login_helpers import _login_as  # noqa: E402


def _byte_equivalent_round_trip(stored, original) -> None:
    """Assert the server round-tripped ``canvas_data`` byte-equivalently.

    Per the spec, "byte-equivalent round-trip" means the server
    MUST NOT re-serialize, sort keys, drop fields, or otherwise
    transform the JSON. Comparing ``json.dumps(..., sort_keys=True,
    ensure_ascii=False)`` of the retrieved value against the input
    gives a stable, order-independent equality that survives any
    key reordering on either side.
    """
    assert (
        json.dumps(stored, sort_keys=True, ensure_ascii=False)
        == json.dumps(original, sort_keys=True, ensure_ascii=False)
    ), (
        "canvas_data round-trip is not byte-equivalent. The server MUST NOT\n"
        "re-serialize, sort keys, or drop fields. The schema-version-\n"
        "agnostic contract requires opaque storage."
    )


# ═══════════════════════════════════════════════════════════════════════
#  Fixtures
# ═══════════════════════════════════════════════════════════════════════


@pytest.fixture
def app():
    """Flask test client with isolated temp ``COOKIES_DIR``.

    Mirrors ``tests/test_studio.py::app`` so the studio test
    convention is uniform.
    """
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "true"}, clear=False):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
        application.config["TESTING"] = True
        application.config["SECRET_KEY"] = "test-secret-key-for-canvas-tests"
        # Required so the 413 test's ~10 MiB CJK payload reaches the
        # ``_validate_canvas_payload`` size check instead of being
        # rejected by Werkzeug's body-too-large handler with an HTML
        # 413 page (which would defeat the test's purpose).
        application.config["MAX_CONTENT_LENGTH"] = None
        with tempfile.TemporaryDirectory() as tmp_dir:
            import web_runner.utils as wr_utils
            orig = wr_utils.COOKIES_DIR
            wr_utils.COOKIES_DIR = Path(tmp_dir)
            with application.test_client() as client:
                yield client
            wr_utils.COOKIES_DIR = orig


@pytest.fixture(autouse=True)
def _clean_tables():
    """Wipe every table the canvas tests touch, before AND after each test.

    Autouse so every test starts (and ends) with a clean state. The
    try/except wrappers tolerate the schema-bootstrap window where
    certain tables don't exist yet.
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


# ═══════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════


def _create_project(client, email: str) -> int:
    """Create a project owned by ``email``; return its id."""
    _login_as(client, email)
    resp = client.post(
        "/api/studio/projects",
        json={"title": f"canvas-test-{email}", "synopsis": "x"},
    )
    assert resp.status_code in (200, 201), resp.get_json()
    return resp.get_json()["data"]["id"]


def _patch_canvas(client, project_id: int, canvas_data):
    """PATCH ``/canvas`` with the given payload; return (status, body)."""
    resp = client.patch(
        f"/api/studio/projects/{project_id}/canvas",
        json={"canvas_data": canvas_data},
    )
    return resp.status_code, resp.get_json()


def _get_canvas(client, project_id: int):
    """GET ``/canvas``; return (status, canvas_data_dict_or_none)."""
    resp = client.get(f"/api/studio/projects/{project_id}/canvas")
    body = resp.get_json()
    return resp.status_code, (body.get("data") or {}).get("canvas_data")


# ═══════════════════════════════════════════════════════════════════════
#  Backend is schema-version-agnostic
#  spec.md §Backend is schema-version-agnostic (4 Scenarios)
# ═══════════════════════════════════════════════════════════════════════


class TestSchemaVersionAgnostic:
    """The backend MUST treat ``canvas_data`` as an opaque JSON object.

    See ``specs/canvas-editor/spec.md`` §`Backend is
    schema-version-agnostic` for the full Requirement + 4 Scenarios.
    The contract: the server only checks (a) ``canvas_data`` is a
    JSON object or null, and (b) UTF-8 byte size ≤
    ``SAU_STUDIO_CANVAS_MAX_SIZE``. No schema or shape-type
    inspection. Any ``schema`` version + any record type is
    accepted unchanged.

    Each test verifies BOTH the PATCH leg (HTTP 200, server stores
    without complaint) AND the GET leg (the stored value round-trips
    back with semantic content identical to the input — i.e. the
    parsed value is ``==`` to what was sent, proving the server
    applied no schema / content transformation).
    """

    def test_backend_accepts_future_tldraw_schema_version(self, app):
        """Scenario 1: PATCH with a future ``schema: 99`` (a hypothetical
        tldraw version the server has never seen) → 200; GET returns
        the same JSON value verbatim.
        """
        project_id = _create_project(app, "future_schema@test.com")
        canvas = {
            "schema": 99,
            "store": {
                "records": {
                    "shape_x": {
                        "typeName": "shape",
                        "type": "future-annotation",
                        "x": 0,
                        "y": 0,
                    },
                },
            },
        }
        status, body = _patch_canvas(app, project_id, canvas)
        assert status == 200, body
        assert body["success"] is True
        assert "id" in body["data"]
        assert "updated_at" in body["data"]

        # GET round-trip: stored value must be byte-equivalent to the input.
        get_status, get_canvas = _get_canvas(app, project_id)
        assert get_status == 200
        _byte_equivalent_round_trip(get_canvas, canvas)

    def test_backend_accepts_legacy_tldraw_schema_version(self, app):
        """Scenario 2: PATCH with ``schema: 1`` (legacy tldraw v1.x) →
        200; GET returns the same JSON value. Server does NOT
        reject the older format; client-side tldraw is solely
        responsible for version migration on load.
        """
        project_id = _create_project(app, "legacy_schema@test.com")
        canvas = {
            "schema": 1,
            "store": {
                "records": {
                    "legacy_shape": {
                        "typeName": "shape",
                        "type": "old-type",
                    },
                },
            },
        }
        status, body = _patch_canvas(app, project_id, canvas)
        assert status == 200, body

        get_status, get_canvas = _get_canvas(app, project_id)
        assert get_status == 200
        _byte_equivalent_round_trip(get_canvas, canvas)

    def test_backend_accepts_canvas_without_schema_field(self, app):
        """Scenario 3: PATCH without a ``schema`` key → 200; GET returns
        the same JSON value. Server does not require a ``schema``
        field.
        """
        project_id = _create_project(app, "no_schema@test.com")
        canvas = {
            "store": {
                "records": {
                    "x": {
                        "typeName": "shape",
                        "type": "no-schema-marker",
                    },
                },
            },
        }
        status, body = _patch_canvas(app, project_id, canvas)
        assert status == 200, body

        get_status, get_canvas = _get_canvas(app, project_id)
        assert get_status == 200
        assert get_canvas == canvas

    def test_backend_does_not_reject_unknown_custom_shape_types(self, app):
        """Scenario 4: PATCH with unknown tldraw custom shape types the
        server has never seen → 200; GET returns the same JSON
        value. The server is opaque to the entire tldraw internal
        structure (not just the top-level ``schema`` field) — any
        record type, any binding, any future field is accepted
        unchanged.
        """
        project_id = _create_project(app, "unknown_shape@test.com")
        canvas = {
            "schema": 2,
            "store": {
                "records": {
                    "shape_x": {
                        "typeName": "shape",
                        "type": "custom-robot-shape",
                        "x": 0,
                        "y": 0,
                        "props": {
                            "robotId": "R-001",
                            "label": "Optimus",
                        },
                    },
                    "shape_y": {
                        "typeName": "shape",
                        "type": "future-quantum-annotation",
                        "props": {
                            "qubits": 7,
                            "gates": ["H", "CNOT"],
                        },
                    },
                    "shape_z": {
                        "typeName": "binding",
                        "type": "arrow",
                        "fromId": "shape_x",
                        "toId": "shape_y",
                        "terminal": "start",
                    },
                },
            },
        }
        status, body = _patch_canvas(app, project_id, canvas)
        assert status == 200, body

        get_status, get_canvas = _get_canvas(app, project_id)
        assert get_status == 200
        _byte_equivalent_round_trip(get_canvas, canvas)
        # Spot-check the unknown shape types round-trip.
        assert (
            get_canvas["store"]["records"]["shape_x"]["type"]
            == "custom-robot-shape"
        )
        assert (
            get_canvas["store"]["records"]["shape_y"]["type"]
            == "future-quantum-annotation"
        )
        assert get_canvas["store"]["records"]["shape_z"]["type"] == "arrow"


class TestCanvasEndpointEdgeCases:
    """Companion to ``TestSchemaVersionAgnostic`` — covers the
    non-scenario edge cases of the /canvas endpoints (null clear,
    non-object rejection, owner isolation, unauth).
    """

    def test_null_canvas_clears_storage(self, app):
        """``canvas_data: null`` writes NULL to the column; a
        subsequent GET returns ``canvas_data: null``.

        Per spec.md §`Save with null clears canvas` Scenario in
        the PATCH endpoint Requirement.
        """
        project_id = _create_project(app, "null_canvas@test.com")
        # First, save something.
        canvas = {
            "schema": 2,
            "store": {"records": {"x": {"typeName": "shape"}}},
        }
        status, _ = _patch_canvas(app, project_id, canvas)
        assert status == 200

        # Now clear via null.
        status, body = _patch_canvas(app, project_id, None)
        assert status == 200, body
        assert body["success"] is True

        get_status, get_canvas = _get_canvas(app, project_id)
        assert get_status == 200
        assert get_canvas is None

    def test_oversized_canvas_returns_413(self, app):
        """Per spec.md `Reject canvas exceeding max byte size` Scenario:
        a ``canvas_data`` whose UTF-8 byte size exceeds
        ``_STUDIO_CANVAS_MAX_SIZE`` (default 10 MiB) returns 413
        with a Chinese message. The server MUST short-circuit on
        size BEFORE serializing to disk.
        """
        project_id = _create_project(app, "oversized@test.com")
        # Use non-ASCII characters so the payload's UTF-8 byte size is
        # roughly 3× its Python ``len()``. This is the critical detail
        # that distinguishes a spec-compliant UTF-8 byte cap
        # (``len(json.dumps(...).encode("utf-8"))``) from a cheap-but-
        # wrong Python ``len()`` cap: with CJK characters, the
        # latter would compute ~3.5 MiB and incorrectly accept a
        # 10 MiB payload; the former correctly rejects it.
        target_bytes = 10 * 1024 * 1024 + 100  # ~10 MiB + 100 bytes UTF-8
        target_chars = target_bytes // 3 + 50  # CJK char = 3 UTF-8 bytes
        canvas = {
            "schema": 2,
            "store": {
                "records": {
                    "x": {
                        "typeName": "shape",
                        "type": "oversized",
                        "blob": "字" * target_chars,
                    },
                },
            },
        }
        # Sanity check: this payload's Python len is ~3.5 MiB but its
        # UTF-8 byte size is ~10 MiB. A correct byte-cap rejects;
        # a wrong len-cap accepts.
        py_len = len(canvas["store"]["records"]["x"]["blob"])
        utf8_len = len(
            canvas["store"]["records"]["x"]["blob"].encode("utf-8")
        )
        assert py_len < 10 * 1024 * 1024  # Python len is well under cap
        assert utf8_len > 10 * 1024 * 1024  # UTF-8 size is over cap

        status, body = _patch_canvas(app, project_id, canvas)
        assert status == 413, body
        assert body["success"] is False
        assert "超过" in body["message"] or "大小" in body["message"]

    def test_rejects_non_object_canvas_data(self, app):
        """Per spec.md `Save with non-object canvas_data` Scenario:
        string / number / list / boolean payloads return 400 +
        Chinese message. The server's only validation is JSON-object
        or null; anything else is rejected.
        """
        project_id = _create_project(app, "non_object@test.com")
        for bad in ("just-a-string", 123, [1, 2, 3], True):
            status, body = _patch_canvas(app, project_id, bad)
            assert status == 400, f"canvas_data={bad!r} body={body}"
            assert body["success"] is False
            assert "JSON 对象" in body["message"]

    def test_owners_only_cross_user_404_on_get(self, app):
        """Owner isolation on ``GET /canvas`` → 404 (not 403).

        Non-owner access returns 404 uniformly with other studio
        endpoints to prevent project-ID enumeration via
        response-code differential.
        """
        _login_as(app, "iso_canvas_a@test.com")
        a_id = app.post(
            "/api/studio/projects",
            json={"title": "A", "synopsis": "a"},
        ).get_json()["data"]["id"]

        _login_as(app, "iso_canvas_b@test.com")
        resp = app.get(f"/api/studio/projects/{a_id}/canvas")
        assert resp.status_code == 404

    def test_owners_only_cross_user_404_on_patch(self, app):
        """Owner isolation on ``PATCH /canvas`` → 404 (not 403)."""
        _login_as(app, "iso_canvas_patch_a@test.com")
        a_id = _create_project(app, "iso_canvas_patch_a@test.com")

        _login_as(app, "iso_canvas_patch_b@test.com")
        resp = app.patch(
            f"/api/studio/projects/{a_id}/canvas",
            json={"canvas_data": {"schema": 2, "store": {"records": {}}}},
        )
        assert resp.status_code == 404

    def test_unauth_returns_401_on_get(self, app):
        """Unauthenticated ``GET /canvas`` → 401."""
        resp = app.get("/api/studio/projects/1/canvas")
        assert resp.status_code == 401

    def test_unauth_returns_401_on_patch(self, app):
        """Unauthenticated ``PATCH /canvas`` → 401."""
        resp = app.patch(
            "/api/studio/projects/1/canvas",
            json={"canvas_data": {"schema": 2, "store": {"records": {}}}},
        )
        assert resp.status_code == 401

    def test_missing_canvas_data_key_returns_400(self, app):
        """``PATCH /canvas`` without a ``canvas_data`` key in the body
        returns 400. (A PATCH that doesn't touch the field is not a
        valid clear — the API requires an explicit ``canvas_data``
        key.)
        """
        project_id = _create_project(app, "missing_key@test.com")
        resp = app.patch(
            f"/api/studio/projects/{project_id}/canvas",
            json={},  # no canvas_data key
        )
        assert resp.status_code == 400
        assert "canvas_data" in resp.get_json()["message"]


class TestProjectDetailExcludesCanvasData:
    """``GET /api/studio/projects/{id}`` SHALL NOT include ``canvas_data``.

    Per spec.md `Project detail does not include canvas_data` Scenario
    in the GET canvas-endpoint Requirement: the project detail
    response keeps its existing shape (no ``canvas_data`` field) so
    page loads don't bloat by up to 10 MiB; the canvas data is
    delivered only through the dedicated ``/canvas`` endpoint.
    """

    def test_get_project_detail_does_not_contain_canvas_data(self, app):
        """Project detail omits ``canvas_data`` even when the project
        has stored canvas data. Verifies the lazy-load
        separation-of-concerns contract.
        """
        project_id = _create_project(app, "detail_no_canvas@test.com")
        canvas = {"schema": 2, "store": {"records": {"x": {}}}}
        status, _ = _patch_canvas(app, project_id, canvas)
        assert status == 200

        resp = app.get(f"/api/studio/projects/{project_id}")
        assert resp.status_code == 200
        detail = resp.get_json()["data"]
        assert "canvas_data" not in detail, (
            "GET /api/studio/projects/{id} MUST NOT include "
            "canvas_data — keep the detail payload slim; load "
            "canvas data via the dedicated /canvas endpoint only."
        )
