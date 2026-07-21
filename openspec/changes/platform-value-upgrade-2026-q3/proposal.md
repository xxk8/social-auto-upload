## Why

social-auto-upload has solid core functionality (7-platform upload, QR login, AI content generation, task management) but lacks the features that distinguish a "developer tool" from a "product users will pay for." Users must re-enter 16+ form fields every publish cycle, have zero visibility into historical performance or future schedules, and the platform has no usage metering or tiered access model. Meanwhile, technical debt (768KB main bundle, fixed 8-thread executor, no virtual scrolling) will block scale. This change addresses all four dimensions — feature completeness, UX, performance, and commercial viability — in a single coordinated upgrade.

## What Changes

### Feature Completeness
- **Draft/Template system**: Save, restore, and reuse publish form presets (title, description, tags, schedule, platform selection) via localStorage + optional server-side storage. TasksPage gets a "re-publish" button that copies historical task parameters back to the publish form.
- **Analytics dashboard** (`/analytics`): New page showing publish volume trends, per-platform success/failure rates, failure cause Top 5, account activity heatmap, and CSV export. Free tier sees 7-day window; Pro tier gets full history.
- **Scheduled task timeline**: Calendar/timeline view in TasksPage showing future scheduled tasks as draggable cards on a time × platform grid.
- **Content preview panel**: Real-time preview in PublishPage showing how the video/note will look (title layout, cover image, tag chips, description truncation) before submission.
- **Baijiahao + TikTok Web support**: Promote the two CLI-only platforms to full Web Shell coverage.

### User Experience
- **Multi-step publish wizard**: Replace the single 16-field form with a 3-step guided flow (Upload → Content → Review & Submit), with step indicator and back/forward navigation.
- **Auto-save drafts**: localStorage-based form persistence (800ms debounce) with "restore draft" toast on page reload.
- **Improved success flow**: Replace the 1.5s forced redirect with a cancellable countdown + "continue publishing" button.
- **In-place account re-login**: When a platform account shows "expired" in PublishPage, allow QR re-login without navigating to AccountsPage.
- **Global search enhancement**: Extend CommandPalette (Cmd+K) to search historical tasks, accounts, and quick actions (e.g., "publish video to Douyin").

### Technical Performance
- **Bundle optimization**: Manual chunk splitting (vendor-react, vendor-radix, vendor-query), FloatingLogs lazy load, target main bundle < 500KB.
- **Task queue refactor**: Replace fixed `ThreadPoolExecutor(8)` with priority-aware queue, per-platform concurrency limits, and persistent scheduled tasks (survive restarts).
- **Frontend virtualization**: Virtual scrolling for LogsPage (500+ entries), debounce search inputs (300ms), optimized TanStack Query staleTime per resource.
- **Database indexing**: Composite indexes on `tasks(status, platform, created_at)`, TTL auto-cleanup for logs table.

### Commercial Viability
- **Usage metering middleware**: Track daily publish count, account count, AI calls per user.
- **Free/Pro tier enforcement**: Free = 3 accounts, 5 publishes/day, 7-day history. Pro = unlimited.
- **License key system**: `SAU-{tier}-{hash}` format, stored in `users` table, validated via `/api/license/` endpoints.
- **AI tier split**: Free users share community OpenRouter key (rate-limited); Pro users bring their own key (unlimited).
- **Data dashboard gating**: Free = basic 7-day stats; Pro = full trends, export, custom date range.

## Capabilities

### New Capabilities
- `draft-templates`: CRUD for publish form presets, localStorage persistence, import/export JSON, re-publish from task history
- `analytics-dashboard`: Aggregation queries on tasks table, chart rendering (recharts), CSV export, tiered data window
- `scheduled-timeline`: Calendar view for future tasks, drag-to-reschedule, per-platform row layout
- `content-preview`: Real-time publish form preview panel (video thumbnail + title + tags + description layout)
- `usage-metering`: Per-user action counting, quota enforcement middleware, frontend quota checks before submit
- `license-system`: License key activation, validation, tier detection, frontend settings page integration
- `publish-wizard`: Multi-step form with step indicator, back/forward, per-step validation, auto-save integration

### Modified Capabilities
- `api-reliability`: Add per-platform concurrency limits to task executor, persistent scheduled task storage, composite DB indexes
- `frontend-polish`: Bundle splitting config, virtual scrolling for logs, debounce search, optimized query staleTime
- `multi-turn-chat`: AI tier split (community key vs user-owned key), quota-gated AI calls

## Impact

- **Web API** (`web_runner/`):
  - New routes: `/api/analytics/*`, `/api/license/*`, `/api/templates/*`
  - Modified routes: `/api/upload/*` (quota check), `/api/ai/*` (tier check), `/api/tasks/*` (timeline query)
  - New DB tables: `usage_logs`, `publish_templates`
  - Modified DB: `users` table (add `license_tier`, `license_key` columns)
  - New middleware: `usage_metering`, `license_validation`
  - Executor refactor: `web_runner/executor.py` (priority queue, per-platform limits)

- **Frontend** (`sau_web/frontend/`):
  - New pages: `/analytics` (AnalyticsPage), updated `/publish` (wizard flow + preview)
  - New components: `PublishWizard`, `ContentPreview`, `AnalyticsCharts`, `ScheduleTimeline`, `QuotaBanner`
  - New stores: `useTemplatesStore`, `useAnalyticsStore`, `useLicenseStore`
  - Modified: `PublishPage`, `TasksPage`, `LogsPage`, `App.tsx` (routes), `vite.config.ts` (chunks)
  - New API client methods: `api.analytics.*`, `api.license.*`, `api.templates.*`

- **CLI** (`sau_cli.py`): No direct CLI changes. All new features are Web Shell only.

- **Dependencies**:
  - Frontend: +`recharts` (charts), +`@tanstack/react-virtual` (virtual scroll), +`canvas-confetti` (already suggested)
  - Backend: No new Python deps (uses existing Flask + psycopg2/sqlite3)

- **Breaking**: Free tier users hitting quota limits will receive `429 Too Many Requests` — frontend handles gracefully with upgrade prompt. Existing users default to "legacy" tier (equivalent to Pro) during migration.
