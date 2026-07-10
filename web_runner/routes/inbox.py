"""Inbox routes — share-link download (yt-dlp + patchright fallback) + audio transcription.

Ponytail ultra: no per-platform adapter table. One generic browser fallback
that opens the share URL, waits for <video>, grabs the resolved src, and
downloads it. If the platform hides the video behind a login wall or returns
m3u8, this returns None and the caller surfaces 502.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import ipaddress
import json
import os
import platform
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Generator
from pathlib import Path
from urllib.parse import urlparse

import requests
import yt_dlp
from flask import Blueprint, Response, jsonify, request, send_from_directory

from web_runner.executor import acquire_inbox_slot, release_inbox_slot
from web_runner.utils import INBOX_DIR, _account_files
from web_runner.utils import log as _task_log

# Wall-clock download budget. Matches the legacy
# `subprocess.run(timeout=180)` deadline from the pre-v7 subprocess
# path so the user-visible 502 message stays consistent across
# the migration. Module-level constant (NOT inside `_try_ytdlp`)
# so tests can monkeypatch it down to a millisecond-scale value
# without spawning real thread-pool sleeps.
_DL_TIMEOUT_SEC = 300

bp = Blueprint("inbox", __name__)
DIR = INBOX_DIR  # canonical constant from web_runner.utils (BASE_DIR / videos / inbox);
                 # mkdir happens at utils module import so we don't repeat it here.


def _is_public_url(url: str) -> bool:
    """Block SSRF: reject literal private/loopback/link-local IPs and
    `localhost`. Mirrors web_runner.utils._download_url's strictness —
    DNS-name bypass (e.g. `localtest.me`) is a known upstream gap and
    is NOT closed here; v0.1 upgrade path is `socket.gethostbyname_ex`
    + per-IP reject, if/when a hostile-by-design request ever lands
    on this endpoint.

    Symmetric carve-out (Round-29 v4): RFC 2544 §4 benchmark range
    (198.18.0.0/15) is a publicly routable IANA allocation for network
    interconnect benchmarking — NOT private LAN. Python's `is_private()`
    over-classifies it as private, so an explicit exemption is applied
    before the private check. Mirrors the same carve-out in
    `_resolve_is_public` for sandbox / NAT / DNS-sinkhole envs that
    route public traffic via literal `http://198.18.x.x/` URLs.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname or ""
        if not hostname:
            return False
        try:
            addr = ipaddress.ip_address(hostname)
            # Symmetric carve-out (sibling of `_resolve_is_public`).
            if addr in ipaddress.ip_network("198.18.0.0/15"):
                return True
            return not (addr.is_private or addr.is_loopback or addr.is_link_local
                        or addr.is_reserved or addr.is_unspecified)
        except ValueError:
            return hostname != "localhost"
    except (ValueError, TypeError):
        return False


def _resolve_is_public(url: str) -> bool:
    """DNS-resolve `url`'s hostname and reject if ANY resolved A/AAAA
    record falls into private / loopback / link-local / reserved /
    unspecified space. Closes a class of DNS-rebinding attacks where
    `evil.com` resolves to a public IP at Python-check time but flips
    to `127.0.0.1` (or `169.254.169.254` cloud metadata) once chromium
    has connected. Synchronous — call inside `asyncio.to_thread` from
    async code paths to keep Playwright's IPC loop draining.

    Edge cases handled:
      • IPv6 zone identifiers (`fe80::1%eth0`) — strip via `%` split.
      • IPv4-mapped IPv6 (`::ffff:127.0.0.1`) — unwrap via `.ipv4_mapped`
        so `is_loopback` actually fires (`is_loopback` on the mapped
        form returns False on CPython < 3.12).
      • Multiple A/AAAA records — ANY private IP rejects the whole URL.
      • Empty / unresolvable hostname — return False.
    """
    try:
        hostname = urlparse(url).hostname or ""
        if not hostname:
            return False
        infos = socket.getaddrinfo(hostname, None)  # all addr families
    except (socket.gaierror, UnicodeError, ValueError, OSError):
        return False
    if not infos:
        return False
    for _fam, _type, _proto, _canon, sockaddr in infos:
        ip_str = sockaddr[0].split("%")[0]  # strip IPv6 zone suffix
        try:
            addr = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        # IPv4-mapped IPv6 (::ffff:a.b.c.d): unwrap so is_loopback / is_private
        # correctly see IPv4 semantics. CPython attribute is None when N/A.
        mapped = getattr(addr, "ipv4_mapped", None)
        if mapped is not None:
            addr = mapped
        # RFC 2544 §4 benchmark testing range (198.18.0.0/15): publicly
        # routable IANA allocation for network benchmarking — NOT a
        # private LAN. Python's `ipaddress.is_private()` over-classifies
        # it as private, which would false-positive the gate in
        # sandbox / NAT / DNS-sinkhole setups that route public traffic
        # via this range. Exempt so legitimate upstream traffic passes.
        if addr in ipaddress.ip_network("198.18.0.0/15"):
            continue
        if (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_unspecified):
            return False
    return True


# Server-side mirror of frontend `Pages/InboxPage.tsx::extractFirstUrl`:
# when callers (curl / Python / SDK) paste a Douyin / XHS / Kuaishou
# app-share blob instead of a clean https URL, pull the first contiguous
# https URL out and shed trailing Chinese full-width punctuation. The
# regex + CN-FW punct list are byte-identical to the frontend helper —
# keep the two in lock-step so curl callers see the same contract as the
# React UI, AND so the "what does a Douyin share look like in
# production" test corpus is shared between Python + Vitest.
_SHARE_URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)
_TRAILING_CN_PUNCT_RE = re.compile(r"[，。！？、；：「」『』]+$")


def _extract_first_url(input_str: str) -> str | None:
    """Return the first contiguous http(s) URL found in `input_str`,
    with any trailing CN full-width punctuation stripped, or None if
    no URL is present. Mirrors the frontend helper so curl / Python
    callers get the same contract as the React UI."""
    match = _SHARE_URL_RE.search(input_str)
    if match is None:
        return None
    return _TRAILING_CN_PUNCT_RE.sub("", match.group(0))


