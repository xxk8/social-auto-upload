"""Refresh `cookies/douyin_66.json` from Chrome DevTools `Application` panel.

Ponytail one-shot: takes the four raw cookie strings extracted manually
via DevTools and writes a `storage_state`-shaped JSON file at
`cookies/douyin_66.json` that the existing
`web_runner/routes/inbox.py::_biliup_to_netscape` reader already knows
how to handle (we reuse the biliup‑flavored read path verbatim — no new
reader code).

Why this script exists (v7.2 followup): the `<douyin>` anti‑bot on
`v.douyin.com/*` rejects QR‑scan cookies that aren't actually a logged‑in
Douyin session, with `Fresh cookies (not necessarily logged in) are
needed` from yt‑dlp. The reliable path is: log into `douyin.com` on a
real Chrome instance → extract the four specific session cookies →
write them to disk in the format this codebase's existing convert
helper understands.

Usage (after extracting the four cookie values from DevTools):

    python scripts/refresh_douyin_cookies.py \\
        --sessdata '<SESSDATA value>' \\
        --ttwid '<ttwid value>' \\
        --live_version '<__live_version__ value>' \\
        --ac_nonce '<__ac_nonce value>'

The default output path is `<repo>/cookies/douyin_66.json`. Override
with `--out` if you have a non‑standard layout. A `--dry-run` flag
prints the JSON without writing, useful for sanity‑checking values
before committing them to disk.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

COOKIES_DIR = Path(__file__).resolve().parent.parent / "cookies"
DEFAULT_OUT = COOKIES_DIR / "douyin_66.json"

# The four Douyin session cookies the anti‑bot gate actually inspects
# (per the 2026‑06 community reports on v.douyin.com/* share‑link
# fetches). Empirically: missing any of these ⇒ yt‑dlp gets the
# `Fresh cookies...are needed` reject; with all four the share‑link
# reaches the live‑stream metadata endpoint cleanly.
COOKIE_SPECS = (
    ("SESSDATA",
     "SESSDATA — log‑in session token; the canonical Bilibili‑style "
     "auth cookie Douyin also reuses."),
    ("ttwid",
     "ttwid — Douyin live‑stream persistent token; refreshed on every "
     "page load but stable enough across a single login."),
    ("__live_version__",
     "__live_version__ — version stamp the live CDN edge expects; "
     "staleness flips the request into a captive login."),
    ("__ac_nonce",
     "__ac_nonce — short‑lived nonce (refreshed on every navigation); "
     "stale values force a fresh login, so re‑extract on POST failures."),
)

# Single source of truth mapping cookie name → argparse `dest` name.
# Keeps `_build_payload` from compressing both underscore‑prefixed
# cookie names (`__live_version__` / `__ac_nonce`) into a fragile
# double‑rewrite. Adding a 5th cookie later only requires one row.
_COOKIE_NAME_TO_ARG = {
    "SESSDATA": "sessdata",
    "ttwid": "ttwid",
    "__live_version__": "live_version",
    "__ac_nonce": "ac_nonce",
}


def _build_payload(args: argparse.Namespace) -> dict:
    cookies = []
    for name, _desc in COOKIE_SPECS:
        # Single source of truth: cookie name → argparse `dest` name.
        # The argparse args already declare `dest="live_version"` and
        # `dest="ac_nonce"` so we can just look up via the dict.
        arg_name = _COOKIE_NAME_TO_ARG[name]
        value = getattr(args, arg_name, None)
        if not value:
            sys.stderr.write(f"[refresh] missing value for {name}\n")
            sys.exit(2)
        cookies.append({
            "name": name,
            "value": value,
            # `.douyin.com` so the Netscape flag is `TRUE` (subdomains
            # include www.douyin.com + v.douyin.com + m.douyin.com).
            "domain": ".douyin.com",
            "path": "/",
            # `-1` = session cookie; yt‑dlp / `_biliup_to_netscape`
            # treats it as not‑stale at emission time (the helper
            # clamps non‑positive expires to 0).
            "expires": -1,
            "secure": True,
            # HttpOnly cookies can't be read by `<script>` JS, but
            # yt‑dlp's HTTPS‑only fetcher still receives them — net‑
            # neutral for our purposes.
            "httpOnly": True,
            "sameSite": "None",
        })
    # Standard Playwright storage_state shape that the existing
    # `_biliup_to_netscape` reader expects.
    return {"cookies": cookies, "origins": []}


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--sessdata", required=True,
                    help="DevTools `SESSDATA` value (Application → Cookies → https://www.douyin.com).")
    ap.add_argument("--ttwid", required=True,
                    help="DevTools `ttwid` value.")
    ap.add_argument("--live_version", required=True,
                    dest="live_version",
                    help="DevTools `__live_version__` value.")
    ap.add_argument("--ac_nonce", required=True,
                    dest="ac_nonce",
                    help="DevTools `__ac_nonce` value.")
    ap.add_argument("--out", default=str(DEFAULT_OUT),
                    help=f"Output JSON path (default: {DEFAULT_OUT}).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print payload to stdout instead of writing.")
    args = ap.parse_args()

    payload = _build_payload(args)
    text = json.dumps(payload, ensure_ascii=False, indent=2)

    if args.dry_run:
        sys.stdout.write(text + "\n")
        return

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    # Mirror the chmod‑discipline that `_get_secret_key` uses so the
    # cookies file is owner‑readable only (best‑effort hygiene).
    # Surface a warning (not silent skip) when chmod fails — a world-
    # readable cookies file is a real privacy regression, not a
    # cosmetic failure.
    try:
        out.chmod(0o600)
    except OSError as exc:
        sys.stderr.write(
            f"[refresh] WARNING: chmod 0o600 failed ({exc}); "
            f"cookies file may be world-readable\n"
        )
    sys.stdout.write(
        f"[refresh] wrote {len(payload['cookies'])} cookies to "
        f"{out} ({out.stat().st_size} bytes)\n"
    )


if __name__ == "__main__":
    main()
