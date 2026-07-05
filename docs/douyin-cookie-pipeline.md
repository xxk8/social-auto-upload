# Douyin Cookie Pipeline — Chrome DevTools → `cookies/douyin_66.json` → `/api/inbox/download`

> Companion to `docs/bilibili-cookie-pipeline.md`. Both platforms share the
> same down‑stream path (`web_runner/routes/inbox.py::_biliup_to_netscape`
> reads `storage_state` JSON → writes Netscape‑flat‑file → passes
> `--cookies <tmp>` to yt‑dlp). They differ in the **up‑stream** cookie
> source. Bilibili uses QR‑scan login via `uploader/bilibili_uploader/main.py`;
> Douyin uses a Chrome‑based human login because `v.douyin.com`'s anti‑bot
> rejects QR‑scan artifacts that aren't a real‑session cookie jar.

This document is the manual‑dance cookbook for the obsolete `Fresh cookies...are
needed` reject we're seeing in `/api/inbox/download` 502 messages across
`v.douyin.com/*` URLs. Read it top‑to‑bottom before refreshing cookies.

---

## TL;DR

1. Open `https://www.douyin.com` in a real Chrome instance you're logged
   into.
2. DevTools (F12) → **Application** → **Cookies** → `https://www.douyin.com`.
3. Extract the four cookie values below into a plain‑text scratch file.
4. Run `scripts/refresh_douyin_cookies.py --sessdata ... --ttwid ...
   --live_version ... --ac_nonce ...`.
5. Restart the backend (`python run.py`) so the boot‑time janitor + the
   fresh `COOKIES_DIR.glob` walk see the new cookie file.
6. POST `/api/inbox/download` with the original `v.douyin.com/*` URL; the
   502 message should now either succeed (200) or surface a fresh yt‑dlp
   diagnostic (`ERROR: [Douyin] ...` minus the cookie‑rejection line).

If a 502 still fires after step 6, see **Troubleshooting** below.

---

## Step 1 — Chrome login

Open `https://www.douyin.com` and authenticate manually. QR‑scan or
phone‑code — whatever your normal Douyin login is. Verify you're looking
at the logged‑in homepage (avatar visible in the top bar) before
proceeding to step 2.

Why logged‑in matters: Douyin's anti‑bot edge runs a `Fresh cookies` check
on every share‑link fetch. Sub‑100ms after a fresh page load, the CDN
injects `__ac_nonce`; if it's missing or stale, the share‑link returns
401 — exactly the `Fresh cookies` yt‑dlp error you're trying to fix.

---

## Step 2 — DevTools cookie extract

`F12` → **Application** → left rail **Cookies** → click
`https://www.douyin.com`.

In the cookie table that appears on the right, copy the **`Value`** column
(for `__live_version__` and `__ac_nonce`, copy the *entire cookie name
including underscores* — the script expects these exact names).

| Cookie name | Required | Why Douyin inspects it |
|:---|:---|:---|
| `SESSDATA` | ● | The canonical log‑in session token; same name bilibili uses, hence `_biliup_to_netscape` already knows how to read it. |
| `ttwid` | ● | Douyin live‑stream persistent token; assigned on every page load but stable for the duration of a single login session. |
| `__live_version__` | ● | Live CDN version stamp. Stale ⇒ captive‑login redirect. |
| `__ac_nonce` | ● | Short‑lived nonce (refreshes on nav). Stale ⇒ 401. |

> HTTP‑only flag doesn't matter for our purposes — yt‑dlp's HTTPS fetcher
> receives HTTP‑only cookies anyway. Secure + HttpOnly are both set on the
> emitted storage_state JSON defensively; the comments in
> `scripts/refresh_douyin_cookies.py` explain why.

Pro tip: open a second shell on your machine and paste each value into a
`cookies.txt` scratch file as you copy it:

```
SESSDATA=d8f3a5b2%2C1718280000%2Cabcde*51fb...
ttwid=01%7C1718280000%7C...cd9f...
__live_version__=...
__ac_nonce=01%7C1718280001%7C...be4c...
```

