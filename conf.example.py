from pathlib import Path

# ── Image search (Pexels + Pixabay)─────────────────────────────────────
# AI 助手侧栏 (/app/publish) 的「图片素材」面板从 os.environ 直读 —
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
