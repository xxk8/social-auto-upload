"""CI lint gate — prevents the buggy ``_login_as`` early-return shape from
re-entering the test corpus.

Background — the regression this gate locks against
--------------------------------------------------

The pre-fix ``_login_as`` (inlined in ``tests/test_studio.py``,
``tests/test_admin_oauth.py``, ``tests/test_auth_session_rotation.py``
prior to the Phase 1 PR's consolidation) had this shape::

    def _login_as(client, email="x@y.com"):
        db = get_database()
        existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
        db.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
        with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
            client.post("/api/auth/send-code", json={"email": email})
        if existing:                           # <-- the bug
            return {"id": 1, "email": email, ...}   # <-- bypasses /api/auth/login
        ...

Branching on ``existing`` and returning a synthesized user-dict *without*
calling ``/api/auth/login`` leaves the Flask session cookie authenticated
as whichever user logged in LAST. Test bodies downstream of the
``_login_as`` would then see a stale ``session["user_id"]`` — the exact
cross-user isolation leak ``test_studio.py::test_list_returns_only_own_projects``
uncovered.

The post-fix canonical contract (see ``tests/_login_helpers.py``) is:

  1. DELETE pre-stale verification codes (60s per-email rate-limit bypass).
  2. ``/api/auth/send-code`` (mocked so the test env never sends real mail).
  3. ALWAYS ``/api/auth/login`` — no early-return shortcut.
  4. Return the response's user dict.

This module implements that contract as a CI gate: an AST walker over
every ``tests/**/*.py`` file rejects any login-as helper whose body
contains an ``if`` block whose statement is ``return <Name or Dict>``
(the exact regression shape).

Why AST instead of pure grep
----------------------------

A multi-line grep (``grep -A 5 'if .*:.*$'`` then grep for ``return\s*{``)
catches the canonical buggy shape but is brittle to:

* code formatting (extra blank lines between the ``if`` and the ``return``)
* variants of the variable name (``if user_exists``, ``if already_there``)
* legitimate ``return "<fixture>"`` patterns in benign fixtures

An AST walker understands Python semantic structure, so it can pinpoint
``if`` blocks whose sole statement is ``return <Name|Dict>`` regardless
of formatting or variable naming. Following tests/test_auth_session_rotation.py
convention, this gate lives in the ``tests/`` package so a future
``pytest tests/`` CI run surfaces failures natively.

Self-tests
----------

The module ships with TWO self-tests so detector-weakening refactors
break loudly:

* ``test_gate_fires_on_documented_buggy_pattern`` — parses a hand-written
  buggy helper as a string and asserts the detector rejects it.
* ``test_gate_passes_on_canonical_helper`` — parses the in-tree
  ``tests/_login_helpers.py`` and asserts the canonical helper is
  accepted by the detector.

If either fails, the detector has drifted from its lock — fix before
shipping.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

# ── Detection heuristics ─────────────────────────────────────────────
#
# Two-step heuristic: target identification + bug-shape detection.
# A function becomes a target if EITHER:
#   (1) its name matches ``_*login*as*`` (private helper naming), OR
#   (2) its body contains the literal ``/api/auth/send-code`` or
#       ``/api/auth/login`` (auth-test helper proxy).
# A target is flagged when ANY ``if`` block inside its body contains a
# single ``return <Name or Dict>`` statement — the regression shape.

# Match functions whose name starts with ``_`` (private helper) AND
# contains BOTH "login" AND "as" substrings. Excludes ``test_*`` since
# those are pytest test functions, not replay-the-bug helpers.
_LOGIN_AS_NAME = re.compile(
    r"^_[a-z0-9_]*login[a-z0-9_]*as[a-z0-9_]*$", re.IGNORECASE
)
# String literals that strongly imply auth-login logic. A function whose
# body contains one of these is treated as a login-as helper even if
# its name does not match the regex above (e.g., fixture-style names
# like ``_setup_user`` that early-return a synthesized user dict).
# Substring-match rather than exact string — handles future URL variants
# ("/api/auth/login/", parameterized f-strings, base-URL composition) without
# an allow-list update per case.
_AUTH_URL_NEEDLES = ("/api/auth/login", "/api/auth/send-code")


def _is_auth_url(s: str) -> bool:
    """True iff ``s`` contains an auth-login or auth-send-code URL needle.

    Lowercase for case-insensitive matching — absorbs minor drift in
    f-string URL builders. New endpoints require explicit intent
    (and a corresponding test fixture).
    """
    n = s.lower()
    return any(needle in n for needle in _AUTH_URL_NEEDLES)


def _login_as_helpers(tree: ast.Module) -> list[ast.FunctionDef]:
    """Yield ``FunctionDef`` nodes that look like login-as helpers.

    Includes both (1) name-matched AND (2) literal-matched targets so
    that future renames / aliases don't silently escape the gate.
    """
    out: list[ast.FunctionDef] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        if _LOGIN_AS_NAME.match(node.name):
            out.append(node)
            continue
        # Substring-proxy: any string constant in the function body that
        # contains an auth-URL needle; first hit wins.
        for sub in ast.walk(node):
            if (
                isinstance(sub, ast.Constant)
                and isinstance(sub.value, str)
                and _is_auth_url(sub.value)
            ):
                out.append(node)
                break
    return out


def _early_returns_of_name_or_dict(
    fn: ast.FunctionDef,
) -> list[tuple[str, ast.AST, int]]:
    """Find every regression-fingerprint clause inside ``fn``.

    Coverage:
      * ``if.body`` — original buggy shape.
      * ``if.orelse`` (else-clause) — symmetric variant like
        ``if not existing: send_code(); else: return <dict>``.
      * ``try.except_handler`` — regression hiding inside exception
        suppression blocks.

    Each violation returns ``(clause_label, owning_node, lineno)`` so
    the formatter can pinpoint which clause fired.

    Why Name | Dict:
      * ``return existing`` (or any Name whose value is a pre-fetched
        user row) → bypass-login shape verbatim.
      * ``return {"id": ..., "email": ..., "role": ...}`` → a synthesized
        user dict that QUACKS like /api/auth/login's response but
        never set the session cookie.

    Non-Name/Dict returns (``return response``, ``return client.post(...)``)
    are NOT flagged because they're the canonical post-fix shapes.

    Non-``return`` statements inside the clause (raise, pass, continue)
    are NOT flagged because they don't shortcut control flow past
    /api/auth/login.
    """
    bad: list[tuple[str, ast.AST, int]] = []
    for sub in ast.walk(fn):
        if isinstance(sub, ast.If):
            for clause_label, stmts in (
                ("if.body", sub.body),
                ("if.orelse", sub.orelse),
            ):
                for stmt in stmts:
                    if not isinstance(stmt, ast.Return):
                        continue
                    value = stmt.value
                    if isinstance(value, (ast.Name, ast.Dict, ast.Call)):
                        bad.append((clause_label, sub, stmt.lineno))
                        break
        elif isinstance(sub, ast.Try):
            for j, handler in enumerate(sub.handlers):
                for stmt in handler.body:
                    if not isinstance(stmt, ast.Return):
                        continue
                    value = stmt.value
                    if isinstance(value, (ast.Name, ast.Dict, ast.Call)):
                        bad.append(
                            (f"try.except_handler[{j}]", handler, stmt.lineno)
                        )
                        break
    return bad


def _format_violation(
    fn: ast.FunctionDef, bad_marks: list[tuple[str, ast.AST, int]]
) -> str:
    """Render a one-line per-violation message for the assertion error.

    Each violation surface its ``clause_label`` (``if.body`` /
    ``if.orelse`` / ``try.except_handler[i]@Chost<j>``) plus the source
    line — enough ground truth for a PR reviewer to fix the regression
    without re-deriving the gate's predicate.
    """
    locs = [f"{clause}@L{lineno}" for clause, _node, lineno in bad_marks]
    return (
        f"  - `{fn.name}` (def line {fn.lineno}): "
        f"{len(bad_marks)} early-Return(Name|Dict) at {locs}"
    )


# ── Per-file lint gate (parametrized over tests/**/*.py) ─────────────
#
# One parametrized test per file; pytest surfaces a clean per-file PASS /
# SKIP / FAIL map in CI. Files without a login-as helper SKIP — they're
# not relevant to this gate.

_TEST_FILES = sorted(
    str(p.relative_to("."))
    for p in Path("tests").rglob("*.py")
    if p.name != "__init__.py"
)


@pytest.mark.parametrize("test_file", _TEST_FILES, ids=lambda p: p)
def test_login_as_helpers_never_early_return_user_dict(test_file: str):
    """Any ``_login_as``-style helper in ``test_file`` MUST NOT branch-
    return a ``Name`` or ``Dict``.

    Reason: that shape skips the ``/api/auth/login`` call and leaves
    the Flask session cookie stale. The post-fix canonical contract
    (see ``tests/_login_helpers.py``) requires ALWAYS calling
    ``/api/auth/login`` before returning.

    This test runs once per file in ``tests/`` — files with no
    login-as helper SKIP (the gate is N/A for them). Files WITH a
    login-as helper fail if any branch inside that helper
    early-returns a ``Name`` or ``Dict``.

    File-level ``SyntaxError`` (the literal-``\n`` corruption class of
    bug, or any other parse blocker) is SKIPPED with a clear reason
    rather than failing with an ``Error`` from pytest — the goal is
    that the gate surfaces *what regressed*, not *that the gate's own
    parser also blew up*. A SKIPPED case prompts manual review, not a
    confused failure cascade.
    """
    src = Path(test_file).read_text(encoding="utf-8")
    try:
        tree = ast.parse(src)
    except SyntaxError as exc:
        pytest.skip(
            f"{test_file}: syntax error at L{exc.lineno} "
            f"({exc.msg.splitlines()[0] if exc.msg else 'parse-failed'}) "
            f"— gate cannot parse; review manually"
        )
    helpers = _login_as_helpers(tree)
    if not helpers:
        pytest.skip(f"{test_file}: no login-as helper present — gate N/A")
    violations: list[str] = []
    for fn in helpers:
        bad = _early_returns_of_name_or_dict(fn)
        if bad:
            violations.append(_format_violation(fn, bad))
    assert not violations, (
        f"{test_file} contains a login-as helper that violates the\n"
        f"  /api/auth/login-must-be-called-before-return invariant:\n"
        + "\n".join(violations)
    )


# ── Self-test #1: detector fires on a known-buggy pattern ────────────

_BUGGY_HELPER_SRC = '''
def _login_as(client, email="x@y.com"):
    """Hand-written buggy helper to lock the regression shape."""
    db = get_database()
    existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    db.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
    with patch("web_runner.routes.auth._send_smtp_email", return_value=(True, "ok")):
        client.post("/api/auth/send-code", json={"email": email})
    if existing:
        return {"id": 1, "email": email, "role": "admin"}
    row = db.fetch_one(
        "SELECT code FROM verification_codes WHERE email = ? "
        "AND purpose = 'login' AND used = 0 ORDER BY created_at DESC LIMIT 1",
        (email,),
    )
    return client.post(
        "/api/auth/login", json={"email": email, "code": row["code"]}
    ).get_json()["data"]["user"]
'''


def test_gate_fires_on_documented_buggy_pattern():
    """Canary — a hand-written buggy helper MUST be rejected.

    Locks the regression pattern as a fixture. If a future refactor
    weakens the AST walker (e.g., drops the ``Name|Dict`` check, adds
    a too-permissive ignore, etc.), this test fires before the
    per-file gate becomes useless.
    """
    tree = ast.parse(_BUGGY_HELPER_SRC)
    helpers = _login_as_helpers(tree)
    assert len(helpers) == 1, (
        f"fixture bug: expected exactly 1 login-as helper, "
        f"got {len(helpers)} — did the name-match regex change?"
    )
    fn = helpers[0]
    bad = _early_returns_of_name_or_dict(fn)
    assert len(bad) >= 1, (
        "gate failed to fire on the documented buggy pattern — "
        "regression detection broken; fix the AST walker before "
        "next PR"
    )


# ── Self-test #2: detector fires on Name-return regression shape ────


def test_gate_fires_on_buggy_name_return():
    """Canary — Name-return regression shape must ALSO fire.

    Locks the Name branch of the type check symmetrically. The
    sibling test ``test_gate_fires_on_documented_buggy_pattern``
    exercises ``return {"id": 1, ...}`` (Dict). If a future refactor
    narrows the type check to only one of Name/Dict (inadvertently
    or by intent), this test catches the asymmetry immediately.
    """
    buggy_name_src = '''
def _login_as(client, email="x@y.com"):
    """Buggy Name-return variant — exercises the Name branch of the type check."""
    db = get_database()
    existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    db.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
    with patch("...", return_value=(True, "ok")):
        client.post("/api/auth/send-code", json={"email": email})
    if existing:
        return existing  # Name return — same regression shape via variable.
    row = db.fetch_one(...)
    return client.post("/api/auth/login", json={"email": email, "code": row["code"]}).get_json()["data"]["user"]
'''
    tree = ast.parse(buggy_name_src)
    helpers = _login_as_helpers(tree)
    assert len(helpers) == 1, "fixture bug: expected exactly 1 login-as helper"
    bad = _early_returns_of_name_or_dict(helpers[0])
    assert any(
        clause.startswith("if.body") for clause, _node, _ln in bad
    ), (
        "gate failed to fire on Name-return regression shape — "
        "the Name branch of the type check dropped out. Fix the walker."
    )


# (The two walker-clause canaries below follow; the canonical-helper
# pass test is at the bottom of this file as Self-test #6.)# -- Self-tests #4 + #5: walker branches that the prior pair didn't lock --
#
# Companion canaries for the if.orelse and try.except_handler walker
# clauses. The above tests cover if.body only; without these, a
# refactor that simplifies the walker back to body-only passes
# silently. The fixtures deliberately bypass /api/auth/login so the
# regression shape is reachable.


def test_gate_fires_on_buggy_orelse_return():
    """Canary -- `if.orelse` clause must fire.

    Locks the else-clause walker predicate. Without this fixture,
    a future refactor that simplifies the walker back to only
    `if.body` would pass all sibling tests -- this canary fires
    when the else-clause branch is dropped.
    """
    buggy_orelse_src = '''
def _login_as(client, email="x@y.com"):
    """Buggy else-branch variant."""
    db = get_database()
    existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    db.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
    if not existing:
        client.post("/api/auth/send-code", json={"email": email})
    else:
        # Bypass-login regression via else branch (not body).
        return {"id": existing["id"], "email": email, "role": "admin"}
    row = db.fetch_one(...)
    return client.post("/api/auth/login", json={"email": email, "code": row["code"]}).get_json()["data"]["user"]
'''
    tree = ast.parse(buggy_orelse_src)
    helpers = _login_as_helpers(tree)
    assert len(helpers) == 1, "fixture bug: expected exactly 1 login-as helper"
    bad = _early_returns_of_name_or_dict(helpers[0])
    assert any(
        clause == "if.orelse" for clause, _node, _ln in bad
    ), (
        "gate failed to fire on if.orelse regression shape -- "
        "the else-clause walker dropped out. Re-apply the orelse branch."
    )


def test_gate_fires_on_buggy_try_except_return():
    """Canary -- `try.except_handler` clause must fire.

    Locks the try/except walker predicate. A regression hiding inside
    an exception-suppression block (try -> except -> return <existing>)
    is structurally equivalent to the canonical early-return bug.
    If a future refactor drops the try walker, this canary fires.
    Uses built-in `Exception` so ast.parse does not depend on
    project-defined exception types.
    """
    buggy_try_src = '''
def _login_as(client, email="x@y.com"):
    """Buggy try/except variant -- mirrors the user-spec example:
    try a real /api/auth/login call (fails), except the failure,
    short-circuit-return existing without retrying. The /api/auth/login
    attempt is structurally present inside the try; the regression
    shape is the swallow-and-short-circuit, not the missing call.
    DB row-fetch is stubbed with `...` (Ellipsis literal) since this
    fixture is sourced as a string and isn't executed."""
    db = get_database()
    existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    db.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
    try:
        client.post("/api/auth/login", json={"email": email, "code": "WRONG"})
        raise Exception("force except suppression")
    except Exception:
        return existing  # bypass-login via exception suppression.
