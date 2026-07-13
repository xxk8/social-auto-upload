## ADDED Requirements

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
