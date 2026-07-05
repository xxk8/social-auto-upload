## 1. Database Schema & Backend Foundation

- [x] 1.1 [Web API] Create `usage_logs` table in `web_runner/db.py` — columns: id, user_id, action, created_at. Add composite index `idx_usage_user_action(user_id, action, created_at)`. Add to both `_init_db_sqlite` and `_init_db_postgres`.
- [x] 1.2 [Web API] Create `publish_templates` table — columns: id, name, mode, snapshot(JSON), created_at, updated_at. Add to both init functions.
- [x] 1.3 [Web API] Add columns to `users` table: `license_tier TEXT DEFAULT 'legacy'`, `license_key TEXT DEFAULT NULL`, `license_activated_at TIMESTAMP DEFAULT NULL`. Use ALTER TABLE with IF NOT EXISTS guards.
- [x] 1.4 [Web API] Add columns to `tasks` table: `priority INTEGER DEFAULT 0`, `scheduled_at TIMESTAMP DEFAULT NULL`. Create partial index `idx_tasks_pending_scheduled(status, scheduled_at) WHERE status='pending' AND scheduled_at IS NOT NULL`.
- [x] 1.5 [Web API] Create composite analytics index: `CREATE INDEX idx_tasks_analytics ON tasks(platform, status, created_at)`.

## 2. Usage Metering Middleware

- [x] 2.1 [Web API] Create `web_runner/middleware/usage_metering.py` — Flask `before_request` hook that checks quota for `/api/upload/*` and `/api/ai/*` endpoints. Returns 429 with JSON error when exceeded.
- [x] 2.2 [Web API] Implement `TIER_LIMITS` config dict with env var overrides (`SAU_TIER_FREE_PUBLISH=5`, etc.). Default: free=5 publish/10 ai/3 accounts, pro/legacy=unlimited.
- [x] 2.3 [Web API] Add `SAU_METERING_ENABLED` env var toggle (default `true`). When `false`, bypass all quota checks.
- [x] 2.4 [Web API] Create `GET /api/usage/quota` endpoint returning current user's tier, limits, used counts, and reset times.
- [x] 2.5 [Web API] Add usage logging after successful action completion in `/api/upload/video`, `/api/upload/note`, `/api/ai/generate`, `/api/ai/generate/stream` routes.
- [x] 2.6 [Web API] Add account count quota check in `/api/account-groups/<id>/authorize` endpoint.

## 3. License System Backend

- [x] 3.1 [Web API] Create `web_runner/routes/license.py` with `POST /api/license/activate`, `GET /api/license/status`, `POST /api/license/deactivate` endpoints. Register blueprint in `create_app()`.
- [x] 3.2 [Web API] Implement `POST /api/license/generate` (admin only) — generates N keys for a given tier using HMAC-SHA256 checksum. Requires `SAU_LICENSE_SECRET` env var.
- [x] 3.3 [Web API] Add license validation utility: `validate_license_key(key) -> (tier, error)` with format parsing, checksum verification, and DB binding check.
- [x] 3.4 [Web API] Add `Authorization: Bearer` header parsing middleware for license key (alongside existing session auth).

## 4. Templates API Backend

- [x] 4.1 [Web API] Create `web_runner/routes/templates.py` with CRUD endpoints: `GET /api/templates`, `POST /api/templates`, `PUT /api/templates/<id>`, `DELETE /api/templates/<id>`. Register blueprint.
- [x] 4.2 [Web API] Add `POST /api/templates/import` — accepts JSON array of template objects, bulk inserts.
- [x] 4.3 [Web API] Add `GET /api/templates/export` — returns all templates as JSON file download.

## 5. Analytics API Backend

- [x] 5.1 [Web API] Create `web_runner/routes/analytics.py` with `GET /api/analytics/summary` endpoint. Accepts `from`/`to` query params. Returns total, success, failed, today, by_platform, by_day, failure_reasons via SQL aggregation on `tasks` table.
- [x] 5.2 [Web API] Add `GET /api/analytics/accounts` endpoint — returns per-account stats (total, success, failed, success_rate, last_active).
- [x] 5.3 [Web API] Add `GET /api/analytics/export` endpoint — CSV file download of tasks in date range.
- [x] 5.4 [Web API] Implement tier-based date window enforcement: Free tier queries clamped to 7 days. Read `license_tier` from session.

## 6. Task Executor Refactor

