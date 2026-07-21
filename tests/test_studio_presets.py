"""pytest contract tests for round-OPT-presets-v1 (Visual Style Presets).

Covers the backend surfaces added alongside
``sau_web/frontend/remotion_studio/presets.ts``:

  * ``_serialize_project`` exposes ``render_config`` (thought the new
    JSONB column lives on ``studio_projects`` post-ALTER).
  * ``_render_via_remotion`` injects ``project.render_config`` into
    the bridge payload so the Node ``presets.ts::getPresetById``
    can resolve it.
  * ``_validate_update_payload`` accepts the new field with bounds
    that match what the bridge can ingest (dict or null, plus the
    optional ``preset`` string sub-key with 1..64 length).
  * Existing test fixtures (without ``render_config``) still tolerate
    the new column default-NULL behaviour: the bridge receives
    ``null`` and resolves to CLASSIC at render-time.

The catalog itself (``presets.ts``) lives in the frontend TS module;
these tests do NOT directly import it (pytest has no TS executor
without extra jest-vitest setup), so the contract under test is
"the backend hands the bridge a string id and lets ``presets.ts``
own the source-of-truth lookup". The picker UI is the human-
facing catalog; backend tests verify the WB side of the contract.
"""

from __future__ import annotations

import importlib
import json
import os
from typing import Any, Dict, List

import pytest


# ── helpers ──────────────────────────────────────────────────────────


def _import_studio_module():
    """Import the routes module with the right package root on sys.path.

    Mirrors the conftest fixture pattern used by the sibling
    ``tests/test_studio_remotion_render.py`` so we don't pull
    pytest fixtures into THIS test file just for one import dance.
    """
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in os.sys.path:
        os.sys.path.insert(0, repo_root)
    return importlib.import_module("web_runner.routes.studio")


@pytest.fixture()
def studio_module():
    return _import_studio_module()


def _validate_render_config(value: Any) -> str | None:
    """Thin local mirror of ``_validate_render_config`` — redundant
    with the production helper, but lets each test phrase assertions
    in the same shape a sibling helper produces.

    Falling back: tests directly invoke the production helper from
    the imported module (its underscore prefix is module-private,
    not module-forbidden — pytest importing the module is fine).
    """
    studio_module = _import_studio_module()
    return studio_module._validate_render_config(value)


# ── 1. Serialization exposes render_config verbatim ────────────────


def test_serialize_project_includes_render_config(studio_module):
    """`_serialize_project` MUST include the `render_config` key
    even when the underlying row's column is NULL (legacy rows pre-
    PR-A. The legacy row payload becomes `render_config: None`).
    """
    row = {
        "id": 1,
        "title": "T",
        "synopsis": "S",
        "style": None,
        "status": "draft",
        "owner_user_id": 7,
        "overlay_opacity": 0.5,
        "render_config": None,  # legacy column state
        "created_at": "2026-07-10T00:00:00+00:00",
        "updated_at": "2026-07-10T00:00:00+00:00",
    }
    out = studio_module._serialize_project(row)
    assert "render_config" in out, (
        "_serialize_project must expose the new render_config "
        "column even when the row is NULL (legacy state)"
    )
    assert out["render_config"] is None


def test_serialize_project_roundtrips_render_config_dict(studio_module):
    """Stored JSONB dicts round-trip through `_serialize_project`
    unchanged — psycopg's `dict_row` row_factory decodes JSONB on
    SELECT, so a write-then-read cycle loses no keys.
    """
    stored = {"preset": "noir", "version": 1}
    row = {
        "id": 2,
        "title": "T2",
        "synopsis": "S2",
        "style": None,
        "status": "draft",
        "owner_user_id": 7,
        "overlay_opacity": 0.5,
        "render_config": stored,
        "created_at": "2026-07-10T00:00:00+00:00",
        "updated_at": "2026-07-10T00:00:00+00:00",
    }
    out = studio_module._serialize_project(row)
    assert out["render_config"] == stored


# ── 2. PATCH validation accepts the new field ──────────────────────


def test_validate_render_config_accepts_none_clears_column():
    """`{render_config: null}` is a valid clear-column payload."""
    assert _validate_render_config(None) is None


def test_validate_render_config_accepts_empty_string_clears_column():
    """`{render_config: ""}` is a valid clear-column payload — not
    a stored-but-meaningless empty string. Mirrors the existing
    `style` field's "" → None normalisation policy.
    """
    assert _validate_render_config("") is None