# ── cookie wiring (Round-29 v5 Patch A+B+C):
# URL host → platform slug → cookies/<plat>_<acct>.json (QR-scan login)
#                     ↓
#          biliup storage_state JSON → Netscape flat-file
#                                     ↓
#                          yt-dlp subprocess --cookies <netscape>


_URL_HOST_TO_PLATFORM: dict[str, str] = {
    "bilibili.com": "bilibili",
    "www.bilibili.com": "bilibili",
    "douyin.com": "douyin",
    "www.douyin.com": "douyin",
    "v.douyin.com": "douyin",
    "kuaishou.com": "kuaishou",
    "www.kuaishou.com": "kuaishou",
    "v.kuaishou.com": "kuaishou",
    "xiaohongshu.com": "xiaohongshu",
    "www.xiaohongshu.com": "xiaohongshu",
    "xhslink.com": "xiaohongshu",
    "www.xhslink.com": "xiaohongshu",
}


def _find_account_cookie_json(url: str) -> Path | None:
    """Round-29 v5 Patch A look-up: URL host → platform slug → first
    matching `cookies/<plat>_<acct>.json` (saved by QR-scan login in
    `uploader/*/main.py`). Returns the JSON path (still in biliup /
    storage_state format — caller converts to Netscape via
    `_biliup_to_netscape`). Returns None if no host→platform mapping
    OR no cookie file exists for the matched platform.

    Bunny-tail: scan `_account_files(platform)` only for the matched
    platform (not all) — keeps the filesystem walk O(accounts of one
    platform) instead of O(all accounts × all platforms). For a 6-platform
    project with N accounts per platform this is ~6× cheaper.
    """
    hostname = (urlparse(url).hostname or "").lower()
    platform = _URL_HOST_TO_PLATFORM.get(hostname)
    if not platform:
        return None
    for entry in _account_files(platform):
        path = Path(entry["path"])
        if path.exists():
            return path
    return None


def _biliup_to_netscape(cookie_json: Path) -> Path | None:
    """Round-29 v5 Patch B (Q3 ephemeral): biliup storage_state JSON
    (saved by QR-scan login at `uploader/bilibili_uploader/main.py:24`)
    → Netscape flat-file (yt-dlp `--cookies` expects this format).

    Q3 polish: writes to ephemeral tmp `INBOX_DIR/.yt_cookies_<hash>.txt`
    (caller unlinks after subprocess). Cookies do NOT survive process
    lifetime on disk. Returns None if cookie list is empty — caller
    then skips `--cookies` arg + records Q4 `cookie_err` for the
    502-message surface.

    Biliup shapes supported (both observed in QR-scan logs):
      • `[ {name, value, domain, path, expires}, ... ]` (raw list)
      • `{ cookies: [...], origins: [...] }` (Playwright storage_state)
    Netscape shape per cookie (one line, tab-separated):
      `<domain>\t<flag subdomains>\t<path>\t<secure>\t<expires>\t<name>\t<value>`
    `expires=-1` (session cookie in biliup) → emit 0 so yt-dlp treats
    it as session-not-stale.

    Filename fingerprint: 8-char md5 prefix of source cookie_json
    path. Deterministic so concurrent requests for different account
    cookies don't collide. Race-window vs. same-source: `_inbox_sem`
    serializes per-process, but different accounts get distinct md5s
    because their cookie_json paths differ.
    """
    import hashlib
    raw = json.loads(cookie_json.read_text(encoding="utf-8"))
    cookies = raw if isinstance(raw, list) else (raw.get("cookies") or [])
    if not cookies:
        return None  # Q3/Q4 short-circuit: caller skips --cookies arg
    fingerprint = hashlib.md5(str(cookie_json).encode()).hexdigest()[:8]
    out = INBOX_DIR / f".yt_cookies_{fingerprint}.txt"
    lines = [
        "# Netscape HTTP Cookie File",
        "# https://curl.haxx.se/rfc/cookie_spec.html",
        "",
    ]
    for c in cookies:
        domain = c.get("domain") or ""
        subdomain_flag = "TRUE" if domain.startswith(".") else "FALSE"
        path = c.get("path") or "/"
        secure = "TRUE" if c.get("secure") else "FALSE"
        expires = c.get("expires", 0)
        if not isinstance(expires, (int, float)) or expires <= 0:
            expires = 0
        lines.append(
            f"{domain}\t{subdomain_flag}\t{path}\t{secure}\t{int(expires)}\t"
            f"{c.get('name', '')}\t{c.get('value', '')}"
        )
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


# ── download: yt-dlp primary, patchright fallback ────


def _sweep_stale_yt_cookie_tmp_files() -> int:
    """Round-30 v7.2 boilerplate‑hygiene janitor (Reviewer followup i):
    on `create_app()` startup (called from web_runner/__init__.py)
    scrub stale `.yt_cookies_<hash>.txt` tmp files left in INBOX_DIR
    from prior crashed/orphan runs. `_try_ytdlp`'s Q3 unlink normally
    cleans these, but a docker-killed process or socket-timeout
    interrupted the finally block can leave them orphaned. Cookies
    ARE plaintext session tokens — boot-scrubbing is a privacy
    hygiene guarantee. Returns file count removed (logged)."""
    if not DIR.exists():
        return 0
    count = 0
    for stale in DIR.glob(".yt_cookies_*.txt"):
        try:
            stale.unlink(missing_ok=True)
            count += 1
        except OSError:
            pass  # best-effort; on crash loop next boot retries
    return count