- [x] 6.1 [Web API] Create `web_runner/executor.py` — replace `ThreadPoolExecutor(8)` with `PriorityQueue`-based executor. Implement `submit_task()`, `retry_task()`, `cancel_task()` interface matching current call sites.
- [x] 6.2 [Web API] Add per-platform `threading.Semaphore` limits in executor. Read from `PLATFORM_CONCURRENCY` config dict with env var overrides.
- [x] 6.3 [Web API] Implement supervisor thread: polls queue every 1s, loads due scheduled tasks from DB, dispatches to platform-specific thread pools.
- [x] 6.4 [Web API] Add `POST /api/tasks/reschedule` endpoint — updates `tasks.scheduled_at` with validation (not in past, task is pending).
- [x] 6.5 [Web API] On startup (`create_app`), load all `status='pending' AND scheduled_at <= now` tasks into queue.
- [x] 6.6 [Web API] Update `POST /api/tasks/add` to accept `priority` and `scheduled_at` fields.

## 7. Frontend: Vite Config & Bundle Optimization

- [x] 7.1 [Frontend] Add `manualChunks` config to `vite.config.ts`: split vendor-react, vendor-radix, vendor-query, vendor-charts. Verify main chunk < 500KB after build.
- [ ] 7.2 [Frontend] Install `recharts` and `@tanstack/react-virtual` dependencies.
- [ ] 7.3 [Frontend] Lazy-load `FloatingLogs` component in `App.tsx` via `React.lazy()` + `Suspense`.
- [ ] 7.4 [Frontend] Add `AnalyticsPage` route to `App.tsx` with lazy loading. Add `BarChart3` icon to sidebar navigation.

## 8. Frontend: Stores & API Client

- [ ] 8.1 [Frontend] Create `src/stores/publishWizardStore.ts` — Zustand store with currentStep, mode, files, navigation methods, canProceed validation.
- [ ] 8.2 [Frontend] Create `src/stores/useTemplatesStore.ts` — Zustand store for template CRUD with localStorage persistence.
- [ ] 8.3 [Frontend] Create `src/stores/useLicenseStore.ts` — Zustand store for license tier, key status, activate/deactivate actions.
- [x] 8.4 [Frontend] Add API client methods in `src/api/client.ts`: `api.analytics.summary()`, `api.analytics.accounts()`, `api.analytics.export()`, `api.license.activate()`, `api.license.status()`, `api.license.deactivate()`, `api.templates.list()`, `api.templates.create()`, `api.templates.update()`, `api.templates.delete()`, `api.templates.import()`, `api.templates.export()`, `api.usage.quota()`, `api.tasks.reschedule()`.
- [ ] 8.5 [Frontend] Add TanStack Query staleTime config: accounts=60s, tasks=3s+refetchInterval=5s, logs=0, ai-models=300s.

## 9. Frontend: Draft & Template System

- [ ] 9.1 [Frontend] Implement auto-save in VideoForm/NoteForm: 800ms debounced write to `localStorage.setItem('sau-draft-video|note', ...)`.
- [ ] 9.2 [Frontend] Create `DraftRestoreToast` component — on PublishPage mount, check localStorage for draft < 24h old. Show toast with "恢复" / "清空" actions.
- [ ] 9.3 [Frontend] Create `TemplateChipRow` component — horizontal scrollable chip list showing saved templates from `useTemplatesStore`.
- [ ] 9.4 [Frontend] Create `SaveTemplateDialog` component — name input + save button, saves current form state as template.
- [ ] 9.5 [Frontend] Implement re-publish: TasksPage row "↻ 重发" button copies `publish_detail` to `/publish?from_task=<id>`, PublishPage reads query param and fills form.
- [ ] 9.6 [Frontend] Add clear-all confirmation dialog (AlertDialog) in VideoForm/NoteForm when ≥ 2 fields filled.

## 10. Frontend: Content Preview

- [ ] 10.1 [Frontend] Create `ContentPreview` component — reads from publish store, renders preview card.
- [ ] 10.2 [Frontend] Create `VideoPreviewCard` — cover image, title (2-line truncation), description (3-line), tag chips, platform indicators, schedule badge.
- [ ] 10.3 [Frontend] Create `NotePreviewCard` — image carousel (4 visible + "+N"), title, content (4-line), tag chips.
- [ ] 10.4 [Frontend] Add `PreviewToggle` in PublishPage toolbar to switch between AI sidebar and preview panel. Default: preview on desktop, hidden on mobile.
- [ ] 10.5 [Frontend] Create `MobilePreviewSheet` — bottom sheet triggered by eye icon for mobile preview.

## 11. Frontend: Publish Wizard

- [ ] 11.1 [Frontend] Create `PublishWizard` component as main container replacing current single-form layout in PublishPage.
- [ ] 11.2 [Frontend] Create `StepIndicator` component — horizontal stepper with numbered circles, lines, checkmarks for completed steps.
- [ ] 11.3 [Frontend] Create `UploadStep` (Step 1) — content type toggle, file dropzone, thumbnail upload. Extract from existing VideoForm/NoteForm.
- [ ] 11.4 [Frontend] Create `ContentStep` (Step 2) — title, description, tags, schedule, AI sidebar, platform-specific fields accordion.
- [ ] 11.5 [Frontend] Create `ReviewStep` (Step 3) — content preview, GroupPublishSelector, schedule picker, submit button, step summary.
- [ ] 11.6 [Frontend] Create `WizardNav` component — "上一步" / "下一步" buttons with step validation.
- [ ] 11.7 [Frontend] Add URL state sync: `?step=N` query param, browser back navigates wizard step.
- [ ] 11.8 [Frontend] Mobile layout: vertical stepper, fixed bottom nav bar, AI as bottom sheet.