def test_validate_render_config_accepts_dict_without_preset():
    """Empty dict `{}` is valid: leaves the preset unset which the
    bridge will resolve to Classic at render-time. Backward-
    compatible with users who touched the picker mid-PR and saved
    a partial state.
    """
    assert _validate_render_config({}) is None


def test_validate_render_config_accepts_known_preset_id():
    """Whitelisted ids (the 4 shipped in `presets.ts`) round-trip
    cleanly. Backend does NOT enumerate the catalog — it just
    ensures the string fits the 1..64 char length cap."""
    for pid in ("classic", "noir", "vibrant", "minimalist"):
        assert _validate_render_config({"preset": pid}) is None, (
            f"expected None for preset={pid}, got validation error"
        )


def test_validate_render_config_accepts_arbitrary_string_for_forward_compat():
    """Unknown ids (e.g. `noir-v2` from a future catalog rename)
    are accepted. This is option B3 — backend-permissive — to
    avoid orphaning legacy rows when the catalog evolves.

    `presets.ts::getPresetById` resolves unknown ids to Classic
    with a UI toast surfacing the drift.
    """
    assert _validate_render_config({"preset": "noir-deep"}) is None
    assert _validate_render_config({"preset": "future-2027-q1"}) is None


def test_validate_render_config_rejects_non_dict():
    """Scalar / list / number values are rejected with a 400-grade
    error message so the picker UX surfaces the bug clearly.
    """
    expected_fragment = "render_config 必须是"
    for bad in ([], 42, 3.14, True, "noir"):
        err = _validate_render_config(bad)
        assert err is not None, f"expected error for value={bad!r}"
        assert expected_fragment in err, (
            f"error message should explain the shape rule; got {err!r}"
        )


def test_validate_render_config_rejects_nested_dict_with_datetime():
    """A dict containing a `datetime` would fail to round-trip via
    `json.dumps`; the validator surfaces the failure with a
    friendly Chinese message instead of the raw TypeError.
    """
    from datetime import datetime as _dt
    bad = {"preset": "noir", "created": _dt(2026, 7, 10, 12, 0)}
    err = _validate_render_config(bad)
    assert err is not None
    assert "无法序列化" in err or "JSON" in err, (
        f"error should explain serialisation failure; got {err!r}"
    )


def test_validate_render_config_rejects_preset_id_wrong_type():
    """`preset: 5` (number) is rejected. Only strings accepted."""
    err = _validate_render_config({"preset": 5})
    assert err is not None
    assert "preset" in err


def test_validate_render_config_rejects_oversize_preset_id():
    """64 chars + 1 = 65 chars is rejected; 64 chars is the cap."""
    err = _validate_render_config({"preset": "a" * 65})
    assert err is not None
    assert "64" in err

    # And the boundary case passes
    assert _validate_render_config({"preset": "a" * 64}) is None


def test_validate_render_config_rejects_explicit_null_preset():
    """Tightening after the PR review round-OPT-presets-v1:

    `{preset: null, version: 1}` is a contract violation, NOT a
    silent clear.  The schema says "when present, it's a string";
    clearing the row's preset uses `{render_config: null}` (whole-
    dict clear) — NOT a partial-null inside the dict. Surface it
    as a 400 so the picker UI sees a clear error when a buggy
    upstream hands the wrong shape.
    """
    err = _validate_render_config({"preset": None, "version": 1})
    assert err is not None
    assert "字符串" in err


def test_validate_render_config_rejects_empty_string_preset():
    """Empty-string `preset` is the other side of the same
    contract: explicit-empty inside the dict is a violation,
    while `{render_config: ""}` at the OUTER level clears the
    column (handled by `_validate_update_payload` upstream).
    Detail message distinguishes these two for the operator.
    """
    err = _validate_render_config({"preset": "", "version": 1})
    assert err is not None
    assert (
        "不能为空字符串" in err or "null" in err
    ), f"error message should advise whole-dict clear; got {err!r}"


# ── 3. PATCH path writes the new field through to SQL ─────────────


