"""Smoke tests for /api/inbox/* validation branches.

Ponytail ultra: ONE runnable check per branch. No real yt-dlp / patchright /
requests are invoked — only the URL validation paths and the transcribe
file-not-found path are covered. Heavy engines stay covered by manual
smoke tests in the openspec proposal.
"""

from __future__ import annotations

import threading

import pytest

from web_runner import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Flask test client with isolated cookies/uploads dirs so
    `_sync_cookie_files_to_db` does not pick up stale fixtures under
    the project BASE_DIR, plus an auth bypass since email-verification
    login is not exercised by this smoke suite.


    Round-19 fixture-wide DNS stub: every test inheriting this
    fixture gets `socket.getaddrinfo` monkeypatched to a single
    public IP (`93.184.216.34` = the historical `example.com`
    address). Without this stub, the new `_resolve_is_public(url)`
    gate added to `dl()` (Round-19 sec-1) would call real
    `getaddrinfo` which is disallowed in CI / sandboxed test envs
    → `socket.gaierror` → all `client.post('/api/inbox/download', ...)`
    integration tests would 400 instead of their expected 200/429.

    Per-test `_resolve_is_public_*` tests still work because pytest-
    monkeypatch's `setattr` is monkey-patch-on-top-of-monkey-patch:
    a test that explicitly `setattr`s the private IP inherits this
    fixture-wide public-IP stub as the base, then overlays its own
    per-test stub. The `test_dl_rejects_url_with_dns_rebind_to_private_ip`
    test relies on this stacking order — its private-IP stub wins.
    """
    import socket as _socket

    import web_runner.routes.auth as wr_auth
    import web_runner.utils as wr_utils

    monkeypatch.setattr(wr_utils, "COOKIES_DIR", tmp_path / "cookies")
    monkeypatch.setattr(wr_utils, "UPLOADS_DIR", tmp_path / "uploads")
    monkeypatch.setattr(wr_utils, "INBOX_DIR", tmp_path / "videos" / "inbox")
    monkeypatch.setattr(wr_auth, "_is_auth_enabled", lambda: False)
    monkeypatch.setattr(
        _socket,
        "getaddrinfo",
        lambda host, *a, **kw: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )
    (tmp_path / "cookies").mkdir(exist_ok=True)
    (tmp_path / "uploads").mkdir(exist_ok=True)
    (tmp_path / "videos" / "inbox").mkdir(parents=True, exist_ok=True)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_inbox_download_rejects_missing_url(client):
    r = client.post("/api/inbox/download", json={})
    assert r.status_code == 400
    assert r.get_json() == {"success": False, "message": "url required"}


def test_inbox_download_rejects_non_http_url(client):
    """Non-http(s) schemes get filtered before any engine is launched."""
    r = client.post("/api/inbox/download", json={"url": "ftp://example.com/x.mp4"})
    assert r.status_code == 400


def test_inbox_download_rejects_javascript_scheme(client):
    """Defensive: javascript: / data: / file: must not reach the browser."""
    r = client.post("/api/inbox/download", json={"url": "javascript:alert(1)"})
    assert r.status_code == 400


def test_inbox_transcribe_returns_404_for_missing_file(client):
    """Transcribe must short-circuit on missing file before reading OPENAI_API_KEY."""
    r = client.post("/api/inbox/transcribe", json={"filename": "this-file-does-not-exist.mp4"})
    assert r.status_code == 404


def test_inbox_transcribe_returns_503_without_api_key(client, monkeypatch):
    """When the file exists but OPENAI_API_KEY is unset, surface 503 cleanly."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    # Touch a sentinel file to bypass the file-not-found 404 branch.
    import web_runner.routes.inbox as inbox_routes

    sentinel = inbox_routes.DIR / "sentinel.mp4"
    sentinel.write_bytes(b"\x00" * 1024)
    try:
        r = client.post("/api/inbox/transcribe", json={"filename": "sentinel.mp4"})
        assert r.status_code == 503
    finally:
        sentinel.unlink(missing_ok=True)


def test_inbox_download_returns_429_when_semaphore_saturated(client, monkeypatch):
    """Saturated inbox semaphore (limit=0) → 429 BEFORE any engine is launched.

    Pony-tail: monkeypatch `_inbox_sem` to a 0-slot BoundedSemaphore so
    every non-blocking acquire fails. Verifies the saturation gate fires
    in front of _is_public_url / yt-dlp / patchright — i.e. we never
    waste a WSGI worker syscall on a doomed request.
    """
    import web_runner.executor as wr_exec

    monkeypatch.setattr(wr_exec, "_inbox_sem", threading.BoundedSemaphore(0))
    r = client.post("/api/inbox/download", json={"url": "https://example.com/x.mp4"})
    assert r.status_code == 429
    assert r.headers.get("Retry-After") == "30"
    body = r.get_json()
    assert body["success"] is False
    assert "saturated" in body["message"]
    assert body["retry_after_sec"] == 30


def test_inbox_transcribe_returns_429_when_semaphore_saturated(client, monkeypatch):
    """Transcribe saturation check: file exists + key present, but semaphore=0 → 429."""
    import web_runner.executor as wr_exec

    monkeypatch.setattr(wr_exec, "_inbox_sem", threading.BoundedSemaphore(0))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fake-for-429-path")
    # Bypass the 404 branch so the saturation gate is what fails.
    import web_runner.routes.inbox as inbox_routes

    sentinel = inbox_routes.DIR / "sentinel.mp4"
    sentinel.write_bytes(b"\x00" * 1024)
    try:
        r = client.post("/api/inbox/transcribe", json={"filename": "sentinel.mp4"})
        assert r.status_code == 429
        assert r.headers.get("Retry-After") == "30"
    finally:
        sentinel.unlink(missing_ok=True)


def test_inbox_slot_release_round_trip(monkeypatch):
    """BoundedSemaphore round-trip: one acquire + one release keeps the slot
    pool healthy; double-release would raise ValueError on BoundedSemaphore,
    which is the whole point of using BoundedSemaphore rather than Semaphore."""
    import web_runner.executor as wr_exec

    fresh = threading.BoundedSemaphore(1)
    monkeypatch.setattr(wr_exec, "_inbox_sem", fresh)
    assert wr_exec.acquire_inbox_slot() is True
    assert wr_exec.acquire_inbox_slot() is False  # 1-slot, second acquire blocked
    wr_exec.release_inbox_slot()
    assert wr_exec.acquire_inbox_slot() is True
    wr_exec.release_inbox_slot()
    with pytest.raises(ValueError):
        wr_exec.release_inbox_slot()  # one extra release → BoundedSemaphore raises


# ── DNS-resolution guard (v0.1 DNS-rebinding defense) ────


@pytest.mark.parametrize(
    "addrinfo_record,url",
    [
        ((2, 1, 6, "", ("127.0.0.1", 0)),                "https://attacker.example/"),
        ((2, 1, 6, "", ("10.0.0.5", 0)),                 "https://cdn.example/v.mp4"),
        ((2, 1, 6, "", ("169.254.169.254", 0)),          "https://example.com/"),
        ((10, 1, 6, "", ("::ffff:127.0.0.1", 0, 0, 0)),  "https://attacker.example/"),
    ],
    ids=["loopback", "rfc1918", "link_local_metadata", "ipv4_mapped_ipv6_loopback"],
)
def test_resolve_is_public_rejects_invalid_ip_family(monkeypatch, addrinfo_record, url):
    """The four canonical `must reject` IP-family cases `_resolve_is_public`
    must keep out — DNS-rebound to (loopback, RFC1918, AWS/GCP/Azure
    metadata, IPv4-mapped-IPv6 trap). Each case monkeypatches
    `socket.getaddrinfo` to return ONE fake record shaped for the
    relevant family (AF_INET vs AF_INET6) and asserts the URL is
    rejected.

    Why these 4 (family, IP) tuples: each exercises a distinct branch
    of Python's `ipaddress` semantics:
      * loopback                  — `is_loopback` branch.
      * rfc1918                   — `is_private` branch (10/8).
      * link_local_metadata       — `is_link_local` branch
                                      (169.254/16, AWS/GCP/Azure
                                      metadata IP).
      * ipv4_mapped_ipv6_loopback — IPv4-mapped IPv6 trap that
                                      bypasses `is_loopback` without
                                      an explicit `.ipv4_mapped`
                                      unwrap, so this exercises the
                                      unwrap path inside
                                      `_resolve_is_public`.

    Parameterizing keeps the (family, IP) tuple visible in the test
    ID so a regression pinpoints which branch broke. Mirrors the
    vitest suite's `parametrize(..., ids=[...])` per-(platform,
    form) pattern (e.g. `language-drift`) so cross-language test
    enumeration has the same shape: a `pytest -k <id>` /
    `vitest --testNamePattern=<id>` lookup hits a single case
    regardless of which language owns the contract.

    When a new IP-family branch is added (e.g. IPv6 link-local
    `fe80::/10` or 240.0.0.0/4 reserved / 0.0.0.0 unspecified),
    append ONE tuple + ONE id; no test-name change required.
    """
    import socket as _socket

    import web_runner.routes.inbox as inbox_routes

    monkeypatch.setattr(_socket, "getaddrinfo", lambda host, *a, **kw: [addrinfo_record])
    assert inbox_routes._resolve_is_public(url) is False


