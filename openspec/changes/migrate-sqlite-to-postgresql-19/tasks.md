## 1. Cleanup — Delete legacy duplicate entries (Web API)

- [ ] 1.1 Run the following greps and verify zero **non-package** hits before any deletion:
  - `git grep -nE "^(import|from) web_runner_legacy($|\.)"` → must be empty
  - `git grep -nE "^(import|from) routes\.ai($|\.)"` (top-level) → must be empty
  - `git grep -nE "^(import|from) web_runner($|\.)"` — review each hit; package-style imports (`from web_runner.routes...`, `from web_runner.utils...`, `from web_runner.db...`) are allowed; bare `import web_runner` / `from web_runner import create_app` from non-package contexts is forbidden after PR1 lands
  - **Note**: the conftest refactor in §5.1 ships as PR1 commit #1 (lands BEFORE §1.2-§1.4 deletions), not after — order of operations reflects this
- [ ] 1.2 Cut `legacy-snapshots/2026-06-24/web_runner.py.snapshot` outside `archive/` (avoid name collision with `openspec/changes/archive/` which is reserved for openspec tooling). Move `web_runner.py` (1332 lines) into it using `git mv` so history is preserved
- [ ] 1.3 `git rm web_runner_legacy.py`; copy to `legacy-snapshots/2026-06-24/web_runner_legacy.py.snapshot` for forensics (team-internal; not under active code paths)
- [ ] 1.4 `git rm routes/ai.py` (top-level); mirror to `legacy-snapshots/2026-06-24/routes.ai.py.snapshot`
- [ ] 1.5 Run `pytest tests/ -p no:cacheprovider --no-header` — zero unexpected failures; conftest refactor must execute first per §1.1
- [ ] 1.6 Run `python -c "from web_runner import create_app; a = create_app(); print(sorted(str(r) for r in a.url_map.iter_rules()))"` — verify only `web_runner/__init__.py` entry remains
- [ ] 1.7 Update `openspec/config.yaml` rule `Backend changes go in web_runner.py` → `Backend changes go in web_runner/* (routes/ + utils/ + db.py)`; `Tech stack:` line → `Backend: Python 3.10+, Flask, PostgreSQL 19 (SQLite retained as dev fallback)`

## 2. Database abstraction layer (Web API)

> **PR2 + PR2-final + PR3 milestone shipped**: all Python abstraction
> infrastructure for the SQLite → Postgres migration is landed. PR3
> (psycopg → sqlite3 exception translation) is folded into the §2
> work as a sub-section because it sits on top of the same
> `Database` Protocol surface that PR2 ships. PR4 SAVEPOINT +
> PR4-follow-up pool tuning are deferred to a follow-up change
> directory (`migrate-sqlite-to-postgresql-20` or later, TBD); they
> extended the abstraction layer but are not part of this §2 scope.