def _candidate_filepath(head: dict, info: dict) -> str | None:
    """Round-30 v7.2 refactor (Reviewer followup ii): extract the
    5-step filepath fallback chain (locked by
    `test_dl_uses_filepath_fallback_when_no_requested_downloads`
    Variant 2 + `test_dl_passes_account_cookies_for_bilibili_url`
    Variant 1) into a named helper so the chain itself becomes
    a single named constant for future maintainers — a one-line
    review change shows progress / regressions; the inline chain
    would force readers to mentally evaluate 5 ORs every time.

    Returns the first non-None value across these 5 candidate
    fields, in priority order, or None if all are absent:

      1. `head["filepath"]` — modern post-merge / remux
         (most common path; pins Variant 1 test).
      2. `head["filename"]` — preprocessor-only estimate inside
         a `requested_downloads[0]` entry (rare extractor branch).
      3. `info["file_path"]` — older yt-dlp versions (≤ 2023.x).
      4. `info["filename"]` — preprocessor-only estimate,
         top-level fallback (legacy single-file extractors).
      5. `info["filepath"]` — current ≥ 2024.05; pins Variant 2
         test (the symmetric fallback branch).

    Read-only against yt-dlp's info dict; no postprocessor side
    effects. The returned string is NOT trusted by the caller —
    `_run_yt_dlp_inner`'s `p.exists()` is the final arbiter on
    whether yt-dlp actually wrote a real file.

    Ponytail: same `or`-chain semantics as the inline version —
    the OR returns the first truthy value, so empty strings fall
    through (defensive: a future yt-dlp bug emitting "" instead
    of None will still resolve to a real path). No behavioral
    change vs the inline version; pure readability refactor.
    """
    return (
        head.get("filepath")
        or head.get("filename")
        or info.get("file_path")
        or info.get("filename")
        or info.get("filepath")
    )


@bp.post("/api/inbox/download")
def dl() -> Response:
    """Download a video from a share URL.

    Tries yt-dlp first. If it fails, falls through to a generic
    patchright browser scrape — no per-platform adapter table.
    """
    raw = ((request.get_json(silent=True) or {}).get("url") or "").strip()
    if not raw:
        return jsonify({"success": False, "message": "url required"}), 400
    # Server-side mirror of frontend `extractFirstUrl`
    # (Pages/InboxPage.tsx). Round-19 sec fix (sec-2): drop the
    # `startswith` short-circuit that let
    # `'https://attacker.example/x.mp4 假 appshare 后缀'` pass
    # through unchanged to `_try_ytdlp` / `_try_patchright`, where
    # the embedded Chinese text would be parsed as part of the URL
    # path or query. The regex still does the right thing for a clean
    # input (returns the URL byte-identical), so always running it is
    # uniform and patch-overridable in one place.
    url = _extract_first_url(raw) or ""
    if not url:
        return jsonify({"success": False, "message": "no http(s) url found"}), 400
    # SSRF gate (literal-IP). Closes direct literalization attacks.
    if not _is_public_url(url):
        return jsonify({"success": False, "message": "url rejected (private/loopback)"}), 400
    # Round-19 sec fix (sec-1): DNS-resolution gate (v0.1 TOCTOU
    # defense). `_is_public_url` only catches LITERAL private IPs in
    # the URL string — a public-looking hostname like
    # `attacker.example` that resolves to a private IP at chromium /
    # resolver time slipped through. `_resolve_is_public` closes the
    # gap by DNS-resolving the hostname here, on the Flask request
    # thread. Synchronous is fine; ~ms-scale resolver roundtrip. The
    # same gate is also used inside `_scrape_video_src` (patchright
    # async path) and `_try_patchright` (resolved src) — this `dl()`
    # call is the third checkpoint so `_try_ytdlp` cannot bypass the
    # gate via appshare-extracted input.
    if not _resolve_is_public(url):
        return jsonify({"success": False, "message": "url rejected (dns private/loopback)"}), 400
    if not acquire_inbox_slot():
        # ponytail: 429 with Retry-After hint at BOTH the HTTP header level
        # (HTTP standard — CDNs / curl / browsers honor it) AND the JSON body
        # (existing client-visible contract). No engine is launched.
        resp = jsonify({"success": False,
                        "message": "inbox saturated — try again shortly",
                        "retry_after_sec": 30})
        resp.headers["Retry-After"] = "30"
        return resp, 429

    try:
        bbdown_err = ""
        patchright_err = ""
        if _is_bilibili(url) and _bbdown_available():
            out, bbdown_err = _try_bbdown(url)
            engine = "bbdown"
            if out is None:
                _task_log(f"[inbox] BBDown failed, falling back to yt-dlp: {bbdown_err}")
        elif _needs_browser(url):
            # Douyin/Xiaohongshu/Kuaishou: yt-dlp extractors are broken
            # or missing. Skip straight to patchright (real browser gets
            # the <video> src which is watermark-free).
            out, patchright_err = _try_patchright(url)
            engine = "patchright"
        else:
            out = None
        if out is None:
            out, ytdlp_err = _try_ytdlp(url)
            engine = "yt-dlp"
        if out is None and patchright_err == "":
            out, patchright_err = _try_patchright(url)
            engine = "patchright"
        if out is None:
            # Round-7 polish: probe cookie-staleness BEFORE composing
            # the 502 — if cookies are aged over the threshold,
            # surface a refresh hint as the LEADING prefix (so the
            # most actionable advice is the first thing the user
            # sees). `_cookie_freshness_diagnostic` returns None when:
            #   • URL host has no platform mapping
            #   • No cookie JSON file exists for the matched platform
            #   • Cookie mtime is fresh (under threshold)
            # Safe to call on every 502 — no file state mutated,
            # pure-function inspection of platform cookie mtime.
            #
            # `INBOX_LOG_COOKIE_DIAG=1` (truthy env var) wraps the
            # helper with `pre-state + post-state` debug log lines so
            # the on-call can see exactly which guard rule fired
            # without re-running the request. Defaults to no-op so
            # production logs stay clean.
            _log_cookie_diag_pre_state(url)
            age_diag = _cookie_freshness_diagnostic(url)
            _log_cookie_diag_post_state(age_diag)
            if age_diag:
                _task_log(f"[inbox] refresh-suspected: {age_diag}")
            # Surface both engines' last-known err to the user (capped
            # 500 chars) so they can decide between retry-with-cookie /
            # yt-dlp -U / different platform — without grepping
            # `.sau-logs/`. Pre-v0.2 the message was a generic
            # `'yt-dlp + patchright both failed for this URL'` which
            # leaked no diagnostic info to the UI. Round-7 keeps the
            # cap but prepends the cookie-age diagnostic when present.
            combined = (
                (f"{age_diag}; " if age_diag else "")
                + (f"BBDown failed: {bbdown_err}; " if bbdown_err else "")
                + f"yt-dlp failed: {ytdlp_err or 'unknown'}; "
                + f"patchright also failed: {patchright_err or 'unknown'}"
            )
            return jsonify({"success": False, "message": combined[:500]}), 502
        return jsonify({"success": True, "filename": out.name, "engine": engine, "dir": str(out.parent)})
    finally:
        release_inbox_slot()


