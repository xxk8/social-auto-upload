"""Test: X-SAU-Auth-Pending request header echoes back as X-SAU-Race-Window response header on 401s.

Round-OPT-3G followup: frontend tags the initial /api/auth/me
request with `X-SAU-Auth-Pending: 1` so the browser DevTools
network panel can filter out the race-window 401s that fire
during dashboard mount. Backend propagates this signal into the
response so the filter works on response headers.

This test pins:
  1) Race-window 401s carry `X-SAU-Race-Window: 1`
  2) Non-race-window 401s do NOT carry the header (the sign
     would otherwise mask genuine session-expired errors)
  3) Non-401 responses (regardless of header presence) do NOT
     get the racer marker
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from web_runner import create_app
from web_runner.db import get_database


@pytest.fixture
def app():
    """Flask test client — same shape as tests/test_auth.py::app.
    Forces SAU_AUTH_ENABLED=true so the global gate returns 401
    on anonymous requests."""
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "true"}, clear=False):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
    application.config["TESTING"] = True
    application.config["SECRET_KEY"] = "test-secret-key"
    with application.test_client() as client:
        yield client


@pytest.fixture(autouse=True)
def _clean_auth_tables():
    """Wipe auth tables so /api/auth/me returns 401 cleanly."""
    db = get_database()
    try:
        db.execute("DELETE FROM verification_codes")
        db.execute("DELETE FROM users")
    except Exception:
        pass
    yield


class TestRaceWindowHeaderEcho:
    """Pins the X-SAU-Auth-Pending → X-SAU-Race-Window echo contract."""

    def test_401_with_pending_header_carries_race_window_marker(self, app):
        """Simulate the dashboard-mount race window: anonymous
        client fires /api/auth/me with X-SAU-Auth-Pending: 1.
        Backend should: return 401 AND echo X-SAU-Race-Window: 1.
        """
        # Path that goes through _check_auth and returns 401
        # (not whitelisted like /api/auth/*). /api/accounts is a
        # real, auth-gated endpoint that exercises the global
        # before_request gate.
        resp = app.get(
            "/api/accounts",
            headers={"X-SAU-Auth-Pending": "1"},
        )
        assert resp.status_code == 401
        assert resp.headers.get("X-SAU-Race-Window") == "1"

    def test_401_without_pending_header_does_not_carry_marker(self, app):
        """Genuine session-expired 401 (no race window signal)
        must NOT carry the marker — DevTools operators need to
        tell the difference between "expected race" and "real
        auth failure"."""
        resp = app.get("/api/accounts")
        assert resp.status_code == 401
        assert resp.headers.get("X-SAU-Race-Window") is None

    def test_401_with_non_specific_header_value_does_not_carry_marker(self, app):
        """The header value must be exactly `1` (the documented
        protocol). Any other value (empty string, 'true', 'yes')
        is ignored — keeps the contract tight and prevents
        accidentally-tagged 401s from any client that happens to
        set a similar header for unrelated reasons."""
        for variant in ("", "true", "yes", "0", "false"):
            resp = app.get(
                "/api/accounts",
                headers={"X-SAU-Auth-Pending": variant},
            )
            assert resp.status_code == 401
            assert resp.headers.get("X-SAU-Race-Window") is None, (
                f"variant={variant!r}: marker carried when it should not"
            )

    def test_pending_header_does_not_affect_non_401_responses(self, app):
        """Successful 200 responses must not have the racer marker
        even when the request carries the pending header — the
        marker is 401-specific by design (only red-bar network
        entries need filter-narrowing)."""
        # /api/auth/me is in the _AUTH_WHITELIST so the gate
        # doesn't 401 — it falls through to the route handler
        # which returns 401 itself (no session). But /health is
        # the cleanest 200 we'd need: skip the header emoji
        # assertion there since health doesn't carry it either.
        resp = app.get(
            "/health",
            headers={"X-SAU-Auth-Pending": "1"},
        )
        assert resp.status_code == 200
        assert resp.headers.get("X-SAU-Race-Window") is None

    def test_pending_header_does_not_break_health(self, app):
        """Cross-origin preflight compatibility: a custom header
        on the request shouldn't accidentally fail CORS. Health
        is the smoke endpoint; it should still return 200."""
        resp = app.get("/health", headers={"X-SAU-Auth-Pending": "1"})
        assert resp.status_code == 200

    def test_route_level_401_carries_marker(self, app):
        """The after_request hook's whole reason for living is
        that it ALSO catches route-level 401s — i.e. /
        api/auth/login's 401-on-wrong-code — not just the global
        _check_auth gate's 401.

        Posts a login with a wrong code: the route handler
        itself returns 401 (not the gate, since /api/auth/* is
        whitelisted). With X-SAU-Auth-Pending: 1 on the request,
        the response should still carry X-SAU-Race-Window: 1.
        """
        with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
            app.post("/api/auth/send-code", json={"email": "route401@test.com"})
        resp = app.post(
            "/api/auth/login",
            json={"email": "route401@test.com", "code": "000000"},
            headers={"X-SAU-Auth-Pending": "1"},
        )
        assert resp.status_code == 401
        assert resp.headers.get("X-SAU-Race-Window") == "1"
