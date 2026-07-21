# Visual Style Presets — Requirements

## Source-of-truth table

| Source-of-truth line                                              | Owner of the line                                   |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| Catalog entries (3 presets + Classic fallback)                    | `sau_web/frontend/remotion_studio/presets.ts` (TypeScript) |
| PATCH validation (shape rule, length cap on `preset`)             | `web_runner/routes/studio.py::_validate_render_config` (Python) |
| Bridge payload inclusion (full JSONB through to Node)             | `web_runner/routes/studio.py::_render_via_remotion` |
| DB column (`studio_projects.render_config` JSONB)                 | `web_runner/db.py::_init_db_postgres` (PG-only ALTER) |

**No mirror registry**: Python is a pure pass-through for the
catalog id string. Drift between TS catalog and PATCH payloads is
caught by the bridge (`getPresetById` resolves unknown ids to
Classic).

## ADDED Requirements

### Requirement: catalog entries are TS-only

The Studio renderer SHALL consume Visual Style Presets from a
single-source-of-truth TypeScript catalog at
`sau_web/frontend/remotion_studio/presets.ts`. The catalog SHALL
ship at least four entries: `classic` (default; byte-equivalent to
pre-PR-A render), `noir` (cinematic dark), `vibrant`
(high-saturation motion), `minimalist` (light/monochrome).

#### Scenario: ship 4 presets on day one

- **WHEN** the operator opens the picker dropdown on
  `/dashboard/studio/{id}`
- **THEN** the dropdown SHALL display four labelled options
- **AND** the default selection SHALL be `classic` (matching the
  pre-PR-A tokens)

#### Scenario: catalogue renames are tolerant

- **WHEN** the operator renames `noir` → `noir-deep` in
  `presets.ts`
- **THEN** previously-persisted rows with `render_config.preset =
  "noir"` SHALL continue to render (falling back to `classic`)
- **AND** the picker SHALL surface a "未识别 · 回退到 Classic" hint
  on those rows so the operator notices the drift
- **AND** the picker SHALL NOT offer the renamed id as an option
  until the catalog update lands in the user's deployed bundle

### Requirement: PATCH validates shape

A PATCH to `/api/studio/projects/{id}` body `render_config` field SHALL
accept `null`, an empty string, a dict (optionally with a `preset`
sub-string of 1..64 chars), or be rejected with a 400-status Chinese
error message.

#### Scenario: clear column with null

- **GIVEN** `studio_projects.id = 1` with
  `render_config = '{"preset":"noir",...}'`
- **WHEN** operator PATCHes with body
  `{"render_config": null}`
- **THEN** the response SHALL be 200 OK
- **AND** the persisted column SHALL be `NULL`
- **AND** subsequent GET SHALL return `render_config: null`

#### Scenario: clear column with empty string

- **WHEN** operator PATCHes with body `{"render_config": ""}`
- **THEN** the response SHALL be 200 OK
- **AND** the persisted column SHALL be `NULL`
  (normalisation policy mirrors `style`)

#### Scenario: pick a known preset

- **WHEN** operator PATCHes with body
  `{"render_config": {"preset": "vibrant", "version": 1}}`
- **THEN** the response SHALL be 200 OK
- **AND** GET SHALL return
  `render_config: {"preset": "vibrant", "version": 1}`
- **AND** the next render SHALL consume the vibrant palette

#### Scenario: pick an unknown future preset id

- **WHEN** operator PATCHes with body
  `{"render_config": {"preset": "noir-deep", "version": 1}}`
- (Where `noir-deep` is NOT in the current TS catalog.)
- **THEN** the response SHALL be 200 OK
- **AND** GET SHALL return the same value verbatim
- **AND** the next render SHALL NOT 500 — `<SceneCard>` falls back
  to `classic` palette silently

#### Scenario: reject non-dict shape

- **WHEN** operator PATCHes with
  `{"render_config": 42}` or `{"render_config": ["noir"]}` or
  `{"render_config": "noir"}` (string)
- **THEN** the response SHALL be 400
- **AND** the response body's `message` SHALL include the
  Chinese substring `"render_config 必须是"`

#### Scenario: reject non-serialisable dict

- **WHEN** operator PATCHes with
  `{"render_config": {"preset": "noir", "created": "<datetime>"}}`
