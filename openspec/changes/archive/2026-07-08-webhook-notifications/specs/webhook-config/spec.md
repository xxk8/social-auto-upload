## ADDED Requirements

### Requirement: Configuration Source and Precedence
Webhook configuration MUST support both `.env` baseline values and DB-stored, per-platform/per-account routing rows, with DB overriding `.env`.

#### Scenario: .env baseline keys
- **WHEN** the system starts
- **THEN** it reads baseline webhook config from `.env` (web_runner/.env or process env) using keys: `SAU_WEBHOOK_URL`, `SAU_FEISHU_WEBHOOK_URL`, `SAU_FEISHU_WEBHOOK_SECRET`, `SAU_DINGTALK_WEBHOOK_URL`, `SAU_DINGTALK_WEBHOOK_SECRET`, `SAU_WEWORK_WEBHOOK_URL`, `SAU_WEBHOOK_AGG_WINDOW`
- **AND** these keys are documented in `.env.example` (precedent: `SAU_KILL_CRITERIA_WEBHOOK` at .env.example:130)

#### Scenario: DB config overrides env
- **WHEN** a `webhooks_config` DB row exists for a given platform/account
- **THEN** the system uses the DB row instead of the `.env` baseline for that route
- **AND** the resolution order is `.env` default → DB non-null field override

#### Scenario: Secret masking on read
- **WHEN** a client calls `GET /api/webhooks/config`
- **THEN** the system returns secrets masked to the last 4 characters (e.g. `****1234`)
- **AND** never returns the full secret or full URL credential

### Requirement: Webhook Config Persistence
The system MUST persist webhook routing config in the `webhooks_config` table (created in `web_runner/db.py:init_db()`, dialect-agnostic).

#### Scenario: Update config via API
- **WHEN** a client calls `PUT /api/webhooks/config` with routing rows (`platform?`, `account?`, `url`, `secret`, `enabled`)
- **THEN** the system upserts the rows via `web_runner/db.py:insert_returning_id` / update
- **AND** does not modify `.env` (DB is the source of truth for page-edited config)

#### Scenario: Config stored as routing array
- **WHEN** multiple platforms/accounts need different webhooks
- **THEN** `webhooks_config` stores one row per route, enabling `account+platform` > `platform` > global matching (see webhook-dispatch routing scenario)