The `%2C`, `%7C`, `%2A` URL‑escapes you see in cookie values are normal —
`scripts/refresh_douyin_cookies.py` does **not** URL‑decode them;
Netscape format expects raw escaped values verbatim.

---

## Step 3 — Run the refresh script

```bash
cd /path/to/social-auto-upload
python scripts/refresh_douyin_cookies.py \
    --sessdata 'd8f3a5b2%2C1718280000%2Cabcde*51fb...' \
    --ttwid     '01%7C1718280000%7C...cd9f...' \
    --live_version '...' \
    --ac_nonce  '01%7C1718280001%7C...be4c...'
```

Default output path: `<repo>/cookies/douyin_66.json`. Override with
`--out <path>` if you've moved `COOKIES_DIR`.

The script writes a `storage_state`‑shaped JSON (the format
`_biliup_to_netscape` reads), then sets `chmod 0o600` best‑effort so the
cookies file is owner‑readable only.

Add a `--dry-run` flag to sanitize values before committing them to disk:
the script prints the JSON to stdout without writing.

---

## Step 4 — Optional backend restart

```bash
# macOS / Linux: kill the existing `python run.py`, then restart
pkill -f 'python.*run\.py'; sleep 2
nohup env SAU_AUTH_ENABLED=false FLASK_DEBUG=1 uv run python run.py \
    > /tmp/sau_run_py_v4.log 2>&1 &
```

Restart is **NOT required** for the cookie walk to take effect —
`_find_account_cookie_json` calls `_account_files(platform)`, which walks
`COOKIES_DIR.glob("*.json")` at every request (no module‑load cache).
A freshly written `cookies/douyin_66.json` is picked up on the very
next POST without restarting.

The restart is recommended as best‑effort deploy hygiene only:

1. Round‑30 v7.2 boot‑time janitor scrubs stale `.yt_cookies_*.tmp`
   files in `videos/inbox/`. Not strictly required for this workflow,
   but the restart makes the sweeper + the new cookie walk aligned.
2. The Flask process reinitializes its in‑memory module imports —
   catches any state drift in module‑level constants (`COOKIES_DIR`,
   `INBOX_DIR`) that may have been monkey‑patched by a previous test
   run but never restored.

---

## Step 5 — Verify

```bash
curl -sS -X POST http://localhost:6001/api/inbox/download \
    -H 'Content-Type: application/json' \
    -d '{"url":"https://v.douyin.com/<your-test-share-link>/"}' \
    --max-time 90 \
    -w '\nHTTP=%{http_code} TIME=%{time_total}s\n'
```

Expected outcomes (after fresh cookies, post‑restart):
- `HTTP 200` + `{"success":true,"filename":"<epoch>_<id>.mp4","engine":"yt-dlp"}` —
  cookies worked, yt‑dlp fetched the share‑link.
- `HTTP 502` with `yt-dlp failed: ERROR: [Douyin] ... <some‑other‑lvl‑err>`
  but **without** the `Fresh cookies...are needed` line — yt‑dlp is now
  actually fetching the share‑link; this is a different error and you
  should consult the **Troubleshooting** section.
- `HTTP 502` with `yt-dlp failed: ... Fresh cookies...are needed` —
  the cookies didn't take effect; double‑check step 2 + 3 (the script's
  `--dry-run` flag is your friend here).

---

## Backend flow (after refresh worked)

A successful POST `/api/inbox/download` for a Douyin URL passes through:

1. `dl()` extracts the URL from the appshare blob and runs
   `_is_public_url` + `_resolve_is_public` SSRF gates.
2. `_try_ytdlp(url)` calls `_find_account_cookie_json(url)` →
   `_URL_HOST_TO_PLATFORM["v.douyin.com"]` → `platform="douyin"` →
   `_account_files("douyin")` → walks `COOKIES_DIR.glob("*.json")`
   and filters by `name.startswith("douyin_")` → returns the first
   match (your new `douyin_66.json`).
3. `_biliup_to_netscape(cookie_json)` reads the storage_state JSON,
   filters empty‑list / malformed cases (raises → `_maybe_prefix_cookie_err`
   surfaces in the 502 message), writes a Netscape‑flat‑file to
   `INBOX_DIR/.yt_cookies_<hash>.txt`.
