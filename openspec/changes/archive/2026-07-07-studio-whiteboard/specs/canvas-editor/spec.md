## ADDED Requirements

### Requirement: Canvas data column on studio_projects
The system SHALL persist canvas data on `studio_projects` via a `canvas_data` column. SQLite stores as `TEXT`, PostgreSQL as `JSONB`. The column SHALL be nullable (`NULL` represents an empty canvas). Serialized snapshot size SHALL be capped at `SAU_STUDIO_CANVAS_MAX_SIZE` (default 10MB), measured as the **UTF-8 encoded byte length** of the JSON-serialized snapshot — i.e. `len(json.dumps(canvas_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))` on the backend, NOT the Python `str` character count. A non-ASCII-heavy snapshot can be up to ~3× larger in bytes than in Python `len()` characters, so the cap must be checked against the UTF-8 byte length to prevent storing payloads that exceed the configured budget. The `ensure_ascii=False, separators=(",", ":")` flags MUST be passed so the server emits the same byte sequence as `JSON.stringify` + `TextEncoder().encode()` on the client (Python's `json.dumps` defaults are `ensure_ascii=True` and `(", ", ": ")` — using those defaults would cause the same logical payload to measure different byte counts on the two sides and the client preflight could disagree with the server 400).

#### Scenario: New column added to existing schema (SQLite)
- **WHEN** `init_db()` runs against an existing SQLite database where `studio_projects` lacks `canvas_data`
- **THEN** `ALTER TABLE studio_projects ADD COLUMN canvas_data TEXT` is executed inside the existing `try/except sqlite3.OperationalError: pass` loop so re-runs are idempotent

#### Scenario: New column added to existing schema (PostgreSQL)
- **WHEN** `init_db()` runs against an existing PostgreSQL database where `studio_projects` lacks `canvas_data`
- **THEN** `ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS canvas_data JSONB` succeeds idempotently

#### Scenario: Empty canvas stored as NULL
- **WHEN** user clears the canvas and the resulting tldraw snapshot has no records
- **THEN** `canvas_data` is written as `NULL`

### Requirement: GET /api/studio/projects/{id}/canvas (lazy-load endpoint)
The system SHALL expose a dedicated `GET /api/studio/projects/{id}/canvas` endpoint that returns the project's stored canvas data. The canvas data SHALL NOT be included in `GET /api/studio/projects/{id}` project detail response — kept separate to avoid bloating the detail payload with up to 10 MiB (UTF-8 bytes) of tldraw JSON on every project page load.

#### Scenario: Owner retrieves canvas
- **WHEN** authenticated user GETs `/api/studio/projects/{id}/canvas` and owns the project
- **THEN** response is `{ success: true, data: { canvas_data: <TldrawSnapshot dict> } }` with HTTP 200
- **AND** the server returns the stored JSON value without any schema or content transformation — it does NOT perform any version upgrade or downgrade; any schema migration is the client-side tldraw instance's responsibility on load

#### Scenario: Owner retrieves empty canvas
- **WHEN** authenticated user GETs `/api/studio/projects/{id}/canvas` and stored `canvas_data IS NULL`
- **THEN** response is `{ success: true, data: { canvas_data: null } }` with HTTP 200

#### Scenario: Non-owner returns 404
- **WHEN** authenticated user GETs `/api/studio/projects/{id}/canvas` for a project owned by another user
- **THEN** system returns HTTP 404 (not 403) to prevent project-ID enumeration via response-code differential

#### Scenario: Project detail does not include canvas_data
- **WHEN** authenticated user GETs `/api/studio/projects/{id}` for any project
- **THEN** response data SHALL NOT contain a `canvas_data` field — canvas data is delivered only through the dedicated `/canvas` endpoint

### Requirement: PATCH /api/studio/projects/{id}/canvas (save endpoint)
The system SHALL expose `PATCH /api/studio/projects/{id}/canvas` to save canvas data. The request body SHALL be `{ canvas_data: <object | null> }`. On success, `updated_at` on the project row SHALL be bumped to the current server time.

#### Scenario: Owner saves valid canvas data
- **WHEN** owner PATCHes with `{ canvas_data: { schema: 2, store: { records: {...} } } }`
- **THEN** system persists the value, updates `updated_at`, and returns `{ success: true, data: { id, updated_at } }` with HTTP 200

#### Scenario: Save with non-object canvas_data
- **WHEN** client PATCHes with `{ canvas_data: "string" }` or `{ canvas_data: 123 }` or `{ canvas_data: [] }`
- **THEN** system returns `{ success: false, message: "canvas_data 必须是 JSON 对象" }` with HTTP 400

#### Scenario: Save exceeds UTF-8 byte size limit
- **WHEN** client PATCHes and `len(json.dumps(canvas_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))` exceeds `SAU_STUDIO_CANVAS_MAX_SIZE` (default 10 MiB UTF-8 bytes = 10,485,760 bytes)
- **THEN** system returns `{ success: false, message: "画布数据过大（>10MB），请精简后重试" }` with HTTP 400
- **AND** the `separators=(",", ":")` flag MUST be passed so the server's emitted JSON matches the client-side `JSON.stringify` byte count (without this flag Python's default `(", ", ": ")` would yield a larger payload than the client preflight and the two would disagree on the boundary)

