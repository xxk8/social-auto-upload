# Studio Renderer (Remotion) — Operator Runbook

> Per-request video render path for `/dashboard/studio`. Covers the **deploy** (minimal Dockerfile patch — fonts-noto-cjk + Node ≥20 + `patchright install chromium`), **verify** (`POST /api/studio/projects/{id}/render` + on-disk artifact check), **re-tune** (`SAU_STUDIO_RENDER_TIMEOUT` / `SAU_STUDIO_NODE_PATH` / `overlay_opacity` slider), and **troubleshooting** (missing CJK → blank boxes, missing chromium → MP4 never lands, missing Node → 500). Mirrors the structural convention of `monitor-cdp-throttling-cron-ops.md` + `public-inbox-ops.md` so an on-call operator landing at repo root reaches it in 1 click.

**Round-Video-Backgrounds-v1** rewired the renderer pipeline end-to-end: the route now spawns the same Node bridge, but SceneCard plays **real downloaded Pexels Video clips via `<OffthreadVideo>`** and **synthesized Edge-TTS voiceovers via `<Audio>`** instead of mounting a static Pexels photo. The MoviePy / Hyperframes legacy render paths and the `SAU_STUDIO_RENDERER` env switch were deleted along with them.

## Why this exists

`web_runner/routes/studio.py::_render_via_remotion` is the sole renderer. For every `POST /api/studio/projects/{id}/render` call it:

1. Resolves per-scene assets in parallel â€” `_resolve_scene_videos` downloads a portrait MP4 from Pexels Videos (`media/studio/<id>/media/scene_<idx>.mp4`); `_resolve_scene_voiceovers` synthesizes a per-scene MP3 via `edge-tts` (`media/studio/<id>/media/scene_<idx>.mp3`); `_resolve_scene_backgrounds` keeps the pre-existing Pexels-image fallback for scenes where the video fetch came up empty.
2. Spawns `node sau_web/frontend/remotion_studio/render.mjs` with a JSON manifest on stdin. The bridge spins up headless Chromium via `@remotion/renderer`, bundles the React composition server-side, fetches the per-scene MP4 + MP3 over HTTP, and emits the final MP4 + .srt + .ass sidecars in `media/studio/<id>/`.

The render succeeds only when the deploy image provides:

