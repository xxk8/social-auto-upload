# Tasks — studio-visual-presets

Implementation tasks in delivery order. Each task is a taggable unit
that maps 1:1 to a single PR's commit history.

## 1. Schema (idempotent migration)

- [x] Add idempotent PG JSONB column
  `studio_projects.render_config` via
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Default `NULL`.
- [x] Test re-run against staging DB shows no-op on already-migrated
  schema (column already present).
- [x] Verify legacy rows (pre-PR-A) read back as `render_config: None`
  on the project-detail API.

## 2. Backend — serialization + PATCH validation

- [x] Extend `_serialize_project` to include `render_config` field
  (verbatim, decoded by psycopg's `dict_row` row_factory).
- [x] Extend `_validate_update_payload` to accept the new key
  with shape rule (dict-or-null) +
  sub-rule (`preset` string 1..64 chars).
- [x] Add `_validate_render_config` helper for the shape rule;
  bubble its error message to the route as a 400 with Chinese
  detail.
- [x] Empty-string normalises the same as `None` (clear-column
  intent), mirrors the `style` field's policy.

## 3. Backend — payload injection

- [x] Extend `_render_via_remotion` to inject the full
  `render_config` dict into
  `payload.project.render_config` for the bridge.

## 4. Remotion bridge — inputProps wiring

- [x] Update `render.mjs` so the `inputProps.project` literal
  includes `renderConfig: project.render_config ?? null`.
- [x] Update `types.ts` so `StudioProjectShape.renderConfig?` is
  typed as
  `{ preset?: string; version?: number; [k: string]: unknown } | null`.
- [x] Add `Root.tsx::resolveRenderPresetId` helper exporting the
  same resolution chain as `studio_ts::presets::getPresetById` so
  a vitest can pin the resolve path without re-mounting the full
  Remotion composition.

## 5. Frontend — catalog

- [x] Add `sau_web/frontend/remotion_studio/presets.ts`
  exporting `VisualPalette`, `VisualTypography`, `VisualMotion`,
  `MotionCurve`, `VisualPreset`, plus the literal
  `PRESETS: ReadonlyArray<VisualPreset>` (4 entries: Classic,
  Noir, Vibrant, Minimalist) and `getPresetById(id)` +
  `applyMotionCurve(t, curve)`.
- [x] Schema matches option D2: `{ preset, version: 1, ... }` with
  the catalog version pinned to `1` for forward-compat reader
  hooks.
- [x] `getPresetById` returns `PRESETS[0]` (Classic) on
  null/undefined/unknown id; never throws.

## 6. Frontend — SceneCard wiring

- [x] `<SceneCard>` accepts optional `presetId?: string | null` prop.
- [x] Resolve via `getPresetById(presetId)` internally; default to
  `PRESETS[0]` (Classic) when undefined (preserves pre-PR-A byte-
  equivalence).
- [x] Replace the 6 hard-coded hex literals with `preset.palette.*`
  destructuring + fallback to current tokens when no preset.
- [x] Replace the CJK font stack with `preset.typography.fontStack`.
- [x] Replace `fontWeight: 700` / `fontSize: 72` / `fontSize: 48`
  with `preset.typography.{titleWeight, titleSize, bodySize}`.
- [x] Apply `motion.fadeFrames` as override for the parent
  `fadeFrames` value when non-null; otherwise pass-through.
- [x] Apply `motion.curve` via `applyMotionCurve` after the linear
  fade-in×fade-out curve is clamped to [0, 1] (so `bounce` can't
  overshoot past the safe alpha range).

## 7. Frontend — StudioProject + Root pass-through

- [x] `<StudioProject>` reads `project.renderConfig?.preset`,
  resolves to `presetId`, passes to each `<SceneCard>`.
- [x] Diagnostic "no scenes" early-return path retains the existing
  pre-PR-A fallback tokens (untouched on this PR).

## 8. Frontend — picker UI

- [x] `StudioDetailPage.tsx` PresetPicker dropdown beside the
  "渲染成片" button. Native `<select>` with Tailwind class
  matching the existing button height/colour scheme.
- [x] Optimistic UI (`optimisticPresetId` state) keeps the picker
  locked to the new value during the PATCH round-trip.
- [x] "Unknown preset" badge surfaces drift between server-stored
  id and the TS catalog (only renders when the row's stored id
  is non-null + non-empty + not in the catalog).
- [x] Reuse the existing `updateMutation::useMutation` from the
  title/synopsis/style editing flow — the PATCH payload already
  accepts the new key.

## 9. Tests

- [x] `tests/test_studio_presets.py` (new) — 16 contract tests
  across:
  1. Serialization exposes `render_config` verbatim + via None fallback.
  2. PATCH validation accepts dict/null/empty-string/
     known-id/unknown-id; rejects non-dict / nested-dict-with-
     datetime / wrong-typed preset / oversize preset id.
  3. PATCH path writes the new field through alongside the
     existing `title`/`style` keys; empty-string normalises to
     null; bad shape surfaces a Chinese error.
  4. Render payload injection carries the JSONB dict
     verbatim; legacy null is preserved; future per-renderer
     keys ride through.
  5. Catalog sanity-list pins the known id set against the TS
     catalog — silent drift guard.
- [x] Existing `tests/test_studio_remotion_render.py` continues
  to pass without modification (legacy fixtures without
  `render_config` are tolerated; bridge receives `None` from
  `_render_via_remotion` payload and resolves to Classic at
  render time).
- [ ] Optional: vitest for `<SceneCard>` covering the
  `getPresetById('noir')` → palette override path. Puntable to
  follow-up PR.

## 10. Runbook

- [ ] (optional) Extend `docs/dev/studio-renderer-ops.md`
  Troubleshooting row 14 with the picker drift scenario (unknown
  preset id stored verbatim + bridge falls back to Classic).
  Puntable to a follow-up docs PR.

## 11. Companion openspec (separate PR)

- [x] Draft `openspec/changes/studio-ai-video-renderer/`
  proposal.md + tasks.md + spec.md for the PR-B that's the
  companion of this work. **No code in this PR** — just the
  openspec scaffold so the design conversation can run in
  parallel.