#### Scenario: Save with null clears canvas
- **WHEN** owner PATCHes with `{ canvas_data: null }`
- **THEN** system writes `canvas_data = NULL`, bumps `updated_at`, and returns HTTP 200

#### Scenario: Non-owner returns 404
- **WHEN** non-owner PATCHes `/api/studio/projects/{id}/canvas` for a project owned by another user
- **THEN** system returns HTTP 404

### Requirement: Owner isolation on canvas endpoints
The system SHALL enforce project-level owner isolation on `/canvas` endpoints using the same `_load_project(user_id, project_id)` helper used by other studio endpoints. Non-owner access SHALL return 404 (uniform with other studio endpoints).

#### Scenario: Cross-user GET → 404
- **WHEN** user A attempts to GET `/api/studio/projects/{user_B_project}/canvas`
- **THEN** system returns HTTP 404

#### Scenario: Cross-user PATCH → 404
- **WHEN** user A attempts to PATCH `/api/studio/projects/{user_B_project}/canvas`
- **THEN** system returns HTTP 404

### Requirement: Backend is schema-version-agnostic
The backend MUST treat `canvas_data` as an opaque JSON object. The `TldrawSnapshot.schema` field (and all other tldraw-internal fields such as `store.records`, shape types, binding structure) MUST be opaque to the server — the backend SHALL NOT parse, validate, or interpret the tldraw internal structure. The server's only obligations on the canvas payload are: (a) `canvas_data` MUST be a JSON object or `null`, and (b) UTF-8 encoded byte size MUST be ≤ `SAU_STUDIO_CANVAS_MAX_SIZE`. Schema-version migration (e.g. `schema: 1` → `schema: 2` → future `schema: N`) is the sole responsibility of the client-side tldraw instance, which auto-migrates snapshots on `editor.store.put()`. This decoupling lets the frontend upgrade tldraw independently of the backend and prevents server-side breakage when tldraw releases new schema versions.

#### Scenario: Backend accepts a future tldraw schema version
- **WHEN** client PATCHes `canvas_data: { schema: 99, store: { records: {...} } }` (a hypothetical future tldraw version the server has never seen)
- **THEN** system persists the value as-is and returns HTTP 200
- **AND** the server did not inspect, validate, or reject the unknown `schema` value — the field is opaque storage

#### Scenario: Backend accepts a legacy tldraw schema version
- **WHEN** client PATCHes `canvas_data: { schema: 1, store: { records: {...} } }` (a legacy tldraw v1.x snapshot persisted by an older client)
- **THEN** system persists the value as-is and returns HTTP 200 without rejecting the older format
- **AND** the legacy snapshot is migrated to the current schema client-side on the next `editor.store.put()`; the server does not perform this migration