def _try_ytdlp(url: str) -> tuple[Path | None, str]:
    """Returns (out_path, err). `err` is empty on success; on
    failure it's a short human-readable reason (last ~200 chars of
    yt-dlp error or `'no info'` / `'no output file'`) — surfaced to
    the user via the 502 path in `dl()` so they can eyeball the
    real yt-dlp error without grepping `.sau-logs/`. `_task_log`
    calls remain so server-side observability is preserved.

    Round-29 v5→v7 wiring preserved: when the URL host maps to a
    known platform slug (`_URL_HOST_TO_PLATFORM`) and a matching
    `cookies/<plat>_<acct>.json` exists (saved by QR-scan login),
    `_biliup_to_netscape` converts to Netscape flat-file + we set
    `cookiefile` in `ydl_opts` so yt-dlp can authenticate against
    host anti-bot (e.g. B站 SESSDATA). Tmp cookie file is unlinked
    by `finally:` after the `yt_dlp.YoutubeDL` context manager
    exits, regardless of outcome — privacy-first, cookies do not
    survive process lifetime on disk.

    Q4 negative-path bleed: cookie_err (`"no usable cookies in cookie
    file"` / `"cookie-convert failed (...)"`) prefixes the returned
    err via `_maybe_prefix_cookie_err` so the 502 message tells the
    user WHY their cookies didn't help.

    v7 migration (Round-30): switched from subprocess yt-dlp CLI
    to `yt_dlp.YoutubeDL` Python API (open-source library). Tradeoffs:
      ✔ In-process: no subprocess spawn; structured error classes
        (`DownloadError` / `ExtractorError`) capture stderr-equivalent
        context without manual stderr-tail parsing.
      ✔ cookiefile kwarg: native Netscape-file support, no manual
        `--cookies` argv injection.
      ✔ Postprocessor-aware filepath: `requested_downloads[0]
        ['filepath']` reflects merge/remux output, unlike
        `--print after_move:filepath` which would have been parsed
        from stdout in the subprocess variant.
      ✘ Wall-clock timeout: `subprocess.run(timeout=180)` is gone
        (we'd have SIGKILLed the whole subprocess tree). Network
        hang control via `socket_timeout=60` + yt-dlp internal
        retry/backoff. A CPU-bound infinite loop in yt-dlp itself
        would NOT auto-kill — accepted v0.x trade-off for in-process
        simplicity. Workaround at production scale: outer watchdog
        task bounded by acquire_inbox_slot's per-call timeout.
    """
    cookie_json = _find_account_cookie_json(url)
    netscape_path: Path | None = None
    cookie_err = ""
    if cookie_json:
        try:
            netscape_path = _biliup_to_netscape(cookie_json)
            if netscape_path is not None:
                _task_log(f"[inbox] yt-dlp using cookies: {cookie_json.name}")
            else:
                # Q4 short-circuit: empty cookie list → "no usable cookies"
                # so user knows their QR-scan returned no auth material.
                cookie_err = "no usable cookies in cookie file"
                _task_log(f"[inbox] {cookie_err}: {cookie_json.name}")
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            # Q4 surface: conversion error type + brief reason
            cookie_err = (
                f"cookie-convert failed ({type(exc).__name__}: {exc})"
            )
            _task_log(f"[inbox] {cookie_err} for {cookie_json.name}")
    ydl_opts: dict = {
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "outtmpl": str(DIR / "%(epoch>%H%M%S)s_%(id)s.%(ext)s"),
        "socket_timeout": 60,
        # Prefer best video + best audio merged into mp4. For platforms
        # like Douyin, yt-dlp exposes both watermarked (combined, lower
        # quality) and watermark-free (separate streams, higher quality)
        # formats. bv+ba picks the separate streams which are typically
        # the clean, non-watermarked version.
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
    }
    if netscape_path is not None:
        ydl_opts["cookiefile"] = str(netscape_path)

    def _run_yt_dlp_inner(opts: dict, url_arg: str) -> Path:
        """v7.1 inner: drives `yt_dlp.YoutubeDL` and returns the
        downloaded file path. RAISES yt-dlp exceptions on failure
        so the caller controls translation to `(None, err_str)` pairs.
        Hoisted out of `_try_ytdlp`'s body so the ThreadPoolExecutor
        wrap below can call it as a single `submit()` target — this
        preserves the wall-clock timeout invariant that
        `subprocess.run(timeout=180)` provided in the pre-v7 path.

        Filepath keypath chain (Round-30 v7.1 review):
          1. `info["requested_downloads"][0]["filepath"]` — modern,
             post-merge / remux for HLS / DASH + separate-streams
          2. `info["requested_downloads"][0]["filename"]` —
             preprocessor estimate fallback (rare extractor branch)
          3. `info["file_path"]` — older yt-dlp versions
          4. `info["filename"]` — preprocessor estimate (legacy)
          5. `info["filepath"]` — current ≥ 2024.05 (same as #1
             after next ydl release deprecates requested_downloads)
        All three of the v7 review-blocking fallback fields 3/4/5 are
        covered so a future yt-dlp keypath drift does NOT silently
        brick the green path; `tests/test_inbox.py` has dedicated
        test coverage pinning each branch.
        """
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url_arg, download=True)
            if not info:
                raise yt_dlp.utils.DownloadError("yt-dlp returned no info")
            downloads = info.get("requested_downloads") or [info]
            head = downloads[0] if isinstance(downloads[0], dict) else {}
            # v7.2: 5-step fallback chain factored into `_candidate_filepath`
            # (above). See helper docstring for the priority ordering +
            # the test invariants pinning Variant 1 (modern) + Variant 2
            # (legacy flat info) shapes.
            filepath = _candidate_filepath(head, info)
            p = Path(str(filepath)) if filepath else None
            if not (p and p.exists()):
                raise yt_dlp.utils.DownloadError(
                    "yt-dlp metadata ok but no output file"
                )
            return p

    try:
        # v7.1 wall-clock guard. `subprocess.run(timeout=180)` is
        # GONE (no subprocess tree anymore). Without an explicit
        # deadline, yt-dlp's internal HTTP retry loop could hold a
        # Flask worker indefinitely. We offload the blocking call
        # to a one-shot thread pool + cap with
        # `future.result(timeout=_DL_TIMEOUT_SEC)`, so a stuck call
        # releases the WSGI worker at the deadline with a
        # `concurrent.futures.TimeoutError`.
        #
        # Orphan trade-off: bg thread MAY keep running past the
        # deadline (CPython `future.cancel()` only sets a flag;
        # blocking I/O cannot be interrupt-thread-safely). We accept
        # this because:
        #   (a) `socket_timeout=60` already in opts → bg thread will
        #       die naturally on next socket-level timeout;
        #   (b) one orphan thread per ~3-minute stuck-call is a far
        #       smaller cost than an indefinitely-held WSGI worker;
        #   (c) Q3 cookie unlink in `finally:` is SAFE even if the
        #       orphan has the cookie file open — POSIX `unlink()`
        #       only removes the dirent; the bg thread's read finishes
        #       when its fd refcount → 0 (Linux/macOS semantics).
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_run_yt_dlp_inner, ydl_opts, url)
            try:
                p = future.result(timeout=_DL_TIMEOUT_SEC)
                return p, ""
            except concurrent.futures.TimeoutError:
                _task_log(
                    f"[inbox] yt-dlp wall-clock timeout "
                    f"({_DL_TIMEOUT_SEC}s): {url[:80]}"
                )
                return None, _maybe_prefix_cookie_err(
                    cookie_err,
                    f"yt-dlp timed out after {_DL_TIMEOUT_SEC}s wall-clock",
                )
    except yt_dlp.utils.DownloadError as exc:
        # `DownloadError.msg` carries the stderr-equivalent detail
        # (e.g. "ERROR: [BiliBili] BVxxx: HTTP Error 412"). Fall back
        # to `str(exc)` when `.msg` is missing (older yt-dlp builds).
        msg = getattr(exc, "msg", None) or str(exc)
        stderr_tail = msg.strip()[-200:] or "no stderr"
        _task_log(f"[inbox] yt-dlp failed for {url[:80]}: {stderr_tail}")
        return None, _maybe_prefix_cookie_err(cookie_err, stderr_tail)
    except yt_dlp.utils.ExtractorError as exc:
        # URL parse / extractor failures (unsupported URL, geo-block).
        msg = getattr(exc, "msg", None) or f"ExtractorError: {exc}"
        stderr_tail = msg.strip()[-200:]
        _task_log(f"[inbox] yt-dlp ExtractorError: {stderr_tail}")
        return None, _maybe_prefix_cookie_err(cookie_err, stderr_tail)
    except Exception as exc:
        # Defensive: yt-dlp internal crash, fmt-string error, etc.
        # Bare-Exception catch prevents one broken extractor from
        # taking down the Flask worker — yt-dlp's plugin surface
        # has had historical bugs at this level.
        _task_log(f"[inbox] yt-dlp crashed: {type(exc).__name__}")
        return None, _maybe_prefix_cookie_err(
            cookie_err, f"yt-dlp crashed ({type(exc).__name__})"
        )
    finally:
        # Q3 ephemeral cleanup: unlink tmp cookie file after the
        # threadpool `with` block exits regardless of outcome so
        # SESSDATA-equivalent cookies do NOT survive process
        # lifetime on disk. POSIX semantics: `unlink(missing_ok=True)`
        # removes the dirent immediately and is safe to call even
        # while a bg thread holds the file fd open — the orphan
        # reader will finish when its own fd is closed (via the
        # socket_timeout=60 path or natural completion).
        if netscape_path is not None:
            try:
                netscape_path.unlink(missing_ok=True)
            except OSError:
                pass


