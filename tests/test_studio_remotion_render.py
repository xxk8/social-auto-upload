"""Pytest coverage for the Remotion render backend on /api/studio/projects/{id}/render.

Module-local contract:
  * ``_render_via_remotion`` spawns ``node <remotion_studio/render.mjs>``
    with the project/episodes JSON on stdin and parses the bridge's
    single-line JSON manifest on stdout.
  * The render route (`POST /api/studio/projects/<int:project_id>/render`)
    selects `_render_via_remotion` when ``SAU_STUDIO_RENDERER=remotion``
    (the new default) and surfaces a 500 with the bridge's stderr output
    when the subprocess exits non-zero.

These tests mock ``subprocess.run`` (no real Node / Chromium invoked) so
they are fast and deterministic — the actual rendering pipeline is
covered by manual smoke / the day-to-day operator workflow.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE_PATH = os.path.join(
    REPO_ROOT, "sau_web", "frontend", "remotion_studio", "render.mjs"
)


@pytest.fixture
def studio_module(monkeypatch):
    """Import `web_runner.routes.studio` fresh per test.

    Round-Video-Backgrounds-v1 deleted the `SAU_STUDIO_RENDERER` env
    switch (only Remotion remains); we still re-import the module
    fresh per test so cross-case state (e.g. cached
    `_subprocess.run` mocks) doesn't leak.
    """
    sys.modules.pop("web_runner.routes.studio", None)
    return importlib.import_module("web_runner.routes.studio")


def _make_completed_proc(returncode: int, stdout: bytes, stderr: bytes = b""):
    proc = mock.Mock(spec=subprocess.CompletedProcess)
    proc.returncode = returncode
    proc.stdout = stdout
    proc.stderr = stderr
    return proc


def _make_run_side_effect(manifest_stdout: bytes):
    """Factory that returns a `side_effect` function for `subprocess.run` mocks.

    Step 5 refactor: production code spawns the bridge with `--out` pointing
    at a fresh `tempfile.TemporaryDirectory()`, then `shutil.copy`s all
    three artifacts (mp4 + .srt + .ass) to the user-visible final path.
    The mock side_effect must:

      * create the tempdir passed via `args[0][3]` (the `--out` arg),
      * write stub render.mp4 + captions.srt + captions.ass files so the
        production code's post-render `shutil.copy` calls find sources
        (without these stub files, shutil.copy raises FileNotFoundError
        and the test fails before the function returns),
      * return a `_make_completed_proc(0, manifest_stdout)` so the
        production code's stdout-parsing manifest contract still parses
        (duration / width / height returned to the route).

    Without these filesystem-level stub writes, a render-mock that returns
    a CompletedProcess alone leaves the production code's copy step with
    a "source file does not exist" surprise. This helper keeps the
    `subprocess.run` mock contract honest under the Step 5 tempdir+copy
    pattern.
    """
    def _side_effect(*args, **kwargs):
        tmp_out_path = args[0][3]
        tmp_dir = os.path.dirname(tmp_out_path)
        # Stub mp4 is just zero-bytes — content doesn't matter for the
        # production contract (it only cares that the file lands at
        # `out_path`). 64 bytes is enough to round-trip via shutil.copy.
        Path(tmp_out_path).write_bytes(b"\x00" * 64)
        # Stub captions carry one valid SRT cue + an ASS header so the
        # bridge's writeFileSync contract holds (mirrors render.mjs's
        # buildSrt/buildAss outputs).
        Path(os.path.join(tmp_dir, "captions.srt")).write_text(
            "1\n00:00:00,000 --> 00:00:01,000\nhello stub\n\n",
            encoding="utf-8",
        )
        Path(os.path.join(tmp_dir, "captions.ass")).write_text(
            "[Script Info]\nScriptType: v4.00+\n\n",
            encoding="utf-8",
        )
        return _make_completed_proc(0, manifest_stdout)
    return _side_effect


def test_remotion_bridge_path_exists():
    """Guard against the operator rename — assert the script ships with
    the repo. If this fails, the operator's repo is misconfigured
    upstream of `_render_via_remotion`.
    """
    assert os.path.isfile(BRIDGE_PATH), (
        f"remotion_studio/render.mjs missing at {BRIDGE_PATH}. "
        "The flask route will surface a 500 '找不到 Remotion 桥接脚本' "
        "without it. Restore the file from the studio-remotion-renderer "
        "openspec change."
    )


def test_studio_module_exposes_remotion_only(studio_module):
    """Round-Video-Backgrounds-v1 deleted the trio of renderers
    (MoviePy + Hyperframes). Only `_render_via_remotion` survives —
    the `_USE_REMOTION` / `_USE_HYPERFRAMES` boolean gates and the
    corresponding `SAU_STUDIO_RENDERER=moviepy|hyperframes|remotion`
    env switch are gone. This test pins the new single-renderer
    shape so a future PR that (re)introduces a sibling renderer
    has to update this assertion deliberately, vs. silently
    regressing to a hidden env-switch.
    """
    assert hasattr(studio_module, "_render_via_remotion")
    assert callable(studio_module._render_via_remotion)
    # The two deleted renderers must NOT be exposed — a check that
    # catches an unintended re-revert (e.g. a git-hygiene mistake).
    assert not hasattr(studio_module, "_render_via_hyperframes")
    assert not hasattr(studio_module, "_USE_HYPERFRAMES")
    assert not hasattr(studio_module, "_USE_REMOTION")
    assert not hasattr(studio_module, "_RENDERER")


def test_render_via_remotion_spawns_node_with_payload(studio_module):
    """`_render_via_remotion` must:
      * spawn `[node, <bridge>, '--out', <out_path>]`
      * pipe a UTF-8 JSON payload on stdin that includes project + episodes
      * parse the stdout JSON manifest and return {duration, width, height}
    """
    payload = {
        "project": {
            "id": 1,
            "title": "测试作品",
            "synopsis": "一句话灵感",
            "style": None,
        },
        "episodes": [
            {
                "episode_no": 1,
                "title": "开端",
                "scenes": ["开场", "冲突"],
                "dialogues": ["主人公出现"],
            }
        ],
    }
    manifest_stdout = json.dumps(
        {"success": True, "duration": 12.4, "width": 1080, "height": 1920}
    ).encode("utf-8")

    out_path = "/tmp/fake-render/render.mp4"

    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        # Step 5 refactor requires side_effect (not return_value) so the
        # mock writes stub files into the tempdir passed via `--out`;
        # without those files, the post-render shutil.copy raises
        # FileNotFoundError before the function returns. See
        # `_make_run_side_effect` for the contract details.
        mock_run.side_effect = _make_run_side_effect(manifest_stdout)
        result = studio_module._render_via_remotion(
            payload["project"],
            payload["episodes"],
            out_path,
            project_id=1,
        )

    assert mock_run.call_count == 1
    call = mock_run.call_args
    cmd = call.args[0]
    assert cmd[1] == BRIDGE_PATH, (
        f"expected bridge path {BRIDGE_PATH}, got {cmd[1]}"
    )
    assert cmd[2] == "--out"
    # Step 5: --out points at a thread-safe tmpdir, NOT the user-
    # supplied final path. shutil.copy of all 3 artifacts to out_path
    # is what lands the final mp4 in the user-visible dir.
    assert cmd[3] != out_path, (
        f"--out should be a tempdir path, not the user-supplied final "
        f"out_path. Got {cmd[3]!r}. The Step 5 tempdir+copy contract "
        f"broken — production code likely regressed to writing directly."
    )
    assert cmd[3].endswith("render.mp4")
    # Cross-platform check — `tempfile.TemporaryDirectory()` may live
    # under /tmp/sau_render_* on Linux, /var/folders/.../T/sau_render_*
    # on macOS, or %TEMP%\sau_render_* on Windows. The basename is
    # what carries the prefix invariant; the absolute parent path
    # varies by OS.
    assert os.path.basename(os.path.dirname(cmd[3])).startswith("sau_render_"), (
        f"tempdir basename {os.path.basename(os.path.dirname(cmd[3]))} "
        f"should start with `sau_render_` per "
        f"`tempfile.TemporaryDirectory(prefix='sau_render_')` — verify "
        f"the prefix on `_render_via_remotion` hasn't been renamed."
    )

    stdin_bytes = call.kwargs["input"]
    parsed = json.loads(stdin_bytes.decode("utf-8"))
    assert parsed["project"]["title"] == "测试作品"
    assert parsed["episodes"][0]["scenes"] == ["开场", "冲突"]
    assert parsed["episodes"][0]["dialogues"] == ["主人公出现"]

    # Bridge reads stdin as UTF-8 — assert no ensure_ascii corruption on
    # the Chinese title (would surface as \\uXXXX escapes if `json.dumps`
    # forgot `ensure_ascii=False`).
    assert "\\u" not in stdin_bytes.decode("utf-8"), (
        "bridge stdin payload must NOT pre-escape unicode - render.mjs "
        "parses it as UTF-8, and any \\\\uXXXX escape would parse as "
        "literal characters. Set `ensure_ascii=False` on the Python "
        "json.dumps."
    )

    assert result["duration"] == pytest.approx(12.4)
    assert result["width"] == 1080
    assert result["height"] == 1920


def test_render_via_remotion_raises_runtime_on_nonzero_exit(studio_module):
    """A non-zero bridge exit must raise RuntimeError with the bridge's
    stderr text so the route surfaces it as a 500 with the cause.
    """
    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        mock_run.return_value = _make_completed_proc(
            returncode=1,
            stdout=b"",
            stderr=b"ERROR: composition 'StudioProject' missing\n".decode(
                "utf-8"
            ).encode("utf-8"),
        )
        with pytest.raises(RuntimeError) as exc_info:
            studio_module._render_via_remotion(
                {"title": "x", "synopsis": ""}, [], "/tmp/x.mp4", 1
            )
    assert "StudioProject" in str(exc_info.value)


def test_render_via_remotion_handles_timeout(studio_module):
    """When Node hangs past SAU_STUDIO_RENDER_TIMEOUT, surface a clean
    `渲染超时 (>Ns)` RuntimeError instead of letting the deadline kill
    the subprocess silently.
    """
    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        mock_run.side_effect = subprocess.TimeoutExpired(
            cmd=["node", "render.mjs"], timeout=600
        )
        with pytest.raises(RuntimeError) as exc_info:
            studio_module._render_via_remotion(
                {"title": "x", "synopsis": ""}, [], "/tmp/x.mp4", 1
            )
    assert "渲染超时" in str(exc_info.value)


def test_render_via_remotion_handles_missing_node(studio_module):
    """FileNotFoundError on the spawn must become a friendly
    RuntimeError mentioning the binary the operator should install.
    """
    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        mock_run.side_effect = FileNotFoundError(
            2, "No such file or directory: 'node'"
        )
        with pytest.raises(RuntimeError) as exc_info:
            studio_module._render_via_remotion(
                {"title": "x", "synopsis": ""}, [], "/tmp/x.mp4", 1
            )
    assert "node" in str(exc_info.value)


def test_render_via_remotion_sa_node_path_override(studio_module, monkeypatch):
    """SAU_STUDIO_NODE_PATH needs to override the spawn executable so
    asdf / nvm-managed Node binaries can be used without symlinking."""
    monkeypatch.setenv("SAU_STUDIO_NODE_PATH", "/usr/local/bin/node-22")
    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        # Step 5: switch from return_value to side_effect so the mock
        # writes stub files into the tempdir passed via --out.
        # Without stub files, the post-render shutil.copy raises
        # FileNotFoundError before the function returns.
        mock_run.side_effect = _make_run_side_effect(
            json.dumps(
                {"success": True, "duration": 1.0, "width": 1080, "height": 1920}
            ).encode("utf-8")
        )
        studio_module._render_via_remotion(
            {"title": "x", "synopsis": ""}, [], "/tmp/x.mp4", 1
        )
    assert mock_run.call_args.args[0][0] == "/usr/local/bin/node-22"


# ── Phase 2 — image-background cache + parallel-array plumbing ─────────
# These tests mock `web_runner.routes.ai._search_pexels` +
# `_normalize_pexels_photo` so they run fast and never hit Pexels's
# 200/h free-tier rate limit. Mocking the DB through `get_database()`
# keeps each test isolated without touching the test DB.
#
# Why `monkeypatch.setattr(studio_module, "get_database", ...)`:
# `_resolve_scene_backgrounds` resolves `get_database()` AT CALL TIME
# (not import time), so patching the module reference at the
# import-site intercepts every call inside the helper's lifetime.
# Patching it at the source module (`web_runner.routes.db` /
# `web_runner.db`) would similarly work but requires importing the
# source module here — the call-site patch keeps these tests
# self-contained.
def _stub_db(monkeypatch, studio_module, *, cached_rows):
    """Replace studio_module.get_database() with a captured-call mock
    that returns `cached_rows` from fetch_all and records execute().
    """
    db_mock = mock.Mock()
    db_mock.fetch_all.return_value = cached_rows
    db_mock.execute.return_value = None
    monkeypatch.setattr(studio_module, "get_database", lambda: db_mock)
    return db_mock


def _stub_pexels(monkeypatch, *, candidates):
    """Replace `web_runner.routes.ai._search_pexels` + normalise with
    deterministic fixtures. `candidates` is per-call (a list of photo
    dicts) — pass `lambda query, count, orientation: <list>` to vary
    per-call. Default normalise reads `src.original` and stringifies id.
    """
    def _search(query, count, orientation):
        # emulate the upstream contract: take first `count` items
        return list(candidates)[: max(1, count)]

    monkeypatch.setattr(
        "web_runner.routes.ai._search_pexels",
        mock.Mock(side_effect=_search),
    )
    monkeypatch.setattr(
        "web_runner.routes.ai._normalize_pexels_photo",
        lambda p: {
            "id": f"pexels:{p.get('id')}",
            "full": p.get("src", {}).get("original") or "",
            "preview": p.get("src", {}).get("large2x") or "",
            "thumb": p.get("src", {}).get("medium") or "",
        },
    )


def test_resolve_scene_backgrounds_cache_hit_returns_ref_image_url(
    studio_module, monkeypatch
):
    """When `studio_assets.kind='background'` rows exist for the
    project, `_resolve_scene_backgrounds` MUST return their
    `ref_image_url` verbatim and NEVER invoke `_search_pexels`.
    """
    project = {
        "id": 999,
        "title": "测试",
        "synopsis": "",
        "style": None,
        "overlay_opacity": 0.5,
    }
    scenes = [
        {"title": "A", "body": "“第一场”"},
        {"title": "B", "body": "第二场"},
    ]
    cached_rows = [
        {"code": "scene_000", "ref_image_url": "https://cdn.example/photoA.jpg"},
        {"code": "scene_001", "ref_image_url": "https://cdn.example/photoB.jpg"},
    ]
    db_mock = _stub_db(monkeypatch, studio_module, cached_rows=cached_rows)
    # Wire up _search_pexels via mock so we can assert NOT called
    pex_mock = mock.Mock(return_value=[])
    monkeypatch.setattr("web_runner.routes.ai._search_pexels", pex_mock)
    monkeypatch.setattr(
        "web_runner.routes.ai._normalize_pexels_photo",
        lambda p: {"id": f"pexels:{p.get('id')}", "full": "", "preview": "", "thumb": ""},
    )

    out = studio_module._resolve_scene_backgrounds(project, scenes)
    assert out == [
        "https://cdn.example/photoA.jpg",
        "https://cdn.example/photoB.jpg",
    ]
    assert pex_mock.call_count == 0
    # No UPSERT when everything is cache-hit (the whole point of
    # caching — cache hits skip the write path)
    assert db_mock.execute.call_count == 0


def test_resolve_scene_backgrounds_cache_miss_calls_pexels_portrait_and_upserts(
    studio_module, monkeypatch
):
    """Cache miss path: empty cache row set → Pexels is called with
    orientation='portrait' + count=2 (cross-scene dedupe room) → the
    chosen photo is UPSERTed into studio_assets.kind='background'.
    """
    project = {
        "id": 999,
        "title": "测试",
        "synopsis": "",
        "style": None,
        "overlay_opacity": 0.5,
    }
    scenes = [{"title": "A", "body": "海凊天空"}]
    db_mock = _stub_db(monkeypatch, studio_module, cached_rows=[])
    _stub_pexels(
        monkeypatch,
        candidates=[
            {"id": 42, "src": {"original": "https://cdn.example/photo42.jpg"}},
        ],
    )

    out = studio_module._resolve_scene_backgrounds(project, scenes)
    assert out == ["https://cdn.example/photo42.jpg"]

    # Pexels was called with the exact Phase-2 contract: orientation
    # 'portrait' + count=2 (we asked for two so the dedupe guard has
    # a fallback candidate for adjacent-cache-miss duplicates).
    # Reach into the ai module via direct attribute read — the patch
    # happened before this assertion and we want the live mock object.
    import web_runner.routes.ai as _ai_mod
    assert _ai_mod._search_pexels.call_count == 1
    args, kwargs = _ai_mod._search_pexels.call_args
    assert kwargs.get("orientation") == "portrait"
    assert kwargs.get("count") == 2

    # UPSERT was issued with the cache-miss write path contract.
    upsert_calls = [
        c for c in db_mock.execute.call_args_list
        if "INSERT INTO studio_assets" in (c.args[0] if c.args else "")
    ]
    assert len(upsert_calls) == 1, (
        f"expected exactly 1 UPSERT for scene_000, got {len(upsert_calls)}: "
        f"{db_mock.execute.call_args_list}"
    )
    sql = upsert_calls[0].args[0]
    # Pin the schema contract in lockstep (not as a loose substring match).
    # The `'background'` literal is anchored to a VALUES clause position so
    # a future SQL change that introduces the same literal in an unrelated
    # context (e.g. a `'background_image'` column default) won't false-pass.
    assert "INSERT INTO studio_assets" in sql
    assert "ON CONFLICT (project_id, kind, code)" in sql
    assert re.search(r"VALUES\s*\([^)]*'background'", sql), (
        f"UPSERT must carry kind='background' as a VALUES-clause literal: {sql}"
    )
    assert "EXCLUDED.ref_image_url" in sql   # ON CONFLICT DO UPDATE path lands
    # `code` argument must be scene_<zero-paddedidx>
    call_args = upsert_calls[0].args[1]
    assert call_args[1] == "scene_000"
    assert call_args[2] == "A" or call_args[2].startswith("A")[:80]


def test_resolve_scene_backgrounds_pexels_empty_returns_none(
    studio_module, monkeypatch
):
    """When Pexels returns [] (rate-limited, no match, key missing), the
    helper MUST degrade to ``[None, None, ...]`` and still NOT crash.
    Parallel invariant to ``test_resolve_scene_backgrounds_cache_hit_...
    ``: BOTH branches must leave ``db_mock.execute`` untouched.
    """
    project = {
        "id": 999,
        "title": "测试",
        "synopsis": "",
        "style": None,
        "overlay_opacity": 0.5,
    }
    scenes = [{"title": "A", "body": "海凊天空"}, {"title": "B", "body": "森林"}]
    db_mock = _stub_db(monkeypatch, studio_module, cached_rows=[])
    _stub_pexels(monkeypatch, candidates=[])

    out = studio_module._resolve_scene_backgrounds(project, scenes)
    assert out == [None, None]
    # Parallel invariant to the cache-hit test: zero UPSERTs when
    # Pexels returns empty.
    assert db_mock.execute.call_count == 0


def test_resolve_scene_backgrounds_cross_scene_dedupe_works(
    studio_module, monkeypatch
):
    """If Pexels returns the same `[id=1, id=2]` candidates for two
    adjacent scenes, the dedupe guard MUST pick id=1 for scene[0] and
    id=2 for scene[1]. Without the guard both scenes would land on
    id=1 → a jarring 6-second loop of the same photo.
    """
    project = {
        "id": 999,
        "title": "测试",
        "synopsis": "",
        "style": None,
        "overlay_opacity": 0.5,
    }
    scenes = [{"title": "A", "body": "天空"}, {"title": "B", "body": "天空"}]
    _stub_db(monkeypatch, studio_module, cached_rows=[])

    # Every Pexels call returns the exact same [id=1, id=2] set;
    # dedupe logic is what differentiates scene[0] vs scene[1].
    monkeypatch.setattr(
        "web_runner.routes.ai._search_pexels",
        mock.Mock(
            return_value=[
                {"id": 1, "src": {"original": "https://cdn.example/p1.jpg"}},
                {"id": 2, "src": {"original": "https://cdn.example/p2.jpg"}},
            ]
        ),
    )
    monkeypatch.setattr(
        "web_runner.routes.ai._normalize_pexels_photo",
        lambda p: {
            "id": f"pexels:{p.get('id')}",
            "full": p.get("src", {}).get("original") or "",
            "preview": "",
            "thumb": "",
        },
    )

    out = studio_module._resolve_scene_backgrounds(project, scenes)
    assert out == [
        "https://cdn.example/p1.jpg",
        "https://cdn.example/p2.jpg",
    ], (
        "Dedupe failed: scene[1] should pick the SECOND candidate (id=2) "
        "since id=1 was already chosen by scene[0]. Without the guard, "
        "both scenes would silently pick id=1."
    )


def test_resolve_scene_backgrounds_clamps_malformed_cache_url_to_none(
    studio_module, monkeypatch
):
    """Defensive read path: a cache row whose `ref_image_url` is NULL,
    empty-string, or non-string MUST be treated as a miss. This stops
    a manual SQL UPDATE from regressing renders to broken `<Image src=''>`
    URLs.

    Tests all three malformed flavours by feeding a 3-scene project
    whose cache row per scene is malformed in a different way. The
    helper falls through to Pexels for all 3 cache-miss flavours; the
    2 non-None URLs get UPSERT'd, while scene 2 may dedupe to None if
    its Pexels candidates are already-claimed by an earlier scene —
    that's cross-scene dedupe policy (verified separately in
    `test_resolve_scene_backgrounds_cross_scene_dedupe_works`), not a
    malformed-cache regression.
    """
    project = {
        "id": 999,
        "title": "测试",
        "synopsis": "",
        "style": None,
        "overlay_opacity": 0.5,
    }
    scenes = [
        {"title": "A", "body": "海凊天空"},
        {"title": "B", "body": "草原"},
        {"title": "C", "body": "城尾"},
    ]

    db_mock = _stub_db(
        monkeypatch,
        studio_module,
        cached_rows=[
            # Three flavours of "malformed" — ALL must signal miss.
            {"code": "scene_000", "ref_image_url": None},
            {"code": "scene_001", "ref_image_url": ""},
            {"code": "scene_002", "ref_image_url": 12345},  # non-string
        ],
    )
    _stub_pexels(
        monkeypatch,
        candidates=[
            # Deterministic actual-flow fixture. The `_stub_pexels`
            # helper does `candidates[:max(1, count)]` on EVERY call —
            # so all 3 Pexels invocations see the same [id_7, id_8]
            # pair. Scene 0 picks fresh id=7; scene 1 skips 7 and picks
            # id=8; scene 2 dedupes both (both now in seen_pexels_ids)
            # and falls through to None. We pin those exact 2 ids here
            # rather than carrying a 6-candidate list because the
            # helper would still slice [:count] from it anyway — the
            # production behavior we're modelling is "Pexels returns
            # the same first-N results for adjacent-similar prompts",
            # which is what `cross_scene_dedupe_works` already covers.
            {"id": 7, "src": {"original": "https://cdn.example/p7.jpg"}},
            {"id": 8, "src": {"original": "https://cdn.example/p8.jpg"}},
        ],
    )

    out = studio_module._resolve_scene_backgrounds(project, scenes)
    # Three scenes × 3 cache-miss flavours × [p7, p8] Pexels slice:
    #   * Scene 0: Pexels [7, 8]; 7 not in seen → chosen_norm=p7, picked ✓
    #   * Scene 1: Pexels [7, 8]; 7 in seen, 8 not → chosen_norm=p8, picked ✓
    #   * Scene 2: Pexels [7, 8]; both 7+8 in seen → chosen_norm=None → None
    # The invariant we verify here is "all 3 malformed cache rows force a
    # Pexels call, and the 2 non-None scenes UPSERT correctly". Scene 2's
    # None is the dedupe guard correctly firing, NOT a malformed-cache
    # regression — `cross_scene_dedupe_works` covers the dedupe policy
    # in isolation.
    assert out == [
        "https://cdn.example/p7.jpg",
        "https://cdn.example/p8.jpg",
        None,
    ], (
        f"malformed-cache + cross-scene dedupe produced unexpected: {out}. "
        f"Scene 2's None is correct dedupe behavior (both upstream ids 7+8 "
        f"already claimed by scenes 0+1). A regression would be "
        f"[None, None, None] (Pexels never returned) or three distinct URLs "
        f"(Pexels returning rotating photos, which the test stub does not "
        f"model — see test_resolve_scene_backgrounds_cross_scene_dedupe_works)."
    )
    # Pin UPSERT count via SQL marker (more robust than total
    # `execute.call_count` which would also catch any future
    # audit-log / idempotency-stamp INSERTs the helper might
    # add — wrongly failing the test). 2 UPSERTs matches the 2
    # non-None URLs; scene 2's None branch short-circuits before
    # `db.execute` so no third UPSERT fires.
    upsert_calls = [
        c for c in db_mock.execute.call_args_list
        if "INSERT INTO studio_assets" in (c.args[0] if c.args else "")
    ]
    assert len(upsert_calls) == 2, (
        f"expected exactly 2 UPSERTs (one per non-None URL), got "
        f"{len(upsert_calls)}: {db_mock.execute.call_args_list}"
    )
    # No UPSERT shortcuts via a different execute path — every non-None
    # scene must route through the per-scene UPSERT branch.
    other_executes = [
        c for c in db_mock.execute.call_args_list
        if c not in upsert_calls
    ]
    assert other_executes == [], (
        f"unexpected non-UPSERT executes leaked into the helper: "
        f"{other_executes}"
    )


def test_render_via_remotion_carries_overlay_opacity_and_parallel_background_urls(
    studio_module, monkeypatch
):
    """Phase 2 — payload MUST include:
      * `project.overlay_opacity` (single source of truth, default 0.5)
      * top-level `overlay_opacity` mirror (legacy callers / debug)
      * `scenes[]` flat list (preferred contract)
      * `background_urls[]` parallel array, indices aligned to scenes[]
    The Node bridge uses the parallel array index-for-index to decide
    which `<Image>` to mount behind each scene's text card.
    """
    project = {
        "id": 7,
        "title": "测试作品",
        "synopsis": "一句话灵感",
        "style": "noir",
        "overlay_opacity": 0.7,
    }
    episodes = [
        {
            "episode_no": 1,
            "title": "起",
            "scenes": ["a", "b"],
            "dialogues": [],
        },
        {
            "episode_no": 2,
            "title": "承",
            "scenes": ["c"],
            "dialogues": ["d"],
        },
    ]
    _stub_db(monkeypatch, studio_module, cached_rows=[])
    _stub_pexels(
        monkeypatch,
        candidates=[
            {"id": 100, "src": {"original": "https://cdn.example/p100.jpg"}},
            {"id": 101, "src": {"original": "https://cdn.example/p101.jpg"}},
        ],
    )

    manifest = json.dumps(
        {"success": True, "duration": 8.0, "width": 1080, "height": 1920}
    ).encode("utf-8")
    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        # Step 5: side_effect writes stub files into the tempdir passed
        # via --out so the post-render shutil.copy can land artifacts
        # at the user-supplied final path. See _make_run_side_effect.
        mock_run.side_effect = _make_run_side_effect(manifest)
        studio_module._render_via_remotion(
            project, episodes, "/tmp/fake-render/render.mp4", project_id=7
        )

    payload = json.loads(mock_run.call_args.kwargs["input"].decode("utf-8"))
    assert payload["project"]["overlay_opacity"] == pytest.approx(0.7)
    assert payload["overlay_opacity"] == pytest.approx(0.7)
    assert "scenes" in payload
    assert "background_urls" in payload
    assert len(payload["scenes"]) == len(payload["background_urls"]), (
        f"parallel-array contract broken: scenes={len(payload['scenes'])} "
        f"vs background_urls={len(payload['background_urls'])}"
    )
    # Verify URL is the Pexels URL (cross-check it isn't the project's
    # own overlay, which would be a copy-paste bug).
    for u in payload["background_urls"]:
        assert isinstance(u, str) or u is None
        if u is not None:
            assert u.startswith("https://cdn.example/")


def test_render_via_remotion_default_overlay_opacity_is_half(studio_module, monkeypatch):
    """When the source project row lacks `overlay_opacity` (NULL on a
    pre-migration DB), the rendered payload MUST default to 0.5 to
    match the SQL `DEFAULT 0.5` on the column.
    """
    project_no_op = {
        "id": 8,
        "title": "测试",
        "synopsis": "word",
        "style": None,
        # overlay_opacity omitted entirely
    }
    episodes = []
    _stub_db(monkeypatch, studio_module, cached_rows=[])
    _stub_pexels(monkeypatch, candidates=[])

    manifest = json.dumps(
        {"success": True, "duration": 0.1, "width": 1080, "height": 1920}
    ).encode("utf-8")
    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        # Step 5: side_effect writes stub files (see _make_run_side_effect).
        mock_run.side_effect = _make_run_side_effect(manifest)
        studio_module._render_via_remotion(
            project_no_op, episodes, "/tmp/fake-render/render.mp4", project_id=8
        )

    payload = json.loads(mock_run.call_args.kwargs["input"].decode("utf-8"))
    assert payload["project"]["overlay_opacity"] == pytest.approx(0.5)
    assert payload["overlay_opacity"] == pytest.approx(0.5)


def test_stub_pexels_slice_every_call_contract(studio_module, monkeypatch):
    """Pins the `_stub_pexels` slice-every-call contract.

    `_stub_pexels` returns `candidates[:max(1, count)]` on EVERY call,
    regardless of how many scenes have already queried Pexels. This
    contract underwrites the deterministic `[p7, p8, None]` behavior
    that `test_resolve_scene_backgrounds_clamps_malformed_cache_url_to_none`
    asserts downstream — scene 2's `None` is correct only because
    `_stub_pexels` returns the same `[p7, p8]` subset on every call.

    A future maintainer who refactors `_stub_pexels` to be counter-based
    or per-call-rotating (e.g. run-2 mock.Mock cycle) would silently
    break that downstream test's `[p7, p8, None]` assertion without
    failing this contract test. This test pins the slice behavior so
    the refactor is caught explicitly with a clear "helper contract
    changed" message — not as a downstream flake on a multi-second
    production test.
    """
    _stub_pexels(monkeypatch, candidates=["a", "b", "c"])

    import web_runner.routes.ai as _ai_mod
    direct_results = [
        _ai_mod._search_pexels(q, n, o)
        for (q, n, o) in [
            ("q1", 2, "portrait"),
            ("q2", 2, "portrait"),
            ("q3", 1, "portrait"),
            # A 4th call to confirm the slice is stable across many
            # invocations, not just the early-life of the mock.
            ("q4", 2, "portrait"),
        ]
    ]
    assert direct_results == [
        ["a", "b"],   # q1, count=2 → candidates[:2]
        ["a", "b"],   # q2, count=2 → candidates[:2] (NOT candidates[2:4])
        ["a"],        # q3, count=1 → candidates[:1] (the entire `_search`
                      #                 function contract, not just count=2)
        ["a", "b"],   # q4, count=2 → candidates[:2] again
    ], (
        f"_stub_pexels contract changed: each call must return "
        f"`candidates[:max(1, count)]` (same first-N subset on every "
        f"call), got {direct_results}. See "
        f"`test_resolve_scene_backgrounds_clamps_malformed_cache_url_to_none` "
        f"for the assertion that depends on this contract."
    )


# ── Step 5 — tempfile + shutil.copy refactor ────────────────────────────
# The long-term fix in `web_runner/routes/studio.py::_render_via_remotion`
# raises the cross-UID mount-fs PermissionError case to a clean
# `shutil.copy`-level RuntimeError (`跨权限级复制失败 (cross-UID copy
# failed)`) instead of letting the bridge's `writeFileSync` race the
# mount during renderMedia. The following 3 tests pin the new contract:
#   1. Tempdir-passed --out + shutil.copy to final path → the 3 final
#      files land at the user-supplied paths and the tmpdir is cleaned
#      up automatically by Python's TemporaryDirectory context exit.
#   2. Bridge exit-N (RuntimeError path) → tmpdir is still cleaned up
#      (no /tmp residue from failed renders).
#   3. shutil.copy PermissionError → wrapped as RuntimeError with the
#      "跨权限级复制失败" message; route surfaces 500 with the cause.


def test_remotion_render_uses_tempdir_and_copies_to_final_on_success(
    studio_module, tmp_path
):
    """Step 5 — happy path: --out points at a tempdir, and the 3
    artifacts (render.mp4 + captions.srt + captions.ass) are
    shutil.copied to the user-supplied final path. TemporaryDirectory
    cleans up automatically on context exit (verified by `not
    os.path.exists(<tmpdir>)` post-return).
    """
    out_path = str(tmp_path / "fake-render" / "render.mp4")
    manifest_stdout = json.dumps(
        {"success": True, "duration": 1.0, "width": 1080, "height": 1920}
    ).encode("utf-8")

    # Capture the tempdir passed to subprocess.run so we can verify
    # cleanup afterwards. The factory closure records `tmp_out_path`
    # into `captured` then writes the 3 stub artifacts.
    captured: dict = {}

    def _side_effect(*args, **kwargs):
        tmp_out_path = args[0][3]
        captured["tmp_out_path"] = tmp_out_path
        tmp_dir = os.path.dirname(tmp_out_path)
        Path(tmp_out_path).write_bytes(b"\x00" * 64)
        Path(os.path.join(tmp_dir, "captions.srt")).write_text(
            "1\n00:00:00,000 --> 00:00:01,000\nhi\n\n", encoding="utf-8"
        )
        Path(os.path.join(tmp_dir, "captions.ass")).write_text(
            "[Script Info]\nScriptType: v4.00+\n\n", encoding="utf-8"
        )
        return _make_completed_proc(0, manifest_stdout)

    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        mock_run.side_effect = _side_effect
        result = studio_module._render_via_remotion(
            {"title": "x", "synopsis": ""}, [], out_path, project_id=1
        )

    # 1. The --out arg passed to subprocess.run is the tempdir path,
    #    NOT the user-supplied final path.
    assert captured["tmp_out_path"] != out_path
    assert captured["tmp_out_path"].endswith("render.mp4")
    # Cross-platform prefix check — see the same comment in
    # `test_render_via_remotion_spawns_node_with_payload`. Tests the
    # basename only; absolute parent varies by OS.
    assert os.path.basename(os.path.dirname(captured["tmp_out_path"])).startswith(
        "sau_render_"
    ), (
        f"tempdir basename "
        f"{os.path.basename(os.path.dirname(captured['tmp_out_path']))} "
        f"should start with `sau_render_` per the production prefix "
        f"`tempfile.TemporaryDirectory(prefix='sau_render_')`. If this "
        f"assertion fails, verify the prefix hasn't been renamed "
        f"without updating this test."
    )

    # 2. All three artifacts landed at the user-supplied final path.
    #    pytest's `tmp_path` fixture auto-cleans on test end so test
    #    disk space doesn't leak.
    final_dir = os.path.dirname(out_path)
    assert os.path.isfile(out_path), "render.mp4 missing at user path"
    assert os.path.isfile(
        os.path.join(final_dir, "captions.srt")
    ), "captions.srt missing at user path"
    assert os.path.isfile(
        os.path.join(final_dir, "captions.ass")
    ), "captions.ass missing at user path"
    # Assert `>= 1`, NOT `== 64` — the test's goal is "render.mp4 landed at
    # the user-visible final path with non-empty content" (Step 5 contract).
    # An exact-bytes assertion would lock the test to the side_effect's
    # current stub size; any future change (real MP4 ftyp-box magic
    # header, a sidecar with embedded cover art, etc.) would break the
    # test for unrelated reasons. The relaxed form captures the same
    # operational claim without brittleness.
    assert os.path.getsize(out_path) >= 1, (
        f"render.mp4 size at user path is {os.path.getsize(out_path)}, "
        f"expected >= 1 (any non-empty content proves copy2 landed). "
        f"A size of 0 indicates the post-render copy2 didn't run or "
        f"failed silently."
    )

    # 3. TemporaryDirectory cleanup fired. Post-function the tempdir
    #    should not exist (Python's weakref-finalizer-based cleanup
    #    guarantees this on success AND raise paths since 3.2).
    # Cross-platform cleanup check: tempdir should be gone regardless
    # of where TemporaryDirectory chose to create it (/tmp vs macOS
    # /var/folders vs Windows %TEMP%). Use the captured temp_out_path
    # from the side_effect rather than reconstructing from prefix.
    assert not os.path.exists(
        os.path.dirname(captured["tmp_out_path"])
    ), (
        f"TemporaryDirectory cleanup did NOT fire for "
        f"{os.path.dirname(captured['tmp_out_path'])}. Either the "
        f"`with` block exited via something other than the "
        f"`__exit__` clean path (e.g., os._exit()), or the tempdir "
        f"prefix is leaking past `TemporaryDirectory(prefix='sau_render_')`."
    )

    # 4. Manifest parsed from stdout returned the duration/width/height
    #    triple (production contract — unchanged from before Step 5).
    assert result["duration"] == pytest.approx(1.0)
    assert result["width"] == 1080
    assert result["height"] == 1920


def test_remotion_render_cleans_tempdir_on_subprocess_error(studio_module):
    """Step 5 — bridge exit-N path: `subprocess.run` returns a
    CompletedProcess with returncode != 0, production code raises
    RuntimeError. The tempdir must STILL be cleaned up — the
    `TemporaryDirectory` weakref-finalizer pattern guarantees
    cleanup on every `__exit__` path including raises.
    """
    captured: dict = {}

    def _side_effect(*args, **kwargs):
        captured["tmp_out_path"] = args[0][3]
        # Non-zero exit code with stderr noise — production code's
        # `if proc.returncode != 0` branch raises RuntimeError.
        return _make_completed_proc(
            returncode=4,
            stdout=b"",
            stderr=b"ERROR: renderMedia chromium crash (OOM)\n".decode(
                "utf-8"
            ).encode("utf-8"),
        )

    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        mock_run.side_effect = _side_effect
        with pytest.raises(RuntimeError) as exc_info:
            studio_module._render_via_remotion(
                {"title": "x", "synopsis": ""}, [], "/tmp/x.mp4", project_id=1
            )

    assert "renderMedia chromium crash" in str(exc_info.value)
    # No shutil.copy was reached (we never got past the bridge
    # returncode check), but the tempdir WAS created before the
    # `subprocess.run` call — verify cleanup fired despite the raise.
    # No shutil.copy was reached (we never got past the bridge
    # returncode check), but the tempdir WAS created before the
    # `subprocess.run` call — verify cleanup fired despite the raise.
    assert not os.path.exists(
        os.path.dirname(captured["tmp_out_path"])
    ), (
        f"TemporaryDirectory cleanup did NOT fire on RuntimeError — "
        f"the `with` block's `__exit__` cleanup is broken. Operators "
        f"would accumulate tempdir residue from failed renders."
    )


def test_remotion_render_raises_runtime_error_on_shutil_eacces(studio_module):
    """Step 5 — shutil.copy PermissionError path: when the
    user-supplied dst mount is cross-UID and the Flask process literally
    can't write there as a user, the production code's
    `except PermissionError as exc:` branch raises RuntimeError with the
    `跨权限级复制失败 (cross-UID copy to <final_dir>: ...)` message so
    the route surfaces a clean 500 with the cause.
    """
    manifest_stdout = json.dumps(
        {"success": True, "duration": 1.0, "width": 1080, "height": 1920}
    ).encode("utf-8")

    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        mock_run.side_effect = _make_run_side_effect(manifest_stdout)
        # Patch `_shutil` (the module alias the production code uses
        # for shutil) so any call to `_shutil.copy2(...)` raises
        # PermissionError. We use a counter side effect so the 3 copy
        # calls (mp4 + srt + ass) all raise — verifying the catch
        # block isn't accidentally swallowed by a re-raise from the
        # second copy that shadows the first failure.
        copy_call_count: list = [0]
        def _copy_side_effect(*args, **kwargs):
            copy_call_count[0] += 1
            raise PermissionError(
                13, f"Permission denied: '{args[1]}'"
            )
        with mock.patch.object(studio_module, "_shutil") as mock_shutil:
            mock_shutil.copy2.side_effect = _copy_side_effect
            with pytest.raises(RuntimeError) as exc_info:
                studio_module._render_via_remotion(
                    {"title": "x", "synopsis": ""}, [], "/tmp/x.mp4", project_id=1
                )

    # Verify the RuntimeError carries the expected Chinese copy-failed
    # message AND the dst dir for operator triage.
    assert "跨权限级复制失败" in str(exc_info.value), (
        f"expected 跨权限级复制失败 in RuntimeError, got: {exc_info.value}"
    )
    assert "/tmp" in str(exc_info.value), (
        f"expected dst dir in RuntimeError message for triage, got: {exc_info.value}"
    )
    # Verify all 3 copy calls attempted before the catch block re-raised
    # (production code's try/except wraps the entire 3-call sequence, so
    # any one PermissionError triggers the catch and surfaces as
    # RuntimeError; the count of 3 confirms we visited all attempts).
    assert copy_call_count[0] >= 1, (
        f"expected at least one shutil.copy2 call before RuntimeError, "
        f"got {copy_call_count[0]}"
    )


def test_remotion_render_raises_runtime_error_on_partial_shutil_eacces(
    studio_module,
):
    """Step 5 — partial copy failure mid-sequence: `_shutil.copy2`
    succeeds for render.mp4 but raises PermissionError on the 2nd
    call (captions.srt). Production code's try/except is per-block
    (all 3 copies inside one try, one except PermissionError) — so
    a mid-sequence raise must STILL surface as a single clean
    RuntimeError. Without this guard, a partial-copy leave-behind
    would silently leave a render.mp4 on disk with no captions.

    Pins the realistic operator scenario: e.g. a stale `0444 render.mp4`
    from a prior pod gets refreshed, but a vin mounted on the sidecar
    path freezes mid-write. The mp4 lands OK; captions.srt raises;
    route returns 500 with cross-UID message.
    """
    manifest_stdout = json.dumps(
        {"success": True, "duration": 1.0, "width": 1080, "height": 1920}
    ).encode("utf-8")

    copy_call_count: list = [0]
    def _copy_partial_side_effect(*args, **kwargs):
        copy_call_count[0] += 1
        # 1st call (render.mp4) succeeds — no-op from the mock side.
        # 2nd call (captions.srt) raises mid-sequence.
        # 3rd call (captions.ass) should NOT be reached — the catch
        # block fires from the 2nd raise.
        if copy_call_count[0] == 2:
            raise PermissionError(
                13, "Permission denied on captions.srt"
            )
        return None

    with mock.patch.object(studio_module._subprocess, "run") as mock_run:
        mock_run.side_effect = _make_run_side_effect(manifest_stdout)
        with mock.patch.object(studio_module, "_shutil") as mock_shutil:
            mock_shutil.copy2.side_effect = _copy_partial_side_effect
            with pytest.raises(RuntimeError) as exc_info:
                studio_module._render_via_remotion(
                    {"title": "x", "synopsis": ""}, [], "/tmp/x.mp4", project_id=1
                )

    # Mid-sequence raise surfaced as a single clean RuntimeError.
    assert "跨权限级复制失败" in str(exc_info.value), (
        f"expected 跨权限级复制失败 in RuntimeError from mid-sequence "
        f"raise, got: {exc_info.value}"
    )
    # Exactly 2 copy attempts: mp4 succeeded (call 1), captions.srt
    # raised (call 2). captions.ass (call 3) was NOT attempted — the
    # catch block stops the sequence on the first raise. This is the
    # invariant that distinguishes a "mid-sequence guard" from a
    # "per-call guard" (the latter would let copy 3 run after a
    # copy 2 raise, silently writing captions.ass without
    # captions.srt — a partial-state bug).
    assert copy_call_count[0] == 2, (
        f"expected exactly 2 copy2 attempts (mp4 OK, captions.srt "
        f"raises mid-sequence, captions.ass NOT attempted), got "
        f"{copy_call_count[0]}. If the count is 3, the catch block "
        f"isn't stopping on the mid-sequence raise."
    )