#### Scenario: Backend does not reject unknown custom shape types
- **WHEN** client PATCHes `canvas_data` containing a tldraw custom shape the server has never seen (e.g. `store.records.shape_x = { typeName: "shape", type: "custom-robot-shape", x: 0, y: 0, ... }`)
- **THEN** system persists the value as-is and returns HTTP 200 — the server does not validate or reject the unknown `type` field
- **AND** the server's contract is opacity to the *entire* tldraw internal structure (not just the top-level `schema` field): any record type, any binding, any future internal field is accepted unchanged

#### Scenario: Backend accepts canvas data without a schema field
- **WHEN** client PATCHes `canvas_data: { store: { records: {...} } }` (no `schema` key)
- **THEN** system persists the value as-is and returns HTTP 200 — the server does not require a `schema` field

### Requirement: Frontend canvas lazy load
The system SHALL load canvas data only when the canvas editor is rendered. Canvas data SHALL NOT be included in the project detail query. The canvas fetch SHALL use an independent TanStack Query key so it can be invalidated independently of project detail.

#### Scenario: Project detail fetch excludes canvas
- **WHEN** `StudioDetailPage` renders and `useQuery(['studio-project', projectId])` fires
- **THEN** no request to `/canvas` is made unless the canvas editor is rendered

#### Scenario: Canvas editor triggers independent fetch
- **WHEN** `CanvasEditor` mounts
- **THEN** a separate `useQuery(['studio-canvas', projectId])` issues `GET /api/studio/projects/{id}/canvas`

#### Scenario: Save invalidates canvas cache
- **WHEN** `CanvasEditor` successfully PATCHes canvas data
- **THEN** `invalidateQueries(['studio-canvas', projectId])` is called so a re-mount fetches the server-truth state

### Requirement: Auto-save with debounce and leave-prompt
The system SHALL auto-save canvas changes with a 3-second debounce after the user stops editing. The canvas editor SHALL display a save-status indicator. When there are unsaved local changes, the system SHALL warn the user before they navigate away.

#### Scenario: User edit marks canvas dirty
- **WHEN** user modifies the canvas via tldraw editor
- **THEN** `isDirty = true` is set and the save-status indicator turns yellow

#### Scenario: Debounced auto-save after 3s
- **WHEN** `isDirty = true` and no further canvas edit occurs for 3 seconds
- **THEN** `PATCH /api/studio/projects/{id}/canvas` is sent with `editor.store.getSnapshot()`. On 200 the system sets `isDirty = false` and the indicator turns green with `lastSavedAt` updated.

#### Scenario: Save failure retries with backoff
- **WHEN** auto-save PATCH returns network error or HTTP 5xx
- **THEN** system retries up to 3 times with exponential backoff. If all retries fail, `isDirty` stays true and a Toast "保存失败，正在重试" appears.

#### Scenario: Leave-with-dirty prompt
- **WHEN** user attempts to navigate away (or close tab) and `isDirty = true`
- **THEN** browser native `beforeunload` confirmation prompt appears asking the user to confirm leaving

### Requirement: Client-side size preflight
The system SHALL preflight-check the canvas payload size before sending PATCH so that the user gets immediate local feedback rather than waiting for the server's 400 response.

#### Scenario: Local size check blocks oversized PATCH
- **WHEN** `new TextEncoder().encode(JSON.stringify(canvas_data)).length > SAU_STUDIO_CANVAS_MAX_SIZE` at the moment auto-save would fire (UTF-8 byte count, matching the backend's `len(json.dumps(canvas_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))` so the client preflight and the server 400 use the **same** byte count and agree on the rejection boundary)
- **THEN** the network call is skipped and a Toast appears reading "画布内容过多，请精简后保存". `isDirty` remains true so the user can fix the canvas before retrying.
