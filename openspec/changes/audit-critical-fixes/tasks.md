## 1. Git Hygiene

- [ ] 1.1 Run `git rm --cached database.db conf.py` to untrack sensitive files without deleting them from disk
- [ ] 1.2 Run `git rm --cached -r .kilocode/ .opencode/ .omo/ .kilo/ .playwright-mcp/ skills-lock.json console.publish.log` to untrack AI agent artifacts and runtime files
- [ ] 1.3 Update `.gitignore`: add missing entries for `database.db` (root level), `.kilo/`, `.agents/`, `.playwright-mcp/`, `console.publish.log`, `.sau-logs/`, `*.log`; remove `package-lock.json` from ignore list
- [ ] 1.4 Verify `git ls-files` no longer contains `database.db`, `conf.py`, `.kilocode/`, `.opencode/`, `.omo/`, `skills-lock.json`

## 2. Bug Fixes (Web API)

- [ ] 2.1 Fix `resp.statuscode` → `resp.status_code` in `web_runner/routes/ai.py` line 134
- [ ] 2.2 Fix `resp.statuscode` → `resp.status_code` in `web_runner/routes/ai.py` line 176
- [ ] 2.3 Add `insert_returning_id` method signature to `Database` Protocol in `web_runner/db.py`

## 3. Security: Remove debug=True Default

- [ ] 3.1 Update `run.py` to read `SAU_DEBUG` env var and set `debug=os.environ.get("SAU_DEBUG", "").lower() in ("true", "1", "yes")`
- [ ] 3.2 Change `debug: bool = True` to `debug: bool = False` in all 11 dataclasses in `cli/models.py`
- [ ] 3.3 Add `debug: bool = False` and `headless: bool = True` fields to `BilibiliVideoUploadRequest` in `cli/models.py`
- [ ] 3.4 Update `.env.example` to document `SAU_DEBUG` variable

## 4. Database Layer: Migrate account_groups.py

- [ ] 4.1 In `web_runner/routes/account_groups.py`: replace `from web_runner.db import DB_PATH, get_connection` with `from web_runner.db import get_database`
- [ ] 4.2 Rewrite `list_account_groups()` to use `db.fetch_all()` and `db.fetch_one()` instead of `get_connection()` + raw cursor
- [ ] 4.3 Rewrite `create_account_group()` to use `db.execute()` and `db.insert_returning_id()` instead of `get_connection()`
- [ ] 4.4 Rewrite `delete_account_group()` to use `db.execute()` and `db.fetch_all()` instead of `get_connection()`
- [ ] 4.5 Rewrite `rename_account_group()` to use `db.execute()`, `db.fetch_all()`, `db.fetch_one()` instead of `get_connection()`
- [ ] 4.6 Rewrite `authorize_account_group()` and `confirm_authorize_account_group()` to use `db` abstraction
- [ ] 4.7 Rewrite `remove_authorization()` to use `db` abstraction
- [ ] 4.8 Rewrite `reorder_account_groups()` and `reorder_authorizations()` to use `db` abstraction
- [ ] 4.9 Remove unused `sqlite3` import from `account_groups.py` after migration
- [ ] 4.10 Verify all account_groups endpoints work: `GET /api/account-groups`, `POST /api/account-groups`, `DELETE /api/account-groups/<id>`, `POST /api/account-groups/<id>/rename`

## 5. Dockerfile Repair

- [ ] 5.1 Rewrite `Dockerfile` entry point: `CMD ["python", "run.py"]`
- [ ] 5.2 Rewrite `Dockerfile` dependency install: replace `pip install -r requirements.txt` with `COPY pyproject.toml . && RUN pip install -e ".[web]"`
- [ ] 5.3 Rewrite `Dockerfile` browser install: replace `playwright install chromium-headless-shell` with `patchright install chromium`
- [ ] 5.4 Expand `.dockerignore` to exclude `node_modules/`, `__pycache__/`, `*.egg-info/`, `.pytest_cache/`, `tests/`, `database.db`, `cookies/`, `.sau_uploads/`, `logs/`, `.sau-logs/`, `*.log`, `.kilo/`, `.kilocode/`, `.omo/`, `.opencode/`, `.agents/`, `videos/`, `media/`, `legacy-snapshots/`

## 6. Config & Script Alignment

- [ ] 6.1 Add `YT_PROXY = None` to `conf.py` to match `conf.example.py`
- [ ] 6.2 Fix `start.sh` line 33: change `python web_runner.py` to `python run.py`

## 7. Verification

- [ ] 7.1 Run `python -c "from web_runner import create_app; app = create_app(); print('OK')"` to verify app factory works
- [ ] 7.2 Run `sau --help` to verify CLI still works after model changes
- [ ] 7.3 Run `git ls-files -- '*.db' 'conf.py' '.kilocode/' '.opencode/' '.omo/'` to verify no sensitive files tracked
- [ ] 7.4 Run `python -m pytest tests/ -x` to verify no regressions
