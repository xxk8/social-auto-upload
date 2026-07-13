# web-shell Specification

## Purpose

Defines the contract for the Web Shell — a minimal visualization interface covering account management, video/note publishing, task tracking, run logs, and AI content generation. The frontend is a single React + Vite app (default port 5180); the backend is a Flask shell (port 6001) that wraps existing CLI capabilities without modifying core uploader logic. Originally added by change `add-web-visualization-shell`, subsequently extended with auth, idempotency, health monitoring, and task persistence.

## Requirements

### Requirement: Unified Vite frontend with dual surfaces

The system SHALL serve a single React + Vite application at `http://localhost:5180` that simultaneously hosts the public marketing landing page at `/` (no login required) and the auth-gated Web Shell dashboard at `/dashboard/*` (email verification code login required).

#### Scenario: Public landing page

- **WHEN** a visitor navigates to `http://localhost:5180/`
- **THEN** the marketing landing page SHALL render without requiring authentication
- **AND** the page SHALL NOT call any `/api/*` endpoint on load

#### Scenario: Dashboard requires auth

- **WHEN** an unauthenticated visitor navigates to `/dashboard/*`
- **THEN** the AuthGuard SHALL redirect to `/login/auth`

#### Scenario: One-command startup

- **WHEN** `bash sau_web/start.sh` is executed
- **THEN** both the Vite frontend (port 5180) and Flask backend (port 6001) SHALL start
- **AND** the Vite dev proxy SHALL forward `/api/*` requests to the Flask backend

### Requirement: Account management API

The system SHALL provide REST endpoints for listing saved accounts, triggering logins, checking cookie validity, and deleting accounts.

#### Scenario: List accounts

- **WHEN** `GET /api/accounts` with a valid session
- **THEN** the system SHALL return `{ success: true, data: [{ platform, account, ... }] }` with HTTP 200

#### Scenario: Trigger account login

- **WHEN** `POST /api/accounts/login` with `{ platform, account, headless }` and a valid session
- **THEN** the system SHALL return `{ success, message, account_file }` with HTTP 200

#### Scenario: Check single account cookie

- **WHEN** `POST /api/accounts/check` with `{ platform, account }` and a valid session
- **THEN** the system SHALL return `{ success, valid, message }` with HTTP 200

#### Scenario: Check all accounts

- **WHEN** `POST /api/accounts/check-all` with a valid session
- **THEN** the system SHALL check all saved accounts and return aggregated results with HTTP 200

#### Scenario: Delete account

- **WHEN** `POST /api/accounts/delete` with `{ platform, account }` and a valid session
- **THEN** the system SHALL remove the account cookie file and return `{ success: true }` with HTTP 200

### Requirement: Upload endpoints use 202 Accepted + Location semantics

`POST /api/upload/video` and `POST /api/upload/note` SHALL return HTTP 202 Accepted with a `Location` header pointing to the task status URL and a `Retry-After` header. The task SHALL be enqueued before the response is returned, so closing the browser tab after the 202 response SHALL NOT lose the task.

#### Scenario: Video upload accepted

- **WHEN** `POST /api/upload/video` with multipart form data (platform, account, file, title, tags, etc.) and a valid session
- **THEN** the system SHALL return 202 with `Location: /api/tasks?task_id=<id>` and `Retry-After: 2`
- **AND** the response body SHALL contain `{ success: true, data: { task_id, status: "pending" } }`

#### Scenario: Note upload accepted

- **WHEN** `POST /api/upload/note` with JSON data URI or multipart files and a valid session
- **THEN** the system SHALL return 202 with `Location: /api/tasks?task_id=<id>` and `Retry-After: 2`

#### Scenario: Task survives backend restart

- **GIVEN** a task with `status='pending'` was enqueued but not yet executed
- **WHEN** the Flask backend restarts
- **THEN** `PlatformExecutor.load_pending_tasks()` SHALL re-enqueue all `status IN ('pending', 'scheduled')` tasks with `scheduled_at IS NULL OR scheduled_at <= now()`
- **AND** the re-enqueued tasks SHALL have `PRIORITY_NORMAL` (not `PRIORITY_RETRY`)

### Requirement: Task management endpoints

The system SHALL provide endpoints for listing tasks, manually adding tasks, retrying failed tasks, rescheduling, and copying tasks.

#### Scenario: List tasks

- **WHEN** `GET /api/tasks` with a valid session
- **THEN** the system SHALL return `{ success: true, data: [{ task_id, status, ... }] }` with HTTP 200
- **AND** the endpoint SHALL support `?task_id=X` for single-task queries

#### Scenario: Retry failed task

- **WHEN** `POST /api/tasks/retry` with `{ task_id }` and a valid session
- **THEN** the system SHALL return 202 with `Location` and `Retry-After` headers

