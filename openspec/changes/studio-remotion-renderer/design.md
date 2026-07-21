# Studio Render Backend — Remotion — Design

## Folder layout

```text
sau_web/frontend/remotion_studio/
├── index.ts                   # registerRoot() entrypoint — Remotion bundles via this
├── Root.tsx                   # declares <Composition id="StudioProject" /> + calculateMetadata
├── types.ts                   # StudioProjectShape / StudioEpisodeShape / StudioSceneCard / StudioRenderInputProps
├── components/
│   ├── StudioProject.tsx      # <AbsoluteFill><Series><Series.Sequence/><…/></Series>
│   └── SceneCard.tsx          # single visible card (indigo accent bar, title, divider, body)
├── utils/
│   ├── pacing.ts              # FPS, CHARS_PER_SEC=14, MIN/MAX_SCENE_SEC=3/8, FADE_SEC=0.4 + helpers
│   └── pacing.test.ts         # vitest pinning pacing math to Python `_scene_duration`
└── render.mjs                 # Node ESM bridge: stdin JSON → bundle → renderMedia → stdout JSON

web_runner/routes/studio.py    # NEW: `_render_via_remotion(project, episodes, out, id)` mirroring `_render_via_hyperframes`
tests/test_studio_remotion_render.py  # pytest mocking subprocess.run
.env.example / CLAUDE.md       # documented `SAU_STUDIO_RENDERER=remotion` + `SAU_STUDIO_RENDER_TIMEOUT=600`
```

## Bridge contract (stdin / stdout)

```
stdin  : {"project":{"id":…, "title":…, "synopsis":…, "style":…},
          "episodes":[{"episode_no":…, "title":…, "scenes":[…], "dialogues":[…]}, …]}
stdout : {"success": true,  "duration": 12.4, "width": 1080, "height": 1920}
stderr : multi-line ERROR + stack on failure
```

Identical contract to `hyperframes/render.js` so the same `_render_via_*` Python helper signatures hold and `SAU_STUDIO_RENDERER` flip is a one-liner on the operator side.

### Exit codes
- `1` — missing `--out`
- `2` — stdin JSON parse failure
- `3` — composition `StudioProject` missing from bundle (configuration drift)
- `4` — `renderMedia` failed (caught and re-thrown to the caller)
- `0` — success

## Render pipeline (Node)

1. Parse `--out <path>`.
2. Read all of stdin → UTF-8 → `JSON.parse`.
3. Run `buildScenes()` mirroring the Python `_build_scenes()` (episodes → scenes+dialogues join; fallback to synopsis lines; fallback to `(暂无内容)` card).
4. Compute `totalFrames = sum(sceneDurationFrames(body))` (matches Python `_scene_duration`.
5. Build `inputProps = { project, scenes }`.
6. `await bundle({ entryPoint: <abs path to index.ts> })` → `bundleLocation`.
7. `await getCompositions(bundleLocation)` → find `id === "StudioProject"`.
8. `await renderMedia({ composition, serveUrl: bundleLocation, outputLocation: out, inputProps, codec: 'h264', crf: 22, x264Preset: 'ultrafast', pixelFormat: 'yuv420p', timeoutInMilliseconds: 300000, verbose: false, chromiumOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] } })`.
9. Write `captions.srt` + `captions.ass` next to the MP4 (pure text from the same per-scene duration math).
10. Print `{"success": true, "duration": <number>, "width": 1080, "height": 1920}` to stdout; `process.exit(0)`.

## Composition tree

```tsx
<AbsoluteFill style={{ background: '#12121A' }}>
  <Series>
    {scenes.map((scene, i) => (
      <Series.Sequence
        key={i}
        durationInFrames={sceneDurationFrames(scene.body)}
        name={scene.title || `scene-${i + 1}`}
      >
        <SceneCard
          scene={scene}
          index={i + 1}
          total={scenes.length}
          sceneFrames={sceneDurationFrames(scene.body)}
          fadeFrames={fadeFrames}
        />
      </Series.Sequence>
    ))}
  </Series>
</AbsoluteFill>
```

`calculateMetadata({ props })` reads `props.scenes` and returns `durationInFrames: totalFrames(props.scenes)`. `selectComposition()` (called from `renderMedia` internally) honours this so the final clip length matches the actual script.

## Visual language parity with MoviePy

| Token | MoviePy | Remotion StudioProject (`SceneCard.tsx`) |
| --- | --- | --- |
| Background | `#12121A` | `#12121A` |
| Card gradient | (flat) | `linear-gradient(160deg, #1e1e2a 0%, #12121A 100%)` |
| Accent bar | 14-pixel indigo (`#6366f1`) left | 14-pixel indigo (`#6366f1`) left |
| Episode index | `f"{idx} / {total}"` | `{i + 1} / {total}` |
| Title | 72 px white | 72 px white |
| Divider | 3 px `#2e2e36` | 3 px `#2e2e36` |
| Body | 48 px grey | 48 px grey |
| Font | CJK-capable system font via `_resolve_font` | First PingFang SC / Microsoft YaHei / Noto Sans CJK SC fallback (system font stack) |

## Operator-facing matrix

```bash
# Default
SAU_STUDIO_RENDERER="remotion"      # New — React composition, Node ESM bridge
SAU_STUDIO_RENDERER="hyperframes"   # Legacy — only if a non-upgraded operator pinned the old env
SAU_STUDIO_RENDERER="moviepy"       # Pure Python fallback for minimal environments

SAU_STUDIO_RENDER_TIMEOUT=600       # Worker subprocess timeout in seconds (default 600).
SAU_STUDIO_NODE_PATH=""             # Override node binary path for asdf / nvm setups.
```

## OpenRouter roadmap (Phase 2 — out of scope for this PR)

1. Flask pre-step: for each scene lacking a `ref_image_url`, call `/api/v1/images` with the scene prompt; cache in `studio_assets`.
2. Inject `backgroundUrls` into `inputProps` passed on stdin to `render.mjs`.
3. `<SceneCard>` reads `backgroundUrl[i]` and renders `<Img>` (Remotion's static image component) under the text — composes via z-index instead of replacing layout.
4. Async follow-up: `/api/v1/videos` (Seedance 2 / Veo 3 / Wan 2.7) per scene at MP4 level; replaces `<Img>` with a short `<Video>` clip stitched by Remotion's `<OffthreadVideo>`.