def _maybe_prefix_cookie_err(cookie_err: str, base_err: str) -> str:
    """Q4 helper: compose cookie diagnostic prefix into user-visible
    err string. Returns `base_err` unchanged when `cookie_err` empty;
    otherwise returns `f\"cookie err: {cookie_err}; yt-dlp: {base_err}\"`.

    Kept module-local next to `_try_ytdlp` (its only caller). The
    `combined[:500]` cap in `dl()` already truncates long stderr, so
    this prefix adds at most ~80 chars in pathological cases.
    """
    if not cookie_err:
        return base_err
    return f"cookie err: {cookie_err}; yt-dlp: {base_err}"


# Per-platform refresh commands used by `_cookie_freshness_diagnostic`
# when surfacing a cookie-staleness hint to a 502 message. Keyed by
# platform slug so a single dict lookup answers "how do I refresh this
# platform's cookies?". A platform without a CLI extractor (e.g. legacy
# ones that were QR‑scan only) gets the `/dashboard` flow as
# fallback guidance.
_REFRESH_HINT_BY_PLATFORM: dict[str, str] = {
    "douyin":      "scripts/refresh_douyin_cookies.py (see docs/douyin-cookie-pipeline.md)",
    "bilibili":    "the QR-scan login flow at /dashboard",
    "kuaishou":    "the QR-scan login flow at /dashboard",
    "xiaohongshu": "the QR-scan login flow at /dashboard",
    "tencent":     "the QR-scan login flow at /dashboard",
    "tiktok":      "the QR-scan login flow at /dashboard",
    "baijiahao":   "the QR-scan login flow at /dashboard",
}
_COOKIE_STALENESS_THRESHOLD_HOURS = 24

