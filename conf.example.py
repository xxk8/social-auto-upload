from pathlib import Path

# ── Image search (Pexels + Pixabay)─────────────────────────────────────
# AI 助手侧栏 (/dashboard/publish) 的「图片素材」面板从 os.environ 直读 —
# 这里是 Python config no-op。配在 `.env`，不是这里：
#   PEXELS_API_KEY=<hex>     # https://www.pexels.com/api/   注册后即可获得
#   PIXABAY_API_KEY=<32位>   # https://pixabay.com/api/docs/
# 两都都缺 → 后端返 503 + 「未配置图片搜索 API key」中文提示。
# 完整 onboarding / free-tier 限额 / CORS 走代理的原因 / T&C 规定：
#   docs/ai-material-search.md
# 与 conf.example.py 同步任何 limit 调整时,也要同步更新 web_runner/routes/ai.py
# 的 _IMAGE_RATE_MAX_CALLS 常量 + 上面的 docs runbook (三处 lockstep)。

BASE_DIR = Path(__file__).parent.resolve()
XHS_SERVER = "http://127.0.0.1:11901"  # only used by xhs-related flows
LOCAL_CHROME_PATH = ""  # optional, e.g. C:/Program Files/Google/Chrome/Application/chrome.exe
LOCAL_CHROME_HEADLESS = True  # default headless behavior for uploader/examples
DEBUG_MODE = True  # default debug behavior
# Optional proxy for the YouTube uploader. Where youtube.com is blocked, direct
# connections time out and the (patchright) chromium does NOT use the system proxy.
# Point this at your local proxy port, e.g. "http://127.0.0.1:7890". None = no proxy.
YT_PROXY = None

# ── Anti-Detection Configuration ────────────────────────────────────────────
# Enable content fingerprint obfuscation before upload (changes MD5 / encoding
# parameters / adds imperceptible noise to defeat platform duplicate detection).
# Requires ffmpeg on PATH.
ANTI_DETECT_OBFUSCATE_VIDEO = True   # obfuscate_video() before video uploads
ANTI_DETECT_OBFUSCATE_IMAGE = True   # obfuscate_image() before image uploads

# Browser anti-detection is always enabled via utils/anti_detect/.
# The following tune its aggressiveness:
#   - stealth_enhanced.py  → navigator.webdriver, plugins, canvas noise, WebGL
#   - human_behavior.py    → random delays, bezier mouse curves, human typing
#   - browser_profile.py   → consistent viewport / locale / timezone per platform

# ── Postgres ConnectionPool tuning (PR4-follow-up; env vars only) ─────────
# Operators tune the psycopg_pool.ConnectionPool at runtime via env
# vars (read once at first get_database() call, so restart to apply):
#   export SAU_DB_POOL_MIN=4       # min warm conns (default 2)
#   export SAU_DB_POOL_MAX=20      # max concurrent borrows (default 15)
#   export SAU_DB_POOL_TIMEOUT=10  # secs before PoolTimeout (default 30.0)
#   export SAU_DB_POOL_KWARGS='{"application_name":"sau"}'
# Empty string ("SAU_DB_POOL_MIN=") → use the default; misformats
# raise at factory-call time with a RuntimeError pointing at the
# offending env-var name. `SAU_DB_POOL_KWARGS` cannot include
# `row_factory` / `autocommit` (PR3 exception contract gates them).
#
# MAINTENANCE: keep the defaults documented above in sync with
# `web_runner/db.py::_pool_kwargs_from_env`. When you bump a default
# in the helper, manually update this file in the same PR. There is
# NO programmatic pin between the two — reviewers should catch drift.

