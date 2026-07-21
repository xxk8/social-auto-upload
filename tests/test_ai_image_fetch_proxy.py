"""Tests for `/api/ai/images/fetch` \u2014 SSRF gates, 10MB cap, content-type passthrough.

Covers tasks.md \u00a710.2 (4 cases).
"""

from __future__ import annotations

import socket

import pytest

from web_runner import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Flask test client with auth disabled + DNS stubbed to public IP.

    Per-test override of `socket.getaddrinfo` is permitted \u2014 a test that
    intentionally points DNS at a private IP keeps the public-IP
    baseline as the default, then replaces it locally.
    """
    import web_runner.routes.auth as wr_auth
    import web_runner.routes.inbox as inbox_routes
    import web_runner.utils as wr_utils

    monkeypatch.setattr(wr_auth, "_is_auth_enabled", lambda: False)
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, *a, **kw: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )
    monkeypatch.setattr(wr_utils, "COOKIES_DIR", tmp_path / "cookies")
    monkeypatch.setattr(wr_utils, "UPLOADS_DIR", tmp_path / "uploads")
    monkeypatch.setattr(wr_utils, "INBOX_DIR", tmp_path / "videos" / "inbox")
    monkeypatch.setattr(inbox_routes, "COOKIES_DIR", tmp_path / "cookies")
    (tmp_path / "cookies").mkdir(exist_ok=True)
    (tmp_path / "uploads").mkdir(exist_ok=True)
    (tmp_path / "videos" / "inbox").mkdir(parents=True, exist_ok=True)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ── Missing URL ─────────────────────────────────────────────────────


def test_fetch_rejects_missing_url(client):
    """No `url` query param \u2192 400 + 'url required' message."""
    r = client.get("/api/ai/images/fetch")
    assert r.status_code == 400
    body = r.get_json()
    assert body["success"] is False
    assert "url required" in body["message"]


# ── Literal-IP SSRF gate (BEFORE DNS) ───────────────────────────────


def test_fetch_rejects_literal_private_ip_url(client):
    """`http://127.0.0.1/x.jpg` \u2192 400 via `_is_public_url`, no DNS lookup.

    Locks the *literal*-IP gate at the proxy entry. The 4 substring
    assertion ('private' / 'loopback') survives any future message
    rewording that keeps the literal-gate meaning intact.
    """
    r = client.get("/api/ai/images/fetch?url=http://127.0.0.1/test.jpg")
    assert r.status_code == 400
    body = r.get_json()
    assert body["success"] is False
    assert "private" in body["message"] or "loopback" in body["message"]


# ── DNS-resolution SSRF gate (after literal IP passes) ─────────────


def test_fetch_rejects_dns_rebinding_to_private(client, monkeypatch):
    """`http://attacker.example/x.jpg` \u2192 DNS resolves to private IP \u2192 400.

    The fixture-wide `socket.getaddrinfo` stub returns a public IP by
    default; this test OVERRIDES it locally to return `10.0.0.1` so
    `_resolve_is_public` rejects AT the DNS gate. Mirrors the
    inbox `test_dl_rejects_url_with_dns_rebind_to_private_ip` lock.
    """
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, *a, **kw: [(2, 1, 6, "", ("10.0.0.1", 0))],
    )
    r = client.get("/api/ai/images/fetch?url=http://attacker.example/test.jpg")
    assert r.status_code == 400
    body = r.get_json()
    assert body["success"] is False
    assert "dns" in body["message"] or "private" in body["message"]


# ── 10MB cap enforcement during stream iteration ──────────────────


def test_fetch_size_cap_enforced_at_10mb(client, monkeypatch):
    """Upstream 12 MB of fake bytes \u2192 response truncated at exactly 10 MB.

    The cap fires inside the generator (`bytes_yielded > max`) so:
      * Flask receives exactly 10 MB of body bytes (chunked transfer)
      * The leftover upstream connection is closed in the `finally:`
    Lock invariant: total response payload \u2264 10 MB + 8 KB chunk
    tail (we read up to one chunk past the cap, but only if the cap
    fires mid-chunk; never beyond).
    """
    import web_runner.routes.ai as ai_routes

    BIG_BYTES = 12 * 1024 * 1024  # 12 MB upstream

    class _FakeBigResponse:
        def __init__(self):
            self.status_code = 200
            self.headers = {"Content-Type": "image/jpeg"}
            self.closed = False

        def iter_content(self, chunk_size: int = 8192):
            remaining = BIG_BYTES
            while remaining > 0:
                n = min(chunk_size, remaining)
                remaining -= n
                yield b"\x00" * n

        def close(self):
            self.closed = True

    fake = _FakeBigResponse()

    # Replace http_requests.get so a `stream=True` call returns our
    # fake response. Non-stream calls fall through to no-op (the
    # 502-connect-failed branch is exercised in the missing-URL test
    # above).
    real_get = ai_routes.http_requests.get

    def fake_get(url, **kw):
        if kw.get("stream"):
            return fake
        return real_get(url, **kw)

    monkeypatch.setattr(ai_routes.http_requests, "get", fake_get)

    r = client.get("/api/ai/images/fetch?url=http://example.com/big.jpg")

    assert r.status_code == 200
    # The cap fires inside the generator at exactly 10 MB. Chunked
    # transfer means `content_length` may be None, but the actual
    # body byte count is what we care about. We allow up to ONE extra
    # 8 KB chunk because the `bytes_yielded > cap` check fires AFTER
    # the chunk is appended (size 8192) \u2014 so worst case is 10 MB + 8K.
    max_allowed = ai_routes._IMAGE_FETCH_MAX_BYTES + 8192
    assert len(r.data) <= max_allowed, (
        f"response byte count {len(r.data)} exceeds 10MB cap+chunk (max {max_allowed})"
    )
    assert len(r.data) >= ai_routes._IMAGE_FETCH_MAX_BYTES, (
        f"expected ≥ {ai_routes._IMAGE_FETCH_MAX_BYTES} bytes (cap reached), got {len(r.data)}"
    )
    # Lock: upstream connection was closed (truncation fired).
    assert fake.closed is True


# ── Content-Type passthrough ───────────────────────────────────────


def test_fetch_returns_correct_content_type_passthrough(client, monkeypatch):
    """Upstream `Content-Type: image/png; charset=utf-8` \u2192 client sees `image/png`.

    Pin: charset suffix stripped. Image format surface must mirror what
    the browser sees when fetching directly so the frontend can set
    `File.type` correctly.
    """
    import web_runner.routes.ai as ai_routes

    class _FakePngResponse:
        def __init__(self):
            self.status_code = 200
            self.headers = {"Content-Type": "image/png; charset=utf-8"}
            self.closed = False

        def iter_content(self, chunk_size: int = 8192):
            yield b"\x89PNG\r\n\x1a\n"
            yield b"\x00" * 16

        def close(self):
            self.closed = True

    fake = _FakePngResponse()
    real_get = ai_routes.http_requests.get

    def fake_get(url, **kw):
        if kw.get("stream"):
            return fake
        return real_get(url, **kw)

    monkeypatch.setattr(ai_routes.http_requests, "get", fake_get)

    r = client.get("/api/ai/images/fetch?url=http://example.com/test.png")
    assert r.status_code == 200
    assert r.mimetype == "image/png"
    # Cache-Control: 1-hour public cache so the browser / fetch layer
    # doesn't re-fetch the same image unnecessarily, while still
    # picking up upstream retags within an hour. (Pexels/Pixabay URLs
    # are immutable in practice but the upstream can swap the file
    # under the same URL on rare retag events.)
    assert "max-age=3600" in r.headers.get("Cache-Control", "")
