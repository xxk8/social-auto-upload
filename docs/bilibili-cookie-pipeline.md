# B 站 Cookie 管线 Cookbook

> **给未来接手 / 看代码 / 排查 anti-bot 问题的 contributor + maintainer**
>
> Round-29 v5 (~2026-06 上旬) 把这条管线从「QR 登录能用，但 inbox 下载无视 cookie」打通到「inbox 自动注入 `--cookies` 给 yt-dlp」。本文按数据生命周期顺序讲清楚每个阶段改的是什么、放哪里、谁负责。

---

## 1. 为什么需要这条管线

B 站 video info API 对未登录 / 风控请求会回 `HTTP 412 Precondition Failed`（需要 `SESSDATA` cookie + 旋转的 `wbi` signature mix-key）。两个缺一不可。所以 inbox 下载这个万能 fallback 路径也必须能拿 cookie —— 否则 `_try_ytdlp` 既跑不动 B 站，patchright chromium 又只看到登录墙。

---

## 2. 数据生命周期（4 段）

```
[1] QR 扫码登录          [2] cookies/*.json        [3] 写入 Netscape 临时  [4] yt-dlp subprocess
     CLI / Web UI       ───►  biliup 格式 JSON  ───►  .yt_cookies_<hash>  ───►  --cookies <tmp>
  (sau bilibili login)     cookies/<plat>_<acct>.json      INBOX_DIR/.yt_cookies_*.txt     最后 unlink
─────────────────────────────────────────────────────────────────────────────────────────────────
   uploader/bilibili/       web_runner/utils.py               web_runner/routes/         web_runner/routes/
      main.py                _account_files + COOKIES_DIR        inbox.py                  inbox.py
                                                  _biliup_to_netscape             _try_ytdlp
```

权限边界：**CLI / uploader** 只负责写；**Web / inbox** 只负责读 + 转换。绝不交叉。

---

## 3. Stage 1 · QR 扫码登录

```bash
sau bilibili login --account <account_name>
# 或在 Web Shell: /app/accounts → 添加 B 站账号 → 扫码
```

**内部发生了什么**（`uploader/bilibili_uploader/main.py`）：

1. patchright 起一个 chromium（mobile UA），打开 `https://passport.bilibili.com/login`
2. 后台 polling `/login/qrcode/poll` 接口，每秒一次最长 90s
3. 扫码成功后保存 `bilibili_cookies_<acct>.json` 到 `cookies/`（注：CLI 走的是 biliup convention 命名；Web Shell 走的是 `_<account_name>.json` 双下划线 pattern —— 见 Stage 2）
4. 关键 cookie：`SESSDATA`（登录态）+ `bili_jct`（CSRF token），两个都要，缺一会触发 412

> ⚠ 终端跑的扫码图建议在真机终端里执行：`sau bilibili login --account <name>` 二维码有时 print 出来截断，不如直接看 `qrcode.png`。

---

## 4. Stage 2 · `cookies/` 文件位置 + 命名

```
cookies/
├── bilibili_myaccount.json     ← CLI 命名 (uploader convention)
├── xiaohongshu_redteam.json    ← Web Shell 用 `<plat>_<acct>.json`
└── ...
```

### 代码位置

`web_runner/utils.py`：

```python
COOKIES_DIR = BASE_DIR / "cookies"           # ← 项目根目录下 cookies/
COOKIES_DIR.mkdir(exist_ok=True)

def _account_files(platform: str | None = None) -> list[dict]:
    """扫 cookies/*.json，按 name.split('_', 1) 拆 plat + acct。
    第一个 '_' 之前是 platform slug  ('bilibili' / 'douyin' / ...)，之后是 account_name。"""
```

`_sync_cookie_files_to_db()`（同文件）会在 `web_runner.init()` 启动时把 `cookies/*.json` → `account_authorizations` 表镜像，方便 web 端 query。

### 命名规范 — **必须**遵守

`<platform_slug>_<account_name>.json`，plat 和 acct 之间是**单个** `_`：

| ✅ 正确 | ❌ 错误 |
|---|---|
| `bilibili_myaccount.json` | `bilibili-myaccount.json`（连字符） |
| `douyin_brand01.json` | `douyin_brand.01.json`（中间有点） |
| `xiaohongshu_redteam.json` | `xiaohongshu_redteam.JSON`（大小写敏感，全小写） |

