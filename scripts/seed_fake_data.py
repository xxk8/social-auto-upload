#!/usr/bin/env python3
"""Seed the web DB with fake/demo data so every surface has something to show.

Run from the project root:

    .venv/bin/python scripts/seed_fake_data.py            # append demo rows
    .venv/bin/python scripts/seed_fake_data.py --clean    # wipe + reseed

No real secrets are inserted: cookie files are placeholder paths, webhook
secrets are obvious placeholders, and API keys are intentionally skipped.
"""

from __future__ import annotations

import os
import json
import random
import sys
import uuid
from datetime import datetime, timedelta

# Make the project root importable (script lives in scripts/).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Load .env (DATABASE_URL) the same way the app expects it ────────────────
def _load_env() -> None:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip('"').strip("'")
            # Only fill when the var isn't already in the environment.
            os.environ.setdefault(key, val)


_load_env()

from web_runner.db import get_database  # noqa: E402
from web_runner.utils import _db_insert_task, _new_task_id  # noqa: E402

random.seed(42)

NOW = datetime.now().replace(microsecond=0)
ISO = "%Y-%m-%dT%H:%M:%S"


def iso(dt: datetime) -> str:
    return dt.strftime(ISO)


PLATFORMS = ["douyin", "kuaishou", "xiaohongshu", "tencent", "bilibili", "tiktok", "baijiahao"]

ACCOUNTS = {
    "douyin": ["douyin_work1", "douyin_work2"],
    "kuaishou": ["ks_work1"],
    "xiaohongshu": ["xhs_work1", "xhs_work2"],
    "tencent": ["tencent_work1"],
    "bilibili": ["bili_work1"],
    "tiktok": ["tiktok_work1"],
    "baijiahao": ["baijiahao_work1"],
}

TITLES = {
    "douyin": ["周末探店 Vlog", "新品开箱实测", "夏日穿搭分享", "城市夜骑记录"],
    "kuaishou": ["老铁日常唠嗑", " rural 美食教程", "搞笑段子合集"],
    "xiaohongshu": ["早C晚A护肤笔记", "小众旅行地攻略", "通勤穿搭灵感", "减脂餐食谱"],
    "tencent": ["视频号直播预告", "行业观察短视频"],
    "bilibili": ["硬核科普长视频", "学习区干货", "沉浸式学习 Vlog", "数码评测"],
    "tiktok": ["Trend recap", "Day in my life", "Recipe shorts"],
    "baijiahao": ["行业周报解读", "政策速递"],
}

ACTION = {
    "xiaohongshu": "upload-note",
    "tencent": "upload-note",
    "bilibili": "upload-note",
}
NOTE_IMAGES = ["/tmp/seed_img1.jpg", "/tmp/seed_img2.jpg", "/tmp/seed_img3.jpg"]


def new_task_id(action: str) -> str:
    return _new_task_id(action)


def build_argv(platform: str, account: str, title: str) -> list[str]:
    action = ACTION.get(platform, "upload-video")
    argv = [platform, action, "--account", account, "--title", title]
    if action == "upload-video":
        argv += ["--file", f"/tmp/{platform}_{uuid.uuid4().hex[:6]}.mp4"]
    else:
        argv += ["--images", *random.sample(NOTE_IMAGES, 2)]
    return argv


