# AI Video Generation Backend (DRAFT) — Requirements

## Source-of-truth table

| Source-of-truth line                                       | Owner of the line                                       |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| Catalog of video-generation vendors (Kling primary etc.)   | `docs/dev/studio-ai-video-ops.md` + env-var list        |
| Per-project preferred_backend choice                       | `studio_projects.render_config.preferred_backend` (rides the JSONB column added in `studio-visual-presets`) |
| Async job state + retry policy                             | `web_runner/studio_backends/kling.py::KlingAPIClient`   |
| Per-tier quota (KlingSeconds / ZhipuSeconds)               | `web_runner/middleware/usage_metering.py` (extends existing) |

## ADDED Requirements

### Requirement: dispatch renders through StudioRenderBackend

`_render_via_remotion`'s body SHALL dispatch through a
`StudioRenderBackend::render` impl picked from
`project.render_config.preferred_backend`.

#### Scenario: default to Remotion

- **GIVEN** `studio_projects.render_config = null`
- **WHEN** operator triggers a render
- **THEN** the dispatch SHALL route to `RemotionBackend` (the
  pre-existing local-render pipeline)
- **AND** the resulting MP4 SHALL be byte-equivalent to today's
  Remotion render for the same preset

#### Scenario: route to Kling

- **GIVEN** `studio_projects.render_config = {"preset": "noir",
  "preferred_backend": "kling", "version": 1}`
- **AND** `KLING_API_KEY` is configured
- (Where `"kling"` is the PR-DRAFT's primary vendor.)
- **WHEN** operator triggers a render
- **THEN** the dispatch SHALL route to `KlingBackend`
- **AND** the StudioDetailPage SHALL show an async progress bar
  spanning the typical 5-min Kling render window

#### Scenario: Kling outage fall-back

- **GIVEN** `studio_projects.render_config.preferred_backend =
  "kling"`
- **WHEN** Kling's API returns 5xx for the full retry budget
- **THEN** the dispatch SHALL re-route to `RemotionBackend` with
  the same preset
- **AND** the response SHALL still be 200 OK with a warning
  notice in the `data.warnings` field

#### Scenario: vendor missing key fall-back

- **GIVEN** `studio_projects.render_config.preferred_backend =
  "kling"`
- **AND** `KLING_API_KEY` is unset
- **WHEN** operator triggers a render
- **THEN** the dispatch SHALL silently fall back to
  `RemotionBackend`
- **AND** the operator SHALL see a toast: "Kling API key 缺失,
  本地渲染兜底"

### Requirement: per-vendor quota enforcement

`web_runner/middleware/usage_metering.py` SHALL enforce
per-vendor monthly quotas on free-tier users. Pro/Studio tiers
are exempt.

#### Scenario: free-tier Kling quota exhaustion

- **GIVEN** `users.license_tier = 'free'`
- **AND** the user has already consumed 9 of 10 monthly Kling
  render seconds
- **WHEN** operator triggers a Kling render
- **THEN** the request SHALL proceed for the first render
- **AND** if the completion would push total > 10, the request
  SHALL fall back to `RemotionBackend` silently
- **AND** the response `data.warnings` SHALL mention quota
  exhaustion

#### Scenario: pro tier unlimited

- **GIVEN** `users.license_tier IN ('pro', 'studio')`
- **WHEN** operator triggers a Kling render
- **THEN** the dispatch SHALL proceed without quota checks

### Requirement: picker exposes vendor backend

`StudioDetailPage.tsx` SHALL render a second dropdown beside the
Visual Style Preset picker with vendor options.

#### Scenario: dropdown shows three backends

- **WHEN** the picker loads
- **THEN** the dropdown SHALL show three options:
  `Remotion (本地 · 几秒)`,
  `Kling 可灵 (生成式 · 约 5 分钟)`,
  `Zhipu GLM-Video (国内合规备选)`
- **AND** the default SHALL be `Remotion (本地 · 几秒)` for
  legacy rows

#### Scenario: pick persists to render_config

- **WHEN** operator selects `Kling 可灵`
- **THEN** a PATCH SHALL land
  `{"render_config": {"preset": "<existing>", "preferred_backend":
  "kling", "version": 1}}`
- **AND** the next render SHALL route via KlingBackend

### Requirement: per-project render audit query

`GET /api/admin/audit/render-backend?days=N` SHALL return the
count of renders per backend per day for ops-side reporting.

#### Scenario: GIN index supports the audit query

- **GIVEN** `_init_db_postgres` has run
- **THEN** PG SHALL have an `idx_gin_render_config` GIN index
  on `studio_projects.render_config`
- **AND** the audit query planner SHALL use the index
- **AND** the query SHALL return within 200 ms on 100k-row
  production-size tables

## MODIFIED Requirements

- **`requirement: catalog entries are TS-only`** (from
  `studio-visual-presets/specs/visual-presets/spec.md`):
  EXTENDED to allow `preferred_backend` as a sibling key in
  the same JSONB dict. The TS catalog remains the source of
  truth for `preset`; the backend dispatch key is owned by
  `_validate_render_config` on the Python side.

- **`requirement: PATCH validates shape`** (from the same):
  EXTENDED to optionally validate
  `preferred_backend: 'remotion'|'kling'|'zhipu'|null` against
  a whitelist. Unknown values rejected with a 400.

## REMOVED Requirements

None.

## DEPENDENCIES

- `studio-visual-presets` — provides the JSONB column this PR
  rides on. Land visual-presets FIRST.
- `ai-api-keys-founder` — provides the `ai_api_keys` table this
  PR stores Kling/Zhipu keys in. Already shipped.
- `usage-metering` — provides the per-tier free/paid quota
  enforcement. Already shipped.