- [x] 2.1 Add `psycopg[binary]>=3.2,<3.4` and `psycopg-pool>=3.2,<3.4` to `pyproject.toml [web-pg]` extra (cap `<3.4` matches locally-tested 3.3.x builds; update both this line and the `pyproject.toml` block in the same PR if either drifts)
- [x] 2.2 In `web_runner/db.py`: define `class Database(Protocol)` with `execute`, `execute_many`, `fetch_one`, `fetch_all`, `last_insert_id`, `insert_returning_id` (PR3 RETURNING-id helper), `json_dump` / `json_load` (cross-dialect JSON helpers), `transaction` (PR2-final ctx-mgr returning `AbstractContextManager[Database]`). Originally the task list mentioned a `connection` method, but the actual Protocol exposes `transaction` as the canonical handle-boundary entry — a `connection()` shim would have leaked `sqlite3.Connection` to the routes layer and broken dialect isolation. PR3 exception-translation lives on top of the same `Database` Protocol surface (see §P3 below).
- [x] 2.3 Implement `SqliteDatabase` (legacy/conftest-friendly) preserving current behavior. Includes WAL + `busy_timeout=5000` + `check_same_thread=False` for multi-thread safe reads. Per-call `row_factory = sqlite3.Row` assignment in `fetch_one` / `fetch_all` / `insert_returning_id` so dict-by-name access works regardless of thread context (Py PR2-final stable for thread-pool workers).
- [x] 2.4 Implement `PostgresDatabase` with `psycopg_pool.ConnectionPool(conninfo=..., min_size=2, max_size=15, kwargs={"autocommit": True, "row_factory": dict_row})`. PR3 exception-translation wrap (see §P3 below) sits on top — every public method routes through `_conn()` which translates psycopg exceptions into the matching sqlite3 class.
- [x] 2.5 Add SQL placeholder translator: `_translate_placeholders(sql)` uses regex (`'[^']*'|\?`) to rewrite `?` outside string literals to `%s` for postgres dialect. LIKE `'?'` literals and `'in-string ?'` escapes are preserved (regex does not rewrite inside `'…'` quoted strings).
- [x] 2.6 Module-level factory `get_database() -> Database`, controlled by env `SAU_DB_DIALECT` (default `postgres`). Reads `DATABASE_URL` from env on first call; caches one instance per process; tests swap via `monkeypatch.setenv` + `reset_default_database()`.
- [x] 2.7 Add unit tests: `tests/test_db_wrapper.py` covers `?` positional, named params, LIKE literal escape, executor rewrite correctness; SqliteDatabase end-to-end (insert/select roundtrip, `last_insert_id`, `execute_many`, json helpers); factory branching (`SAU_DB_DIALECT=sqlite` vs `postgres`); PostgresDatabase lazy-import (raises when psycopg missing); psycopg exception translation (PR3); SqliteTransaction ctx-mgr commit / rollback / fetch-inside-tx / duplicate-rollback / `insert_returning_id` / `execute_many` (PR2-final); PostgresTransactionHandle wiring pin (PR3). 37 passed / 8 skipped (psycopg-install-dependent skips only).
- [x] 2.8 `web_runner/utils.py`: replace all `with db_lock: conn.execute(...)` with `db.execute(...)`; remove `db_lock` symbol entirely (after PR1 all top-level-module callers already gone, no back-compat window needed). `web_runner/routes/account_groups.py`'s 22 raw `conn.execute` sites migrated to `db.execute` / `db.transaction()` / `db.fetch_*` / `db.insert_returning_id` (PR2-final). The `account_groups` rename endpoint now does disk renames BEFORE the `db.transaction()` block with a `renamed_so_far` list enabling partial-reversal on the DB-rollback exception path; reversal log carries `group_id` + `old_name!r` + `new_name!r` for operator forensics. `confirm_authorize_account_group` intentionally stays OUTSIDE a tx block (INSERT-or-UPDATE upsert with last-writer-wins race semantics) — accompanied by a DO-NOT-generalize comment warning future contributors not to wrap it without a separate ops review.
- [x] 2.9 Run `pytest tests/` with `SAU_DB_DIALECT=sqlite` — full suite passes (37 passed / 8 skipped in `tests/test_db_wrapper.py`; broader full-stack `tests/` shows pre-existing `patchright`-env-gap errors that are unrelated to PR2 through PR3).

### §P3 — PR3: psycopg → sqlite3 exception translation (folded into PR2-final)

- [x] P3.1 `_psycopg_exception_map()` lazy-builds a `dict[psycopg.errors.X, sqlite3.X]` mapping (5 entries: `IntegrityError` / `OperationalError` / `ProgrammingError` / `DataError` / `InterfaceError`). Returns `{}` if psycopg missing; `_translate_psycopg_exception` then identity-passes-through (safe default — callers can still catch their own exception types).
- [x] P3.2 `_translate_psycopg_exception(exc)` walks the map via `isinstance`. Psycopg's `IntegrityError` is the parent of `UniqueViolation` / `ForeignKeyViolation` / `NotNullViolation` / `CheckViolation` / `RestrictViolation`, so the SQLite side collapses to one `sqlite3.IntegrityError` class for all PK/UNIQUE/FK/CHECK/NOT-NULL collisions — production routes can write `except sqlite3.IntegrityError:` once and have it match on Postgres without per-route refactoring.
- [x] P3.3 `PostgresDatabase._conn()` ctx-mgr wraps `self._pool.connection()`. On any `Exception` exit (excluding `KeyboardInterrupt` / `SystemExit` / `GeneratorExit` — control-flow signals must propagate unchanged), catches + translates via `_translate_psycopg_exception`, preserves the original via `raise translated from exc` so `__cause__` keeps the full Python type for debugging.
- [x] P3.4 All 5 PostgresDatabase public methods (`execute` / `execute_many` / `fetch_one` / `fetch_all` / `insert_returning_id`) route through `_conn()`. There is no entry path that escapes untranslated. SQLite-flavored exceptions surface identically across both backends — this is the heart of the dialect-agnostic contract.
- [x] P3.5 `PostgresDatabase.transaction()` re-translates defensively (even though `_conn()` already translated) so any exception that bypassed the outer wrapper still gets caught at the inner `with raw_conn.transaction():` block.
- [x] P3.6 `TestPsycopgExceptionTranslation`: 5 unit-level map tests (`UniqueViolation` / `FK` / `Operational` / `Programming` / unmapped-passthrough) + 1 end-to-end wiring pin (`test_postgres_execute_surfaces_integrity_error_via__conn` via `__new__` + `MagicMock` pool bypass). End-to-end wiring pin is critical: without it a future refactor could remove `_conn()` (or alias all 5 method call sites back to `self._pool.connection()`) while the unit-level map tests still pass and production PK collisions silently stop surfacing to `web_runner/routes/ai.py`.
- [x] P3.7 `TestPostgresTransactionHandle::test_handle_bound_conn_raises_translated_integrity_error`: second pinned wiring-pin proving the bound-handle connection (inside `with db.transaction() as tx:`) routes through the same translation path — protects against a future refactor that lets the handle bypass `_conn()`. Same exception-contract guarantee inside multi-statement transactions.