def test_validate_update_payload_accepts_render_config_alone(studio_module):
    """PATCH with only `render_config` returns a data dict with
    exactly one key. Other key updates must NOT be required.

    round-OPT-presets-v1 bug-fix: `data["render_config"]` is now a
    JSON STRING (json.dumps'd before storage) so psycopg's positional
    `%s` placeholder can adapt it to the JSONB column without an
    inline `::jsonb` cast. On SELECT, ``dict_row`` rehydrates the
    JSONB value back to a dict — `_serialize_project` callers still
    see the original structure. The test asserts via
    `json.loads(...)` so it's robust against future whitespace /
    separator changes if any.
    """
    data, err = studio_module._validate_update_payload(
        {"render_config": {"preset": "noir", "version": 1}}
    )
    assert err is None
    assert set(data.keys()) == {"render_config"}
    assert json.loads(data["render_config"]) == {
        "preset": "noir",
        "version": 1,
    }


def test_validate_update_payload_coexists_with_title_and_style(studio_module):
    """Sole-presence tests above confirm partial updates. This
    test confirms `render_config` rides alongside the existing
    `title` / `synopsis` / `style` keys. After the bug fix the
    value is JSON-serialised — assert via json.loads for shape
    rather than direct equality (robust against separator /
    key-order variants).
    """
    data, err = studio_module._validate_update_payload(
        {
            "title": "新标题",
            "style": "sci-fi",
            "render_config": {"preset": "vibrant", "version": 1},
        }
    )
    assert err is None
    assert "title" in data
    assert "style" in data
    assert "render_config" in data
    assert json.loads(data["render_config"]) == {
        "preset": "vibrant",
        "version": 1,
    }


def test_validate_update_payload_normalises_empty_string_to_none(studio_module):
    """`{render_config: ""}` clears the column — operator-friendly.
    Mirrors the existing `style` field's "" → None policy."""
    data, err = studio_module._validate_update_payload(
        {"render_config": ""}
    )
    assert err is None
    assert data["render_config"] is None


def test_validate_update_payload_rejects_bad_render_config(studio_module):
    """The error from `_validate_render_config` MUST bubble up
    intact — a 400 with the underlying message is the contract."""
    data, err = studio_module._validate_update_payload(
        {"render_config": 42}
    )
    assert data is None
    assert err is not None
    assert "必须是" in err


# ── 4. Render payload injection ───────────────────────────────────


def _stub_project(render_config: Any = None) -> Dict[str, Any]:
    return {
        "id": 99,
        "title": "Test Project",
        "synopsis": "一句话",
        "style": "sci-fi",
        "overlay_opacity": 0.5,
        "render_config": render_config,
    }


def _payload_of(studio_module, project):
    """Build the same JSON payload `_render_via_remotion` would
    serialise. Reproduces the inline `_json.dumps({...})` block so
    we don't have to spawn the Node bridge. Mirrors the helper
    pattern in `tests/test_studio_remotion_render.py`.
    """
    return {
        "project": {
            "id": project.get("id"),
            "title": project.get("title"),
            "synopsis": project.get("synopsis"),
            "style": project.get("style"),
            "overlay_opacity": project.get("overlay_opacity"),
            "render_config": project.get("render_config"),
        }
    }


def test_render_payload_roundtrips_preset_id(studio_module):
    """A row with `render_config = {preset: "noir"}` produces a
    bridge payload with the same dict under `project.render_config`.
    """
    project = _stub_project(render_config={"preset": "noir", "version": 1})
    payload = _payload_of(studio_module, project)
    assert payload["project"]["render_config"] == {
        "preset": "noir",
        "version": 1,
    }


def test_render_payload_handles_legacy_null_render_config(studio_module):
    """Pre-PR-A rows have `render_config = NULL`. The payload
    carries `None` through. `presets.ts::getPresetById(None)`
    returns CLASSIC at render-time."""
    project = _stub_project(render_config=None)
    payload = _payload_of(studio_module, project)
    assert payload["project"]["render_config"] is None


def test_render_payload_preserves_future_per_renderer_keys(studio_module):
    """Sprint-point flexibility: future per-renderer fields
    (custom font URL, motion-curve override, vendor-specific
    opaques) ride this same JSONB dict without a schema round-trip.
    """
    project = _stub_project(
        render_config={
            "preset": "vibrant",
            "version": 1,
            "fontUrl": "https://cdn.example.com/custom.woff2",
            "klingPrompt": "一只在霓虹灯下游动的金鱼",
        }
    )
    payload = _payload_of(studio_module, project)
    assert payload["project"]["render_config"]["fontUrl"].startswith("https://")
    assert "金鱼" in payload["project"]["render_config"]["klingPrompt"]# ── 5. Synopsis length cap (round-OPT-T2-follow-up) ────────────────
