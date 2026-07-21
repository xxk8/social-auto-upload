## Why

A comprehensive audit identified 5 critical, 5 high, and 6 medium severity issues across the project. These range from sensitive files (database, cookie DB, AI session data) leaking into the Git repository, to runtime bugs (`resp.statuscode` typo), to a completely broken Dockerfile, to architectural inconsistencies (account_groups bypassing the new Database abstraction). Fixing these issues is a prerequisite for safe public hosting, reliable CI/CD, and the ongoing PostgreSQL migration.

## What Changes

- **Git hygiene**: Remove tracked sensitive/runtime files (`database.db`, `conf.py`, `.kilocode/`, `.opencode/`, `.omo/`) from version control and tighten `.gitignore`
- **Bug fix**: Correct `resp.statuscode` → `resp.status_code` in `web_runner/routes/ai.py` (2 occurrences)
- **Dockerfile rewrite**: Fix entry point (`web_runner.py` → `run.py`), switch from `pip install -r requirements.txt` to `uv pip install -e ".[web]"`, switch from `playwright` to `patchright` for browser install, expand `.dockerignore`
- **Security**: Remove `debug=True` from `run.py` production entry point; make debug opt-in via env var
- **DB layer consistency**: Migrate `web_runner/routes/account_groups.py` from legacy `get_connection()` to `get_database()` abstraction (12 call sites)
- **Protocol completeness**: Add `insert_returning_id` to `Database` Protocol in `web_runner/db.py`
- **Config alignment**: Sync `conf.py` with `conf.example.py` (add `YT_PROXY`), fix `start.sh` entry point reference
- **Code quality**: Fix `BilibiliVideoUploadRequest` missing `debug`/`headless` fields, flip default `debug` from `True` to `False` in all request models

## Capabilities

### New Capabilities
- `git-hygiene`: Rules and tooling to prevent sensitive files from being committed (gitignore + git rm --cached)
- `dockerfile-repair`: Working Dockerfile with correct entry point, dependency installation, and browser setup

### Modified Capabilities
- `api-reliability`: Fix runtime bugs (resp.statuscode), add insert_returning_id to Protocol, remove debug=True default
- `cli-hardening`: Align dataclass defaults (debug=False), add missing fields to BilibiliVideoUploadRequest

## Impact

- **Web API**: `web_runner/routes/ai.py` (bug fix), `web_runner/routes/account_groups.py` (DB migration), `web_runner/db.py` (Protocol update), `run.py` (security)
- **CLI**: `cli/models.py` (dataclass defaults/fields)
- **Infrastructure**: `Dockerfile`, `.dockerignore`, `.gitignore`, `start.sh`, `conf.py`
- **Frontend**: No frontend code changes required
- **Breaking**: `debug` default changes from `True` to `False` in all request models — callers that relied on implicit debug=True must now pass `--debug` explicitly
