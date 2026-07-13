# frontend-polish Specification

## Purpose
TBD - created by archiving changes that modified frontend-polish. Update Purpose after archive.
## Requirements
### Requirement: Dead code SHALL be removed from frontend
The following unused components, hooks, and exports SHALL be deleted: `useAccounts` hook, `PLATFORMS_WITH_ICONS` export, `PageTransition` component, standalone `PageLoading.tsx`, `Spinner` component, `message` API in `toast.tsx`, `uploadNote` JSON function.

#### Scenario: No dead imports in production bundle
- **WHEN** the dead code is removed
- **THEN** no existing page or component SHALL break, verified by building the frontend

### Requirement: ProposalsPage SHALL use shared API client
`ProposalsPage` SHALL import the API call from `src/api/client.ts` instead of using raw `axios`.

#### Scenario: ProposalsPage fetches via shared client
- **WHEN** ProposalsPage loads
- **THEN** it SHALL use the shared `api` instance with configured `baseURL`

### Requirement: Double ToastProvider SHALL be fixed
The duplicate `ToastProvider` wrapping in `ThemeProvider` and `App.tsx` SHALL be resolved. Only one `ToastProvider` SHALL wrap the application.

#### Scenario: Toast notifications work correctly
- **WHEN** a user triggers a toast notification
- **THEN** exactly one toast SHALL appear, not duplicated

### Requirement: PublishPage SHALL support drag-and-drop upload
The video and image upload areas SHALL implement `onDragOver`, `onDragLeave`, and `onDrop` handlers for drag-and-drop file selection.

#### Scenario: Drag video file onto upload area
- **WHEN** a user drags a video file onto the upload area
- **THEN** the file SHALL be selected and previewed as if clicked

#### Scenario: Drag invalid file type
- **WHEN** a user drags a non-video file onto the video upload area
- **THEN** the drop SHALL be rejected with a toast error message

### Requirement: Client-side file size validation SHALL be enforced
The frontend SHALL validate file sizes before upload. Maximum video size: 200MB. Maximum image size: 20MB per image.

#### Scenario: Video file exceeds size limit
- **WHEN** a user selects a video file larger than 200MB
- **THEN** a toast error SHALL be shown and the file SHALL NOT be uploaded

#### Scenario: Image file exceeds size limit
- **WHEN** a user selects an image larger than 20MB
- **THEN** a toast error SHALL be shown and the image SHALL NOT be added

### Requirement: React Error Boundary SHALL be implemented
A React Error Boundary component SHALL catch render errors and display a fallback UI with a "Reload" button.

#### Scenario: Page component throws during render
- **WHEN** a page component throws a JavaScript error during render
- **THEN** the Error Boundary SHALL display a user-friendly error message instead of a blank page

#### Scenario: Error boundary provides recovery
- **WHEN** the user clicks the "Reload" button in the error fallback
- **THEN** the page SHALL reload and attempt to render again

### Requirement: 404 route SHALL be implemented
A catch-all route SHALL display a "页面未找到" (Page Not Found) message with a link back to the home page.

#### Scenario: Navigate to unknown path
- **WHEN** a user navigates to `/unknown-path`
- **THEN** a 404 page SHALL be displayed with a link to `/`

### Requirement: LogsPage SHALL use TanStack Query
`LogsPage` SHALL use TanStack Query's `useQuery` with polling instead of manual `setInterval` for log fetching.

#### Scenario: Log fetching uses TanStack Query
- **WHEN** LogsPage is open
- **THEN** log data SHALL be fetched via TanStack Query with 2-second polling interval

#### Scenario: TanStack Query devtools visibility
- **WHEN** TanStack Query devtools are open
- **THEN** log queries SHALL be visible in the devtools panel

### Requirement: Tasks and logs SHALL support pagination
The backend SHALL accept `limit` and `offset` parameters for `/api/tasks` and `/api/logs`. The frontend SHALL implement infinite scroll using `useInfiniteQuery`.

#### Scenario: Load more tasks
- **WHEN** a user scrolls to the bottom of the tasks list
- **THEN** the next page of tasks SHALL be fetched and appended

#### Scenario: Load more logs
- **WHEN** a user scrolls to the bottom of the logs list
- **THEN** the next page of logs SHALL be fetched and appended

### Requirement: Image preview URLs SHALL be revoked
When note image previews are no longer needed (component unmount or image removal), the `URL.createObjectURL` blob URLs SHALL be revoked via `URL.revokeObjectURL()`.

#### Scenario: Remove image from note upload
- **WHEN** a user removes an image from the note upload form
- **THEN** the blob URL for that image SHALL be revoked to free memory

#### Scenario: Navigate away from PublishPage
- **WHEN** a user navigates away from PublishPage with images loaded
- **THEN** all image blob URLs SHALL be revoked on component unmount

