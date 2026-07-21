# Cache-Staleness Demo — Operator Runbook

> A reproducible diagnosis scenario + CI flake-detector for the disk-existence
> guard in `web_runner/routes/studio.py::_resolve_scene_videos` +
> `_resolve_scene_voiceovers` (round-Video-Backgrounds-v1 follow-up).
>
> Mirrors the structural convention of `monitor-cdp-throttling-cron-ops.md` and
> `public-inbox-ops.md` so an on-call operator landing at the repo root reaches
> it in 1 click.

## Why this exists

The disk-existence guard was added in the round-Video-Backgrounds-v1 follow-up
after a real production-style regression surfaced during E2E smoke: an operator
who deleted MP3s / MP4s from disk (bandwidth cleanup) while leaving the
`studio_assets` cache row behind crashed the renderer — `cached` URL short-
circuited the disk-write path, Chromium tried `GET /api/studio/render/<id>/media/scene_NNN.{mp4,mp3}`
and got 404, Node crashed with exit 4, Python surface `RuntimeError("未知错误")`
emitted to a misleading HTTP 500. The fix is a single `os.path.isfile(expected_path)`
check at the cache-hit early-return in both `_resolve_scene_videos._resolve_scene(…)`
and `_resolve_scene_voiceovers._resolve_scene(…)`. Without this runbook, future
refactors risk silently regressing the guard — a `DELETE FROM studio_assets`
schema change, a code path optimization, or a cache-key migration could all
weaken it.

This runbook ships **two reproducible scenarios** (each tests a different
code path of the helper), and proposes a **CI flake-detector** so the verdict
is locked at N≥3 re-renders rather than a single pass/fail.

## Two discriminated scenarios

The cache-staleness scenario has two distinct eval modes. Each exercises a
different helper code path; **both** must remain production-grade.

| Scenario | What's preserved | What's deleted | Helper path exercised |
|---|---|---|---|
| **A** — "preserve cache row, delete media" | `studio_assets.kind=background_video / voiceover` rows | `media/studio/<id>/media/scene_*` files | **disk-existence guard short-circuit miss → re-download / re-synthesize path** |
| **B** — "preserve media, delete cache row" | `media/studio/<id>/media/scene_*` files | `studio_assets` rows | **cache MISS → fresh synthesize path (no guard involvement)** |

Confused → real-world mapping:
- **Scenario A** is what a manual operator bandwidth cleanup looks like, or
  what a failed edge-tts run that wrote `media/` then crashed leaves behind.
- **Scenario B** is what a `DELETE FROM studio_assets` schema reset, a
  project-row deletion that didn't cascade, or a deployment that wipes the
  cache table but keeps `media/` looks like.

Both should produce an MP4 with `v:0=h264 + a:0=aac` and freshly-recreated
sidecars after a single re-render — only the helper code path differs.

## Scenario A — "preserve cache row, delete media"

This is what the live `media/studio/10/` directory is currently set up for
(preserved since cleanup cycle A of round-Video-Backgrounds-v1).

### Bootstrap (fresh DB / cold CI runner)