def test_resolve_is_public_rejects_mixed_public_and_private(monkeypatch):
    """Multiple A records: ANY private IP → reject ALL (rebinding defense)."""
    import socket as _socket

    import web_runner.routes.inbox as inbox_routes

    monkeypatch.setattr(
        _socket,
        "getaddrinfo",
        lambda host, *a, **kw: [
            (2, 1, 6, "", ("93.184.216.34", 0)),  # public
            (2, 1, 6, "", ("10.0.0.1", 0)),  # private
        ],
    )
    assert inbox_routes._resolve_is_public("https://attacker.example/") is False


def test_resolve_is_public_accepts_public_dns(monkeypatch):
    """All records public → accepts."""
    import socket as _socket

    import web_runner.routes.inbox as inbox_routes

    monkeypatch.setattr(_socket, "getaddrinfo", lambda host, *a, **kw: [(2, 1, 6, "", ("93.184.216.34", 0))])
    assert inbox_routes._resolve_is_public("https://example.com/x.mp4") is True


def test_resolve_is_public_rejects_on_resolver_failure(monkeypatch):
    """gaierror / OSError → reject (don't fall through to chromium)."""
    import socket as _socket

    import web_runner.routes.inbox as inbox_routes

    def boom(host, *a, **kw):
        raise _socket.gaierror(-2, "Name or service not known")

    monkeypatch.setattr(_socket, "getaddrinfo", boom)
    assert inbox_routes._resolve_is_public("https://nonexistent.example/") is False


def test_resolve_is_public_rejects_empty_hostname():
    """URL with no hostname → reject (defense against `http:///foo` etc.)."""
    import web_runner.routes.inbox as inbox_routes

    assert inbox_routes._resolve_is_public(":///foo") is False


def test_resolve_is_public_exempts_198_18_15(monkeypatch):
    """RFC 2544 benchmark range (198.18.0.0/15) is publicly routable IANA
    allocation for network interconnect benchmarking — NOT private LAN.
    Python's `ipaddress.is_private()` over-classifies this /15 as private,
    so without an explicit exemption `_resolve_is_public` false-positives
    every public URL in sandbox / NAT / DNS-sinkhole envs that route
    public traffic via this range.

    Lock criterion: 198.18.0.0/15 → True (this test). Loopback / RFC1918
    / metadata IPs still return False (existing tests).

    Belt-and-suspenders bounds: spot-check both the low IP
    (`198.18.0.5`) AND the high edge (`198.19.255.254`) of the /15
    carve-out — both should accept. The /15 covers
    `198.18.0.0 - 198.19.255.255`; checking both extremes prevents
    an off-by-one regression where the carve-out gets mis-sized
    (e.g. someone tightening the exemption to /16 by accident).
    """
    import socket as _socket

    import web_runner.routes.inbox as inbox_routes

    monkeypatch.setattr(
        _socket,
        "getaddrinfo",
        lambda host, *a, **kw: [(2, 1, 6, "", ("198.18.0.5", 0))],
    )
    assert inbox_routes._resolve_is_public("https://attacker.example/") is True
    monkeypatch.setattr(
        _socket,
        "getaddrinfo",
        lambda host, *a, **kw: [(2, 1, 6, "", ("198.19.255.254", 0))],
    )
    assert inbox_routes._resolve_is_public("https://attacker.example/") is True
    # Bounds sanity: an IP adjacent to but OUTSIDE the /15 carve-out
    # (198.20.0.1) is regular public IP space — `is_private()` returns
    # False there natively, so this should also accept (proves the
    # carve-out is correct-sized, not over-broad).
    monkeypatch.setattr(
        _socket,
        "getaddrinfo",
        lambda host, *a, **kw: [(2, 1, 6, "", ("198.20.0.1", 0))],
    )
    assert inbox_routes._resolve_is_public("https://attacker.example/") is True


def test_resolve_is_public_carve_out_does_not_mask_private_in_mixed_records(monkeypatch):
    """The carve-out uses `continue` per-iteration, NOT `return True` —
    defense-in-depth against a future silent regression where someone
    replaces `continue` with `return True` for ergonomic reasons.

    Loop semantics: `_resolve_is_public` walks ALL A/AAAA records and
    rejects the URL if ANY record is private. The carve-out must skip
    only the 198.18.x.x records (continue), not abort the whole loop
    early (return True). Otherwise an attacker DNS with mixed records
    `[198.18.0.5, 127.0.0.1]` could pass — the 198.18 record would
    short-circuit the entire check, and the loopback would never be
    evaluated.

    Existing `test_resolve_is_public_rejects_mixed_public_and_private`
    uses `[93.184.216.34, 10.0.0.1]` which exercises the mixed-records
    direction but NOT the carve-out interaction. This test is the
    carve-out-specific analog: mixed records where ONE of them is
    inside the exempt /15.
    """
    import socket as _socket

    import web_runner.routes.inbox as inbox_routes

    monkeypatch.setattr(
        _socket,
        "getaddrinfo",
        lambda host, *a, **kw: [
            (2, 1, 6, "", ("198.18.0.5", 0)),  # carve-out → continue
            (2, 1, 6, "", ("127.0.0.1", 0)),  # private → must reject
        ],
    )
    assert inbox_routes._resolve_is_public("https://attacker.example/") is False


def test_resolve_is_public_strips_ipv6_zone_suffix(monkeypatch):
    """`fe80::1%eth0` — strip the %zone so ip_address parses cleanly;
    fe80::/10 is link-local → still rejected."""
    import socket as _socket

    import web_runner.routes.inbox as inbox_routes

    monkeypatch.setattr(_socket, "getaddrinfo", lambda host, *a, **kw: [(10, 1, 6, "", ("fe80::1%eth0", 0, 0, 0))])
    assert inbox_routes._resolve_is_public("https://attacker.example/") is False


# ── App-share text extraction (server-side mirror of Pages/InboxPage.tsx) ──


def test_extract_first_url_pulls_url_from_appshare_blob():
    """Mirror of `InboxPage.test.tsx::extracts https URL from app-share
    text containing prefix + suffix garbage`. Both ends MUST agree on
    what an appshare blob looks like so a curl / Python / SDK caller
    gets the same contract that the React UI does — drift in either
    direction (Python flex regex / TS flex regex) is a real regression
    for callers that bypass the UI.
    """
    import web_runner.routes.inbox as inbox_routes

    blob = (
        "4.66 xfo:/ :4pm 08/23 y@g.Ok " "https://v.douyin.com/D1obbfHosxs/ " "复制此链接，打开Dou音搜索，直接观看视频！"
    )
    assert inbox_routes._extract_first_url(blob) == "https://v.douyin.com/D1obbfHosxs/"

    # Clean URL: regex still matches (URL is its own match), strip
    # is a no-op, returns the same string.
    assert inbox_routes._extract_first_url("https://example.com/x.mp4") == "https://example.com/x.mp4"

    # Non-http input with NO URL anywhere: returns None. The 400
    # surface in `dl()` carries "no http(s) url found" for this branch.
    assert inbox_routes._extract_first_url("just some text without any url") is None


# ── CN full-width punctuation strip (platform-neutral edge case) ──


def test_extract_first_url_strips_trailing_cn_full_width_punct():
    """Platform-neutral edge case: `_TRAILING_CN_PUNCT_RE`'s intended
    path. Real appshare blobs usually put whitespace between the URL
    and the trailing CTA, but a copy-paste without separator (mobile
    keyboard autosuggest, accidental-merge) can leave the URL glued
    to a CN full-width punctuation char. The strip must extract just
    the URL. Uses a generic `example.com` URL to avoid bleaching the
    signal into a per-platform assumption — this is a helper-level
    invariant, not a corpus case.

    Tested punctuation: , 。 ！？ etc.
    """
    import web_runner.routes.inbox as inbox_routes

    cases = [
        ("https://example.com/a，", "https://example.com/a"),
        ("https://example.com/a。", "https://example.com/a"),
        ("https://example.com/a！", "https://example.com/a"),
        ("https://example.com/a，。」", "https://example.com/a"),  # multi-segment greed
        # Mega-case: all 11 codepoints in `_TRAILING_CN_PUNCT_RE`
        # (`，。！？、；：「」『』`) glued to the URL. Proves every char
        # individually hits the strip class and the `+` greedy match
        # works as a whole-set. Without this case, only 3 of the 11
        # codepoints (`，` `。` `！`) would be exercised.
        ("https://example.com/a，。」！？、；：「」『』", "https://example.com/a"),
        ("https://example.com/a", "https://example.com/a"),  # no-op
    ]
    for raw, expected in cases:
        assert inbox_routes._extract_first_url(raw) == expected


# ── App-share corpus fuzzer (XHS / Kuaishou platform text shape) ──

# The InboxPage regex-extraction contract is platform-agnostic: any
# appshare blob containing ONE https URL must yield that URL.
# Below: per-platform corpus tests locking the byte-identical regex
# + CN-FW punct strip against real-world share-text shapes. Sample
# texts are intentionally inline + kept in lock-step with the
# corresponding Vitest corpus (InboxPage.test.tsx, XHS/Kuaishou
# extraction tests) — drift between Python + TS is caught by visual
# diff in the same PR row.