#### Scenario: Reschedule task

- **WHEN** `POST /api/tasks/reschedule` with `{ task_id, scheduled_at }` and a valid session
- **THEN** the system SHALL return 202 with the new `scheduled_at` in the response body

#### Scenario: Copy task

- **WHEN** `POST /api/tasks/copy` with `{ task_id, scheduled_at }` and a valid session
- **THEN** the system SHALL return 202 with the new task's `scheduled_at` in the response body

#### Scenario: Manually add task

- **WHEN** `POST /api/tasks/add` with task details (platform, account, file, title, tags, etc.) and a valid session
- **THEN** the system SHALL return 202 with `Location` and `Retry-After` headers
- **AND** the response body SHALL contain `{ success: true, data: { task_id, status: "pending" } }`

### Requirement: Run logs endpoint

The system SHALL provide a logs endpoint that returns task execution logs with optional filtering.

#### Scenario: Fetch logs

- **WHEN** `GET /api/logs` with a valid session
- **THEN** the system SHALL return `{ success: true, data: [{ ... }] }` with HTTP 200

#### Scenario: Filter logs by task

- **WHEN** `GET /api/logs?task_id=<id>` with a valid session
- **THEN** the system SHALL return only logs associated with the specified task

#### Scenario: Cursor-based pagination

- **WHEN** `GET /api/logs?after=<cursor>` with a valid session
- **THEN** the system SHALL return logs created after the specified cursor

### Requirement: Idempotency-Key protocol for task-generating routes

The 6 task-generating routes (`/api/upload/video`, `/api/upload/note`, `/api/tasks/add`, `/api/tasks/retry`, `/api/tasks/reschedule`, `/api/tasks/copy`) SHALL support an optional `Idempotency-Key` header to prevent duplicate task creation on retry.

#### Scenario: No key header passes through

- **WHEN** a request is sent without an `Idempotency-Key` header
- **THEN** the system SHALL process the request normally (202 + standard response)
- **AND** the system SHALL NOT enter the claim/lookup path

#### Scenario: First submission with key

- **WHEN** `POST /api/upload/video` with `Idempotency-Key: <uuid>` and valid form data
- **THEN** the system SHALL return 202 + `Location` + `Retry-After` (normal first-submission response)
- **AND** the system SHALL store the key with `state='processing'` and the payload hash

#### Scenario: Replay with same key and same payload

- **WHEN** the same `Idempotency-Key` is sent with the same payload (same form fields, same file metadata)
- **THEN** the system SHALL return 202 with `Idempotency-Replayed: true` header
- **AND** the response SHALL contain the same `task_id` and `Location` as the first submission
- **AND** no second task row SHALL be inserted in the database

#### Scenario: Concurrent retry with same key

- **GIVEN** a request with `Idempotency-Key: <uuid>` is still being processed (`state='processing'`)
- **WHEN** a second request arrives with the same key and matching payload
- **THEN** the system SHALL return 409 Conflict with `Retry-After: 5`
- **AND** the `Idempotency-Replayed` header SHALL NOT appear

#### Scenario: Key reused with different payload

- **GIVEN** a completed request with `Idempotency-Key: <uuid>` and payload hash H1
- **WHEN** a new request arrives with the same key but a different payload (hash H2 ≠ H1)
- **THEN** the system SHALL return 422 Unprocessable Entity

#### Scenario: 5xx releases key for retry

- **WHEN** a request with an `Idempotency-Key` results in a 5xx response
- **THEN** the system SHALL call `release()` (not `complete()`) on the key
- **AND** the next retry with the same key SHALL be able to re-execute the side effects

#### Scenario: Expired keys are cleaned up

- **GIVEN** idempotency key rows with `expires_at < now()` (older than 7 days)
- **WHEN** the janitor sweep runs (alongside `_cleanup_old_uploads`)
- **THEN** the system SHALL delete all expired rows from the `idempotency_keys` table

### Requirement: Frontend Idempotency-Key injection

The frontend `sau_web/frontend/src/api/_idempotencyStore.ts` SHALL automatically inject an `Idempotency-Key` header for the 6 task-generating POST requests.

#### Scenario: Automatic key generation

- **WHEN** the frontend sends one of the 6 task-generating POST requests
- **THEN** the interceptor SHALL read or generate a UUID keyed by `(user_id, route)` from `localStorage`
- **AND** the key SHALL persist across tab closures (stored in `localStorage`, not `sessionStorage`)

#### Scenario: Key cleared on success

- **WHEN** a task-generating request receives a 2xx response
- **THEN** the `localStorage` entry for that `(user_id, route)` SHALL be cleared
- **AND** the next submission SHALL generate a new UUID

### Requirement: Health check endpoint

The system SHALL provide a liveness probe endpoint.

#### Scenario: Health check

