# Visual Style Presets for the Studio Renderer

## Why

Operators ship the same storyboard through the Studio renderer and
end up with 6 hard-coded colour tokens + 1 generic fade. The visual
quality plateaus — every project looks like every other project.
Without dropping in a real generative video API (separate concern,
separate PR), there's still room for a 10× visual lift by
parameterising the existing local-render pipeline into a small
set of curated "looks".

This change ships **3 named visual style presets** selectable from a
dropdown beside the "渲染成片" button on `/dashboard/studio/{id}`. A
**fourth "Classic" preset** is the implicit default — every existing
project pre-dating this PR renders with the unchanged token set, so
the migration is zero-regression for untouched projects.

## What changes

* **Backend** (Python/PG):
  * `studio_projects.render_config` JSONB column added via
    ALTER … ADD COLUMN IF NOT EXISTS (idempotent re-run); nullable
    so legacy rows keep their `None` default.
  * `_serialize_project` exposes `render_config` verbatim on every
    GET (legacy rows have `render_config: None`).
  * `_validate_update_payload` accepts a `render_config` key on
    PATCH — must be a dict or null; `preset` sub-key (string, 1..64
    chars) follows a soft-length-bound. **No whitelist** — unknown
    ids persist verbatim so the TS catalog can rename without
    orphaning rows.
  * `_render_via_remotion` injects the full
    `project.render_config = {...}` JSONB dict into the JSON
    payload that the Node bridge consumes.

* **Remotion** (TS bridge):
  * `render.mjs`'s `inputProps.project.renderConfig` carries the
    full JSONB dict through to the React composition.
  * `presets.ts` is the single source of truth for the catalog:
    4 entries (Classic / Noir / Vibrant / Minimalist), with
    `getPresetById(id)` returning `PRESETS[0]` (Classic) on null
    / undefined / unknown so a renamed catalog never breaks
    renders.
  * `SceneCard.tsx` accepts a `presetId` prop when present and
    renders palette/typography/motion from the resolved
    `VisualPreset`; defaults to the existing hard-coded tokens
    when no id is supplied.
  * `Root.tsx` + `StudioProject.tsx` plumb
    `project.renderConfig?.preset` through to `<SceneCard>`.

* **Frontend page**:
  * `StudioDetailPage.tsx` adds a PresetPicker dropdown beside
    the "渲染成片" button. Changes auto-PATCH
    `/api/studio/projects/{id}` with
    `{ render_config: { preset: <id>, version: 1 } }`.
  * Optimistic UI keeps the picker steady while the PATCH
    round-trips (~100 ms) — the existing
    `updateMutation` already invalidates the project query on
    success.

* **Tests**:
  * `tests/test_studio_presets.py` — contract tests for
    serialization, PATCH validation (8 cases), payload injection
    (3 cases), and the catalog id sanity-list.
  * Existing `tests/test_studio_remotion_render.py` fixtures
    without `render_config` still pass (legacy NULL → fallback to
    Classic at the bridge).

* **OpenSpec**:
  * Single change folder
    `openspec/changes/studio-visual-presets/` (this folder).

## Why now

* The current renderer is local-only (no external dependency), so
  shipping presets doesn't introduce new infra risk. Net PR adds
  ~250 LOC with no external API, no rate limiting, no async
  pipeline.
* The real AI video API integration (Kling / Sora / Veo) is a
  separate, non-blocking PR (companion openspec draft
  `studio-ai-video-renderer/` in this same change set).
  Shipped alongside but separately arquived so the two scopes
  merge cleanly when each lands.
* Tone & motion are independent of any vendor — operators can
  start picking "Noir" today and switch to "Kling" tomorrow
  without conflicting projects.

## Trade-offs

* **TS-only catalog (option A1)** — Python is a pure
  pass-through for `preset` ids. Trade-off: a renamed catalog
  silently orphans old rows; the picker surfaces this with a
  "Unknown preset — falling back to Classic" badge. Drift is
  caught on the operator's first paint, not at PATCH time.
* **Backend-permissive validation (option B3)** — any string id is
  accepted up to 64 chars. Trade-off: the bridge is the source of
  truth on validity; the picker has to surface drift.
* **Schema is `{preset, version: 1}` (option D2)** — explicit
  schema version gives a forward-compat hook when v2 lands with
  per-renderer extras (custom font URL, motion override, vendor
  opaques). Trade-off: one extra byte of overhead per row.
* **Motion (option C2: just `fadeFrames` + `motionCurve`)** —
  minimal SceneCard change. Trade-off: `bounce` is a slight
  overshoot, not a full cubic-bezier zoo; `Vibrant` doesn't get a
  `<Series.Sequence>` zoom. Punt to a follow-up PR if it
  matters.

## Outcomes

* Operators see a 4-way picker. Picking a preset changes the next
  render's visuals in one click (no project reload, no server
  restart).
* Untouched projects continue to render identically (Classic is
  the resolver fallback).
* The schema forward-compat hook (`version: 1`) keeps the next
  feature (per-renderer opaques) from needing a second JSONB
  migration.

## Out of scope

* Real AI video generation (Kling / Sora / Veo). See the
  companion `openspec/changes/studio-ai-video-renderer/`
  proposal.
* Per-project vendor selection. See the same companion.
* API key / quota management. Same.
