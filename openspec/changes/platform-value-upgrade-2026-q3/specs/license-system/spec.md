## ADDED Requirements

### Requirement: License key format validation

The system SHALL validate license keys with format `SAU-{TIER}-{TOKEN}` where TIER is `PRO` (case-insensitive, uppercased on parse) and TOKEN is a 12-character alphanumeric string (uppercase letters + digits). The `validate_license_key_format()` function SHALL return `(tier, None)` on success or `("", error_message)` on failure. Format validation SHALL NOT perform any database lookups.

#### Scenario: Valid key format

- **GIVEN** key = `"SAU-PRO-A3F8K2M9X7B1"` (12-char token)
- **WHEN** `validate_license_key_format(key)` is called
- **THEN** the function SHALL return `("pro", None)`

#### Scenario: Missing key

- **WHEN** `validate_license_key_format("")` or `validate_license_key_format(None)` is called
- **THEN** the function SHALL return `("", "License key is required")`

#### Scenario: Wrong number of segments

- **GIVEN** key = `"SAU-PRO"` (only 2 segments)
- **WHEN** `validate_license_key_format(key)` is called
- **THEN** the function SHALL return `("", "Invalid key format. Expected SAU-{TIER}-{TOKEN}")`

#### Scenario: Wrong prefix

- **GIVEN** key = `"XYZ-PRO-A3F8K2M9X7B1"`
- **THEN** the function SHALL return `("", "Key must start with SAU-")`

#### Scenario: Unknown tier

- **GIVEN** key = `"SAU-ENTERPRISE-A3F8K2M9X7B1"`
- **THEN** the function SHALL return `("", "Unknown tier: ENTERPRISE")`

#### Scenario: Token length mismatch

- **GIVEN** key = `"SAU-PRO-ABC123"` (6-char token, expected 12)
- **THEN** the function SHALL return `("", "Invalid key token length (expected 12 chars)")`

#### Scenario: Case-insensitive input

- **GIVEN** key = `"sau-pro-a3f8k2m9x7b1"` (all lowercase)
- **WHEN** `validate_license_key_format(key)` is called
- **THEN** the key SHALL be uppercased via `strip().upper()` before parsing
- **AND** the function SHALL return `("pro", None)`

### Requirement: License activation endpoint

The system SHALL provide `POST /api/license/activate` that accepts a license key, validates its format, checks that the key is not already bound to another user, and updates the user's `license_tier`, `license_key`, and `license_activated_at` columns. The key SHALL be stored in uppercase.

#### Scenario: Successful activation

- **GIVEN** an authenticated user (id=5) and a valid key `"SAU-PRO-A3F8K2M9X7B1"` not used by anyone else
- **WHEN** `POST /api/license/activate` with `{ "key": "SAU-PRO-A3F8K2M9X7B1" }`
- **THEN** the system SHALL update `users` set `license_tier='pro'`, `license_key='SAU-PRO-A3F8K2M9X7B1'`, `license_activated_at=<now>`
- **AND** SHALL return `{ success: true, data: { tier: "pro", activated_at: <now> } }` with HTTP 200

#### Scenario: Key already used by another user

- **GIVEN** user B (id=3) has `license_key='SAU-PRO-A3F8K2M9X7B1'`
- **WHEN** user A (id=5) calls `POST /api/license/activate` with the same key
- **THEN** the system SHALL return `{ success: false, message: "该 License Key 已被其他用户使用" }` with HTTP 409

#### Scenario: Same user re-activates own key

- **GIVEN** user A (id=5) already has `license_key='SAU-PRO-A3F8K2M9X7B1'`
- **WHEN** user A calls `POST /api/license/activate` with the same key
- **THEN** the system SHALL NOT return 409 (the `id != ?` clause excludes self)
- **AND** SHALL update the `license_activated_at` to the new timestamp

#### Scenario: Invalid format returns 422

- **WHEN** `POST /api/license/activate` with `{ "key": "INVALID-KEY" }`
- **THEN** the system SHALL return the format validation error message with HTTP 422

#### Scenario: Empty key returns 400

- **WHEN** `POST /api/license/activate` with `{ "key": "" }`
- **THEN** the system SHALL return `{ success: false, message: "License key is required" }` with HTTP 400

#### Scenario: Unauthenticated request

- **WHEN** `POST /api/license/activate` without a valid session (and auth is enabled)
- **THEN** the system SHALL return `{ success: false, message: "未登录" }` with HTTP 401

#### Scenario: Auth disabled returns in-memory result

- **GIVEN** `SAU_AUTH_ENABLED=false` AND `FLASK_DEBUG=1`
- **WHEN** `POST /api/license/activate` with a valid key
- **THEN** the system SHALL return `{ success: true, data: { tier, message: "Auth disabled — license applied in-memory only" } }`
- **AND** SHALL NOT write to the database

### Requirement: License status endpoint

The system SHALL provide `GET /api/license/status` that returns the current user's tier, masked key (first 7 chars + `"****"`), and activation timestamp. When no license is set, tier SHALL default to `"legacy"` and key SHALL be `null`.

#### Scenario: Active Pro license

- **GIVEN** user has `license_tier='pro'`, `license_key='SAU-PRO-A3F8K2M9X7B1'`, `license_activated_at='2026-06-25T19:00:00'`
- **WHEN** `GET /api/license/status`
- **THEN** the system SHALL return `{ success: true, data: { tier: "pro", key: "SAU-PRO****", activated_at: "2026-06-25T19:00:00" } }`