'''
    tree = ast.parse(buggy_try_src)
    helpers = _login_as_helpers(tree)
    assert len(helpers) >= 1, "fixture bug: helper not detected by name/literal"
    bad = _early_returns_of_name_or_dict(helpers[0])
    assert any(
        clause.startswith("try.except_handler") for clause, _node, _ln in bad
    ), (
        "gate failed to fire on try.except regression shape -- "
        "the try/except walker dropped out. Re-apply the try handler scan."
    )


# ── Self-test #6: detector fires on Call-return regression shape ────
#
# This is THE canary for the type-tuple extension the user explicitly
# asked for (`(ast.Name, ast.Dict)` -> `(ast.Name, ast.Dict, ast.Call)`).
# Without it, a future refactor that narrows the tuple back to the
# original 2-element shape would pass ALL the existing canaries
# silently -- the very regression we added ast.Call to catch.
#
# Fixture: helper with `return _build_synth_user_dict(existing)` in an
# `if existing:` branch. Mirrors a real-world helper pattern: a local
# factory builds the response dict from a pre-fetched DB row, bypassing
# /api/auth/login. The shape is the same bypass-login regression -- just
# reached via a function call rather than a literal dict / Name.


_BUGGY_CALL_SRC = '''
def _login_as(client, email="x@y.com"):
    """Buggy Call-return variant -- factory synthesizes a user dict
    using a pre-fetched DB row without actually calling /api/auth/login.
    Locks the ast.Call branch of the type-tuple extension."""
    db = get_database()
    existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    db.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
    with patch("...", return_value=(True, "ok")):
        client.post("/api/auth/send-code", json={"email": email})
    if existing:
        return _build_synth_user_dict(existing)  # Call return -- factory bypass.
    row = db.fetch_one(...)
    return client.post(
        "/api/auth/login", json={"email": email, "code": row["code"]}
    ).get_json()["data"]["user"]