# Q3 lockstep invariant (Round-7 review): a future PR that adds a
# new platform to `_URL_HOST_TO_PLATFORM` MUST also add a refresh hint
# here; otherwise users see the generic "the {platform} refresh path"
# fallback with zero actionable guidance. Failing at module-import
# time (`create_app()` boot path) catches this drift loudly.
# Explicit `if missing: raise` — NOT `assert` — so the invariant
# survives `python -O` (uvicorn/gunicorn invocations in containerized
# prod deploys frequently launch with -O, which strips asserts and
# would silently drop this lockstep check otherwise).
_missing_refresh_hints = (
    set(_URL_HOST_TO_PLATFORM.values()) - set(_REFRESH_HINT_BY_PLATFORM)
)
if _missing_refresh_hints:
    raise RuntimeError(
        "_REFRESH_HINT_BY_PLATFORM is missing entries for: "
        f"{sorted(_missing_refresh_hints)}"
    )


def _cookie_freshness_diagnostic(url: str) -> str | None:
    """Round-7 polish: when both engines fail for an anti-bot-walled
    platform, surface the cookie file's age (when stale) so the user
    sees a refresh hint in the 502. Returns None when:
      • URL host has no platform mapping
      • No cookie JSON file exists for the matched platform
      • Cookie file is mtime-fresh (under `_COOKIE_STALENESS_THRESHOLD_HOURS`)
      • Cookie file is missing/unreadable on disk

    The threshold of 24h aligns with community-reported cookie rotation
    cadence for the anti-bot platforms (Douyin's `__live_version__`
    rotates roughly every 2 weeks; `__ac_nonce` rotates on every nav).
    24h is a conservative lower bound — cookies older than that are very
    likely to hit the Fresh-cookies reject on the next POST.

    The diagnostic string is built into the leading 502 message prefix
    in `dl()` so it's the first thing the user sees when copy-pasting
    the error back into the issue tracker.
    """
    hostname = (urlparse(url).hostname or "").lower()
    platform = _URL_HOST_TO_PLATFORM.get(hostname)
    if not platform:
        return None
    for entry in _account_files(platform):
        try:
            mtime = Path(entry["path"]).stat().st_mtime
        except OSError:
            continue
        age_hours = (time.time() - mtime) / 3600
        if age_hours > _COOKIE_STALENESS_THRESHOLD_HOURS:
            hint = _REFRESH_HINT_BY_PLATFORM.get(
                platform, f"the {platform} refresh path"
            )
            return (
                f"{platform} cookies are {int(age_hours)}h old "
                f"(>{_COOKIE_STALENESS_THRESHOLD_HOURS}h threshold); "
                f"this may explain the anti-bot reject; refresh via {hint}"
            )
    return None


# ── debug fingerprint (opt-in via env var) ─────────
# `INBOX_LOG_COOKIE_DIAG=1` turns on verbose per-request logging of
# the inputs `_cookie_freshness_diagnostic` saw (URL host → platform
# mapping, `_account_files(...)` content) and its return value. Used
# by on-call to verify which guard rule actually fired during a 502 —
# without the flag, the user-visible 502 message only contains the
# final hint, so a silent URL host miss / empty cookie walk / fresh
# mtime tested in isolation was a 30-min roundtrip. Production logs
# stay clean because the env var defaults to empty/falsy. Truthy
# strings: 1 / true / yes / on (case-insensitive).
_INBOX_LOG_COOKIE_DIAG_VALUES = ("1", "true", "yes", "on")


def _is_cookie_diag_logging_enabled() -> bool:
    """Round-7 debug-fingerprint gate. Reads the env var at call time
    (NOT at import time) so tests can `monkeypatch.setenv` mid-test
    without re-importing the module. The strip+lower normalization
    guards against accidentally leaving a trailing newline / Windows
    line-ending character in a copy-pasted `.env` value from a shell-
    friendly editor."""
    val = os.environ.get("INBOX_LOG_COOKIE_DIAG", "").strip().lower()
    return val in _INBOX_LOG_COOKIE_DIAG_VALUES


def _log_cookie_diag_pre_state(url: str) -> None:
    """Round-7 debug-fingerprint pre-helper. Log the URL host, the
    platform slug `_URL_HOST_TO_PLATFORM` resolved it to, and the
    `_account_files(...)` list (basenames + count) before the
    freshness diagnostic walks them — so the on-call can verify
    whether the helper returned None because (a) host had no
    platform mapping, (b) cookie walk was empty for the platform,
    or (c) mtime was under threshold. No-op when the env-var
    gate is off, so production logs stay quiet.

    Defensive (opt-in debug must NEVER break prod 502): `_account_files(plat)`
    can raise `OSError` on a mispermissioned COOKIES_DIR, and the
    basename extraction can raise `KeyError` if a future refactor
    changes the dict shape. We swallow both + fall back to an
    empty `files=[]` so the debug flag NEver converts a working
    502 into a 500 — opt-in debugging must not break the request
    path it was meant to inspect.
    """
    if not _is_cookie_diag_logging_enabled():
        return
    hostname = (urlparse(url).hostname or "").lower()
    plat = _URL_HOST_TO_PLATFORM.get(hostname)
    try:
        files = _account_files(plat) if plat else []
        names = ",".join(
            Path(f["path"]).name
            for f in files
            if isinstance(f, dict) and "path" in f
        )
    except (OSError, KeyError, AttributeError):
        files = []
        names = ""
    _task_log(
        f"[inbox] INBOX_LOG_COOKIE_DIAG=1 pre-state "
        f"host={hostname!r} platform={plat!r} "
        f"account_files_count={len(files)} "
        f"account_files=[{names}]"
    )


def _log_cookie_diag_post_state(age_diag: str | None) -> None:
    """Round-7 debug-fingerprint post-helper. Log the freshness
    diagnostic's verdict (the leading-prefix string, or None when
    hint should NOT fire). Pair with `_log_cookie_diag_pre_state`
    so a single copy-pasted `[FAIL] 502` log line gives the on-call
    the full pre/post decision tree without re-running the request.
    No-op when the env-var gate is off."""
    if not _is_cookie_diag_logging_enabled():
        return
    _task_log(
        f"[inbox] INBOX_LOG_COOKIE_DIAG=1 post-state "
        f"freshness_diag_return={age_diag!r}"
    )


