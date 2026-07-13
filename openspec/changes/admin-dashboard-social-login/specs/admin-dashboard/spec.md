## ADDED Requirements

### Requirement: Admin route structure and access control

The system SHALL provide admin dashboard pages at `/dashboard/admin` (overview), `/dashboard/admin/users` (user management), and `/dashboard/admin/audit` (operation logs). All admin pages SHALL be protected by AuthGuard and the backend `@admin_required` decorator, which rejects unauthenticated requests with HTTP 401 and non-admin users with HTTP 403.

#### Scenario: Admin accesses overview page

- **WHEN** an admin user navigates to `/dashboard/admin`
- **THEN** the AdminOverviewPage SHALL render with system statistics

#### Scenario: Non-admin user blocked

- **WHEN** a user with `role='user'` calls `GET /api/admin/overview`
- **THEN** the system SHALL return `{ success: false, message: "权限不足" }` with HTTP 403

#### Scenario: Unauthenticated request blocked

- **WHEN** an unauthenticated request is made to any `/api/admin/*` endpoint
- **THEN** the system SHALL return `{ success: false, message: "未登录" }` with HTTP 401

#### Scenario: Auth disabled in development

- **GIVEN** `SAU_AUTH_ENABLED=false` AND `FLASK_DEBUG=1`
- **WHEN** any `/api/admin/*` endpoint is called without a session
- **THEN** the `@admin_required` decorator SHALL allow the request through

### Requirement: List users with tier info

The system SHALL provide `GET /api/admin/users` that returns all users ordered by `id`, including `id`, `email`, `role`, `tier` (derived from `COALESCE(license_tier, 'legacy')`), `created_at`, and `last_login`.

#### Scenario: Successful user list

- **WHEN** `GET /api/admin/users` with an admin session
- **THEN** the system SHALL return `{ success: true, data: [{ id, email, role, tier, created_at, last_login }] }` with HTTP 200
- **AND** the data array SHALL be ordered by `id` ascending

#### Scenario: Tier fallback for legacy users

- **GIVEN** a user with `license_tier = NULL`
- **WHEN** the user list is returned
- **THEN** that user's `tier` field SHALL be `"legacy"`

### Requirement: Change user role with audit logging

The system SHALL provide `PUT /api/admin/users/<id>/role` that changes a user's role. The system SHALL prevent self-demotion (an admin cannot downgrade their own role). The system SHALL write an audit log entry to `admin_audit_log` on successful role change. Audit-log failure SHALL NOT cause the endpoint to return an error.

#### Scenario: Successful role change

- **GIVEN** an admin (id=1) and a target user (id=2, role='user')
- **WHEN** `PUT /api/admin/users/2/role` with `{ "role": "admin" }` and an admin session
- **THEN** the system SHALL update the user's role to `admin`
- **AND** SHALL insert an `admin_audit_log` row with `action='role_change'`, `detail={"old_role":"user","new_role":"admin"}`
- **AND** SHALL return `{ success: true, data: { id, role, email } }` with HTTP 200

#### Scenario: Self-demotion prevented

- **GIVEN** an admin (id=1) with `role='admin'`
- **WHEN** `PUT /api/admin/users/1/role` with `{ "role": "user" }` and the same admin's session
- **THEN** the system SHALL return `{ success: false, message: "不能修改自己的角色" }` with HTTP 403

#### Scenario: Invalid role value

- **WHEN** `PUT /api/admin/users/2/role` with `{ "role": "superadmin" }`
- **THEN** the system SHALL return `{ success: false, message: "role 必须是 admin 或 user" }` with HTTP 400

#### Scenario: Target user not found

- **WHEN** `PUT /api/admin/users/99999/role` with `{ "role": "admin" }`
- **THEN** the system SHALL return `{ success: false, message: "用户不存在" }` with HTTP 404

#### Scenario: Same role no-op

- **GIVEN** a target user with `role='admin'`
- **WHEN** `PUT /api/admin/users/2/role` with `{ "role": "admin" }`
- **THEN** the system SHALL return `{ success: false, message: "新角色与当前角色相同" }` with HTTP 400

#### Scenario: Audit log failure does not block role change

- **GIVEN** the `admin_audit_log` INSERT fails (e.g., locked DB, FK constraint)
- **WHEN** the role change has already been committed
- **THEN** the system SHALL log a warning and still return HTTP 200 with the updated role

### Requirement: List audit logs with pagination and date filtering