4. `_try_ytdlp` builds `ydl_opts = {..., "cookiefile": <tmp_path>}`
   and runs `with concurrent.futures.ThreadPoolExecutor(max_workers=1)
   as pool: future = pool.submit(_run_yt_dlp_inner, ydl_opts, url);
   future.result(timeout=180)` (Round‑30 v7.1 wall‑clock guard).
5. `_run_yt_dlp_inner` calls `yt_dlp.YoutubeDL(ydl_opts).extract_info(url, download=True)`,
   extracts the post‑processed filepath via the 5‑step fallback chain
   (`_candidate_filepath`), returns the downloaded file path.
6. `finally:` in `_try_ytdlp` unlinks the
   `INBOX_DIR/.yt_cookies_<hash>.txt` (Q3 ephemeral — cookies don't
   survive the request's process lifetime). The boot‑time janitor in
   `web_runner/__init__.py::create_app()` is the second‑line defense
   for any orphan bg‑thread leftovers.

---

## Troubleshooting

### `Fresh cookies...are needed` persists after step 5

This means Douyin's CDN still sees an unbound session. Three likely
causes:

1. **`__ac_nonce` was stale at extract time.** The nonce refreshes on
   every navigation. Re‑open the page in DevTools, do *one* navigation
   (e.g. `Cmd+R`), and re‑extract. The `__ac_nonce` row should now
   have a timestamp within the last few seconds.
2. **Cookie value got URL‑decoded somewhere.** `ttwid` and
   `__ac_nonce` frequently contain `%2C`, `%7C`, `%2A`. These are
   intentional — leave them as‑is. `--dry-run` the script and
   eyeball that your values match what DevTools showed.
3. **You're behind a CN‑G‑FW that stripped some values.** Rare, but
   if `SESSDATA` shows up empty in `--dry-run`, double‑check that
   Chrome's cookies tab → `SESSDATA` row's **Value** column isn't
   truncated by a wide‑column viewer.

### `cookies/douyin_66.json` not picked up by `_find_account_cookie_json`

Run this one‑liner to verify the helper actually walks your file:

```bash
uv run python -c "from web_runner.routes.inbox import _find_account_cookie_json; \
  print(_find_account_cookie_json('https://v.douyin.com/MUA9uVQwOIk/'))"
```

The output should be a `PosixPath('/.../cookies/douyin_66.json')`. If it
returns `None`, your filename likely doesn't match the convention
`<platform>_<account>.json` — the helper splits on the first `_`. Rename
to e.g. `cookies/douyin_<your-account-name>.json`.

### Same shift-plan worked yesterday, fails today

Douyin rotates `__live_version__` roughly every 2 weeks (heuristic, not
documented) and rotates anti‑bot fingerprints more frequently. If step 4
verified the cookies were fresh yesterday and now fail, re‑do step 2‑3
from a different browser profile. Cookies extracted in incognito won't
match cookies from your logged‑in profile.

---

## Followups (planned but not blocking)

- **A programmatic extractor** (`scripts/extract_douyin_cookies_chrome.py`)
  that reads directly from Chrome's `Cookies` SQLite DB
  (`~/Library/Application Support/Google/Chrome/Default/Cookies`) without
  requiring the user to manually copy values. Would need `keyring` +
  macOS keychain access to decrypt Chrome's encryption key — significant
  code surface for v1, deferred.
- **Cookie‑age detector** in `/api/inbox/download` that surfaces
  "your douyin cookies are N hours old, consider refreshing" in the
  502 message when the file's `mtime` exceeds a freshness threshold.
  Ponytail: depends on inviting the cookie file's metadata into the
  error surface; not blocking, low value.
- **Background refresh timer** that calls `_sweep_stale_yt_cookie_tmp_files`
  periodically (Round‑30 v7.2 followup ii). Would conflict with the
  manual refresh cadence; deferred.

For current usage, the manual steps above are sufficient. Future
contributors who want to automate should start at step 2.
