#!/usr/bin/env python3
"""
Seed script: insert test data into the SAU database for dev/preview.

Post-SQLite-removal: this script routes through the production
``get_database()`` abstraction (PostgreSQL-only) instead of the
prior raw ``sqlite3.connect`` against ``db/database.db``. The script
now relies on the host's ``DATABASE_URL`` env var (set via `.env` or
``bash sau_web/start.sh``) — there is no longer a SQLite file at
``db/database.db`` to seed.

Usage:
    python scripts/seed_test_data.py          # default: seed all tables
    python scripts/seed_test_data.py --tasks  # only tasks + logs
    python scripts/seed_test_data.py --clear  # wipe all tables first

Requires: ``DATABASE_URL`` env var pointing at a reachable PG; the
production schema is created via ``init_db()`` before the seeder
runs.
"""
import argparse
import json
import random
import sys
from datetime import datetime, timedelta

from web_runner.db import get_database


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def days_ago(n: int) -> str:
    return (datetime.now() - timedelta(days=n)).isoformat(timespec="seconds")


def seed_tasks(count: int = 30) -> None:
    db = get_database()
    platforms = ["douyin", "tiktok", "youtube", "bilibili", "xiaohongshu"]
    actions = ["upload_video", "publish_note", "batch_upload"]
    accounts = [f"account_{i}" for i in range(1, 6)]
    statuses = ["pending", "success", "failed", "running"]

    rows = []
    for i in range(1, count + 1):
        platform = random.choice(platforms)
        action = random.choice(actions)
        account = random.choice(accounts)
        status = random.choice(statuses)
        created = days_ago(random.randint(0, 30))
        code = random.choice([0, 0, 0, 1, 2])  # 60% success
        error = "" if code == 0 else random.choice([
            "TimeoutError: browser did not respond",
            "LoginError: cookie expired",
            "UploadError: file too large",
        ])
        argv = json.dumps({
            "file": f"/videos/clip_{i:03d}.mp4",
            "title": f"Test video {i}",
            "tags": [f"tag{random.randint(1,5)}"],
        }, ensure_ascii=False)
        result = json.dumps({"upload_url": f"https://example.com/v/{i}"}) if code == 0 else ""
        priority = random.choice([0, 0, 0, 1, 2])
        scheduled_at = (datetime.now() + timedelta(hours=random.randint(1, 72))).isoformat() if random.random() < 0.3 else None

        rows.append((
            f"task_{i:04d}", status, platform, action, account,
            created, code, error, argv, result, priority, scheduled_at,
        ))

    # PG syntax: INSERT ... ON CONFLICT (task_id) DO NOTHING (the
    # tasks.task_id is the primary key; this is the dialect-neutral
    # way to make a re-run idempotent — `INSERT OR IGNORE` was a
    # SQLite-specific extension).
    for row in rows:
        db.execute(
            """INSERT INTO tasks
               (task_id, status, platform, action, account, created, code, error, argv, result, priority, scheduled_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (task_id) DO NOTHING""",
            row,
        )
    print(f"[tasks] inserted up to {len(rows)} rows")


def seed_logs(count: int = 50) -> None:
    db = get_database()
    levels = ["INFO", "WARNING", "ERROR"]
    modules = ["uploader", "web_runner", "cli", "scheduler", "db"]
    messages = [
        "Upload completed successfully",
        "Cookie expired, re-login required",
        "Rate limit hit, backing off",
        "Browser launched",
        "Task queued for execution",
        "Database connection OK",
        "Scheduled job triggered",
        "File validation passed",
        "Retry attempt 1/3",
        "Account check passed",
    ]

    rows = []
    for i in range(count):
        ts = days_ago(random.randint(0, 14))
        level = random.choice(levels)
        module = random.choice(modules)
        msg = random.choice(messages)
        rows.append((ts, f"[{level}] [{module}] {msg}"))

    for row in rows:
        db.execute("INSERT INTO logs (ts, message) VALUES (?, ?)", row)
    print(f"[logs] inserted {len(rows)} rows")


def seed_account_groups() -> None:
    db = get_database()
    groups = ["个人账号", "公司账号", "测试账号", "合作方账号"]
    for i, name in enumerate(groups):
        db.execute(
            """INSERT INTO account_groups (name, created, sort_order)
               VALUES (?, ?, ?)
               ON CONFLICT (name) DO NOTHING""",
            (name, days_ago(30 - i * 5), i),
        )

    group_row = db.fetch_one(
        "SELECT id FROM account_groups WHERE name = ?", ("个人账号",)
    )
    if not group_row:
        print("[account_groups] SKIP authorizations: group not found")
        return
    group_id = group_row["id"]

    platforms = [
        ("douyin", "/cookies/douyin_main.json"),
        ("tiktok", "/cookies/tiktok_main.json"),
        ("youtube", "/cookies/youtube_main.json"),
        ("bilibili", "/cookies/bilibili_main.json"),
    ]
    for i, (platform, cookie) in enumerate(platforms):
        db.execute(
            """INSERT INTO account_authorizations
               (group_id, platform, cookie_file, created, sort_order)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (group_id, platform) DO NOTHING""",
            (group_id, platform, cookie, days_ago(25), i),
        )

    print(f"[account_groups] inserted {len(groups)} groups + {len(platforms)} authorizations")