The system SHALL provide `GET /api/admin/audit` that returns audit log entries with pagination and optional date range filtering. The `per_page` parameter SHALL be clamped to 1..100. Each log entry SHALL include joined `admin_email` and `target_email` from the `users` table.

#### Scenario: Successful audit log listing

- **WHEN** `GET /api/admin/audit?page=1&per_page=50` with an admin session
- **THEN** the system SHALL return `{ success: true, data: { logs, total, page, per_page } }` with HTTP 200
- **AND** the logs SHALL be ordered by `created_at DESC`
- **AND** each log SHALL include `admin_email` and `target_email`

#### Scenario: Date range filtering

- **WHEN** `GET /api/admin/audit?start_date=2026-07-05T00:00:00&end_date=2026-07-10T23:59:59`
- **THEN** the system SHALL return only logs with `created_at` within the inclusive range

#### Scenario: Per-page clamped

- **WHEN** `GET /api/admin/audit?per_page=500`
- **THEN** the system SHALL clamp `per_page` to 100 and return at most 100 rows

### Requirement: Unacknowledged audit count and acknowledgement

The system SHALL provide `GET /api/admin/audit/unacknowledged-count` that returns the number of unacknowledged audit log entries, and `POST /api/admin/audit/acknowledge` that marks all unacknowledged entries as acknowledged.

#### Scenario: Get unacknowledged count

- **WHEN** `GET /api/admin/audit/unacknowledged-count` with an admin session
- **THEN** the system SHALL return `{ success: true, data: { count: N } }` with HTTP 200

#### Scenario: Acknowledge all

- **WHEN** `POST /api/admin/audit/acknowledge` with an admin session
- **THEN** the system SHALL set `acknowledged=1` on all rows where `acknowledged=0`
- **AND** SHALL return `{ success: true, data: { updated: N } }` with HTTP 200

### Requirement: System overview statistics

The system SHALL provide `GET /api/admin/overview` that returns `total_users`, `active_today` (distinct users with usage logs today), `total_tasks`, `task_success_rate` (percentage rounded to 1 decimal), and the 10 most recent user actions. The endpoint SHALL support optional `start_date` / `end_date` filtering on `recent_actions`.

#### Scenario: Successful overview

- **WHEN** `GET /api/admin/overview` with an admin session
- **THEN** the system SHALL return `{ success: true, data: { total_users, active_today, total_tasks, task_success_rate, recent_actions } }` with HTTP 200

#### Scenario: Empty database

- **GIVEN** no users, no tasks, no usage logs
- **WHEN** `GET /api/admin/overview`
- **THEN** `total_users` SHALL be 0, `active_today` SHALL be 0, `total_tasks` SHALL be 0, `task_success_rate` SHALL be 0.0, and `recent_actions` SHALL be an empty array

#### Scenario: Task success rate calculation

- **GIVEN** 100 tasks total, 94 with `status='success'`
- **WHEN** `GET /api/admin/overview`
- **THEN** `task_success_rate` SHALL be 94.0

### Requirement: System status breakdown

The system SHALL provide `GET /api/admin/system` that returns task counts grouped by status, task counts grouped by platform, and the top 10 error types grouped by `exc_type` from the `error_events` table.

#### Scenario: Successful system status

- **WHEN** `GET /api/admin/system` with an admin session
- **THEN** the system SHALL return `{ success: true, data: { tasks_by_status, tasks_by_platform, errors_by_type } }` with HTTP 200
- **AND** `errors_by_type` SHALL be ordered by count descending, limited to 10

### Requirement: Trend series with 0-filled points

The system SHALL provide `GET /api/admin/trends` that returns an N-day value series for a given metric. Allowed metrics SHALL be `total_users`, `active_today`, `total_tasks`, and `task_success_rate`. The `days` parameter SHALL be clamped to 1..90 (default 14). The `points` array SHALL always have exactly `days` elements, oldest first, with 0-filled values for days with no source rows.

#### Scenario: Valid metric request

- **WHEN** `GET /api/admin/trends?metric=total_users&days=14` with an admin session
- **THEN** the system SHALL return `{ success: true, data: { metric, days, points } }` with HTTP 200
- **AND** `points` SHALL have exactly 14 elements, oldest first

#### Scenario: Invalid metric rejected

- **WHEN** `GET /api/admin/trends?metric=invalid_metric`
- **THEN** the system SHALL return `{ success: false, message: "metric 必须是以下之一: ..." }` with HTTP 400

#### Scenario: Days clamped

