# PostgreSQL — Local Dev Setup

> One-command setup for the PostgreSQL side of `openspec/changes/migrate-sqlite-to-postgresql-19` (PR2 onward). After this doc, you can run `uv pip install -e ".[web,web-pg]"` and the Flask backend on `:6001` will talk to a real PG cluster from `database.db`'s successor location.

## Why this exists

`web_runner`'s persistent layer is migrating from SQLite (`db/database.db`) to PostgreSQL (PG ≥ 18 stable, **PG 19 production target** per openspec `proposal.md` §"Why"). The openspec lists schema features that all work on **PG 14+**, but the canonical upgrade target is **PG 19**, so contributors writing PR2 / PR3 should verify locally against a real PG cluster — not just unit tests on SQLite.

> **Note**: homebrew-core currently does **not** ship a `postgresql@19` formula (only `@14` and `@18` as of June 2026). Postgres.app's stable channel (`v2.9.5`) also tops out at PG 18.4. The path this doc covers — **Postgres.app `v3alpha4`** — ships **PG 19beta1** and is the only fully-local macOS way to run real PG 19 today. EDB's "Early Experience" PG 19 tarball works too; we recommend Postgres.app because the bundled `initdb`/`pg_ctl` layout is what our runbook assumes.

## Prereqs

- macOS 11 (Big Sur) or later
- Python 3.10–3.12 (matches `pyproject.toml` `requires-python`)
- `uv` 0.4+ (the project's standard installer)
- ~1.5 GB free disk for the Postgres.app bundle and a single cluster
- `~/.local/bin` on `$PATH` (where Postgres.app CLI helpers expect to be linked)

## Install — one command

```bash
# 1. Download Postgres.app v3alpha4 (PG 19beta1)
mkdir -p /tmp/sau-pg-install && cd /tmp/sau-pg-install
curl -fL -o Postgres-3alpha4-19.dmg \
  https://github.com/PostgresApp/PostgresApp/releases/download/v3alpha4/Postgres-3alpha4-19.dmg

# 2. Mount + drag into ~/Applications (NOT /Applications — root volume is small on macOS)
hdiutil attach -nobrowse -noverify Postgres-3alpha4-19.dmg
mkdir -p ~/Applications
cp -R "/Volumes/Postgres-3alpha4-19/Postgres.app" ~/Applications/
hdiutil detach "/Volumes/Postgres-3alpha4-19"

# 3. Wire the bundled binaries onto your PATH for this shell and future shells
echo 'export PATH="$HOME/Applications/Postgres.app/Contents/Versions/19/bin:$PATH"' \
  >> ~/.zshrc   # or ~/.bashrc
export PATH="$HOME/Applications/Postgres.app/Contents/Versions/19/bin:$PATH"
```

> **Why `~/Applications` and not `/Applications`**: `/Applications` lives on the root volume which on modern macOS is intentionally small. Installing under `~/Applications` keeps the bundle user-owned and quotable. Postgres.app does not require elevated privileges.

## Initialize the cluster

We use a project-local cluster under `~/Library/Application Support/Postgres/var-19beta` listening on **port 5433** (see Troubleshooting for why 5433 and not 5432):

```bash
PG19="$HOME/Applications/Postgres.app/Contents/Versions/19/bin"
DATA="$HOME/Library/Application Support/Postgres/var-19beta"
LOGD="$HOME/Library/Application Support/Postgres/var-19beta-logs"
mkdir -p "$LOGD"

# Initialize with a 'sau' superuser and trust auth (DEV ONLY — production uses scram-sha-256)
"$PG19/initdb" -D "$DATA" -U sau \
  --auth-local=trust --auth-host=trust \
  --no-locale -E UTF8

# Pin port 5433 + listen on localhost (avoid colliding with brew postgresql@14 on 5432)
sed -i '' "s/^#port = 5432.*/port = 5433/" "$DATA/postgresql.conf"
sed -i '' "s/^#listen_addresses = 'localhost'.*/listen_addresses = 'localhost'/" "$DATA/postgresql.conf"

# Replace pg_hba.conf with all-trust for the localhost dev loopback (do NOT use elsewhere)
cat > "$DATA/pg_hba.conf" <<'EOF'
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
EOF
```

## Start the server

```bash
"$PG19/pg_ctl" -D "$DATA" -l "$LOGD/server.log" -w start
```

> **First-use tip**: if `pg_ctl start` complains about an existing `postmaster.pid`, a previous cluster crashed without a clean stop. Run `"$PG19/pg_ctl" -D "$DATA" stop -m fast` first; if that fails because the postmaster is genuinely gone, just `rm "$DATA/postmaster.pid"` and retry.

## Create the role + database

```bash
PG19="$HOME/Applications/Postgres.app/Contents/Versions/19/bin"

# 'sau' was created as superuser by initdb; we only need to add the database.
"$PG19/psql" -h localhost -p 5433 -U sau -d postgres \
  -c 'CREATE DATABASE sau_dev;'
```

The `sau` role has full superuser rights on this dev cluster. Do **not** mirror that setup on a shared server — there, the role should be `NOSUPERUSER` and bound to a per-developer password.

## Verify with `psql`

```bash
"$PG19/psql" -h localhost -p 5433 -U sau -d sau_dev -c '\conninfo'
# → You are connected to database "sau_dev" as user "sau" on host "localhost" at port 5433.

"$PG19/psql" -h localhost -p 5433 -U sau -d sau_dev \
  -c 'SHOW server_version; SHOW server_version_num;'
# → 19beta1 (Postgres.app) / 190000
```

## Wire it into the Python backend

`pyproject.toml` now declares a `[web-pg]` extra (added in PR0 of the openspec). Install it side-by-side with `[web]` so both SQLite and Postgres targets stay installable during the migration window:

```bash
uv pip install -e ".[web,web-pg]"
```

Then either set env vars in your shell or in a `.env` consumed by `web_runner/__init__.py::create_app()`:

```bash
export SAU_DB_DIALECT=postgres
export DATABASE_URL="postgres://sau@localhost:5433/sau_dev"
```

> **Note**: When you flip `SAU_DB_DIALECT=sqlite`, the wrapper (PR2 design §D2) automatically falls back to in-memory / `db/database.db` — no code edits. This is what `tests/conftest.py` exercises by default.

## End-to-end Python smoke test

`uv pip install` lands deps in the project's `.venv/`, so use `uv run` (or activate the venv first) so `python3` resolves to that interpreter:

```bash
uv run python3 - <<'PY'
import psycopg
from psycopg.types.json import Jsonb
with psycopg.connect("host=localhost port=5433 dbname=sau_dev user=sau") as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT version();")
        print("PG:", cur.fetchone()[0])
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS _sau_smoke (
                id BIGSERIAL PRIMARY KEY,
                payload JSONB NOT NULL,
                created TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        """)
        cur.execute("INSERT INTO _sau_smoke (payload) VALUES (%s) RETURNING id;",
                    (Jsonb({"hello": "world", "n": 1}),))
        print("inserted id:", cur.fetchone()[0])
        cur.execute("SELECT id, payload->>'hello', created FROM _sau_smoke;")
        print("row:", cur.fetchone())
    cur.execute("DROP TABLE _sau_smoke;")
PY
```

The `psycopg.types.json.Jsonb(...)` wrap is required: psycopg 3 does **not** auto-adapt a plain `dict` to JSONB even with `format: AUTO` placeholders. Wrapping with `Jsonb(...)` is the canonical psycopg‑3 idiom (it sends correct JSONB on the wire and lets the server validate the column type). Pass it as a 1-tuple `(Jsonb(...),)` — NOT inside a list — since a list-of-tuples is reserved for `cur.executemany(...)` bulk inserts. The alternative—calling `psycopg.types.json.set_json_dumps(json.dumps)` at module load time—works but pollutes global state, so the per-call wrap is preferred here.

> **Note**: `sau_cli` (the desktop CLI, `sau douyin login …`) does **not** depend on this database — only the Web Shell backend (`web_runner/__init__.py::create_app()`) and the integration tests under `tests/integration/` reach it. If you're not working on PR2+, you can skip the whole `uv pip install ... [web-pg]` step and stay on `[web]`.

Expected last line: `row: (1, 'world', datetime.datetime(..., tzinfo=datetime.timezone.utc))`.

## Stop, restart, wipe

```bash
# Stop the cluster
"$PG19/pg_ctl" -D "$DATA" stop -m fast

# Restart (e.g. after a reboot)
"$PG19/pg_ctl" -D "$DATA" -l "$LOGD/server.log" -w start

# Total wipe (DELETES ALL DATA — including sau_dev)
rm -rf "$DATA" "$LOGD"
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `createdb: error: connection to server ... failed: Connection refused` on `:5432` | You pointed `DATABASE_URL` at the default port; brew's `postgresql@14` is there, not our cluster | Set `DATABASE_URL=postgres://...:5433/...` |
| `FATAL:  role "sau" does not exist` | You skipped `initdb -U sau` or wiped `DATA` without re-initing | Re-run the initdb block above |
| `port 5432 is already in use` shown during `pg_ctl start` on :5433 | Someone re-edited `postgresql.conf` to `port = 5432` | Confirm `port = 5433` (sed one-liner above restores it) |
| `pg_ctl: another instance ... postmaster.pid` after a crash | Stale lock file after unclean shutdown | `rm "$DATA/postmaster.pid"` and re-run `pg_ctl start` |
| `initdb (PostgreSQL) 18.x` shown instead of `19beta1` | Your PATH still hits `brew`'s postgresql | Re-`source ~/.zshrc` so `$HOME/Applications/Postgres.app/...` precedes `/opt/homebrew/bin` |

## What this doc does NOT cover

- **Production**: `scram-sha-256` auth, TLS, pgBackRest, WAL archiving, replication, `pg_dump` cron — see `docs/ops/postgres-backup.md` (added in PR3 of the openspec).
- **CI**: ephemeral containers via `testcontainers[postgres]==4.7` — see `tests/integration/` once it lands in PR4.
- **Cutover + 14-day archive**: `docs/ops/postgres-cutover.md` and `scripts/archive_sqlite.sh` (PR5).
- **Linux**: Debian/Ubuntu path is `sudo apt install postgresql libpq-dev` then `pg_ctlcluster 18 main start`. The macOS steps above differ only in `initdb`/data-dir paths; the openspec runbook applies unchanged.
- **PG 19 final release**: when homebrew ships `postgresql@19` and Postgres.app moves `v3` out of alpha, switch `WEB_PG_VERSION` env var in the doc index and bump the bundled cluster path from `var-19beta` to `var-19`. The openspec "Why this exists" rationale (PG 18 minimum) stays valid in either case.

## Cross-references

- openspec change directory: `openspec/changes/migrate-sqlite-to-postgresql-19/` (proposal, design, tasks)
- pyproject extra: `[web-pg]` in `pyproject.toml`
- previous setup steps: `docs/install.md` (kept SQLite-only; this file supersedes the DB-side steps during the migration window)
- `psycopg[binary]` wheel note on Linux: see `Dockerfile` (libpq-dev) — wheels satisfy macOS, but Debian/Ubuntu CI images still need the system package.
- **Hub**: [docs/dev/INDEX.md#operators](docs/dev/INDEX.md#operators) — Operators (on-call, system ops).

> **Gatekeeper note**: macOS may prompt for "Open Anyway" the first time you launch the freshly-copied Postgres.app from `~/Applications` (right-click → Open). It is not strictly required for the headless `initdb`/`pg_ctl` path above, but if you launch the GUI to verify, expect that one prompt.