`_account_files` 用 `name.split('_', 1)` 拆，所以:

- 多 `_` 的 account name（`xiaohongshu_op_team_01`）会被切成 `acct = "op_team_01"` —— 没问题
- Plat 用 unicode 同形异义字符会导致 `_URL_HOST_TO_PLATFORM` 走不到 —— 必须 ASCII 小写 slug

### JSON 格式（disk 上看到的样子）

Biliup / Playwright storage_state 两种 shape 都支持：

```json
// shape A: biliup list（uploader 默认存这个）
[
  {"name": "SESSDATA", "value": "d8f3a5b2%2C...", "domain": ".bilibili.com", "path": "/", "expires": -1},
  {"name": "bili_jct", "value": "csrf-abc...", "domain": ".bilibili.com", "path": "/", "expires": -1}
]

// shape B: Playwright storage_state（uploader 经过 storage_state round-trip 后也可能存）
{
  "cookies": [<同上面>...],
  "origins": [{"origin": "https://member.bilibili.com", "localStorage": []}]
}
```

---

## 5. Stage 3 · Biliup → Netscape 临时文件

`web_runner/routes/inbox.py::_biliup_to_netscape`：

```python
import hashlib
raw = json.loads(cookie_json.read_text(encoding="utf-8"))
cookies = raw if isinstance(raw, list) else (raw.get("cookies") or [])
if not cookies:
    return None   # ← Q3 short-circuit: 空列表 → 跳过 --cookies，记 cookie_err
fingerprint = hashlib.md5(str(cookie_json).encode()).hexdigest()[:8]
out = INBOX_DIR / f".yt_cookies_{fingerprint}.txt"
# ...写入 Netscape 格式:
# # Netscape HTTP Cookie File
# <domain>\t<subdomain_flag>\t<path>\t<secure>\t<expires>\t<name>\t<value>
return out
```

### 关键设计

| 选择 | 理由 |
|---|---|
| 写到 `INBOX_DIR/.yt_cookies_<8 char md5>.txt` | `.` 前缀让平时 `ls` 不刷出来；md5 prefix 防止同 process 内不同账号碰撞 |
| `if not cookies: return None` | 空列表 → 跳过 `--cookies` 让 yt-dlp fall back 到匿名请求（触发 anti-bot 比传空 cookie 文件好） |
| 临时文件（不持久化） | 隐私：SESSDATA 类凭据不应在 disk 上停留超过 process 生命周期 |
| `expires=-1` (session cookie) → 0 | yt-dlp 把 `0` 当 "session-not-stale"，避免把 session cookie 当 expired 丢弃 |
| `domain.startswith('.')` → `subdomain_flag=TRUE` | 标准 Netscape：`.bilibili.com` 表示跨 subdomain 发送，普通 `bilibili.com` 表示精确匹配 |

---

## 6. Stage 4 · yt-dlp 子进程

`web_runner/routes/inbox.py::_try_ytdlp` 把 `--cookies <tmp>` 插进 cmd list：

```python
cmd = [
    "yt-dlp", "--no-playlist", "--quiet",
    "--print", "after_move:filepath",
    "-o", str(DIR / "%(epoch>%H%M%S)s_%(id)s.%(ext)s"),
]
# ... URL host → cookies/<plat>_<acct>.json 找 → Netscape tmp:
netscape_path = _biliup_to_netscape(cookie_json)
if netscape_path is not None:
    cmd.extend(["--cookies", str(netscape_path)])

try:
    r = subprocess.run(cmd + [url], capture_output=True, text=True, timeout=180, cwd=str(DIR))
finally:
    if netscape_path is not None:
        netscape_path.unlink(missing_ok=True)
```

### 关键 invariant

- **`--cookies <tmp>` 出现在 URL 之前** —— yt-dlp CLI 解析 options-then-positional，URL 是最后一个
- **`try/finally` 一定 unlink** —— 无论 subprocess 成功 / 超时 / 失败都 unlink，cookie 不在 disk 上残留
- **空 cookie list** → 跳过 `--cookies`，让 yt-dlp 匿名跑（anti-bot 期望行为，非 degrade）
- **Malformed cookie JSON** → `json.JSONDecodeError` 被捕获，502 message 加 `cookie-convert failed (JSONDecodeError: ...); yt-dlp: ...`

