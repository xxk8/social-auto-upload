## Context

social-auto-upload is a Flask + React application for batch-publishing video/note content to 7 Chinese social media platforms. The architecture is:

- **Backend**: Flask 3.1 on port 6001, SQLite (dev) / PostgreSQL 19 (production), `ThreadPoolExecutor(8)` for concurrent uploads, subprocess-based CLI invocation per upload task
- **Frontend**: React 19 + Vite + Zustand + TanStack Query + Radix UI + Tailwind 4, code-split by page route
- **CLI**: `sau <platform> <action>` with patchright browser automation per platform

Current pain points identified through codebase audit:

1. **No draft persistence**: 16+ field publish form must be re-filled every time
2. **No analytics**: Users cannot see publish success rates, platform distribution, or trends
3. **No usage metering**: No concept of quotas, tiers, or commercial boundaries
4. **Fixed thread pool**: 8 workers regardless of platform, no priority, scheduled tasks lost on restart
5. **Bundle bloat**: 768KB main JS chunk (target: < 500KB)
6. **No virtualization**: LogsPage renders all DOM nodes, search triggers on every keystroke

Key constraints:
- Chinese (zh-CN) UI labels
- API response shape: `{ success: bool, data: T?, message: str? }`
- Backend routes in `web_runner/routes/`, state in `web_runner/db.py`
- Frontend pages in `sau_web/frontend/src/Pages/`, stores in `src/stores/`, API client in `src/api/client.ts`
- Existing DB tables: `tasks`, `logs`, `account_groups`, `account_authorizations`, `ai_config`, `ai_api_keys`, `error_events`, `users`, `verification_codes`

## Goals / Non-Goals

**Goals:**
- Enable users to save/reuse publish form presets, reducing publish cycle from 3 minutes to 30 seconds
- Provide a data-driven analytics dashboard that serves as the primary Pro tier differentiator
- Implement usage metering and Free/Pro tier enforcement to enable commercial launch
- Refactor task executor for priority scheduling and per-platform concurrency control
- Reduce main JS bundle from 768KB to < 500KB via manual chunk splitting
- Add virtual scrolling and input debouncing for performance at scale

**Non-Goals:**
- Mobile PWA support (desktop-first tool)
- Multi-language i18n (Chinese-only user base)
- Team/multi-tenant collaboration (single-user desktop tool)
- Payment gateway integration (license keys are manual distribution for now)
- Real-time WebSocket (SSE is sufficient for current use cases)

## Decisions

### D1: Draft persistence via localStorage with optional server sync

**Decision**: Use `localStorage` as primary draft storage (800ms debounce write), with a future option to sync to server via `publish_templates` table.

**Rationale**: localStorage requires zero backend changes, works offline, and has no API cost. The `publish_templates` table is designed but only used for "saved templates" (explicit user action), not auto-drafts. Auto-drafts stay in localStorage to avoid 429s from rapid keystroke writes.

**Data model** (localStorage):
```typescript
interface DraftSnapshot {
  mode: 'video' | 'note'
  title: string
  description: string
  tags: string[]
  schedule: string | null
  platformGroupId: string | null
  // ... other form fields
  savedAt: number // Date.now()
}
// Key: sau-draft-{video|note}
```