## 3. Schema rewrite + Alembic baseline (Web API)

- [ ] 3.1 Add `alembic>=1.13,<2.0` to `[dependency-groups.dev]`
- [ ] 3.2 Initialize `db/alembic/` with `alembic init db/alembic`; configure `alembic.ini` with `sqlalchemy.url` empty (read from env at runtime)
- [ ] 3.3 Author baseline migration `0001_initial_pg19.py`:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm`
  - CREATE TABLE tasks / logs / account_groups / account_authorizations / ai_config / ai_api_keys / error_events (per design.md §D3)
  - CREATE TABLE migration_audit (`id BIGSERIAL PRIMARY KEY`, `migrated_at TIMESTAMPTZ NOT NULL`, `table_name TEXT NOT NULL`, `source_count INTEGER NOT NULL`, `target_count INTEGER NOT NULL`, `sample_hash TEXT NOT NULL`, `dialect TEXT NOT NULL`)
  - `CHECK (status IN (...))` on `tasks.status`
  - All indexes from design.md
- [ ] 3.4 Add `db/migrate_sqlite_to_pg.py`:
  - Read all 7 tables from `db/database.db`
  - Batch INSERT 500 rows/cursor through `PostgresDatabase.execute_many`
  - Use `RETURNING id` only when target table has BIGSERIAL PK (logs, account_groups, account_authorizations, ai_api_keys, error_events)
  - Convert `argv` / `result` / `publish_detail` / `error_events.argv` from JSON str to dict
  - Convert `ts` / `created` from ISO str via `datetime.fromisoformat`
  - Verify counts; sample 100 rows; sha256 sum of `argv|created|status|platform|account`
  - INSERT INTO migration_audit
- [ ] 3.5 Add CLI entry: `python db/migrate_sqlite_to_pg.py --source ./db/database.db --target $DATABASE_URL` with exit codes 0..3
- [ ] 3.6 Add unit tests for `db/migrate_sqlite_to_pg.py`: empty DB / 1 row / 1000 rows / mixed UTF-8
- [ ] 3.7 Document runbook in `docs/ops/postgres-backup.md` (pg_dump cron + restore procedure)
- [ ] 3.8 Update `Dockerfile` to install `libpq-dev` and document `psycopg-binary` wheel compatibility
- [ ] 3.9 Add `pg_trgm` smoke test under `tests/integration/test_pg_extensions.py`
- [ ] 3.10 Manual end-to-end smoke: run migrate script against staging PG, then start web_runner with `SAU_DB_DIALECT=postgres`, hit `/api/accounts` and `/api/tasks`, verify JSON shape matches baseline

## 4. Opportunist SQL fixes (Web API)

- [ ] 4.1 `_db_get_logs(task_id=...)`: switch query from `LIKE '%<id>%'` to `message LIKE '[<id>]%'` (with proper ESCAPE) so the trgm GIN index can be used
- [ ] 4.2 `_db_insert_log` trim: DELETE via `id < (SELECT id FROM logs ORDER BY id DESC OFFSET ? LIMIT 1)` — stops relying on `ts` uniqueness; ensure 1 truncate query per 100 inserts reduces commit churn
- [ ] 4.3 Reconcile `_db_get_all_tasks` to single implementation: ORDER BY `created DESC, task_id DESC`; use it everywhere; keep `utils.py` version; remove `web_runner.py`'s copy (already deleted)
- [ ] 4.4 `_db_insert_task` / `_db_update_task`: argv/result/publish_detail store as dict via JSONB — no more `json.dumps(s)` strings
- [ ] 4.5 `_log_error_event`: argv stored as dict via JSONB; traceback stays TEXT
- [ ] 4.6 Add `tests/test_logs_prefix_query.py`: assert `LIKE '[<task_id>]%'` returns only exact task's logs (prevents cross-task leakage)
- [ ] 4.7 Add `tests/test_logs_trim.py`: insert N+100 rows, assert only N remain after trim, assert no rows are dropped due to duplicate `ts`
- [ ] 4.8 Verify query plan: enable `auto_explain.log_min_duration = 100ms` in dev; assert `LIKE '[<id>]%'` uses `idx_logs_message_trgm` (testcontainers only)

## 5. Test infrastructure overhaul (Tests)

- [ ] 5.1 Replace `tests/conftest.py`'s global `patch('sqlite3.connect')` with a session-scoped fixture `db_dialect(request)`
- [ ] 5.2 Default test run stays SQLite (`pytest --db=sqlite` is the default)
- [ ] 5.3 Add `pytest --db=pg` flag; integration tests under `tests/integration/` get tagged `pytest.mark.pg`
- [ ] 5.4 Add `tests/integration/conftest.py` with `testcontainers[postgres]==4.7` fixture; ephemeral container per test session
- [ ] 5.5 Migration test: spin up PG container, run `db/migrate_sqlite_to_pg.py`, assert counts match, assert sample hashes match
- [ ] 5.6 End-to-end test: spin up PG; mount Flask `create_app()`; exercise `/api/tasks`, `/api/logs`, `/api/accounts/check-all` with multipart upload; assert SSE payloads on `/api/upload/progress` — wrap each SSE assertion in `with patch('web_runner.routes.upload._progress_subscribers')` to inject deterministic event emission; assert at most 30 s wall-time per SSE assertion; fail if no `event: done` within window
- [ ] 5.7 CI workflow (.github/workflows/ci.yml): add matrix `{sqlite, pg}` for tests
- [ ] 5.8 Document test instructions in `docs/dev/test-strategy.md`

## 6. Observability (Web API)

- [ ] 6.1 Add `GET /api/health/db` returning `{dialect, pool_size_in_use, pool_size_idle, pg_version, last_vacuum_at, migrations_applied}`
- [ ] 6.2 Include `/api/health/db` in `web_runner/__init__.py`'s default route map
- [ ] 6.3 Add `pool.stats()` introspection in PostgresDatabase wrapper, exposed via health
- [ ] 6.4 Add slow-query log: any query >500ms gets `_task_logger.warning("[pg] slow query: <Nms> <sql>")`
- [ ] 6.5 Add `cron.pg_dump.sh` in `scripts/`, document weekly cron schedule in `docs/ops/postgres-backup.md`
- [ ] 6.6 Add `--diag` flag in `db/migrate_sqlite_to_pg.py`: emits row counts per table, JSONB sample, GIN usage estimate

## 7. Documentation & DevX (Web API)

- [ ] 7.1 Update `CLAUDE.md`: tech-stack line becomes Flask + PostgreSQL 19 (SQLite retained for dev mode)
- [ ] 7.2 Update `README.md`: install instructions include `sudo apt install postgresql libpq-dev` and `uv pip install -e ".[web-pg]"`
- [ ] 7.3 Add `docs/dev/postgres-getting-started.md`: setting up local PG 19 for dev, creating the `sau` role + database, env vars
- [ ] 7.4 Update `docs/web-shell.md` to note backend upgrade + no frontend changes
- [ ] 7.5 Add `docs/ops/postgres-cutover.md`: step-by-step cutover procedure + 14-day archive rules

## 8. Cutover + 14-day archive (Ops)

- [ ] 8.1 Ship `scripts/archive_sqlite.sh`: rsync `db/database.db` to `archive/db-<UTC-epoch>/database.db`, emit sha256 + row counts per table to `archive/SHA256SUMS` and `archive/COUNTS.json`
- [ ] 8.2 Pre-cutover checklist (post PR5 merge): stop web_runner; back up; migrate; verify `/api/health/db=dialect=postgres`; verify `/api/tasks` rows count matches archive COUNTS.json
- [ ] 8.3 Post-cutover 14-day window: SQLite archive kept read-only; `/api/health/db` includes `archive_present: true`
- [ ] 8.4 Day-15 cleanup: `archive_purge.sh` removes `archive/db-*/`; archives one last `archive-final/` for posterity
- [ ] 8.5 Rollback runbook: `docs/ops/postgres-rollback.md` (read SQLite archive, set back `SAU_DB_DIALECT=sqlite`, restart)

## 9. Drop SQLite fallback (Web API, post-cutover +14d)

- [ ] 9.1 Remove `SqliteDatabase` class and `SAU_DB_DIALECT=sqlite` branch
- [ ] 9.2 Update unit tests to use `psycopg` testcontainers only
- [ ] 9.3 Delete `tests/conftest.py`'s sqlite fixture branch
- [ ] 9.4 Final doc pass: `docs/dev/postgres-getting-started.md` becomes the only path
