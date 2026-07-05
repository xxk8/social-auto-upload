"""Tests for `/api/ai/images/search` + `/api/ai/recommend-images` + helper functions.

Covers tasks.md \u00a710.1 (7 cases, expanded to 8 for spec coverage).

Ponytail ultra: one assertion per case. External HTTP endpoints are
mocked at the `_search_pexels` / `_search_pixabay` wrapper boundary
(mirroring test_inbox.py::monkeypatch `_try_ytdlp`) so no real calls
hit the Pexels / Pixabay networks.
"""

from __future__ import annotations

import socket
import time
from collections import deque

import pytest

from web_runner import create_app

# ── Fixture: post-wizard auth-disabled Flask client ────────────────


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Flask test client with auth disabled + DNS stubbed to public IP.

    Same shape as test_inbox.py::client so cross-test conventions stay
    in lockstep. The fresh `_IMAGE_CALL_LOG[uid]` bucket per request
    is auto-created via `setdefault`; we reset it in the fixture body
    for hermetic per-test isolation.

    Belt-and-suspenders: monkeypatch `_has_image_source = lambda: True`
    at the fixture level so tests don't need to set PEXELS_API_KEY /
    PIXABAY_API_KEY env vars. The 503-specific test overrides this
    locally with `lambda: False` so the 503 contract path still
    exercises the env-detection branch.
    """
    import web_runner.routes.ai as ai_routes
    import web_runner.routes.auth as wr_auth

    monkeypatch.setattr(wr_auth, "_is_auth_enabled", lambda: False)
    monkeypatch.setattr(ai_routes, "_has_image_source", lambda: True)
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, *a, **kw: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )
    # Belt-and-suspenders: clear the rate-limit bucket between tests
    # so the 429 case is hermetic (bucket[0] = 30 timestamps → next
    # call → 429).
    ai_routes._IMAGE_CALL_LOG.clear()

    (tmp_path / "cookies").mkdir(exist_ok=True)
    (tmp_path / "uploads").mkdir(exist_ok=True)
    (tmp_path / "videos" / "inbox").mkdir(parents=True, exist_ok=True)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ── Helpers: build fake upstream raw photo / hit objects ───────────


def _fake_pexels_photo(pid: int, **kw) -> dict:
    """Mimic a single entry from Pexels `/v1/search` `photos` array."""
    page = kw.get("page", f"https://www.pexels.com/photo/{pid}/")
    return {
        "id": pid,
        "width": 1920,
        "height": 1080,
        "url": page,
        "photographer": kw.get("photographer", f"Photographer {pid}"),
        "photographer_url": kw.get(
            "photographer_url", f"https://www.pexels.com/@user{pid}/"
        ),
        "photographer_id": pid * 1000,
        "avg_color": "#808080",
        "src": {
            "original": f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg",
            "large2x": f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?large2x",
            "large": f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?large",
            "medium": f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?medium",
            "small": f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?small",
            "portrait": f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?portrait",
            "landscape": f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?landscape",
            "tiny": f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?tiny",
        },
        "alt": kw.get("alt", f"test photo {pid}"),
    }


def _fake_pixabay_hit(hid: int, **kw) -> dict:
    """Mimic a single entry from Pixabay `/api/` `hits` array."""
    user = kw.get("user", f"user{hid}")
    return {
        "id": hid,
        "pageURL": kw.get("page", f"https://pixabay.com/photos/test-{hid}/"),
        "tags": kw.get("tags", "test, fake"),
        "previewURL": f"https://cdn.pixabay.com/photo/test-{hid}-preview.jpg",
        "webformatURL": f"https://cdn.pixabay.com/photo/test-{hid}-web.jpg",
        "largeImageURL": f"https://cdn.pixabay.com/photo/test-{hid}-large.jpg",
        "fullHDURL": f"https://cdn.pixabay.com/photo/test-{hid}-fullhd.jpg",
        "imageURL": f"https://cdn.pixabay.com/photo/test-{hid}-img.jpg",
        "resolutionWidth": 1920,
        "resolutionHeight": 1080,
        "fileSize": 12345,
        "user": user,
        "user_id": hid * 1000,
    }


# ── Helper-pure-function tests ──────────────────────────────────────


def test_normalize_pexels_photo_handles_all_required_fields():
    """`_normalize_pexels_photo` produces the 9-key NormalizedImage schema.

    Pin every field so a future refactor renaming / reshuffling keys fails
    this test directly. Lock criterion: 9 keys in spec, all assert.
    """
    import web_runner.routes.ai as ai_routes

    p = _fake_pexels_photo(12345)
    norm = ai_routes._normalize_pexels_photo(p)
    assert norm["id"] == "pexels:12345"
    assert norm["source"] == "pexels"
    assert norm["thumb"].endswith("?medium")
    assert norm["preview"].endswith("?large2x")
    assert norm["full"].endswith(".jpeg")
    assert norm["photographer"] == "Photographer 12345"
    assert norm["photographerUrl"] == "https://www.pexels.com/@user12345/"
    assert norm["pageUrl"] == "https://www.pexels.com/photo/12345/"
    assert norm["alt"] == "test photo 12345"


def test_normalize_pixabay_hit_unwraps_largest_image_url():
    """`_normalize_pixabay_hit` maps webformat/large/fullHD to the 3-tier schema.

    Pins: thumb=webformatURL, preview=largeImageURL, full=fullHDURL.
    user=photographer, user_id derivable page-URL.
    """
    import web_runner.routes.ai as ai_routes

    h = _fake_pixabay_hit(67890, user="alice", tags="mountain, sunset")
    norm = ai_routes._normalize_pixabay_hit(h)
    assert norm["id"] == "pixabay:67890"
    assert norm["source"] == "pixabay"
    assert norm["thumb"].endswith("-web.jpg")
    assert norm["preview"].endswith("-large.jpg")
    assert norm["full"].endswith("-fullhd.jpg")
    assert norm["photographer"] == "alice"
    assert norm["photographerUrl"] == "https://pixabay.com/users/alice-67890000/"
    assert norm["pageUrl"] == "https://pixabay.com/photos/test-67890/"
    assert norm["alt"] == "mountain, sunset"


def test_merge_dedupes_by_source_id_and_does_not_dedupe_across_sources():
    """Same-id-across-sources dedupe only within source; cross-source preserved.

    2 Pexels photos (1 dup) + 2 Pixabay hits → 4 unique normalized images.
    """
    import web_runner.routes.ai as ai_routes

    pexels_list = [
        _fake_pexels_photo(1),
        _fake_pexels_photo(1),  # dup within pexels
        _fake_pexels_photo(2),
    ]
    pixabay_list = [_fake_pixabay_hit(1), _fake_pixabay_hit(2)]
    merged = ai_routes._merge_image_results(pexels_list, pixabay_list, 100)
    ids = [m["id"] for m in merged]
    # pexels:1 dedupe, pexels:2 kept, pixabay:* NOT deduped across sources
    assert ids == ["pexels:1", "pexels:2", "pixabay:1", "pixabay:2"]


def test_count_limits_to_n_total_after_merge():
    """Hard cap to `count` after merge so the grid never overflows N tiles.

    5 + 5 = 10 raw, cap to 7 → 7 in final.
    """
    import web_runner.routes.ai as ai_routes

    pexels_list = [_fake_pexels_photo(i) for i in range(1, 6)]  # 5 unique
    pixabay_list = [_fake_pixabay_hit(i) for i in range(1, 6)]  # 5 unique
    merged = ai_routes._merge_image_results(pexels_list, pixabay_list, 7)
    assert len(merged) == 7
    # Cap fires DURING pexels iteration → all 5 pexels land, then 2 pixabay fill remaining.
    assert merged[5]["source"] == "pixabay"
    assert merged[6]["source"] == "pixabay"


# ── Route-level tests (mock the upstream at _search_* boundary) ────


def test_search_with_no_image_source_configured_returns_503(client, monkeypatch):
    """No PEXELS_API_KEY or PIXABAY_API_KEY → 503 + code=IMAGE_SOURCE_NOT_CONFIGURED.

    Pin: 503 status, stable code field, Chinese human-readable message.
    """
    import web_runner.routes.ai as ai_routes

    monkeypatch.setattr(ai_routes, "_has_image_source", lambda: False)
    r = client.post("/api/ai/images/search", json={"query": "test"})
    assert r.status_code == 503
    body = r.get_json()
    assert body["success"] is False
    assert "未配置" in body["message"]
    assert "PEXELS_API_KEY" in body["message"] and "PIXABAY_API_KEY" in body["message"]
    assert body.get("code") == "IMAGE_SOURCE_NOT_CONFIGURED"


def test_search_both_sources_fail_returns_empty_with_debug(client, monkeypatch):
    """Both upstream mocks return [] → empty data + debug.merged_count=0.

    Partial-degradation contract: success=True with empty data is NOT
    a failure; user can tell 'nothing matched' from `data.length === 0`.
    """
    import web_runner.routes.ai as ai_routes

    monkeypatch.setattr(ai_routes, "_search_pexels", lambda q, c: [])
    monkeypatch.setattr(ai_routes, "_search_pixabay", lambda q, c: [])
    r = client.post("/api/ai/images/search", json={"query": "abc", "count": 9})
    assert r.status_code == 200
    body = r.get_json()
    assert body["success"] is True
    assert body["data"] == []
    assert body["debug"]["merged_count"] == 0
    assert body["debug"]["pexels_count"] == 0
    assert body["debug"]["pixabay_count"] == 0


def test_search_pexels_only_when_pixabay_returns_empty(client, monkeypatch):
    """Pixabay returns [] → Pexels still surfaces, no error in debug.

    Lock the partial-degradation promise so a future regression that
    raises when one source is empty fails this test directly.
    """
    import web_runner.routes.ai as ai_routes

    monkeypatch.setattr(
        ai_routes,
        "_search_pexels",
        lambda q, c: [_fake_pexels_photo(1), _fake_pexels_photo(2)],
    )
    monkeypatch.setattr(ai_routes, "_search_pixabay", lambda q, c: [])
    r = client.post("/api/ai/images/search", json={"query": "abc"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["success"] is True
    assert len(body["data"]) == 2
    assert all(d["source"] == "pexels" for d in body["data"])
    assert body["debug"]["errors"] == []


def test_search_returns_429_when_rate_limited(client, monkeypatch):
    """30 timestamps within 60s → next call is 429 with retry_after_sec=60.

    Pin: status 429, retry_after_sec field stable so frontend can show
    '稍后重试 (60s)' without parsing the Chinese message.
    """
    import web_runner.routes.ai as ai_routes

    monkeypatch.setattr(ai_routes, "_search_pexels", lambda q, c: [_fake_pexels_photo(1)])
    monkeypatch.setattr(ai_routes, "_search_pixabay", lambda q, c: [])
    # Pre-fill bucket 0 (auth-disabled) to MAX — next call blocked.
    # `_IMAGE_CALL_LOG` is a plain dict since the per-user rate-limit
    # refactor (was `defaultdict(lambda: deque(maxlen=64))`). Use
    # `setdefault` so this test still gains ownership of the bucket;
    # future tests calling under uid=0 will reuse the populated bucket
    # (the fixture's `_IMAGE_CALL_LOG.clear()` resets the slate).
    bucket: deque = ai_routes._IMAGE_CALL_LOG.setdefault(0, deque(maxlen=64))
    bucket.clear()
    # Producer uses `time.monotonic()` so timestamps must match the
    # window-check `timebase`. Mismatching `time.time()` here would
    # silently break the rate-limit boundary check.
    now = time.monotonic()
    for _ in range(ai_routes._IMAGE_RATE_MAX_CALLS):
        bucket.append(now)
    r = client.post("/api/ai/images/search", json={"query": "abc"})
    assert r.status_code == 429
    body = r.get_json()
    assert body["success"] is False
    assert "rate-limited" in body["message"]
    assert body.get("retry_after_sec") == 60


def test_recommend_images_uses_topic_alias_query_for_search(client, monkeypatch):
    """`{topic}` OR `{query}` body fields both work — recommend contract.

    Both routed to the same `_search_images` path so the auto-recommend
    hook (frontend `useMaterialAutoRecommend`) and manual caller share
    code. Pin: explicit assertion on the multi-source merge working.
    """
    import web_runner.routes.ai as ai_routes

    monkeypatch.setattr(
        ai_routes,
        "_search_pexels",
        lambda q, c: [_fake_pexels_photo(99)],
    )
    monkeypatch.setattr(ai_routes, "_search_pixabay", lambda q, c: [_fake_pixabay_hit(77)])
    r = client.post("/api/ai/recommend-images", json={"topic": "周末咖啡"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["success"] is True
    assert len(body["data"]) == 2
    sources = {d["source"] for d in body["data"]}
    assert sources == {"pexels", "pixabay"}
