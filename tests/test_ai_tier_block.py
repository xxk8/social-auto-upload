"""round-AI-paywall-v1 — backend tier-block behavior tests.

Verifies the free-tier hard-block on the user-facing AI surface per
`web_runner/middleware/usage_metering.py::_AI_FEATURE_BLOCKED_FOR_FREE`
+ the structured `/api/usage/quota` shape exposed to the React side so
the `<AiPaywallBanner>` can present an accurate upgrade CTA.

Test groups:

  * TestAiTierBlockFree  — 402 + tier_required envelope for every
                            user-facing AI endpoint (text gen, image
                            gen, web search) for free tier.
  * TestAiTierBlockPro   — pro tier bypasses the gate entirely.
  * TestAiTierBlockLegacy — legacy tier (grandfathered) bypasses.
  * TestAiQuotaShape    — /api/usage/quota returns the structured
                            is_unlimited / can_upgrade / required_tier
                            shape for free tier (so the React side can
                            render the upgrade CTA in the quota
                            indicator without first issuing a guarded
                            request).

Why test middleware instead of route handlers? The middleware is the
single source of truth for the tier-block contract. Defence-in-depth
in route handlers is intentionally NOT added — auth-disabled mode
intentionally bypasses the tier-check alongside auth (dev-mode
semantics). Future PR may add per-route checks; for now the middleware
layer is the canonical gate.

referencedBy:{}}
"""

from __future__ import annotations

import os

import pytest

from web_runner import create_app
from web_runner.db import get_database
from tests._login_helpers import _login_as


# ──────────────────────────────────────────────────────────────────────
# Fixture: auth-enabled Flask test client with metering ON.
#
# Mirrors tests/test_admin_oauth.py's auth-on pattern: SAU_AUTH_ENABLED
# forced True, SAU_METERING_ENABLED forced True, isolate cookies dir.
# Auth-disabled path is exercised separately in TestAuthDisabledBypass.
# ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def auth_app(tmp_path, monkeypatch):
    """Flask test client with SAU_AUTH_ENABLED=true + metering=true.

    Uses pytest's `monkeypatch` fixture for env-var overrides so the
    test does NOT leak `SAU_AUTH_ENABLED=true` into later tests in
    the same session (a real foot-gun discovered during the v1 review
    — the auth-disabled bypass test would have seen the leaked value
    and skipped its assertion path).
    """
    monkeypatch.setenv("SAU_AUTH_ENABLED", "true")
    monkeypatch.setenv("SAU_METERING_ENABLED", "true")

    application = create_app()
    application.config["TESTING"] = True

    from web_runner import utils as wr_utils

    orig_cookies_dir = wr_utils.COOKIES_DIR
    wr_utils.COOKIES_DIR = tmp_path
    try:
        with application.test_client() as client:
            yield client
    finally:
        wr_utils.COOKIES_DIR = orig_cookies_dir


def _set_user_tier(email: str, tier: str) -> None:
    """Override license_tier for the just-logged-in user.

    `_get_user_tier` reads from `users.license_tier` on every
    request, so updating between requests is sufficient — no
    re-login needed.
    """
    db = get_database()
    db.execute(
        "UPDATE users SET license_tier = ? WHERE email = ?",
        (tier, email),
    )


# ──────────────────────────────────────────────────────────────────────
# Free-tier hard-block — all 9 user-facing AI endpoints.
# ──────────────────────────────────────────────────────────────────────