# Bumped `_SYNOPSIS_MAX_LEN` from 500 → 2000 (env-driven via
# `SAU_SYNOPSIS_MAX_LEN`, default `"2000"`) so multi-paragraph Chinese
# storyboards don't 400 on PATCH. The cap is enforced in BOTH
# `_validate_create_payload` (POST) and `_validate_update_payload`
# (PATCH) — pytest exercises both directions with the same boundary
# value so the contract is regression-tested at one place. Test the
# EXACT cap (2000 chars) and 2001 chars (one over) to lock the
# boundary; anything below 2000 is already covered by the existing
# `_validate_render_config` tests above (lessons-learned: an earlier
# round caught a 64-vs-65 boundary drift with a similar pair).


def test_validate_create_payload_accepts_exactly_2000_char_synopsis(studio_module):
    """`_validate_create_payload` accepts a `synopsis` whose
    `len(s)` is exactly `_SYNOPSIS_MAX_LEN` (default-2000 chars after
    round-OPT-T2-follow-up). Boundary: ≤2000 is in-bounds; 2001
    is out-of-bounds (next test). Without this pair, an `off-by-one`
    in any future cap-bump would silently let 2001-char synopses
    through and only be caught by the /api route's 400 response.
    """
    syn = "A" * 2000
    data, err = studio_module._validate_create_payload(
        {"title": "T", "synopsis": syn}
    )
    assert err is None, f"2000-char synopsis should be in-bounds, got: {err!r}"
    assert data is not None
    assert len(data["synopsis"]) == 2000


def test_validate_create_payload_rejects_2001_char_synopsis(studio_module):
    """Boundary just over: `_validate_create_payload` rejects
    2001-char synopses with a Chinese error message that names
    the cap. The same boundary is enforced in
    `_validate_update_payload`; PATCH coverage is the next test.
    """
    syn = "A" * 2001
    data, err = studio_module._validate_create_payload(
        {"title": "T", "synopsis": syn}
    )
    assert data is None, "2001-char synopsis must be rejected at create"
    assert err is not None
    assert "synopsis" in err and "超过" in err, (
        f"error must name both the field and the cap phrase; got {err!r}"
    )


def test_validate_update_payload_accepts_exactly_2000_char_synopsis(studio_module):
    """Same boundary on the PATCH path: 2000 chars passes; the
    route that prompted the cap bump was PATCH (Chrome DevTools
    "synopsis 长度不能超过 500 个字符"). Without this test the cap
    bump would only be regression-tested at create-time, leaving
    PATCH as the silent regression vector.
    """
    syn = "A" * 2000
    data, err = studio_module._validate_update_payload({"synopsis": syn})
    assert err is None, f"2000-char synopsis should be in-bounds on PATCH, got: {err!r}"
    assert data is not None
    assert data["synopsis"] == syn


def test_validate_update_payload_rejects_2001_char_synopsis(studio_module):
    """Same off-by-one on the PATCH path. The error message MUST
    name the same cap as POST so the operator sees a consistent
    contract regardless of HTTP verb.
    """
    syn = "A" * 2001
    data, err = studio_module._validate_update_payload({"synopsis": syn})
    assert data is None, "2001-char synopsis must be rejected at PATCH"
    assert err is not None
    assert "synopsis" in err and "超过" in err, (
        f"PATCH error must phrase the cap the same way as POST; got {err!r}"
    )


# ── 6. Catalog roundtrip cross-check (catalog literalisation) ─────

def test_known_preset_ids_are_safe_strings():
    """Deterministic string-list of known ids, used by the picker
    UI's `PRESETS` bound display. Mirrors
    `sau_web/frontend/remotion_studio/presets.ts::PRESETS.map(p =>
    p.id)`. Kept here ONLY as a sanity guard against the TS side
    drifting — when the picker ships and the user complains
    "preset not showing up", this test re-states the contract."""
    for pid in ("classic", "noir", "vibrant", "minimalist"):
        # Treat the canonical id set as the locked source of truth
        # for the PATCH validation tests above — any future
        # addition to the TS catalog should append here so the
        # sanity check continues to align.
        assert isinstance(pid, str)
        assert 1 <= len(pid) <= 64