# ── Account Health Monitoring (env vars only) ───────────────────────
# Tunes `web_runner/health_monitor.py` (daemon thread + `_check_with_retry()`
# retry semantics) + `web_runner/utils.py` (quick check stale threshold).
# Read once at first `_run_monitor_cycle()` invocation; module-level
# constants are captured at import time. **Changing any env var below
# requires a Flask process restart** to take effect — `start.sh` does
# NOT wire SIGHUP reload. See AGENTS.md `## Operations tunables` +
# docs/install.md §11 for the grep-to-discover path (`grep -E
# 'SAU_(HEALTH|COOKIE_STALE)'`) + the full 5-column table (var / default /
# range / tuning-location / description).
#
#   export SAU_HEALTH_MONITOR_INTERVAL=21600      # daemon scan period, secs (default 6 h; min ≥ 60 to avoid browser churn)
#   export SAU_HEALTH_REAL_CHECK_INTERVAL=86400   # min gap between real-browser cookie_auth calls, secs (default 24 h; 0 = every cycle)
#   export SAU_HEALTH_TIMEOUT=30                  # per-real-check timeout, secs in [5, 120] (default 30; worst-case = (RETRIES+1) × TIMEOUT)
#   export SAU_HEALTH_EXPIRING_DAYS=7             # verification-trigger threshold, days in [1, 365] (default 7)
#   export SAU_HEALTH_RETRIES=1                   # real-check retry count, [0, 3] hard-clamped (default 1; out-of-range silently pinned to 3 by `_clamp_health_retries`)
#   export SAU_COOKIE_STALE_HOURS=24              # cookie mtime > N hours → stale=true (default 24; sane cap ≤ 168 / 1 week)
#
# Of the six vars above, two are **ORTHOGONAL TRIGGERS** in
# `_determine_health`:
#   * `SAU_COOKIE_STALE_HOURS` (mtime-trigger) AND `SAU_HEALTH_EXPIRING_DAYS`
#     (verification-trigger) are mutually exclusive at the call-site —
#     mtime fires first; verification-trigger only evaluates when mtime
#     doesn't. Both surface the same `expiring_soon` color.
#   * `SAU_HEALTH_RETRIES` is **completely orthogonal** to those two: it
#     only controls the `_check_with_retry()` retry budget for the
#     `real_valid` value, never the stale / expiring branches.
# See docs/install.md §11 互相关系 for the full mtime-vs-verification interaction summary.
#
# MAINTENANCE: keep the defaults documented above in sync with
# `web_runner/health_monitor.py::_HEALTH_INTERVAL / _HEALTH_TIMEOUT /
# _HEALTH_EXPIRING_DAYS / _HEALTH_RETRIES / _REAL_CHECK_INTERVAL` and
# `web_runner/utils.py::_COOKIE_STALE_HOURS`. **Bump a default in
# source ⇒ update this file + docs/install.md §11 in the SAME PR.**
# There is **NO programmatic pin** between the three sites —
# reviewers must catch drift by hand.

# 通知通道 env vars (4 个 webhook URL + 兑底 + secrets,健康度降级事件走
# `web_runner/health_monitor.py::_send_health_notification` -> `web_runner.notifications.emit_event` ->
# `web_runner.notifications._env_webhooks` 读以下 env vars)。同是与账号健康度走一同一 codebase:
#   export SAU_FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/<id>   # 飞书 bot incoming; 不设 → 该频道不发
#   export SAU_FEISHU_WEBHOOK_SECRET=<secret>                                          # 飞书 HMAC-SHA256 签名密钥
#   export SAU_DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=<t>  # 钉钉 bot; 不设 → 该频道不发
#   export SAU_DINGTALK_WEBHOOK_SECRET=<secret>                                         # 钉钉 HMAC-SHA256 签名密钥
#   export SAU_WEWORK_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<k>  # 企业微信 bot; 不设 → 该频道不发
#   export SAU_WEBHOOK_URL=https://hooks.example.com/post                              # 通用 custom webhook 兑底 (前三个未设时发这里)
#   export SAU_WEBHOOK_AGG_WINDOW=60                                                    # 60s 内最多 20 调,避免 bot 调用盾打中 (令见 web_runner/notifications.py:_rate_limited)
#   export SAU_SMTP_HOST=smtp.example.com         # 邮件发送 SMTP server (无则邮件不发); 下同 port/user/password/from 都在同 group
#   export SAU_SMTP_PORT=587
#   export SAU_SMTP_USER=notifications@example.com
#   export SAU_SMTP_PASSWORD=<password>
#   export SAU_SMTP_FROM="social-auto-upload <noreply@example.com>"
# `SAU_HEALTH_WEBHOOK_URL` is a reserved name from openspec/changes/account-health-monitoring/design.md[D3]
# — it is **NOT wired** in code; `web_runner/notifications.py::_env_webhooks` substitutes the
# four `SAU_*_WEBHOOK_URL` env vars above. Changing any of the env vars in this file requires
# a Flask process restart (read once at import time, like SAU_HEALTH_* / SAU_COOKIE_STALE_HOURS).
# On-call grep for all four knob groups in one shot:
#   grep -RE 'SAU_(HEALTH|COOKIE_STALE|.*_WEBHOOK_|SMTP)' .
# SSOT: There is **NO programmatic pin** between the three sites — reviewers must catch drift by hand:
#   docs/install.md §11 environment table
#   AGENTS.md `## Operations tunables` grep hint
#   web_runner/{utils.py,health_monitor.py} module-level constants.

