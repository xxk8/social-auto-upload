"""Cross-user session-rotation canary for ``_login_as`` helpers.

Locks the invariant that any `_login_as`-style helper MUST end with
``/api/auth/login`` so the Flask session cookie always reflects the
requested email.

The previous ``tests/test_studio.py::_login_as`` (and its sibling in
``tests/test_admin_oauth.py``) had an early-return fallback that
returned a user dict WITHOUT calling ``/api/auth/login`` when
``send-code``'s 60-second per-email rate-limit blocked the request —
leaving the session cookie authenticated as whichever user logged in
last. This bug surfaced as a cross-user isolation leak in
``test_studio.py::test_list_returns_only_own_projects`` (A's GET
returned B's projects because session.user_id was still B after the
third `_login_as("A")` had been bypassed). The post-fix contract is:

    1. DELETE pre-existing `verification_codes` for the email BEFORE
       send-code, so the per-email rate-limit can't reject the request.
    2. Always call `/api/auth/login` at the end of the helper, so
       ``session["user_id"]`` always reflects the requested email.

This canary locks the invariant INDEPENDENTLY of the studio tests:
after every ``_login_as``, ``GET /api/auth/me`` MUST report the
requested email. If a future PR re-introduces the buggy early-return
(or copies the buggy version into a new helper), this test fails
loudly.

The canary imports the canonical ``_login_as`` from
``tests/_login_helpers.py`` (the single source of truth consolidated from
the three pre-fix inline copies). It does NOT depend on
``tests/test_studio`` or ``tests/test_admin_oauth`` — so it runs as
long as the auth blueprint is in place, regardless of which Phase 1+
blueprint is shipping.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

# ``create_app`` is imported here (mirrors ``tests/test_studio.py``) so
# the standalone canary file does not depend on ``web_runner.routes.studio``
# to be importable. The auth blueprint is wired into ``create_app`` at
# web_runner/__init__.py, so this import resolves as long as the test
# env has the canonical project root on sys.path (which pytest's
# collection does automatically via conftest's ``from web_runner import
# db as wr_db``).
from web_runner import create_app  # noqa: E402


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def app():
    """Flask test client with isolated tmp COOKIES_DIR.

    Mirrors ``tests/test_studio.py::app`` and ``tests/test_admin_oauth.py::app``
    line-by-line so the testing convention is uniform. Forces
    ``SAU_AUTH_ENABLED=true`` so the global auth gate is active.
    """
    with patch.dict("os.environ", {"SAU_AUTH_ENABLED": "true"}, clear=False):
        with patch("web_runner.utils._sync_cookie_files_to_db"):
            application = create_app()
        application.config["TESTING"] = True
        application.config["SECRET_KEY"] = "test-secret-key-session-rotation"
        with tempfile.TemporaryDirectory() as tmp_dir:
            import web_runner.utils as wr_utils
            orig = wr_utils.COOKIES_DIR
            wr_utils.COOKIES_DIR = Path(tmp_dir)
            with application.test_client() as client:
                yield client
            wr_utils.COOKIES_DIR = orig


@pytest.fixture(autouse=True)
def _clean_tables():
    """Wipe auth-relevant tables before AND after each test.

    The try/except-per-statement pattern tolerates the schema-bootstrap
    window where tables may have grown FK constraints since this file
    was written.
    """
    from web_runner.db import get_database

    db = get_database()
    cleanup = (
        "DELETE FROM verification_codes",
        "DELETE FROM usage_logs",
        "DELETE FROM users",
    )
    for sql in cleanup:
        try:
            db.execute(sql)
        except Exception:
            pass
    yield
    for sql in cleanup:
        try:
            db.execute(sql)
        except Exception:
            pass


# ── Helper (post-fix `_login_as` contract — duplicated here intentionally) ──
# ───────────────────────────────────────────────────────────────────────────
#
# We deliberately do NOT import `_login_as` from ``tests/test_studio``:
# that would couple two test files and the very test we're writing needs
# its OWN helper to assert the invariant semantically, not as an
# upstream dependency. If this helper drifts from
# ``tests/test_studio.py::_login_as``, BOTH files should be re-audited.

# `_login_as` consolidated into tests/conftest.py
from tests._login_helpers import _login_as  # canonical helper (sibling-module import avoids conftest double-import foot-gun)  # noqa: E402

def _me_email(client):
    """Return the email of the currently-authenticated user.

    Uses ``/api/auth/me`` response shape documented in
    ``web_runner/routes/auth.py:290-302`` plus the project envelope:

        {success: True, data: <user shape {id, email, role, ...}>}

    The endpoint reads ``session`` directly, so a cookie mismatch
    surfaces here even if ``/api/auth/login``'s response body looked
    correct — that's why we assert ONLY ``/api/auth/me`` here
    (single source of truth for session rotation).
    """
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200, (
        f"/api/auth/me returned status={resp.status_code} body={resp.get_json()}"
    )
    body = resp.get_json()
    assert body["success"] is True, f"/api/auth/me success=False: {body}"
    # Per ``auth.py::me()`` response shape the user dict is wrapped one
    # level deep: ``{success, data: {user: {id, email, role, ...}}}``.
    # Treating ``data`` as the user obj directly gave ``KeyError: 'email'``
    # in the previous lock-file iteration.
    user = body["data"]["user"]
    return user["email"]


# ── Tests ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "sequence",
    [
        # A→B→A: the exact bug-surface pattern from
        # ``test_studio.py::test_list_returns_only_own_projects``.
        ("rotation_alpha@test.com", "rotation_beta@test.com", "rotation_alpha@test.com"),
        # A→B→C→B: a third user exercises the helper across more distinct
        # sessions (catches a regression where only ONE follow-up login
        # after the rate-limit bypass works correctly).
        (
            "rotation_a@test.com",
            "rotation_b@test.com",
            "rotation_c@test.com",
            "rotation_b@test.com",
        ),
        # A→B→A→B→A: repeated flips stress the helper under sustained
        # session-state churn. Each cycle, the previous user's cookie
        # must be cleanly evicted.
        (
            "rotation_p@test.com",
            "rotation_q@test.com",
            "rotation_p@test.com",
            "rotation_q@test.com",
            "rotation_p@test.com",
        ),
        # A→A→A: same email thrice. Idempotent re-login must leave the
        # session equal to A after each call. Catches a regression that
        # silently breaks the per-email re-login flow (e.g., if a future
        # PR removes the DELETE-bypass without re-routing through a
        # real rate-limiter, this case surfaces as 429 on the 2nd/3rd
        # ``send-code``).
        (
            "rotation_same_x@test.com",
            "rotation_same_x@test.com",
            "rotation_same_x@test.com",
        ),
    ],
    ids=["AB->A", "ABC->B", "ABAB->A", "AAA"],
)
def test_login_as_rotates_session_correctly(app, sequence):
    """After every ``_login_as``, ``/api/auth/me`` reports THAT email.

    This is the cross-user-isolation invariant the Phase 1 PR's
    ``_login_as`` fix preserves by always calling ``/api/auth/login``.
    A future PR that re-introduces the buggy early-return fallback
    (return user dict WITHOUT calling /api/auth/login) will fail
    here on at least one of the parametrize cases — most reliably
    on ``AB->A`` which mirrors the exact bug surface.
    """
    for email in sequence:
        _login_as(app, email)
        me_email = _me_email(app)
        assert me_email == email, (
            f"After _login_as({email!r}), /api/auth/me reported "
            f"{me_email!r}. The Flask session cookie must rotate with "
            f"every _login_as call — if it doesn't, the cross-user "
            f"isolation invariant has been broken (likely via the "
            f"early-return fallback in _login_as that skips "
            f"/api/auth/login)."
        )
