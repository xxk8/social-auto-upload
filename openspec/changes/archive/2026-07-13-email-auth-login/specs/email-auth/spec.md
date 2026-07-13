## ADDED Requirements

### Requirement: SECRET_KEY configuration
The Flask app SHALL configure `app.config["SECRET_KEY"]` on startup. The key SHALL be read from `SAU_SECRET_KEY` environment variable first; if unset, a random key SHALL be generated and persisted to `db/.secret_key` (file permissions 600).

#### Scenario: SECRET_KEY from environment
- **WHEN** `SAU_SECRET_KEY` environment variable is set
- **THEN** the app uses that value as the secret key

#### Scenario: SECRET_KEY auto-generated
- **WHEN** `SAU_SECRET_KEY` is not set AND `db/.secret_key` does not exist
- **THEN** the app generates a random 64-char hex key, writes it to `db/.secret_key`, and uses it

#### Scenario: SECRET_KEY from file
- **WHEN** `SAU_SECRET_KEY` is not set AND `db/.secret_key` exists
- **THEN** the app reads the key from the file

### Requirement: User registration via first login
The system SHALL automatically create a user record when the first email login occurs, assigning the `admin` role. Subsequent new users SHALL be assigned the `user` role by default. The first-admin check SHALL be wrapped in a database transaction to prevent race conditions.

#### Scenario: First user becomes admin
- **WHEN** no user exists in the `users` table AND a valid verification code is submitted for `admin@example.com`
- **THEN** system creates a new user with `email=admin@example.com`, `role=admin`, sets `session["user_id"]` and `session["role"]`, and returns `{ success: true, data: { user: { email, role } } }`

#### Scenario: Subsequent user gets default role
- **WHEN** at least one user exists AND a valid verification code is submitted for `new@example.com`
- **THEN** system creates a new user with `email=new@example.com`, `role=user`, and returns `{ success: true, data: { user: { email, role } } }`

#### Scenario: Race condition on first admin
- **WHEN** two requests simultaneously submit login for different emails when no user exists
- **THEN** exactly one user SHALL become `admin` (the one that commits first); the other SHALL become `user`

### Requirement: Send verification code
The system SHALL send a 6-digit numeric verification code to the specified email address via SMTP. The code SHALL expire after 5 minutes. The system SHALL enforce a 60-second cooldown per email address. Expired codes for the same email SHALL be cleaned up when a new code is sent.

#### Scenario: Successful code sending
- **WHEN** `POST /api/auth/send-code` with `{ "email": "user@example.com" }`
- **THEN** system generates a 6-digit code, stores it in `verification_codes` table with `expires_at = now + 5 minutes`, sends email via SMTP, and returns `{ success: true, message: "验证码已发送" }`

#### Scenario: Rate limit hit
- **WHEN** `POST /api/auth/send-code` is called for the same email within 60 seconds of the previous request
- **THEN** system returns `{ success: false, message: "请等待 60 秒后重试" }` with HTTP 429

#### Scenario: Invalid email format
- **WHEN** `POST /api/auth/send-code` with `{ "email": "not-an-email" }`
- **THEN** system returns `{ success: false, message: "邮箱格式不正确" }` with HTTP 400

#### Scenario: Cleanup on send
- **WHEN** a new code is sent for `user@example.com`
- **THEN** all expired codes for `user@example.com` SHALL be deleted from the database

### Requirement: Verify code and login
The system SHALL verify the submitted code against the stored code for the given email. On success, the system SHALL create a Flask session and mark the code as used. The session SHALL be regenerated (old session invalidated) to prevent session fixation.

#### Scenario: Successful login
- **WHEN** `POST /api/auth/login` with `{ "email": "user@example.com", "code": "123456" }` AND the code matches and is not expired
- **THEN** system invalidates old session, creates new session with `user_id` and `role`, marks code as `used=true`, updates `last_login`, and returns `{ success: true, data: { user: { email, role } } }`

#### Scenario: Wrong code
- **WHEN** `POST /api/auth/login` with `{ "email": "user@example.com", "code": "000000" }` AND the code does not match
- **THEN** system returns `{ success: false, message: "验证码错误" }` with HTTP 401

#### Scenario: Expired code
- **WHEN** `POST /api/auth/login` with a code that was sent more than 5 minutes ago
- **THEN** system returns `{ success: false, message: "验证码已过期，请重新获取" }` with HTTP 401

#### Scenario: Brute force protection
- **WHEN** 5 consecutive failed verification attempts for the same email within 15 minutes
- **THEN** system returns `{ success: false, message: "尝试次数过多，请 15 分钟后重试" }` with HTTP 429