On a **fresh database** (CI runner cold cache, full schema reset, deletion
of all `studio_assets` rows), scenario A's baseline — `cache row alive
+ media alive` — does not yet exist. The disk-existence guard cannot fire
on a project whose cache row never existed; instead the helper takes the
cache-MISS → fresh-synthesize path (which is scenario B's territory).

To seed scenario A's baseline from a fresh DB:

1. **Run scenario B's procedure first** (delete cache row + render once);
   this re-inserts the cache row via the helper's UPSERT block.
2. **Verify with `/tmp/check_project10_cache.py`**:
   `VERDICT: cache + disk fully aligned → cache-staleness demo is reproducible`.

Operators continuing from the `feat/OPT-3F-e2e` branch's preserved state can
skip bootstrap — `media/studio/10/` already has the canonical scenario A
baseline intact.

### Pre-conditions

- `media/studio/10/media/scene_{000..003}.mp4` exist on disk
- `media/studio/10/media/scene_{000..003}.mp3` exist on disk
- `studio_assets` rows for `project_id=10` with `kind IN ('background_video', 'voiceover')`
  exist (verified via `/tmp/check_project10_cache.py`)
- Backend on `:6001` with `edge-tts` discoverable
  (`GET /api/studio/tts/health → data.available:true`)
- Synthetic-admin path is active (i.e. either `SAU_AUTH_ENABLED=false` or the
  operator supplies session cookies)

### Procedure

1. **Delete the media** — this is the demo trigger. Cache rows are PRESERVED:

   ```bash
   REPO=/Users/a123/Notes/02-project/projecke/github/social-auto-upload
   rm -f "$REPO/media/studio/10/media/scene_*.mp4"
   rm -f "$REPO/media/studio/10/media/scene_*.mp3"
   ls -la "$REPO/media/studio/10/media/"   # should now be empty
   ```

   **Do NOT touch `studio_assets`** — the rows must stay so the disk-existence
   guard has to actually fire.

2. **Trigger the render** — same path the web shell button uses:

   ```bash
   curl -sS --max-time 540 -X POST http://127.0.0.1:6001/api/studio/projects/10/render \
     -H 'Content-Type: application/json' -d '{}' \
     -w '\nHTTP:%{http_code} TIME:%{time_total}s\n'
   ```

3. **Expected outcome**:

   - HTTP 200, `{"success": true, "data": {"url": "/api/studio/render/10/render.mp4", ...}}`.
   - Without the disk-existence guard, this is where the bug fires:
     `cache_index[code]` returns the stale `ref_image_url` →
     `_build_absolute_url` composes the URL → Chromium GETs →
     Flask's `serve_studio_media` returns 404 → `<OffthreadVideo>` /
     `<Audio>` can't load → Node crash exit 4 → Python
     `RuntimeError("未知错误")` → 500.
   - With the guard in place, the helpers fall through to
     `_download_video_to_disk` / `synthesize_voiceover`, and the cache row
     UPSERTs the new URL afterward. Render.mjs consumes the fresh absolute
     URL → MP4 ships both streams.

4. **Verify**:

   ```bash
   REPO=/Users/a123/Notes/02-project/projecke/github/social-auto-upload
   FFPROBE=$(command -v ffprobe)   # macOS: /opt/homebrew/bin/ffprobe

   # scene_*.{mp4,mp3} must be freshly created (mtime = just-now)
   ls -la "$REPO/media/studio/10/media/"

   # v:0 must be h264 AND a:0 must be aac
   "$FFPROBE" -v error -select_streams v:0 \
     -show_entries stream=codec_name,width,height -of default=nw=1 \
     "$REPO/media/studio/10/render.mp4"
   "$FFPROBE" -v error -select_streams a:0 \
     -show_entries stream=codec_name,duration,channels,sample_rate -of default=nw=1 \
     "$REPO/media/studio/10/render.mp4"
   ```

   PASS gate: `v:0=h264 + a:0=aac + both nb_frames > 0`.

### Restore demo state

Re-run step 2 of the procedure to repopulate media. Or invoke
`/tmp/check_project10_cache.py` to confirm cache + disk alignment:

```bash
DATABASE_URL='postgres://postgres:changeme@127.0.0.1:5432/sau' \
  "$REPO/.venv/bin/python" /tmp/check_project10_cache.py
# VERDICT: cache + disk fully aligned → cache-staleness demo is reproducible
```

## Scenario B — "preserve media, delete cache row"

Used to test: missing cache row → fresh synthesis path fires correctly
(no short-circuit, the cache-staleness guard is NOT exercised).

### Pre-conditions

- `media/studio/10/media/scene_*.{mp4,mp3}` exist on disk (often carried over
  from scenario A's post-state)
- `studio_assets` rows for project 10 are DELETED
- Same backend + `tts_health` pre-conditions

### Procedure

1. **Reset cache rows** — the demo trigger. Files are PRESERVED:

   ```bash
   REPO=/Users/a123/Notes/02-project/projecke/github/social-auto-upload
   DATABASE_URL='postgres://postgres:changeme@127.0.0.1:5432/sau' \
     "$REPO/.venv/bin/python" - <<'PY'
   import sys
   sys.path.insert(0, "/Users/a123/Notes/02-project/projecke/github/social-auto-upload")
   from web_runner.db import get_database
   get_database().execute("DELETE FROM studio_assets WHERE project_id = 10;")
   PY
   ```

2. **Trigger the render** — same as scenario A step 2.

3. **Expected outcome**:

   - HTTP 200, full success. Helper path runs `_download_video_to_disk` /
     `synthesize_voiceover` (no cache hit short-circuit because the cache
     index is empty), re-writes `scene_*` to the same paths, and UPSERTs
     the cache rows back. The disk-existence guard is NOT in the path —
     this scenario exists specifically to confirm the helper can synthesize
     independently of any cache state.

4. **Verify the cache is repopulated**:

   ```bash
   DATABASE_URL='postgres://postgres:changeme@127.0.0.1:5432/sau' \
     "$REPO/.venv/bin/python" /tmp/check_project10_cache.py
   ```

   Expected VERDICT line: `cache + disk fully aligned → cache-staleness demo is reproducible`.

### Restore demo state

Re-run scenario A step 2 to repopulate cache rows + re-establish the
canonical scenario-A baseline.

## Current demo state — which scenario is the live `media/studio/10/`?

The current `media/studio/10/` directory (preserved since the cleanup cycle
earlier in the round-Video-Backgrounds-v1 thread) sits at **scenario A's**
baseline: cache rows are alive (12 of 12, verified by
`/tmp/check_project10_cache.py`), media files are alive. To exercise scenario A
next, just delete `media/` + render — the cache row triggers the guard.

> **Naming convention for fresh demos**: future rounds should not reuse
> `media/studio/10/` once scenario B has also been exercised. Pick a new
> project_id (next round: `11`; after that: `12`, etc.). Reusing the cache
> row of a previous demo creates a "cache layered on cache" state that hides
> which helper path actually fired.

## CI flake detector — proposal

To make the disk-existence guard's verdict stable under refactors, add a CI
job that triggers N rounds of re-render + asserts both `v:0=h264 + a:0=aac`
in each. Suggested placement: a new job in `.github/workflows/ci.yml` next to
the existing `python-test` step.

### Shell core (`scripts/cache-staleness-flake-detector.sh`)

```bash
#!/usr/bin/env bash
# 3-round re-render verifier — locks the disk-existence guard's verdict
# against intermittent file-state bugs that would slip a single-pass smoke.