async def _scrape_video_src(url: str) -> str | None:
    """Open the share URL with patchright as a mobile browser and return the
    resolved <video> src. Returns None on any failure (incl. DNS-rebind reject)."""
    from patchright.async_api import async_playwright
    # DNS-rebinding guard (v0.1): resolve the host BEFORE spending ~5s
    # launching chromium. `asyncio.to_thread` is essential here — a sync
    # DNS lookup on the event loop would block Playwright's IPC coroutine
    # for the full resolver roundtrip and frequently drop the chromium
    # connection on slow resolvers. NOTE: this is best-effort, not TOCTOU-
    # safe against chromium-internal rebind (chromium re-resolves later
    # using its own DNS client); the strong guarantee comes from the
    # context.route() interceptor below rejecting post-resolve IPs.
    if not await asyncio.to_thread(_resolve_is_public, url):
        _task_log(f"[inbox] patchright abort: {url[:80]} resolves to private/loopback IP")
        return None
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            ctx = await browser.new_context(
                user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                            "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                            "Version/17.0 Mobile/15E148 Safari/604.1"),
                viewport={"width": 390, "height": 844},
            )

            # Chromium-level SSRF guard (B0 + SW fix v0.1): register the
            # route on the CONTEXT (not the page) so that service-worker
            # fetches — which bypass `page.route()` per Chromium isolation
            # rules — are also gated. Across the same chromium context,
            # `context.route` is also the primary handler for main-frame
            # requests, so we drop the `page.route` call entirely to
            # avoid double-handling and reverse-order-consumption
            # ambiguity in Playwright's route stack. The handler stays
            # sync (string-only `_is_public_url`); see the comment in
            # `_resolve_is_public` for why we deliberately do NOT run
            # DNS resolution per sub-request (TOCTOU + 50+ blocking
            # lookups per share page would crush Playwright IPC).
            async def _intercept(route, request):
                if _is_public_url(request.url):
                    await route.continue_()
                else:
                    await route.abort()
            await ctx.route("**/*", _intercept)

            page = await ctx.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            await page.wait_for_selector("video", timeout=30_000)
            return await page.eval_on_selector(
                "video", "el => el.currentSrc || el.src || null",
            ) or None
        finally:
            await browser.close()


_MIN_VIDEO_BYTES = 64 * 1024


def _guess_ext_from_magic(data: bytes) -> str | None:
    """Inspect the first 16 bytes of `data` to guess the true file extension.
    Returns e.g. '.mp4', '.webm', or None if no known signature matches.
    This fixes the '.bin' fallback that happens when the CDN URL does not
    contain a recognisable extension (common for Douyin / Kuaishou video src).
    """
    if len(data) < 12:
        return None
    # MP4 / ISO Base Media — 'ftyp' box at offset 4
    if data[4:8] == b"ftyp":
        # Could also be .mov, .m4v, etc., but .mp4 is the safest default
        # for the platforms we handle.
        return ".mp4"
    # WebM / Matroska — EBML header
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return ".webm"
    # MPEG-TS — sync byte 0x47 at packet boundaries (offset 0 or 188)
    if data[0] == 0x47:
        return ".ts"
    return None
# 64KB: m3u8 manifests + HTML redirect snippets are < 10KB; 64KB still tight while letting 720p 10s clips pass.
# Path C (post-Round-19): DELIBERATELY do not deep-fetch m3u8 in `_try_patchright`. yt-dlp owns the path;
# 1000+ segments / stream + cookie-transport + per-seg SSRF + master-playlist / AES-128 + ffmpeg-remux
# exceed pony-minimal budget. If a future platform requires it: re-visit via a `m3u8` Rust-crate pyo3
# port, not a handrolled parser.
# Anchor: DESIGN.md -> boundaries.m3u8-deep-fetch (sibling of boundaries.marketing-surface)
# + openspec/changes/project-optimization/tasks.md section 7 v0.2 polish candidates.


