# license-system Specification

## Overview

License key activation, validation, and tier management. Enables manual commercial distribution of Pro licenses without payment gateway integration.

## Requirements

### R1: License key format

- **Format**: `SAU-{TIER}-{CHECKSUM}` where TIER is `PRO` and CHECKSUM is 8-char alphanumeric
- **Example**: `SAU-PRO-A3F8K2M9`
- **Generation**: Server-side only, via `POST /api/license/generate` (admin only)
- **Validation**: HMAC-SHA256 of `{tier}:{user_id}:{secret_key}` truncated to 8 chars, base36 encoded

### R2: Activation endpoint

```
POST /api/license/activate
Request: { key: "SAU-PRO-A3F8K2M9" }
Response: { success: true, tier: "pro", activated_at: "2026-06-25T19:00:00" }
Errors:
  - 400: Invalid format
  - 409: Key already activated by another user
  - 422: Invalid checksum
```

- **Flow**:
  1. Parse key format
  2. Verify checksum
  3. Check key not already bound to different user
  4. Update `users.license_tier` and `users.license_key`
  5. Return success

### R3: License status endpoint

```
GET /api/license/status
Response: {
  tier: "pro" | "free" | "legacy",
  key: "SAU-PRO-****",  // masked
  activated_at: "2026-06-25T19:00:00",
  expires_at: null  // null = perpetual
}
```

### R4: License deactivation

```
POST /api/license/deactivate
Response: { success: true, tier: "free" }
```

- Resets user to free tier
- Key becomes available for re-activation by another user

### R5: Admin key generation

```
POST /api/license/generate
Request: { tier: "pro", count: 10 }
Response: { keys: ["SAU-PRO-XXXX", ...] }
Auth: Admin role required
```

### R6: Frontend settings page

- **Location**: New section in a future `/settings` route, or embedded in existing user profile area
- **Display**: Current tier, activated key (masked), activate/deactivate buttons
- **Activate flow**: Text input → paste key → "激活" button → success/error toast
- **Free tier upgrade CTA**: "升级到 Pro" button with key input

## Database

```sql
ALTER TABLE users ADD COLUMN license_tier TEXT DEFAULT 'legacy';
ALTER TABLE users ADD COLUMN license_key TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN license_activated_at TIMESTAMP DEFAULT NULL;
```

- `license_tier`: One of `'free'`, `'pro'`, `'legacy'`
- `license_key`: Full key string, unique constraint
- `license_activated_at`: Timestamp of activation

## Security

- License secret key stored in environment variable `SAU_LICENSE_SECRET`
- Checksum validation prevents random key guessing
- One key per user constraint prevents sharing
- Admin endpoints require `role = 'admin'`

## UI Components

| Component | Location | Description |
|-----------|----------|-------------|
| `LicenseSection` | Settings/User profile | Tier display + activate/deactivate |
| `ActivateKeyDialog` | License section "激活" button | Key input + submit |
| `TierBadge` | Header / profile | Shows current tier as colored badge |

## Acceptance Criteria

- [ ] Generate key as admin → valid key format returned
- [ ] Activate key → user tier changes to "pro" → status endpoint reflects change
- [ ] Invalid key → error toast "无效的 License Key"
- [ ] Key already used by another user → error toast "该 Key 已被使用"
- [ ] Deactivate → tier resets to "free" → key available for reuse
- [ ] Settings page → shows current tier + masked key
- [ ] Non-admin → cannot access generate endpoint
