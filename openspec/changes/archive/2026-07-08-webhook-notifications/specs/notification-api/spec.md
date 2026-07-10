## ADDED Requirements

### Requirement: Notification List and Unread Count
The system MUST provide read APIs for the in-app notification center over the `notifications` table (web_runner/db.py, dialect-agnostic via `fetch_all` / `insert_returning_id`).

#### Scenario: List notifications with pagination and filter
- **WHEN** a client calls `GET /api/notifications?type=<type>&page=<n>&page_size=<m>`
- **THEN** the system returns paginated notifications ordered by `created_at` DESC
- **AND** when `type` is provided, filters by `event_type` category (upload.success / upload.failed / system.webhook_failed)

#### Scenario: Unread count
- **WHEN** a client calls `GET /api/notifications/unread`
- **THEN** the system returns the count of rows where `delivered` is not the read marker (i.e. `final_failed` or external `delivered` notifications that are unread) — using the `idx_notifications_unread` index

#### Scenario: Mark read
- **WHEN** a client calls `POST /api/notifications/mark-read` with a list of ids (or "all")
- **THEN** the system marks those rows as read and returns the remaining unread count

### Requirement: Webhook Connectivity Test
The system MUST let operators verify a webhook before relying on it.

#### Scenario: Test webhook
- **WHEN** a client calls `POST /api/webhooks/test` with a target URL + optional secret
- **THEN** the system sends a ping payload through the matching adapter (Feishu/DingTalk/WeWork/custom)
- **AND** returns success/failure with the platform's response code (not the raw secret)

### Requirement: Auth on Notification APIs
All `/api/notifications/*` and `/api/webhooks/*` endpoints MUST follow the existing auth gate (`web_runner/routes/auth.py`), consistent with other `web_runner/routes/*` endpoints.

#### Scenario: Unauthenticated request rejected
- **WHEN** an unauthenticated request hits any notification/webhook endpoint and `SAU_AUTH_ENABLED=true`
- **THEN** the system returns 401, matching the pattern in `web_runner/routes/upload.py:250`
