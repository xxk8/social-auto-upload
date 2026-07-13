# `migrate-sqlite-to-postgresql-20`

> **Follow-up to `migrate-sqlite-to-postgresql-19`.** Tasks deferred
> from 19/ §2 (Database abstraction layer) per the milestone note at
> the top of that section: PR4 SAVEPOINT + PR4-follow-up pool tuning
> extend the `Database` Protocol surface but were out of the §2 ship
> scope. This change folder owns the tracking for both, retroactively
> documenting the already-shipped work so the piece-meal asks can be
> audited as a single Postgres-migration minor release.
>
> Refs: `openspec/changes/migrate-sqlite-to-postgresql-19/tasks.md` §2
> (milestone note) + §P3 sister sub-section for the broader abstraction
> layer this change builds on.

---

## PR4 — SAVEPOINT-backed nested transactions (Database abstractions)

> **Status: shipped.** Single PR against `web_runner/db.py` + tests in
> `tests/test_db_wrapper.py`. Replaces the previous
> `tx.transaction() raises RuntimeError` short-circuit with a real
> SAVEPOINT protocol so multi-statement transactions can layer per-
> step rollback isolation without opening fresh top-level transactions.

- [x] **PR4.1** Module-level `_SAVEPOINT_NAME_RE: re.Pattern = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")` — identifier-position SQL-injection guard. Saved once at import so the `@contextmanager` savepoint entry doesn't pay the compile cost.
- [x] **PR4.2** Module-level `_SAVEPOINT_NAME_MAX_LEN: int = 63` — PG `NAMEDATALEN-1` hard limit (off-by-one regression vector; the helper's docstring states the bound explicitly; a `"x" * 64` boundary test pins the choice).
- [x] **PR4.3** Module-level `_RESERVED_SAVEPOINT_NAMES: frozenset[str]` — 24-entry case-insensitive deny-list covering common DML/DDL keywords (the "most-likely-misnamed subset"; full reserved-word coverage would require duplicating the SQL dialect's own parser — YAGNI). `WHERE`, `FROM`, `INTO`, `TABLE`, `AS`, etc. intentionally OUT — non-reserved per SQL standard; backend parse will reject them on use anyway.
- [x] **PR4.4** Module-level `_validate_savepoint_name(name: str) -> None` — single guard entry: `not str` / non-matching regex / cap-exceeded / reserved each raise `ValueError` with a specific error message ("Savepoint name … must match …", "Savepoint name … reserved; pick a different identifier"). The helper is the only path name-bearing code touches before SQL, so SQL-injection vectors and typos route through one place.
- [x] **PR4.5** `SqliteTransactionHandle._next_savepoint_name(n: int) -> str` — per-handle instance counter producing `sp_<N>` (0-padded). Bound to a single outer transaction, so a sub-tx's auto-numbers never collide with siblings.
- [x] **PR4.6** `SqliteTransactionHandle.savepoint(name: str) -> AbstractContextManager["Database"]` — `@contextmanager`-decorated helper. Steps on `__enter__`: validate name → `self._conn.execute(f"SAVEPOINT {name}")`. Steps on clean `__exit__`: `self._conn.execute(f"RELEASE {name}")` (SQLite short form). Steps on raising `__exit__`: `self._conn.execute(f"ROLLBACK TO {name}")` then release-best-effort, then `raise` with `from None` to preserve the original exception (no `__context__` shadowing while debugging).
- [x] **PR4.7** `SqliteTransactionHandle.transaction() -> AbstractContextManager["Database"]` — now routes to `self.savepoint(self._next_savepoint_name())`. PR2-final back-compat preserved: callers that wrapped `with db.transaction() as tx: with tx.transaction() as inner:` now get nested-tx semantics rather than `RuntimeError`.
- [x] **PR4.8** `PostgresTransactionHandle._next_savepoint_name` / `.savepoint` / `.transaction` — mirror 4.5/4.6/4.7 with PG-verbose forms `RELEASE SAVEPOINT {name}` / `ROLLBACK TO SAVEPOINT {name}` to disambiguate from PG's bare-`RELEASE` advisory-lock command (a `@database/sql` reader would not otherwise know whether `RELEASE foo` releases a savepoint or holds-an-advisory-lock). `savepoint()` carries a `TODO(PR4-follow-up)` marker so the deferred `TestPostgresSavepoint` wiring pin stays grep-able.
- [x] **PR4.9** `tests/test_db_wrapper.py::TestSqliteTransaction::test_nested_via_transaction_call_is_savepoint` — renamed from the previous `test_nested_transaction_call_raises`. Asserts: `len(result) == 1` AND anchor row visible on commit path; renames/shortening the test signals the policy flip from "raise" → "support nested" permanently in test history so future contributors don't re-assert the raise behavior.
- [x] **PR4.10** `tests/test_db_wrapper.py::class TestSqliteSavepoint` — 6 tests live: (a) commit-on-exit preserves inner writes; (b) `with pytest.raises: with outer.savepoint("inner")` swallows inside-block, sees only outer commits; (c) nested-savepoint layering where `outer.savepoint("a")` contains `inner.savepoint("b")` exercises the rollback only on `b`'s writes; (d) identity-regex SQL-injection guard with at-cap boundary (`"x" * 63` accepted, `"x" * 65` rejected); (e) validation-doesn't-leak-stack across multiple invalid names; (f) post-rollback RELEASE actually pops the stack so the outer transaction's next savepoint works. Tests use `with outer.savepoint(bad): pass` form so `@contextmanager`-deferred body actually runs at `__enter__` (lesson learned during round-2 review).
- [x] **PR4.11** Round-2 critical-fix: `_SAVEPOINT_NAME_MAX_LEN` corrected from initial `64` → `63` to match PG `NAMEDATALEN-1`. Without this, `"x" * 64` would silently survive the validator and PG would error at SQL execute time with a confusing "identifier too long" — the helper should reject before SQL, not after.
- [x] **PR4.12** Round-2 critical-fix: `_RESERVED_SAVEPOINT_NAMES` expanded from 12 to 24 entries after first-round review flagged common-misnamed keywords (`where` / `from` / `into` / `table` / `as` etc. — note: these are NOT in the deny-list because they're non-reserved per SQL standard and PG would parse them fine as identifiers; the deny-list targets the cases where parse ambiguity breaks the SAVEPOINT grammar). The docstring documents "most-likely-misnamed subset" so future operators understand the scope.
- [x] **PR4.13** Round-2 critical-fix: tests `test_savepoint_rejects_invalid_name` / `test_savepoint_validation_does_not_leak_connection_state` adjusted from `with pytest.raises(...): outer.savepoint(bad)` to `with pytest.raises(...): with outer.savepoint(bad): pass` because `@contextmanager` defers validation until `__enter__`.
- [x] **PR4.14** `pytest tests/test_db_wrapper.py` — `TestSqliteTransaction + TestSqliteSavepoint`: 12 passed / 1 skipped (the legacy `RETURNING id` libsqlite < 3.35 probe). Full file: 37 passed / 8 psycopg-install-dependent skips. **Ship-ready.**

---

## PR4-follow-up — PostgresPool env-var tuning (Database abstractions)

> **Status: shipped.** Single PR adding runtime-tuning knobs without
> code changes for operators. The ConnectionPool lives in
> `psycopg_pool.ConnectionPool` (or wraps a long-lived equivalent);
> these env vars let operators tune it without restarting the fork /
> rebuilding the wheel.

- [x] **P4F.1** Module-level `_GATED_POOL_KWARG_NAMES: frozenset = frozenset({"row_factory", "autocommit"})` — explicit-deny gate constant. The docstring points at the up-stream contract: PG's `dict_row` row factory and `autocommit=True` baseline are PR3 invariants; the gate prevents operator misconfiguration from silently breaking either.
- [x] **P4F.2** Module-level `_pool_kwargs_from_env() -> tuple[int, int, float, dict]` — single source of truth for `SAU_DB_POOL_{MIN,MAX,TIMEOUT,KWARGS}` parsing. Internal helpers: `_env_int(name, default) -> int`, `_env_float(name, default) -> float`. Edge cases:
  - Empty string (`SAU_DB_POOL_MIN=`) → use default (not `int("")` crash).
  - ValueError → `RuntimeError` with offending env-var name, raw value repr, and the original `ValueError` text in the message so operators can diagnose from the log line alone.
  - Non-positive (>0 require) → `RuntimeError` "must be > 0 (got non-positive value)" with the offending value.
  - `MAX < MIN` → `RuntimeError` "SAU_DB_POOL_MAX … cannot be smaller than SAU_DB_POOL_MIN …".
  - JSON-side: `_PoolKwarg*Tuple` `from_raw` parses raw_kwargs non-empty → `json.loads` → `dict`. Non-JSON → `ValueError` → outer-side `RuntimeError` "is not valid JSON". Non-dict JSON (e.g. `[]` / `42` / `"x"`) → `RuntimeError` "must parse to a JSON dict".
  - Forbidden-key gate runs BEFORE the json parsing-rejection branch so `"row_factory": <anything>` failure surfaces a specific denylist error, not a generic dict-mismatch error.
- [x] **P4F.3** `PostgresDatabase.__init__` signature widened: `(self, conninfo, *, min_size=2, max_size=15, timeout=30.0, extra_kwargs=None)`. `min_size` / `max_size` / `timeout` advanced to be tunable; `extra_kwargs` is an explicit extra-passthrough for safe keys (anything except `_GATED_POOL_KWARG_NAMES`).
- [x] **P4F.4** `PostgresDatabase.__init__` defensive pre-import gate: iterates `extra_kwargs` keys, raises `RuntimeError` with explicit mention of each offending key BEFORE any `import psycopg` / pool import. The fail-fast contract stops operators from setting `SAU_DB_POOL_KWARGS='{"row_factory": "x"}'` and getting an opaque psycopg-side error 30 seconds into startup.
- [x] **P4F.5** `get_database()` factory reads env every post-reset call (one-shot cache, re-read on `reset_default_database()`). Module + factory docstrings carry the "change-env-then-restart is the supported tuning loop" caveat — runtime mutation of `os.environ` between two `get_database()` calls within the same process does NOT update the cached pool; restart the service. This is the documented contract; the cache-explicit design mirrors `psycopg_pool`'s own pattern.
- [x] **P4F.6** `tests/test_db_wrapper.py::class TestPostgresPoolTuning` — 11 tests live:
  1. `test_pool_kwargs_defaults_match_documented_clamp` — `(2, 15, 30.0, {})` baseline.
  2. `test_pool_kwargs_min_max_override_environment` — `SAU_DB_POOL_MIN=4 SAU_DB_POOL_MAX=20` round-trips.
  3. `test_pool_kwargs_timeout_override_environment` — float-parses `SAU_DB_POOL_TIMEOUT=12.5`.
  4. `test_pool_kwargs_max_lt_min_raises` — `MAX=1 MIN=4` → `RuntimeError` matching `r"SAU_DB_POOL_MAX.*cannot be smaller than SAU_DB_POOL_MIN"`.
  5. `test_pool_kwargs_non_positive_raises` — `MIN=0`, `MIN=-1`, `MAX=0` → `RuntimeError` matching `r"must be > 0"`.
  6. `test_pool_kwargs_extra_merge_with_documented_kwargs` — `{"application_name": "sau"}` JSON round-trips into the kwargs tail.
  7. Four forbidden-key gate tests (`row_factory`, `autocommit`, combined-key tuple `{"row_factory": "x", "application_name": "sau"}`, tightened-error-pin with `"row_factory"` substring required in the error).
  8. `test_pool_kwargs_must_parse_to_json_dict` — `[]` / `42` / `"x"` → `RuntimeError` matching `r"must parse to a JSON dict"`.
  9. `test_pool_kwargs_malformed_raises_clear_error` — `'{not-json'` → `RuntimeError` matching `r"is not valid JSON"`.
  10. `test_pool_empty_string_treated_as_unset` — `SAU_DB_POOL_MIN=` (empty) short-circuits to default rather than `int("")` crash. Lesson learned during dev iteration: operators iterating on env config in a shell hit this path; treat empty as "unset" so the env-edit-ramp doesn't blow up on whitespace-only state.
- [x] **P4F.7** `conf.example.py` env-var doc block (`# SAU_DB_POOL_MIN=4`, `# SAU_DB_POOL_MAX=20`, `# SAU_DB_POOL_TIMEOUT=10`, `# SAU_DB_POOL_KWARGS='{"application_name":"sau"}'`) — comment-only; the project reads `os.environ` not module globals. Doc block includes a Maintenance note pinning the source of truth: any change to defaults in `_pool_kwargs_from_env()` MUST be reflected in this block (and vice-versa) so operators reading conf.example.py see the same numbers as the actual code path.
- [x] **P4F.8** `pytest tests/test_db_wrapper.py` — `TestPostgresPoolTuning`: 11 passed. Full file: 37 passed / 8 psycopg-install-dependent skips. **Ship-ready.**

---

## Cross-references

- `migrate-sqlite-to-postgresql-19/tasks.md` §2 — milestone note flagging PR4 + PR4-follow-up as deferred to this change folder.
- `migrate-sqlite-to-postgresql-19/tasks.md` §P3 — sister sub-section for the psycopg → sqlite3 exception-translation work this folder's abstractions build on. Both §P3 (PR3) and §PR4 + §PR4-follow-up (PR4 + PR4-follow-up) compose the full multi-PR Database abstraction roll-up; `Database` Protocol consumers (every route in `web_runner/routes/*` + `web_runner/utils.py`) see the unified surface.
- `web_runner/db.py` lines (academic, will drift):
  - `_SAVEPOINT_NAME_RE` / `_SAVEPOINT_NAME_MAX_LEN` / `_RESERVED_SAVEPOINT_NAMES` / `_validate_savepoint_name` — module top
  - `_GATED_POOL_KWARG_NAMES` / `_pool_kwargs_from_env` — module top below the SAVEPOINT block
  - `SqliteTransactionHandle` / `PostgresTransactionHandle` — PR4 additions live inside the per-class block; PR4-follow-up `__init__` signature change is in `PostgresDatabase.__init__`
- `tests/test_db_wrapper.py`:
  - `TestSqliteTransaction` — 7 tx contract tests + 1 nested-call-is-savepoint (renamed)
  - `TestSqliteSavepoint` — 6 SAVEPOINT tests (PR4)
  - `TestPostgresTransactionHandle` — 1 in-tx wiring pin (PR3, sister sub-section)
  - `TestPostgresPoolTuning` — 11 pool-tuning tests (PR4-follow-up)
  - `TestPsycopgExceptionTranslation` — 5 map entries + 1 end-to-end wiring pin (PR3, sister sub-section)