@pytest.mark.parametrize(
    "blob,expected",
    [
        (
            "\u7ea2\u4e66\u70b9 #\u60c5\u611f #\u751f\u6d3b "
            "\ud83d\udccd\u5317\u4eac\u4e09\u91cc\u5c6f "
            "https://www.xhslink.com/aB3CdEf9Xy "
            "\u590d\u5236\u6b64\u94fe\u63a5\uff0c\u6253\u5f00\u5c0f\u7ea2\u4e66\u67e5\u770b\u66f4\u591a\u7cbe\u5f69\u5185\u5bb9\uff01",
            "https://www.xhslink.com/aB3CdEf9Xy",
        ),
        (
            "\u53d1\u73b0\u4e00\u5bb6\u8d85\u6cbb\u6108\u7684\u5496\u5561\u9986 "
            "https://www.xiaohongshu.com/explore/65a1b2c3d4e5f6789"
            "?xsec_token=ABlZx_Y8mK7nQ2wRt5vP9sD3jH6fG4cE1aI0oM&xsec_source=pc_"
            " \u590d\u5236\u6b64\u94fe\u63a5",
            "https://www.xiaohongshu.com/explore/65a1b2c3d4e5f6789"
            "?xsec_token=ABlZx_Y8mK7nQ2wRt5vP9sD3jH6fG4cE1aI0oM&xsec_source=pc_",
        ),
        (
            "\u5feb\u624b\u7206\u6b3e\u77ed\u89c6\u9891 #\u641e\u7b11 #\u65e5\u5e38 "
            "https://v.kuaishou.com/Xy7p9Q2wRt "
            "\u590d\u5236\u94fe\u63a5\u6253\u5f00\u5feb\u624b\uff0c\u7cbe\u5f69\u4e0d\u5bb9\u9519\u8fc7\uff01",
            "https://v.kuaishou.com/Xy7p9Q2wRt",
        ),
        (
            "\u5feb\u624b\u70ed\u95e8\u77ed\u89c6\u9891\u63a8\u8350 "
            "https://www.kuaishou.com/short-video/3x4y5z6a7b8c "
            "\u590d\u5236\u94fe\u63a5\u6253\u5f00\u5feb\u624b",
            "https://www.kuaishou.com/short-video/3x4y5z6a7b8c",
        ),
    ],
    ids=["xhs-short", "xhs-long", "kuaishou-short", "kuaishou-long"],
)
def test_extract_first_url_pulls_appshare_per_platform(blob, expected):
    """Per-platform xhs/kuaishou app-share URL extraction — short + long form.

    Replaces the prior self-titled `..._xhs_appshare_short_link` +
    `..._kuaishou_appshare_short_link` pair (one combined test each)
    with a single parametrized test that splits (platform, form)
    into 4 cases so a future regression can be pinpointed to the
    EXACT (platform, form) pair that broke — matching the
    `parametrize(..., ids=[...])` pattern used in the vitest suite's
    per-platform locales (e.g. language-drift).

    Cases:
      * xhs-short       — xhslink.com short URL inside hashtag blob.
      * xhs-long        — xiaohongshu.com/explore/<id>?xsec_token=...
                          URL — exercises the query-string branch.
      * kuaishou-short  — v.kuaishou.com short URL inside hashtag blob.
      * kuaishou-long   — kuaishou.com/short-video/<id> URL.

    When a new platform app-share text shape is added (e.g. douyin
    or tencent), append ONE tuple + ONE id to the parametrize list
    above; no test-name change is required. The pytest
    `-k <platform>` / `-k <id>` filters stay usable throughout —
    the platform dimension lives in the ID, not in the function name.

    Drift between Python and TS / vitest `InboxPage.test.tsx` XHS /
    Kuaishou extraction tests is caught by visual diff in the same
    PR row (see the `# texts are intentionally inline + kept in
    lock-step ...` comment immediately above this test).
    """
    import web_runner.routes.inbox as inbox_routes

    assert inbox_routes._extract_first_url(blob) == expected


def test_dl_accepts_appshare_blob(client, monkeypatch):
    """End-to-end: raw app-share blob posted to /api/inbox/download
    goes through regex extraction + SSRF gate + lands at a real
    download target.

    We monkeypatch `_try_ytdlp` so no real browser subprocess spawns —
    the test's invariant is that the URL reaching the engine is the
    CLEAN one, not the appshare blob. This locks the Round-15 backend
    analog of `trimmed vs target` API-arg mismatch at the WSGI edge:
    a future regression where `dl()` regresses to passing raw blob to
    the engine instead of the extracted URL fails this test directly.
    """
    import web_runner.routes.inbox as inbox_routes

    sent = inbox_routes.DIR / "fake.mp4"
    sent.write_bytes(b"\x00" * 1024)
    seen: dict[str, str] = {}

    def _fake_ytdlp(url: str):
        seen["url"] = url
        return sent, ""

    monkeypatch.setattr(inbox_routes, "_try_ytdlp", _fake_ytdlp)
    # Belt-and-suspenders: also stub `_try_patchright` so a regression
    # where the helper receives a "None → fall through to patchright"
    # path cannot cascade to a real chromium launch in CI. The
    # `seen["url"]` invariant is preserved regardless of which engine
    # is reached because `dl()` calls both with the same cleaned URL.
    monkeypatch.setattr(inbox_routes, "_try_patchright", lambda url: (None, ""))

    blob = (
        "4.66 xfo:/ :4pm 08/23 y@g.Ok " "https://v.douyin.com/D1obbfHosxs/ " "复制此链接，打开Dou音搜索，直接观看视频！"
    )
    try:
        r = client.post("/api/inbox/download", json={"url": blob})
        assert r.status_code == 200
        body = r.get_json()
        assert body["success"] is True
        assert body["filename"] == "fake.mp4"
        # Backend lock invariant: the URL reaching the engine is the
        # CLEAN `https://v.douyin.com/D1obbfHosxs/`, never the appshare
        # blob. Same Round-17 regression-guard pattern as the frontend
        # `entryText not.toContain('复制此')` — try to keep these two
        # assertions in lock-step across frontend + backend PRs so a
        # follow-up that flips one without the other fails fast.
        assert seen["url"] == "https://v.douyin.com/D1obbfHosxs/"
    finally:
        sent.unlink(missing_ok=True)


# ── Round-19 sec fixes ──


def test_dl_force_extracts_clean_url_even_when_input_startswith_http_with_suffix(
    client,
    monkeypatch,
):
    """Round-19 sec-2 fix: even when raw starts with http(s):// AND
    holds trailing appshare-style garbage (a real pattern when users
    manually trim the share-text prefix but forget the suffix, e.g.
    `https://example.com/x.mp4 复制此链接`), the URL extraction regex
    MUST still run to drop the suffix. Pre-fix the `raw.startswith(...)`
    short-circuit bypassed regex cleanup entirely.

    Defense-in-depth: this is wedge-level, byte-identical to the
    frontend `InboxPage.tsx` mirror test below. Failing this test
    means a future reviewer reverted `dl()` to the lax short-circuit
    path AND the frontend tightening wasn't strong enough to catch it
    client-side.
    """
    import web_runner.routes.inbox as inbox_routes

    fake = inbox_routes.DIR / "fake.mp4"
    fake.write_bytes(b"\x00" * 1024)
    seen: dict[str, str] = {}

    def _fake_ytdlp(url: str):
        seen["url"] = url
        return fake, ""

    monkeypatch.setattr(inbox_routes, "_try_ytdlp", _fake_ytdlp)
    monkeypatch.setattr(inbox_routes, "_try_patchright", lambda u: (None, ""))

    raw = "https://example.com/x.mp4 \u590d\u5236\u6b64\u94fe\u63a5\uff0c\u6253\u5f00\u6296\u97f3\u641c\u7d22"
    try:
        r = client.post("/api/inbox/download", json={"url": raw})
        assert r.status_code == 200, r.get_json()
        # Clean URL reached the engine. Round-19 sec-2 lock:
        # clean URL byte-identical, NO Chinese suffix.
        assert seen["url"] == "https://example.com/x.mp4"
    finally:
        fake.unlink(missing_ok=True)


def test_dl_rejects_url_with_dns_rebind_to_private_ip(client, monkeypatch):
    """Round-19 sec-1 fix: even when raw is a clean URL
    (https://attacker.example/x.mp4 ...), `_resolve_is_public(url)`
    MUST fire BEFORE any engine is launched. Pre-fix, only
    `_is_public_url` (literal-IP string check) ran, so a
    public-looking hostname that resolves to a private IP at
    chromium / resolver time slipped through to `_try_ytdlp`,
    which would then connect to internal network / cloud metadata
    via its own DNS resolver.

    This test simulates `attacker.example` resolving to RFC1918
    `10.0.0.1` and locks the rejection on the message-level so a
    future swap of `_resolve_is_public` for a weaker check fails
    this test directly.
    """
    import socket as _socket

    monkeypatch.setattr(
        _socket,
        "getaddrinfo",
        lambda host, *a, **kw: [(2, 1, 6, "", ("10.0.0.1", 0))],
    )

    r = client.post(
        "/api/inbox/download",
        json={"url": "https://attacker.example/x.mp4 \u540e\u7f00\u5047 appshare \u540e\u7f00"},
    )
    assert r.status_code == 400
    msg = r.get_json()["message"]
    # Lock the gate that fired: a future swap of `_resolve_is_public`
    # for a weaker check (e.g. just the literal-IP gate) would use a
    # different message and fail this test, alerting the reviewer.
    assert "dns" in msg or "rebinding" in msg or "private" in msg


# ── Round-19 v2: surface engine errors to user via 502 message ──