def seed_users() -> None:
    db = get_database()
    users = [
        ("admin@example.com", "admin", days_ago(60)),
        ("user1@example.com", "user", days_ago(30)),
        ("user2@example.com", "user", days_ago(15)),
        ("demo@example.com", "user", days_ago(7)),
    ]
    for email, role, created in users:
        db.execute(
            """INSERT INTO users (email, role, created_at, name)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (email) DO NOTHING""",
            (email, role, created, email.split("@")[0]),
        )
    print(f"[users] inserted {len(users)} users")


def seed_error_events(count: int = 20) -> None:
    db = get_database()
    phases = ["login", "upload", "publish", "cookie_check"]
    platforms = ["douyin", "tiktok", "youtube"]
    accounts = [f"account_{i}" for i in range(1, 4)]
    exc_types = ["TimeoutError", "LoginError", "UploadError", "ValueError"]
    exc_messages = [
        "browser did not respond within 30s",
        "cookie file missing or corrupted",
        "upload API returned 413",
        "unexpected page layout",
    ]

    rows = []
    for i in range(count):
        rows.append((
            days_ago(random.randint(0, 14)),
            f"task_{random.randint(1, 30):04d}",
            "error",
            random.choice(phases),
            random.choice(platforms),
            random.choice(accounts),
            "upload_video",
            random.choice(exc_types),
            random.choice(exc_messages),
            f"Traceback (most recent call last):\n  File \"uploader.py\", line {random.randint(10,200)}\n    ...",
            json.dumps(["--account", "test"]),
            random.randint(1, 3),
            random.randint(0, 2),
            random.choice([None, 403, 429, 500]),
        ))

    for row in rows:
        db.execute(
            """INSERT INTO error_events
               (ts, task_id, level, phase, platform, account, action,
                exc_type, exc_message, traceback, argv, attempt_no, retry_count, status_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            row,
        )
    print(f"[error_events] inserted {len(rows)} rows")


def seed_ai_config() -> None:
    db = get_database()
    configs = [
        ("pexels_api_key", "px_test_key_12345", days_ago(10)),
        ("pixabay_api_key", "pbx_test_key_67890", days_ago(10)),
        ("ai_model", "gpt-4o", days_ago(5)),
        ("auto_generate_title", "true", days_ago(5)),
    ]
    for key, value, updated in configs:
        # PG: ai_config uses key as PK; ON CONFLICT DO UPDATE matches
        # the prior SQLite `INSERT OR REPLACE` semantics.
        db.execute(
            """INSERT INTO ai_config (key, value, updated)
               VALUES (?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated = EXCLUDED.updated""",
            (key, value, updated),
        )
    print(f"[ai_config] upserted {len(configs)} rows")


def seed_publish_templates() -> None:
    db = get_database()
    templates = [
        ("日常视频发布", "video", {"platforms": ["douyin", "bilibili"], "auto_title": True}),
        ("小红书图文", "note", {"platforms": ["xiaohongshu"], "watermark": True}),
        ("YouTube Shorts", "video", {"platforms": ["youtube"], "tags": ["shorts"]}),
    ]
    for name, mode, snapshot in templates:
        # No UNIQUE on (name, mode), so we use a defensive SELECT-then-INSERT.
        existing = db.fetch_one(
            "SELECT id FROM publish_templates WHERE name = ? AND mode = ?",
            (name, mode),
        )
        if existing:
            continue
        db.execute(
            """INSERT INTO publish_templates (name, mode, snapshot, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (name, mode, json.dumps(snapshot, ensure_ascii=False), days_ago(10), now_iso()),
        )
    print(f"[publish_templates] inserted {len(templates)} templates")


def clear_all() -> None:
    """Truncate all known tables via the production backend.

    Post-SQLite-removal: no need to ``try/except sqlite3.OperationalError``
    anymore — the production PG backend either succeeds or raises
    a runtime error which propagates. Tables that don't exist in
    a fresh database are an init_db concern, not a clear_all concern.
    """
    db = get_database()
    tables = [
        "error_events", "logs", "tasks", "usage_logs",
        "admin_audit_log", "verification_codes",
        "account_authorizations", "account_groups",
        "ai_api_keys", "ai_config",
        "studio_assets", "studio_episodes", "studio_projects",
        "publish_templates", "users",
    ]
    for t in tables:
        db.execute(f"DELETE FROM {t}")
    print("[clear] all tables wiped")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed test data into the SAU database")
    parser.add_argument("--clear", action="store_true", help="Delete all data before seeding")
    parser.add_argument("--tasks", action="store_true", help="Only seed tasks + logs")
    parser.add_argument("--count", type=int, default=30, help="Number of task/error rows to generate")
    args = parser.parse_args()

    # Ensure schema exists. ``init_db()`` is idempotent (CREATE IF NOT EXISTS).
    from web_runner.db import init_db
    try:
        init_db()
    except Exception as exc:
        print(f"Database init failed: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.clear:
        clear_all()

    if args.tasks:
        seed_tasks(args.count)
        seed_logs(args.count * 2)
    else:
        seed_tasks(args.count)
        seed_logs(args.count * 2)
        seed_account_groups()
        seed_users()
        seed_error_events(args.count // 2)
        seed_ai_config()
        seed_publish_templates()

    print("\nDone.")


if __name__ == "__main__":
    main()
