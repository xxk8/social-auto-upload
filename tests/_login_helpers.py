"""Canonical ``_login_as`` test helper — single source of truth.

Consolidated out of three inline duplicates (``test_studio.py``,
``test_admin_oauth.py``, ``test_auth_session_rotation.py``) during the
Phase 1 PR review. Located in a sibling module rather than
``tests/conftest.py`` because pytest treats conftest specially — when
a test file does ``from tests.conftest import _login_as``, pytest may
expose a *different* module reference than the conftest-collector sees,
and the test body's local scope fails to resolve the name (the classic
conftest double-import foot-gun). A sibling module avoids that
mechanism entirely.

Canonical contract — DO NOT REINTRODUCE A VARIANT. Mirrors of this
function have historically caused cross-test cookie pollution
(see ``tests/test_auth_session_rotation.py`` for the blast-radius
canary locking the invariant).

Invariants
----------
1. DELETE pre-existing ``verification_codes`` for this email BEFORE
   ``send-code``, bypassing the 60-second per-email rate limit. Safe
   because ``verification_codes`` has no outbound FKs.
2. Always call ``/api/auth/login`` at the end of the helper so
   ``session["user_id"]`` is always rotated to the requested email.
   The pre-fix version had an ``if existing:`` early-return path that
   returned a user dict WITHOUT calling login, causing session.user_id
   to stick on whoever logged in last — surfaced as a cross-user
   isolation leak in
   ``test_studio.py::test_list_returns_only_own_projects``.
3. ``email`` is REQUIRED (no default). Tests must be explicit about
   which user they are logging in as — prevents accidental coupling
   to a shared default profile.

Helper is a module-level function (not a pytest fixture) so test
bodies keep their existing call shape
(``_login_as(app, "x@test.com")``) — zero test-signature refactor.
"""

from __future__ import annotations

from unittest.mock import patch

from web_runner.db import get_database


def _login_as(client, email):
    """Send code + login. Returns the authenticated user dict.

    See module docstring for the canonical contract. ``email`` MUST
    be passed explicitly (no default value).
    """

    db = get_database()
    db.execute("DELETE FROM verification_codes WHERE email = ?", (email,))

    with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
        client.post("/api/auth/send-code", json={"email": email})

    row = db.fetch_one(
        "SELECT code FROM verification_codes WHERE email = ? "
        "AND purpose = 'login' AND used = 0 "
        "ORDER BY created_at DESC LIMIT 1",
        (email,),
    )
    assert row is not None, f"No verification code for {email} after send-code"
    resp = client.post("/api/auth/login", json={"email": email, "code": row["code"]})
    assert resp.status_code == 200, f"Login failed for {email}: {resp.get_json()}"
    return resp.get_json()["data"]["user"]