#### Scenario: No license set

- **GIVEN** user has `license_tier=NULL` and `license_key=NULL`
- **WHEN** `GET /api/license/status`
- **THEN** the system SHALL return `{ tier: "legacy", key: null, activated_at: null }`

#### Scenario: Key masking

- **GIVEN** user has `license_key='SAU-PRO-A3F8K2M9X7B1'` (19 chars)
- **WHEN** the status response masks the key
- **THEN** the masked key SHALL be `raw_key[:7] + "****"` = `"SAU-PRO****"`

#### Scenario: Short key not masked

- **GIVEN** user has `license_key='SAU-PRO'` (7 chars, len ≤ 8)
- **WHEN** the status response builds the masked key
- **THEN** the masked key SHALL be `null` (masking only applies when `len(raw_key) > 8`)

### Requirement: License deactivation endpoint

The system SHALL provide `POST /api/license/deactivate` that resets the user's `license_tier` to `'free'`, sets `license_key` to `NULL`, and sets `license_activated_at` to `NULL`. The deactivated key SHALL become available for re-activation by another user.

#### Scenario: Successful deactivation

- **GIVEN** user has `license_tier='pro'` and an active key
- **WHEN** `POST /api/license/deactivate`
- **THEN** the system SHALL set `license_tier='free'`, `license_key=NULL`, `license_activated_at=NULL`
- **AND** SHALL return `{ success: true, data: { tier: "free" } }`

#### Scenario: Deactivation makes key available

- **GIVEN** user A deactivates their key `"SAU-PRO-A3F8K2M9X7B1"`
- **WHEN** user B calls `POST /api/license/activate` with the same key
- **THEN** the activation SHALL succeed (no 409 conflict because the key is no longer bound)

### Requirement: Admin key generation endpoint

The system SHALL provide `POST /api/license/generate` (admin only) that generates license keys in `SAU-{TIER}-{TOKEN}` format. Keys SHALL be generated using `secrets.choice()` from uppercase letters + digits. Keys SHALL NOT be pre-stored in the database — they are validated on activation by format check + uniqueness. The `count` parameter SHALL be clamped to a maximum of 100.

#### Scenario: Generate single key

- **WHEN** `POST /api/license/generate` with `{ "tier": "pro", "count": 1 }` and an admin session
- **THEN** the system SHALL return `{ success: true, data: { keys: ["SAU-PRO-<12-char-token>"], tier: "pro" } }`

#### Scenario: Generate batch of keys

- **WHEN** `POST /api/license/generate` with `{ "count": 10 }`
- **THEN** the system SHALL return 10 unique keys
- **AND** the `count` SHALL be clamped to `min(count, 100)`

#### Scenario: Non-admin rejected

- **GIVEN** a user with `role='user'`
- **WHEN** `POST /api/license/generate`
- **THEN** the system SHALL return `{ success: false, message: "Admin access required" }` with HTTP 403

#### Scenario: Unsupported tier rejected

- **WHEN** `POST /api/license/generate` with `{ "tier": "enterprise" }`
- **THEN** the system SHALL return `{ success: false, message: "Cannot generate keys for tier: enterprise" }` with HTTP 400

#### Scenario: Keys not stored in database

- **WHEN** keys are generated
- **THEN** no rows SHALL be inserted into any license table
- **AND** the keys SHALL be valid for future activation via format check + DB uniqueness

### Requirement: Database columns for license management

The system SHALL add three columns to the `users` table via idempotent `ALTER TABLE IF NOT EXISTS`: `license_tier` (TEXT DEFAULT 'legacy'), `license_key` (TEXT, nullable), and `license_activated_at` (TIMESTAMP, nullable). The `license_tier` column SHALL default to `'legacy'` for pre-existing users.

#### Scenario: Idempotent column addition

- **WHEN** `init_db()` runs on a database where `license_tier` already exists
- **THEN** the `ALTER TABLE IF NOT EXISTS` SHALL be a no-op

#### Scenario: Pre-existing users get legacy tier

- **GIVEN** users exist before the license system migration
- **WHEN** the `ALTER TABLE` adds `license_tier TEXT DEFAULT 'legacy'`
- **THEN** all pre-existing users SHALL have `license_tier='legacy'`

#### Scenario: Tier values

- **THEN** `license_tier` SHALL be one of `'free'`, `'pro'`, or `'legacy'`
- **AND** `'legacy'` SHALL be the default for users who never activated a license
- **AND** `'free'` SHALL be set on deactivation
- **AND** `'pro'` SHALL be set on successful Pro key activation

### Requirement: Usage metering tier enforcement

The `web_runner/middleware/usage_metering.py` SHALL read `license_tier` from the `users` table to determine the user's tier for quota enforcement. Pro/Studio tier users SHALL be exempt from per-vendor monthly quotas. Free/legacy tier users SHALL be subject to quota limits.

#### Scenario: Tier lookup for quota

- **WHEN** the usage metering middleware needs the user's tier
- **THEN** it SHALL query `SELECT license_tier FROM users WHERE id = ?`
- **AND** if the result is non-empty, SHALL return the `license_tier` value

#### Scenario: Legacy tier treated as free

- **GIVEN** a user with `license_tier='legacy'` or `license_tier=NULL`
- **WHEN** the usage metering middleware resolves the tier
- **THEN** the user SHALL be subject to free-tier quota limits
