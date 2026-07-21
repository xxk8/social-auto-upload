## MODIFIED Requirements

### Requirement: API SHALL have global exception handler
`web_runner/__init__.py` SHALL register a Flask error handler for unhandled exceptions that returns a JSON response `{success: false, message: "Internal server error"}` instead of HTML. The error handler SHALL log the exception via `_task_logger.error()`. HTTP exceptions (4xx) SHALL pass through to their default handlers.

#### Scenario: Unhandled exception in endpoint
- **WHEN** an endpoint raises an unhandled exception (not an HTTPException)
- **THEN** the response SHALL be JSON with status 500 and `{"success": false, "message": "Internal server error"}`
- **AND** the exception SHALL be logged with full traceback

#### Scenario: HTTP 404 exception passes through
- **WHEN** a request hits a non-existent route
- **THEN** Flask's default 404 handler SHALL return a proper 404 response (not caught by the generic handler)

#### Scenario: Normal endpoint execution
- **WHEN** an endpoint executes successfully
- **THEN** the exception handler SHALL NOT be invoked

## ADDED Requirements

### Requirement: `resp.status_code` SHALL use correct attribute name
All code accessing `requests.Response` status code SHALL use `resp.status_code` (with underscore), not `resp.statuscode`. This applies to `web_runner/routes/ai.py` at lines 134 and 176.

#### Scenario: OpenRouter API returns non-200 status
- **WHEN** the OpenRouter API returns a 400 or 500 status code
- **THEN** the error message SHALL include the numeric status code (e.g., "API error: 400")
- **AND** no `AttributeError` SHALL be raised

#### Scenario: OpenRouter API returns 429 (rate limited)
- **WHEN** the OpenRouter API returns 429
- **THEN** the system SHALL mark the current key as rate-limited and try the next key
- **AND** no `AttributeError` SHALL be raised during error message construction

### Requirement: `Database` Protocol SHALL declare `insert_returning_id`
The `Database` Protocol class in `web_runner/db.py` SHALL include `insert_returning_id(self, sql: str, params: tuple) -> int` as a required method. Both `SqliteDatabase` and `PostgresDatabase` SHALL implement this method.

#### Scenario: Type checker validates insert_returning_id usage
- **WHEN** a type checker (mypy/pyright) analyzes `web_runner/utils.py` or `web_runner/routes/ai.py`
- **THEN** calls to `db.insert_returning_id()` SHALL NOT produce type errors

#### Scenario: New Database backend must implement insert_returning_id
- **WHEN** a developer creates a new class implementing the `Database` Protocol
- **THEN** the type checker SHALL flag it as incomplete if `insert_returning_id` is missing

### Requirement: `run.py` SHALL NOT default to debug mode
The `run.py` entry point SHALL read `SAU_DEBUG` environment variable (default `"false"`). When `SAU_DEBUG` is not set or set to `"false"`, `app.run()` SHALL use `debug=False`. The host SHALL remain `0.0.0.0` and port `6001`.

#### Scenario: Default startup has debug disabled
- **WHEN** `python run.py` is executed without `SAU_DEBUG` env var
- **THEN** Flask SHALL start with `debug=False`

#### Scenario: Debug mode via environment variable
- **WHEN** `SAU_DEBUG=true python run.py` is executed
- **THEN** Flask SHALL start with `debug=True`

#### Scenario: Werkzeug debugger is NOT exposed by default
- **WHEN** the server starts with default settings and an exception occurs in a request
- **THEN** the response SHALL be a JSON error (from the global error handler), NOT the Werkzeug interactive debugger HTML page

### Requirement: `account_groups` routes SHALL use `get_database()` abstraction
All database operations in `web_runner/routes/account_groups.py` SHALL use `db = get_database()` and `db.execute()`/`db.fetch_one()`/`db.fetch_all()` instead of the legacy `get_connection()` which returns a raw `sqlite3.Connection`.

#### Scenario: Account groups work with SQLite backend
- **WHEN** `SAU_DB_DIALECT=sqlite` and account group endpoints are called
- **THEN** all CRUD operations SHALL succeed using the `SqliteDatabase` backend

#### Scenario: Account groups work with PostgreSQL backend
- **WHEN** `SAU_DB_DIALECT=postgres` and account group endpoints are called
- **THEN** all CRUD operations SHALL succeed using the `PostgresDatabase` backend
- **AND** SQL placeholders (`?`) SHALL be automatically translated to `%s`

#### Scenario: Transaction isolation
- **WHEN** two concurrent requests modify the same account group
- **THEN** the `get_database()` abstraction SHALL handle connection pooling correctly (PostgreSQL) or sequential access (SQLite)
