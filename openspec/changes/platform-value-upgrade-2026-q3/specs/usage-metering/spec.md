# usage-metering Specification

## Overview

Server-side usage tracking and quota enforcement per user. Powers the Free/Pro tier system. Tracks publish count, AI generation count, and account count. Returns 429 with upgrade prompt when quota exceeded.

## Requirements

### R1: Usage logging

- **Actions tracked**: `publish` (upload/video + upload/note), `ai_generate` (ai/generate + ai/generate/stream), `account_add` (account-groups authorize)
- **Storage**: `usage_logs` table with `(user_id, action, created_at)` and composite index
- **Logging point**: After successful action completion (not on attempt)
- **Cleanup**: TTL 90 days for free tier, 365 days for pro tier

### R2: Quota enforcement middleware

- **Middleware**: Flask `before_request` hook on `/api/upload/*` and `/api/ai/*` endpoints
- **Flow**:
  1. Extract user from session
  2. Determine tier (`users.license_tier`, default `'legacy'`)
  3. Look up tier limits from `TIER_LIMITS` config
  4. Count today's actions: `SELECT COUNT(*) FROM usage_logs WHERE user_id=? AND action=? AND created_at > today_start`
  5. If count >= limit → return `429 { success: false, error: "quota_exceeded", limit: N, used: N, reset_at: "tomorrow 00:00" }`
  6. If limit is -1 (unlimited) → skip check
  7. After successful action → insert into `usage_logs`
- **Bypass**: `SAU_METERING_ENABLED=false` env var disables all checks (for development/self-hosted)

### R3: Account count quota

- **Check point**: Before platform authorization in `/api/account-groups/<id>/authorize`
- **Logic**: Count distinct authorizations across all groups for user. If >= tier limit → 429.
- **Note**: This is a "current count" check, not a daily action count. Deleting an account frees a slot.

### R4: Frontend quota awareness

- **PublishPage**: Before submit, call `GET /api/usage/quota` to check remaining quota. If 0 remaining → show upgrade banner, disable submit.
- **AccountsPage**: Before adding account, check account quota.
- **Header**: Show quota indicator (e.g., "今日剩余: 3/5 次发布") for free tier users.
- **Upgrade CTA**: Banner with "升级 Pro →" button linking to settings/license page.

### R5: Quota status endpoint

```
GET /api/usage/quota
Response: {
  tier: "free" | "pro" | "legacy",
  quotas: {
    publish: { limit: 5, used: 2, remaining: 3, resets_at: "2026-06-26T00:00:00" },
    ai_generate: { limit: 10, used: 0, remaining: 10, resets_at: "..." },
    accounts: { limit: 3, used: 2, remaining: 1 }
  }
}
```

## Database

```sql
CREATE TABLE usage_logs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL CHECK(action IN ('publish','ai_generate','account_add')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_usage_user_action ON usage_logs(user_id, action, created_at);
```

## Tier Configuration

```python
TIER_LIMITS = {
    'free':    {'publish': 5,   'ai_generate': 10, 'accounts': 3},
    'pro':     {'publish': -1,  'ai_generate': -1, 'accounts': -1},
    'legacy':  {'publish': -1,  'ai_generate': -1, 'accounts': -1},
}
```

Configurable via environment variables: `SAU_TIER_FREE_PUBLISH=5`, etc.

## UI Components

| Component | Location | Description |
|-----------|----------|-------------|
| `QuotaIndicator` | App header (free tier only) | "今日剩余: N/M" chip |
| `QuotaBanner` | PublishPage, AccountsPage | Upgrade prompt when quota low/exceeded |
| `QuotaCheckDialog` | Pre-submit | Shows quota status before upload |

## Acceptance Criteria

- [ ] Free user publishes 5 times → 6th attempt returns 429 → frontend shows upgrade banner
- [ ] Pro user → no quota limits → unlimited publishing
- [ ] Legacy user (existing) → same as Pro, no restrictions
- [ ] `SAU_METERING_ENABLED=false` → all quota checks bypassed
- [ ] Header shows remaining quota for free tier users
- [ ] Account quota → cannot add 4th account on free tier
- [ ] Quota resets at midnight (server timezone)