## 12. Frontend: Analytics Dashboard

- [ ] 12.1 [Frontend] Create `AnalyticsPage` — top-level page with date range selector and responsive grid layout.
- [ ] 12.2 [Frontend] Create `StatsCards` — 4 summary cards (total, success rate, active accounts, today) with trend indicators.
- [ ] 12.3 [Frontend] Create `VolumeTrendChart` — recharts `AreaChart` with stacked success/failed series, hover tooltips, time range dropdown.
- [ ] 12.4 [Frontend] Create `PlatformPieChart` — recharts `PieChart` donut with platform colors, click-to-filter interaction.
- [ ] 12.5 [Frontend] Create `FailureReasonChart` — horizontal bar chart of top 5 failure reasons.
- [ ] 12.6 [Frontend] Create `AccountActivityTable` — sortable/filterable table with success rate highlighting.
- [ ] 12.7 [Frontend] Create `ExportButton` — CSV download trigger.
- [ ] 12.8 [Frontend] Create `QuotaUpgradeBanner` — shown on analytics page for free tier users with 7-day data window.

## 13. Frontend: Scheduled Timeline

- [ ] 13.1 [Frontend] Create `ScheduleTimeline` component — CSS Grid with time columns × platform rows.
- [ ] 13.2 [Frontend] Create `TimelineHeader` — date navigation (left/right arrows), "今天" button, zoom toggle (Day/Week/Month).
- [ ] 13.3 [Frontend] Create `TaskCard` — draggable task card with platform brand color, title, account, time.
- [ ] 13.4 [Frontend] Implement drag-to-reschedule: drag card to new time slot → call `api.tasks.reschedule()` → show toast with "撤销" option.
- [ ] 13.5 [Frontend] Add view toggle in TasksPage header: "列表视图" / "时间线视图" with localStorage persistence.
- [ ] 13.6 [Frontend] Add `NowLine` — vertical red line at current time position in timeline.

## 14. Frontend: Usage & License UI

- [ ] 14.1 [Frontend] Create `QuotaIndicator` component in App header — "今日剩余: N/M 次发布" chip, free tier only.
- [ ] 14.2 [Frontend] Create `QuotaBanner` component — shown in PublishPage/AccountsPage when quota low or exceeded. "升级 Pro →" CTA.
- [ ] 14.3 [Frontend] Create `LicenseSection` for settings/profile — current tier display, key input, activate/deactivate buttons.
- [ ] 14.4 [Frontend] Create `TierBadge` component — colored badge showing current tier in header/profile.
- [ ] 14.5 [Frontend] Add pre-submit quota check in PublishWizard: call `api.usage.quota()` before upload, show `QuotaCheckDialog` if 0 remaining.

## 15. Frontend: Performance Polish

- [ ] 15.1 [Frontend] Implement virtual scrolling in LogsPage using `@tanstack/react-virtual` — row height 32px, overscan 10 rows.
- [ ] 15.2 [Frontend] Add 300ms debounce to search inputs in LogsPage and TasksPage using custom `useDebounce` hook.
- [ ] 15.3 [Frontend] Add `prefers-reduced-motion` check to confetti in `PublishSuccessBanner.tsx` — skip animation if user prefers reduced motion.
- [ ] 15.4 [Frontend] Fix Dropzone `document.getElementById` → use React refs in VideoForm/NoteForm (OPT-M).

## 16. Testing & Verification

- [ ] 16.1 [Web API] Write unit tests for usage metering middleware — quota check, 429 response, bypass flag.
- [ ] 16.2 [Web API] Write unit tests for license validation — valid key, invalid checksum, already-activated key, deactivation.
- [ ] 16.3 [Web API] Write unit tests for analytics aggregation queries — correct counts, date filtering, platform grouping.
- [ ] 16.4 [Frontend] Write E2E test for publish wizard flow — upload → content → review → submit.
- [ ] 16.5 [Frontend] Write E2E test for draft auto-save — fill form → refresh → draft restored.
- [ ] 16.6 [Frontend] Write E2E test for analytics page — navigate → charts render → date filter works.
- [ ] 16.7 [Cross-layer] Run `npm run build` and verify main chunk < 500KB.
- [ ] 16.8 [Cross-layer] Run `npm run lint` and `npm run typecheck` — zero errors.
- [ ] 16.9 [Cross-layer] Run `ruff check` on Python code — zero errors.