**Data model** (DB table `publish_templates`):
```sql
CREATE TABLE publish_templates (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK(mode IN ('video','note')),
  snapshot   JSON NOT NULL,      -- same shape as DraftSnapshot
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Alternatives considered**:
- IndexedDB: More storage capacity but adds complexity (Dexie dependency). localStorage's 5MB limit is sufficient for ~500 template snapshots.
- Server-only storage: Requires API calls on every keystroke. Unacceptable latency for auto-save.
- File-based (JSON export only): No auto-restore. Only useful for backup/sharing.

### D2: Analytics via SQL aggregation, rendered with recharts

**Decision**: Backend computes aggregated statistics via SQL `GROUP BY` queries on the `tasks` table. Frontend renders with `recharts` (~200KB, tree-shakeable). Free tier window limited to 7 days via `WHERE created_at > NOW() - INTERVAL '7 days'`.

**Rationale**: The `tasks` table already contains `platform`, `status`, `created_at`, `account` — all the dimensions needed. No new data collection is required. `recharts` is the most popular React charting library, well-maintained, and supports responsive containers.

**API design**:
```
GET /api/analytics/summary?from=2026-06-01&to=2026-06-25
Response: {
  total: 142,
  success: 128,
  failed: 14,
  by_platform: { douyin: 45, bilibili: 38, ... },
  by_day: [{ date: "2026-06-01", success: 8, failed: 1 }, ...],
  failure_reasons: [{ reason: "Cookie expired", count: 6 }, ...]
}

GET /api/analytics/accounts?from=...&to=...
Response: {
  most_active: [{ account: "douyin_main", count: 45 }, ...],
  failure_rate: [{ account: "bilibili_alt", rate: 0.33 }, ...]
}
```

**Alternatives considered**:
- Pre-computed materialized views: Overkill for current data volume (< 100K tasks). SQL aggregation on indexed columns is < 50ms.
- ClickHouse / time-series DB: Massive infra overhead. SQLite/PostgreSQL handles this scale easily.
- Frontend-only aggregation: Fetches all tasks to client. Breaks at > 10K records.

### D3: Task executor refactor — priority queue with per-platform limits

**Decision**: Replace `ThreadPoolExecutor(8)` with a `PriorityQueue`-based executor that:
- Maintains per-platform semaphores (e.g., Douyin max 2 concurrent, Bilibili max 3)
- Supports task priority levels (scheduled < normal < retry)
- Persists scheduled tasks to DB (survive restarts via `scheduled_at` column)
- Uses a single supervisor thread that polls the queue and dispatches to a dynamic thread pool

**Rationale**: Different platforms have different anti-bot sensitivity. Douyin aggressively rate-limits; Bilibili is more lenient. A fixed 8-worker pool treats all platforms equally, leading to Douyin bans. Persisting scheduled tasks to DB fixes the current `threading.Timer` approach that loses schedules on restart.

**Architecture**:
```
                   ┌─────────────┐
                   │  PriorityQ   │
                   │  (in-memory) │
                   └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │  Supervisor  │ ← single thread, polls every 1s
                   │              │ ← reads DB for due scheduled tasks
                   └──────┬──────┘
                          │ dispatch
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ Platform  │  │ Platform  │  │ Platform  │
     │ Pool:     │  │ Pool:     │  │ Pool:     │
     │ Douyin(2) │  │ Bili(3)   │  │ XHS(2)   │
     └──────────┘  └──────────┘  └──────────┘