'''


def test_gate_fires_on_buggy_call_return():
    """Canary -- factory-Call return shape must ALSO fire.

    Locks the Call branch of the type-tuple extension. The sibling
    tests cover if.body Dict/Name; this fixture exercises the factory
    Call branch (e.g., `return _build_synth_user_dict(row)`) -- the
    exact shape the user flagged as needing coverage. If a future
    refactor narrows the type tuple back to `(ast.Name, ast.Dict)`
    (dropping `ast.Call`), this canary fires before the regression
    can re-enter the corpus.
    """
    tree = ast.parse(_BUGGY_CALL_SRC)
    helpers = _login_as_helpers(tree)
    assert len(helpers) == 1, (
        "fixture bug: expected exactly 1 login-as helper, "
        "got f{len(helpers)} -- did the name-match regex change?"
    )
    bad = _early_returns_of_name_or_dict(helpers[0])
    assert any(
        clause.startswith("if.body") for clause, _node, _ln in bad
    ), (
        "gate failed to fire on Call-return regression shape -- "
        "the ast.Call branch of the type tuple dropped out. "
        "Re-apply the type-tuple extension `(ast.Name, ast.Dict, ast.Call)`."
    )



# ── Self-test #6: detector accepts the canonical in-tree helper ─────


def test_gate_passes_on_canonical_helper():
    """Canary — ``tests/_login_helpers.py`` MUST be accepted by the gate.

    Locks the post-fix canonical contract as an explicit pass. If the
    canonical helper is ever regressed (someone adds an ``if`` that
    short-circuits past ``/api/auth/login``), this test fires before
    the per-file gate surfaces a less-specific failure.
    """
    helper_path = Path("tests/_login_helpers.py")
    assert helper_path.exists(), (
        "fixture bug: tests/_login_helpers.py missing — did the "
        "consolidation landed as expected?"
    )
    tree = ast.parse(helper_path.read_text(encoding="utf-8"))
    helpers = _login_as_helpers(tree)
    assert helpers, (
        "fixture bug: canonical helper not detected — did the "
        "literal-set or name-regex change?"
    )
    for fn in helpers:
        bad = _early_returns_of_name_or_dict(fn)
        assert not bad, (
            f"canonical helper `{fn.name}` regressed: contains "
            f"early-Return(Name|Dict) at {[(n.lineno,) for n in bad]} "
            f"— violates the post-fix contract"
        )