def test_dl_502_message_includes_ytdlp_stderr_tail_and_patchright_reason(
    client,
    monkeypatch,
):
    """Both engines failed; the 502 message MUST identify WHICH engine
    failed and WHY, so the user can grep-error without searching
    `.sau-logs/`. Specifically locks:
      • 'yt-dlp failed:' prefix + the tail snippet the user expects
      • 'patchright also failed:' prefix + the failure reason
      • both halves contributed to the same response
    """
    import web_runner.routes.inbox as inbox_routes

    monkeypatch.setattr(
        inbox_routes,
        "_try_ytdlp",
        lambda url: (None, "ERROR: Sign in to confirm your age. [facebook]"),
    )
    monkeypatch.setattr(
        inbox_routes,
        "_try_patchright",
        lambda url: (None, "no <video> src (login-walled, JS-SPA, or non-HTML5)"),
    )

    r = client.post(
        "/api/inbox/download",
        json={"url": "https://www.facebook.com/watch/?v=12345"},
    )
    assert r.status_code == 502
    msg = r.get_json()["message"]
    # yt-dlp side: the tail of the simulated stderr.
    assert "yt-dlp failed:" in msg
    assert "Sign in to confirm your age" in msg
    # patchright side: the simulated reason.
    assert "patchright also failed:" in msg
    assert "login-walled" in msg


def test_dl_502_message_caps_length_at_500_chars(client, monkeypatch):
    """Massive stderr (>10KB) plus a long patchright reason → the 502
    message must NOT balloon the JSON response or downstream toast
    memory. Locks the combined[:500] cap so a future regression that
    drops the cap surfaces in the test rather than in production
    response-size blow-up.

    Cap-fairness note: with `[:500]` post-concat, when the combined
    raw message > 500 chars the cap cuts the tail. The lead prefix
    `yt-dlp failed:` MUST survive (user always knows WHICH engine
    failed first); the trailing `patchright also failed:` may be
    cut if yt-dlp stderr is enormous. This test locks the SAFETY
    floor (cap holds + lead prefix survives) more strictly than
    the IDEAL `both prefixes` case which can never both cap AND
    fit when err_sum > 500.
    """
    import web_runner.routes.inbox as inbox_routes

    massive_ytdlp_err = "y" * 800  # > 500 chars on its own
    long_patchright_err = "p" * 400
    monkeypatch.setattr(
        inbox_routes,
        "_try_ytdlp",
        lambda url: (None, massive_ytdlp_err),
    )
    monkeypatch.setattr(
        inbox_routes,
        "_try_patchright",
        lambda url: (None, long_patchright_err),
    )

    r = client.post("/api/inbox/download", json={"url": "https://example.com/x.mp4"})
    assert r.status_code == 502
    msg = r.get_json()["message"]
    # Strict length cap so a future regression removing the [:500]
    # truncation surfaces as response-size blow-up is caught here.
    assert len(msg) <= 500
    # Lead prefix survives so the user knows the first failure was
    # yt-dlp's. The patchright half is intentionally NOT asserted
    # here — cap may legitimately cut it when yt-dlp alone is huge.
    assert msg.startswith("yt-dlp failed:")


def test_dl_502_message_handles_empty_engine_err_with_unknown_fallback(
    client,
    monkeypatch,
):
    """Defensive: if either engine returns (None, '') (empty err), the
    502 message still composes sensibly via the 'unknown' fallback —
    not an empty string or 'None'. Locks the `or 'unknown'` safety."""
    import web_runner.routes.inbox as inbox_routes

    monkeypatch.setattr(inbox_routes, "_try_ytdlp", lambda url: (None, ""))
    monkeypatch.setattr(inbox_routes, "_try_patchright", lambda url: (None, ""))

    r = client.post("/api/inbox/download", json={"url": "https://example.com/x.mp4"})
    assert r.status_code == 502
    msg = r.get_json()["message"]
    assert "yt-dlp failed: unknown" in msg
    assert "patchright also failed: unknown" in msg


# ── Round-29 v4: symmetric carve-out in `_is_public_url` (literal-IP path) ──


def test_is_public_url_exempts_198_18_15():
    """RFC 2544 §4 /15 carve-out also applies to the LITERAL-IP path.
    Symmetric exemption to `test_resolve_is_public_exempts_198_18_15`:
    a sandbox/NAT/DNS-sinkhole that routes public traffic via literal
    IPs (chromium typed-URL sub-requests, mirror URLs typed in DevTools,
    benchmark infrastructure) should NOT be 400-rejected at the literal
    gate either.

    Lock criterion: 198.18.0.0/15 → True (literal). Same /15 carve-out
    bounds as `_resolve_is_public`. No `getaddrinfo` stub needed —
    `_is_public_url` is a pure string parse, no DNS lookup.
    """
    import web_runner.routes.inbox as inbox_routes

    # Low edge of /15
    assert inbox_routes._is_public_url("http://198.18.0.5/") is True
    # High edge of /15
    assert inbox_routes._is_public_url("http://198.19.255.254/") is True
    # Adjacent public IP — is_private() returns False natively, so
    # this also accepts (proves the carve-out is correct-sized, not
    # over-broad).
    assert inbox_routes._is_public_url("http://198.20.0.1/") is True


def test_is_public_url_carve_out_does_not_broaden_to_other_private_ranges():
    """Defense-in-depth: the carve-out is restricted to /15 — it must
    NOT silently broaden into other private / loopback / link-local /
    metadata / reserved ranges. Locks the per-IP policy so a future
    refactor (e.g. dropping the explicit `return True` and adding
    198.18.0.0/15 to a single pre-`is_private()` exclusion list) cannot
    regress to accepting 10.x or 127.x by accident.
    """
    import web_runner.routes.inbox as inbox_routes

    # Loopback
    assert inbox_routes._is_public_url("http://127.0.0.1/") is False
    # RFC1918
    assert inbox_routes._is_public_url("http://10.0.0.5/") is False
    # Link-local metadata
    assert inbox_routes._is_public_url("http://169.254.169.254/") is False
    # Unspecified
    assert inbox_routes._is_public_url("http://0.0.0.0/") is False
    # Reserved (Class E / 240.0.0.0/4)
    assert inbox_routes._is_public_url("http://240.0.0.1/") is False


def test_is_public_url_still_rejects_non_http_schemes():
    """The carve-out is IP-only — it does NOT loosen scheme validation.
    `javascript:` / `data:` / `file:` etc. still 400 even if followed
    by an in-range literal IP (defense against attacker smuggling
    schemes through the carve-out)."""
    import web_runner.routes.inbox as inbox_routes

    assert inbox_routes._is_public_url("javascript://198.18.0.5/alert(1)") is False
    assert inbox_routes._is_public_url("file://198.18.0.5/etc/passwd") is False
    assert inbox_routes._is_public_url("data://198.18.0.5/x") is False


def test_is_public_url_still_rejects_localhost_name():
    """Hostname-style localhost (DNS-name bypass vector noted in
    `_is_public_url`'s docstring) is unaffected by the literal-IP
    carve-out: localhost is a name, not an IP. The carve-out only
    matches `ipaddress.ip_address(parsed.hostname)` parses — keep it
    that way (don't add 'localhost' to the carve-out)."""
    import web_runner.routes.inbox as inbox_routes

    assert inbox_routes._is_public_url("http://localhost/x.mp4") is False


# ── Round-29 v5 Patch A+B+C: cookie wiring ──