class TestAiTierBlockFree:
    FREE_EMAIL = "ai-paywall-free@test.com"

    def _login_free(self, client):
        _login_as(client, self.FREE_EMAIL)
        _set_user_tier(self.FREE_EMAIL, "free")
        return client

    def test_generate_blocked_with_402_envelope(self, auth_app):
        self._login_free(auth_app)
        resp = auth_app.post(
            "/api/ai/generate",
            json={"prompt": "test prompt"},
        )
        assert resp.status_code == 402
        data = resp.get_json()
        assert data["success"] is False
        assert data["error"] == "tier_required"
        assert data["code"] == "AI_TIER_REQUIRED"
        assert data["required_tier"] == "pro"
        assert data["upgrade_url"] == "/pricing?from=ai"
        assert data["action"] == "ai_generate"
        # `blocked_action` carries the path-derived slug so the
        # frontend can branch on nuanced copy ("图片素材" vs "文案生成").
        assert data["blocked_action"] == "generate"

    def test_generate_stream_blocked_pre_sse(self, auth_app):
        """Middleware MUST short-circuit BEFORE the SSE generator
        runs. If it didn't, the user would see a 200 event-stream
        header with the first event being `error: tier_required`
        — visually indistinguishable from a successful stream until
        the client parsed the body. The 402 + non-SSE mimetype
        proves the gate fires first."""
        self._login_free(auth_app)
        resp = auth_app.post(
            "/api/ai/generate/stream",
            json={"prompt": "test"},
        )
        assert resp.status_code == 402
        assert "event-stream" not in resp.headers.get("Content-Type", "")
        assert resp.get_json()["error"] == "tier_required"
        assert resp.get_json()["blocked_action"] == "generate-stream"

    def test_multi_platform_blocked(self, auth_app):
        self._login_free(auth_app)
        resp = auth_app.post(
            "/api/ai/generate/multi-platform",
            json={"topic": "test", "platforms": ["douyin"]},
        )
        assert resp.status_code == 402
        assert resp.get_json()["blocked_action"] == "generate-multi-platform"

    def test_variants_blocked(self, auth_app):
        self._login_free(auth_app)
        resp = auth_app.post(
            "/api/ai/generate/variants",
            json={"topic": "test"},
        )
        assert resp.status_code == 402
        assert resp.get_json()["blocked_action"] == "generate-variants"

    def test_enhance_prompt_blocked(self, auth_app):
        self._login_free(auth_app)
        resp = auth_app.post(
            "/api/ai/enhance-prompt",
            json={"text": "test idea"},
        )
        assert resp.status_code == 402
        assert resp.get_json()["blocked_action"] == "enhance-prompt"

    def test_search_blocked(self, auth_app):
        self._login_free(auth_app)
        resp = auth_app.post("/api/ai/search", json={"query": "test"})
        assert resp.status_code == 402
        assert resp.get_json()["blocked_action"] == "search"

    def test_images_search_blocked(self, auth_app):
        self._login_free(auth_app)
        resp = auth_app.post("/api/ai/images/search", json={"query": "test"})
        assert resp.status_code == 402
        assert resp.get_json()["blocked_action"] == "images-search"

    def test_recommend_images_blocked(self, auth_app):
        self._login_free(auth_app)
        resp = auth_app.post("/api/ai/recommend-images", json={"topic": "test"})
        assert resp.status_code == 402
        assert resp.get_json()["blocked_action"] == "recommend-images"

    def test_images_fetch_blocked(self, auth_app):
        self._login_free(auth_app)
        resp = auth_app.get(
            "/api/ai/images/fetch",
            query_string={"url": "https://example.com/x.jpg"},
        )
        assert resp.status_code == 402
        assert resp.get_json()["blocked_action"] == "images-fetch"

    def test_models_endpoint_NOT_blocked_for_free(self, auth_app):
        """Utility endpoint — model picker is free for everyone."""
        self._login_free(auth_app)
        resp = auth_app.get("/api/ai/models")
        # Either 200 (live or fallback list) — never 402, never 5xx.
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

    def test_config_get_NOT_blocked_for_free(self, auth_app):
        """Sidebar status indicator must work for free tier so the
        "AI 已配置" pill can render correctly."""
        self._login_free(auth_app)
        resp = auth_app.get("/api/ai/config")
        assert resp.status_code == 200

    def test_keys_list_NOT_blocked_for_free(self, auth_app):
        """Key list (utility endpoint) must work for free tier so the
        AI settings popover can render the "0 keys configured" chip
        — mirrors `test_config_get_NOT_blocked_for_free`. The
        `_AI_UTILITY_PATH_PREFIXES` skip fires BEFORE the daily-quota
        lookup, so `TIER_LIMITS["free"]["ai_generate"] = 0` does not
        regress this read."""
        self._login_free(auth_app)
        resp = auth_app.get("/api/ai/keys")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        # Body is the key list (empty for fresh free-tier user) — the
        # important assertion is "200, NOT 402, NOT 429".
        assert isinstance(body["data"], list)

    def test_trailing_slash_normalized(self, auth_app):
        """`/api/ai/generate/` (with trailing slash) MUST hit the
        same block as `/api/ai/generate` — otherwise curl variants
        or proxy rewrites could leak through the gate."""
        self._login_free(auth_app)
        resp = auth_app.post(
            "/api/ai/generate/",
            json={"prompt": "test"},
        )
        assert resp.status_code == 402


# ──────────────────────────────────────────────────────────────────────
# Pro / Legacy tiers — bypass the gate. They may still surface 5xx if
# no AI keys are configured (we don't actually call OpenRouter in
# tests), but NEVER 402.
# ──────────────────────────────────────────────────────────────────────