def main() -> None:
    db = get_database()
    clean = "--clean" in sys.argv

    if clean:
        print("Cleaning existing rows…")
        # Children before parents (FK-safe delete order).
        for tbl in [
            "notifications", "studio_assets", "studio_episodes", "studio_projects",
            "webhooks_config", "admin_audit_log", "usage_logs", "error_events",
            "logs", "tasks", "account_authorizations", "account_groups",
            "ai_config", "publish_templates", "verification_codes", "users",
        ]:
            try:
                db.execute(f"DELETE FROM {tbl}")
            except Exception as exc:  # table may not exist yet
                print(f"  skip {tbl}: {exc}")

    # ── users ────────────────────────────────────────────────────────────
    print("→ users")
    admin_id = db.insert_returning_id(
        "INSERT INTO users (email, role, created_at, last_login) VALUES (?, ?, ?, ?)",
        ("admin@example.com", "admin", NOW.isoformat(), NOW.isoformat()),
    )
    user_id = db.insert_returning_id(
        "INSERT INTO users (email, role, created_at) VALUES (?, ?, ?)",
        ("demo@example.com", "user", NOW.isoformat()),
    )

    # ── account_groups + authorizations (placeholder cookie paths only) ─────
    print("→ account_groups / authorizations")
    g1 = db.insert_returning_id(
        "INSERT INTO account_groups (name, created, sort_order) VALUES (?, ?, ?)",
        ("工作号 A", NOW.isoformat(), 0),
    )
    g2 = db.insert_returning_id(
        "INSERT INTO account_groups (name, created, sort_order) VALUES (?, ?, ?)",
        ("工作号 B", NOW.isoformat(), 1),
    )
    auth_rows = [
        (g1, "douyin", "cookies/douyin_work1.json"),
        (g1, "xiaohongshu", "cookies/xhs_work1.json"),
        (g1, "kuaishou", "cookies/ks_work1.json"),
        (g2, "bilibili", "cookies/bili_work2.json"),
        (g2, "tencent", "cookies/tencent_work2.json"),
        (g2, "tiktok", "cookies/tiktok_work2.json"),
        (g2, "baijiahao", "cookies/baijiahao_work2.json"),
    ]
    for gid, plat, cookie in auth_rows:
        db.execute(
            "INSERT INTO account_authorizations (group_id, platform, cookie_file, created, sort_order) VALUES (?, ?, ?, ?, ?)",
            (gid, plat, cookie, NOW.isoformat(), 0),
        )

    # ── ai_config (no keys — only non-secret settings) ─────────────────────
    print("→ ai_config")
    ai_settings = [
        ("model", "gpt-4o-mini"),
        ("temperature", "0.7"),
        ("max_tokens", "2048"),
        ("system_prompt", "你是一个短视频内容助手。"),
    ]
    for k, v in ai_settings:
        db.execute(
            "INSERT INTO ai_config (key, value, updated) VALUES (?, ?, ?)",
            (k, v, NOW.isoformat()),
        )

    # ── tasks (the calendar's main data source) ────────────────────────────
    print("→ tasks")
    task_ids: list[str] = []
    # (day_offset, status, platform) tuples; colliding days create conflict warnings.
    plan = [
        (-25, "success", "douyin"), (-22, "success", "bilibili"),
        (-20, "failed", "xiaohongshu"), (-18, "success", "kuaishou"),
        (-15, "error", "tencent"), (-12, "success", "tiktok"),
        (-10, "running", "douyin"), (-8, "success", "baijiahao"),
        (-5, "success", "xiaohongshu"), (-3, "failed", "bilibili"),
        # today + upcoming (draggable pending / scheduled)
        (0, "pending", "douyin"), (0, "pending", "kuaishou"),
        (1, "scheduled", "xiaohongshu"), (2, "pending", "bilibili"),
        (3, "scheduled", "tencent"), (4, "pending", "tiktok"),
        (5, "pending", "baijiahao"), (6, "scheduled", "douyin"),
        (8, "pending", "xiaohongshu"), (9, "pending", "kuaishou"),
        (11, "scheduled", "bilibili"), (13, "pending", "tencent"),
        # forced conflicts (>=2 same-day publish-eligible tasks)
        (15, "pending", "douyin"), (15, "scheduled", "xiaohongshu"), (15, "pending", "bilibili"),
        (18, "scheduled", "kuaishou"), (18, "pending", "tiktok"),
        (22, "pending", "baijiahao"), (25, "scheduled", "douyin"),
        (28, "pending", "xiaohongshu"),
    ]
    for offset, status, platform in plan:
        account = random.choice(ACCOUNTS[platform])
        title = random.choice(TITLES[platform])
        tid = new_task_id("upload")
        task_ids.append(tid)
        created = NOW + timedelta(days=offset, hours=random.randint(8, 20))
        argv = build_argv(platform, account, title)
        _db_insert_task(
            task_id=tid,
            status=status,
            platform=platform,
            action=ACTION.get(platform, "upload-video"),
            account=account,
            created=iso(created),
            argv=json.dumps(argv),
        )
        # Backfill scheduled_at for scheduled/pending future tasks.
        if status in ("scheduled", "pending") and offset >= 0:
            sched = created
            db.execute(
                "UPDATE tasks SET scheduled_at = ?, status = ? WHERE task_id = ?",
                (iso(sched), status, tid),
            )
        # Result / error scaffolding for finished tasks.
        if status == "success":
            db.execute(
                "UPDATE tasks SET code = 0, result = ? WHERE task_id = ?",
                (json.dumps({
                    "video_url": f"https://www.{platform}.com/video/{uuid.uuid4().hex[:10]}",
                    "publish_status": "published",
                    "verified": "true",
                }), tid),
            )
        elif status == "failed":
            db.execute(
                "UPDATE tasks SET code = 1, error = ? WHERE task_id = ?",
                ("上传失败：模拟网络超时（fake data）", tid),
            )
        elif status == "error":
            db.execute(
                "UPDATE tasks SET code = 500, error = ? WHERE task_id = ?",
                ("运行时异常：演示用假数据", tid),
            )

    # ── logs ──────────────────────────────────────────────────────────────
    print("→ logs")
    log_lines = [
        "scheduler tick: 0 pending tasks",
        f"task {task_ids[0]} submitted to executor",
        "cookie refresh skipped (demo)",
        "calendar query served 7 tasks",
        "webhook delivery ok",
        "rate-limit window reset",
        "AI content generation queued",
        "account authorization valid",
        "task retry scheduled",
        "heartbeat ok",
    ]
    for i, msg in enumerate(log_lines):
        db.execute(
            "INSERT INTO logs (ts, message) VALUES (?, ?)",
            ((NOW - timedelta(minutes=i * 7)).isoformat(), msg),
        )

    # ── error_events ──────────────────────────────────────────────────────
    print("→ error_events")
    for tid in task_ids[2:7]:
        db.execute(
            "INSERT INTO error_events (ts, task_id, level, phase, platform, account, exc_type, exc_message, attempt_no, retry_count) "
            "VALUES (?, ?, 'error', 'upload', ?, ?, 'RuntimeError', '演示用模拟异常', 1, 0)",
            ((NOW - timedelta(hours=random.randint(1, 48))).isoformat(), tid, "douyin", "douyin_work1"),
        )

    # ── usage_logs (FK -> users) ──────────────────────────────────────────
    print("→ usage_logs")
    for _ in range(8):
        db.execute(
            "INSERT INTO usage_logs (user_id, action, created_at) VALUES (?, ?, ?)",
            (random.choice([admin_id, user_id]), random.choice(["publish", "ai_generate", "account_add"]), NOW),
        )

    # ── publish_templates ────────────────────────────────────────────────
    print("→ publish_templates")
    db.execute(
        "INSERT INTO publish_templates (name, mode, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ("默认视频模板", "video", json.dumps({
            "platform": "douyin", "title": "{{title}}", "tags": ["#vlog", "#日常"],
            "privacy": "public",
        }), NOW, NOW),
    )
    db.execute(
        "INSERT INTO publish_templates (name, mode, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ("小红书图文模板", "note", json.dumps({
            "platform": "xiaohongshu", "title": "{{title}}", "cover": "auto",
        }), NOW, NOW),
    )

    # ── admin_audit_log (FK -> users) ─────────────────────────────────────
    print("→ admin_audit_log")
    db.execute(
        "INSERT INTO admin_audit_log (admin_user_id, target_user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)",
        (admin_id, user_id, "role_change", "demo 用户角色调整为 user", NOW.isoformat()),
    )

    # ── notifications (FK -> tasks) ────────────────────────────────────────
    print("→ notifications")
    notif_rows = [
        ("task_succeeded", "success", "任务发布成功"),
        ("task_failed", "failed", "任务发布失败"),
        ("task_succeeded", "success", "任务发布成功"),
    ]
    for event, want_status, title in notif_rows:
        cand = next((t for t in task_ids if t.startswith("upload")), task_ids[0])
        db.execute(
            "INSERT INTO notifications (event_type, task_id, platform, account, title, status, delivered, created_at) "
            "VALUES (?, ?, 'douyin', 'douyin_work1', ?, 'done', 1, ?)",
            (event, cand, title, NOW.isoformat()),
        )

    # ── webhooks_config (placeholder secret — NO real key) ────────────────
    print("→ webhooks_config")
    db.execute(
        "INSERT INTO webhooks_config (platform, account, url, secret, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("douyin", "douyin_work1", "https://example.com/webhook/sau", "whsec_PLACEHOLDER_NO_REAL_KEY", 1, NOW.isoformat()),
    )

    # ── script studio (project + episodes + assets, FK -> users) ──────────
    print("→ studio_projects / episodes / assets")
    proj_id = db.insert_returning_id(
        "INSERT INTO studio_projects (title, synopsis, style, status, owner_user_id, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("城市夜骑系列", "记录城市夜晚的骑行 vlog 脚本", "vlog", "draft", admin_id, NOW.isoformat(), NOW.isoformat()),
    )
    for ep_no, ep_title in enumerate(["EP01 出发", "EP02 江边"], start=1):
        db.execute(
            "INSERT INTO studio_episodes (project_id, episode_no, act, title, scenes_json, dialogues_json, status, created_at) "
            "VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, 'draft', ?)",
            (proj_id, ep_no, "第一幕", ep_title,
             json.dumps([{"scene": 1, "desc": "城市夜景空镜"}, {"scene": 2, "desc": "主角出场"}]),
             json.dumps([{"speaker": "旁白", "line": "今晚，我们出发。"}]),
             NOW.isoformat()),
        )
    db.execute(
        "INSERT INTO studio_assets (project_id, kind, code, name, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (proj_id, "broll", "asset_broll_01", "江边空镜", "城市江边夜景，慢镜头", NOW.isoformat()),
    )

    # ── verification_codes (transient demo) ───────────────────────────────
    print("→ verification_codes")
    db.execute(
        "INSERT INTO verification_codes (email, code, purpose, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("demo@example.com", "123456", "login", (NOW + timedelta(minutes=10)).isoformat(), False, NOW.isoformat()),
    )

    print("\n✅ Seed complete. Inserted into all tables (API keys intentionally skipped).")


if __name__ == "__main__":
    main()