- (Where Python's `json.dumps` cannot serialise.)
- **THEN** the response SHALL be 400
- **AND** the response body's `message` SHALL include the
  Chinese substring `"无法序列化"` or `"JSON"`

#### Scenario: reject oversize preset id

- **WHEN** operator PATCHes with
  `{"render_config": {"preset": "<65 chars>"}}`
- **THEN** the response SHALL be 400
- **AND** the response body's `message` SHALL mention the 64-char
  cap

#### Scenario: reject explicit-null preset

- **WHEN** operator PATCHes with
  `{"render_config": {"preset": null, "version": 1}}`
  (i.e. the dict is well-formed but the `preset` sub-key is
  explicitly null)
- **THEN** the response SHALL be 400
- **AND** the response body's `message` SHALL include the
  Chinese substring `"render_config.preset 必须是字符串"`
- **AND** the operator is directed to clear the column via
  `{render_config: null}` instead

#### Scenario: reject explicit-empty-string preset

- **WHEN** operator PATCHes with
  `{"render_config": {"preset": "", "version": 1}}`
- **THEN** the response SHALL be 400
- **AND** the response body's `message` SHALL advise the
  operator to clear the column via `{render_config: null}`
  (mentions either `"不能为空字符串"` or `"null"` substring, so
  the picker-UI flow stays unambiguous vs the API-level flow)

### Requirement: render payload includes render_config

`_render_via_remotion` SHALL inject the full
`project.render_config` JSONB dict into
`payload.project.render_config` for the Node bridge.

#### Scenario: legacy null passes through

- **GIVEN** `studio_projects.id = 1` with `render_config = NULL`
- **WHEN** operator triggers a render
- **THEN** the bridge's stdin payload SHALL include
  `"render_config": null`
- **AND** `<SceneCard>` SHALL resolve via `getPresetById(null)`
  → Classic → pre-PR-A visual

#### Scenario: persisted preset travels through

- **GIVEN** `studio_projects.id = 1` with
  `render_config = '{"preset":"vibrant","version":1}'`
- **WHEN** operator triggers a render
- **THEN** the bridge's stdin payload SHALL include
  `"render_config": {"preset":"vibrant","version":1}`
- **AND** `<StudioProject>` SHALL pass `presetId="vibrant"` to each
  `<SceneCard>`
- **AND** `<SceneCard>` SHALL render with the vibrant palette
  (`#f43f5e` accent, `800` title weight, `bounce` curve)

### Requirement: picker UI beside render button

`/dashboard/studio/{id}` SHALL render a Visual Style Preset picker
dropdown inline beside the existing "渲染成片" button.

#### Scenario: dropdown is visible by default

- **WHEN** the page finishes loading the project record
- **THEN** the picker SHALL be visible (not hidden behind an
  expander)
- **AND** the picker's current value SHALL be
  `project.render_config?.preset ?? "classic"`

#### Scenario: pick optimistically updates UI

- **WHEN** operator selects `vibrant` from the dropdown
- **THEN** the picker SHALL display "活力流行" immediately
  (optimistic update)
- **AND** `<Button>` SHALL be disabled
  (`updateMutation.isPending`)
- **AND** a "保存中…" status hint SHALL appear

#### Scenario: pick survives a render

- **WHEN** operator picks `noir`, the PATCH completes 200, and
  operator triggers a render
- **THEN** the resulting MP4 SHALL have noir palette tokens
- **AND** on a subsequent page reload, the picker SHALL still show
  `noir`

#### Scenario: drift surfaces a hint

- **WHEN** the page loads a project whose `render_config.preset`
  is non-empty but NOT in the TS catalog
- **THEN** the picker SHALL fall back to displaying `classic`
- **AND** a "未识别 · 回退到 Classic" status hint SHALL appear
  with the original unknown id in the `title` tooltip

### Requirement: bridge fallback unknown ids to classic

`presets.ts::getPresetById` SHALL return `PRESETS[0]` (Classic)
when the id argument is `null` / `undefined` / empty / not in
the `PRESETS` array. The function SHALL NOT throw.

#### Scenario: render survives a renamed catalog

- **WHEN** the operator's bundle ships a `presets.ts` whose catalogue
  renamed `noir` → `noir-deep`
- **AND** the persisted row has `preset = "noir"` (legacy)
- **THEN** the render SHALL produce a Classic-palette MP4 (no 500)
- **AND** `<SceneCard>`'s rendered hex tokens SHALL match
  `PRESETS[0]` (not the legacy `noir` values)

### Requirement: idempotent ALTER

`_init_db_postgres` SHALL add the `render_config` JSONB column via
`ALTER TABLE … ADD COLUMN IF NOT EXISTS render_config JSONB`
(idempotent re-run pattern matching the `overlay_opacity`
column-add precedent).

#### Scenario: re-running init-db on a migrated DB

- **WHEN** `_init_db_postgres` runs against a DB where
  `studio_projects.render_config` already exists
- **THEN** the ALTER SHALL be a no-op (PG short-circuits on
  `IF NOT EXISTS`)
- **AND** no `column already exists` error SHALL surface in the
  startup logs

## MODIFIED Requirements

None.

## REMOVED Requirements

None.