---

## 7. URL host → platform 映射（`_URL_HOST_TO_PLATFORM`）

`web_runner/routes/inbox.py` 顶部的 dict —— 当前只把 **明确活得通的 4 个平台**的 host 加进去：

```python
_URL_HOST_TO_PLATFORM: dict[str, str] = {
    "bilibili.com": "bilibili",     "www.bilibili.com": "bilibili",
    "douyin.com": "douyin",         "www.douyin.com": "douyin", "v.douyin.com": "douyin",
    "kuaishou.com": "kuaishou",     "www.kuaishou.com": "kuaishou", "v.kuaishou.com": "kuaishou",
    "xiaohongshu.com": "xiaohongshu",
    "www.xiaohongshu.com": "xiaohongshu",
    "xhslink.com": "xiaohongshu",   "www.xhslink.com": "xiaohongshu",
}
```

⚠ **不要**把 `m.bilibili.com` / `space.bilibili.com` / `live.bilibili.com` 加进去，除非你确认那些 subdomain 在你测的账号下 cookie 也生效 —— 现在没单元测试覆盖 subdomain 映射，加错了默默 fail。建议先在 B 站那台机器开个 issue / 先 git blame 加测试再加 entry。

---

## 8. Troubleshooting（502 诊断信号）

| 502 message 关键词 | 真根因 | 修法 |
|---|---|---|
| `no usable cookies in cookie file` | cookie JSON 解析成功但 cookies list 是空 | 删除该账号文件，重新走 `sau bilibili login` |
| `cookie-convert failed (JSONDecodeError: ...)` | cookies JSON 格式坏（手动编辑过 / 中断保存） | 同上，重登 |
| `cookie err: <...>; yt-dlp: ... HTTP Error 412` | cookies 有，但 B 站认为失效（SESSDATA 过期 / wbi mix-key 漂走） | **重新扫码**（每月一次SESSDATA 过期） |
| `yt-dlp failed: <...>; patchright also failed: <...>` | cookies 没用上的回退（patchright chromium 60s 超时）| 看 patchright 那一侧 |

> 💡 一个 inline 测试能立刻看清 cookie 是不是活的（绕过后端：
>
> ```bash
> yt-dlp --no-playlist \
>   --cookies /path/to/cookies/bilibili_<acct>.json \
>   -o './videos/inbox/test_%(id)s.%(ext)s' \
>   'https://www.bilibili.com/video/BVxxxxxxxxxx/'
> ```
>
> 能拿到 → cookie 没问题，问题在别处；412 → cookie 过期 / SESSDATA 失效了。

---

## 9. 谁应该看哪些测试

| 想验证什么 | 看测试 |
|---|---|
| `--cookies <tmp>` 真的被插到 cmd 里 | `tests/test_inbox.py::test_dl_passes_account_cookies_for_bilibili_url` |
| 空 cookie list → 跳过 + 502 提到 | `test_dl_surfaces_empty_cookie_list_in_502_message` |
| Malformed JSON → 502 提到 | `test_dl_surfaces_malformed_cookie_json_in_502_message` |
| 临时文件被 `_try_ytdlp finally` unlink | `test_dl_passes_account_cookies_for_bilibili_url`（Q3 lock） |
| URL host → platform 映射找不到 → 静默走匿名 | （目前没显式测试，PR 时建议加：`test_dl_silently_skips_cookies_for_unknown_host`） |

---

## 10. 已知未做的两件事（followup）

不在本文档 v1 范围内，列在这里免得一年后回来有人 grep 想改但是找不到上下文：

1. **Boot-time tmp cleanup**：如果进程在 `_try_ytdlp` 调用中途 kill（SIGKILL / OOM），`videos/inbox/.yt_cookies_*.txt` 不会 unlink。建议 `web_runner/__init__.py::init()` 加 `shutil.rmtree(INBOX_DIR / '.yt_cookies_tmp', ignore_errors=True)`。一行 fix。
2. **Q2 helper-level partial-write defense**：`_biliup_to_netscape` 的 `out.write_text(...)` 应该包 try/except，万一写失败时 `out.unlink(missing_ok=True)` 再 re-raise（防止 half-baked cookie 文件 stuck 在 disk）。

两条都不是 blocking，但都是单一 atomic patch，记入 todo。
