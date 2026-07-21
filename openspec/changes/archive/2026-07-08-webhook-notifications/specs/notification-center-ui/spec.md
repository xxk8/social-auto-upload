## ADDED Requirements

### Requirement: Notification Center Entry and Badge
The Web Shell MUST expose a "通知中心" entry in the sidebar with an unread-count badge.

#### Scenario: Sidebar entry
- **WHEN** a logged-in user opens the Web Shell
- **THEN** the sidebar shows a "通知中心" item routing to `/app/notifications`
- **AND** a badge displays the unread count from `GET /api/notifications/unread`

#### Scenario: Unread badge on browser tab
- **WHEN** unread notifications exist
- **THEN** the document title reflects the unread count (e.g. `(3) …`), reusing the existing unread-indication pattern

### Requirement: Notification List with Filtering and Read State
The notification center page MUST list notifications newest-first with type filters and read controls.

#### Scenario: List rendering
- **WHEN** the user opens `/app/notifications`
- **THEN** the page lists notifications in reverse-chronological order
- **AND** each row shows event-type icon, platform, account, title, timestamp, and status

#### Scenario: Type filtering
- **WHEN** the user selects a filter (全部 / 未读 / 上传成功 / 上传失败 / 系统通知)
- **THEN** the list shows only matching notifications via `GET /api/notifications?type=…`

#### Scenario: Batch mark-read and clear
- **WHEN** the user clicks "标记已读" or "清空"
- **THEN** the system calls `POST /api/notifications/mark-read` for the selected/all unread items
- **AND** the unread badge decrements accordingly

### Requirement: Real-time Push via Reused SSE
The notification center MUST receive new notifications in real time by reusing the existing SSE infrastructure, not a new SSE server.

#### Scenario: Subscribe to notification SSE
- **WHEN** the notification center mounts
- **THEN** it opens an SSE connection authenticated via `web_runner/routes/auth.py:authenticate_sse_request()` (web_runner/routes/auth.py:85), reusing the same generator/subscriber pattern as `web_runner/routes/upload.py:274` (`upload_progress_sse`)
- **AND** respects `_SSE_TIMEOUT_SECONDS` (web_runner/utils.py:44) and the shared 5-connection cap (`_MAX_SSE_CONNECTIONS`, web_runner/utils.py:43)

#### Scenario: New notification appears live
- **WHEN** a new notification row is inserted
- **THEN** the SSE subscriber receives an `event: notification` push
- **AND** the list prepends the item and the unread badge increments without a manual refresh