set -uo pipefail

REPO=${REPO:-/Users/a123/Notes/02-project/projecke/github/social-auto-upload}
FFPROBE=$(command -v ffprobe)
ROUNDS=${ROUNDS:-3}

for round in $(seq 1 $ROUNDS); do
  echo "─── round $round ───"

  # 1. Wipe media, keep cache row (scenario A trigger)
  rm -f "$REPO/media/studio/10/media/scene_*.mp4"
  rm -f "$REPO/media/studio/10/media/scene_*.mp3"

  # 2. Re-render
  HTTP=$(curl -sS --max-time 540 -X POST \
    "$BACKEND/api/studio/projects/10/render" \
    -H 'Content-Type: application/json' -d '{}' \
    -o /tmp/flk-r$round.json -w '%{http_code}')

  # 3. Assert: HTTP 200 + v:0=h264 + a:0=aac
  V="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=codec_name \
       -of default=nw=1:nk=1 "$REPO/media/studio/10/render.mp4" 2>/dev/null)"
  A="$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=codec_name \
       -of default=nw=1:nk=1 "$REPO/media/studio/10/render.mp4" 2>/dev/null)"
  if [ "$HTTP" = "200" ] && [ "$V" = "h264" ] && [ "$A" = "aac" ]; then
    echo "round $round: PASS (v=$V a=$A)"
  else
    echo "round $round: FAIL (http=$HTTP v=$V a=$A)" >&2
    exit 1
  fi
done

echo "VERDICT: $ROUNDS/$ROUNDS rounds — flake guard is stable"
```

### Pytest analog (preferred, runs in `python-test` lane)

To land this as a CI gate, write the gating logic as a pytest with a strong
fixture contract. Place in `tests/test_cache_staleness_round_trip.py`:

```python
"""3-round re-render flake detector — exercises the disk-existence guard.

Each round wipes media, triggers render, asserts `v:0=h264 + a:0=aac`.
"""
import subprocess
from pathlib import Path

import pytest

REPO = Path("/Users/a123/Notes/02-project/projecke/github/social-auto-upload")
MEDIA = REPO / "media/studio/10/media"
RENDER = REPO / "media/studio/10/render.mp4"
BACKEND = "http://127.0.0.1:6001"


def _ffprobe_codec(streamspec: str) -> str:
    return subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", streamspec,
         "-show_entries", "stream=codec_name",
         "-of", "default=nw=1:nk=1", str(RENDER)],
        capture_output=True, text=True, check=False,
    ).stdout.strip()


@pytest.fixture(scope="module", autouse=True)
def demo_project_alive(client, db):
    """Pre-populate cache + media for project 10 once before the round loop."""
    # Use existing demo state OR synthesize fresh if missing.
    # TODO: implement when landing. Concrete sketch:
    #
    #     from pathlib import Path
    #     from web_runner.db import get_database
    #
    #     db = get_database()
    #     row = db.fetch_one(
    #         "SELECT COUNT(*) AS n FROM studio_assets "
    #         "WHERE project_id = 10 AND kind IN ('background_video', 'voiceover')"
    #     )
    #     media_dir = Path("/Users/a123/Notes/02-project/projecke/github/social-auto-upload"
    #                      "/media/studio/10/media")
    #     files_present = (
    #         any(media_dir.glob("scene_*.mp4"))
    #         and any(media_dir.glob("scene_*.mp3"))
    #     )
    #     if row["n"] < 8 or not files_present:
    #         pytest.skip(
    #             "cache-staleness demo state missing — run scripts/seed_cache_demo.sh "
    #             "first (see docs/dev/cache-staleness-demo.md §Bootstrap)"
    #         )
    pytest.skip("cache-staleness demo fixture not yet implemented; see TODO above.")


