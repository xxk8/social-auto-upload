## ADDED Requirements

### Requirement: OAuth provider registration via Authlib

The system SHALL use Authlib's `FlaskOAuth2App` integration for OAuth provider registration. Google SHALL be registered with OpenID Connect discovery (`server_metadata_url`) and scopes `openid email profile`. GitHub SHALL be registered with explicit `access_token_url`, `authorize_url`, `api_base_url`, and scope `user:email`. Providers SHALL be registered lazily in `_register_providers()` called from `create_app()` only when the corresponding environment variables are set and non-empty.

#### Scenario: Google provider registered when env vars set

- **GIVEN** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set and non-empty
- **WHEN** `_register_providers()` is called during `create_app()`
- **THEN** the Google provider SHALL be registered with `server_metadata_url="https://accounts.google.com/.well-known/openid-configuration"` and `client_kwargs={'scope': 'openid email profile'}`

#### Scenario: GitHub provider registered when env vars set

- **GIVEN** `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set and non-empty
- **WHEN** `_register_providers()` is called
- **THEN** the GitHub provider SHALL be registered with `access_token_url="https://github.com/login/oauth/access_token"`, `authorize_url="https://github.com/login/oauth/authorize"`, `api_base_url="https://api.github.com/"`, and `client_kwargs={'scope': 'user:email'}`

#### Scenario: Provider skipped when env vars missing

- **GIVEN** `GOOGLE_CLIENT_ID` is empty or unset
- **WHEN** `_register_providers()` is called
- **THEN** the Google provider SHALL NOT be registered
- **AND** `oauth.create_client("google")` SHALL return `None` at request time

### Requirement: Google OAuth login and callback

The system SHALL provide `GET /api/auth/google/login` (public, no auth required) that redirects to Google's authorization page, and `GET /api/auth/google/callback` (public) that handles the OAuth callback. The callback SHALL extract the user's email from the `userinfo` token, find or create the user, create a Flask session, and redirect to the frontend dashboard.

#### Scenario: Initiate Google login

- **WHEN** `GET /api/auth/google/login` is called
- **AND** the Google provider is registered
- **THEN** the system SHALL redirect to Google's authorization page with the callback URL

#### Scenario: Google login when provider not configured

- **GIVEN** `GOOGLE_CLIENT_ID` is unset
- **WHEN** `GET /api/auth/google/login` is called
- **THEN** the system SHALL redirect to `/login?error=oauth_not_configured` on the frontend origin

#### Scenario: Successful Google callback

- **GIVEN** Google returns a valid token with `userinfo.email`
- **WHEN** `GET /api/auth/google/callback` processes the callback
- **THEN** the system SHALL call `_find_or_create_user(email, name, avatar)` with the userinfo fields
- **AND** SHALL create a Flask session with `user_id` and `role`
- **AND** SHALL redirect to `/dashboard` on the frontend origin

#### Scenario: Google callback with no email

- **GIVEN** Google returns a token but `userinfo.email` is missing
- **WHEN** the callback processes the token
- **THEN** the system SHALL redirect to `/login?error=no_email` on the frontend origin

#### Scenario: Google callback exception

- **GIVEN** the `authorize_access_token()` call raises an exception
- **WHEN** the callback catches the exception
- **THEN** the system SHALL log a warning and redirect to `/login?error=google_failed` on the frontend origin

### Requirement: GitHub OAuth login and callback

The system SHALL provide `GET /api/auth/github/login` (public) and `GET /api/auth/github/callback` (public). The GitHub callback SHALL fetch the user profile and emails (separate API calls), extract the primary email, find or create the user, create a session, and redirect to the frontend dashboard.

#### Scenario: Initiate GitHub login

- **WHEN** `GET /api/auth/github/login` is called
- **AND** the GitHub provider is registered
- **THEN** the system SHALL redirect to GitHub's authorization page

#### Scenario: Successful GitHub callback

- **GIVEN** GitHub returns a valid token
- **WHEN** `GET /api/auth/github/callback` processes the callback
- **THEN** the system SHALL fetch the user profile via `client.get("user")`
- **AND** SHALL fetch emails via `client.get("user/emails")`
- **AND** SHALL select the primary email (falling back to first verified, then first available)
- **AND** SHALL call `_find_or_create_user(email, name, avatar)` with `name=profile.get("name") or profile.get("login")` and `avatar=profile.get("avatar_url")`
- **AND** SHALL redirect to `/dashboard` on the frontend origin

#### Scenario: GitHub callback with no email at all

- **GIVEN** the GitHub emails API returns an empty list or all email fields are missing
- **WHEN** the callback exhausts the 3-level fallback (primary → verified → first available)
- **THEN** the system SHALL redirect to `/login?error=no_email` on the frontend origin

#### Scenario: GitHub callback exception

- **GIVEN** the token or profile fetch raises an exception
- **WHEN** the callback catches the exception
- **THEN** the system SHALL log a warning and redirect to `/login?error=github_failed` on the frontend origin

### Requirement: Find or create user on first OAuth login

The `_find_or_create_user()` function SHALL look up a user by email. If not found, the system SHALL create a new user with the first user becoming `admin` and all subsequent users becoming `user`. If found, the system SHALL update `last_login` and optionally update `name` and `avatar` via `COALESCE`.

#### Scenario: First OAuth user becomes admin

- **GIVEN** no users exist in the `users` table
- **WHEN** `_find_or_create_user("new@example.com", "New User", "https://avatar.url")` is called
- **THEN** the system SHALL insert a new user with `role='admin'`, `created_at=now`, `last_login=now`, `name="New User"`, `avatar="https://avatar.url"`
- **AND** SHALL return the new user record

#### Scenario: Subsequent OAuth user gets user role

- **GIVEN** at least one user exists
- **WHEN** `_find_or_create_user("another@example.com")` is called
- **THEN** the system SHALL insert a new user with `role='user'`

#### Scenario: Existing user updates last_login and profile

- **GIVEN** a user exists with `email="existing@example.com"`, `name="Old Name"`
- **WHEN** `_find_or_create_user("existing@example.com", "New Name", "https://new.avatar")` is called
- **THEN** the system SHALL update `last_login` to current ISO timestamp
- **AND** SHALL update `name` to "New Name" via `COALESCE(?, name)`
- **AND** SHALL update `avatar` to "https://new.avatar" via `COALESCE(?, avatar)`
- **AND** SHALL return the updated user record

#### Scenario: Existing user with null name keeps old name

- **GIVEN** a user exists with `name="Old Name"`
- **WHEN** `_find_or_create_user("existing@example.com", None, None)` is called
- **THEN** `COALESCE(NULL, name)` SHALL preserve the existing `name="Old Name"`

### Requirement: Session creation after OAuth login

The `_create_session()` function SHALL clear any existing session, set `user_id` and `role` from the user record, and mark the session as permanent.

#### Scenario: Session created with user_id and role

- **GIVEN** a user record with `id=5, role='user'`
- **WHEN** `_create_session(user)` is called
- **THEN** the Flask session SHALL be cleared
- **AND** `session["user_id"]` SHALL be set to 5
- **AND** `session["role"]` SHALL be set to "user"
- **AND** `session.permanent` SHALL be `True`

### Requirement: Frontend redirect to absolute frontend origin

All OAuth callback redirects SHALL use the `_frontend_url()` helper to construct absolute URLs pointing to the frontend origin (default `http://localhost:5180`), not the backend origin (`http://localhost:6001`). The `SAU_FRONTEND_URL` environment variable SHALL override the default.