class TestAiTierBlockPro:
    PRO_EMAIL = "ai-paywall-pro@test.com"

    def test_generate_passes_tier_check_for_pro(self, auth_app):
        _login_as(auth_app, self.PRO_EMAIL)
        _set_user_tier(self.PRO_EMAIL, "pro")
        resp = auth_app.post(
            "/api/ai/generate",
            json={"prompt": "test"},
        )
        # Pro passes the gate: any 4xx/5xx is downstream (e.g. 503 if
        # no AI keys configured), but NEVER a 402 tier_required.
        assert resp.status_code != 402
        if resp.status_code != 200:
            # If non-200, body must NOT look like a tier_required envelope.
            body = resp.get_json() or {}
            assert body.get("error") != "tier_required"


class TestAiTierBlockLegacy:
    LEGACY_EMAIL = "ai-paywall-legacy@test.com"

    def test_generate_passes_tier_check_for_legacy(self, auth_app):
        _login_as(auth_app, self.LEGACY_EMAIL)
        _set_user_tier(self.LEGACY_EMAIL, "legacy")
        resp = auth_app.post(
            "/api/ai/generate",
            json={"prompt": "test"},
        )
        assert resp.status_code != 402


# ──────────────────────────────────────────────────────────────────────
# Auth-disabled mode — bypasses tier-check entirely (dev-mode semantics).
# ──────────────────────────────────────────────────────────────────────


class TestAuthDisabledBypass:
    AUTH_OFF_EMAIL = "ai-paywall-anon@test.com"

    def test_free_tier_block_skipped_when_auth_disabled(self, tmp_path, monkeypatch):
        """When SAU_AUTH_ENABLED=false, the tier-check repository is
        bypassed (admin/dev/local-self-hosted mode). The middleware
        returns None for unauthenticated sessions without consulting
        the tier table."""
        monkeypatch.setenv("SAU_AUTH_ENABLED", "false")
        monkeypatch.setenv("SAU_METERING_ENABLED", "true")

        from web_runner import utils as wr_utils

        application = create_app()
        application.config["TESTING"] = True
        orig_cookies_dir = wr_utils.COOKIES_DIR
        wr_utils.COOKIES_DIR = tmp_path
        try:
            with application.test_client() as client:
                # No login — anonymous session under auth-disabled.
                resp = client.post(
                    "/api/ai/generate",
                    json={"prompt": "test"},
                )
                # Must NOT be 402 — auth-disabled bypasses the gate.
                assert resp.status_code != 402
        finally:
            wr_utils.COOKIES_DIR = orig_cookies_dir


# ──────────────────────────────────────────────────────────────────────
# Quota endpoint shape — exposes structured is_unlimited / can_upgrade /
# required_tier per quota entry so React renders the upgrade CTA in
# the quota indicator WITHOUT issuing a guarded request first.
# ──────────────────────────────────────────────────────────────────────


class TestAiQuotaShape:
    def test_ai_generate_quota_indicates_upgrade_for_free(self, auth_app):
        email = "ai-quota-free@test.com"
        _login_as(auth_app, email)
        _set_user_tier(email, "free")
        resp = auth_app.get("/api/usage/quota")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        q = data["data"]["quotas"]["ai_generate"]
        assert q["limit"] == 0
        assert q["remaining"] == 0
        assert q["is_unlimited"] is False
        assert q["can_upgrade"] is True
        assert q["required_tier"] == "pro"

    def test_ai_generate_quota_unlimited_for_pro(self, auth_app):
        email = "ai-quota-pro@test.com"
        _login_as(auth_app, email)
        _set_user_tier(email, "pro")
        resp = auth_app.get("/api/usage/quota")
        q = resp.get_json()["data"]["quotas"]["ai_generate"]
        assert q["is_unlimited"] is True
        assert q["can_upgrade"] is False
        assert q["required_tier"] is None
        assert q["limit"] == -1

    def test_ai_generate_quota_unlimited_for_legacy(self, auth_app):
        email = "ai-quota-legacy@test.com"
        _login_as(auth_app, email)
        _set_user_tier(email, "legacy")
        resp = auth_app.get("/api/usage/quota")
        q = resp.get_json()["data"]["quotas"]["ai_generate"]
        assert q["is_unlimited"] is True
        assert q["can_upgrade"] is False
        assert q["required_tier"] is None

    def test_publish_quota_unaffected_by_ai_paywall(self, auth_app):
        """Free tier still gets the publish quota (5/day default) —
        AI paywall must NOT bleed into publish metering."""
        email = "ai-quota-publish-free@test.com"
        _login_as(auth_app, email)
        _set_user_tier(email, "free")
        resp = auth_app.get("/api/usage/quota")
        q = resp.get_json()["data"]["quotas"]["publish"]
        # publish quota is metered per-day (limit=5 by default); not
        # tier-blocked. `required_tier` should be None to distinguish
        # from the AI quota.
        assert q["required_tier"] is None
        assert q["can_upgrade"] is False
        assert q["limit"] > 0