### Requirement: Session-based authentication
The system SHALL use Flask's built-in session (signed cookie) to maintain login state. The session SHALL contain `user_id` and `role`.

#### Scenario: Authenticated request
- **WHEN** `GET /api/auth/me` with a valid session cookie
- **THEN** system returns `{ success: true, data: { user: { id, email, role, created_at, last_login } } }`

#### Scenario: Unauthenticated request
- **WHEN** `GET /api/auth/me` without a valid session cookie
- **THEN** system returns `{ success: false, message: "未登录" }` with HTTP 401

### Requirement: SSE authentication token
The system SHALL provide a one-time token endpoint for SSE connections that cannot send cookies (cross-origin `EventSource`). The token SHALL be valid for 5 minutes and single-use.

#### Scenario: Get SSE token
- **WHEN** `GET /api/auth/sse-token` with a valid session
- **THEN** system returns `{ success: true, data: { token: "<uuid>", expires_in: 300 } }`

#### Scenario: SSE endpoint with token
- **WHEN** `GET /api/accounts/login/sse?platform=douyin&account=test&sse_token=<uuid>` with a valid token
- **THEN** the SSE connection SHALL be authenticated (equivalent to session auth)

#### Scenario: SSE endpoint with session (same-origin)
- **WHEN** `GET /api/accounts/login/sse?platform=douyin&account=test` with a valid session cookie (no sse_token)
- **THEN** the SSE connection SHALL be authenticated via session

#### Scenario: SSE endpoint without auth
- **WHEN** `GET /api/accounts/login/sse?platform=douyin&account=test` without session or valid token
- **THEN** system returns HTTP 401

### Requirement: Logout
The system SHALL clear the user's session on logout.

#### Scenario: Successful logout
- **WHEN** `POST /api/auth/logout` with a valid session
- **THEN** system clears the session and returns `{ success: true, message: "已登出" }`

### Requirement: Login-required protection
All `/api/*` endpoints except `/api/auth/*` and `/health` SHALL require a valid session. Unauthenticated requests to protected endpoints SHALL receive HTTP 401.

#### Scenario: Protected endpoint without session
- **WHEN** `GET /api/accounts` without a valid session cookie
- **THEN** system returns `{ success: false, message: "未登录" }` with HTTP 401

#### Scenario: Auth endpoints are public
- **WHEN** `POST /api/auth/send-code` without a session
- **THEN** system processes the request normally (does not return 401)

#### Scenario: Auth disabled in development
- **WHEN** `SAU_AUTH_ENABLED=false` AND `FLASK_DEBUG=1`
- **THEN** all endpoints SHALL be accessible without authentication

#### Scenario: Auth disabled ignored in production
- **WHEN** `SAU_AUTH_ENABLED=false` AND `FLASK_DEBUG` is not `1`
- **THEN** authentication SHALL still be enforced (SAU_AUTH_ENABLED is ignored)

### Requirement: SMTP configuration
The system SHALL read SMTP configuration from environment variables: `SAU_SMTP_HOST`, `SAU_SMTP_PORT`, `SAU_SMTP_USER`, `SAU_SMTP_PASS`, `SAU_SMTP_FROM`.

#### Scenario: SMTP configured
- **WHEN** all required SMTP environment variables are set
- **THEN** the system uses the configured SMTP server to send verification emails

#### Scenario: SMTP not configured
- **WHEN** any required SMTP environment variable is missing
- **THEN** the system logs a warning and returns `{ success: false, message: "邮件服务未配置" }` from the send-code endpoint

### Requirement: Admin user management
Admin users SHALL be able to list all users and change user roles via API.

#### Scenario: Admin lists users
- **WHEN** `GET /api/auth/users` with an admin session
- **THEN** system returns `{ success: true, data: [{ id, email, role, created_at, last_login }] }`

#### Scenario: Admin changes user role
- **WHEN** `PUT /api/auth/users/<id>/role` with `{ "role": "admin" }` and an admin session
- **THEN** system updates the user's role and returns `{ success: true }`

#### Scenario: Non-admin tries to manage users
- **WHEN** `GET /api/auth/users` with a non-admin session
- **THEN** system returns `{ success: false, message: "权限不足" }` with HTTP 403

### Requirement: Verification code cleanup
The system SHALL clean up expired verification codes to prevent table bloat.

#### Scenario: Cleanup on app startup
- **WHEN** the Flask app starts (`create_app()` is called)
- **THEN** all rows in `verification_codes` where `expires_at < now` SHALL be deleted

#### Scenario: Cleanup on new code send
- **WHEN** `POST /api/auth/send-code` is called for an email
- **THEN** all expired codes for that email SHALL be deleted before inserting the new code