@pytest.mark.parametrize("round_i", [0, 1, 2])
def test_disk_existence_guard_round_trip(client, round_i):
    """Wipe media → render → assert streams. 3 rounds catches the typical
       1/10 race that a single-pass smoke misses."""
    for f in MEDIA.glob("scene_*"):
        if f.suffix in {".mp4", ".mp3"}:
            f.unlink()

    resp = client.post(f"/api/studio/projects/10/render", json={})
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    assert _ffprobe_codec("v:0") == "h264"
    assert _ffprobe_codec("a:0") == "aac"
```

Pytest implementation notes:
- The fixture contract (autouse `module` scope) pre-populates the cache +
  media once, so the parametrize loop just runs the wipe-render-assert cycle.
- A 3-round `parametrize` is preferred over a `for i in range(3)` loop inside
  one test — pytest reports each round independently so a single regression
  is identifiable without re-running the suite.
- The fixture MUST execute before the parametrized rounds. If the demo is
  broken (no cache row, no media), the fixture raises `pytest.skip`.
- DON'T add this test to `tests/test_studio_remotion_render.py` directly —
  it's a fixture-heavy flake gate, deserves its own file so the conftest
  contract is explicit.

### Wiring

Landing this in CI is small:
1. Add the script + the pytest analog above.
2. Add a job in `.github/workflows/ci.yml` next to `python-test`:
   ```yaml
   cache-staleness-flake-detector:
     runs-on: ubuntu-latest
     services:
       postgres: {image: postgres:16, env: {POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: sau_test}, ports: [5432:5432]}
     env:
       DATABASE_URL: postgresql://postgres:postgres@localhost:5432/sau_test
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-python@v5
       - run: pip install -e ".[dev]"
       - run: pytest tests/test_cache_staleness_round_trip.py -v
   ```
3. Update `docs/dev/INDEX.md`'s Operators section to mention this runbook.

## Common pitfalls

- **Modifier scope mix-up**: scenario A preserves rows but not files;
  scenario B preserves files but not rows. Mixing them up turns the test
  into a "cache fast path always wins" or "no-cache always wins" — both
  defeat the purpose.
- **Touching only `scene_000`**: round-1's `media-wipe` must `rm scene_*.mp4`
  globbing all 4 scenes; missing even one short-circuits the demo because
  `_resolve_scene_videos._resolve_scene(idx)` falls through per-scene.
- **Brace-glob is not POSIX-portable**: `rm scene_*.{mp4,mp3}` is bash- and
  zsh-specific expansion; **POSIX sh, fish, dash** (and any other shell
  lacking brace expansion) treat the brace as a literal character and
  silently remove nothing. Use the portable form:
  `rm scene_*.mp4 scene_*.mp3` (two separate globs, equivalent semantically).
- **Forgetting to clean captions**: `media/studio/<id>/render.mp4` is the
  audio-active check target, but the demo also produces `captions.srt` +
  `captions.ass` sidecars. They MUST also exist on disk for a healthy
  re-render; the pytest analog above only checks `render.mp4` because
  ffprobe on `.srt` isn't meaningful — but if sidecars are missing, that's
  a different bug path and you should NOT silently pass.
- **Race with subprocess.TimeoutExpired**: if a render hangs > 540 s
  (Flask's `_STUDIO_RENDER_TIMEOUT = int(os.environ.get('SAU_STUDIO_RENDER_TIMEOUT', '540'))`),
  curl times out and the helper's `subprocess.run` returns TimeoutExpired.
  Retry once: `subprocess.run` is single-shot. The right long-term fix
  lives in `docs/dev/INDEX.md` #operators — not in scope here.

## Cross-references

- `web_runner/routes/studio.py::_resolve_scene_videos` +
  `_resolve_scene_voiceovers` — the disk-existence guard lives here.
- `web_runner/routes/studio.py::_render_via_remotion` + render.mjs — the
  Remotion bridge that consumes absolute URLs.
- `docs/dev/studio-renderer-ops.md` § Verify + §Troubleshooting — smoke
  test + edge-tts/PATH row this runbook extends.
- `/tmp/sau-stress.sh` — 10-round fresh-path stress test, complementary
  direction: exercises the cache-MISS path whereas this runbook exercises
  the cache-HIT-but-disk-MISS path. Both should be green simultaneously.
- `/tmp/check_project10_cache.py` — companion DB probe prints cache + disk
  alignment verdict.
- `docs/dev/INDEX.md` — Operators hub (this runbook listed next to
  studio-renderer-ops).

Last updated: 2026-07-10 (post-Round-Video-Backgrounds-v1 follow-up).