def _is_bilibili(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return "bilibili.com" in hostname


# Platforms where yt-dlp extractors are broken/unreliable:
# - Douyin: needs s_v_web_id anti-bot cookie (generated by JS challenge)
# - Xiaohongshu: page needs JS rendering, noteDetailMap empty via HTTP
# - Kuaishou: no yt-dlp extractor exists at all
_BROWSER_FIRST_PLATFORMS = ("douyin.com", "kuaishou.com", "xiaohongshu.com", "xhslink.com")


def _needs_browser(url: str) -> bool:
    """True if yt-dlp is unreliable for this URL — skip to patchright."""
    hostname = (urlparse(url).hostname or "").lower()
    return any(p in hostname for p in _BROWSER_FIRST_PLATFORMS)


def _bbdown_available() -> bool:
    """Check if BBDown is on PATH."""
    try:
        subprocess.run(["BBDown", "--version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _extract_sessdata(cookie_json: Path) -> str | None:
    """Extract SESSDATA value from biliup cookie JSON for BBDown."""
    try:
        raw = json.loads(cookie_json.read_text(encoding="utf-8"))
        cookies = raw if isinstance(raw, list) else (raw.get("cookies") or [])
        for c in cookies:
            if c.get("name") == "SESSDATA":
                return c["value"]
    except Exception:
        pass
    return None


def _try_bbdown(url: str) -> tuple[Path | None, str]:
    """Try downloading a Bilibili video via BBDown with TV API
    (watermark-free source). Uses project's bilibili cookies for auth.
    Returns (out_path, err) like _try_ytdlp."""
    before = set(DIR.glob("*.mp4"))
    # Reuse project's bilibili cookie (SESSDATA) so no separate
    # BBDown login is needed.
    cmd = ["BBDown", url, "-tv"]
    cookie_json = _find_account_cookie_json(url)
    if cookie_json:
        sessdata = _extract_sessdata(cookie_json)
        if sessdata:
            cmd.extend(["--cookie", sessdata])
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=_DL_TIMEOUT_SEC,
            cwd=str(DIR),
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "unknown error")[-200:]
            return None, f"BBDown failed: {err}"
        # Find new mp4 files that appeared after download
        after = set(DIR.glob("*.mp4"))
        new_files = after - before
        if new_files:
            return max(new_files, key=lambda p: p.stat().st_mtime), ""
        # Fallback: newest mp4 in DIR
        candidates = sorted(
            DIR.glob("*.mp4"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if candidates:
            return candidates[0], ""
        return None, "BBDown completed but no output file found"
    except subprocess.TimeoutExpired:
        return None, f"BBDown timed out after {_DL_TIMEOUT_SEC}s"
    except FileNotFoundError:
        return None, "BBDown not installed"


def _try_patchright(url: str) -> tuple[Path | None, str]:
    """Same shape as `_try_ytdlp`: returns (out_path, err). err is empty
    on success; on failure it's a short reason string surfaced via the
    502 message so the user can see WHY patchright failed without
    grepping logs (`_task_log` calls remain for server-side observability)."""
    try:
        src: str | None = asyncio.run(_scrape_video_src(url))
    except Exception as exc:
        _task_log(f"[inbox] patchright browser crash: {type(exc).__name__}")
        return None, f"browser crashed ({type(exc).__name__})"
    if not src:
        return None, "no <video> src (login-walled, JS-SPA, or non-HTML5)"
    if not _is_public_url(src):
        _task_log(f"[inbox] patchright resolved src rejected (private/loopback): {src[:120]}")
        return None, "video src private/loopback"
    # v0.1: also resolve the <video> src before urllib hits it, since the
    # src hostname may differ from the page hostname (CDN host) and could
    # be a rebinding target that escaped the page-level gate. Sync is fine
    # here — we're back on the Flask request thread after asyncio.run.
    if not _resolve_is_public(src):
        _task_log(f"[inbox] patchright resolved src's DNS is private/loopback: {src[:120]}")
        return None, "video src DNS private/loopback"
    try:
        # ponytail: stdlib urllib, not `requests`. Cap 200 MB.
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = resp.read(200 * 1024 * 1024 + 1)
        if len(data) > 200 * 1024 * 1024:
            _task_log("[inbox] patchright fallback file too large (>200MB)")
            return None, "file too large (>200MB)"
        if len(data) < _MIN_VIDEO_BYTES:
            # B2 fix: m3u8 manifests / redirect HTML are < 50 KB; never
            # report them as a successful video download.
            _task_log(f"[inbox] patchright fallback too small ({len(data)}B) — likely m3u8/HTML, rejected")
            return None, f"file too small ({len(data)}B, likely m3u8/HTML)"
        suffix = ".mp4" if ".mp4" in src.lower() else Path(src.split("?")[0]).suffix or ".bin"
        out = DIR / f"{int(time.time())}_fb{abs(hash(src)) % 10**6}{suffix}"
        out.write_bytes(data)
        # Fix extension from magic bytes when URL-based guessing failed
        # (e.g. Douyin CDN src has no '.mp4' in the URL → '.bin' fallback).
        real_ext = _guess_ext_from_magic(data)
        if real_ext and suffix != real_ext:
            new_out = out.with_suffix(real_ext)
            try:
                out.rename(new_out)
                out = new_out
            except OSError:
                pass  # keep original name if rename fails
        return out, ""
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        _task_log(f"[inbox] patchright urlopen failed: {type(exc).__name__}")
        return None, f"urlopen failed ({type(exc).__name__})"


# ── transcribe: OpenAI Whisper streaming ────


@bp.post("/api/inbox/transcribe")
def tx() -> Response:
    name = ((request.get_json(silent=True) or {}).get("filename") or "").strip()
    p = DIR / name
    if not p.exists() or not p.is_file():
        return jsonify({"success": False, "message": "not found"}), 404
    if not (key := os.environ.get("OPENAI_API_KEY", "")):
        return jsonify({"success": False,
                        "message": "set OPENAI_API_KEY (or upgrade to local whisper)"}), 503
    if not acquire_inbox_slot():
        # ponytail: fail-fast 429 BEFORE reading the (potentially large) file
        # payload into the OpenAI POST — Whisper uploads can hold a thread for
        # 30-180s; better to reject than stack on the semaphore. Both the
        # HTTP `Retry-After` header AND the JSON body carry the hint.
        resp = jsonify({"success": False,
                        "message": "inbox saturated — try again shortly",
                        "retry_after_sec": 30})
        resp.headers["Retry-After"] = "30"
        return resp, 429

    def gen() -> Generator[bytes, None, None]:
        try:
            with p.open("rb") as f:
                r = requests.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {key}"},
                    files={"file": (name, f)},
                    data={"model": "whisper-1", "response_format": "srt"},
                    timeout=180, stream=True,
                )
                if r.status_code != 200:
                    yield f"openai error {r.status_code}: {r.text[:200]}".encode()
                    return
                for chunk in r.iter_content(chunk_size=4096):
                    if chunk:
                        yield chunk
        finally:
            release_inbox_slot()
    return Response(gen(), mimetype="text/plain; charset=utf-8")


# ── file serving ────


@bp.get("/api/inbox/file/<name>")
def serve(name: str) -> Response:
    # ponytail: no explicit auth here — global before_request hook
    # gates /api/inbox/* for non-whitelisted requests.
    return send_from_directory(str(DIR), name)


@bp.post("/api/inbox/reveal")
def reveal() -> Response:
    """Open the inbox directory (or a specific file) in the system file manager."""
    data = request.get_json(silent=True) or {}
    filename = data.get("filename")
    target = str(DIR / filename) if filename else str(DIR)
    if not os.path.exists(target):
        return jsonify({"success": False, "message": "文件不存在"}), 404
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(["open", "-R", target] if filename else ["open", target])
        elif system == "Windows":
            subprocess.Popen(["explorer", "/select,", target] if filename else ["explorer", target])
        else:
            subprocess.Popen(["xdg-open", str(DIR)])
        return jsonify({"success": True})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 500