### Requirement: Search inputs SHALL be debounced
Keyword search inputs on TasksPage and LogsPage SHALL debounce input by 300ms before filtering.

#### Scenario: Rapid typing in search
- **WHEN** a user types quickly in the task search input
- **THEN** filtering SHALL only trigger 300ms after the last keystroke

### Requirement: videoThumbnail fallback SHALL be correct
Each platform SHALL use its own thumbnail input. Cross-platform thumbnail fallback (e.g., Douyin portrait used for Kuaishou) SHALL NOT occur.

#### Scenario: Different thumbnails for different platforms
- **WHEN** a user uploads to both Douyin and Kuaishou with platform-specific thumbnails
- **THEN** each platform SHALL receive its own thumbnail, not the other's

### Requirement: Login page SHALL be accessible at /login
A login page SHALL be available at the `/login` route. It SHALL display an email input, a "发送验证码" button, a verification code input (shown after code is sent), and a "登录" button. The page SHALL use existing shadcn/ui components (Card, Input, Button, Label, Alert).

#### Scenario: User visits /login
- **WHEN** a user navigates to `/login`
- **THEN** a centered login card SHALL be displayed with an email input field and a "发送验证码" button

#### Scenario: User submits email
- **WHEN** a user enters a valid email and clicks "发送验证码"
- **THEN** the button SHALL show a 60-second countdown timer and the verification code input SHALL appear

#### Scenario: User enters code and logs in
- **WHEN** a user enters the correct 6-digit code and clicks "登录"
- **THEN** the user SHALL be redirected to `/` and the sidebar SHALL display the user's email

### Requirement: AuthGuard SHALL protect application routes
An `AuthGuard` component SHALL wrap all application routes (`/`, `/publish`, `/tasks`, `/logs`). Unauthenticated users SHALL be redirected to `/login`.

#### Scenario: Unauthenticated user visits protected route
- **WHEN** an unauthenticated user navigates to `/publish`
- **THEN** the user SHALL be redirected to `/login`

#### Scenario: Authenticated user visits protected route
- **WHEN** an authenticated user navigates to `/publish`
- **THEN** the PublishPage SHALL render normally

#### Scenario: Authenticated user visits /login
- **WHEN** an authenticated user navigates to `/login`
- **THEN** the user SHALL be redirected to `/`

### Requirement: Sidebar SHALL display user info and logout
The sidebar footer SHALL display the current user's email and a "登出" button. Clicking "登出" SHALL call `POST /api/auth/logout` and redirect to `/login`.

#### Scenario: User is logged in
- **WHEN** the sidebar renders and the user is authenticated
- **THEN** the sidebar footer SHALL show the user's email and a "登出" button

#### Scenario: User clicks logout
- **WHEN** the user clicks the "登出" button
- **THEN** the session SHALL be cleared and the user SHALL be redirected to `/login`

### Requirement: 401 responses SHALL trigger automatic redirect
The axios response interceptor in `client.ts` SHALL detect HTTP 401 responses and redirect to `/login`, clearing the local auth state.

#### Scenario: API returns 401
- **WHEN** any API call returns HTTP 401
- **THEN** the user SHALL be redirected to `/login` and a toast "登录已过期，请重新登录" SHALL be shown

### Requirement: SSE calls SHALL use token authentication
All SSE connections (EventSource and fetch-based streaming) SHALL obtain a one-time token from `GET /api/auth/sse-token` before connecting, appending it as `?sse_token=<token>` to the SSE URL. In same-origin (Vite proxy) mode, session cookies SHALL be used as fallback.

#### Scenario: LoginProgressModal opens SSE with token
- **WHEN** LoginProgressModal opens an EventSource connection
- **THEN** it SHALL first call `getSseToken()`, then open `EventSource` with `?sse_token=<token>` appended to the URL

#### Scenario: AI streaming fetch uses token
- **WHEN** the AI content generation initiates a streaming fetch
- **THEN** it SHALL first call `getSseToken()`, then append `?sse_token=<token>` to the fetch URL

#### Scenario: Same-origin fallback
- **WHEN** the frontend is running behind Vite proxy (same-origin)
- **THEN** SSE connections SHALL work with session cookies alone (sse_token is optional)

### Requirement: PublishPage SHALL have a right sidebar for AI module
The PublishPage layout SHALL be split into a main content area and a right sidebar. The sidebar SHALL be 320px wide and contain the AI content generation panel.

#### Scenario: PublishPage layout with sidebar
- **WHEN** a user navigates to `/publish`
- **THEN** the page SHALL display a two-column layout with the upload form on the left and AI panel on the right

#### Scenario: Responsive sidebar behavior
- **WHEN** the viewport width is less than 1200px
- **THEN** the sidebar SHALL collapse into a drawer that can be toggled via a button