- **WHEN** `GET /api/admin/trends?metric=total_users&days=999`
- **THEN** the system SHALL silently clamp `days` to 90 and return a 90-element `points` array

#### Scenario: Task success rate uses 7-day rolling window

- **GIVEN** the last 14 days of task data
- **WHEN** `GET /api/admin/trends?metric=task_success_rate&days=14`
- **THEN** each point SHALL be the success rate over a 7-day rolling window ending at that day
- **AND** days with zero tasks in the window SHALL produce 0.0 (not NaN)

### Requirement: CSV export of trend series

The system SHALL provide `GET /api/admin/trends/export` that streams a CSV file with a UTF-8 BOM prefix for Excel-CN compatibility. When `metric` is omitted, the CSV SHALL contain all 4 metrics in 5 columns (date + 4 values). When `metric` is provided, the CSV SHALL be 2 columns (date, value). The system SHALL write an `export_trends` audit log entry before streaming begins.

#### Scenario: Export all metrics

- **WHEN** `GET /api/admin/trends/export?days=14` with an admin session
- **THEN** the system SHALL return `Content-Type: text/csv` with `Content-Disposition: attachment`
- **AND** the CSV SHALL start with a UTF-8 BOM (`\ufeff`)
- **AND** the header row SHALL be `date,total_users,active_today,total_tasks,task_success_rate`
- **AND** an `export_trends` audit log row SHALL be inserted before the stream begins

#### Scenario: Export single metric

- **WHEN** `GET /api/admin/trends/export?metric=total_users&days=14`
- **THEN** the CSV header SHALL be `date,value`

#### Scenario: Export with invalid metric

- **WHEN** `GET /api/admin/trends/export?metric=invalid`
- **THEN** the system SHALL return 400 with an error message

#### Scenario: Audit log failure does not block export

- **GIVEN** the `admin_audit_log` INSERT fails during export
- **WHEN** the CSV stream is being generated
- **THEN** the system SHALL log a warning and still serve the CSV file

### Requirement: admin_audit_log table schema

The system SHALL create an `admin_audit_log` table with columns `id` (serial primary key), `admin_user_id` (NOT NULL, FK to `users.id`), `target_user_id` (nullable, FK to `users.id`), `action` (TEXT NOT NULL), `detail` (TEXT), `created_at` (TEXT NOT NULL), and `acknowledged` (INTEGER NOT NULL DEFAULT 0). Two indexes SHALL be created: `idx_admin_audit_created` on `created_at` and `idx_admin_audit_admin` on `admin_user_id`.

#### Scenario: Table creation is idempotent

- **WHEN** `init_db()` runs on a database where `admin_audit_log` already exists
- **THEN** the `CREATE TABLE IF NOT EXISTS` SHALL be a no-op
- **AND** the two `CREATE INDEX IF NOT EXISTS` statements SHALL be no-ops

#### Scenario: Role change audit entry

- **WHEN** an admin changes a user's role from `user` to `admin`
- **THEN** an `admin_audit_log` row SHALL be inserted with `action='role_change'` and `detail` containing `{"old_role":"user","new_role":"admin"}`

#### Scenario: Export audit entry with NULL target

- **WHEN** an admin exports trend CSV
- **THEN** an `admin_audit_log` row SHALL be inserted with `target_user_id=NULL` and `action='export_trends'`

### Requirement: Frontend admin API client

The frontend `sau_web/frontend/src/features/admin/adminApi.ts` SHALL provide typed API methods for all admin endpoints: `getUsers`, `updateUserRole`, `getAuditLogs`, `getOverview`, `getSystem`, `getTrends`, `exportTrendsCsv`, `getUnacknowledgedAuditCount`, `acknowledgeAuditLogs`, and `transferFounder`.

#### Scenario: Get users returns typed AdminUser array

- **WHEN** `adminApi.getUsers()` is called
- **THEN** the method SHALL return `Promise<{ success: boolean; data?: AdminUser[] }>`
- **AND** each `AdminUser` SHALL include `is_founder` (optional, defaults to `false` for legacy callers)

#### Scenario: Export trends returns Blob

- **WHEN** `adminApi.exportTrendsCsv(14)` is called
- **THEN** the method SHALL return `Promise<Blob>` ready for `URL.createObjectURL` + anchor-click download

#### Scenario: Audit logs with time range preset

- **WHEN** `adminApi.getAuditLogs(1, 50, 'week')` is called
- **THEN** the method SHALL compute the current week's Monday–Sunday UTC date range and pass it as `start_date` / `end_date` query params