#### Scenario: Default frontend URL

- **GIVEN** `SAU_FRONTEND_URL` is not set
- **WHEN** `_frontend_url("/dashboard")` is called
- **THEN** the result SHALL be `http://localhost:5180/dashboard`

#### Scenario: Custom frontend URL

- **GIVEN** `SAU_FRONTEND_URL="https://my-app.example.com"`
- **WHEN** `_frontend_url("/login?error=google_failed")` is called
- **THEN** the result SHALL be `https://my-app.example.com/login?error=google_failed`

#### Scenario: Empty SAU_FRONTEND_URL falls back to default

- **GIVEN** `SAU_FRONTEND_URL=""` (set but empty)
- **WHEN** `_frontend_url("/dashboard")` is called
- **THEN** the result SHALL be `http://localhost:5180/dashboard` (uses `or` operator, not `get` default)

#### Scenario: Path with leading slash is handled

- **WHEN** `_frontend_url("/dashboard")` or `_frontend_url("dashboard")` is called
- **THEN** both SHALL produce the same result (leading slash stripped via `lstrip("/")`)

### Requirement: Frontend social login buttons

The frontend `LoginAuthPage.tsx` SHALL render "Google 登录" and "GitHub 登录" buttons that redirect to the backend OAuth login endpoints via `window.location.href`. The page SHALL display OAuth error messages when redirected back with `?error=` query parameters.

#### Scenario: Google login button

- **WHEN** the user clicks the "Google 登录" button on the login page
- **THEN** `authApi.googleLogin()` SHALL set `window.location.href` to `/api/auth/google/login`

#### Scenario: GitHub login button

- **WHEN** the user clicks the "GitHub 登录" button
- **THEN** `authApi.githubLogin()` SHALL set `window.location.href` to `/api/auth/github/login`

#### Scenario: OAuth error display

- **GIVEN** the user is redirected back to `/login?error=google_failed`
- **WHEN** the LoginAuthPage renders
- **THEN** the page SHALL display "Google 登录失败，请重试"

#### Scenario: GitHub error display

- **GIVEN** the user is redirected back to `/login?error=github_failed`
- **WHEN** the LoginAuthPage renders
- **THEN** the page SHALL display "GitHub 登录失败，请重试"

### Requirement: OAuth environment variables

The system SHALL read OAuth configuration from environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. These SHALL be documented in `.env.example` with setup instructions for Google Cloud Console and GitHub Developer Settings.

#### Scenario: Google OAuth env vars documented

- **WHEN** a developer reads `.env.example`
- **THEN** they SHALL find `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` entries
- **AND** a comment SHALL reference the Google Cloud Console setup URL

#### Scenario: GitHub OAuth env vars documented

- **WHEN** a developer reads `.env.example`
- **THEN** they SHALL find `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` entries
- **AND** a comment SHALL reference the GitHub Developer Settings URL

#### Scenario: OAuth redirect URIs documented

- **WHEN** a developer reads `.env.example`
- **THEN** they SHALL find the callback URLs documented: `http://localhost:6001/api/auth/google/callback` and `http://localhost:6001/api/auth/github/callback`
