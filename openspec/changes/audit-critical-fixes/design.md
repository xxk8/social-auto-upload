## Context

A comprehensive audit of the social-auto-upload repository identified 16 actionable issues across 4 severity levels. The project is in active refactoring: migrating from a monolithic `web_runner.py` to a package-based `web_runner/` with a Database abstraction layer (`db.py`), and from `playwright` to `patchright`. Several files and patterns from the pre-refactor era remain, creating inconsistency and risk.

Key stakeholders: the project maintainer, AI agent users (OpenClaw, Codex, Claude Code), and the user community that adopts the project directly.

## Goals / Non-Goals

**Goals:**
- Eliminate all CRITICAL and HIGH severity audit findings
- Make the Dockerfile functional for containerized deployment
- Ensure the Database abstraction layer is consistently used across all routes
- Prevent sensitive files from being committed to version control
- Fix runtime bugs that cause silent failures

**Non-Goals:**
- Refactoring the 82 `except Exception` patterns in `uploader/` (tracked separately under `cli-hardening` spec)
- Adding authentication/authorization to the Web API (separate concern)
- Fixing the scheduled-tasks-lost-on-restart problem (separate concern, partially tracked in `api-reliability`)
- PostgreSQL migration completion (tracked in `openspec/changes/migrate-sqlite-to-postgresql-19`)

## Decisions

### D1: Git hygiene via `git rm --cached` + `.gitignore` hardening

**Decision**: Remove tracked sensitive files from Git index (not disk) using `git rm --cached`, then add comprehensive `.gitignore` rules.

**Rationale**: The files are already in `.gitignore` but were committed before the rules existed. `git rm --cached` removes them from tracking without deleting local copies. This is the standard Git workflow for this situation.

**Alternatives considered**:
- `git filter-branch` / `git filter-repo`: Rewrites history, force-pushes required, breaks all forks. Overkill for current files that don't contain real secrets (yet).
- BFG Repo-Cleaner: Same history-rewrite problem. Not needed since the files aren't sensitive *yet* — the risk is future contamination.

### D2: Dockerfile rewrite using `pyproject.toml` + `patchright`

**Decision**: Rewrite Dockerfile to use `uv pip install -e ".[web]"` instead of `pip install -r requirements.txt`, and `patchright install chromium` instead of `playwright install chromium-headless-shell`.

**Rationale**: The project's canonical dependency definition is `pyproject.toml`. The `requirements.txt` is explicitly marked as "backward compatibility" and doesn't include web extras. The project has migrated from `playwright` to `patchright` for browser automation.

**Alternatives considered**:
- Keep `requirements.txt` + add web deps: Creates a parallel dependency definition that will drift from `pyproject.toml`. The maintainer has already declared `requirements.txt` as legacy.
- Multi-stage Docker build: Unnecessary complexity for this project size. Single-stage with `uv` is fast enough.

### D3: `debug` controlled by environment variable, default `False`

**Decision**: In `run.py`, read `SAU_DEBUG` env var (default `"false"`). In `cli/models.py`, change all `debug: bool = True` to `debug: bool = False`.

**Rationale**: `debug=True` on a `0.0.0.0` binding exposes the Werkzeug remote debugger — a known RCE vector. Debug should be opt-in. The CLI models defaulting to `True` means every upload implicitly runs in debug mode, which is unexpected.

**Alternatives considered**:
- Keep `debug=True` in `run.py` but only bind to `127.0.0.1`: Reduces attack surface but still unexpected behavior for a "production" entry point.
- Remove `debug` parameter entirely: Some uploaders use it for screenshot saving during development. Keep it as opt-in.

### D4: Migrate `account_groups.py` to `get_database()` using raw SQL (not ORM)

**Decision**: Replace all `get_connection()` calls in `account_groups.py` with `db = get_database()` + `db.execute()`/`db.fetch_one()`/`db.fetch_all()`. Keep the existing SQL as-is (SQLite syntax) since the PostgreSQL migration is tracked separately.

**Rationale**: The `get_database()` abstraction already handles SQLite→PostgreSQL translation via `_translate_placeholders()`. The account_groups routes are the only remaining callers of the legacy `get_connection()` shim. Migrating them completes the PR2 contract.

**Alternatives considered**:
- Wait for PostgreSQL migration PR3: Leaves a known inconsistency that will bite when someone tries to run with `SAU_DB_DIALECT=postgres`. The `get_connection()` import explicitly imports `sqlite3`, so it will fail immediately on a PG-configured instance.
- Use an ORM (SQLAlchemy): Massive scope creep. The project uses raw SQL everywhere; introducing an ORM for one file is inconsistent.

### D5: Add `insert_returning_id` to `Database` Protocol

**Decision**: Add `def insert_returning_id(self, sql: str, params: tuple) -> int` to the `Database` Protocol class.

**Rationale**: Both `SqliteDatabase` and `PostgresDatabase` already implement this method, and 3 call sites use it (`web_runner/utils.py`, `web_runner/routes/ai.py`). But the Protocol doesn't declare it, so type checkers flag it as an error and new backend implementations won't know to implement it.

**Alternatives considered**:
- Remove `insert_returning_id` and use `execute()` + `last_insert_id()`: `last_insert_id()` is documented as "DEPRECATED: racy under concurrent INSERTs". The whole point of `insert_returning_id` is to be thread-safe.

### D6: Fix `start.sh` and `conf.py` alignment

**Decision**: Update `start.sh` to use `python run.py` (the actual entry point). Add `YT_PROXY = None` to `conf.py` to match `conf.example.py`.

**Rationale**: `start.sh` references `web_runner.py` which doesn't exist. The actual entry point is `run.py`. `conf.py` is missing `YT_PROXY` which means YouTube proxy config won't work for users who copied `conf.py` directly.

## Risks / Trade-offs

- **[Risk] `debug=False` breaks existing workflows** → Mitigation: Document the change. Users who need debug can pass `--debug` flag or set `SAU_DEBUG=true` env var.
- **[Risk] `account_groups.py` migration introduces SQL incompatibilities** → Mitigation: The SQL is standard SQLite and `_translate_placeholders()` handles `?` → `%s` conversion. Test with both backends.
- **[Risk] `git rm --cached` on `database.db` removes it from other clones** → Mitigation: The DB is regenerated on first run via `init_db()`. Other developers will get an empty DB, which is correct behavior.
- **[Risk] BilibiliVideoUploadRequest adding `debug`/`headless` changes CLI behavior** → Mitigation: The parser already passes `--debug` and `--headless` for bilibili upload-note; the model just wasn't receiving them for upload-video. This is a bug fix, not a behavior change.

## Migration Plan

1. **Phase 1** (this change): Fix all critical/high issues in a single PR
2. **Phase 2** (follow-up): Run `tools/strict_exceptions.py` in CI to prevent regression on `except Exception` patterns
3. **Phase 3** (follow-up): Add authentication to Web API endpoints

**Rollback**: All changes are backwards-compatible except the `debug` default change. If rollback is needed, `git revert` the single commit.

## Open Questions

- Should `conf.py` be removed from the repo entirely and only exist as `conf.example.py`? (Current approach keeps it for backward compat but it's a risk.)
- Should the Dockerfile use `uv` for dependency installation (faster) or stick with `pip` (more standard)?