1. **Node.js ≥ 20** on `$PATH` (Remotion 4 requirement; verified by the bridge's `render.mjs::execFileSync(node, ['--version'])` preflight).
2. **Full Chromium** (`patchright install chromium` — NOT `chromium-headless-shell`; Remotion's `@remotion/renderer` needs media codecs the headless-shell variant strips).
3. **At least one CJK font package** so `<SceneCard>` titles render as glyphs instead of `.notdef` tofu boxes.
4. **`sau_web/frontend/node_modules/` populated** with `remotion` + `@remotion/bundler` + `@remotion/renderer` peer-deps so `render.mjs`'s `import { bundle } from '@remotion/bundler'` resolves.
5. **`edge-tts` CLI on PATH** (`pip install edge-tts` via the `web` extras group) for per-scene voiceover. When missing, the renderer silently degrades to silent MP4s (still valid).

This runbook covers:

1. **Deploy** — minimal Dockerfile patch adding the missing CJK + Node + Chromium pieces.
2. **Verify** — curl the render endpoint; assert MP4 + .srt + .ass sidecars are non-empty (and that ffprobe reports an active video stream + audio stream from `renderMedia`, not a static-image frame).
3. **Re-tune** — `SAU_STUDIO_RENDER_TIMEOUT` (render deadline), `SAU_STUDIO_NODE_PATH` (asdf/volta/nvm-managed Node), the per-project `overlay_opacity` slider.
4. **Troubleshooting** — the seven common failure modes with their remediation.

It does **not** cover `studio_assets.kind='background'` image-onboarding (Pexels key, etc. — see `docs/ai-material-search.md`) or the canvas-whiteboard preview path (see `docs/studio-whiteboard-spec.md`). Both are preconditions for `_render_via_remotion` to succeed end-to-end on a non-trivial project.

## Prereqs

- The host has the project's `web_runner/` mounted; Flask backend listens on `:6001`.
- `.venv/` populated: `uv pip install -e ".[dev]"` (the `dev` extra pulls `watchdog` for the dev-watch script) from repo root.
- `sau_web/frontend/node_modules/` populated: `cd sau_web/frontend && npm ci` (or `pnpm install`) so `render.mjs`'s ESM imports resolve.
- PostgreSQL reachable via `DATABASE_URL`; the renderer reads `studio_projects` + `studio_episodes` rows for the JSON bridge payload.
- Optional: `PEXELS_API_KEY=...` — without it, every scene's `_resolve_scene_backgrounds` returns `None` and the render falls through to the cold-canvas gradient fallback. Still produces an MP4, just without `<Image>` backgrounds.

## The current Dockerfile — what's missing

The root `Dockerfile` (≈25 lines, Python 3.10 base; pre-Remotion):

```dockerfile
FROM python:3.10.19

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

RUN apt-get update && apt-get install -y --no-install-recommends libnss3 libnspr4 libdbus-1-3 \
    libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libxkbcommon0 libasound2 && rm -rf /var/lib/apt/lists/*

# ── Remotion requires FULL Chromium (not headless-shell) + Node ≥20 + CJK fonts;
#    the existing apt block covers Chromium's lib- deps, but the three items above
#    are NOT installed by the current Dockerfile. See docs/dev/studio-renderer-ops.md
#    §"Deploy" for the minimal patch.
RUN playwright install chromium-headless-shell

COPY requirements.txt requirements.txt
RUN pip install -r requirements.txt
COPY . .
RUN cp conf.example.py conf.py

EXPOSE 6001
CMD ["python", "run.py"]
```

**The four things this image is missing for `SAU_STUDIO_RENDERER=remotion`:**

| Missing piece | Visible failure when absent | Where to add (in the fragment below) |
|---|---|---|
| `fonts-noto-cjk` (or `fonts-wqy-microhei` / `fonts-source-han-sans`) | Chinese titles/bodies render as `.notdef` tofu boxes | `RUN apt-get install -y fonts-noto-cjk` |
| Node.js ≥ 20 | `_render_via_remotion` raises `RuntimeError: node 未安装或不在 PATH`. Bridge preflight surfaces "node … is too old". | nodesource `/setup_20.x` block (current image has no Node at all) |
| `patchright install chromium` (full, not headless-shell) | Bridge preflight passes, but `renderMedia()` raises `Codec 'h264' not supported by headless-shell` (or chromium simply aborts on media init). | Replace the existing `playwright install chromium-headless-shell` with `RUN patchright install chromium`. ⚠ Do NOT add a separate `RUN pip install patchright==1.58.2` — it's already pinned in both `requirements.txt` AND `pyproject.toml [project.dependencies]`, and adding it is an orphan install call that `pip` silently no-ops while doubling the pin's maintenance surface — drift between the two pins hits silently when only one is bumped. |
| `sau_web/frontend/node_modules/` with `@remotion/bundler` etc. | Bridge raises `Cannot find module '@remotion/bundler'` from Node's ESM loader | `RUN cd /app/sau_web/frontend && npm ci` (after the new `package*.json` COPY) |

The patch below adds all four stages to the current single-stage Dockerfile. Operators on a multi-stage build (cleaner separation of npm + python deps in the final image) can pin the build stage to `node:20-bookworm` and copy `node_modules/` into the runtime stage — see §"Multi-stage alternative" below.

## Deploy — minimal Dockerfile patch

Single-stage fragment that can be **inserted directly** after the existing `RUN apt-get install -y ...` block and **replace** the existing `RUN playwright install chromium-headless-shell` line:

```dockerfile
FROM python:3.10.19

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

# ── Existing apt block: libnss3 / libgbm / libxkbcommon (UNCHANGED) ──
# These system libraries are still required for Chromium at runtime; do not
# remove them. Remotion / patchright-python don't change the C-level deps.

# ── NEW (Remotion): CJK fonts so SceneCard text renders as glyphs ────
# Pick ONE of {fonts-noto-cjk, fonts-wqy-microhei, fonts-source-han-sans}
# (or all three for the broadest fallback chain). fonts-noto-cjk is the
# largest (~50 MB compressed) but covers the most scripts; install it if
# image size is acceptable.
RUN apt-get update && apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# ── NEW (Remotion): Node.js ≥20 from NodeSource ─────────────────────
# Remotion 4 + its Vite/Webpack pipeline require Node ≥20. The
# render.mjs bridge enforces this via `npx tsc -b`-equivalent preflight
# (execFileSync('node', ['--version'])); a node v18 binary fails the
# preflight BEFORE bundle() can fail with an opaque loader error.
# nodesource's `nodejs` deb has `npm` under Recommends (not Depends), so
# `--no-install-recommends nodejs` alone would skip npm and break the
# subsequent `npm ci --omit=dev` line below. Install npm explicitly to
# keep the image slim (Option 1 in the review).
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/* \
    && node --version && npm --version   # smoke: confirm v20+ + npm on PATH

# ── NEW (Remotion): patchright replaces playwright, install FULL Chromium ──
# patchright is a hardened Playwright fork (per CLAUDE.md + pyproject.toml
# + requirements.txt — both list `patchright==1.58.2`, so the legacy
# `RUN pip install -r requirements.txt` step elsewhere in `Dockerfile` already pulls it).
# We don't install it again here; doing so is an orphan install call that
# pip silently no-ops while doubling the pin's maintenance surface —
# drift between the two pins hits silently when only one is bumped.
# Use `chromium` (NOT chromium-headless-shell) — Remotion's renderMedia
# needs the codecs the headless-shell variant strips. Skip-system-deps
# is unnecessary because the existing apt block already provides libnss3 etc.
RUN patchright install chromium

# ── NEW (Remotion): frontend deps so render.mjs's ESM imports resolve ──
# COPY package.json + package-lock.json first so this layer's cache
# invalidates only on a real frontend-deps change, not on every commit.
COPY sau_web/frontend/package.json sau_web/frontend/package-lock.json /app/sau_web/frontend/
RUN cd /app/sau_web/frontend && npm ci --omit=dev     # slim prod; rebuild frontend separately
# Production variant: ALSO build the Vite app + serve via the existing
# sau_web/start.sh. Dev variant: keep `--omit=dev` off and use Vite's
# dev server via `npm run dev` (see CLAUDE.md §Building and Running).

# ── Existing: requirements.txt + COPY . . + cp conf.example.py (UNCHANGED) ──
COPY requirements.txt requirements.txt
RUN pip install -r requirements.txt
COPY . .
RUN cp conf.example.py conf.py

# ── NEW: env defaults for the renderer (override at compose/k8s time) ──
ENV SAU_STUDIO_RENDER_TIMEOUT=600   # seconds; the Python spawn subprocess timeout
# ENV SAU_STUDIO_NODE_PATH=           # uncomment + set if asdf/nvm-managed Node

EXPOSE 6001
CMD ["python", "run.py"]
```

For multi-stage builds (recommended when final image size matters), pin the build stage to `node:20-bookworm` and copy the resulting `node_modules/` into the Python runtime stage:

```dockerfile
# ── Build stage (size-isolated npm install + Vite build) ────────────
FROM node:20-bookworm AS frontend-build
WORKDIR /build
COPY sau_web/frontend/package*.json ./
RUN npm ci
COPY sau_web/frontend/ ./
RUN npm run build

# ── Runtime stage (Python + Chromium + CJK, no Node.js needed at runtime ─
# render.mjs is invoked per-request via subprocess.run, so node only needs
# to be REACHABLE on the runtime PATH — it does not need to ship in the
# runtime image).
FROM python:3.10.19 AS runtime
# (identical apt + CJK + lib block as single-stage)
COPY --from=frontend-build /build/node_modules /app/sau_web/frontend/node_modules
COPY --from=frontend-build /build/dist        /app/sau_web/frontend/dist
# (rest unchanged)
```

> **Why we don't bundle Node into the runtime image**: the renderer's subprocess spawn (`subprocess.run([node_bin, bridge, '--out', out_path])`) calls a Node binary on `$PATH` (or via `SAU_STUDIO_NODE_PATH`). Cloud-native deploys usually pin the Node version via a separate base image (e.g. `python:3.10.19` for the runtime, `node:20` for the build) and copy the artifacts; pinning both into one image inflates it with `node_modules/` + Chromium lib-deps that the Python process never imports. The runtime MUST always keep Node ≥20 on `$PATH` — there is no Python-only fallback (round-Video-Backgrounds-v1 removed it).

### Env var reference (renderer-flavored subset of `.env.example` §2)

| Variable | Default | Purpose |
|---|---|---|
| `SAU_STUDIO_RENDER_TIMEOUT` | `600` (10 min) | Wall-clock deadline for the Flask → Node subprocess. Exceeding raises `RuntimeError(渲染超时 (>Ns))`; the Flask route surfaces 500. Round-Video-Backgrounds-v1 wall-clock budget is dominated by the Pexels Videos + Edge-TTS fan-out (3×3 + 2 concurrent for a 7-scene storyboard); a ~60 s project typically finishes in ~45 s, comfortably under the default. |
| `SAU_STUDIO_NODE_PATH` | (unset) | Override the spawn executable. Useful for asdf/volta/nvm-managed Node binaries that aren't on default `$PATH`. Read by `web_runner/routes/studio.py::_render_via_remotion` AND by `sau_web/frontend/remotion_studio/render.mjs`'s Node ≥20 preflight. |
| `SAU_STUDIO_TTS_VOICE` | `zh-CN-XiaoxiaoNeural` | Edge-TTS voice id. Microsoft Edge exposes ~20 zh voices (Xiaoxiao / Yunyang / Yunjian / ...). Bump to `en-US-AriaNeural` for English-only projects; the renderer doesn't auto-detect language yet (planned future round). |
| `SAU_STUDIO_CANVAS_MAX_SIZE` | `10485760` (10 MiB) | UTF-8 byte cap for the tldraw `canvas_data` JSON. Documented in `.env.example` §10; raise to 50 MiB for complex canvas projects. |
| `SAU_SYNOPSIS_MAX_LEN` | `2000` chars | Per-project `synopsis` field length cap on POST + PATCH `/api/studio/projects` (bumped from 500 → 2000 in round-OPT-T2-follow-up; Chinese multi-paragraph storyboards routinely blow past the original 500). Mirrors `_STUDIO_CANVAS_MAX_SIZE`'s env-override pattern. Read at module-import time by `web_runner/routes/studio.py::_SYNOPSIS_MAX_LEN`. See §"Body size limits" below. |
| `overlay_opacity` (per-project) | `0.5` (column default) | `studio_projects.overlay_opacity` (Phase 2 ALTER); controls the linear-gradient alpha on `<SceneCard>` so the bg photo is still visible behind the text. |

### Round-Video-Backgrounds-v1 only renderer (no env switch)

Round-Video-Backgrounds-v1 deleted the trio of legacy render paths (`moviepy` stub via `web_runner/studio_render.py`, the `_render_via_hyperframes` Node bridge wrapper, and the `SAU_STUDIO_RENDERER` env-gated dispatcher). Only `_render_via_remotion` remains: a single render-mode call, no fallback path, no `if _RENDERER == ...` switch at module load.

The pure-ESM Node bridge (`render.mjs`) was chosen for two reasons that historically motivated the Remotion migration off `hyperframes`:

1. **No `npx ok ?` interactive prompt.** A cold cache used to hang the subprocess waiting for confirmation; a non-interactive server shell timed out at 600 s with no stderr to triage from. `remotion`'s direct `node` spawn eliminates the npx intermediary.
2. **Full Chromium control.** `patchright install chromium` (the `pyproject.toml` pin) replaces the upstream's bundled-browser story; operators bump Chromium for security fixes in concert with patching the image.

Round-Video-Backgrounds-v1 extended the same line: real Pexels Videos via `<OffthreadVideo>` replaced the static-image path, and synthesized Edge-TTS voiceover via `<Audio>` was added so the rendered MP4 ships both video and audio streams (verified by `ffprobe` after deploy). When the operator needs to debug a render failure, the path is **always** through `_render_via_remotion`'s render.mjs subprocess — there is no longer a "flip the env, ship a MoviePy fallback" escape hatch. If Remotion's Chromium / Node / CJK / node_modules chain is misconfigured, the project root-cause fix is §"Troubleshooting" §"Deploy", not an env-flip.

## Verify — the render endpoint smoke

> The smallest set of curl calls that prove end-to-end success.

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload

# 0. Pick a project with at least one episode + (optionally) studio_assets.
#    First project id via the authed /api routes:
PROJECT_ID=$(curl -b /tmp/sau-cookies.txt http://localhost:6001/api/studio/projects \
    | jq -r '.data[0].id')

# 1. Trigger a render (~5-30 s for a short project; up to 600 s default timeout):
curl -X POST -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/studio/projects/${PROJECT_ID}/render \
    | jq '.data | {url, duration, width, height}'

# 2. Expected response (the only renderer now — Remotion):
# {
#   "url": "/api/studio/render/<id>/render.mp4",
#   "captions_ass": "/api/studio/render/<id>/captions.ass",
#   "captions_srt": "/api/studio/render/<id>/captions.srt",
#   "duration": 12.4,
#   "width": 1080,
#   "height": 1920
# }

# 3. Verify the on-disk artifacts:
ls -lh media/studio/${PROJECT_ID}/
# Expected:
#   render.mp4           (h264, 1080×1920, ~5 MB for a 12-s render)
#   captions.srt         (SubRip text — one block per SceneCard)
#   captions.ass         (SSA/ASS layered — used by video players)
```

### What each step proves

| Step | Proves | Failure mode points to |
|---|---|---|
| `200 OK` on `/render` | Flask route + auth + DB SELECT | `401` → auth issue (re-login); `404` → project id wrong; `500` → bridge failed |
| `url` field present | `_render_via_remotion` subprocess succeeded + JSON manifest parsed | `500` with `unknown error` → `render.mjs` stderr |
| `width: 1080 / height: 1920` | Composition viewport correct in `Root.tsx` | wrong dimensions → viewport fix in `StudioProject.tsx` |
| `render.mp4` non-empty on disk | `bundle()` + `renderMedia()` finished (Chromium didn't crash mid-render) | empty file → check `render.mjs` stderr for the Chromium abort reason |
| `captions.srt` / `captions.ass` non-empty | The Node bridge's subtitle helpers ran end-to-end (rate-matched to `scenes.length`) | missing → bridge aborted before reaching the post-render `writeFileSync(captions.*)` |
| `duration` field ≈ `ffprobe render.mp4` | Manifest + actual MP4 length consistent (drift >0.5s → `composition.fps` reconciliation bug) | drift → review `_render_via_remotion::finalDurationSec` math |

### Cross-component smoke (browser, optional)

For a visual sanity check (operator uses `playwright` / browser-use):

1. Navigate to `http://localhost:5180/dashboard/studio`, log in, create a project with 1-3 episodes.
2. Click "Render" → wait for the `/api/studio/projects/{id}/render` POST to return.
3. Inspect the in-page `<video>` element — the MP4 plays inline, subtitles render from `.srt`.

This adds manual-render coverage to the curl step above; not strictly required for an on-call health probe.

## Idempotent re-deploy

> The renderer is stateless on the production side: the only env-gated behavior is `SAU_STUDIO_RENDER_TIMEOUT` / `SAU_STUDIO_NODE_PATH` / `SAU_STUDIO_TTS_VOICE`, none of which switch render mode. Re-deploying the same image (or re-applying the same compose override) is intrinsically idempotent — there is no per-deploy counter, db row, or crontab entry.

If a previous deploy was partial (e.g. the `RUN patchright install chromium` step succeeded but the `RUN npm ci` step failed):

```bash
# 1. Identify the partial step. The image's CMD will still start, but
#    /api/studio/projects/{id}/render will return 500 with a
#    "Cannot find module '@remotion/bundler'" or "chromium: …" message.
docker logs -n 100 sau-backend   # check the truncated module-load error

# 2. The fix is a fresh image build (apt + npm caches are transparent
#    across runs, so re-running `docker build` finishes from where the
#    LAST existing layer left off):
docker build -t sau-backend:latest .
docker compose up -d backend      # Compose v2 instant reload

# 3. Re-run §"Verify" above to confirm the rebuild landed cleanly.
```

> **TOCTOU caveat**: `docker compose up -d` and `kubectl rollout restart` are atomic at the orchestrator level — no `flock` needed. For systemd, prefer a `systemctl restart sau-backend.service` after touching env in `/etc/systemd/system/sau-backend.service.d/`.

## Rollback

There is **no env-flip rollback path** — round-Video-Backgrounds-v1 deleted `web_runner/studio_render.py` (the MoviePy pill), `_render_via_hyperframes` (the legacy Node bridge wrapper), and the `SAU_STUDIO_RENDERER` env-gated dispatcher. When the renderer misfires the recovery is **always** through `_render_via_remotion`'s render.mjs subprocess. The usual on-call ladder is:

1. **Verify the failure is actually remotion's** — `tail -50 .sau-logs/backend.log | grep -E '\[studio\] (remotion render failed|render crash)'`. A `渲染失败: <message>` line means render.mjs exited non-zero; the `<message>` is render.mjs's stderr summary (typically a Chromium / Node / Webpack loader error).
2. **Cross-reference §"Troubleshooting"** — the table at the end of this doc has the 12 common failure modes with their remediation. A `Codec 'h264' not supported by headless-shell` means §"Deploy" wasn't fully applied; a `Cannot find module '@remotion/bundler'` means the slim-render npm layer dropped devDependencies; etc. **All** of these resolve via image rebuild + deliberate patch, not env-flip.
3. **If the failure is upstream** (Pexels Videos returns 429 / edge-tts 503 / network timeout), the per-scene helpers `_resolve_scene_videos` and `_resolve_scene_voiceovers` already silent-degrade (video → image → cold canvas, voiceover → silent scene). Verify by `ffprobe media/studio/<id>/render.mp4 | grep -E 'Video|Audio'` — an active `Video: h264` + `Audio: aac` pair confirms the upstream paths succeeded; a missing `Audio:` line means edge-tts was unavailable at render time. The fix there is `pip install edge-tts` or wait for the Pexels / Microsoft service to recover.
4. **If all else fails** — the on-call handbook's escalation policy applies (page the backend maintainer). The image rebuild is **the** fallback; there is no shorter path.

## Threshold-tune workflow

| Knob | Where the default lives | Tunable? | Why |
|---|---|---|---|
| `SAU_STUDIO_RENDER_TIMEOUT` | `web_runner/routes/studio.py::_STUDIO_RENDER_TIMEOUT` env read | **Yes** — raise for long projects | Render subprocess deadline. Multi-episode projects (≥60 s) need ≥900 s. The Round-Video-Backgrounds-v1 budget is dominated by the Pexels Videos + Edge-TTS fan-out (3 + 2 concurrent for a 7-scene storyboard) so a deliberate bump improves the 99th-percentile tail latency more than the median. |
| `SAU_STUDIO_NODE_PATH` | `web_runner/routes/studio.py::_render_via_remotion::node_bin` | **Yes** — point at asdf/volta/nvm | Headless server shells may have Node on a non-default `$PATH`. |
| `SAU_STUDIO_TTS_VOICE` | `web_runner/studio_tts.py::_DEFAULT_VOICE` env read | **Yes** — pick per-locale | Default `zh-CN-XiaoxiaoNeural`. Bump to `en-US-AriaNeural` or `ja-JP-NanamiNeural` per content locale; the route doesn't auto-detect yet. |
| `SAU_STUDIO_CANVAS_MAX_SIZE` | `web_runner/routes/studio.py::_STUDIO_CANVAS_MAX_SIZE` | **Yes** — raise for big whiteboards | DEFAULT 10 MiB; raise to 50 MiB for a complex tldraw project that refuses to save. |
| `overlay_opacity` (per project) | `studio_projects.overlay_opacity` (Phase 2 column) | **Yes** — UI slider when StudioDetailPage ships | DEFAULT 0.5; 0 = no overlay (use only for dark photos), 1 = full black (use for bright photos). |
| Remotion Node version floor | `render.mjs::execFileSync(node, ['--version'])` preflight | **No** — any value < 20 fails the preflight (exit 5) | Hard floor. Operators upgrading Node should re-run the full regen. |

### Re-tune procedure

```bash
# 1. Set the new value in .env / Compose override / k8s ConfigMap:
#    e.g. raise the timeout for a multi-episode project:
SAU_STUDIO_RENDER_TIMEOUT=900

# 2. Restart the backend (no rebuild):
systemctl restart sau-backend   # or: docker compose up -d backend

# 3. Re-run §"Verify" above. The duration field should now match what
#    `ffprobe render.mp4` reports for the longer render.

# 4. To monitor as a future metric, scan .sau-logs/ for "渲染超时":
grep -r "渲染超时" .sau-logs/*.log | tail -20
# Per-week zero hits = healthy. Multiple hits/week = re-tune upward.
```

### Body size limits

The renderer's input surface has **two length caps** — one on the per-project `studio_projects.synopsis` field (round-OPT-T2-follow-up), one on the per-project `studio_projects.canvas_data` JSON. Both bounds exist because unlimited inputs quietly degrade the render pipeline in opposite ways:

| Cap | Default | Where the cost shows up when exceeded | Knob |
|---|---|---|---|
| `SAU_SYNOPSIS_MAX_LEN` | `2000` chars | `_resolve_scene_voiceovers` breaks the synopsis into one `edge-tts` call per scene line; multi-paragraph storyboards (>500 chars of Chinese with 4-6 scene splits) push total TTS wall-clock from ~10 s → ~30+ s, eating into `_STUDIO_RENDER_TIMEOUT`. Pre-bump (500 char) limit was conservative; post-bump (2000 char) accommodates multi-paragraph storyboards while staying under a 1-min render budget. | `SAU_SYNOPSIS_MAX_LEN` env (re-tuned at module-import time; restart required) |
| `SAU_STUDIO_CANVAS_MAX_SIZE` | `10485760` (10 MiB) | `/api/studio/projects/{id}/canvas` PATCH bytes-on-the-wire. The HTTP/1.1 413 boundary trips at proxy border (nginx `client_max_body_size`, ALB request-body limit per layer). For complex tldraw projects (~500 shapes) the JSON serialises to ~5 MiB, so the default 10 MiB ceiling has headroom for ~1000-shape whiteboards. | Same env name; raise to 50 MiB for complex canvas projects |

**Re-tune recipe** (mirrors §"Re-tune procedure"):

```bash
# 1. Decide whether the upstream project field is genuinely too long or
#    whether the synopses should be split into `studio_episodes` rows
#    (the studio's canonical "many paragraphs → many episodes" path —
#    see `openspec/changes/script-studio/specs/script-engine/spec.md`
#    §studio_episodes for the granularity spec).
# 2. If keeping a single project row, bump the env:
SAU_SYNOPSIS_MAX_LEN=5000    # next-business-day scale: 5K chars ≈ 2.5 段
# 3. Restart the backend (no rebuild):
systemctl restart sau-backend   # or: docker compose up -d backend
# 4. Re-test against the PATCH route with a body matching the new limit:
curl -X PATCH -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/studio/projects/${PROJECT_ID} \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json; print(json.dumps({"synopsis": "A"*5000}))')"
# 5. The 400-then-pass cycle proves the new cap took:
#    - First call (no env reload) → 400 "synopsis 长度不能超过 2000 个字符"
#    - After restart                → 200, project.synopsis = 5000 chars
```

> **The "double cap is intentional" note**: bumping `SAU_SYNOPSIS_MAX_LEN` doesn't relax `SAU_STUDIO_CANVAS_MAX_SIZE` — they're stacked-on-purpose, OF-arms-of-field-length, NOT interchangeable. If a project's oversize is in the **body** (canvas) rather than the **synopsis**, raising the canvas cap is the correct knob.

### Per-project `overlay_opacity` slider (when the StudioDetailPage UI lands)

The Phase-2 column exists today (`web_runner/db.py::_init_db_postgres.alteration_statements` + `_serialize_project.overlay_opacity`). The StudioDetailPage UI for adjusting it is Phase-3 work. Until then, set `overlay_opacity` directly via the admin endpoint or a one-off SQL update:

```bash
# Set overlay_opacity=0.85 on a specific project (fake-bright photo → strong overlay):
PGPASSWORD=$DB_PASS psql "$DATABASE_URL" -c \
    "UPDATE studio_projects SET overlay_opacity = 0.85, updated_at = NOW() WHERE id = 42"
# Re-render to pick up the change:
curl -X POST -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/studio/projects/42/render
```

The slider's default is 0.5 per the SQL `DEFAULT 0.5` on the column; values outside `[0, 1]` are clamped server-side in `_render_via_remotion` so a misconfigured row can't produce a `.notdef`-level visual failure.

## Manual dry-run emission (preview what the next request will produce)

For a visual smoke without running through the full HTTP loop:

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload

# 1. Pick / stage a fixture project:
PROJECT_ID=$(curl -b /tmp/sau-cookies.txt http://localhost:6001/api/studio/projects \
    | jq -r '.data[] | select(.title | contains("测试")) | .id' | head -1)
# If you don't have one, create it via POST /api/studio/projects (see docs/web-shell.md).

# 2. Fire the render endpoint and watch the stderr stream (request log
#    + render.mjs stderr summary land interleaved in .sau-logs/backend.log):
SAU_STUDIO_VERBOSE=1 curl -X POST -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/studio/projects/${PROJECT_ID}/render 2>&1 | tail -30
# Look for:
#   - "[studio-render] early-log totalDuration=…; post-calculateMetadata=…"
#     → confirms the Node bridge's calculateMetadata ran
#   - "渲染失败: …" or "ERROR: …" → render.mjs stderr summary
#   - the route's 200 vs 500 response

# 3. Compare against the MoviePy fallback (only useful for parity QA):
SAU_STUDIO_RENDERER=moviepy curl -X POST -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/studio/projects/${PROJECT_ID}/render | jq '.data.duration'
# Now back to remotion:
SAU_STUDIO_RENDERER=remotion curl -X POST -b /tmp/sau-cookies.txt \
    http://localhost:6001/api/studio/projects/${PROJECT_ID}/render | jq '.data.duration'
# If the two `duration` values match within 0.5 s, the renderer is
# parity-equivalent for that project.
```

## Monitoring the renderer

The Remotion renderer doesn't emit a cron-style JSON verdict. Instead, two signals to monitor:

```bash
# 1. Per-request render logs (in the backend stdout/stderr).
#    Format: one line per render with exit code + stderr summary.
grep -E '\[studio\] (remotion render failed|render crash|studio project|project created|project updated|render finished)' \
    .sau-logs/backend.log | tail -30
# A "渲染超时" line = exit-1 timeout (raise SAU_STUDIO_RENDER_TIMEOUT).
# A "渲染失败: <message>" line = exit-N render failure (Chromium crash, etc.).

# 2. The rendered artifacts on disk (size-sort reveal truncated files):
ls -lhS media/studio/*/render.mp4 | head -20
# A render that dropped to <10 KB was likely truncated mid-bundle or mid-encode.
# Investigate the .sau-logs/backend.log immediately preceding the truncation.

# 3. Optional structured alerting on 500s from `/api/studio/projects/{id}/render`:
#    - Reverse proxy / LB alert on "≥3 500s in 5min" — equivalent to a
#      STOP-SHIP for the TBF-018 cron, but per-request instead of hourly.
#    - Promote to a pager once a quarter to see if it ever fires.
```

For **per-project observability**: the rendered MP4's container plays alongside the FFmpeg metadata, which surfaces the actual encoder + crf in `ffprobe -v error -show_format media/studio/<id>/render.mp4`. Drift from `x264Preset: 'ultrafast', crf: 22` in `render.mjs` means a future Remotion bump changed defaults — sanity-check the rendered output.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Render returns 500 with `RuntimeError: 找不到 Remotion 桥接脚本: …/render.mjs` (exit-1-class error) | `sau_web/frontend/remotion_studio/render.mjs` not in the deployed artifact | Verify the image COPY covers `sau_web/frontend/`; restore from `openspec/changes/studio-remotion-renderer` if missing |
| Render returns 500 with `RuntimeError: node 未安装或不在 PATH (尝试调用 <bin>): <exc>` | `node ≥ 20` not installed in the image OR not on `$PATH` | Add the `RUN curl -fsSL https://deb.nodesource.com/setup_20.x` block; restart the container |
| Render returns 500 with `node … is too old; Remotion 4 requires v20+` from `render.mjs` preflight | Image ships Node v18 (Remotion requires ≥20) | Bump Node to ≥20 (NodeSource `/setup_20.x`) OR set `SAU_STUDIO_NODE_PATH` to a v22 binary |
| Render returns 500 with `composition 'StudioProject' not found in bundle` | `Root.tsx`'s `<Composition id="StudioProject">` was not picked up by `bundle()` | Verify `sau_web/frontend/remotion_studio/index.ts` calls `registerRoot(Root)`; check `index.ts` is on the COPY'd path |
| Render returns 500 with `chromium: error while loading shared libraries: libnss3.so` (or similar) | Existing apt block missing `libnss3` / `libgbm` / `libxkbcommon` | Re-run the existing apt block; if the platform image no longer ships it, see §"C-level audit" below |
| Render returns 500 with `Codec 'h264' not supported by headless-shell` (exit-class error from renderMedia) | The image installed `playwright install chromium-headless-shell` (the smaller binary) | Replace with `RUN patchright install chromium` (NOT `chromium-headless-shell`) |
| Render returns MP4 but Chinese titles render as `.notdef` tofu boxes | `fonts-noto-cjk` (or alternate CJK font) NOT installed | `apt-get install -y fonts-noto-cjk` + rebuild; verify via `fc-list :lang=zh-cn` in the running container |
| Render hangs ≥600 s and times out with `RuntimeError(渲染超时 (>Ns))` | Default timeout too low for a multi-episode project | Raise `SAU_STUDIO_RENDER_TIMEOUT` (env var) to 900-1800 s for long projects; restart container |
| Render returns MP4 but `.srt`/`.ass` sidecars missing | The `render.mjs` `try { … } writeFileSync(captions.*)` block aborted mid-bridge (typically Chromium crash or OOM) | Look at the route's stderr for `ERROR: <chromium error>`; restart container to clear orphaned Chromium processes |
| Render returns MP4 with the wrong aspect ratio (e.g. 1920×1080) | `Composition width/height` drift between Python `_render_via_remotion` `manifest.width=1080` AND the React `<Composition width={…} height={…}>` in `Root.tsx` | Pin in `Root.tsx::const StudioProject: React.FC = () => <Composition id="StudioProject" width={1080} height={1920} … />`; also pin the `<Series>` viewport in `StudioProject.tsx` |
| Render returns 500 with `Cannot find module '@remotion/bundler'` from Node's ESM loader | `sau_web/frontend/node_modules/` not populated in the runtime image **OR** the slim-render `--omit=dev` flag dropped `@remotion/bundler` because it sits in `devDependencies` of `package.json` (see the **peer-dep skipping row below**). These two failure modes look identical on the surface. | Run `npm ci` (drop `--omit=dev`) at build time so devDependencies are installed. **Preferred long-term** — move `@remotion/bundler` + `@remotion/renderer` to `dependencies` in `package.json` so `npm ci --omit=dev` (the slim-render flag) keeps them, matching the lockfile's intent; see the **peer-dep skipping row below** for the full cleanup recipe. Rebuild image. |
| `POST /api/studio/projects/{id}/render` returns the same MP4 byte-for-byte across two calls (cache never re-runs) | Frozen `media/studio/<id>/render.mp4` from a previous successful render — `os.makedirs(_os.path.dirname(out_path), exist_ok=True)` doesn't truncate | `rm -f media/studio/<id>/render.mp4` then re-call; or check `SUA_STUDIO_FORCE_REGEN` if a future env var lands (out of scope for Phase 1) |
| Render returns 500 with `Cannot find module '@remotion/bundler' / '@remotion/renderer' / 'react'` (or any other peer) from `render.mjs`'s ESM loader — even though `node_modules/` exists and `remotion` itself was installed | `npm ci --omit=dev` (the slim-render flag the Dockerfile uses) skipped `devDependencies`, but `@remotion/bundler` + `@remotion/renderer` are imported by `render.mjs` at render time and **currently live in `sau_web/frontend/package.json`'s `devDependencies`** (with `react`/`react-dom`/`remotion` themselves correctly in `dependencies`). The slim flag dropped exactly the modules the bridge needs. | **Preferred (root-cause fix)** — in `sau_web/frontend/package.json`, move `@remotion/bundler`, `@remotion/renderer` (+ any other `@remotion/*` import that runs at render time, e.g. `@remotion/cli`, `@remotion/transitions`) from `devDependencies` → `dependencies`. They are runtime deps of the bridge, not dev tools; `--omit=dev` will then keep them. Rebuild image + verify via §"Verify". **Alternative (image-bloat trade)** — drop `--omit=dev` from the Dockerfile's `npm ci` line; expect ~600 MB extra in `node_modules/` from the full Remotion transitive deps that aren't needed for prod renders but were held in dev-only by historical convention. **Caveat** — do NOT chase this with a follow-up `npm install <pkg>` after the fact; that landing would diverge from the lockfile and silently regress reproducibility. |
| Render returns 500 with `跨权限级复制失败 (cross-UID copy to /app/media/studio/<id>: [Errno 13] ...)` from `web_runner/routes/studio.py::_render_via_remotion`'s post-render `shutil.copy2` block — bridge ran clean (wrote to tempdir, not the final path), but the dst-mount write raised EACCES | This is the residual edge case **after** the Step 5 fix. The bridge now writes the 3 artifacts to `tempfile.TemporaryDirectory(prefix="sau_render_")` (always user-owned, never traverses the cross-UID mount), then `shutil.copy2` lands them on the user-supplied final path. The pre-Step-5 "bridge writeFileSync EACCES" mode is **gone**. The post-Step-5 `跨权限级复制失败` symptom means the **dst** mount is owned by a UID the Flask process physically cannot write to; the cause is now strictly the dst mount, not the bridge-side race. | **(a) Resolved in code (Step 5) ✅** — write MP4 + .srt + .ass to `tempfile.TemporaryDirectory(prefix="sau_render_")` first (always user-owned, never crosses mount boundaries during the writeFileSync; uses `copy2` to preserve mtime/ctime/atime from the bridge's render time so ffprobe cache invalidation works), then `shutil.copy2` to the final path. `TemporaryDirectory` cleanup fires on both success and raise paths via Python's weakref-finalizer pattern. Cross-UID mount-fs is obsolete across Compose / systemd / k8s in one shot for the bridge-side write; the residual `跨权限级复制失败` only fires when the dst mount is fundamentally not writable by Flask. **(b) Fallback for the residual dst-mount case** (only needed if Step 5 still surfaces `跨权限级复制失败` after deploy): (**i**) k8s ConfigMap/SecurityContext match — set `securityContext.fsGroup: <runAsUser>` on the deployment so the FSGroup owns the mount after pod start, **or** pre-create the dir with `chown <uid>:<gid>` in an initContainer before the Flask pod starts. (**ii**) Dockerfile `chown` at build time — add `RUN chown -R <uid>:<gid> /app/sau_web /app/media && USER <uid>:<gid>` before the bridge spawn so the non-root user owns the writable paths at build time and the runtime is consistent. **Diagnostic** — `docker exec -it <container> id; ls -ldn /app/media /app/media/studio; ls -ldn /app/media/studio/<id> 2>/dev/null; stat /app/media/studio/<id>/render.mp4 2>/dev/null` triangulates UID mismatch vs stale read-only file (the last probe catches the case where parent dir is fine but a prior pod left a `0444 render.mp4`). **Trade-off note** — Step 5 doubles the disk I/O per render (tmpdir write + final copy); /tmp on Linux is usually tmpfs (RAM-backed) so the cost is mostly to memory. If render latency budget is tight (>95% of `_STUDIO_RENDER_TIMEOUT`), the doubled I/O may force a `SAU_STUDIO_RENDER_TIMEOUT` bump from 600 s to 720 s or so. |
| After a future `@remotion/*` bump (e.g. Remotion 5 → `≥ 22.11+`), the route starts surfacing `ERROR: node vX.Y.Z is too old; Remotion N requires vM+. Upgrade Node or set SAU_STUDIO_NODE_PATH.` from `render.mjs` preflight (**exit code 5**) | `@remotion/bundler`'s Vite/Webpack pipeline raised its Node floor; the bridge's preflight (hard-coded `if (major < 20) process.exit(5)` at `render.mjs:117-122`) is the **designed-in loud surface** that trips BEFORE `bundle()` can fail with an opaque Webpack loader error. Grep-discoverable: `grep '"exit code 5"' .sau-logs/backend.log` should be zero in steady state; any single hit post-bump is the Node-floor migration prompt. The preflight also honours `SAU_STUDIO_NODE_PATH` so asdf / volta / nvm-managed Node binaries can override the system one (per `render.mjs:114`), which is the cheap path before a full image rebuild. | (1) Bump Dockerfile NodeSource pin from `setup_20.x` to the new floor — `setup_22.x` or `setup_24.x` as appropriate; the nodesource release file pins the major so no explicit `nodejs=<version>` apt-pin needed (don't add one — it just conflicts with the release file). (2) Bump `render.mjs`'s **two** hard-coded references in **lockstep** — `major < 20` → `major < NEW_FLOOR` AND the error string `"Remotion 4 requires v20+"` → `"Remotion N requires vM+"`. Both must update together: the threshold is the bridge preflight's hard-coded `if (major < 20)` check (independent of `@remotion/bundler`'s declared `engines.node` field — that surface isn't what fires the loud-fail, npm only warns on engines.node mismatches without `--engine-strict`), the error string is what §"Troubleshooting" rows + raw log greps see; drift between them silently hides future bumps (operators grep for "Remotion 4" and miss the new failure mode). (3) Re-run §"Verify" against an existing project, then `ffprobe media/studio/<id>/render.mp4` against a pre-bump render for parity — `composition.durationInFrames` drift >0.5 s indicates a fps reconciliation bug from the upgrade that needs separate triage. (4) Pin the new floor in `openspec/changes/studio-remotion-renderer/{tasks,design}.md` §Remotion-Version-Policy (create if absent) so future operators map Remotion→Node clean. **Never bypass** the `exit-5` loud surface with a `try { bundle(...) } catch (ignore)` — it exists exactly so this regression mode is loud rather than opaque. |

| `<Audio>` renders silent (`ffprobe` reports `render.mp4` with no `Audio:` stream, OR `Audio: aac` with `nb_frames=0`); `GET /api/studio/tts/health` returns `available:false` with `reason: "未安装 edge-tts CLI"` | `edge-tts` CLI not on `$PATH` from the Flask process — `subprocess.run(["edge-tts", ...])` inside `web_runner/studio_tts.py::synthesize_voiceover` raises `FileNotFoundError` so `_resolve_scene_voiceovers` silent-degrades to `[None]*N` (MP4 still valid, just no voiceover) | Run via `bash sau_web/start.sh` instead of bare `python run.py`: the launcher prepends `$ROOT/.venv/bin` to `$PATH` before `exec`ing the backend, so `shutil.which("edge-tts")` finds `.venv/bin/edge-tts`. Belt-and-suspenders: `run.py` also has an idempotent in-process PATH injector (`_inject_venv_bin_to_path`) for operators who skip the launcher. Verify post-restart with `curl -sS localhost:6001/api/studio/tts/health` — `available:true` means the binary is discoverable, then re-render the project to push fresh MP3s into `media/studio/<id>/media/scene_<idx>.mp3` and emit a real audio stream. (Edge case: if a stale `studio_assets.kind='voiceover'` cache row outlived a manually-deleted MP3, see the cache-staleness row below first.) |

### C-level dep audit (when "libnss3 / libgbm" surface in the chromium abort)

The existing apt block in the root `Dockerfile` (libnss3, libnspr4, libdbus-1-3, libatk1.0-0, libatk-bridge2.0-0, libatspi2.0-0, libxcomposite1, libxdamage1, libxfixes3, libxrandr2, libgbm1, libxkbcommon0, libasound2) covers the **current** Chromium minima. When Chromium bumps and adds a new system lib, the failure appears in the route's stderr as `error while loading shared libraries: libfoo.so`. To recover:

```bash
# 1. Reproduce in a debug shell to see the missing lib:
docker run --rm -it --entrypoint=/bin/bash sau-backend:latest
$ ldd /opt/playwright/chromium-<ver>/chrome-linux/chrome | grep "not found"
# → libxss.so.1 not found, for example

# 2. Add the missing lib to the Dockerfile apt block + rebuild:
#    RUN apt-get install -y --no-install-recommends libxss1 ...

# 3. Re-run §"Verify" — the render should now succeed.
```

For **air-gapped deploys** without apt access: pre-bake `fonts-noto-cjk` + the system-lib set into an off-line tarball, COPY'd into the image during build, then unpacked at runtime via `dpkg -i /opt/offline-libs/*.deb`.

## Cross-references

- `web_runner/routes/studio.py::_render_via_remotion` — the Flask route that spawns `node <bridge>`; source of truth for `SAU_STUDIO_RENDERER` env reading and the stdin JSON shape.
- `sau_web/frontend/remotion_studio/render.mjs` — the Node ESM bridge; reads stdin JSON, runs `bundle()` + `selectComposition()` + `renderMedia()`, writes MP4 + .srt + .ass sidecars, emits single-line JSON manifest on stdout.
- `sau_web/frontend/remotion_studio/Root.tsx` — the React `<Composition id="StudioProject">`; `calculateStudioMetadata` derives `durationInFrames` from `inputProps.scenes` so the manifest's `duration` matches the rendered MP4.
- `sau_web/frontend/remotion_studio/components/SceneCard.tsx` — single storyboard card; the `<Image>` background (Phase 2 Pexels-via-cache) + linear-gradient overlay using `overlayOpacity`.
- `sau_web/frontend/remotion_studio/components/StudioProject.tsx` — `<Series>` of `<SceneCard>` per scene; the 9:16 viewport + cross-fade transitions.
- `sau_web/frontend/remotion_studio/utils/pacing.ts` — FPS=30 / CHARS_PER_SEC=14 / MIN_SCENE_SEC=3 / MAX_SCENE_SEC=8 / FADE_SEC=0.4 constants. The single source of pacing truth shared by both `web_runner/routes/studio.py::_render_via_remotion`'s manifest `durationInFrames` and `Root.tsx::calculateStudioMetadata`'s computed `durationInFrames`.
- `openspec/changes/studio-remotion-renderer/{proposal,design,tasks,specs}.md` — the change doc that ships Phase 1 (Remotion renderer) + Phase 2 (Pexels-via-cache backgrounds).
- `openspec/changes/studio-remotion-renderer/tasks.md` §5.4 — the operator-runbook task this doc fulfils.
- `Dockerfile` — the root build file; §"Deploy" above is the minimal patch the operator should apply.
- `pyproject.toml` — `patchright==1.58.2` pin in `[project.dependencies]` (canonical source of truth per CLAUDE.md §"Install dependencies" `uv pip install -e .[dev]` path; `requirements.txt` line 15 is the legacy mirror used by the root `Dockerfile`, per requirements.txt's own header comment). The `RUN patchright install chromium` line in the §Deploy patch deliberately does NOT include a standalone `RUN pip install patchright==1.58.2` — the existing `RUN pip install -r requirements.txt` already pulls it; running both would be an orphan install call that pip silently no-ops while doubling the pin's maintenance surface — version drift hits silently when only one is bumped.
- `tests/test_studio_remotion_render.py` — 14 pytest tests covering bridge path, subprocess contract, env override, Phase-2 cache + dedupe + overlay (no real Chromium required to run).
- `docs/dev/cache-staleness-demo.md` — Scenario A (preserve cache row, delete media) + Scenario B (preserve media, delete cache row) reproducer, plus a 3-round CI flake-detector for the disk-existence guard in `_resolve_scene_videos` / `_resolve_scene_voiceovers`. Complements §Troubleshooting row "Render returns the same MP4 byte-for-byte across two calls".
- `docs/web-shell.md` — Web Shell Studio surface (auth + project list + render button); the operator-facing counterpart to this runbook's technical surface.
- `docs/studio-whiteboard-spec.md` — the canvas-large-file contract (§ canvas byte limit); cross-references `SAU_STUDIO_CANVAS_MAX_SIZE`.
- `docs/ai-material-search.md` — Phase 2 Pexels API key onboarding if `PEXELS_API_KEY` is unset (renders fall through to cold-canvas; not a renderer failure, just no backgrounds).
- `docs/dev/monitor-cdp-throttling-cron-ops.md` — sibling runbook for the TBF-018 hourly cron (per-hour SLA, not per-request).
- `docs/dev/public-inbox-ops.md` — sibling runbook for the public-inbox-monetization daily kill-criteria cron (next-business-day SLA, different cadence).
- **Hub**: [docs/dev/INDEX.md#operators](docs/dev/INDEX.md#operators) — Operators (on-call, system ops).