```

**DB change**:
```sql
ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN scheduled_at TIMESTAMP;
CREATE INDEX idx_tasks_scheduled ON tasks(status, scheduled_at) WHERE status = 'pending';
```

**Alternatives considered**:
- Celery + Redis: Heavy dependency chain. The project runs on a single machine; Celery's distributed architecture is overkill.
- APScheduler: Good for cron-like scheduling but doesn't handle priority or per-platform limits.
- Keep ThreadPoolExecutor + add per-platform locks: Simpler but doesn't solve the persistence problem for scheduled tasks.

### D4: Frontend bundle splitting via Vite `manualChunks`

**Decision**: Configure `vite.config.ts` with explicit `manualChunks` to split vendor libraries into separate cacheable chunks.

**Configuration**:
```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-radix': [
          '@radix-ui/react-dialog', '@radix-ui/react-select',
          '@radix-ui/react-tabs', '@radix-ui/react-accordion',
          '@radix-ui/react-tooltip', '@radix-ui/react-popover'
        ],
        'vendor-query': ['@tanstack/react-query'],
        'vendor-charts': ['recharts'],
      }
    }
  }
}
```

**Expected impact**:
- Main chunk: 768KB → ~400KB (React + Router removed)
- `vendor-react`: ~140KB (cached aggressively, changes rarely)
- `vendor-radix`: ~80KB
- `vendor-query`: ~30KB
- `vendor-charts`: ~200KB (only loaded on `/analytics` route, lazy)

**Alternatives considered**:
- Automatic code splitting via `splitChunks`: Vite's default doesn't split vendor chunks aggressively enough. Manual control gives predictable sizes.
- Replace Radix with headless alternatives: Massive rewrite for marginal savings. Radix tree-shakes well.
- Replace recharts with lightweight alternatives (uPlot, Chart.js): recharts has the best React integration. 200KB is acceptable since it's lazy-loaded only on analytics page.

### D5: Usage metering via middleware + DB table

**Decision**: Add a `usage_logs` table and a Flask `before_request` middleware that increments counters. Quota checks happen before upload/ai endpoints.

**Data model**:
```sql
CREATE TABLE usage_logs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL CHECK(action IN ('publish','ai_generate','account_add')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_usage_user_action ON usage_logs(user_id, action, created_at);
```

**Middleware flow**:
```
Request → before_request → usage_middleware
  ├─ Is endpoint /api/upload/* or /api/ai/*?
  │   ├─ Get user tier (license_tier from users table, cached 60s)
  │   ├─ Count today's actions: SELECT COUNT(*) FROM usage_logs WHERE user_id=? AND action=? AND created_at > today
  │   ├─ If count >= tier_limit → return 429 { error: "quota_exceeded", upgrade_url: "/settings" }
  │   └─ Else → continue to handler, log action after success
  └─ Other endpoints → pass through
```

**Tier limits** (configurable via env vars):
```python
TIER_LIMITS = {
    'free':    {'publish': 5,   'ai_generate': 10, 'accounts': 3},
    'pro':     {'publish': -1,  'ai_generate': -1, 'accounts': -1},  # -1 = unlimited
    'legacy':  {'publish': -1,  'ai_generate': -1, 'accounts': -1},  # existing users
}
```

**Alternatives considered**:
- Redis-based counters: Requires Redis dependency. SQLite/PostgreSQL COUNT with index is < 1ms for daily aggregates.
- Client-side only enforcement: Trivially bypassed. Server-side is mandatory.
- Rate limiting library (Flask-Limiter): Rate limiting ≠ usage metering. We need per-action counting, not request throttling.

### D6: License key format and validation

**Decision**: License keys follow `SAU-{tier}-{checksum}` format. Stored in `users.license_key` column. Validated via HMAC checksum. Frontend stores in localStorage and sends via `Authorization: Bearer SAU-xxx` header.

**Format**: `SAU-PRO-A3F8K2M9` (8-char alphanumeric checksum of `tier + user_id + secret`)

**Validation flow**:
```
POST /api/license/activate { key: "SAU-PRO-A3F8K2M9" }
  → Parse tier from prefix
  → Verify checksum
  → UPDATE users SET license_tier='pro', license_key='SAU-PRO-...' WHERE id=?
  → Return { tier: "pro", expires_at: null }
```

**Alternatives considered**:
- JWT-based licenses: More complex, harder to revoke, requires key management.
- External license server (Keygen, Gumroad): Adds dependency and cost. Manual key distribution is fine for initial launch.
- Stripe integration: Premature. Launch with manual license distribution first, add Stripe when revenue justifies it.

### D7: Multi-step publish wizard as controlled state machine

**Decision**: Implement the 3-step wizard as a controlled component with step state managed by Zustand (`publishWizardStore`). Each step is a separate sub-component. Navigation is explicit (back/next/step-click).

**Steps**:
1. **Upload**: File dropzone, content type toggle (video/note), thumbnail upload
2. **Content**: Title, description, tags, AI sidebar, platform-specific fields
3. **Review**: Content preview, platform/account selection, schedule picker, submit

**State shape**:
```typescript
interface PublishWizardState {
  currentStep: 1 | 2 | 3
  mode: 'video' | 'note'
  files: File[]         // step 1
  formData: FormData    // step 2 (reuses existing VideoForm/NoteForm state)
  selectedPlatforms: string[]  // step 3
  schedule: string | null
  setStep: (n: number) => void
  next: () => void
  back: () => void
  canProceed: () => boolean  // per-step validation
}
```

**Alternatives considered**:
- Keep single form, just add sections: Doesn't reduce cognitive load. The 3-step model forces focus.
- URL-based steps (`/publish/1`, `/publish/2`): Breaks back-button expectations. State machine in a single route is cleaner.
- Third-party wizard library (react-step-wizard): Adds dependency for a simple state machine. Custom is < 100 lines.

## Risks / Trade-offs

- **[Risk] localStorage draft conflicts with server templates** → Mitigation: Auto-drafts (localStorage) and saved templates (DB) are separate concepts. Drafts are ephemeral (last 1 only), templates are named and persistent. No overlap.

- **[Risk] Analytics queries slow on large task tables** → Mitigation: Composite index `(status, platform, created_at)` covers all GROUP BY patterns. For > 1M rows, consider materialized views (future optimization).

- **[Risk] Per-platform concurrency limits too aggressive** → Mitigation: Defaults are conservative (2 per platform). Configurable via env vars (`SAU_CONCURRENT_DOUYIN=3`). Users can increase if their accounts are not rate-limited.

- **[Risk] Free tier 429s frustrate new users** → Mitigation: Frontend shows upgrade prompt with clear value proposition. Quota resets daily. Existing users get "legacy" tier (unlimited) automatically.

- **[Risk] recharts bundle size (200KB)** → Mitigation: Lazy-loaded only on `/analytics` route. Users who never visit analytics never download it. Consider code-splitting recharts internals further if needed.

- **[Risk] Multi-step wizard loses context on browser back** → Mitigation: Wizard state lives in Zustand (persists across renders). Auto-save to localStorage on every step change. Browser back navigates wizard step, not URL history.

- **[Trade-off] Manual chunk splitting vs automatic** → Manual requires maintenance when adding/removing dependencies. Accepted because automatic splitting produced suboptimal results (768KB main chunk).

- **[Trade-off] Server-side quota enforcement adds latency** → One COUNT query per upload (~1ms with index). Accepted for commercial correctness.

## Migration Plan

1. **Phase 1 — Foundation** (this change): DB schema additions, usage metering middleware, license endpoints, localStorage draft system
2. **Phase 2 — Frontend**: Multi-step wizard, analytics page, content preview, bundle optimization, virtual scrolling
3. **Phase 3 — Executor refactor**: Priority queue, per-platform limits, persistent scheduling
4. **Phase 4 — Commercial launch**: License key distribution, tier enforcement activation, marketing site pricing page

**Rollback strategy**:
- All new DB columns have defaults (`license_tier DEFAULT 'legacy'`), so existing rows are unaffected
- Usage metering middleware can be disabled via `SAU_METERING_ENABLED=false` env var
- License validation is a no-op for `legacy` tier users
- Frontend changes are additive (new routes, new components) — old routes still work
- Executor refactor is a drop-in replacement: same `tasks` table, same status transitions

**Zero-downtime deployment**: All changes are backwards-compatible. No data migration required. New columns added with defaults. New tables created on startup via `init_db()`.

## Open Questions

- Should `publish_templates` support team sharing (export/import JSON) in this iteration, or defer to a future "team collaboration" change?
- Should the analytics page show real-time data (SSE streaming) or is 30-second polling sufficient?
- What are the exact per-platform concurrency defaults? Need input from users experiencing rate limits.
- Should "legacy" tier users see any quota indicators in the UI (for awareness), or remain completely unlimited with no UI noise?