- **WHEN** `GET /health` is called (with or without authentication)
- **THEN** the system SHALL return `{ success: true }` with HTTP 200

### Requirement: Supported platforms

The system SHALL support the following platforms for publishing: `douyin`, `kuaishou`, `xiaohongshu`, `bilibili`, `tencent`, `baijiahao`, `tiktok`, and `youtube`. Platform configuration SHALL be managed via a single `PLATFORM_CONFIG` dictionary, not hardcoded platform sets.

#### Scenario: Platform list from config

- **WHEN** the frontend requests available platforms
- **THEN** the system SHALL return the platform list derived from `PLATFORM_CONFIG`
- **AND** adding a new platform SHALL require only a `PLATFORM_CONFIG` entry (no hardcoded set updates)

### Requirement: Account health monitoring

The system SHALL monitor account cookie health via a background daemon thread that runs quick checks (file-level) every 6 hours and real browser checks every 24 hours per account.

#### Scenario: Health status query

- **WHEN** `GET /api/account-authorizations/<id>/health` with a valid session
- **THEN** the system SHALL return `{ health, last_check_at, last_real_check_at, consecutive_failures, next_check_at }` with HTTP 200

#### Scenario: Manual health check trigger

- **WHEN** `POST /api/account-authorizations/<id>/health-check` with a valid session
- **THEN** the system SHALL return 202 Accepted (background thread executes the real browser check)
- **AND** the frontend SHALL poll the health endpoint to see updated status

#### Scenario: Health status values

- **GIVEN** an account authorization exists
- **THEN** its health SHALL be one of: `valid` (green), `expiring_soon` (yellow), `invalid` (red), `unknown` (gray)
- **AND** `valid` SHALL require both a valid cookie file AND a recent successful real browser check
- **AND** `expiring_soon` SHALL be set when the cookie file is older than 24 hours OR the last real check is older than 7 days

#### Scenario: Health degradation notification

- **WHEN** an account's health transitions from `valid` to `expiring_soon` or `invalid`
- **THEN** the system SHALL trigger a `cookie.expiring_soon` or `cookie.expired` event via the notification worker
- **AND** the system SHALL send an alert email to the account group owner (24-hour rate limit per account)
- **AND** notification channels (email/webhook) SHALL respect the owner's `notify_health_email` / `notify_health_webhook` preferences

### Requirement: Frontend page routes

The frontend SHALL provide the following page routes: `/` (public landing), `/app` (AuthGuard, account management), `/dashboard/publish` (AuthGuard, publish center), `/dashboard/tasks` (AuthGuard, task list), `/dashboard/logs` (AuthGuard, run logs), `/dashboard/analytics` (AuthGuard, analytics), `/dashboard/calendar` (AuthGuard, content calendar), `/dashboard/inbox` (AuthGuard, download center), `/dashboard/studio` (AuthGuard, script studio), `/catalog` (public, component catalog).

#### Scenario: Legacy `/app/*` redirect

- **WHEN** a visitor navigates to `/app/*` (legacy path)
- **THEN** the system SHALL redirect to `/dashboard/<subpath>` preserving query and hash

#### Scenario: Route constants are centralized

- **WHEN** a developer needs to reference a route path in code
- **THEN** the route SHALL be imported from `sau_web/frontend/src/routes.ts` (single source of truth)
- **AND** hardcoded route string literals in components SHALL be avoided

### Requirement: Log retention and upload cleanup

The system SHALL automatically clean up old logs and stale upload files to prevent unbounded storage growth.

#### Scenario: Old log cleanup

- **GIVEN** the `logs` table contains more than 2000 rows
- **WHEN** the cleanup sweep runs
- **THEN** the system SHALL delete the oldest log rows, keeping the most recent 2000

#### Scenario: Stale upload file cleanup

- **GIVEN** partial or orphaned upload files exist in `.sau_uploads/`
- **WHEN** `_cleanup_old_uploads()` runs (every 24 hours)
- **THEN** the system SHALL delete files older than 24 hours from `.sau_uploads/`

### Requirement: Single-user desktop deployment model

The Web Shell is designed for a single-user desktop scenario. It does not include RBAC beyond a basic admin/user role distinction. Tasks execute serially via a `PlatformExecutor` priority queue.

#### Scenario: Serial task execution

- **WHEN** multiple tasks are submitted simultaneously
- **THEN** the `PlatformExecutor` SHALL execute them in priority order (not truly parallel)
- **AND** `PRIORITY_RETRY` tasks SHALL preempt `PRIORITY_NORMAL` tasks

#### Scenario: No multi-instance locking

- **GIVEN** the architecture is single-process with a PG-backed task table
- **WHEN** multiple backend instances start simultaneously
- **THEN** unguarded pending tasks MAY be enqueued by both instances (no distributed lock is provided)