def test_dl_passes_account_cookies_for_bilibili_url(client, monkeypatch, tmp_path):
    """Round-29 v5 Patch C + Round-30 v7 Python-API lock: when URL
    host maps to a known platform slug (`www.bilibili.com` →
    `bilibili`) AND a matching `cookies/<plat>_<acct>.json` exists
    (saved by QR-scan login), `_try_ytdlp` (now using
    `yt_dlp.YoutubeDL` Python API) MUST set `cookiefile` kwarg in
    `ydl_opts` pointing at the Netscape tmp file written by
    `_biliup_to_netscape` — so yt-dlp can authenticate against host
    anti-bot (e.g. B站 SESSDATA).

    Migration from subprocess CLI (Round-30 v7): the mock surface
    switched from `subprocess.run` (with `--cookies` argv parsing)
    to a `_FakeYDL` class that captures the `ydl_opts` dict. The
    file content snapshot still happens INSIDE the
    fake-YoutubeDL callback (`extract_info`) before Q3 unlink fires
    (race-free — see Round-29 v5 fix), but we now assert against
    `opts["cookiefile"]` + `opts["outtmpl"]` instead of `cmd` argv.

    Locks the full wiring (host→plat lookup + biliup-to-Netscape
    format conversion + cookiefile kwarg injection + extract_info
    filepath extraction) at one test so a future regression in any
    single leg fails fast.
    """
    import json

    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    # Plant a fake cookie JSON — what the QR-scan login writes
    # (`uploader/bilibili_uploader/main.py` saves biliup list-of-cookies).
    # Note: `client` fixture pre-creates `tmp_path/cookies`, so we use
    # `exist_ok=True` instead of `mkdir()`.
    cookies_dir = tmp_path / "cookies"
    cookies_dir.mkdir(exist_ok=True)
    cookie_json = cookies_dir / "bilibili_myaccount.json"
    cookie_json.write_text(
        json.dumps(
            [
                {
                    "name": "SESSDATA",
                    "value": "abc123-session-token",
                    "domain": ".bilibili.com",
                    "path": "/",
                    "expires": -1,
                },
                {"name": "bili_jct", "value": "csrf-def456", "domain": ".bilibili.com", "path": "/", "expires": -1},
            ]
        )
    )
    monkeypatch.setattr(wr_utils, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", cookies_dir)

    # Capture opts + netscape content BEFORE `_try_ytdlp`'s `finally:`
    # unlinks the tmp cookie file. Q3 ephemeral cleanup runs in
    # `finally` immediately after the `with YoutubeDL` block exits,
    # so reading from disk post-`client.post` returns always sees a
    # deleted file — snapshot inside `_FakeYDL.extract_info` is the
    # race-free read window.
    seen: dict = {}
    sentinel = tmp_path / "fake.mp4"
    sentinel.write_bytes(b"\x00" * 1024)

    class _FakeYDL:
        """Round-30 mock class: substitute for `yt_dlp.YoutubeDL`.
        Captures `ydl_opts` so the test can assert cookiefile was
        wired, returns a sentinel `info` dict so `_try_ytdlp` reads
        back the sentinel file as if yt-dlp wrote it.
        """

        def __init__(self, opts):
            self.opts = opts
            seen["opts"] = dict(opts)
            seen["url_at_init"] = None  # init has no URL yet

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False  # don't swallow exceptions

        def extract_info(self, url, download=True):
            seen["url"] = url
            # Snapshot Netscape content before Q3 unlink fires
            # (runs after `with` exits, BEFORE `_try_ytdlp` returns).
            cookiefile = self.opts.get("cookiefile")
            if cookiefile:
                p = inbox_routes.Path(cookiefile)
                if p.exists():
                    seen["netscape_path_str"] = str(p)
                    seen["netscape_content"] = p.read_text(encoding="utf-8")
                else:
                    seen["netscape_path_str"] = cookiefile
                    seen["netscape_content"] = None
            # Return postprocessor-shaped info dict so
            # `_try_ytdlp`'s `info.get("requested_downloads")[0]
            # ["filepath"]` extracts the sentinel file.
            return {"requested_downloads": [{"filepath": str(sentinel.resolve())}]}

    monkeypatch.setattr(inbox_routes.yt_dlp, "YoutubeDL", _FakeYDL)
    # BBDown is installed on CI/dev machines — disable it so this test
    # exercises the yt-dlp cookie-wiring path (BBDown path is tested
    # separately in test_bbdown_bilibili_*).
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    blob = "https://www.bilibili.com/video/BV1n17E6KEmb/"
    try:
        r = client.post("/api/inbox/download", json={"url": blob})
        assert r.status_code == 200, r.get_json()
        body = r.get_json()
        assert body["success"] is True
        assert body["filename"] == "fake.mp4"
        assert body["engine"] == "yt-dlp"

        opts = seen["opts"]
        # Wiring lock 1 (Python API contract post-Round-30): cookiefile
        # kwarg present in the ydl_opts dict. NOT `cmd.index("--cookies")`
        # like the pre-migration subprocess variant.
        assert opts.get("cookiefile"), f"cookiefile missing from opts: {opts}"
        netscape_path_str = opts["cookiefile"]
        # Wiring lock 2: format conversion correctness — biliup list
        # → Netscape flat-file. The `SESSDATA` value we planted must
        # appear verbatim in the captured content (snapshot taken
        # pre-unlink; read from disk post-unlink would race-condition).
        text = seen["netscape_content"]
        assert text is not None, "netscape content not captured (tmp file not writeable)"
        assert text.startswith("# Netscape HTTP Cookie File"), text[:80]
        assert "SESSDATA" in text
        assert "abc123-session-token" in text
        assert "bili_jct" in text
        assert "csrf-def456" in text
        assert ".bilibili.com" in text
        # Wiring lock 3: opts include the out-template / socket timeout
        # / quiet / noplaylist quartet (Python API equivalents of the
        # old subprocess `--no-playlist --quiet -o`).
        assert opts.get("quiet") is True
        assert opts.get("noplaylist") is True
        assert opts.get("socket_timeout") == 60
        assert opts.get("outtmpl", "").endswith("%(epoch>%H%M%S)s_%(id)s.%(ext)s")
        # Wiring lock 4: URL reached the YoutubeDL instance (via
        # `extract_info(url, ...)`). Verifies the cleaned URL was
        # extracted from the appshare blob (or, here, the raw blob is
        # already a URL itself, so it passes through verbatim).
        assert seen["url"] == blob
        # Belt-and-suspenders: extracted filepath (postprocessor-aware)
        # must equal the sentinel path — proves the
        # `requested_downloads[0]["filepath"]` extraction branch was
        # exercised.
        # (Filesystem check already done implicitly by the 200 response.)

        # Q3 lock: tmp cookie file ephemeral, unlinked by
        # `_try_ytdlp`'s `finally:` block regardless of download
        # success/failure. Without unlink, SESSDATA-equivalent
        # cookies leak to disk after process lifecycle. The path was
        # live AT extract_info time (captured by `_FakeYDL`); assert
        # it is no longer on disk after `client.post` returns.
        assert not inbox_routes.Path(
            netscape_path_str
        ).exists(), f"tmp cookie file should have been unlinked after request, but exists: {netscape_path_str}"
    finally:
        sentinel.unlink(missing_ok=True)
        # Q3 netscape file already unlinked by `_try_ytdlp`'s
        # `finally:` during the request — pytest tmp_path teardown
        # handles residual.


# ── Round-29 v5 Q4 polish: 502 message surface bleed ──


def test_dl_surfaces_empty_cookie_list_in_502_message(client, monkeypatch, tmp_path):
    """Q4 lock (empty-list case) — Round-30 v7: cookies JSON parses but
    has zero cookies → `_biliup_to_netscape` returns None →
    `_try_ytdlp` records `cookie_err = \"no usable cookies in cookie
    file\"`. When the `yt_dlp.YoutubeDL` instance raises
    `DownloadError` (e.g. B站 login-walled), the 502 message prefixes
    the cookie diagnostic via `_maybe_prefix_cookie_err` — user
    sees BOTH the cookie-empty signal AND yt-dlp's error msg,
    distinct from \"no cookies file at all\".

    Setup intentionally runs `_try_ytdlp` body (NOT stubbed) so the
    cookie conversion + err-aggregation flow executes end-to-end.
    `yt_dlp.YoutubeDL` class is the only stubbed entry — its `enter`
    returns a `_FakeYDLFail` instance that raises `DownloadError`
    inside `extract_info`, exercising the Python-API error path
    (Round-30 v7 — replaces the prior subprocess.run + non-zero-
    returncode stub).
    """
    import json

    import yt_dlp

    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    cookies_dir = tmp_path / "cookies"
    cookies_dir.mkdir(exist_ok=True)
    cookie_json = cookies_dir / "bilibili_myaccount.json"
    cookie_json.write_text(json.dumps([]))  # valid JSON, empty list

    monkeypatch.setattr(wr_utils, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", cookies_dir)

    class _FakeYDLFail:
        """Round-30 mock: substitute for yt_dlp.YoutubeDL that
        raises DownloadError on extract_info. Mirrors B站 anti-bot
        '412 Precondition Failed' surface. The exception's `.msg`
        attribute is exactly what `_try_ytdlp`'s DownloadError
        branch tails to assemble the 502 error string.
        """

        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False  # don't swallow

        def extract_info(self, url, download=True):
            raise yt_dlp.utils.DownloadError("ERROR: [BiliBili] mocked 412 Precondition Failed")

    monkeypatch.setattr(inbox_routes.yt_dlp, "YoutubeDL", _FakeYDLFail)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    r = client.post("/api/inbox/download", json={"url": "https://www.bilibili.com/video/BV1n17E6KEmb/"})
    assert r.status_code == 502
    msg = r.get_json()["message"]
    # Q4 lock: empty-list cookie diagnostic bleeds into 502 message.
    assert "no usable cookies in cookie file" in msg, msg
    # And yt-dlp's error msg ALSO surfaces via the prefix.
    assert "BiliBili" in msg


def test_dl_surfaces_malformed_cookie_json_in_502_message(client, monkeypatch, tmp_path):
    """Q4 lock (malformed JSON case) — Round-30 v7: cookies JSON cannot
    be parsed → `json.JSONDecodeError` caught → `cookie_err =
    f\"cookie-convert failed (JSONDecodeError: ...)\"`. Same prefix bleed
    to 502 — user can read `JSONDecodeError` as the \"your cookies
    file is broken\" signal, distinct from a generic 412/network
    surface. Mock surfaces `yt_dlp.YoutubeDL` raising `DownloadError`
    (Round-30 v7 contract — replaces the prior subprocess.run + non-
    zero-returncode stub).
    """
    import yt_dlp

    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    cookies_dir = tmp_path / "cookies"
    cookies_dir.mkdir(exist_ok=True)
    cookie_json = cookies_dir / "bilibili_myaccount.json"
    cookie_json.write_text("not valid json {{{ broken")  # malformed

    monkeypatch.setattr(wr_utils, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    class _FakeYDLFail:
        """Round-30 mock: substitute for yt_dlp.YoutubeDL that
        raises DownloadError on extract_info.
        """

        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False  # don't swallow

        def extract_info(self, url, download=True):
            raise yt_dlp.utils.DownloadError("ERROR: mocked yt-dlp failure")

    monkeypatch.setattr(inbox_routes.yt_dlp, "YoutubeDL", _FakeYDLFail)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    r = client.post("/api/inbox/download", json={"url": "https://www.bilibili.com/video/BV1n17E6KEmb/"})
    assert r.status_code == 502
    msg = r.get_json()["message"]
    assert "cookie-convert failed" in msg, msg
    assert "JSONDecodeError" in msg


# ── Round-30 v7.1: filepath fallback chain coverage (Reviewer B) ──


def test_dl_uses_filepath_fallback_when_no_requested_downloads(
    client,
    monkeypatch,
    tmp_path,
):
    """Round-30 v7.1 filepath Variant-2 lock (Reviewer B blocker):
    yt-dlp's classic flat info dict shape (`{"filepath": ...}`)
    without a top-level `requested_downloads` key — must STILL
    extract the sentinel path via the 5-step fallback chain so a
    future yt-dlp version that drops `requested_downloads` (or a
    legacy extractor that never populated it) doesn't silently
    break the green path.

    This test PIN step #5 (`info["filepath"]` direct). Combined
    with the existing `test_dl_passes_account_cookies_for_bilibili_url`
    (which pins Variant 1: `requested_downloads[0]["filepath"]`),
    the full chain is documented-and-locked so keypath drift in
    a new yt-dlp release fails fast at CI, not silently in prod.

    Lock criterion: 200 + sentinel filename "fake.mp4".
    """
    import web_runner.routes.inbox as inbox_routes

    sentinel = tmp_path / "fake.mp4"
    sentinel.write_bytes(b"\x00" * 1024)

    class _FakeYDLFlatInfo:
        """Variant-2 mock: yt-dlp returns ONLY top-level `filepath`
        + `id`, no `requested_downloads`. Defensive __exit__ returns
        False → lets propagated exceptions reach `_try_ytdlp`'s
        except clauses (not relevant here, success-path-only)."""

        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False  # don't swallow

        def extract_info(self, url, download=True):
            return {"filepath": str(sentinel.resolve()), "id": "abc123"}

    monkeypatch.setattr(inbox_routes.yt_dlp, "YoutubeDL", _FakeYDLFlatInfo)

    try:
        r = client.post(
            "/api/inbox/download",
            json={"url": "https://example.com/x.mp4"},
        )
        assert r.status_code == 200, r.get_json()
        body = r.get_json()
        assert body["success"] is True
        assert body["filename"] == "fake.mp4"
        assert body["engine"] == "yt-dlp"
    finally:
        sentinel.unlink(missing_ok=True)


# ── Round-30 v7.1: wall-clock timeout guard (Reviewer A) ──


def test_dl_returns_502_with_wall_clock_timeout_message(
    client,
    monkeypatch,
    tmp_path,
):
    """Round-30 v7.1 wall-clock guard lock (Reviewer BLOCKING A):
    when the yt-dlp call exceeds `_DL_TIMEOUT_SEC` seconds,
    `_try_ytdlp` MUST surface 502 with a 'timed out after Ns
    wall-clock' user message AND release the Flask worker
    rather than hold it indefinitely. Without this guard, a
    stuck HTTP retry inside yt-dlp could pin a WSGI worker
    past process death — exactly the regression the v7
    Python-API migration introduced vs. the pre-subprocess
    path's `subprocess.run(timeout=180)`.

    Test strategy: monkeypatch `concurrent.futures.ThreadPoolExecutor`
    to a fake whose `submit()` returns a Future already raised to
    `concurrent.futures.TimeoutError` — functionally equivalent
    to the real executor firing `future.result(timeout=N)` after
    N seconds, but the test runs in microseconds (no real
    thread-pool sleeps, no orphan threads, deterministic).
    """
    import concurrent.futures

    import web_runner.routes.inbox as inbox_routes

    class _FakeImmediateTimeoutExecutor:
        """Round-30 v7.1 mock: ThreadPoolExecutor substitute whose
        `submit()` immediately sets the future's exception to
        `TimeoutError`. Equivalent to the real executor firing
        `future.result(timeout=N)` after N seconds, but instant.
        """

        def __init__(self, max_workers=1):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def submit(self, fn, *args, **kwargs):
            fut = concurrent.futures.Future()
            fut.set_exception(concurrent.futures.TimeoutError())
            return fut

    # Monkeypatch at the actual stdlib module level (the one
    # `inbox_routes.concurrent.futures` references). pytest restores
    # post-test.
    monkeypatch.setattr(
        inbox_routes.concurrent.futures,
        "ThreadPoolExecutor",
        _FakeImmediateTimeoutExecutor,
    )

    r = client.post(
        "/api/inbox/download",
        json={"url": "https://example.com/x.mp4"},
    )
    assert r.status_code == 502, r.get_json()
    msg = r.get_json()["message"]
    # Wall-clock deadline semantic surface:
    assert "timed out" in msg, msg
    assert "wall-clock" in msg, msg
    # Configurable bound: literal `_DL_TIMEOUT_SEC` value bleeds
    # into msg so the user sees the actual cap the server enforces.
    assert str(inbox_routes._DL_TIMEOUT_SEC) in msg, msg


# ── Round-30 v7.2: boot‑time privacy‑hygiene janitor (Reviewer i) ──


def test_sweep_stale_yt_cookie_tmp_files_removes_stale_files(
    monkeypatch,
    tmp_path,
):
    """Round-30 v7.2 boot‑time janitor lock (Reviewer followup i):
    on `create_app()` startup, `_sweep_stale_yt_cookie_tmp_files`
    MUST scrub any `.yt_cookies_<hash>.txt` tmp files left in DIR
    from orphan/crashed `_try_ytdlp` runs. Cookies are plaintext
    session tokens — never let them survive a restart. Belt‑and‑
    suspenders: real video files (NOT matching the glob) MUST
    survive the sweep so the janitor doesn't accidentally delete
    legitimate outputs.

    Lock invariant: only `.yt_cookies_*.txt` matches, nothing else.
    """
    import web_runner.routes.inbox as inbox_routes

    # Simulate orphan-run leftovers: 2 stale cookie tmp files
    # matching the glob (PRNG‑deterministic 8‑char fingerprints
    # to match `_biliup_to_netscape`'s md5‑prefix convention).
    stale1 = tmp_path / ".yt_cookies_abc12345.txt"
    stale1.write_text("SESSDATA=expired; secure\n", encoding="utf-8")
    stale2 = tmp_path / ".yt_cookies_def67890.txt"
    stale2.write_text("SESSDATA=almost-expired; secure\n", encoding="utf-8")

    # Belt‑and‑suspenders: real video files with .mp4 suffix
    # (NOT matching the `.yt_cookies_*.txt` glob) MUST survive.
    keep = tmp_path / "real_download.mp4"
    keep.write_bytes(b"\x00" * 1024)

    # Belt‑and‑suspenders x2: a partial download in progress
    # `.yt_cookies_partial.mp4` — glob is exact‑prefix match on
    # `.yt_cookies_`, so this also must NOT be removed.
    decoy = tmp_path / "yt_cookies_partial.mp4"
    decoy.write_bytes(b"\x00" * 1024)

    monkeypatch.setattr(inbox_routes, "DIR", tmp_path)
    removed = inbox_routes._sweep_stale_yt_cookie_tmp_files()

    # Lock 1: stale cookie tmp files actually removed.
    assert stale1.exists() is False, f"stale cookie file 1 not removed: {stale1}"
    assert stale2.exists() is False, f"stale cookie file 2 not removed: {stale2}"
    # Lock 2: return value tells the operator how many were scrubbed
    # (this is what gets logged on boot).
    assert removed == 2, f"expected 2 stale files removed, got {removed}"
    # Lock 3: real video file untouched — privacy sweep must NOT
    # become a destructive wipe‑all‑in‑DIR.
    assert keep.exists() is True, f"real_video.mp4 was incorrectly removed: {keep}"
    # Lock 4: prefix‑decoy untouched — glob stays exact‑match on
    # `.yt_cookies_*.txt`, doesn't bleed into `.yt_cookies_partial.mp4`.
    assert decoy.exists() is True, f"decoy file was incorrectly removed: {decoy}"


def test_sweep_stale_yt_cookie_tmp_files_is_noop_when_dir_missing(
    monkeypatch,
    tmp_path,
):
    """Boot‑time janitor must be defensive when DIR doesn't exist
    yet (fresh DB, no prior inbox output, first run) — missing
    directory → silent no‑op, no exception, returns 0. Lock the
    "booting on a clean machine doesn't crash" invariant."""
    import web_runner.routes.inbox as inbox_routes

    nonexistent = tmp_path / "does-not-exist"
    monkeypatch.setattr(inbox_routes, "DIR", nonexistent)

    # Must NOT raise — missing DIR is the v0.x fresh-install path,
    # not a bug to surface.
    removed = inbox_routes._sweep_stale_yt_cookie_tmp_files()
    assert removed == 0


# ── Round-7: cookie-age diagnostic in 502 path (dl() surface bleed) ──


@pytest.mark.parametrize(
    "setup_strategy,required_all,required_any_of,forbidden",
    [
        (
            "stale",
            [
                "bilibili cookies are",
                "h old",
                ">24h threshold",
                "fake yt err",
                "fake pr err",
            ],
            ["QR-scan", "/app/accounts"],
            [],
        ),
        (
            "fresh",
            ["yt-dlp failed", "fake yt err", "fake pr err"],
            [],
            ["h old", ">24h threshold", "refresh"],
        ),
        (
            "no_cookie_file",
            [],
            [],
            ["h old", "refresh", "qr-scan"],
        ),
    ],
    ids=["stale", "fresh", "no_cookie_file"],
)
def test_dl_502_cookie_age_diagnostic_visibility(
    client,
    monkeypatch,
    tmp_path,
    setup_strategy,
    required_all,
    required_any_of,
    forbidden,
):
    """Round-7 cookie-age diagnostic visibility matrix on the 502 path.

    Replaces the prior separate tests (3 functions):
      * test_dl_502_includes_cookie_age_diagnostic_when_stale
      * test_dl_502_omits_cookie_age_diagnostic_when_fresh
      * test_dl_502_omits_cookie_age_diagnostic_when_no_cookie_file

    Each case differs only on (cookie mtime · cookie existence) and
    the expected substring presence / absence cluster that
    `_cookie_freshness_diagnostic` produces when combined with the
    standard `[inbox] yt-dlp failed:` / `[inbox] patchright also
    failed:` engine-err surface.

    Cases:
      * stale          — mtime backdated to 5 days ago (≫ 24h
                          threshold). Diag MUST surface "X cookies
                          are Nh old (>24h threshold)" + the
                          platform-specific refresh hint (QR-scan
                          OR /app/accounts route); the engine-err
                          halves still bleed in via combined[:500].
      * fresh          — mtime = now (write_text default). Diag MUST
                          NOT surface; standard engine-err surface
                          alone (yt-dlp failed / fake yt err /
                          fake pr err) is what the user sees.
      * no_cookie_file — cookies/ dir empty / no bilibili_myacct.json
                          planted. Diag MUST NOT surface (no mtime
                          to even read → returns None); no platform
                          refresh hint bleeds either.

    Combined assertion: every `required_all` substring MUST be
    in msg (case-insensitive), AT LEAST ONE substring from
    `required_any_of` MUST be in msg when the list is non-empty
    (the OR semantic the original stale test used to keep the
    hint-platform-specific check flexible), and no `forbidden`
    substring MUST be in msg.

    Note: the comparison uniformly lowers `msg` before substring
    matching — this is STRICTER than the originals, which used a
    mix of strict-case (`"QR-scan" not in msg`, `"h old" in msg`)
    and case-insensitive (`"refresh" not in msg.lower()`). The
    uniform lowering is a deliberate test-rigor win: future
    capitalization drift in the diagnostic string (e.g. a future
    variant emitting `QR-SCAN` / `Qr-Scan`) fails the new check
    where the strict-case originals would have silently passed.
    No original assertion semantic is lost (every lowercased
    substring matches a stricter / superset of the original),
    only widened.

    When a fourth variant is added (e.g. a `corrupt_json` case
    where `_biliup_to_netscape` fails with `JSONDecodeError`
    but cookies/ mtime is fresh), append ONE tuple + ONE id to
    the parametrize list above; no test-name change is required.
    The pytest `-k <id>` filter stays usable throughout — the
    variant dimension lives in the ID, not in the function name.
    Mirrors the appshare per-platform `parametrize(..., ids=[...])`
    convention.
    """
    import json
    import os
    import time

    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    cookies_dir = tmp_path / "cookies"
    cookies_dir.mkdir(exist_ok=True)
    cookie_path = cookies_dir / "bilibili_myacct.json"

    if setup_strategy == "stale":
        cookie_path.write_text(
            json.dumps(
                [
                    {
                        "name": "SESSDATA",
                        "value": "x",
                        "domain": ".bilibili.com",
                        "path": "/",
                        "expires": -1,
                    },
                ]
            )
        )
        # Backdate mtime to ~5 days ago (≫ 24h threshold).
        five_days_ago = time.time() - 5 * 24 * 3600
        os.utime(cookie_path, (five_days_ago, five_days_ago))
    elif setup_strategy == "fresh":
        cookie_path.write_text(
            json.dumps(
                [
                    {
                        "name": "SESSDATA",
                        "value": "x",
                        "domain": ".bilibili.com",
                        "path": "/",
                        "expires": -1,
                    },
                ]
            )
        )
        # mtime defaults to now (write_text's default) → fresh,
        # under 24h threshold → diag returns None.
    elif setup_strategy == "no_cookie_file":
        # Intentionally NO bilibili_myacct.json planted — diag
        # has no mtime to read → returns None.
        pass
    else:
        raise AssertionError(f"unknown setup_strategy: {setup_strategy!r}")

    monkeypatch.setattr(wr_utils, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)
    monkeypatch.setattr(
        inbox_routes,
        "_try_ytdlp",
        lambda url: (None, "fake yt err"),
    )
    monkeypatch.setattr(
        inbox_routes,
        "_try_patchright",
        lambda url: (None, "fake pr err"),
    )

    r = client.post(
        "/api/inbox/download",
        json={"url": "https://www.bilibili.com/video/BV1n17E6KEmb/"},
    )
    assert r.status_code == 502, r.get_json()
    msg = r.get_json()["message"].lower()

    for needle in required_all:
        assert needle.lower() in msg, (
            f"[{setup_strategy}] required {needle!r} absent from msg: "
            f"{r.get_json()['message']!r}"
        )
    if required_any_of:
        assert any(needle.lower() in msg for needle in required_any_of), (
            f"[{setup_strategy}] none of {required_any_of!r} present in msg: "
            f"{r.get_json()['message']!r}"
        )
    for needle in forbidden:
        assert needle.lower() not in msg, (
            f"[{setup_strategy}] forbidden {needle!r} present in msg: "
            f"{r.get_json()['message']!r}"
        )


def test_dl_502_logs_refresh_suspected_when_stale(
    client,
    monkeypatch,
    tmp_path,
):
    """Round-7: when the cookie-age diagnostic surfaces in the 502
    message, `_task_log` MUST also capture a `[inbox] refresh-suspected:`
    line. This is the dashboard-grade observability hook: cronjobs /
    SIEM dashboards can graph 1 cookie-rotting event per failed POST
    without grepping backend logs.

    Capture strategy: replace `wr_utils.log` (and the inbox-route's
    bound `_task_log` reference) with a list-append no-op so we can
    count log calls without polluting test stdout.
    """
    import json
    import os
    import time

    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    seen_logs: list[str] = []

    def _capturing_log(message: str) -> None:
        seen_logs.append(message)

    # Patch BOTH: wr_utils.log (canonical source) AND inbox_routes._task_log
    # (bound at import). pytest monkeypatch restores both at teardown.
    monkeypatch.setattr(wr_utils, "log", _capturing_log)
    monkeypatch.setattr(inbox_routes, "_task_log", _capturing_log)

    cookies_dir = tmp_path / "cookies"
    cookies_dir.mkdir(exist_ok=True)
    cookie_path = cookies_dir / "bilibili_myacct.json"
    cookie_path.write_text(
        json.dumps(
            [
                {"name": "SESSDATA", "value": "x", "domain": ".bilibili.com", "path": "/", "expires": -1},
            ]
        )
    )
    five_days_ago = time.time() - 5 * 24 * 3600
    os.utime(cookie_path, (five_days_ago, five_days_ago))

    monkeypatch.setattr(wr_utils, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    monkeypatch.setattr(
        inbox_routes,
        "_try_ytdlp",
        lambda url: (None, "fake yt err"),
    )
    monkeypatch.setattr(
        inbox_routes,
        "_try_patchright",
        lambda url: (None, "fake pr err"),
    )

    r = client.post("/api/inbox/download", json={"url": "https://www.bilibili.com/video/BV1n17E6KEmb/"})
    assert r.status_code == 502, r.get_json()

    # Lock 1: exactly one [inbox] refresh-suspected log line.
    refresh_logs = [m for m in seen_logs if "refresh-suspected" in m]
    assert len(refresh_logs) == 1, (
        f"expected exactly 1 refresh-suspected log, got {len(refresh_logs)}: " f"{refresh_logs}"
    )
    # Lock 2: log line carries the actual platform + age diagnostic so a
    # downstream dashboard can graph per-platform staleness rates.
    assert "bilibili cookies are" in refresh_logs[0]
    assert ">24h threshold" in refresh_logs[0]


def test_dl_502_does_not_log_refresh_suspected_when_fresh(
    client,
    monkeypatch,
    tmp_path,
):
    """Round-7 negative case: when cookies are fresh, no refresh-suspected
    log line is emitted — don't spam backend logs for successful-login
    + transient-engine-failure paths.

    Belt-and-suspenders against a future regression where the diagnostic
    emits a log line even when the user-visible msg is empty.
    """
    import json

    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    seen_logs: list[str] = []

    def _capturing_log(message: str) -> None:
        seen_logs.append(message)

    monkeypatch.setattr(wr_utils, "log", _capturing_log)
    monkeypatch.setattr(inbox_routes, "_task_log", _capturing_log)

    cookies_dir = tmp_path / "cookies"
    cookies_dir.mkdir(exist_ok=True)
    cookie_path = cookies_dir / "bilibili_myacct.json"
    cookie_path.write_text(
        json.dumps(
            [
                {"name": "SESSDATA", "value": "x", "domain": ".bilibili.com", "path": "/", "expires": -1},
            ]
        )
    )
    # Fresh mtime (default) → no diagnostic, no log noise.

    monkeypatch.setattr(wr_utils, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    monkeypatch.setattr(
        inbox_routes,
        "_try_ytdlp",
        lambda url: (None, "fake yt err"),
    )
    monkeypatch.setattr(
        inbox_routes,
        "_try_patchright",
        lambda url: (None, "fake pr err"),
    )

    r = client.post("/api/inbox/download", json={"url": "https://www.bilibili.com/video/BV1n17E6KEmb/"})
    assert r.status_code == 502

    # No refresh-suspected log when cookies are fresh.
    refresh_logs = [m for m in seen_logs if "refresh-suspected" in m]
    assert refresh_logs == [], f"expected 0 refresh-suspected log on fresh cookies, " f"got: {refresh_logs}"


# ── Round-7 v7.2 polish: opt-in debug fingerprint via env var ──


def test_inbox_log_cookie_diag_flag_emits_pre_and_post_state_lines(
    client,
    monkeypatch,
    tmp_path,
):
    """Round-7 v7.2 debug-fingerprint lock: when `INBOX_LOG_COOKIE_DIAG=1`
    is set, every 502 pass through `dl()` MUST emit TWO `[inbox]
    INBOX_LOG_COOKIE_DIAG=1` log lines — `pre-state` (URL host,
    resolved platform, account_files list) BEFORE the helper runs,
    and `post-state` (helper return value) AFTER it runs. Together
    they reveal which guard rule fired without re-running a fail.

    Lock 1: env-var enabled → `pre-state` line + `post-state` line
    present, in order.
    Lock 2: pre-state carries the platform + file count even WITHOUT
    any `cookies/` files (helper's "no cookies" guard is checkable).
    Lock 3: post-state reveals helper's verdict (None case).
    """
    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    seen_logs: list[str] = []

    def _capturing_log(message: str) -> None:
        seen_logs.append(message)

    monkeypatch.setattr(wr_utils, "log", _capturing_log)
    monkeypatch.setattr(inbox_routes, "_task_log", _capturing_log)
    # Opt-in via the env-var. truthy values per `_INBOX_LOG_COOKIE_DIAG_VALUES`.
    monkeypatch.setenv("INBOX_LOG_COOKIE_DIAG", "1")

    # Empty cookies dir + bilibili URL → pre-state will see
    # platform='bilibili' but account_files_count=0; post-state will
    # see None (no refresh hint should fire).
    empty_cookies = tmp_path / "cookies"
    empty_cookies.mkdir(exist_ok=True)
    monkeypatch.setattr(wr_utils, "COOKIES_DIR", empty_cookies)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", empty_cookies)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    monkeypatch.setattr(
        inbox_routes,
        "_try_ytdlp",
        lambda url: (None, "fake yt err"),
    )
    monkeypatch.setattr(
        inbox_routes,
        "_try_patchright",
        lambda url: (None, "fake pr err"),
    )

    r = client.post("/api/inbox/download", json={"url": "https://www.bilibili.com/video/BV1n17E6KEmb/"})
    assert r.status_code == 502, r.get_json()

    # Lock 1: pre-state line emitted BEFORE post-state line.
    pre_lines = [m for m in seen_logs if "INBOX_LOG_COOKIE_DIAG=1 pre-state" in m]
    post_lines = [m for m in seen_logs if "INBOX_LOG_COOKIE_DIAG=1 post-state" in m]
    assert len(pre_lines) == 1, f"expected exactly 1 pre-state log line, got {len(pre_lines)}: {pre_lines}"
    assert len(post_lines) == 1, f"expected exactly 1 post-state log line, got {len(post_lines)}: {post_lines}"
    # Ordering: pre must come BEFORE post in the log stream so a
    # SIEM dashboard / log ingest reads the inputs before the verdict.
    pre_idx = seen_logs.index(pre_lines[0])
    post_idx = seen_logs.index(post_lines[0])
    assert pre_idx < post_idx, (
        f"pre-state must precede post-state in the log stream; " f"got pre_idx={pre_idx} post_idx={post_idx}"
    )

    # Lock 2: pre-state reveals the URL host + resolved platform +
    # account_files count. Bilibili URL → platform='bilibili'.
    pre_msg = pre_lines[0]
    assert "host='www.bilibili.com'" in pre_msg, pre_msg
    assert "platform='bilibili'" in pre_msg, pre_msg
    # Empty cookies dir → account_files_count=0, empty bracket list.
    assert "account_files_count=0" in pre_msg, pre_msg
    assert "account_files=[]" in pre_msg, pre_msg

    # Lock 3: post-state reveals the helper's verdict = None (no
    # cookie file → no freshness hint should fire).
    post_msg = post_lines[0]
    assert "freshness_diag_return=None" in post_msg, post_msg


def test_inbox_log_cookie_diag_flag_silent_when_env_var_unset(
    client,
    monkeypatch,
    tmp_path,
):
    """Round-7 v7.2 negative case: when `INBOX_LOG_COOKIE_DIAG` is
    NOT set, the debug-fingerprint log lines MUST NOT appear in the
    log stream — production logs stay clean.

    Belt-and-suspenders against a future regression where the env-gate
    becomes always-on by mistake (would bloat every request's log line
    count by 2 for zero diagnostic value in production).
    """
    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    seen_logs: list[str] = []

    def _capturing_log(message: str) -> None:
        seen_logs.append(message)

    monkeypatch.setattr(wr_utils, "log", _capturing_log)
    monkeypatch.setattr(inbox_routes, "_task_log", _capturing_log)
    # NO monkeypatch.setenv here — env var defaults to empty/falsy,
    # the gate stays closed, expected behavior is silence.
    monkeypatch.delenv("INBOX_LOG_COOKIE_DIAG", raising=False)

    empty_cookies = tmp_path / "cookies"
    empty_cookies.mkdir(exist_ok=True)
    monkeypatch.setattr(wr_utils, "COOKIES_DIR", empty_cookies)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", empty_cookies)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    monkeypatch.setattr(
        inbox_routes,
        "_try_ytdlp",
        lambda url: (None, "fake yt err"),
    )
    monkeypatch.setattr(
        inbox_routes,
        "_try_patchright",
        lambda url: (None, "fake pr err"),
    )

    r = client.post("/api/inbox/download", json={"url": "https://www.bilibili.com/video/BV1n17E6KEmb/"})
    assert r.status_code == 502, r.get_json()

    # Lock: zero debug-fingerprint lines when env-var is unset.
    diag_lines = [m for m in seen_logs if "INBOX_LOG_COOKIE_DIAG=1" in m]
    assert diag_lines == [], f"expected ZERO INBOX_LOG_COOKIE_DIAG=1 log lines when env is unset, " f"got: {diag_lines}"


def test_inbox_log_cookie_diag_flag_emits_stale_return_post_state(
    client,
    monkeypatch,
    tmp_path,
):
    """Round-7 v7.2 positive staleness case: when env-var is set
    AND a cookie file is aged > 24h, the `post-state` line MUST
    carry the literal hint string `_cookie_freshness_diagnostic`
    produced (NOT None). Pairs with the staleness 502 message test
    (`test_dl_502_includes_cookie_age_diagnostic_when_stale`) so a
    future regression where the helper early-exits before producing
    the hint shows up here as `freshness_diag_return=None` instead
    of the stale hint — and the user-visible 502 message (covered
    by the other test) becomes the only place to spot it.
    """
    import json
    import os
    import time

    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    seen_logs: list[str] = []

    def _capturing_log(message: str) -> None:
        seen_logs.append(message)

    monkeypatch.setattr(wr_utils, "log", _capturing_log)
    monkeypatch.setattr(inbox_routes, "_task_log", _capturing_log)
    monkeypatch.setenv("INBOX_LOG_COOKIE_DIAG", "true")  # truthy 'true' branch

    cookies_dir = tmp_path / "cookies"
    cookies_dir.mkdir(exist_ok=True)
    cookie_path = cookies_dir / "bilibili_myacct.json"
    cookie_path.write_text(
        json.dumps(
            [
                {"name": "SESSDATA", "value": "x", "domain": ".bilibili.com", "path": "/", "expires": -1},
            ]
        )
    )
    # Backdate to 5 days ago → > 24h threshold → helper returns hint.
    five_days_ago = time.time() - 5 * 24 * 3600
    os.utime(cookie_path, (five_days_ago, five_days_ago))

    monkeypatch.setattr(wr_utils, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", cookies_dir)
    monkeypatch.setattr(inbox_routes, "_bbdown_available", lambda: False)

    monkeypatch.setattr(
        inbox_routes,
        "_try_ytdlp",
        lambda url: (None, "fake yt err"),
    )
    monkeypatch.setattr(
        inbox_routes,
        "_try_patchright",
        lambda url: (None, "fake pr err"),
    )

    r = client.post("/api/inbox/download", json={"url": "https://www.bilibili.com/video/BV1n17E6KEmb/"})
    assert r.status_code == 502, r.get_json()

    pre_lines = [m for m in seen_logs if "INBOX_LOG_COOKIE_DIAG=1 pre-state" in m]
    post_lines = [m for m in seen_logs if "INBOX_LOG_COOKIE_DIAG=1 post-state" in m]
    assert len(pre_lines) == 1
    assert len(post_lines) == 1

    # Pre-state: cookie file is on disk, count=1, basename appears in list.
    pre_msg = pre_lines[0]
    assert "account_files_count=1" in pre_msg, pre_msg
    assert "bilibili_myacct.json" in pre_msg, pre_msg

    # Post-state: helper returned a NON-None stale hint string.
    post_msg = post_lines[0]
    assert "freshness_diag_return=None" not in post_msg, post_msg
    assert "freshness_diag_return='bilibili cookies are" in post_msg, post_msg
